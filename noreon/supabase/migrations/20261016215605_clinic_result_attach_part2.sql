-- Q8 part 2 (lead decisions 17 Oct 2026):
--  F3  a database switch guards every attach, detach and original-open path;
--  F2  an audited admin open of the clinic PDF, and an audited detach or move
--      that retracts system "results received" stages no other upload supports
--      (a new retraction row, never a delete);
--  the clinic admin attaches its own uploads to its own open visits, choosing
--  from a narrow list (member name and visit date only).

-- F3: off until operations turn it on for the environment.
alter table public.clinic_portal_capabilities add column result_attach_enabled boolean not null default false;
create function public._clinic_result_enabled()returns boolean language sql stable security definer set search_path=''as $$
 select coalesce((select result_attach_enabled from public.clinic_portal_capabilities where singleton),false)
$$;

-- Clinic admins may attach too.
alter table public.clinic_result_attachments drop constraint clinic_result_attachments_actor_kind_check;
alter table public.clinic_result_attachments add constraint clinic_result_attachments_actor_kind_check check(actor_kind in('noreon-admin','clinic-admin'));

-- A detachment ends an attachment. Append-only; the attachment row stays.
create table public.clinic_result_detachments(
 id uuid primary key default gen_random_uuid(),
 attachment_id uuid not null unique references public.clinic_result_attachments(id),
 actor_id uuid not null references auth.users(id),
 submission_id uuid not null unique,
 reason text not null check(length(btrim(reason))between 1 and 500),
 created_at timestamptz not null default clock_timestamp()
);
alter table public.clinic_result_detachments enable row level security;
revoke all on public.clinic_result_detachments from public,anon,authenticated,service_role;
create trigger clinic_result_detachments_immutable before update or delete on public.clinic_result_detachments
 for each row execute function public._patient_visit_immutable();

-- Retraction: a later row that withdraws one results-received row. A sample may
-- then receive results again, so results-received is no longer unique per
-- sample; "active" means not retracted. All writers serialise on the case row.
alter table public.patient_care_lab_stages drop constraint patient_care_lab_stages_collection_entry_id_stage_key;
create unique index patient_care_lab_stages_one_at_lab on public.patient_care_lab_stages(collection_entry_id)where stage='at-lab';
alter table public.patient_care_lab_stages add column retracts uuid unique references public.patient_care_lab_stages(id);
alter table public.patient_care_lab_stages drop constraint patient_care_lab_stages_stage_check;
alter table public.patient_care_lab_stages add constraint patient_care_lab_stages_stage_check check(stage in('at-lab','results-received','results-retracted'));
alter table public.patient_care_lab_stages add constraint patient_care_lab_stages_retracts_check check((stage='results-retracted')=(retracts is not null));
alter table public.patient_care_lab_stages drop constraint patient_care_lab_stages_actor_role_check;
alter table public.patient_care_lab_stages add constraint patient_care_lab_stages_actor_role_check check(
 (actor_role in('nurse','doctor')and actor_id is not null and attachment_id is null and stage in('at-lab','results-received'))
 or(actor_role='system'and actor_id is null and attachment_id is not null and stage in('results-received','results-retracted')));

create function public._patient_lab_active_result(p_entry uuid)returns public.patient_care_lab_stages
language sql stable security definer set search_path=''as $$
 select s.* from public.patient_care_lab_stages s where s.collection_entry_id=p_entry and s.stage='results-received'
  and not exists(select 1 from public.patient_care_lab_stages x where x.retracts=s.id)order by s.recorded_at desc,s.id desc limit 1
$$;

