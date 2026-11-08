-- Required clinic and home tests get an evidence path, so a plan with them can be published (phone test finding 2,
-- lead decision 30 Oct 23:42, plus the lead's additions the same night).
--
-- Publication has always refused every required test that is not a laboratory test, on purpose: a test nobody can
-- evidence must not pass silently. That gate stays. It now lets through only these tests, each with a current
-- confirmation by the assigned doctor, and refuses everything else as before:
--  * ecg-12-lead, echocardiogram, holter: the doctor records the date, result (normal or abnormal), finding and source
--    in patient_investigation_records, ticking that they read the original.
--  * bp-home-log: the doctor confirms a finished BP week, shown with its readings and dates.
--  * bp-visit: the doctor confirms a dated reading taken by staff after the questionnaire. A member's own reading never counts.
--  * anthropometry: the doctor confirms a nurse visit with weight and waist taken after the questionnaire.
--
-- Nothing here calculates a value or judges pass or fail. Everything clinical is a restrictive default for Armen and
-- Yesayi to overrule (output/staff-fixes/ECG_DESIGN.md): who may record, how old evidence may be (dated on or after the
-- questionnaire's completion, and not in the future), that an abnormal investigation needs a completed consultation, and that results stay
-- staff-only.
--
-- The confirmation follows the clinic lab receipt (20261029211406): it holds a copy of its source, a new review starts
-- without it, and publication recomputes the source and refuses a confirmation that no longer matches. It lives in
-- review.evidenceReceipts, not review.receipts, because the member's own publication read returns review->'receipts'.
--
-- Each function below is its previous definition with only the named change:
--  * command_patient_clinical_review: wraps the 20261029211406 command, adds record-investigation and receive-evidence.
--  * publish_patient_clinical_plan: 20261030210000 (including regimen approval) plus the check above, and no copying of these tests to member results.

-- 1. Investigations a doctor recorded ---------------------------------------------------------------------------------
create table public.patient_investigation_records(
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.patient_clinical_cases(user_id),
 test_id text not null check(test_id in('ecg-12-lead','echocardiogram','holter')),
 performed_on date not null,
 result text not null check(result in('normal','abnormal')),
 finding text check(finding is null or length(btrim(finding))between 1 and 2000),
 source text not null check(length(btrim(source))between 3 and 500),
 recorded_by uuid not null references public.workspace_staff(user_id),
 recorded_by_name text not null,
 recorded_at timestamptz not null default clock_timestamp(),
 check(result<>'abnormal' or finding is not null)
);
create index patient_investigation_records_member on public.patient_investigation_records(user_id,test_id,performed_on desc);
alter table public.patient_investigation_records enable row level security;
revoke all on public.patient_investigation_records from public,anon,authenticated,service_role;
create function public._patient_investigation_immutable()returns trigger language plpgsql set search_path=''as $$begin
 raise exception using errcode='55000',message='Investigation records are immutable';
end$$;
create trigger patient_investigation_records_immutable before update or delete on public.patient_investigation_records for each row execute function public._patient_investigation_immutable();

-- 2. Which tests have a path, and what may evidence each one --------------------------------------------------------
create function public._required_evidence_kind(p_test text)returns text language sql immutable set search_path=''as $$
 select case when p_test in('ecg-12-lead','echocardiogram','holter')then 'investigation'when p_test='bp-home-log'then 'bp-week'
  when p_test='bp-visit'then 'bp-reading'when p_test='anthropometry'then 'body-measures'end
$$;
-- One instant, one spelling: a snapshot compared at publication must not depend on a session's time zone.
create function public._evidence_instant(t timestamptz)returns text language sql immutable set search_path=''as $$
 select to_char(t at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
$$;
-- Every source that may evidence this test now, as a confirmation holds it. Empty until the questionnaire is complete.
create function public._required_evidence_sources(p_user uuid,p_test text)returns setof jsonb
language plpgsql stable security definer set search_path=''as $$
declare a public.patient_assessments;k text:=public._required_evidence_kind(p_test);on_day date;today date:=(clock_timestamp()at time zone 'Asia/Yerevan')::date;
begin
 select * into a from public.patient_assessments where user_id=p_user;
 if a.completed_at is null or k is null then return;end if;
 on_day:=(a.completed_at at time zone 'Asia/Yerevan')::date;
 if k='investigation'then
  return query select jsonb_build_object('id',r.id,'testId',r.test_id,'performedOn',r.performed_on,'result',r.result,'finding',r.finding,'source',r.source,
    'recordedBy',r.recorded_by,'recordedByName',r.recorded_by_name,'recordedAt',public._evidence_instant(r.recorded_at))
   from public.patient_investigation_records r
   where r.user_id=p_user and r.test_id=p_test and r.performed_on>=on_day and r.performed_on<=today order by r.performed_on desc,r.recorded_at desc,r.id;
 elsif k='bp-week'then
  -- Finished means what the week screens mean (lib/bp-week/model.ts weekPhase): not stopped, last day over. At least one reading exists to read.
  return query select jsonb_build_object('id',w.id,'startsOn',w.starts_on,'days',w.days,'readingsPerSlot',w.readings_per_slot,'readings',q.readings)
   from public.bp_weeks w
   cross join lateral(select jsonb_agg(jsonb_build_object('id',m.id,'day',b.day,'slot',b.slot,'systolic',m.systolic,'diastolic',m.diastolic,'pulse',m.pulse,
     'measuredAt',public._evidence_instant(m.measured_at))order by b.day,b.slot desc,m.measured_at,m.id)readings
    from public.bp_week_readings b join public.patient_measurements m on m.id=b.measurement_id where b.week_id=w.id)q
   where w.member_id=p_user and w.stopped_at is null and w.starts_on+w.days-1<today and w.starts_on>=on_day and q.readings is not null
   order by w.starts_on desc,w.created_at desc,w.id;
 elsif k='bp-reading'then
  -- Staff provenance is the staff record of the reading, never the measurement row, which a member can also write.
  return query select jsonb_build_object('id',m.id,'systolic',m.systolic,'diastolic',m.diastolic,'pulse',m.pulse,'measuredAt',public._evidence_instant(m.measured_at),
    'takenBy',t.actor_name,'takenByRole',t.actor_role)
   from public.patient_measurements m
   cross join lateral(select x.actor_name,x.actor_role from(
     select n.actor_name,n.actor_role from public.staff_care_notes n where n.patient_case_id=p_user and n.kind='measurement'and n.detail->>'measurementId'=m.id::text
     union all select e.actor_name,e.actor_role from public.patient_care_visit_entries e where e.user_id=p_user and e.measurement_id=m.id)x
    order by 1,2 limit 1)t
   where m.user_id=p_user and m.measured_at>a.completed_at and m.measured_at<=clock_timestamp()order by m.measured_at desc,m.id;
 else
  return query select jsonb_build_object('id',v.id,'observedAt',public._evidence_instant(q.observed),'takenBy',v.actor_name,'takenByRole',v.actor_role,'observations',q.observations)
   from public.patient_care_visits v
   cross join lateral(select max(e.observed_instant)observed,jsonb_agg(jsonb_build_object('field',e.payload->>'field','value',e.payload->'value','unit',e.payload->>'unit',
     'observedAt',public._evidence_instant(e.observed_instant))order by e.observed_instant,e.id)observations,
     bool_or(e.payload->>'field'='weight')has_weight,bool_or(e.payload->>'field'='waist')has_waist
    from public.patient_care_visit_entries e
    where e.user_id=p_user and e.visit_id=v.id and e.payload->>'kind'='observation'and e.payload->>'state'='known'and e.payload->>'field'in('height','weight','waist')
     and e.observed_instant>a.completed_at and e.observed_instant<=clock_timestamp())q
   where v.user_id=p_user and v.source='nurse-visit'and q.has_weight and q.has_waist order by q.observed desc,v.id;
 end if;
end$$;
create function public._required_evidence_source(p_user uuid,p_test text,p_source text)returns jsonb
language sql stable security definer set search_path=''as $$
 select s from public._required_evidence_sources(p_user,p_test)s where s->>'id'=p_source
$$;
revoke all on function public._required_evidence_kind(text),public._evidence_instant(timestamptz),public._required_evidence_sources(uuid,text),public._required_evidence_source(uuid,text,text)from public,anon,authenticated,service_role;

-- 3. Record and confirm -----------------------------------------------------------------------------------------------
alter function public.command_patient_clinical_review(uuid,bigint,text,text,jsonb)rename to command_patient_clinical_review_before_required_evidence;
revoke all on function public.command_patient_clinical_review_before_required_evidence(uuid,bigint,text,text,jsonb)from public,anon,authenticated,service_role;
create function public.command_patient_clinical_review(p_user_id uuid,p_expected_revision bigint,p_evidence_token text,p_operation text,p_input jsonb)returns bigint
language plpgsql security definer set search_path=''as $$
declare c public.patient_clinical_cases;v jsonb;n bigint;test jsonb;kind text;sid text;src jsonb;day date;result text;finding text;where_from text;doctor text;
begin
 if p_operation is distinct from 'record-investigation'and p_operation is distinct from 'receive-evidence'then
  return public.command_patient_clinical_review_before_required_evidence(p_user_id,p_expected_revision,p_evidence_token,p_operation,p_input);
 end if;
 c:=public.lock_assigned_clinical_case(p_user_id,auth.uid(),p_expected_revision,p_evidence_token);v:=c.review;
 if v is null or v->>'evidenceToken' is distinct from p_evidence_token or v->>'doctorId' is distinct from auth.uid()::text then raise exception 'Refresh clinical recommendations before review';end if;
 if p_input->>'sourceChecked' is distinct from 'true' then raise exception 'Check the original source document';end if;
 select t into test from jsonb_array_elements(v#>'{engine,tests}')t where t->>'id'=p_input->>'testId';
 kind:=public._required_evidence_kind(test->>'id');
 if test is null or test->>'method'='lab'or kind is null or(p_operation='record-investigation'and kind<>'investigation')then raise exception 'This required test needs a supported native evidence pathway';end if;
 if p_operation='record-investigation'then
  day:=(p_input->>'performedOn')::date;result:=p_input->>'result';finding:=nullif(btrim(p_input->>'finding'),'');where_from:=btrim(p_input->>'source');
  if day is null or result is null or result not in('normal','abnormal')or length(where_from)is null or length(where_from)not between 3 and 500 or length(finding)>2000 then raise exception 'Enter the date, result and source of the investigation';end if;
  if result='abnormal'and finding is null then raise exception 'Describe the finding of an abnormal investigation';end if;
  select display_name into doctor from public.workspace_staff where user_id=auth.uid();
  insert into public.patient_investigation_records(user_id,test_id,performed_on,result,finding,source,recorded_by,recorded_by_name)
   values(p_user_id,test->>'id',day,result,finding,where_from,auth.uid(),doctor)returning id::text into sid;
 else
  sid:=p_input->>'sourceId';
 end if;
 src:=public._required_evidence_source(p_user_id,test->>'id',sid);
 -- A refused new record rolls back with this exception: the date rule leaves no row behind.
 if src is null then raise exception 'This evidence does not count for the requirement';end if;
 v:=jsonb_set(v,'{evidenceReceipts}',coalesce(v->'evidenceReceipts','{}'::jsonb)||jsonb_build_object(test->>'id',jsonb_build_object('source',kind,'sourceId',sid,'snapshot',src,'actorId',auth.uid(),'at',public._evidence_instant(clock_timestamp()))));
 update public.patient_clinical_cases set review=v,revision=revision+1,updated_at=now()where user_id=p_user_id returning revision into n;
 insert into public.patient_clinical_case_events(user_id,revision,kind,actor_id,detail)values(p_user_id,n,'result-received',auth.uid(),jsonb_build_object('evidenceToken',p_evidence_token,'source',kind,'testId',test->>'id'));
 return n;
end $$;
revoke all on function public.command_patient_clinical_review(uuid,bigint,text,text,jsonb)from public,anon,authenticated,service_role;
grant execute on function public.command_patient_clinical_review(uuid,bigint,text,text,jsonb)to authenticated;

-- 4. Publication: the 20261030210000 regimen definition plus the check above ----------------------------------------------------
create or replace function public.publish_patient_clinical_plan(p_user_id uuid,p_actor uuid,p_expected_revision bigint,p_evidence_token text,p_engine jsonb,p_request_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare c public.patient_clinical_cases;e jsonb;v jsonb;pub public.patient_clinical_publications;pid uuid;stamp timestamptz;label text;n bigint;test jsonb;receipt jsonb;r public.patient_reports;tid uuid;mid uuid;prior_plan uuid;row_index jsonb;source_row jsonb;lab_row jsonb;evidence jsonb;
 regimen jsonb;med jsonb;approval text:=nullif(coalesce(current_setting('noreon.plan_regimen_hash',true),''),'');
begin
 perform set_config('noreon.plan_regimen_hash','',true);
 -- No auto-retry: a lock conflict rolls the entire command back for explicit reload.
 perform public.lock_patient_clinical_sources(p_user_id);
 select * into c from public.patient_clinical_cases where user_id=p_user_id for update nowait;
 if c.assigned_doctor_id is distinct from p_actor or not exists(select 1 from public.workspace_staff s join public.workspace_clinics k on k.id=s.clinic_id where s.user_id=p_actor and s.role='doctor' and s.active and k.active) then raise insufficient_privilege using message='Assigned active doctor required';end if;
 select * into pub from public.patient_clinical_publications where request_id=p_request_id;
 if found then
  if pub.user_id<>p_user_id or pub.actor_id<>p_actor or pub.evidence_token<>p_evidence_token or pub.review->'engine' is distinct from p_engine then raise exception 'Publication request conflict';end if;
  return pub.plan_id;
 end if;
 c:=public.lock_assigned_clinical_case(p_user_id,p_actor,p_expected_revision,p_evidence_token);
 -- Fresh request IDs cannot manufacture an identical plan version or notification.
 -- Assignment and evidence CAS above are checked before this semantic guard.
 if exists(select 1 from public.patient_clinical_publications prior join public.patient_care_plans active_plan on active_plan.id=prior.plan_id and active_plan.user_id=prior.user_id and active_plan.active
  where prior.user_id=p_user_id and prior.actor_id=p_actor and prior.evidence_token=p_evidence_token and prior.review=c.review and prior.draft=c.draft) then raise exception 'Unchanged plan already published. Review and save a changed clinical draft before publishing a new version.';end if;
 v:=c.review;e:=public.patient_clinical_evidence(p_user_id);
 if v is null or v->>'evidenceToken' is distinct from p_evidence_token or v->>'doctorId' is distinct from p_actor::text or v->'engine' is distinct from p_engine or coalesce(p_engine->>'urgency','') not in ('green','yellow','orange') then raise exception 'Refresh current clinical recommendations';end if;
 if c.draft_saved_by is distinct from p_actor or c.draft_evidence_token is distinct from p_evidence_token or c.draft_review_token is distinct from md5(v::text) or not public.workspace_valid_review_draft(c.draft) then raise exception 'Save a valid draft after reviewing the current evidence and gates';end if;
 if exists(select 1 from public.patient_reports src where src.user_id=p_user_id and src.deleted_at is null and (src.state<>'confirmed' or src.reviewed is null or v#>>array['approvals',src.id::text,'revision'] is distinct from src.revision::text)) then raise exception 'Approve every current imported source report';end if;
 for test in select * from jsonb_array_elements(v#>'{engine,tests}') loop
  receipt:=v#>array['receipts',test->>'id'];
  if test->>'method'<>'lab' then
   -- Still refused unless this exact test has an evidence path and a doctor's current confirmation.
   if public._required_evidence_kind(test->>'id') is null then raise exception 'A required clinic or home-log test has no supported native receipt pathway';end if;
   evidence:=v#>array['evidenceReceipts',test->>'id'];
   if evidence is null then raise exception 'Confirm every required clinic or home test';end if;
   if public._required_evidence_source(p_user_id,test->>'id',evidence->>'sourceId') is distinct from evidence->'snapshot' then raise exception 'Required source receipt is stale';end if;
   if evidence#>>'{snapshot,result}'='abnormal' and(v#>>'{consultation,decision}' is distinct from 'required' or v#>>'{consultation,completedAt}' is null or v#>>'{consultation,evidenceToken}' is distinct from p_evidence_token) then raise exception 'An abnormal investigation needs a completed consultation';end if;
   continue;
  end if;
  if receipt is null then raise exception 'Receive every required laboratory result';end if;
  -- Clinic lab: the values must still be exactly what was received (no later correction, detach or move).
  if receipt->>'source'='clinic-lab' then
   if public._clinic_lab_receipt_values(p_user_id,(receipt->>'attachmentId')::uuid,(select jsonb_agg(x->'id')from jsonb_array_elements(receipt->'values')x)) is distinct from receipt->'values' then raise exception 'Required source receipt is stale';end if;
   continue;
  end if;
  select * into r from public.patient_reports where id=(receipt->>'reportId')::uuid and user_id=p_user_id and deleted_at is null;
  if not found or r.state<>'confirmed' or r.revision::text is distinct from receipt->>'reportRevision' or v#>>array['approvals',r.id::text,'revision'] is distinct from r.revision::text then raise exception 'Required source receipt is stale';end if;
 end loop;
 if v#>>'{consultation,decision}' not in ('required','not-required') or v#>>'{consultation,decision}' is null then raise exception 'Record an explicit consultation decision';end if;
 if v#>>'{consultation,decision}'='required' and (v#>>'{consultation,completedAt}' is null or (v#>>'{consultation,completedAt}')::timestamptz>now() or v#>>'{consultation,evidenceToken}' is distinct from p_evidence_token) then raise exception 'Complete the consultation for the current evidence';end if;
 -- Never lock medication rows after plans: dose commands lock medication then plan.
 select id into prior_plan from public.patient_care_plans where user_id=p_user_id and active for update nowait;
 regimen:=public._draft_regimen(c.draft);
 if c.draft?'medicines' and not public._multi_medicine_enabled() then raise exception 'Several-medicine plans are switched off';end if;
 -- A one-medicine draft cannot express a regimen, even of one: refuse rather than drop what the current plan holds.
 if not c.draft?'medicines' and ((select count(*) from public.patient_care_plan_medications l where l.plan_id=prior_plan)>1
  or exists(select 1 from public.patient_clinical_publications src join public.patient_care_plan_regimens held on held.plan_id=src.plan_id where src.plan_id=prior_plan and src.draft?'medicines' and jsonb_array_length(held.medicines)>0))
  then raise exception 'This draft would drop medicines from the current plan';end if;
 -- Checked once the plan row is locked, so no other version can slip in between this check and the new plan.
 if (c.draft?'medicines' or approval is not null) and approval is distinct from public._regimen_approval_hash(regimen,prior_plan) then raise exception 'Approve the current regimen before publishing';end if;
 stamp:=now();select display_name into label from public.workspace_staff where user_id=p_actor;
 update public.patient_care_plans set active=false,retired_at=stamp where user_id=p_user_id and active;
 insert into public.patient_care_plans(user_id,clinician,published_at,instructions) values(p_user_id,label,stamp,concat_ws(E'\n\n',c.draft->>'explanation',c.draft->>'instructions',nullif(c.draft->>'followUp',''))) returning id into pid;
 -- An unchanged medicine keeps its order, so its dose log continues. Anything else is a new order from this version on.
 for med in select value from jsonb_array_elements(regimen) loop
  mid:=null;
  select m.id into mid from public.patient_care_medications m join public.patient_care_plan_medications link on link.medication_id=m.id and link.plan_id=prior_plan
  where m.user_id=p_user_id and m.name=med->>'name' and m.dose=med->>'dose' and m.instructions=med->>'instructions'
  and array(select distinct t from unnest(m.times) t order by t)=array(select value::time from jsonb_array_elements_text(med->'times') order by value::time);
  if mid is null then
   insert into public.patient_care_medications(user_id,plan_id,name,dose,instructions,times,start_date,effective_at) values(p_user_id,pid,med->>'name',med->>'dose',med->>'instructions',array(select value::time from jsonb_array_elements_text(med->'times')),timezone('Asia/Yerevan',stamp)::date,stamp) returning id into mid;
  end if;
  insert into public.patient_care_plan_medications(plan_id,medication_id,user_id) values(pid,mid,p_user_id);
 end loop;
 -- Copy only doctor-received, actual source data. Non-numeric printed rows remain
 -- verbatim in the immutable publication, without a fabricated numeric conversion.
 for test in select * from jsonb_array_elements(v#>'{engine,tests}') loop
  -- Confirmed clinic and home tests stay in the immutable publication only.
  if test->>'method'<>'lab' then continue;end if;
  receipt:=v#>array['receipts',test->>'id'];
  if receipt->>'source'='clinic-lab' then
   select id into tid from public.patient_care_tests where user_id=p_user_id and source_lab_attachment_id=(receipt->>'attachmentId')::uuid and source_requirement_id=test->>'id';
   if tid is null then
    insert into public.patient_care_tests(user_id,title,preparation,status,ordered_by,ordered_at,source,source_label,source_lab_attachment_id,source_requirement_id)
    values(p_user_id,test->>'title',test->>'preparation','collected',label,(v->>'preparedAt')::timestamptz,'laboratory',
     coalesce((select nullif(x->>'laboratory','')from jsonb_array_elements(receipt->'values')x where nullif(x->>'laboratory','')is not null limit 1),'Clinic laboratory'),
     (receipt->>'attachmentId')::uuid,test->>'id') returning id into tid;
   end if;
   for lab_row in select * from jsonb_array_elements(receipt->'values') loop
    if jsonb_typeof(lab_row->'value')='number' and nullif(btrim(lab_row->>'unit'),'') is not null then
     insert into public.patient_care_results(user_id,test_id,marker,value,unit,collected_at,received_at,source,source_label,reviewed_at,reviewed_by,explanation,reference_text,source_lab_value_id,source_lab_reviewed_at,publication_plan_id)
     values(p_user_id,tid,lab_row->>'name',(lab_row->>'value')::double precision,lab_row->>'unit',((lab_row->>'collectedOn')||'T00:00:00+04:00')::timestamptz,(receipt->>'at')::timestamptz,'laboratory',
      coalesce(nullif(lab_row->>'laboratory',''),'Clinic laboratory'),stamp,label,receipt->>'note',left(lab_row->>'reference',160),(lab_row->>'id')::uuid,(lab_row->>'reviewedAt')::timestamptz,pid)
     on conflict on constraint care_result_lab_source_identity do nothing;
    end if;
   end loop;
   continue;
  end if;
  select * into r from public.patient_reports where id=(receipt->>'reportId')::uuid and user_id=p_user_id;
  select id into tid from public.patient_care_tests where user_id=p_user_id and source_report_id=r.id and source_requirement_id=test->>'id';
  if tid is null then
   insert into public.patient_care_tests(user_id,title,preparation,status,ordered_by,ordered_at,source,source_label,source_report_id,source_requirement_id)
   values(p_user_id,test->>'title',test->>'preparation','collected',label,(v->>'preparedAt')::timestamptz,'laboratory',coalesce(nullif(r.reviewed->>'laboratory',''),'Source report'),r.id,test->>'id') returning id into tid;
  end if;
  for row_index in select * from jsonb_array_elements(receipt->'rows') loop
   source_row:=r.reviewed#>array['rows',row_index::text];
   if length(source_row->>'literal')<=30 and source_row->>'literal' ~ '^-?[0-9]+([.,][0-9]+)?$' and nullif(btrim(source_row->>'unit'),'') is not null then
    insert into public.patient_care_results(user_id,test_id,marker,value,unit,collected_at,received_at,source,source_label,reviewed_at,reviewed_by,explanation,reference_text,source_report_id,source_revision,source_row,publication_plan_id)
    values(p_user_id,tid,source_row->>'name',replace(source_row->>'literal',',','.')::double precision,source_row->>'unit',((r.reviewed->>'reportDate')||'T00:00:00+04:00')::timestamptz,(receipt->>'at')::timestamptz,'laboratory',coalesce(nullif(r.reviewed->>'laboratory',''),'Source report'),stamp,label,receipt->>'note',source_row->>'reference',r.id,r.revision,(row_index::text)::integer,pid) on conflict on constraint care_result_source_identity do nothing;
   end if;
  end loop;
 end loop;
 update public.patient_clinical_cases set revision=revision+1,updated_at=stamp where user_id=p_user_id returning revision into n;
 insert into public.patient_clinical_publications(user_id,plan_id,request_id,actor_id,case_revision,evidence_token,evidence,review,draft,published_at) values(p_user_id,pid,p_request_id,p_actor,n,p_evidence_token,e->'data',v,c.draft,stamp);
 insert into public.patient_clinical_case_events(user_id,revision,kind,actor_id,detail) values(p_user_id,n,'plan-published',p_actor,jsonb_build_object('planId',pid));
 -- Native enqueue only qualifies explicit current channel consent; never fabricates it.
 perform public.enqueue_patient_plan_message(pid);
 return pid;
end $$;

-- 5. The doctor's sources for the review screen -------------------------------------------------------------------------
create function public.doctor_required_evidence_sources(p_user_id uuid)returns jsonb
language plpgsql stable security definer set search_path=''as $$
begin
 perform public._assigned_active_doctor(p_user_id);
 return jsonb_build_object('version','required-evidence-sources-v1','sources',(select jsonb_object_agg(t,coalesce((select jsonb_agg(s)from public._required_evidence_sources(p_user_id,t)s),'[]'::jsonb))
  from unnest(array['ecg-12-lead','echocardiogram','holter','bp-home-log','bp-visit','anthropometry'])t));
end$$;
revoke all on function public.doctor_required_evidence_sources(uuid)from public,anon,authenticated,service_role;
grant execute on function public.doctor_required_evidence_sources(uuid)to authenticated;
