-- 21 Oct 2026 Codex Astra audits B1 (clinic bookings) and B2 (care plan, GP report):
-- output/codex-audits-2026-10-21/. Each function below is its previous definition with only the
-- change named in its comment.

-- B1-1. The one attachment boundary binds record uploads to their member. Same as 20261018161308 plus that check.
create or replace function public._clinic_result_attach(p_kind text,p_actor uuid,p_sub uuid,p_file uuid,p_member uuid,p_visit uuid,p_clinic_only uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare f public.clinic_batch_files;clinic uuid;v public.patient_care_visits;cur public.clinic_result_attachments;prior public.clinic_result_attachments;
 att public.clinic_result_attachments;applied jsonb;undone jsonb:=null;r bigint;corrected boolean:=false;changed boolean;
begin
 if not public._clinic_result_enabled()then return jsonb_build_object('status','disabled');end if;
 perform pg_advisory_xact_lock(hashtextextended('clinic-result-attach:'||p_file::text,0));
 select * into prior from public.clinic_result_attachments where submission_id=p_sub;
 if found and(prior.file_id<>p_file or prior.user_id<>p_member or prior.visit_id<>p_visit or prior.actor_id<>p_actor)then return jsonb_build_object('status','stale');end if;
 select f2.* into f from public.clinic_batch_files f2 where f2.id=p_file and f2.state='stored'for share nowait;if not found then return jsonb_build_object('status','invalid');end if;
 select b.clinic_id into clinic from public.clinic_batches b where b.id=f.batch_id;
 if p_clinic_only is not null and clinic is distinct from p_clinic_only then return jsonb_build_object('status','invalid');end if;
 -- B1-1: a file uploaded from a member's record belongs to that member on every clinic path (batch
 -- linking included); moving it to someone else stays a Noreon correction. It raises, so the caller's
 -- whole command rolls back, including a visit the batch path inferred before calling here.
 if p_kind<>'noreon-admin'and exists(select 1 from public.clinic_member_uploads u where u.batch_id=f.batch_id and u.member_id<>p_member)then
  raise insufficient_privilege using message='Record upload belongs to another member';end if;
 -- The visit must have been booked with the upload's clinic (review CF-1), or recorded by it for an upload.
 select v2.* into v from public.patient_care_visits v2
  where v2.id=p_visit and v2.user_id=p_member and(
   (v2.booking_context is not null and exists(select 1 from public.booking_appointment_versions bv join public.booking_scheduling_notices n on n.id=bv.notice_id
     where bv.appointment_id=v2.appointment_id and bv.revision=v2.accepted_revision and n.clinic_id=clinic))
   or(v2.source='clinic-upload'and v2.clinic_id=clinic and v2.booking_context is null));
 if not found or f.created_at<v.created_at then return jsonb_build_object('status','invalid');end if;
 perform 1 from public.patient_clinical_cases where user_id=p_member for update nowait;
 cur:=public._clinic_result_current(p_file);
 if cur.id is not null and cur.user_id=p_member and cur.visit_id=p_visit then att:=cur;
 else
  -- A clinic admin attaches only an unattached upload; moves are a Noreon admin correction.
  if p_kind='clinic-admin'and exists(select 1 from public.clinic_result_attachments where file_id=p_file)then return jsonb_build_object('status','stale');end if;
  if cur.id is not null then
   corrected:=true;
   perform 1 from public.patient_clinical_cases where user_id=cur.user_id for update nowait;
   undone:=public._clinic_result_retract(cur,p_actor,gen_random_uuid(),'Moved to another visit');
  end if;
  insert into public.clinic_result_attachments(file_id,clinic_id,user_id,visit_id,actor_kind,actor_id,submission_id,previous_id)
   values(p_file,clinic,p_member,p_visit,p_kind,p_actor,p_sub,cur.id)returning * into att;
  insert into public.clinic_portal_audit(clinic_id,batch_id,actor_id,kind,detail)values(clinic,f.batch_id,p_actor,case when corrected then 'result-reattached'else 'result-attached'end,
   jsonb_build_object('attachmentId',att.id,'actorKind',p_kind,'fileId',p_file,'memberId',p_member,'visitId',p_visit,'previousAttachmentId',cur.id,'previousMemberId',cur.user_id,'previousVisitId',cur.visit_id,'undone',undone));
 end if;
 applied:=public._clinic_result_apply(att,f);
 changed:=(applied->>'moved')::int>0;
 if changed then
  update public.patient_clinical_cases set revision=revision+1,updated_at=clock_timestamp()where user_id=p_member returning revision into r;
  insert into public.patient_clinical_case_events(user_id,revision,kind,actor_id,detail)
   values(p_member,r,'care-evidence',p_actor,jsonb_build_object('actor','system','attachmentId',att.id,'fileId',p_file,'labStageIds',applied->'ids','requestedBy',p_actor,'requestedByKind',p_kind));
 end if;
 if undone is not null and jsonb_array_length(undone->'ids')>0 then
  update public.patient_clinical_cases set revision=revision+1,updated_at=clock_timestamp()where user_id=cur.user_id returning revision into r;
  insert into public.patient_clinical_case_events(user_id,revision,kind,actor_id,detail)
   values(cur.user_id,r,'care-evidence',p_actor,jsonb_build_object('actor','system','detachedAttachmentId',cur.id,'labStageIds',undone->'ids','requestedBy',p_actor));
 end if;
 return jsonb_build_object('status','saved','attachmentId',att.id,'corrected',corrected,'moved',(applied->>'moved')::int,'waitingForLab',(applied->>'waiting')::int,
  'atLabAfterUpload',(applied->>'later')::int,'alreadyReceived',(applied->>'received')::int,'retracted',coalesce((undone->>'retracted')::int,0));