-- Reads show only effective stages: at-lab and the active results-received.
create or replace function public._patient_lab_samples(p_member uuid,p_staff boolean)returns jsonb
language sql stable security definer set search_path=''as $$
 select coalesce(jsonb_agg(jsonb_build_object(
  'entryId',e.id,'visitId',e.visit_id,'testId',e.payload->>'testId',
  'title',(select t->>'title' from jsonb_array_elements(v.booking_context->'tests')t where t->>'id'=e.payload->>'testId' limit 1),
  'collectedAt',e.observed_instant,
  'stages',coalesce((select jsonb_agg(jsonb_build_object('stage',s.stage,'occurredAt',s.occurred_at)
   ||case when p_staff then jsonb_build_object('id',s.id,'recordedAt',s.recorded_at,'actor',jsonb_build_object('name',s.actor_name,'role',s.actor_role))else '{}'::jsonb end
   order by case s.stage when 'at-lab' then 1 else 2 end)
   from public.patient_care_lab_stages s where s.collection_entry_id=e.id
    and(s.stage='at-lab'or s.id=(public._patient_lab_active_result(e.id)).id)),'[]'))
  order by e.observed_instant,e.id),'[]')
 from public.patient_care_visit_entries e join public.patient_care_visits v on v.id=e.visit_id and v.user_id=e.user_id
 where e.user_id=p_member and public._patient_lab_current_collection(e)
  and(p_staff or e.observed_instant>coalesce((select max(published_at)from public.patient_clinical_publications where user_id=p_member),'-infinity'::timestamptz))
$$;

