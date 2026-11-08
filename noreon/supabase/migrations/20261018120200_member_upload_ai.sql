-- Member uploads read by the lab AI reader (Khikar, 18 Oct 14:09: "we uploaded previous results,
-- nothing happens"). A member's earlier result (PDF or photo, Progress > Earlier results) is queued to
-- the same reader as clinic PDFs: same jobs, claim, lease, spend reservation under the shared daily
-- caps, call trace and model gating (20261017165252_lab_ai_extraction.sql, 20261017190654).
--
-- What is different from a clinic document:
--  - The job kind is 'member_upload' and points at member_reported_documents, not a clinic file.
--  - Values go to member_upload_ai_values, never to lab_ai_values (those are for the assigned doctor
--    to verify beside a clinic PDF). They are born 'pending' and only the member, signed in, confirms,
--    corrects or rejects them. Confirmed values of a charted measure are copied to
--    member_reported_values with source 'ai_confirmed'. Nothing is saved without the member's answer,
--    and nothing here is clinical truth: member-reported values feed no rule.
--  - When the sheet's name or date of birth clearly differs from the member's profile ('mismatch'),
--    the member is asked whether the results are theirs before saving, and the answer is recorded.
--    It does not block.
--  - The assigned active doctor and active administrators read the file, the values with their member
--    status, and the AI summary (staff_lab_ai_results, which also serves clinic documents read-only and
--    records each read). Reading is not reviewing: the doctor's verification path stays clinic-only.
--
-- Off unless lab_ai_capabilities.enabled AND the new lab_ai_capabilities.member_upload_enabled (seeded
-- false) AND the app's lab reader switches. At most five member uploads a day per member are queued.
-- No name, value or file content is written to any log.

-- 1. Switch ------------------------------------------------------------------------------------------------
alter table public.lab_ai_capabilities add column member_upload_enabled boolean not null default false;
create function public._lab_ai_member_upload_enabled()returns boolean language sql stable security definer set search_path=''as $$
 select coalesce((select enabled and member_upload_enabled from public.lab_ai_capabilities where singleton),false)
$$;
-- Member uploads queued per member and Yerevan day.
create function public._lab_ai_member_upload_daily_limit()returns integer language sql immutable as $$select 5$$;

-- 2. Jobs: a third kind ----------------------------------------------------------------------------------
alter table public.lab_ai_jobs alter column file_id drop not null;
alter table public.lab_ai_jobs add column member_document_id uuid references public.member_reported_documents(id);
alter table public.lab_ai_jobs add column member_id uuid references auth.users(id);
alter table public.lab_ai_jobs drop constraint lab_ai_jobs_kind_check;
alter table public.lab_ai_jobs add constraint lab_ai_jobs_kind_check check(kind in('file','attachment','member_upload'));
do $$declare c text;begin
 select conname into strict c from pg_constraint where conrelid='public.lab_ai_jobs'::regclass and contype='c'and pg_get_constraintdef(oid)like '%CASE kind%';
 execute format('alter table public.lab_ai_jobs drop constraint %I',c);
end$$;
alter table public.lab_ai_jobs add constraint lab_ai_jobs_kind_shape check(case kind
 when 'file'then file_id is not null and attachment_id is null and user_id is null and clinic_id is not null and summary is null and identity_confirmed_by is null
  and member_document_id is null and member_id is null
 when 'attachment'then file_id is not null and attachment_id is not null and user_id is not null and extraction is null and suggestions is null
  and member_document_id is null and member_id is null
 else file_id is null and attachment_id is null and user_id is null and clinic_id is null and extraction is null and suggestions is null and identity_confirmed_by is null
  and member_document_id is not null and member_id is not null end);
create unique index lab_ai_jobs_one_member_upload on public.lab_ai_jobs(member_document_id)where kind='member_upload';
create index lab_ai_jobs_member_upload_day on public.lab_ai_jobs(member_id,created_at)where kind='member_upload';

-- 3. Values the reader found on a member upload --------------------------------------------------------------
create table public.member_upload_ai_values(
 id uuid primary key default gen_random_uuid(),
 job_id uuid not null references public.lab_ai_jobs(id),
 member_id uuid not null references auth.users(id),
 document_id uuid not null references public.member_reported_documents(id),
 seq smallint not null check(seq between 1 and 200),
 source text not null default 'ai_extracted'check(source='ai_extracted'),
 test_name text not null check(length(test_name)between 1 and 120),
 catalogue_ref text check(length(catalogue_ref)between 1 and 60),
 value_text text not null check(length(value_text)between 1 and 40),
 value numeric check(value is null or(value>-1e9 and value<1e9)),
 unit text check(length(unit)between 1 and 30),
 ref_low numeric check(ref_low is null or(ref_low>-1e9 and ref_low<1e9)),
 ref_high numeric check(ref_high is null or(ref_high>-1e9 and ref_high<1e9)),
 ref_text text check(length(ref_text)between 1 and 60),
 lab_flag text check(lab_flag in('high','low','normal','abnormal','critical')),
 collected_on date,
 lab_name text check(length(lab_name)between 1 and 120),
 page smallint not null check(page between 1 and 10),
 snippet text check(length(snippet)between 1 and 300),
 checks text[]not null default '{}'check(cardinality(checks)<=10),
 -- For the doctor only, as on clinic values. Never shown to the member.
 attention text check(attention in('threshold','lab_critical','needs_doctor')),
 attention_rule text check(attention_rule ~ '^[A-Za-z0-9_.:-]{1,60}$'),
 -- The member-history measure this value can be charted as, decided in code from the analyte and unit.
 measure text check(measure in('total_cholesterol','ldl_c','hba1c','fasting_glucose')),
 measure_unit text check(measure_unit in('mmol/L','mg/dL','%')),
 member_status text not null default 'pending'check(member_status in('pending','confirmed','corrected','rejected')),
 member_value numeric check(member_value is null or(member_value>-1e9 and member_value<1e9)),
 member_reviewed_at timestamptz,
 created_at timestamptz not null default clock_timestamp(),
 unique(job_id,seq),
 check(ref_low is null or ref_high is null or ref_low<=ref_high),
 check((measure is null)=(measure_unit is null)),
 check((member_status='pending')=(member_reviewed_at is null)),
 check(member_status='corrected'or member_value is null),
 check(member_status<>'corrected'or member_value is not null),
 check(attention_rule is null or attention is not null)
);
create index member_upload_ai_values_member on public.member_upload_ai_values(member_id,document_id);

-- Born pending; the AI reading never changes; only the member, signed in, moves a value out of pending, once.
create function public._member_upload_ai_values_guard()returns trigger language plpgsql set search_path=''as $$
begin
 if tg_op='DELETE'then raise exception using errcode='55000',message='AI-read values are kept';end if;
 if tg_op='INSERT'then
  if new.member_status<>'pending'or new.member_value is not null or new.member_reviewed_at is not null then
   raise exception using errcode='42501',message='AI-read values start pending';end if;
  return new;
 end if;
 if(new.id,new.job_id,new.member_id,new.document_id,new.seq,new.source,new.test_name,new.catalogue_ref,new.value_text,new.value,new.unit,new.ref_low,new.ref_high,new.ref_text,
   new.lab_flag,new.collected_on,new.lab_name,new.page,new.snippet,new.checks,new.attention,new.attention_rule,new.measure,new.measure_unit,new.created_at)
  is distinct from(old.id,old.job_id,old.member_id,old.document_id,old.seq,old.source,old.test_name,old.catalogue_ref,old.value_text,old.value,old.unit,old.ref_low,old.ref_high,old.ref_text,
   old.lab_flag,old.collected_on,old.lab_name,old.page,old.snippet,old.checks,old.attention,old.attention_rule,old.measure,old.measure_unit,old.created_at)then
  raise exception using errcode='55000',message='The AI reading is kept as it was';end if;
 if old.member_status<>'pending'then raise exception using errcode='55000',message='A member answer is not changed';end if;
 if new.member_status<>'pending'and(auth.uid()is null or auth.uid()is distinct from new.member_id)then
  raise exception using errcode='42501',message='Only the member answers for their upload';end if;
 return new;
end$$;
create trigger member_upload_ai_values_guard before insert or update or delete on public.member_upload_ai_values for each row execute function public._member_upload_ai_values_guard();

-- The member's one answer per reading (append-only): the identity answer when asked, and when.
create table public.member_upload_ai_confirmations(
 job_id uuid primary key references public.lab_ai_jobs(id),
 member_id uuid not null references auth.users(id),
 submission_id uuid not null unique,
 identity_status text not null check(identity_status in('match','unknown','mismatch')),
 identity_answer text check(identity_answer in('mine','not_mine')),
 measured_on date,
 values_saved smallint not null check(values_saved between 0 and 200),
 values_charted smallint not null check(values_charted between 0 and 200),
 created_at timestamptz not null default clock_timestamp(),
 check(identity_status<>'mismatch'or identity_answer is not null)
);
create trigger member_upload_ai_confirmations_immutable before update or delete on public.member_upload_ai_confirmations for each row execute function public._patient_visit_immutable();

-- 4. Member-reported values may now come from a confirmed AI reading ------------------------------------------
alter table public.member_reported_values drop constraint member_reported_values_source_check;
alter table public.member_reported_values add constraint member_reported_values_source_check check(source in('member-reported','ai_confirmed'));
alter table public.member_reported_values add column ai_value_id uuid unique references public.member_upload_ai_values(id);
alter table public.member_reported_values add constraint member_reported_values_ai_link check((source='ai_confirmed')=(ai_value_id is not null));

-- 5. Enqueue on upload ---------------------------------------------------------------------------------------
create function public._lab_ai_enqueue_member_upload()returns trigger language plpgsql security definer set search_path=''as $$
begin
 -- The documents guard holds this member's advisory lock, so the day's count cannot race.
 if public._lab_ai_member_upload_enabled()and(select count(*)from public.lab_ai_jobs j where j.kind='member_upload'and j.member_id=new.user_id
   and(j.created_at at time zone 'Asia/Yerevan')::date=(clock_timestamp()at time zone 'Asia/Yerevan')::date)<public._lab_ai_member_upload_daily_limit()then
  insert into public.lab_ai_jobs(kind,member_document_id,member_id)values('member_upload',new.id,new.user_id)on conflict(member_document_id)where kind='member_upload'do nothing;
 end if;
 return new;
end$$;
create trigger member_reported_documents_lab_ai after insert on public.member_reported_documents for each row execute function public._lab_ai_enqueue_member_upload();

-- 6. Worker: claim and finish learn the member kind. Bodies otherwise unchanged from 20261017165252. ----------
create or replace function public.lab_ai_job_claim(p_limit integer)returns jsonb
language plpgsql security definer set search_path=''as $$
declare j public.lab_ai_jobs;out jsonb:='[]';f public.clinic_batch_files;a public.clinic_result_attachments;p public.profiles;v public.patient_care_visits;fr public.lab_ai_jobs;md public.member_reported_documents;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if not public._lab_ai_enabled()then return out;end if;
 -- Member uploads wait (are not claimed) while their own switch is off.
 for j in select * from public.lab_ai_jobs where((state='queued'and next_attempt_at<=clock_timestamp())or(state='running'and lease_until<clock_timestamp()))
  and(kind<>'member_upload'or public._lab_ai_member_upload_enabled())
  order by next_attempt_at,id limit least(greatest(coalesce(p_limit,1),1),5)for update skip locked loop
  f:=null;md:=null;
  if j.kind='member_upload'then
   select * into md from public.member_reported_documents where id=j.member_document_id;
   if md.deleted_at is not null then
    update public.lab_ai_jobs set state='rejected',outcome='document_removed',lease_token=null,lease_until=null,finished_at=clock_timestamp()where id=j.id;continue;
   end if;
  else
   select * into f from public.clinic_batch_files where id=j.file_id;
  end if;
  if(j.kind='attachment'and not public._lab_ai_current(j.attachment_id))or(j.kind='file'and(f.state<>'stored'or exists(select 1 from public.clinic_result_attachments x where x.file_id=f.id)))then
   update public.lab_ai_jobs set state='rejected',outcome=case j.kind when 'file'then 'file_already_linked'else 'attachment_not_current'end,lease_token=null,lease_until=null,finished_at=clock_timestamp()where id=j.id;continue;
  end if;
  if j.attempts>=3 then
   update public.lab_ai_jobs set state='failed',outcome=case when j.state='running'then 'lease_lost'else coalesce(j.outcome,'retries_exhausted')end,lease_token=null,lease_until=null,finished_at=clock_timestamp()where id=j.id;continue;
  end if;
  update public.lab_ai_jobs set state='running',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '10 minutes',started_at=clock_timestamp()
   where id=j.id returning * into j;
  if j.kind='member_upload'then
   select * into p from public.profiles where id=j.member_id;
   out:=out||jsonb_build_array(jsonb_build_object('kind','member_upload','jobId',j.id,'leaseToken',j.lease_token,'attempt',j.attempts,
    'file',jsonb_build_object('documentId',md.id,'bucket','member-history','objectKey',md.object_path,'sizeBytes',md.size_bytes,'sha256',md.sha256,'mime',md.mime),
    'member',jsonb_build_object('name',coalesce(p.display_name,''),'birthDate',p.birth_date),
    -- Earlier clinic values a doctor already reviewed, for "what changed" (never unverified ones).
    'previous',coalesce((select jsonb_agg(jsonb_build_object('catalogueRef',x.catalogue_ref,'value',coalesce(x.corrected_value,x.value),'unit',coalesce(x.corrected_unit,x.unit),'collectedOn',x.collected_on)
      order by x.collected_on desc nulls last)from(select * from public.lab_ai_values x where x.user_id=j.member_id and x.status in('verified','corrected')and x.catalogue_ref is not null
      and coalesce(x.corrected_value,x.value)is not null and public._lab_ai_current(x.attachment_id)order by x.collected_on desc nulls last limit 60)x),'[]')));
   continue;
  end if;
  if j.kind='file'then
   out:=out||jsonb_build_array(jsonb_build_object('kind','file','jobId',j.id,'leaseToken',j.lease_token,'attempt',j.attempts,
    'file',jsonb_build_object('fileId',f.id,'bucket','clinic-originals','objectKey',f.object_key,'sizeBytes',f.measured_size,'sha256',f.sha256,'mime',f.mime),
    -- Members with a booking at this clinic, for the suggestion only (worker memory, never logged).
    'candidates',coalesce((select jsonb_agg(jsonb_build_object('memberId',x.member_id,'name',coalesce(pr.display_name,''),'birthDate',pr.birth_date,'bookingDays',x.days))
      from(select member_id,jsonb_agg(distinct((starts_at at time zone 'Asia/Yerevan')::date))days from public._lab_clinic_bookings(j.clinic_id)group by member_id limit 300)x
      join public.profiles pr on pr.id=x.member_id),'[]')));
   continue;
  end if;
  select * into a from public.clinic_result_attachments where id=j.attachment_id;
  select * into p from public.profiles where id=j.user_id;
  select * into v from public.patient_care_visits where id=a.visit_id and user_id=a.user_id;
  -- The clinic upload's reading of these exact bytes, if done: reused, so the file is not sent twice.
  select * into fr from public.lab_ai_jobs where kind='file'and file_id=j.file_id and state='done'and extraction is not null and source_sha256=f.sha256;
  out:=out||jsonb_build_array(jsonb_build_object('kind','attachment','jobId',j.id,'leaseToken',j.lease_token,'attempt',j.attempts,
   'file',jsonb_build_object('fileId',f.id,'bucket','clinic-originals','objectKey',f.object_key,'sizeBytes',f.measured_size,'sha256',f.sha256,'mime',f.mime),
   'member',jsonb_build_object('name',coalesce(p.display_name,''),'birthDate',p.birth_date),
   'cached',case when fr.id is null then null else jsonb_build_object('extraction',fr.extraction,'pageCount',fr.page_count,'provider',fr.provider,'model',fr.model)end,
   'visitTests',coalesce((select jsonb_agg(jsonb_build_object('id',t->>'id','title',t->>'title'))from jsonb_array_elements(coalesce(v.booking_context->'tests','[]'))t),'[]'),
   -- Earlier values a person already reviewed, for "what changed" (never unverified ones).
   'previous',coalesce((select jsonb_agg(jsonb_build_object('catalogueRef',x.catalogue_ref,'value',coalesce(x.corrected_value,x.value),'unit',coalesce(x.corrected_unit,x.unit),'collectedOn',x.collected_on)
     order by x.collected_on desc nulls last)from(select * from public.lab_ai_values x where x.user_id=j.user_id and x.status in('verified','corrected')and x.catalogue_ref is not null
     and coalesce(x.corrected_value,x.value)is not null and x.job_id<>j.id and public._lab_ai_current(x.attachment_id)order by x.collected_on desc nulls last limit 60)x),'[]')));
 end loop;
 return out;
end$$;

create or replace function public.lab_ai_job_finish(p_job uuid,p_lease uuid,p_result jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare j public.lab_ai_jobs;a public.clinic_result_attachments;disp text;oc text;idst text;x jsonb;n int:=0;pages int;md public.member_reported_documents;
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
 return jsonb_build_object('ok',true,'state','done','values',n);
end$$;

-- 7. Member: read and answer their own upload's reading -------------------------------------------------------
-- What the member sees: the reading's state and, once read, the values with their own answers. Never the
-- doctor-only attention marks, the lab's flags or the AI summary. A document that is not the caller's
-- reads as not found.
create function public._member_upload_ai_job_json(j public.lab_ai_jobs)returns jsonb language sql stable security definer set search_path=''as $$
 select jsonb_build_object('jobId',j.id,'state',j.state,'outcome',j.outcome,'createdAt',j.created_at,'finishedAt',j.finished_at,'identityStatus',j.identity_status,
  'sampleDate',j.identity->>'sampleDate',
  'confirmation',(select jsonb_build_object('identityAnswer',c.identity_answer,'valuesSaved',c.values_saved,'valuesCharted',c.values_charted,'measuredOn',c.measured_on,'at',c.created_at)
   from public.member_upload_ai_confirmations c where c.job_id=j.id),
  'valueCount',(select count(*)from public.member_upload_ai_values v where v.job_id=j.id))
$$;
create function public.member_upload_ai_overview()returns jsonb
language plpgsql stable security definer set search_path=''as $$
begin
 if auth.uid()is null then raise insufficient_privilege;end if;
 if not public._lab_ai_member_upload_enabled()then return jsonb_build_object('version','member-upload-ai-v1','enabled',false,'documents','[]'::jsonb);end if;
 return jsonb_build_object('version','member-upload-ai-v1','enabled',true,'documents',coalesce((select jsonb_agg(jsonb_build_object('documentId',d.id,'createdAt',d.created_at,
   'job',case when j.id is null then null else public._member_upload_ai_job_json(j)end)order by d.created_at desc)
  from public.member_reported_documents d left join public.lab_ai_jobs j on j.kind='member_upload'and j.member_document_id=d.id
  where d.user_id=auth.uid()and d.deleted_at is null),'[]'));
end$$;
create function public.member_upload_ai_read(p_document uuid)returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare d public.member_reported_documents;j public.lab_ai_jobs;
begin
 if auth.uid()is null then raise insufficient_privilege;end if;
 if not public._lab_ai_member_upload_enabled()then return jsonb_build_object('version','member-upload-ai-read-v1','enabled',false);end if;
 select * into d from public.member_reported_documents where id=p_document and user_id=auth.uid()and deleted_at is null;
 if not found then return jsonb_build_object('version','member-upload-ai-read-v1','enabled',true,'found',false);end if;
 select * into j from public.lab_ai_jobs where kind='member_upload'and member_document_id=d.id;
 return jsonb_build_object('version','member-upload-ai-read-v1','enabled',true,'found',true,'documentId',d.id,'fileName',d.file_name,'resultDate',d.result_date,
  'job',case when j.id is null then null else public._member_upload_ai_job_json(j)end,
  'values',coalesce((select jsonb_agg(jsonb_build_object('valueId',v.id,'seq',v.seq,'testName',v.test_name,'catalogueRef',v.catalogue_ref,'valueText',v.value_text,'value',v.value,'unit',v.unit,
    'collectedOn',v.collected_on,'measure',v.measure,'measureUnit',v.measure_unit,'checks',to_jsonb(v.checks),'memberStatus',v.member_status,'memberValue',v.member_value)order by v.seq)
   from public.member_upload_ai_values v where v.job_id=j.id),'[]'));
end$$;

-- The member answers once for a reading: every value is confirmed, corrected or rejected, and when the sheet
-- looked like someone else's, whether it is theirs. 'not_mine' rejects every value. Confirmed or corrected
-- values of a charted measure are added to member_reported_values (source 'ai_confirmed'). Resending the
-- same submission returns its recorded outcome.
create function public.member_upload_ai_confirm(p_command jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare uid uuid:=auth.uid();sub uuid;jid uuid;ans text;day date;j public.lab_ai_jobs;prior public.member_upload_ai_confirmations;md public.member_reported_documents;
 x jsonb;v public.member_upload_ai_values;act text;nv numeric;saved int:=0;charted int:=0;total int;listed int;
begin
 perform set_config('lock_timeout','1500ms',true);
 if uid is null then raise insufficient_privilege;end if;
 if jsonb_typeof(p_command)is distinct from 'object'or p_command-array['version','submissionId','jobId','identityAnswer','measuredOn','values']<>'{}'
  or not(p_command?&array['version','submissionId','jobId','values'])or p_command->>'version'is distinct from 'member-upload-confirm-v1'
  or jsonb_typeof(p_command->'values')is distinct from 'array'or jsonb_array_length(p_command->'values')>200
  or(p_command ? 'identityAnswer'and p_command->>'identityAnswer'not in('mine','not_mine'))then return jsonb_build_object('status','invalid');end if;
 begin sub:=(p_command->>'submissionId')::uuid;jid:=(p_command->>'jobId')::uuid;day:=(p_command->>'measuredOn')::date;
 exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then return jsonb_build_object('status','invalid');end;
 ans:=p_command->>'identityAnswer';
 if not public._lab_ai_member_upload_enabled()then return jsonb_build_object('status','disabled');end if;
 select * into prior from public.member_upload_ai_confirmations where submission_id=sub;
 if found then
  if prior.job_id<>jid or prior.member_id<>uid then return jsonb_build_object('status','stale');end if;
  return jsonb_build_object('status','saved','replayed',true,'charted',prior.values_charted);
 end if;
 select * into j from public.lab_ai_jobs where id=jid and kind='member_upload'and member_id=uid for update;
 if not found then return jsonb_build_object('status','stale');end if;
 select * into md from public.member_reported_documents where id=j.member_document_id;
 if j.state<>'done'or md.deleted_at is not null or j.identity_status not in('match','unknown','mismatch')then return jsonb_build_object('status','stale');end if;
 if exists(select 1 from public.member_upload_ai_confirmations where job_id=j.id)then return jsonb_build_object('status','unchanged');end if;
 if j.identity_status='mismatch'and ans is null then return jsonb_build_object('status','identity-first');end if;
 if day is not null and(day<date '1950-01-01'or day>(clock_timestamp()at time zone 'Asia/Yerevan')::date)then return jsonb_build_object('status','invalid');end if;
 -- Every value of the reading, once each.
 select count(*)into total from public.member_upload_ai_values where job_id=j.id;
 select count(distinct e->>'valueId')into listed from jsonb_array_elements(p_command->'values')e
  where jsonb_typeof(e)='object'and exists(select 1 from public.member_upload_ai_values w where w.job_id=j.id and w.id::text=e->>'valueId');
 if listed<>total or jsonb_array_length(p_command->'values')<>total then return jsonb_build_object('status','invalid');end if;
 begin
  for x in select * from jsonb_array_elements(p_command->'values')loop
   if x-array['valueId','action','value']<>'{}'or x->>'action'not in('confirm','correct','reject')
    or(x->>'action'='correct')<>(x ? 'value')or(x ? 'value'and jsonb_typeof(x->'value')<>'number')then raise invalid_parameter_value;end if;
   act:=case when ans='not_mine'then 'reject'else x->>'action'end;
   nv:=case when act='correct'then(x->>'value')::numeric end;
   if act='correct'and(nv<=-1e9 or nv>=1e9)then raise invalid_parameter_value;end if;
   select * into v from public.member_upload_ai_values where id=(x->>'valueId')::uuid and job_id=j.id for update;
   update public.member_upload_ai_values set member_status=case act when 'confirm'then 'confirmed'when 'correct'then 'corrected'else 'rejected'end,
    member_value=nv,member_reviewed_at=clock_timestamp()where id=v.id;
   if act<>'reject'then
    saved:=saved+1;
    if v.measure is not null and coalesce(nv,v.value)is not null then
     if coalesce(v.collected_on,day)is null then raise invalid_parameter_value;end if;
     insert into public.member_reported_values(user_id,source,ai_value_id,measure,value,value2,unit,measured_on)
      values(uid,'ai_confirmed',v.id,v.measure,coalesce(nv,v.value),null,v.measure_unit,coalesce(v.collected_on,day));
     charted:=charted+1;
    end if;
   end if;
  end loop;
 exception when check_violation or invalid_parameter_value or invalid_text_representation or numeric_value_out_of_range then
  return jsonb_build_object('status','invalid');
 end;
 insert into public.member_upload_ai_confirmations(job_id,member_id,submission_id,identity_status,identity_answer,measured_on,values_saved,values_charted)
  values(j.id,uid,sub,j.identity_status,case when j.identity_status='mismatch'or ans is not null then ans end,day,saved,charted);
 return jsonb_build_object('status','saved','replayed',false,'charted',charted);
exception when lock_not_available then return jsonb_build_object('status','unavailable');
end$$;

-- 8. Staff: AI-read lab results for one member (Khikar 18 Oct 14:38) ----------------------------------------
-- The assigned active doctor or an active administrator reads, for one member, every current clinic lab
-- document and every member upload with its AI reading: values, units, ranges, lab flags, the code checks
-- (the reader's reliability signal; the model gives no confidence score), each value's review state (the
-- doctor's for clinic values, the member's for uploads), identity and the AI summary. Read only: reviewing
-- stays with the doctor's own functions. Every read that shows something is recorded in access_audit.
-- Nurses, clinic users and members are refused.
create function public.staff_lab_ai_results(p_user_id uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare viewer text;r jsonb;
begin
 if exists(select 1 from public.workspace_staff s where s.user_id=auth.uid()and s.role='admin'and s.active and s.removed_at is null)
  and exists(select 1 from public.patient_clinical_cases c where c.user_id=p_user_id)then viewer:='admin';
 else perform public._assigned_active_doctor(p_user_id);viewer:='doctor';end if;
 if not public._lab_ai_enabled()then return jsonb_build_object('version','staff-lab-ai-v1','enabled',false,'viewer',viewer,'clinic','[]'::jsonb,'memberUploads','[]'::jsonb);end if;
 r:=jsonb_build_object('version','staff-lab-ai-v1','enabled',true,'viewer',viewer,
  -- The doctor's clinic documents follow document release (B5), as on the doctor's own screens.
  'clinic',case when viewer='admin'or public._doctor_completion_enabled()then coalesce((select jsonb_agg(jsonb_build_object('fileId',m.file_id,'name',m.name,'clinic',m.clinic_name,'uploadedAt',m.uploaded_at,
    'job',case when j.id is null then null else public._lab_ai_job_json(j)end,
    'values',coalesce((select jsonb_agg(jsonb_build_object('valueId',v.id,'seq',v.seq,'testName',v.test_name,'catalogueRef',v.catalogue_ref,'valueText',v.value_text,'value',v.value,'unit',v.unit,
      'refText',v.ref_text,'labFlag',v.lab_flag,'collectedOn',v.collected_on,'page',v.page,'checks',to_jsonb(v.checks),'attention',v.attention,'attentionRule',v.attention_rule,
      'status',v.status,'correctedValue',v.corrected_value,'correctedUnit',v.corrected_unit,'reviewedAt',v.reviewed_at)order by v.seq)from public.lab_ai_values v where v.job_id=j.id),'[]'))
    order by m.uploaded_at desc,m.file_id)
   from public._member_clinic_documents(p_user_id)m left join public.lab_ai_jobs j on j.attachment_id=m.attachment_id),'[]')else '[]'::jsonb end,
  'memberUploads',case when public._lab_ai_member_upload_enabled()then coalesce((select jsonb_agg(jsonb_build_object('documentId',d.id,'name',d.file_name,'uploadedAt',d.created_at,
    'job',case when j.id is null then null else jsonb_build_object('jobId',j.id,'state',j.state,'outcome',j.outcome,'pageCount',j.page_count,'identityStatus',j.identity_status,'identity',j.identity,
     'summary',j.summary,'provider',j.provider,'model',j.model,'createdAt',j.created_at,'finishedAt',j.finished_at,
     'confirmation',(select jsonb_build_object('identityAnswer',c.identity_answer,'valuesSaved',c.values_saved,'valuesCharted',c.values_charted,'at',c.created_at)
       from public.member_upload_ai_confirmations c where c.job_id=j.id))end,
    'values',coalesce((select jsonb_agg(jsonb_build_object('valueId',v.id,'seq',v.seq,'testName',v.test_name,'catalogueRef',v.catalogue_ref,'valueText',v.value_text,'value',v.value,'unit',v.unit,
      'refText',v.ref_text,'labFlag',v.lab_flag,'collectedOn',v.collected_on,'page',v.page,'checks',to_jsonb(v.checks),'attention',v.attention,'attentionRule',v.attention_rule,
      'memberStatus',v.member_status,'memberValue',v.member_value,'memberReviewedAt',v.member_reviewed_at)order by v.seq)from public.member_upload_ai_values v where v.job_id=j.id),'[]'))
    order by d.created_at desc)
   from public.member_reported_documents d left join public.lab_ai_jobs j on j.kind='member_upload'and j.member_document_id=d.id
   where d.user_id=p_user_id and d.deleted_at is null),'[]')else '[]'::jsonb end);
 perform public._access_audit_record(p_user_id,'lab_ai_results',null);
 return r;
end$$;

-- 9. RLS and grants: no direct table access; functions only ------------------------------------------------------
alter table public.member_upload_ai_values enable row level security;
alter table public.member_upload_ai_confirmations enable row level security;
revoke all on public.member_upload_ai_values,public.member_upload_ai_confirmations from public,anon,authenticated,service_role;
revoke all on function public._lab_ai_member_upload_enabled(),public._lab_ai_member_upload_daily_limit(),public._member_upload_ai_values_guard(),public._lab_ai_enqueue_member_upload(),
 public._member_upload_ai_job_json(public.lab_ai_jobs),public.member_upload_ai_overview(),public.member_upload_ai_read(uuid),public.member_upload_ai_confirm(jsonb),
 public.staff_lab_ai_results(uuid)from public,anon,authenticated,service_role;
grant execute on function public.member_upload_ai_overview(),public.member_upload_ai_read(uuid),public.member_upload_ai_confirm(jsonb),public.staff_lab_ai_results(uuid)to authenticated;