end$$;

-- B1-2. A nurse's ticks belong to the visit time they were recorded for, like the steps (review F4):
-- a rescheduled visit starts with no ticks, and checklist ticks count only for the checklist version shown.
alter table public.nurse_visit_marks add column arrangement timestamptz;
create function public._nurse_visit_mark_arrangement()returns trigger language plpgsql security definer set search_path=''as $$
begin new.arrangement:=public._nurse_visit_arrangement(new.source,new.source_id);return new;end$$;
revoke all on function public._nurse_visit_mark_arrangement()from public,anon,authenticated,service_role;
create trigger nurse_visit_marks_arrangement before insert on public.nurse_visit_marks for each row execute function public._nurse_visit_mark_arrangement();

-- Same as 20261018170600 plus the arrangement and checklist version filters.
create or replace function public._nurse_visit_items_marked(p_source text,p_id uuid,p_values boolean default true)returns jsonb
language sql stable security definer set search_path=''as $$
 select coalesce(jsonb_agg(i||jsonb_build_object('mark',(
  select jsonb_build_object('done',k.done,'note',k.note,'values',case when p_values then k.vals end,'recordedAt',k.recorded_at,'nurseName',k.actor_name)
  from public.nurse_visit_marks k where k.source=p_source and k.source_id=p_id and k.item=i->>'key'
   and k.arrangement=public._nurse_visit_arrangement(p_source,p_id)and k.checklist_version is not distinct from i->>'version'order by k.recorded_at desc,k.id desc limit 1))order by ord),'[]')
 from jsonb_array_elements(public._nurse_visit_items(p_source,p_id))with ordinality as x(i,ord)
$$;

