-- Automatic acceptance of matched, in-range clinic lab values (product review rec. 4; Khikar 19 Oct 01:25).
--
-- When the AI reads a clinic PDF attached to a member, a value may be accepted without a doctor's click
-- only if everything agrees: the sheet's name and date of birth match the member, the sample date is the
-- visit day, the test name names a catalogue analyte, no code check failed, no attention mark and no lab
-- flag other than "normal", and the value is inside the printed range. The worker also keeps values a
-- margin away from each printed bound and from every THRESHOLD cut for that analyte (lib/lab-ai/auto-accept.ts;
-- the margin is a conservative default pending Armen, P41). Everything else stays 'unverified' for the doctor.
--
-- An accepted value is status 'auto_accepted' with auto_accepted_at and auto_accept_rule (its source is the
-- PDF page and snippet it was read from). No person is recorded as its reviewer. The doctor sees these in an
-- "Accepted automatically" list and can still confirm, correct or reject each one.
--
-- Off by default: lab_ai_capabilities.auto_accept_enabled (false). The guard re-checks every condition, so
-- no route can mark a value auto-accepted that this function would refuse.

-- 1. Switch -----------------------------------------------------------------------------------------------
alter table public.lab_ai_capabilities add column auto_accept_enabled boolean not null default false,
 -- The worker's AUTO_ACCEPT_MARGIN (lib/lab-ai/auto-accept.ts) is pinned to this default by both checks.
 add column auto_accept_margin numeric(4,3)not null default 0.100 check(auto_accept_margin between 0.050 and 0.500);

-- 2. Status and provenance ----------------------------------------------------------------------------------
alter table public.lab_ai_values add column auto_accepted_at timestamptz,add column auto_accept_rule text check(auto_accept_rule ~ '^[a-z0-9-]{1,40}$');
do $$
declare c record;dropped int:=0;
begin
 -- The status list and "unverified means no reviewer" were unnamed checks in 20261017165252.
 for c in select conname,pg_get_constraintdef(oid)def from pg_constraint where conrelid='public.lab_ai_values'::regclass and contype='c'
  and pg_get_constraintdef(oid)like '%''unverified''%'loop
  execute format('alter table public.lab_ai_values drop constraint %I',c.conname);dropped:=dropped+1;
 end loop;
 if dropped<>2 then raise exception 'lab_ai_values: expected 2 status checks, found %',dropped;end if;
end$$;
alter table public.lab_ai_values add constraint lab_ai_values_status_check check(status in('unverified','auto_accepted','verified','corrected','rejected')),
 add constraint lab_ai_values_reviewer_check check((status in('unverified','auto_accepted'))=(reviewed_by is null)),
 add constraint lab_ai_values_auto_accept_check check((auto_accepted_at is null)=(auto_accept_rule is null)and(status<>'auto_accepted'or auto_accepted_at is not null));