-- Staff command: "already received" means an active result; replay compares
-- the actor with IS DISTINCT FROM (review F4). Otherwise unchanged from B8.
create or replace function public.patient_staff_lab_stage_command(p_command jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare m uuid;sub uuid;entry uuid;st text;occurred timestamptz;s public.workspace_staff;existing public.patient_care_lab_stages;
 collected timestamptz;atlab timestamptz;r bigint;sid uuid;
 bad constant jsonb:=jsonb_build_object('status','invalid','issues',jsonb_build_array(jsonb_build_object('path','','message','Check the lab stage details')));
begin
 perform set_config('lock_timeout','1500ms',true);
 if jsonb_typeof(p_command)is distinct from 'object'or p_command-array['version','id','submissionId','entryId','stage','occurredAt']<>'{}'
  or not(p_command?&array['version','id','submissionId','entryId','stage','occurredAt'])or p_command->>'version'is distinct from 'lab-stage-v1'
  or coalesce(p_command->>'stage','')not in('at-lab','results-received')or jsonb_typeof(p_command->'occurredAt')is distinct from 'string'
  or p_command->>'occurredAt'!~'^\d{4}-\d{2}-\d{2}T([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9](\.\d+)?)?(Z|[+-]\d{2}:\d{2})$'then return bad;end if;
 begin
  m:=(p_command->>'id')::uuid;sub:=(p_command->>'submissionId')::uuid;entry:=(p_command->>'entryId')::uuid;
  occurred:=public._patient_visit_instant(p_command->>'occurredAt');
 exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format then return bad;end;
 st:=p_command->>'stage';
 if not isfinite(occurred)or occurred>clock_timestamp()+interval '5 minutes'then return bad;end if;
 perform pg_advisory_xact_lock(hashtextextended('patient-lab-stage:'||m::text||':'||entry::text,0));
 -- p_exclusive=true takes the case row FOR UPDATE NOWAIT before any check below,
 -- so this command and every attach/detach/move serialise on the case row.
 s:=public._patient_visit_authorize(m,false,true);
 if st='at-lab'and s.role is distinct from 'nurse'then raise insufficient_privilege;end if;
 select * into existing from public.patient_care_lab_stages where user_id=m and submission_id=sub;
 if found then
  if existing.collection_entry_id<>entry or existing.stage<>st or existing.occurred_at<>occurred or existing.actor_id is distinct from s.user_id then return jsonb_build_object('status','stale');end if;
  return jsonb_build_object('status','saved','submissionId',sub,'stageId',existing.id,'revision',(select revision from public.patient_clinical_cases where user_id=m),'replayed',true);
 end if;
 select e.observed_instant into collected from public.patient_care_visit_entries e
  where e.id=entry and e.user_id=m and public._patient_lab_current_collection(e);
 if not found then return bad;end if;
 if(st='at-lab'and exists(select 1 from public.patient_care_lab_stages where collection_entry_id=entry and stage='at-lab'))
  or(st='results-received'and(public._patient_lab_active_result(entry)).id is not null)then return jsonb_build_object('status','stale');end if;
 if st='results-received'then
  select occurred_at into atlab from public.patient_care_lab_stages where collection_entry_id=entry and stage='at-lab';
  if not found or occurred<atlab then return bad;end if;
 elsif occurred<collected then return bad;
 end if;
 insert into public.patient_care_lab_stages(user_id,collection_entry_id,stage,submission_id,occurred_at,actor_id,actor_name,actor_role,clinic_id)
  values(m,entry,st,sub,occurred,s.user_id,s.display_name,s.role,s.clinic_id)returning id into sid;
 update public.patient_clinical_cases set revision=revision+1,updated_at=clock_timestamp()where user_id=m returning revision into r;
 insert into public.patient_clinical_case_events(user_id,revision,kind,actor_id,detail)
  values(m,r,'care-evidence',s.user_id,jsonb_build_object('labStageId',sid,'entryId',entry,'stage',st,'submissionId',sub));
 return jsonb_build_object('status','saved','submissionId',sub,'stageId',sid,'revision',r,'replayed',false);
exception when insufficient_privilege then return jsonb_build_object('status','access');
 when lock_not_available or query_canceled or deadlock_detected then return jsonb_build_object('status','unavailable');
 when unique_violation then return jsonb_build_object('status','stale');
end$$;

-- The current attachment is the latest one that is not detached.
-- Only the latest row can be current, so a superseded part-1 correction can
-- never come back after a later detach (review F3).
create or replace function public._clinic_result_current(p_file uuid)returns public.clinic_result_attachments
language sql stable security definer set search_path=''as $$
 select l.* from(select a.* from public.clinic_result_attachments a where a.file_id=p_file order by a.created_at desc,a.id desc limit 1)l
  where not exists(select 1 from public.clinic_result_detachments d where d.attachment_id=l.id)
$$;

-- Bounded (review F4): this clinic's visits from the last 180 days with at
-- least one sample at the lab awaiting results, newest first, at most 200.
create or replace function public._clinic_result_open_visits(p_clinic uuid)returns jsonb
language sql stable security definer set search_path=''as $$
 select coalesce(jsonb_agg(jsonb_build_object('visitId',o.id,'memberId',o.user_id,'memberName',o.display_name,'visitedAt',o.created_at,
  'atLab',o.at_lab,'collectedOnly',o.collected_only)order by o.created_at desc,o.id),'[]')
 from(select v.id,v.user_id,v.created_at,p.display_name,x.at_lab,x.collected_only
 from public.patient_care_visits v join public.profiles p on p.id=v.user_id
 cross join lateral(select
   count(*)filter(where exists(select 1 from public.patient_care_lab_stages s where s.collection_entry_id=e.id and s.stage='at-lab')
    and(public._patient_lab_active_result(e.id)).id is null)at_lab,
   count(*)filter(where not exists(select 1 from public.patient_care_lab_stages s where s.collection_entry_id=e.id and s.stage='at-lab'))collected_only,
   count(*)filter(where(public._patient_lab_active_result(e.id)).id is null)open_count
  from public.patient_care_visit_entries e where e.visit_id=v.id and e.user_id=v.user_id and public._patient_lab_current_collection(e))x
 where v.clinic_id=p_clinic and v.booking_context is not null and x.at_lab>0 and v.created_at>clock_timestamp()-interval '180 days'
 order by v.created_at desc,v.id limit 200)o
$$;

-- Move the visit's eligible samples to results received for attachment a.
-- Caller holds the case lock. Returns {moved,waiting,later,received,ids}.
create function public._clinic_result_apply(a public.clinic_result_attachments,f public.clinic_batch_files)returns jsonb
language plpgsql security definer set search_path=''as $$
declare e public.patient_care_visit_entries;atlab timestamptz;sid uuid;ids jsonb:='[]';moved int:=0;waiting int:=0;received int:=0;later int:=0;
begin
 for e in select x.* from public.patient_care_visit_entries x where x.visit_id=a.visit_id and x.user_id=a.user_id and public._patient_lab_current_collection(x)order by x.recorded_at,x.position loop
  if(public._patient_lab_active_result(e.id)).id is not null then received:=received+1;continue;end if;
  select occurred_at into atlab from public.patient_care_lab_stages s where s.collection_entry_id=e.id and s.stage='at-lab';
  if not found then waiting:=waiting+1;continue;end if;
  if atlab>f.created_at then later:=later+1;continue;end if;
  insert into public.patient_care_lab_stages(user_id,collection_entry_id,stage,submission_id,occurred_at,actor_id,actor_name,actor_role,clinic_id,attachment_id)
   values(a.user_id,e.id,'results-received',gen_random_uuid(),f.created_at,null,'Clinic upload','system',a.clinic_id,a.id)returning id into sid;
  ids:=ids||to_jsonb(sid);moved:=moved+1;
 end loop;
 return jsonb_build_object('moved',moved,'waiting',waiting,'later',later,'received',received,'ids',ids);
end$$;

-- Detach attachment a: system results it created are retracted unless another
-- current attachment for the same visit supports them, in which case they are
-- re-issued under that attachment so every active system stage keeps a live
-- source. Manual nurse/doctor results are never touched. Caller holds the case lock.
create function public._clinic_result_retract(a public.clinic_result_attachments,p_actor uuid,p_sub uuid,p_reason text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare s public.patient_care_lab_stages;b public.clinic_result_attachments;bf timestamptz;atlab timestamptz;sid uuid;ids jsonb:='[]';retracted int:=0;reissued int:=0;
begin
 insert into public.clinic_result_detachments(attachment_id,actor_id,submission_id,reason)values(a.id,p_actor,p_sub,btrim(p_reason));
 for s in select x.* from public.patient_care_lab_stages x where x.attachment_id=a.id and x.stage='results-received'
  and not exists(select 1 from public.patient_care_lab_stages y where y.retracts=x.id)loop
  insert into public.patient_care_lab_stages(user_id,collection_entry_id,stage,submission_id,occurred_at,actor_id,actor_name,actor_role,clinic_id,attachment_id,retracts)
   values(s.user_id,s.collection_entry_id,'results-retracted',gen_random_uuid(),clock_timestamp(),null,'Clinic upload','system',s.clinic_id,a.id,s.id)returning id into sid;
  ids:=ids||to_jsonb(sid);retracted:=retracted+1;
  select occurred_at into atlab from public.patient_care_lab_stages where collection_entry_id=s.collection_entry_id and stage='at-lab';
  b:=null;bf:=null;
  select c.* into b from public.clinic_result_attachments c join public.clinic_batch_files f on f.id=c.file_id
   where c.visit_id=a.visit_id and c.user_id=a.user_id and c.id<>a.id and f.state='stored'and f.created_at>=atlab
    and not exists(select 1 from public.clinic_result_detachments d where d.attachment_id=c.id)
    and c.id=(public._clinic_result_current(c.file_id)).id
   order by f.created_at,c.id limit 1;
  if b.id is not null then
   select created_at into bf from public.clinic_batch_files where id=b.file_id;
   insert into public.patient_care_lab_stages(user_id,collection_entry_id,stage,submission_id,occurred_at,actor_id,actor_name,actor_role,clinic_id,attachment_id)
    values(s.user_id,s.collection_entry_id,'results-received',gen_random_uuid(),bf,null,'Clinic upload','system',b.clinic_id,b.id)returning id into sid;
   ids:=ids||to_jsonb(sid);reissued:=reissued+1;
  end if;
 end loop;
 return jsonb_build_object('retracted',retracted-reissued,'kept',reissued,'ids',ids);
end$$;

-- Shared attach. p_kind is 'noreon-admin' or 'clinic-admin'; the caller has
-- authorised the actor and, for a clinic admin, the clinic.
create function public._clinic_result_attach(p_kind text,p_actor uuid,p_sub uuid,p_file uuid,p_member uuid,p_visit uuid,p_clinic_only uuid)returns jsonb
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
 select * into v from public.patient_care_visits where id=p_visit and user_id=p_member and clinic_id=clinic and booking_context is not null;
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

-- Noreon admin attach (replaces part 1; same contract plus 'disabled' and 'retracted').
create or replace function public.clinic_result_attach_command(p_command jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare a uuid;sub uuid;fid uuid;m uuid;vid uuid;
begin
 perform set_config('lock_timeout','1500ms',true);
 if jsonb_typeof(p_command)is distinct from 'object'or p_command-array['version','submissionId','fileId','memberId','visitId']<>'{}'
  or not(p_command?&array['version','submissionId','fileId','memberId','visitId'])or p_command->>'version'is distinct from 'clinic-result-attach-v1'then return jsonb_build_object('status','invalid');end if;
 begin sub:=(p_command->>'submissionId')::uuid;fid:=(p_command->>'fileId')::uuid;m:=(p_command->>'memberId')::uuid;vid:=(p_command->>'visitId')::uuid;
 exception when invalid_text_representation then return jsonb_build_object('status','invalid');end;
 a:=public._clinic_portal_admin();
 return public._clinic_result_attach('noreon-admin',a,sub,fid,m,vid,null);
exception when insufficient_privilege then return jsonb_build_object('status','access');
 when lock_not_available or query_canceled or deadlock_detected then return jsonb_build_object('status','unavailable');
 when unique_violation then return jsonb_build_object('status','stale');
end$$;

-- Noreon admin detach: {version:'clinic-result-detach-v1',submissionId,fileId,reason}.
create function public.clinic_result_detach_command(p_command jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare a uuid;sub uuid;fid uuid;reason text;cur public.clinic_result_attachments;f public.clinic_batch_files;undone jsonb;r bigint;
begin
 perform set_config('lock_timeout','1500ms',true);
 if jsonb_typeof(p_command)is distinct from 'object'or p_command-array['version','submissionId','fileId','reason']<>'{}'
  or not(p_command?&array['version','submissionId','fileId','reason'])or p_command->>'version'is distinct from 'clinic-result-detach-v1'
  or jsonb_typeof(p_command->'reason')is distinct from 'string'or length(btrim(p_command->>'reason'))not between 1 and 500 then return jsonb_build_object('status','invalid');end if;
 begin sub:=(p_command->>'submissionId')::uuid;fid:=(p_command->>'fileId')::uuid;reason:=p_command->>'reason';
 exception when invalid_text_representation then return jsonb_build_object('status','invalid');end;
 a:=public._clinic_portal_admin();
 if not public._clinic_result_enabled()then return jsonb_build_object('status','disabled');end if;
 perform pg_advisory_xact_lock(hashtextextended('clinic-result-attach:'||fid::text,0));
 if exists(select 1 from public.clinic_result_detachments d join public.clinic_result_attachments x on x.id=d.attachment_id where d.submission_id=sub)then
  if exists(select 1 from public.clinic_result_detachments d join public.clinic_result_attachments x on x.id=d.attachment_id where d.submission_id=sub and x.file_id=fid and d.actor_id=a)
   then return jsonb_build_object('status','saved','replayed',true,'retracted',0);end if;
  return jsonb_build_object('status','stale');
 end if;
 select * into f from public.clinic_batch_files where id=fid;
 cur:=public._clinic_result_current(fid);if cur.id is null then return jsonb_build_object('status','stale');end if;
 perform 1 from public.patient_clinical_cases where user_id=cur.user_id for update nowait;
 undone:=public._clinic_result_retract(cur,a,sub,reason);
 insert into public.clinic_portal_audit(clinic_id,batch_id,actor_id,kind,detail)values(cur.clinic_id,f.batch_id,a,'result-detached',
  jsonb_build_object('attachmentId',cur.id,'fileId',fid,'memberId',cur.user_id,'visitId',cur.visit_id,'reason',btrim(reason),'undone',undone));
 if jsonb_array_length(undone->'ids')>0 then
  update public.patient_clinical_cases set revision=revision+1,updated_at=clock_timestamp()where user_id=cur.user_id returning revision into r;
  insert into public.patient_clinical_case_events(user_id,revision,kind,actor_id,detail)
   values(cur.user_id,r,'care-evidence',a,jsonb_build_object('actor','system','detachedAttachmentId',cur.id,'labStageIds',undone->'ids','requestedBy',a));
 end if;
 return jsonb_build_object('status','saved','replayed',false,'retracted',(undone->>'retracted')::int);
exception when insufficient_privilege then return jsonb_build_object('status','access');
 when lock_not_available or query_canceled or deadlock_detected then return jsonb_build_object('status','unavailable');
 when unique_violation then return jsonb_build_object('status','stale');
end$$;

-- Audited admin open of a clinic original (F2). Returns the storage location to
-- the server route only; every call is logged before anything is returned.
create function public.clinic_admin_original_open(p_file uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare a uuid;f public.clinic_batch_files;clinic uuid;
begin
 perform set_config('lock_timeout','1500ms',true);
 a:=public._clinic_portal_admin();
 if not public._clinic_result_enabled()then raise insufficient_privilege;end if;
 select * into f from public.clinic_batch_files where id=p_file and state='stored';if not found then raise insufficient_privilege;end if;
 select clinic_id into clinic from public.clinic_batches where id=f.batch_id;
 perform 1 from storage.objects where id=f.object_id and bucket_id='clinic-originals'and name=f.object_key and(metadata->>'size')::bigint=f.measured_size;
 if not found then raise insufficient_privilege;end if;
 insert into public.clinic_portal_audit(clinic_id,batch_id,actor_id,kind,detail)values(clinic,f.batch_id,a,'admin-original-opened',
  jsonb_build_object('fileId',f.id,'sessionId',auth.jwt()->>'session_id'));
 return jsonb_build_object('fileId',f.id,'bucket','clinic-originals','objectKey',f.object_key,'sha256',f.sha256,'sizeBytes',f.measured_size);
end$$;

-- Clinic admin: the narrow list of its own open visits (name and visit date only).
create function public.clinic_portal_result_visits(p_clinic uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
begin
 perform set_config('lock_timeout','1500ms',true);
 perform public._clinic_portal_user(p_clinic);
 if not public._clinic_result_enabled()then return jsonb_build_object('version','clinic-result-visits-v1','enabled',false,'visits','[]'::jsonb);end if;
 return jsonb_build_object('version','clinic-result-visits-v1','enabled',true,'visits',coalesce((select jsonb_agg(jsonb_build_object('visitId',x->>'visitId','memberName',x->>'memberName','visitedAt',x->>'visitedAt'))
  from jsonb_array_elements(public._clinic_result_open_visits(p_clinic))x),'[]'));
end$$;

-- Clinic admin attach: {version:'clinic-result-attach-v1',submissionId,fileId,visitId}.
create function public.clinic_portal_result_attach(p_clinic uuid,p_command jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare m public.clinic_portal_memberships;sub uuid;fid uuid;vid uuid;member uuid;res jsonb;
begin
 perform set_config('lock_timeout','1500ms',true);
 if jsonb_typeof(p_command)is distinct from 'object'or p_command-array['version','submissionId','fileId','visitId']<>'{}'
  or not(p_command?&array['version','submissionId','fileId','visitId'])or p_command->>'version'is distinct from 'clinic-result-attach-v1'then return jsonb_build_object('status','invalid');end if;
 begin sub:=(p_command->>'submissionId')::uuid;fid:=(p_command->>'fileId')::uuid;vid:=(p_command->>'visitId')::uuid;
 exception when invalid_text_representation then return jsonb_build_object('status','invalid');end;
 m:=public._clinic_portal_user(p_clinic);
 -- Only this clinic's open visits may be chosen.
 if not exists(select 1 from jsonb_array_elements(public._clinic_result_open_visits(p_clinic))x where x->>'visitId'=vid::text)then
  if exists(select 1 from public.clinic_result_attachments where submission_id=sub and visit_id=vid and actor_id=m.user_id)then null;
  else return jsonb_build_object('status','invalid');end if;
 end if;
 select user_id into member from public.patient_care_visits where id=vid;
 res:=public._clinic_result_attach('clinic-admin',m.user_id,sub,fid,member,vid,p_clinic);
 -- The clinic sees counts only, never member identifiers.
 return res-'attachmentId';
exception when insufficient_privilege then return jsonb_build_object('status','access');
 when lock_not_available or query_canceled or deadlock_detected then return jsonb_build_object('status','unavailable');
 when unique_violation then return jsonb_build_object('status','stale');
end$$;

-- Admin page: unchanged shape; it now refuses while the switch is off.
create or replace function public.clinic_result_attach_page(p_clinic uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare c public.workspace_clinics;
begin
 perform set_config('lock_timeout','1500ms',true);
 perform public._clinic_portal_admin();
 if not public._clinic_result_enabled()then raise insufficient_privilege;end if;
 select * into c from public.workspace_clinics where id=p_clinic;if not found then raise insufficient_privilege;end if;
 return jsonb_build_object('version','clinic-result-attach-v1','clinic',jsonb_build_object('id',c.id,'name',c.name),
  'files',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'name',f.name,'batchName',b.name,'uploadedAt',f.created_at,
    'attachment',(select case when a.id is null then null else jsonb_build_object('id',a.id,'memberId',a.user_id,'memberName',pr.display_name,'visitId',a.visit_id,'visitedAt',v.created_at,'attachedAt',a.created_at)end
      from public._clinic_result_current(f.id)a left join public.profiles pr on pr.id=a.user_id left join public.patient_care_visits v on v.id=a.visit_id))
    order by f.created_at desc,f.id)
   from(select f.* from public.clinic_batch_files f join public.clinic_batches b on b.id=f.batch_id where b.clinic_id=p_clinic and f.state='stored'order by f.created_at desc,f.id limit 100)f
   join public.clinic_batches b on b.id=f.batch_id),'[]'),
  'visits',public._clinic_result_open_visits(p_clinic));
end$$;

-- Clinic file status: associated while a current attachment exists; a file
-- Noreon detached reads "needs association review" and the clinic cannot re-link it (review F2).
create or replace function public._clinic_portal_file_json(f public.clinic_batch_files)returns jsonb language sql stable set search_path=''as $$select jsonb_build_object(
 'id',f.id,'logicalKey',f.logical_key,'name',f.name,'mime',f.mime,'declaredSizeBytes',f.declared_size,'sizeBytes',f.measured_size,'checksum',f.sha256,'revision',f.revision,'createdAt',f.created_at,
 'upload',jsonb_build_object('status',case when f.state='retired'then'rejected'else f.state end,'attemptId',f.attempt_id,'possibleDuplicate',false,'cleanup',f.cleanup),
 'processing',jsonb_build_object('status',case when f.state='stored'then'unavailable'else'not_started'end,'sequence',0,'segments',0,'unresolvedRegions',0),
 'association',case when f.state='stored'and(public._clinic_result_current(f.id)).id is not null
   then jsonb_build_object('status','associated','associatedCount',1,'unmatchedCount',0)
   when f.state='stored'and exists(select 1 from public.clinic_result_attachments a where a.file_id=f.id)
   then jsonb_build_object('status','review_required','associatedCount',0,'unmatchedCount',0)
   else jsonb_build_object('status','not_started','associatedCount',0,'unmatchedCount',0)end,
 'correction',jsonb_build_object('pendingCount',0),'release',jsonb_build_object('hiddenCount',0,'releasedCount',0))$$;

revoke all on function public._clinic_result_enabled(),public._patient_lab_active_result(uuid),
 public._clinic_result_apply(public.clinic_result_attachments,public.clinic_batch_files),
 public._clinic_result_retract(public.clinic_result_attachments,uuid,uuid,text),
 public._clinic_result_attach(text,uuid,uuid,uuid,uuid,uuid,uuid),
 public.clinic_result_detach_command(jsonb),public.clinic_admin_original_open(uuid),
 public.clinic_portal_result_visits(uuid),public.clinic_portal_result_attach(uuid,jsonb)from public,anon,authenticated,service_role;
grant execute on function public.clinic_result_detach_command(jsonb),public.clinic_admin_original_open(uuid),
 public.clinic_portal_result_visits(uuid),public.clinic_portal_result_attach(uuid,jsonb)to authenticated;