-- Same as 20261018170600 except that the BP, weight and waist ticks are the current arrangement's.
create or replace function public.nurse_visit_complete(p_command jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare m uuid;src text;sid uuid;sub uuid;vid uuid;oid uuid;aid uuid;reason text;s public.workspace_staff;v jsonb;items jsonb;counts jsonb;
 prior public.nurse_visit_completions;rq public.patient_test_requests;b jsonb;booking jsonb;res jsonb;entries jsonb:='[]';i jsonb;bp public.nurse_visit_marks;k public.nurse_visit_marks;
 stamp text:=public._nurse_visit_iso(clock_timestamp());result jsonb;r bigint;canonical jsonb;
 bad constant jsonb:=jsonb_build_object('status','invalid');
begin
 perform set_config('lock_timeout','1500ms',true);
 if jsonb_typeof(p_command)is distinct from 'object'or p_command->>'version'is distinct from 'nurse-visit-v1'
  or not(p_command?&array['memberId','source','sourceId','submissionId','visitId','openSubmissionId','appendSubmissionId','reason'])
  or p_command-array['version','memberId','source','sourceId','submissionId','visitId','openSubmissionId','appendSubmissionId','reason']<>'{}'
  or jsonb_typeof(p_command->'reason')not in('null','string')then return bad;end if;
 begin
  m:=(p_command->>'memberId')::uuid;sid:=(p_command->>'sourceId')::uuid;sub:=(p_command->>'submissionId')::uuid;
  vid:=(p_command->>'visitId')::uuid;oid:=(p_command->>'openSubmissionId')::uuid;aid:=(p_command->>'appendSubmissionId')::uuid;
 exception when invalid_text_representation then return bad;end;
 src:=p_command->>'source';reason:=nullif(btrim(p_command->>'reason'),'');
 if src not in('home-request','appointment')or m is null or sid is null or sub is null or vid is null or oid is null or aid is null
  or oid=aid or(reason is not null and length(reason)not between 3 and 1000)then return bad;end if;
 canonical:=jsonb_set(p_command,'{reason}',coalesce(to_jsonb(reason),'null'::jsonb));
 perform pg_advisory_xact_lock(hashtextextended('nurse-visit:'||sid::text,0));
 perform public._nurse_visit_nurse();
 s:=public._patient_visit_authorize(m,true,false);
 if not public._nurse_visit_enabled()then return jsonb_build_object('status','disabled');end if;
 select * into prior from public.nurse_visit_completions where source=src and source_id=sid;
 if found then
  if prior.submission_id=sub and prior.command=canonical and prior.actor_id=s.user_id then return prior.result||jsonb_build_object('replayed',true);end if;
  return jsonb_build_object('status','completed');
 end if;
 v:=public._nurse_visit_row(src,sid);
 if v is null or(v->>'memberId')::uuid<>m then raise insufficient_privilege;end if;
 -- A visit is completed on or after its arranged day, never ahead of it.
 if((v->>'startsAt')::timestamptz at time zone 'Asia/Yerevan')::date>(clock_timestamp()at time zone 'Asia/Yerevan')::date then
  return jsonb_build_object('status','too-early');end if;
 items:=public._nurse_visit_items_marked(src,sid);counts:=public._nurse_visit_counts(items);
 if jsonb_array_length(counts->'openItems')>0 and reason is null then return jsonb_build_object('status','reason-required','openItems',counts->'openItems');end if;
 -- 1. The home request closes first, so the auto-close trigger on the visit insert finds nothing to do.
 if src='home-request'then
  select * into rq from public.patient_test_requests where id=sid and user_id=m for update nowait;
  if rq.status='confirmed'then
   update public.patient_test_requests set revision=revision+1,status='completed',updated_at=now()where id=sid;
   insert into public.patient_test_request_events(request_id,command_id,actor_id,revision,operation,payload,result)
    values(sid,sub,s.user_id,rq.revision+1,'completed-by-visit',jsonb_build_object('visitId',vid,'nurseVisit',true),jsonb_build_object('status','completed'));
  end if;
 else
  -- A slot booking needs its current booking context, or its samples cannot be recorded against
  -- the booking. The nurse is told to check the booking instead of completing silently (review F1).
  b:=public._patient_visit_booking(m,sid);
  if b->>'availability'is distinct from 'available'then return jsonb_build_object('status','booking-stale');end if;
  booking:=jsonb_build_object('appointmentId',sid,'acceptedRevision',(b#>>'{context,acceptedRevision}')::numeric);
 end if;
 -- 2. The visit record, through the existing nurse visit command.
 res:=public.patient_staff_visit_command(jsonb_build_object('version','visit-evidence-v1','op','open-visit','id',m,'visitId',vid,'submissionId',oid,
  'revision',(select revision from public.patient_clinical_cases where user_id=m),'booking',coalesce(booking,'null'::jsonb)));
 if res->>'status'is distinct from 'saved'then raise exception using errcode='40001',message='Nurse visit open was not saved';end if;
 select x.* into bp from public.nurse_visit_marks x where x.source=src and x.source_id=sid and x.item='measure:bp'and x.arrangement=(v->>'startsAt')::timestamptz order by x.recorded_at desc,x.id desc limit 1;
 if bp.done then
  entries:=entries||jsonb_build_array(
   jsonb_build_object('kind','observation','field','systolic','observedAt',public._nurse_visit_iso(bp.recorded_at),'state','known','value',(bp.vals->>'systolic')::int,'unit','mmHg'),
   jsonb_build_object('kind','observation','field','diastolic','observedAt',public._nurse_visit_iso(bp.recorded_at),'state','known','value',(bp.vals->>'diastolic')::int,'unit','mmHg'))
   ||case when bp.vals->'pulse'<>'null'::jsonb then jsonb_build_array(jsonb_build_object('kind','observation','field','pulse','observedAt',public._nurse_visit_iso(bp.recorded_at),
    'state','known','value',(bp.vals->>'pulse')::int,'unit','beats/min'))else '[]'::jsonb end;
 end if;
 for k in select distinct on(x.item)x.* from public.nurse_visit_marks x where x.source=src and x.source_id=sid and x.item in('measure:weight','measure:waist')and x.arrangement=(v->>'startsAt')::timestamptz order by x.item,x.recorded_at desc,x.id desc loop
  if k.done then entries:=entries||jsonb_build_array(jsonb_build_object('kind','observation','field',substr(k.item,9),'observedAt',public._nurse_visit_iso(k.recorded_at),
   'state','known','value',(k.vals->'value'),'unit',case when k.item='measure:weight'then 'kg'else 'cm'end));end if;
 end loop;
 if booking is not null then
  for i in select x from jsonb_array_elements(items)x where x->>'kind'='sample'
   and exists(select 1 from jsonb_array_elements(b#>'{context,tests}')t where t->>'id'=x->>'testId')loop
   entries:=entries||jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('kind','collection','observedAt',coalesce(public._nurse_visit_iso((i#>>'{mark,recordedAt}')::timestamptz),stamp),
    'appointmentId',sid,'acceptedRevision',booking->'acceptedRevision','testId',i->>'testId',
    'outcome',case when i#>>'{mark,done}'='true'then 'collected'when i->'mark'is not null and i->'mark'<>'null'::jsonb then 'not-collected'else 'unknown'end,
    'reason',case when i#>>'{mark,done}'='true'then null else coalesce(i#>>'{mark,note}',reason)end)));
  end loop;
 end if;
 if reason is not null then entries:=entries||jsonb_build_array(jsonb_build_object('kind','note','observedAt',stamp,'text',reason));end if;
 if jsonb_array_length(entries)>0 then
  res:=public.patient_staff_visit_command(jsonb_build_object('version','visit-evidence-v1','op','append-evidence','id',m,'visitId',vid,'submissionId',aid,
   'revision',(select revision from public.patient_clinical_cases where user_id=m),'entries',entries));
  if res->>'status'is distinct from 'saved'then raise exception using errcode='40001',message='Nurse visit evidence was not saved';end if;
 end if;
 -- 3. The completion, which also counts a slot booking as attended (_booking_visit_attended).
 result:=jsonb_build_object('status','saved','submissionId',sub,'visitId',vid,'summary',counts,'replayed',false);
 insert into public.nurse_visit_completions(member_id,source,source_id,visit_id,submission_id,command,reason,summary,result,actor_id,actor_name)
  values(m,src,sid,vid,sub,canonical,reason,counts,result,s.user_id,s.display_name);
 -- 4. The timeline: samples collected (if taken and not tapped), completed; samples already handed
 -- to the lab get their lab stages now that the collection entries exist.
 if(counts->>'samplesTaken')::int>0 and not public._nurse_visit_has_step(src,sid,'samples-collected')then
  perform public._nurse_visit_record_step(m,src,sid,'samples-collected',gen_random_uuid(),s);
 end if;
 perform public._nurse_visit_record_step(m,src,sid,'completed',sub,s);
 if public._nurse_visit_has_step(src,sid,'samples-at-lab')then
  perform public._nurse_visit_sync_lab(m,vid,(select max(occurred_at)from public.nurse_visit_events where source=src and source_id=sid and step='samples-at-lab'));
 end if;
 return result;
exception when insufficient_privilege then return jsonb_build_object('status','access');
 when lock_not_available or query_canceled or deadlock_detected or serialization_failure then return jsonb_build_object('status','unavailable');
end$$;

-- B1-3. Same as 20261017204237 plus the requirements check.
create or replace function public.booking_portal_proposal_answer(p_command uuid,p_member uuid,p_actor uuid,p_proposal uuid,p_accept boolean)returns jsonb
language plpgsql security definer set search_path=''as $$
declare prior public.booking_appointment_commands;canonical jsonb;pr public.clinic_booking_proposals;a public.booking_appointments;n public.booking_scheduling_notices;
 pool public.booking_manual_capacity;o public.booking_offer_snapshots;seal public.booking_program_seals;clinic public.workspace_clinics;projected jsonb;details jsonb;rev bigint;result jsonb;
begin
 perform public._booking_assert_actor(p_member,p_actor);
 if p_actor<>p_member then raise insufficient_privilege using message='The member answers a clinic proposal';end if;
 if p_command is null or p_proposal is null or p_accept is null then raise invalid_parameter_value using message='Proposal answer required';end if;
 canonical:=jsonb_build_object('proposalAnswer',true,'proposalId',p_proposal,'accept',p_accept);
 perform pg_advisory_xact_lock(hashtextextended('booking-command:'||p_command::text,0));
 select * into prior from public.booking_appointment_commands where id=p_command;
 if found then
  if prior.member_id<>p_member or prior.actor_id<>p_actor or prior.input<>canonical then raise invalid_parameter_value using message='Command identity already used';end if;
  return prior.result;
 end if;
 perform public.lock_patient_clinical_sources(p_member);
 perform pg_advisory_xact_lock(hashtextextended('booking-member:'||p_member::text,0));
 perform 1 from public.patient_clinical_cases where user_id=p_member for update nowait;
 select * into pr from public.clinic_booking_proposals where id=p_proposal for update;
 if not found then raise insufficient_privilege using message='Proposal unavailable';end if;
 select * into a from public.booking_appointments where id=pr.appointment_id for update nowait;
 if a.member_id<>p_member then raise insufficient_privilege using message='Proposal unavailable';end if;
 if pr.state<>'open'or a.revision<>pr.appointment_revision then raise serialization_failure using message='The proposal changed';end if;
 if not p_accept then
  update public.clinic_booking_proposals set state='rejected',decided_at=clock_timestamp(),decided_by=p_actor where id=pr.id;
  perform public._clinic_schedule_audit(pr.clinic_id,p_actor,'booking-proposal-rejected',jsonb_build_object('appointmentId',a.id,'proposalId',pr.id));
 else
  -- QA F-03 (review F1): a proposal never moves a visit the clinic has recorded as attended.
  if public._booking_visit_attended(a.current_reservation_id)then raise serialization_failure using message='The clinic has recorded this visit';end if;
  if not public._clinic_scheduling_enabled()then raise insufficient_privilege using message='Clinic scheduling is off';end if;
  select * into n from public.booking_scheduling_notices where id=a.notice_id;
  select * into pool from public.booking_manual_capacity where key=pr.capacity_key for update nowait;
  if pool.starts_at<=clock_timestamp()or pool.valid_until<=clock_timestamp()then raise serialization_failure using message='Offer validity changed';end if;
  if(select count(distinct r.appointment_id)from public.booking_manual_reservations r where r.capacity_key=pool.key and r.state='held'and r.appointment_id<>a.id)>=pool.capacity then
   raise serialization_failure using message='Offer capacity changed';end if;
  select * into o from public.booking_offer_snapshots where capacity_key=pool.key and superseded_at is null order by created_at desc limit 1;
  select * into seal from public.booking_program_seals where id=a.program_id;
  -- B1-3: the sources are locked above; a proposal is accepted only on the current requirements, the
  -- same check the visit applies (_patient_visit_booking). A stale program is booked again.
  if seal.requirements_token is distinct from public.patient_test_context(p_member)->>'requirementsToken'then
   raise serialization_failure using message='Booking program changed';end if;
  if o.id is null or not public._booking_offer_coverage(seal.program,o.offer)then raise invalid_parameter_value using message='Complete program coverage and follow-up required';end if;
  select * into clinic from public.workspace_clinics where id=pool.clinic_id and active for share;
  if not found or nullif(btrim(clinic.address),'')is null or o.offer->>'clinicAddress'is distinct from clinic.address then raise serialization_failure using message='Use the current trusted clinic address';end if;
  projected:=public._booking_offer_project(seal.program,o.offer);
  details:=jsonb_build_object('offerId',o.id,'offerVersion',o.version,'clinicId',clinic.id,'mode','clinic','startsAt',o.offer->>'startsAt','endsAt',o.offer->>'endsAt',
   'timezone','Asia/Yerevan','location',clinic.address,'preparation',o.offer->>'preparation','preparationVersion',o.offer->>'preparationVersion',
   'coveredTestIds',projected->'coveredTestIds','followUps',projected->'followUps');
  -- A request still waiting for the clinic is replaced by the accepted proposal.
  if n.state='pending'then update public.booking_scheduling_notices set state='superseded'where id=n.id;end if;
  rev:=a.revision+1;
  insert into public.booking_manual_reservations(id,appointment_id,capacity_key,offer_id,offer_version,member_id,valid_until)values(p_command,a.id,pool.key,o.id,o.version,p_member,pool.valid_until);
  update public.booking_appointments set revision=rev,status='confirmed',proposed_arrangement=details,proposed_reservation_id=p_command,notice_id=p_command,
   current_arrangement=details,current_reservation_id=p_command,legacy_current=null,
   current_program=(select jsonb_agg(i-'source')from jsonb_array_elements(seal.program->'items')i)where id=a.id;
  update public.booking_manual_reservations set state='released'where appointment_id=a.id and state='held'and id<>p_command;
  insert into public.booking_scheduling_notices(id,appointment_id,appointment_revision,program_id,reservation_id,clinic_id,clinic_revision,channel,purpose,state)
   values(p_command,a.id,rev,seal.id,p_command,clinic.id,clinic.scheduling_revision,'portal',case when a.current_arrangement is not null then 'change'else 'booking'end,'accepted');
  insert into public.booking_appointment_versions(appointment_id,revision,program_id,previous_arrangement,proposed_arrangement,notice_id,actor_id,agreement_source,previous_program)
   values(a.id,rev,seal.id,a.current_arrangement,details,p_command,p_actor,'Member accepted clinic proposal '||pr.id::text,a.current_program);
  insert into public.booking_appointment_events(appointment_id,revision,kind,notice_id)values(a.id,rev,'clinic-proposal-accepted',p_command);
  update public.clinic_booking_proposals set state='accepted',decided_at=clock_timestamp(),decided_by=p_actor where id=pr.id;
  perform public._clinic_schedule_audit(pr.clinic_id,p_actor,'booking-proposal-accepted',jsonb_build_object('appointmentId',a.id,'proposalId',pr.id,'revision',rev));
 end if;
 select * into a from public.booking_appointments where id=a.id;result:=public._booking_appointment_dto(a);
 insert into public.booking_appointment_commands(id,member_id,actor_id,input,result)values(p_command,p_member,p_actor,canonical,result);
 return result;
end$$;

-- B2-2. A plan saved from an AI draft keeps the lab token it was checked against. Publication refuses it
-- once a lab value or its review changed (correction, rejection, a new value), until the doctor saves the
-- plan again. Any other save of the draft clears the token: the doctor's own save is the review.
alter table public.patient_clinical_cases add column draft_lab_token text;
create function public._clinical_draft_lab_token_clear()returns trigger language plpgsql set search_path=''as $$
begin new.draft_lab_token:=null;return new;end$$;
revoke all on function public._clinical_draft_lab_token_clear()from public,anon,authenticated,service_role;
create trigger clinical_draft_lab_token_clear before update of draft,draft_saved_at on public.patient_clinical_cases
 for each row when(new.draft is distinct from old.draft or new.draft_saved_at is distinct from old.draft_saved_at)execute function public._clinical_draft_lab_token_clear();

-- Same as 20261018170300 plus keeping the lab token.
create or replace function public.save_patient_clinical_draft_from_ai(p_user_id uuid,p_expected_revision bigint,p_evidence_token text,p_draft jsonb,p_generation uuid)returns bigint
language plpgsql security definer set search_path=''as $$
declare g public.ai_plan_generations;r bigint;
begin
 perform public._assigned_active_doctor(p_user_id);
 perform 1 from public.patient_clinical_cases where user_id=p_user_id for update;
 perform 1 from public.clinic_result_attachments where user_id=p_user_id for update;
 perform 1 from public.lab_ai_values where user_id=p_user_id for share;
 select * into g from public.ai_plan_generations where id=p_generation and user_id=p_user_id;
 if not found or g.state<>'ready'or not public._ai_plan_enabled()or g.evidence_token is distinct from p_evidence_token
  or g.lab_token is distinct from public._ai_plan_lab_token(p_user_id)then
  raise exception using errcode='40001',message='AI draft evidence changed';
 end if;
 r:=public.save_patient_clinical_draft(p_user_id,p_expected_revision,p_evidence_token,p_draft);
 update public.patient_clinical_cases set draft_lab_token=g.lab_token where user_id=p_user_id;
 return r;
end$$;

-- Checked where every publication is written, under the same lock order as the AI save.
create function public._clinical_publication_lab_check()returns trigger language plpgsql security definer set search_path=''as $$
declare t text;
begin
 select draft_lab_token into t from public.patient_clinical_cases where user_id=new.user_id;
 if t is null then return new;end if;
 perform 1 from public.clinic_result_attachments where user_id=new.user_id for update;
 perform 1 from public.lab_ai_values where user_id=new.user_id for share;
 if t is distinct from public._ai_plan_lab_token(new.user_id)then
  raise exception using errcode='40001',message='Lab values changed since the AI-prepared plan was saved';end if;
 return new;
end$$;
revoke all on function public._clinical_publication_lab_check()from public,anon,authenticated,service_role;
create trigger clinical_publication_lab_check before insert on public.patient_clinical_publications for each row execute function public._clinical_publication_lab_check();


-- B2-3. Same as 20261019045232 plus the assessment revision the text was prepared from.
create or replace function public.doctor_first_note_approve(p_command jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare d uuid;m uuid;sub uuid;a public.patient_assessments;prior public.member_first_notes;en text;hy text;src text[];
begin
 perform set_config('lock_timeout','1500ms',true);
 if jsonb_typeof(p_command)is distinct from 'object'or p_command-array['version','memberId','submissionId','textEn','textHy','builderVersion','sources','edited','assessmentRevision']<>'{}'
  or not(p_command?&array['version','memberId','submissionId','textEn','textHy','builderVersion','sources','edited','assessmentRevision'])or p_command->>'version'is distinct from 'first-note-v1'
  or jsonb_typeof(p_command->'edited')<>'boolean'or jsonb_typeof(p_command->'assessmentRevision')<>'number'or jsonb_typeof(p_command->'sources')<>'array'or jsonb_array_length(p_command->'sources')>20
  or exists(select 1 from jsonb_array_elements(p_command->'sources')x where jsonb_typeof(x)<>'string'or x#>>'{}'!~'^[A-Za-z0-9_.:-]{1,40}$')
  or coalesce(p_command->>'builderVersion','')!~'^[a-z0-9.-]{1,40}$'then return jsonb_build_object('status','invalid');end if;
 begin m:=(p_command->>'memberId')::uuid;sub:=(p_command->>'submissionId')::uuid;exception when invalid_text_representation then return jsonb_build_object('status','invalid');end;
 -- Control and direction characters out, spaces collapsed within lines.
 en:=btrim(regexp_replace(regexp_replace(coalesce(p_command->>'textEn',''),'[\u0000-\u0009\u000b-\u001f\u007f​-‏‪-‮⁦-⁩]',' ','g'),'[ ]+',' ','g'));
 hy:=btrim(regexp_replace(regexp_replace(coalesce(p_command->>'textHy',''),'[\u0000-\u0009\u000b-\u001f\u007f​-‏‪-‮⁦-⁩]',' ','g'),'[ ]+',' ','g'));
 if length(en)not between 1 and 1500 or length(hy)not between 1 and 2000 then return jsonb_build_object('status','invalid');end if;
 select array_agg(x)into src from jsonb_array_elements_text(p_command->'sources')x;
 -- Lock the case first, then check the assignment and the doctor against what is committed now, and hold the
 -- doctor's staff and clinic rows until the insert, so a reassignment or deactivation cannot slip in between (Astra FN-02).
 perform 1 from public.patient_clinical_cases where user_id=m for update;
 perform 1 from public.workspace_staff where user_id=auth.uid()for share;
 perform 1 from public.workspace_clinics k where k.id=(select clinic_id from public.workspace_staff where user_id=auth.uid())for share;
 d:=public._first_note_doctor(m);
 if not public._first_note_enabled()then return jsonb_build_object('status','disabled');end if;
 select * into prior from public.member_first_notes where submission_id=sub;
 if found then return case when prior.user_id=m and prior.doctor_id=d then jsonb_build_object('status','approved','replayed',true)else jsonb_build_object('status','stale')end;end if;
 if exists(select 1 from public.member_first_notes where user_id=m)then return jsonb_build_object('status','already');end if;
 select * into a from public.patient_assessments where user_id=m for share;
 -- B2-3: the text was prepared from one revision of the answers; changed answers need a fresh text.
 if a.revision is distinct from(p_command->>'assessmentRevision')::numeric then return jsonb_build_object('status','stale');end if;
 if a.completed_at is null then return jsonb_build_object('status','not-ready');end if;
 if a.urgent_rule is not null then return jsonb_build_object('status','urgent');end if;
 if exists(select 1 from public.patient_care_plans p where p.user_id=m and p.active)then return jsonb_build_object('status','plan-active');end if;
 insert into public.member_first_notes(user_id,doctor_id,submission_id,text_en,text_hy,builder_version,sources,edited,assessment_completed_at)
  values(m,d,sub,en,hy,p_command->>'builderVersion',coalesce(src,'{}'),(p_command->>'edited')::boolean,a.completed_at);
 return jsonb_build_object('status','approved','replayed',false);
exception when lock_not_available then return jsonb_build_object('status','unavailable');
end$$;

-- B2-1. Same as 20261017203625 except which medicines count as current.
create or replace function public._gp_report_source_body(p_member uuid)returns jsonb language sql stable security definer set search_path=''as $$
 select jsonb_build_object(
 'profile',(select jsonb_build_object('name',p.display_name,'birthDate',p.birth_date,'biologicalSex',p.biological_sex)from public.profiles p where p.id=p_member),
 'assessment',(select jsonb_build_object('answers',a.answers,'assessmentDate',a.assessment_date,'algorithmVersion',a.algorithm_version,'completedAt',a.completed_at,'urgentRule',a.urgent_rule,'updatedAt',a.updated_at)
  from public.patient_assessments a where a.user_id=p_member),
 'homeReadings',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'systolic',m.systolic,'diastolic',m.diastolic,'pulse',m.pulse,'measuredAt',m.measured_at,'recordedAt',m.created_at)order by m.measured_at,m.id)
  from public.patient_measurements m where m.user_id=p_member
  and not exists(select 1 from public.patient_care_visit_entries e where e.measurement_id=m.id)),'[]'),
 'deviceReadings',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'systolic',r.systolic,'diastolic',r.diastolic,'pulse',r.pulse,'measuredAt',r.measured_at,'receivedAt',r.received_at,'transport',r.transport)order by r.measured_at,r.id)
  from public.bp_device_readings r where r.member_id=p_member and r.state='attached'),'[]'),
 'visitObservations',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'visitId',e.visit_id,'field',e.payload->>'field','state',e.payload->>'state','value',e.payload->'value','unit',e.payload->>'unit',
   'observedAt',e.observed_instant,'recordedAt',e.recorded_at,'actorName',e.actor_name,'clinic',k.name)order by e.observed_instant,e.position,e.id)
  from public.patient_care_visit_entries e left join public.workspace_clinics k on k.id=e.clinic_id
  where e.user_id=p_member and e.payload->>'kind'='observation'),'[]'),
 'labResults',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'marker',r.marker,'value',r.value,'unit',r.unit,'referenceLow',r.reference_low,'referenceHigh',r.reference_high,'referenceText',r.reference_text,
   'collectedAt',r.collected_at,'receivedAt',r.received_at,'source',r.source,'sourceLabel',r.source_label,'reviewedAt',r.reviewed_at,'reviewedBy',r.reviewed_by,'sourceReportId',r.source_report_id)order by r.collected_at,r.id)
  from public.patient_care_results r where r.user_id=p_member),'[]'),
 -- Clinic lab PDF values read by AI (#225). A value enters the report only after the assigned
 -- doctor confirmed or corrected it; an unchecked value is listed by test name only, with no value.
 -- Rejected values and files that are detached, moved to another member or replaced are left out.
 'clinicLabValues',coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'fileId',v.file_id,
   'status',case when v.status in('verified','corrected')and v.reviewed_by is not null then v.status else 'unverified'end,
   'testName',v.test_name,'catalogueRef',v.catalogue_ref,
   'value',case when v.status='corrected'then v.corrected_value when v.status='verified'then v.value end,
   'valueText',case when v.status='verified'then v.value_text end,
   'unit',case when v.status='corrected'then coalesce(v.corrected_unit,v.unit)when v.status='verified'then v.unit end,
   -- The sheet's reference range is shown only when the value kept the sheet's unit.
   'referenceLow',case when v.status='verified'or(v.status='corrected'and v.corrected_unit is not distinct from v.unit)then v.ref_low end,
   'referenceHigh',case when v.status='verified'or(v.status='corrected'and v.corrected_unit is not distinct from v.unit)then v.ref_high end,
   'referenceText',case when v.status='verified'or(v.status='corrected'and v.corrected_unit is not distinct from v.unit)then v.ref_text end,
   'collectedOn',v.collected_on,'attachedAt',a.created_at,'clinic',k.name,
   'reviewedAt',case when v.status in('verified','corrected')then v.reviewed_at end,
   'reviewedBy',case when v.status in('verified','corrected')then(select s.display_name from public.workspace_staff s where s.user_id=v.reviewed_by)end)
   order by a.created_at,v.file_id,v.seq)
  from public.lab_ai_values v join public.clinic_result_attachments a on a.id=v.attachment_id and a.user_id=v.user_id
  left join public.workspace_clinics k on k.id=a.clinic_id
  where v.user_id=p_member and v.status<>'rejected'and public._lab_ai_current(v.attachment_id)),'[]'),
 'sourceReports',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'state',r.state,'uploadedAt',r.created_at,'confirmedAt',r.confirmed_at,'reportDate',r.reviewed->>'reportDate','laboratory',r.reviewed->>'laboratory')order by r.created_at,r.id)
  from public.patient_reports r where r.user_id=p_member and r.deleted_at is null and r.state<>'deleted'),'[]'),
 'clinicDocuments',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'attachedAt',t.created_at,'clinic',k.name)order by t.created_at,t.id)
  from public.clinic_result_attachments t left join public.workspace_clinics k on k.id=t.clinic_id
  where t.user_id=p_member
  and not exists(select 1 from public.clinic_result_detachments d where d.attachment_id=t.id)
  and not exists(select 1 from public.clinic_result_attachments n where n.previous_id=t.id)),'[]'),
 'tests',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'title',t.title,'status',t.status,'orderedAt',t.ordered_at,'dueAt',t.due_at,'source',t.source)order by t.ordered_at,t.id)
  from public.patient_care_tests t where t.user_id=p_member),'[]'),
 'plans',coalesce((select jsonb_agg(jsonb_build_object('planId',p.id,'version',v.version,'clinician',p.clinician,'publishedAt',p.published_at,'instructions',p.instructions,'active',p.active,'retiredAt',p.retired_at,'changeSummary',v.change_summary)order by p.published_at,p.id)
  from public.patient_care_plans p left join public.patient_care_plan_versions v on v.plan_id=p.id where p.user_id=p_member),'[]'),
 'medications',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'planId',m.plan_id,'name',m.name,'dose',m.dose,'instructions',m.instructions,'times',to_jsonb(m.times),'startDate',m.start_date,'endDate',m.end_date,
   -- B2-1: current means on today's plan (carry-overs included) and within its dates, the same rule as the medicines list.
   'active',exists(select 1 from public._member_plan_medicines(p_member,(clock_timestamp()at time zone 'Asia/Yerevan')::date)x where x.id=m.id),'effectiveAt',m.effective_at)order by m.start_date,m.id)
  from public.patient_care_medications m where m.user_id=p_member),'[]'),
 'alerts',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'source',a.source,'reasonCode',a.reason_code,'redFlags',to_jsonb(a.red_flags),'ruleId',a.rule_id,'ruleVersion',a.rule_version,'state',a.state,
   'createdAt',a.created_at,'lastSeenAt',a.last_seen_at,'acknowledgedAt',a.acknowledged_at,'resolvedAt',a.resolved_at,'resolution',a.resolution)order by a.created_at,a.id)
  from public.care_alerts a where a.member_id=p_member),'[]'),
 'consultation',(select jsonb_build_object('decision',c.review#>>'{consultation,decision}','completedAt',c.review#>>'{consultation,completedAt}',
   'arrangement',(select jsonb_build_object('holdSince',x.hold_since,'scheduledAt',x.scheduled_at,'channel',x.channel)from public.patient_consultation_arrangements x where x.user_id=p_member order by x.created_at desc,x.id limit 1))
  from public.patient_clinical_cases c where c.user_id=p_member)
 )
$$;