-- 3. The database's own check -----------------------------------------------------------------------------
-- What the database can decide by itself: switch, identity, visit day, flags, checks, a printed unit, one plain
-- printed range (no conditional or second interval, nothing after it but the value's unit) and the margin from
-- each printed bound. The analyte-name match and the THRESHOLD cuts need the catalogue's aliases and unit
-- conversions, so they stay with the worker (lib/lab-ai/auto-accept.ts). The guard also accepts the transition
-- only inside lab_ai_job_finish for that job. Accepted residual (Astra LA-02, LEAD_DECISIONS 19 Oct): the service
-- role that calls lab_ai_job_finish can already record any value, and the database owner can bypass any
-- trigger, so neither is a boundary this check could hold.
create function public._lab_ai_auto_accept_ok(v public.lab_ai_values)returns boolean
language sql stable security definer set search_path=''as $$
 with c as(select enabled and auto_accept_enabled as on_,auto_accept_margin m from public.lab_ai_capabilities where singleton)
 select coalesce((select on_ from c),false)
  and exists(select 1 from public.lab_ai_jobs j where j.id=v.job_id and j.kind='attachment'and j.user_id=v.user_id and j.state='done'and j.identity_status='match')
  and v.catalogue_ref is not null and v.value is not null and cardinality(v.checks)=0 and v.attention is null and v.attention_rule is null
  and coalesce(v.lab_flag,'normal')='normal'
  and v.unit is not null
  -- One plain interval, followed by nothing or by the value's own unit (spaces and case aside).
  and(select r is not null and(btrim(r[1])=''or lower(regexp_replace(btrim(r[1]),'\s','','g'))=lower(regexp_replace(v.unit,'\s','','g')))
   from regexp_match(coalesce(v.ref_text,''),'^\s*(?:(?:<|≤|>|≥|до|от|մինչև|ավելի)\s*-?[0-9]{1,9}(?:[.,][0-9]{1,6})?|-?[0-9]{1,9}(?:[.,][0-9]{1,6})?\s*[-–—]\s*-?[0-9]{1,9}(?:[.,][0-9]{1,6})?)(.*)$','i')r)
  and(select case
   when v.ref_low is not null and v.ref_high is not null then v.ref_high>v.ref_low and v.value>=v.ref_low+c.m*(v.ref_high-v.ref_low)and v.value<=v.ref_high-c.m*(v.ref_high-v.ref_low)
   when v.ref_high is not null then v.ref_high>0 and v.value>=0 and v.value<=v.ref_high*(1-c.m)
   when v.ref_low is not null then v.ref_low>0 and v.value>=v.ref_low*(1+c.m)
   else false end from c)
  and v.collected_on is not null
  and exists(select 1 from public.clinic_result_attachments a join public.patient_care_visits pv on pv.user_id=a.user_id and pv.id=a.visit_id
   where a.id=v.attachment_id and a.user_id=v.user_id and(pv.created_at at time zone 'Asia/Yerevan')::date=v.collected_on)
  and public._lab_ai_current(v.attachment_id)
$$;

-- 4. Guard: as before, plus the one system transition unverified -> auto_accepted ------------------------------
create or replace function public._lab_ai_values_guard()returns trigger language plpgsql set search_path=''as $$
begin
 if tg_op='DELETE'then raise exception using errcode='55000',message='AI-read values are kept';end if;
 if tg_op='INSERT'then
  if new.status<>'unverified'or new.reviewed_by is not null or new.corrected_value is not null or new.auto_accepted_at is not null then
   raise exception using errcode='42501',message='AI-read values start unverified';end if;
  return new;
 end if;
 if(new.id,new.job_id,new.user_id,new.file_id,new.attachment_id,new.seq,new.source,new.test_name,new.catalogue_ref,new.value_text,new.value,new.unit,new.ref_low,new.ref_high,
   new.ref_text,new.lab_flag,new.collected_on,new.lab_name,new.page,new.snippet,new.checks,new.attention,new.attention_rule,new.created_at)
  is distinct from(old.id,old.job_id,old.user_id,old.file_id,old.attachment_id,old.seq,old.source,old.test_name,old.catalogue_ref,old.value_text,old.value,old.unit,old.ref_low,old.ref_high,
   old.ref_text,old.lab_flag,old.collected_on,old.lab_name,old.page,old.snippet,old.checks,old.attention,old.attention_rule,old.created_at)then
  raise exception using errcode='55000',message='The AI reading is kept as it was';end if;
 if new.status='auto_accepted'and old.status='unverified'then
  if new.reviewed_by is not null or new.corrected_value is not null or new.auto_accepted_at is null
   or current_setting('noreon.lab_auto_accept_job',true)is distinct from new.job_id::text or not public._lab_ai_auto_accept_ok(new)then
   raise exception using errcode='42501',message='This value needs the doctor';end if;
  return new;
 end if;
 -- When it was accepted, and by which rule, is kept for good once set.
 if(new.auto_accepted_at,new.auto_accept_rule)is distinct from(old.auto_accepted_at,old.auto_accept_rule)then
  raise exception using errcode='55000',message='Automatic acceptance is kept as it was';end if;
 if new.status in('unverified','auto_accepted')and new.status is distinct from old.status then
  raise exception using errcode='55000',message='A review is not undone';end if;
 if new.status not in('unverified','auto_accepted')and(auth.uid()is null or new.reviewed_by is distinct from auth.uid()
  or not exists(select 1 from public.workspace_staff s where s.user_id=auth.uid()and s.role='doctor'and s.active)
  or not exists(select 1 from public.patient_clinical_cases c where c.user_id=new.user_id and c.assigned_doctor_id=auth.uid()))then
  raise exception using errcode='42501',message='Only the assigned doctor reviews a value';end if;
 return new;
end$$;

-- 5. Counts: auto-accepted values are neither waiting for the doctor nor reviewed by a person ----------------
create or replace function public._lab_ai_job_json(j public.lab_ai_jobs)returns jsonb language sql stable security definer set search_path=''as $$
 select jsonb_build_object('jobId',j.id,'fileId',j.file_id,'state',j.state,'outcome',j.outcome,'attempts',j.attempts,'pageCount',j.page_count,
  'identityStatus',j.identity_status,'identity',j.identity,'identityConfirmedAt',j.identity_confirmed_at,'identityNote',j.identity_note,
  'summary',j.summary,'provider',j.provider,'model',j.model,'createdAt',j.created_at,'finishedAt',j.finished_at,
  'counts',(select jsonb_build_object('total',count(*),'unverified',count(*)filter(where status='unverified'),'verified',count(*)filter(where status in('verified','corrected')),
    'autoAccepted',count(*)filter(where status='auto_accepted'),
    'rejected',count(*)filter(where status='rejected'),'attention',count(*)filter(where attention is not null and status<>'rejected'))from public.lab_ai_values where job_id=j.id),
  'calls',(select jsonb_build_object('count',count(*),'costUsd',coalesce(sum(cost_usd),0),'models',coalesce(jsonb_agg(distinct model)filter(where reserved),'[]'))from public.lab_ai_calls where job_id=j.id))
$$;

-- 6. Finish: unchanged from 20261018120200 except the marked auto-acceptance step -----------------------------
create or replace function public.lab_ai_job_finish(p_job uuid,p_lease uuid,p_result jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare j public.lab_ai_jobs;a public.clinic_result_attachments;disp text;oc text;idst text;x jsonb;n int:=0;pages int;md public.member_reported_documents;auto int[]:='{}';accepted int:=0;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 select * into j from public.lab_ai_jobs where id=p_job for update;
 if not found then return jsonb_build_object('ok',false,'code','job_unknown');end if;
 if j.state<>'running'or j.lease_token is distinct from p_lease then
  return case when j.state in('done','rejected','failed')then jsonb_build_object('ok',true,'replayed',true,'state',j.state)else jsonb_build_object('ok',false,'code','job_not_running')end;
 end if;
 disp:=p_result->>'disposition';oc:=p_result->>'outcome';
 if jsonb_typeof(p_result)is distinct from 'object'or disp is null or disp not in('done','rejected','retry','defer')or coalesce(oc,'')!~'^[a-z0-9_]{1,60}$'then
  return jsonb_build_object('ok',false,'code','invalid');end if;
 if disp='retry'then
  update public.lab_ai_jobs set state=case when attempts>=3 then 'failed'else 'queued'end,outcome=oc,lease_token=null,lease_until=null,
   next_attempt_at=clock_timestamp()+make_interval(mins=>5*attempts),finished_at=case when attempts>=3 then clock_timestamp()end where id=j.id returning * into j;
  return jsonb_build_object('ok',true,'state',j.state);
 end if;
 if disp='defer'then
  update public.lab_ai_jobs set state='queued',outcome=oc,attempts=greatest(attempts-1,0),lease_token=null,lease_until=null,next_attempt_at=clock_timestamp()+interval '30 minutes'where id=j.id;
  return jsonb_build_object('ok',true,'state','queued');
 end if;
 if disp='rejected'then
  update public.lab_ai_jobs set state='rejected',outcome=oc,lease_token=null,lease_until=null,finished_at=clock_timestamp()where id=j.id;
  return jsonb_build_object('ok',true,'state','rejected');
 end if;
 -- done, member upload: values for the member to answer, identity and summary.
 if j.kind='member_upload'then
  select * into md from public.member_reported_documents where id=j.member_document_id;
  if md.deleted_at is not null then
   update public.lab_ai_jobs set state='rejected',outcome='document_removed',lease_token=null,lease_until=null,finished_at=clock_timestamp()where id=j.id;
   return jsonb_build_object('ok',true,'state','rejected');
  end if;
  idst:=p_result->>'identityStatus';
  begin pages:=(p_result->>'pageCount')::int;exception when others then return jsonb_build_object('ok',false,'code','invalid');end;
  if idst is null or idst not in('match','unknown','mismatch','multiple_patients')or pages is null or pages not between 1 and 10
   or(p_result->>'sourceSha256')is distinct from md.sha256 or jsonb_typeof(p_result->'values')is distinct from 'array'or jsonb_array_length(p_result->'values')>200
   or(idst='multiple_patients'and jsonb_array_length(p_result->'values')>0)
   or(p_result ? 'summary'and jsonb_typeof(p_result->'summary')not in('object','null'))
   or(jsonb_typeof(p_result->'summary')='object'and length((p_result->'summary')::text)>20000)
   or coalesce(p_result->>'provider','')!~'^[a-z0-9_.-]{1,64}$'or coalesce(p_result->>'model','')!~'^[a-z0-9_.:/-]{1,80}$'then
   return jsonb_build_object('ok',false,'code','invalid');end if;
  begin
   for x in select * from jsonb_array_elements(p_result->'values')loop
    n:=n+1;
    if jsonb_typeof(x)<>'object'or coalesce((x->>'page')::int,0)not between 1 and pages then raise invalid_parameter_value;end if;
    insert into public.member_upload_ai_values(job_id,member_id,document_id,seq,test_name,catalogue_ref,value_text,value,unit,ref_low,ref_high,ref_text,lab_flag,collected_on,lab_name,page,snippet,checks,
     attention,attention_rule,measure,measure_unit)
    values(j.id,j.member_id,md.id,n,x->>'testName',x->>'catalogueRef',x->>'valueText',(x->>'value')::numeric,x->>'unit',(x->>'refLow')::numeric,(x->>'refHigh')::numeric,x->>'refText',
     x->>'labFlag',(x->>'collectedOn')::date,x->>'labName',(x->>'page')::smallint,x->>'snippet',
     coalesce((select array_agg(c)from jsonb_array_elements_text(coalesce(x->'checks','[]'))c),'{}'),x->>'attention',x->>'attentionRule',x->>'measure',x->>'measureUnit');
   end loop;
  exception when check_violation or not_null_violation or invalid_text_representation or invalid_parameter_value or numeric_value_out_of_range or datetime_field_overflow
   or invalid_datetime_format or string_data_right_truncation or unique_violation then
   return jsonb_build_object('ok',false,'code','invalid');
  end;
  update public.lab_ai_jobs set state='done',outcome=oc,page_count=pages,source_sha256=p_result->>'sourceSha256',identity_status=idst,
   identity=case when jsonb_typeof(p_result->'identity')='object'and length((p_result->'identity')::text)<=4000 then p_result->'identity'end,
   summary=case when jsonb_typeof(p_result->'summary')='object'then p_result->'summary'end,
   provider=p_result->>'provider',model=p_result->>'model',lease_token=null,lease_until=null,finished_at=clock_timestamp()where id=j.id;
  return jsonb_build_object('ok',true,'state','done','values',n);
 end if;
 -- done, file reading: the checked extraction and suggestions; every suggested member has a booking here.
 if j.kind='file'then
  idst:=p_result->>'identityStatus';
  begin pages:=(p_result->>'pageCount')::int;exception when others then return jsonb_build_object('ok',false,'code','invalid');end;
  if idst is null or idst not in('match','unknown','mismatch','multiple_patients')or pages is null or pages not between 1 and 10
   or(p_result->>'sourceSha256')is distinct from(select sha256 from public.clinic_batch_files where id=j.file_id)
   or jsonb_typeof(p_result->'extraction')is distinct from 'object'or length((p_result->'extraction')::text)>200000
   or jsonb_typeof(p_result->'suggestions')is distinct from 'array'or jsonb_array_length(p_result->'suggestions')>3
   or(idst='multiple_patients'and jsonb_array_length(p_result->'suggestions')>0)
   or exists(select 1 from jsonb_array_elements(p_result->'suggestions')sg where jsonb_typeof(sg)<>'object'
    or coalesce(sg->>'confidence','')not in('high','medium','low')or coalesce(sg->>'identityStatus','')not in('match','unknown','mismatch')
    or not exists(select 1 from public._lab_clinic_bookings(j.clinic_id)b where b.member_id::text=sg->>'memberId'))
   or coalesce(p_result->>'provider','')!~'^[a-z0-9_.-]{1,64}$'or coalesce(p_result->>'model','')!~'^[a-z0-9_.:/-]{1,80}$'then
   return jsonb_build_object('ok',false,'code','invalid');end if;
  update public.lab_ai_jobs set state='done',outcome=oc,page_count=pages,source_sha256=p_result->>'sourceSha256',identity_status=idst,
   identity=case when jsonb_typeof(p_result->'identity')='object'and length((p_result->'identity')::text)<=4000 then p_result->'identity'end,
   extraction=p_result->'extraction',suggestions=(select coalesce(jsonb_agg(jsonb_build_object('memberId',sg->>'memberId','confidence',sg->>'confidence','identityStatus',sg->>'identityStatus')),'[]')
    from jsonb_array_elements(p_result->'suggestions')sg),
   provider=p_result->>'provider',model=p_result->>'model',lease_token=null,lease_until=null,finished_at=clock_timestamp()where id=j.id;
  return jsonb_build_object('ok',true,'state','done','suggestions',jsonb_array_length(p_result->'suggestions'));
 end if;
 -- done, member reading
 if not public._lab_ai_current(j.attachment_id)then
  update public.lab_ai_jobs set state='rejected',outcome='attachment_not_current',lease_token=null,lease_until=null,finished_at=clock_timestamp()where id=j.id;
  return jsonb_build_object('ok',true,'state','rejected');
 end if;
 select * into a from public.clinic_result_attachments where id=j.attachment_id;
 idst:=p_result->>'identityStatus';
 begin pages:=(p_result->>'pageCount')::int;exception when others then return jsonb_build_object('ok',false,'code','invalid');end;
 if idst is null or idst not in('match','unknown','mismatch','multiple_patients')or pages is null or pages not between 1 and 10
  or coalesce(p_result->>'sourceSha256','')!~'^[a-f0-9]{64}$'or jsonb_typeof(p_result->'values')is distinct from 'array'or jsonb_array_length(p_result->'values')>200
  or(idst='multiple_patients'and jsonb_array_length(p_result->'values')>0)
  or(p_result ? 'summary'and jsonb_typeof(p_result->'summary')not in('object','null'))
  or(p_result->>'sourceSha256')is distinct from(select sha256 from public.clinic_batch_files where id=j.file_id)then
  return jsonb_build_object('ok',false,'code','invalid');end if;
 begin
  for x in select * from jsonb_array_elements(p_result->'values')loop
   n:=n+1;
   if jsonb_typeof(x)<>'object'or coalesce((x->>'page')::int,0)not between 1 and pages then raise invalid_parameter_value;end if;
   if x->'autoAccept'='true'::jsonb then auto:=auto||n;end if;
   insert into public.lab_ai_values(job_id,user_id,file_id,attachment_id,seq,test_name,catalogue_ref,value_text,value,unit,ref_low,ref_high,ref_text,lab_flag,collected_on,lab_name,page,snippet,checks,attention,attention_rule)
   values(j.id,j.user_id,j.file_id,j.attachment_id,n,x->>'testName',x->>'catalogueRef',x->>'valueText',(x->>'value')::numeric,x->>'unit',(x->>'refLow')::numeric,(x->>'refHigh')::numeric,x->>'refText',
    x->>'labFlag',(x->>'collectedOn')::date,x->>'labName',(x->>'page')::smallint,x->>'snippet',
    coalesce((select array_agg(c)from jsonb_array_elements_text(coalesce(x->'checks','[]'))c),'{}'),x->>'attention',x->>'attentionRule');
  end loop;
 exception when check_violation or not_null_violation or invalid_text_representation or invalid_parameter_value or numeric_value_out_of_range or datetime_field_overflow
  or invalid_datetime_format or string_data_right_truncation or unique_violation then
  return jsonb_build_object('ok',false,'code','invalid');
 end;
 update public.lab_ai_jobs set state='done',outcome=oc,page_count=pages,source_sha256=p_result->>'sourceSha256',identity_status=idst,
  identity=case when jsonb_typeof(p_result->'identity')='object'then p_result->'identity'end,
  summary=case when jsonb_typeof(p_result->'summary')='object'then p_result->'summary'end,
  provider=p_result->>'provider',model=p_result->>'model',lease_token=null,lease_until=null,finished_at=clock_timestamp()where id=j.id;
 -- Values the worker proposed for automatic acceptance, each checked again here (and by the guard).
 if cardinality(auto)>0 then
  -- Only this function, for this job, may make the transition (the guard checks this setting).
  perform set_config('noreon.lab_auto_accept_job',j.id::text,true);
  update public.lab_ai_values v set status='auto_accepted',auto_accepted_at=clock_timestamp(),auto_accept_rule='lab-auto-accept-v1'
   where v.job_id=j.id and v.seq=any(auto)and v.status='unverified'and public._lab_ai_auto_accept_ok(v);
  get diagnostics accepted=row_count;
  perform set_config('noreon.lab_auto_accept_job','',true);
 end if;
 return jsonb_build_object('ok',true,'state','done','values',n,'autoAccepted',accepted);
end$$;

revoke all on function public._lab_ai_auto_accept_ok(public.lab_ai_values)from public,anon,authenticated,service_role;
revoke all on function public._lab_ai_values_guard(),public._lab_ai_job_json(public.lab_ai_jobs),public.lab_ai_job_finish(uuid,uuid,jsonb)from public,anon,authenticated,service_role;
grant execute on function public.lab_ai_job_finish(uuid,uuid,jsonb)to service_role;
