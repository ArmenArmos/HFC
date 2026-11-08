-- Automatic reading of clinic lab PDFs, with an AI summary for the doctor (lead decision 17 Oct 2026
-- 19:18: model document input through the Vercel AI Gateway, not a native parser).
--
-- After a clinic PDF is attached to a member's visit, a job is queued. A server worker reads the
-- file (size, page, type and encryption limits in code), asks the high-tier model for strict JSON,
-- validates units and plausibility in code, checks the patient identity on the sheet against the
-- member, and records the values here as source 'ai_extracted', status 'unverified'.
--
-- Nothing here is a verified value. Only the assigned doctor, a person, can confirm, correct
-- (keeping the original) or reject a value, beside the PDF page it came from (Q9 pending). The
-- database refuses any other route to a reviewed status: the reviewer must be the signed-in assigned
-- doctor, never the service role. Critical values are flagged for the doctor only; nothing here
-- messages the member.
--
-- Off three ways: lab_ai_capabilities.enabled (false), the app flag NOREON_LAB_AI_ENABLED, and real
-- model calls need zoe_settings.model_calls_allowed, still CHECK-forced false, plus the app switches
-- NOREON_ZOE_MODEL_CALLS_ENABLED and NOREON_LAB_AI_PROVIDER=gateway. Every call is reserved against
-- the same per-tier and US$10 total daily caps as Zoe, under the same lock, and traced (tier, model,
-- tokens, cost). No PDF content, name or value is written to any log.

-- 1. Database switch ------------------------------------------------------------------------------------
create table public.lab_ai_capabilities(
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false
);
insert into public.lab_ai_capabilities(singleton,enabled)values(true,false);
create function public._lab_ai_enabled()returns boolean language sql stable security definer set search_path=''as $$
 select coalesce((select enabled from public.lab_ai_capabilities where singleton),false)
$$;

-- 2. Jobs: one per attachment (idempotent enqueue) ---------------------------------------------------------
create table public.lab_ai_jobs(
 id uuid primary key default gen_random_uuid(),
 -- 'file': read once after a clinic upload, before any link, to suggest a member of this clinic.
 -- 'attachment': the reading for the member the file is linked to (reuses the file reading when there is one).
 kind text not null default 'attachment'check(kind in('file','attachment')),
 attachment_id uuid unique references public.clinic_result_attachments(id),
 file_id uuid not null references public.clinic_batch_files(id),
 clinic_id uuid references public.workspace_clinics(id),
 user_id uuid references public.patient_clinical_cases(user_id),
 state text not null default 'queued'check(state in('queued','running','done','rejected','failed')),
 attempts smallint not null default 0 check(attempts between 0 and 3),
 next_attempt_at timestamptz not null default clock_timestamp(),
 lease_token uuid,
 lease_until timestamptz,
 outcome text check(outcome ~ '^[a-z0-9_]{1,60}$'),
 page_count smallint check(page_count between 1 and 10),
 source_sha256 text check(source_sha256 ~ '^[a-f0-9]{64}$'),
 -- What the sheet says about the patient, for the person who checks it. Staff reads only.
 identity_status text check(identity_status in('match','unknown','mismatch','multiple_patients')),
 identity jsonb check(identity is null or(jsonb_typeof(identity)='object'and length(identity::text)<=4000)),
 identity_confirmed_by uuid references auth.users(id),
 identity_confirmed_at timestamptz,
 identity_note text check(length(identity_note)between 1 and 300),
 -- Prepared by AI, not reviewed by a doctor. Structure follows the GP report template.
 summary jsonb check(summary is null or(jsonb_typeof(summary)='object'and length(summary::text)<=20000)),
 -- File reading only: the checked extraction (reused when the file is linked) and member suggestions,
 -- each a member with a booking at this clinic.
 extraction jsonb check(extraction is null or(jsonb_typeof(extraction)='object'and length(extraction::text)<=200000)),
 suggestions jsonb check(suggestions is null or(jsonb_typeof(suggestions)='array'and jsonb_array_length(suggestions)<=3)),
 provider text check(provider ~ '^[a-z0-9_.-]{1,64}$'),
 model text check(model ~ '^[a-z0-9_.:/-]{1,80}$'),
 requested_by uuid references auth.users(id),
 created_at timestamptz not null default clock_timestamp(),
 started_at timestamptz,
 finished_at timestamptz,
 check((state='running')=(lease_token is not null and lease_until is not null)),
 check(state not in('done','rejected','failed')or(outcome is not null and finished_at is not null)),
 check((identity_confirmed_by is null)=(identity_confirmed_at is null)),
 check(identity_status is distinct from 'multiple_patients'or identity_confirmed_by is null),
 check(case kind when 'file'then attachment_id is null and user_id is null and clinic_id is not null and summary is null and identity_confirmed_by is null
  else attachment_id is not null and user_id is not null and extraction is null and suggestions is null end)
);
create unique index lab_ai_jobs_one_file_reading on public.lab_ai_jobs(file_id)where kind='file';
create index lab_ai_jobs_due on public.lab_ai_jobs(next_attempt_at)where state='queued';
create index lab_ai_jobs_running on public.lab_ai_jobs(lease_until)where state='running';
create index lab_ai_jobs_member on public.lab_ai_jobs(user_id,file_id);

-- 3. Calls: the trace and the spend ledger (no content) -----------------------------------------------------
create table public.lab_ai_calls(
 id uuid primary key default gen_random_uuid(),
 job_id uuid not null references public.lab_ai_jobs(id),
 purpose text not null check(purpose in('extract','summary')),
 tier text not null check(tier in('low','medium','high')),
 model text not null check(model ~ '^[a-z0-9_.:/-]{1,80}$'),
 local boolean not null,
 spend_day date not null,
 estimate_usd numeric(10,6)not null check(estimate_usd>=0 and estimate_usd<=100),
 reserved boolean not null,
 refusal text check(refusal ~ '^[a-z0-9_]{1,60}$'),
 provider text check(provider ~ '^[a-z0-9_.-]{1,64}$'),
 response_model text check(response_model ~ '^[A-Za-z0-9_.:/@-]{1,80}$'),
 outcome text check(outcome ~ '^[a-z0-9_]{1,60}$'),
 input_tokens integer check(input_tokens>=0),
 output_tokens integer check(output_tokens>=0),
 cost_usd numeric(10,6)check(cost_usd>=0 and cost_usd<=100),
 latency_ms integer check(latency_ms>=0),
 fallback_used boolean not null default false,
 created_at timestamptz not null default clock_timestamp(),
 finished_at timestamptz,
 check(reserved=(refusal is null)),
 check(cost_usd is null or reserved)
);
create index lab_ai_calls_spend on public.lab_ai_calls(spend_day,tier)where reserved;
create index lab_ai_calls_job on public.lab_ai_calls(job_id,created_at);

-- 4. Values: AI-read, unverified until a person reviews them ------------------------------------------------
create table public.lab_ai_values(
 id uuid primary key default gen_random_uuid(),
 job_id uuid not null references public.lab_ai_jobs(id),
 user_id uuid not null references public.patient_clinical_cases(user_id),
 file_id uuid not null references public.clinic_batch_files(id),
 attachment_id uuid not null references public.clinic_result_attachments(id),
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
 -- Code checks that failed (unknown unit, implausible value, unmapped test, future date...).
 checks text[]not null default '{}'check(cardinality(checks)<=10),
 -- For the doctor only: a THRESHOLD rule matched, the lab marked it critical, or it needs attention.
 attention text check(attention in('threshold','lab_critical','needs_doctor')),
 attention_rule text check(attention_rule ~ '^[A-Za-z0-9_.:-]{1,60}$'),
 status text not null default 'unverified'check(status in('unverified','verified','corrected','rejected')),
 corrected_value numeric check(corrected_value is null or(corrected_value>-1e9 and corrected_value<1e9)),
 corrected_unit text check(length(corrected_unit)between 1 and 30),
 review_note text check(length(review_note)between 1 and 300),
 reviewed_by uuid references auth.users(id),
 reviewed_at timestamptz,
 created_at timestamptz not null default clock_timestamp(),
 unique(job_id,seq),
 check(ref_low is null or ref_high is null or ref_low<=ref_high),
 check((status='unverified')=(reviewed_by is null)),
 check((reviewed_by is null)=(reviewed_at is null)),
 check(status='corrected'or(corrected_value is null and corrected_unit is null)),
 check(status<>'corrected'or corrected_value is not null),
 check(attention_rule is null or attention is not null)
);
create index lab_ai_values_member on public.lab_ai_values(user_id,status);

-- A value is born unverified, its AI fields never change, and only a signed-in person (the assigned
-- doctor, through lab_ai_value_review) can set a reviewed status. The service role has no auth.uid().
create function public._lab_ai_values_guard()returns trigger language plpgsql set search_path=''as $$
begin
 if tg_op='DELETE'then raise exception using errcode='55000',message='AI-read values are kept';end if;
 if tg_op='INSERT'then
  if new.status<>'unverified'or new.reviewed_by is not null or new.corrected_value is not null then
   raise exception using errcode='42501',message='AI-read values start unverified';end if;
  return new;
 end if;
 if(new.id,new.job_id,new.user_id,new.file_id,new.attachment_id,new.seq,new.source,new.test_name,new.catalogue_ref,new.value_text,new.value,new.unit,new.ref_low,new.ref_high,
   new.ref_text,new.lab_flag,new.collected_on,new.lab_name,new.page,new.snippet,new.checks,new.attention,new.attention_rule,new.created_at)
  is distinct from(old.id,old.job_id,old.user_id,old.file_id,old.attachment_id,old.seq,old.source,old.test_name,old.catalogue_ref,old.value_text,old.value,old.unit,old.ref_low,old.ref_high,
   old.ref_text,old.lab_flag,old.collected_on,old.lab_name,old.page,old.snippet,old.checks,old.attention,old.attention_rule,old.created_at)then
  raise exception using errcode='55000',message='The AI reading is kept as it was';end if;
 if new.status<>'unverified'and(auth.uid()is null or new.reviewed_by is distinct from auth.uid()
  or not exists(select 1 from public.workspace_staff s where s.user_id=auth.uid()and s.role='doctor'and s.active)
  or not exists(select 1 from public.patient_clinical_cases c where c.user_id=new.user_id and c.assigned_doctor_id=auth.uid()))then
  raise exception using errcode='42501',message='Only the assigned doctor reviews a value';end if;
 if new.status='unverified'and old.status<>'unverified'then raise exception using errcode='55000',message='A review is not undone';end if;
 return new;
end$$;
create trigger lab_ai_values_guard before insert or update or delete on public.lab_ai_values for each row execute function public._lab_ai_values_guard();

-- Review history (append-only).
create table public.lab_ai_value_reviews(
 id bigint generated always as identity primary key,
 value_id uuid not null references public.lab_ai_values(id),
 submission_id uuid not null unique,
 actor_id uuid not null references auth.users(id),
 action text not null check(action in('confirm','correct','reject')),
 before jsonb not null,
 after jsonb not null,
 created_at timestamptz not null default clock_timestamp()
);
create trigger lab_ai_value_reviews_immutable before update or delete on public.lab_ai_value_reviews for each row execute function public._patient_visit_immutable();

-- 5. Enqueue on attach --------------------------------------------------------------------------------------
create function public._lab_ai_enqueue()returns trigger language plpgsql security definer set search_path=''as $$
begin
 if public._lab_ai_enabled()then
  insert into public.lab_ai_jobs(attachment_id,file_id,user_id)values(new.id,new.file_id,new.user_id)on conflict(attachment_id)do nothing;
 end if;
 return new;
end$$;
create trigger clinic_result_attachments_lab_ai after insert on public.clinic_result_attachments for each row execute function public._lab_ai_enqueue();
-- A clinic upload that reaches "stored" is read once to suggest a member.
create function public._lab_ai_enqueue_file()returns trigger language plpgsql security definer set search_path=''as $$
begin
 if new.state='stored'and(tg_op='INSERT'or old.state is distinct from 'stored')and public._lab_ai_enabled()then
  insert into public.lab_ai_jobs(kind,file_id,clinic_id)select 'file',new.id,b.clinic_id from public.clinic_batches b where b.id=new.batch_id
  on conflict(file_id)where kind='file'do nothing;
 end if;
 return new;
end$$;
create trigger clinic_batch_files_lab_ai after insert or update of state on public.clinic_batch_files for each row execute function public._lab_ai_enqueue_file();

-- Current = the file's latest attachment, to this member, not detached (same rule as document release).
create function public._lab_ai_current(p_attachment uuid)returns boolean language sql stable security definer set search_path=''as $$
 select exists(select 1 from public.clinic_result_attachments a join public.clinic_batch_files f on f.id=a.file_id
  where a.id=p_attachment and f.state='stored'and(public._clinic_result_current(a.file_id)).id=a.id
  and not exists(select 1 from public.clinic_result_detachments d where d.attachment_id=a.id))
$$;

-- 6. Shared daily spend (Zoe and lab reading count against the same caps) -----------------------------------
create function public._ai_spend(p_day date,p_tier text)returns table(total numeric,tier_total numeric)
language sql stable security definer set search_path=''as $$
 select coalesce((select sum(coalesce(cost_usd,estimate_usd))from public.zoe_runs where spend_day=p_day and reserved),0)
       +coalesce((select sum(coalesce(cost_usd,estimate_usd))from public.lab_ai_calls where spend_day=p_day and reserved),0),
        coalesce((select sum(coalesce(cost_usd,estimate_usd))from public.zoe_runs where spend_day=p_day and reserved and tier=p_tier),0)
       +coalesce((select sum(coalesce(cost_usd,estimate_usd))from public.lab_ai_calls where spend_day=p_day and reserved and tier=p_tier),0)
$$;

-- Zoe's reservation, unchanged except that lab reading spend now counts (20261017135503 §11).
create or replace function public.zoe_run_reserve(p_run uuid,p_estimate_usd numeric,p_local boolean,p_events jsonb,p_tier text,p_model text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare r public.zoe_runs;s public.zoe_settings;c public.zoe_tier_config;spent numeric;tier_spent numeric;cap numeric;tier_cap numeric;code text;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if p_estimate_usd is null or p_estimate_usd<0 or p_estimate_usd>100 or p_local is null or p_tier is null or p_tier not in('low','medium','high')
  or coalesce(p_model,'')!~'^[a-z0-9_.:/-]{1,80}$'then return jsonb_build_object('ok',false,'code','invalid');end if;
 perform pg_advisory_xact_lock(hashtextextended('zoe-spend-cap',0));
 select * into r from public.zoe_runs where id=p_run for update;
 if not found or r.state<>'started'or r.reserved then return jsonb_build_object('ok',false,'code','run_not_reservable');end if;
 perform public._zoe_run_events(r,p_events);
 select * into s from public.zoe_settings where singleton;
 select * into c from public.zoe_tier_config where tier=p_tier;
 cap:=least(coalesce(s.daily_spend_cap_usd,0),10);
 tier_cap:=least(coalesce(c.daily_cap_usd,0),cap);
 select x.total,x.tier_total into spent,tier_spent from public._ai_spend(r.spend_day,p_tier)x;
 code:=case when not p_local and not coalesce(s.model_calls_allowed,false)then 'model_calls_not_permitted'
  when c.tier is null then 'tier_not_configured'
  when not p_local and p_model is distinct from c.model_id and p_model is distinct from c.fallback_model_id then 'model_not_configured_for_tier'
  when tier_spent+p_estimate_usd>tier_cap then 'tier_spend_cap_reached'
  when spent+p_estimate_usd>cap then 'daily_spend_cap_reached'end;
 update public.zoe_runs set tier=p_tier where id=r.id;
 if code is null then update public.zoe_runs set reserved=true,estimate_usd=p_estimate_usd where id=r.id;end if;
 perform public._zoe_run_events(r,jsonb_build_array(jsonb_build_object('name','zoe.spend.reserve','outcome',case when code is null then 'allow'else 'block'end,
  'reason',coalesce(code,'within_daily_spend_cap'),'rule',case when code='model_calls_not_permitted'then 'zoe.k2.launch_gate'else 'zoe.k7.daily_spend_cap'end,'ruleVersion','k7-a-2026-10-17-tiers','actor','system',
  'attributes',jsonb_build_object('noreon.zoe.guard.name','spend_cap','noreon.zoe.spent_today_usd',spent,'noreon.zoe.estimate_usd',p_estimate_usd,'noreon.zoe.daily_cap_usd',cap,
   'noreon.zoe.tier',p_tier,'noreon.zoe.tier_spent_today_usd',tier_spent,'noreon.zoe.tier_cap_usd',tier_cap,
   'noreon.zoe.spend_day',r.spend_day::text,'noreon.zoe.provider_local',p_local))));
 return case when code is null then jsonb_build_object('ok',true)else jsonb_build_object('ok',false,'code',code)end;
end$$;

-- The AI settings page shows what was spent today across Zoe and lab reading. Body unchanged from
-- 20261017144511_zoe_model_catalog_providers.sql except the two spend sums.
create or replace function public.zoe_ai_settings_admin()returns jsonb
language plpgsql security definer set search_path=''as $$
declare s public.zoe_settings;today date;
begin
 perform public._real_staff_require_admin();
 select * into s from public.zoe_settings where singleton;
 today:=(clock_timestamp()at time zone coalesce(s.time_zone,'Asia/Yerevan'))::date;
 return jsonb_build_object('ok',true,
  'modelCallsAllowed',coalesce(s.model_calls_allowed,false),'settingsRow',s.singleton is not null,
  'totalCapUsd',least(coalesce(s.daily_spend_cap_usd,0),10),'spendDay',today,
  'spentTodayUsd',(select x.total from public._ai_spend(today,null)x),
  'tiers',(select jsonb_agg(public._zoe_tier_json(c)||jsonb_build_object('tier',c.tier,'updatedAt',c.updated_at,
    'spentTodayUsd',(select x.tier_total from public._ai_spend(today,c.tier)x))
   order by public._zoe_tier_rank(c.tier))from public.zoe_tier_config c),
  'providers',coalesce((select jsonb_agg(jsonb_build_object('id',p.provider,'label',p.label,'dataAgreement',p.data_agreement)order by p.label)from public.zoe_model_providers p),'[]'),
  'catalog',(select jsonb_agg(jsonb_build_object('id',model_id,'label',label,'provider',provider,'strength',strength,
    'inputUsdPerMTok',input_usd_per_mtok,'outputUsdPerMTok',output_usd_per_mtok)order by strength,model_id)from public.zoe_model_catalog where enabled),
  'changes',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'tier',x.tier,'action',x.action,'before',x.before,'after',x.after,'evalRunId',x.eval_run_id,
    'rolledBackChangeId',x.rolled_back_change_id,'reason',x.reason,'actor',coalesce((select display_name from public.workspace_staff w where w.user_id=x.actor),'Admin'),'at',x.created_at)order by x.id desc)
   from(select * from public.zoe_tier_config_changes order by id desc limit 30)x),'[]'),
  'evalRuns',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'tier',e.tier,'model',e.model_id,'fallback',e.fallback_model_id,'mode',e.mode,'harnessVersion',e.harness_version,
    'totalRows',e.total_rows,'mustFailures',e.must_failures,'failures',e.failures,'failedIds',to_jsonb(e.failed_ids),'used',e.used_at is not null,'at',e.created_at)order by e.created_at desc)
   from(select * from public.zoe_eval_runs order by created_at desc limit 10)e),'[]'));
end$$;

-- 7. Worker (service role) -----------------------------------------------------------------------------------
-- Bookings a clinic's result may be linked to (Khikar, 17 Oct 19:19): a confirmed booking with THIS clinic
-- from 120 days ago up to now (a result cannot belong to a visit that has not started, Fable R5). No arrival or
-- recorded sample is needed. Never another clinic's.
create function public._lab_clinic_bookings(p_clinic uuid)returns table(member_id uuid,appointment_id uuid,starts_at timestamptz)
language sql stable security definer set search_path=''as $$
 select a.member_id,a.id,(a.current_arrangement->>'startsAt')::timestamptz from public.booking_appointments a
 where a.status='confirmed'and a.current_arrangement->>'clinicId'=p_clinic::text and a.current_reservation_id is not null
  and(a.current_arrangement->>'startsAt')::timestamptz between clock_timestamp()-interval '120 days'and clock_timestamp()
  and exists(select 1 from public.booking_scheduling_notices n where n.appointment_id=a.id and n.clinic_id=p_clinic and n.state='accepted')
  and exists(select 1 from public.patient_clinical_cases c where c.user_id=a.member_id)
$$;

-- Claim due jobs. A running job whose lease ran out (the worker died) is claimed again and counts as
-- an attempt; after three attempts it fails. A member job whose attachment is no longer current, or a
-- file reading whose file is already linked or gone, is closed.
create function public.lab_ai_job_claim(p_limit integer)returns jsonb
language plpgsql security definer set search_path=''as $$
declare j public.lab_ai_jobs;out jsonb:='[]';f public.clinic_batch_files;a public.clinic_result_attachments;p public.profiles;v public.patient_care_visits;fr public.lab_ai_jobs;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if not public._lab_ai_enabled()then return out;end if;
 for j in select * from public.lab_ai_jobs where(state='queued'and next_attempt_at<=clock_timestamp())or(state='running'and lease_until<clock_timestamp())
  order by next_attempt_at,id limit least(greatest(coalesce(p_limit,1),1),5)for update skip locked loop
  select * into f from public.clinic_batch_files where id=j.file_id;
  if(j.kind='attachment'and not public._lab_ai_current(j.attachment_id))or(j.kind='file'and(f.state<>'stored'or exists(select 1 from public.clinic_result_attachments x where x.file_id=f.id)))then
   update public.lab_ai_jobs set state='rejected',outcome=case j.kind when 'file'then 'file_already_linked'else 'attachment_not_current'end,lease_token=null,lease_until=null,finished_at=clock_timestamp()where id=j.id;continue;
  end if;
  if j.attempts>=3 then
   update public.lab_ai_jobs set state='failed',outcome=case when j.state='running'then 'lease_lost'else coalesce(j.outcome,'retries_exhausted')end,lease_token=null,lease_until=null,finished_at=clock_timestamp()where id=j.id;continue;
  end if;
  update public.lab_ai_jobs set state='running',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '10 minutes',started_at=clock_timestamp()
   where id=j.id returning * into j;
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

-- Whether a non-local reader may run at all, read before claiming so jobs are not downloaded and
-- deferred over and over while model calls are not permitted (Fable F5).
create function public.lab_ai_reading_state()returns jsonb
language plpgsql stable security definer set search_path=''as $$
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 return jsonb_build_object('enabled',public._lab_ai_enabled(),'modelCallsAllowed',coalesce((select model_calls_allowed from public.zoe_settings where singleton),false));
end$$;

-- Reserve one model call for a running job, under the Zoe spend lock and caps. A job makes at most six.
create function public.lab_ai_call_reserve(p_job uuid,p_lease uuid,p_purpose text,p_tier text,p_model text,p_local boolean,p_estimate_usd numeric)returns jsonb
language plpgsql security definer set search_path=''as $$
declare j public.lab_ai_jobs;s public.zoe_settings;c public.zoe_tier_config;spent numeric;tier_spent numeric;cap numeric;tier_cap numeric;code text;day date;v_call uuid;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if p_purpose is null or p_purpose not in('extract','summary')or p_tier is null or p_tier not in('low','medium','high')or coalesce(p_model,'')!~'^[a-z0-9_.:/-]{1,80}$'
  or p_local is null or p_estimate_usd is null or p_estimate_usd<0 or p_estimate_usd>100 then return jsonb_build_object('ok',false,'code','invalid');end if;
 perform pg_advisory_xact_lock(hashtextextended('zoe-spend-cap',0));
 select * into j from public.lab_ai_jobs where id=p_job for update;
 if not found or j.state<>'running'or j.lease_token is distinct from p_lease then return jsonb_build_object('ok',false,'code','job_not_running');end if;
 if(select count(*)from public.lab_ai_calls where job_id=j.id)>=6 then return jsonb_build_object('ok',false,'code','job_call_limit');end if;
 select * into s from public.zoe_settings where singleton;
 select * into c from public.zoe_tier_config where tier=p_tier;
 day:=(clock_timestamp()at time zone coalesce(s.time_zone,'Asia/Yerevan'))::date;
 cap:=least(coalesce(s.daily_spend_cap_usd,0),10);
 tier_cap:=least(coalesce(c.daily_cap_usd,0),cap);
 select x.total,x.tier_total into spent,tier_spent from public._ai_spend(day,p_tier)x;
 code:=case when not p_local and not coalesce(s.model_calls_allowed,false)then 'model_calls_not_permitted'
  when c.tier is null then 'tier_not_configured'
  when not p_local and p_model is distinct from c.model_id and p_model is distinct from c.fallback_model_id then 'model_not_configured_for_tier'
  when tier_spent+p_estimate_usd>tier_cap then 'tier_spend_cap_reached'
  when spent+p_estimate_usd>cap then 'daily_spend_cap_reached'end;
 insert into public.lab_ai_calls(job_id,purpose,tier,model,local,spend_day,estimate_usd,reserved,refusal)
  values(j.id,p_purpose,p_tier,p_model,p_local,day,p_estimate_usd,code is null,code)returning lab_ai_calls.id into v_call;
 return case when code is null then jsonb_build_object('ok',true,'callId',v_call)else jsonb_build_object('ok',false,'code',code,'callId',v_call)end;
end$$;

-- Record a call's result once: provider, model, tokens, cost and latency. Never content.
create function public.lab_ai_call_finish(p_call uuid,p_result jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare k public.lab_ai_calls;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 select * into k from public.lab_ai_calls where id=p_call for update;
 if not found or not k.reserved then return jsonb_build_object('ok',false,'code','call_unknown');end if;
 if k.finished_at is not null then return jsonb_build_object('ok',true,'replayed',true);end if;
 if jsonb_typeof(p_result)is distinct from 'object'or coalesce(p_result->>'outcome','')!~'^[a-z0-9_]{1,60}$'or coalesce(p_result->>'provider','')!~'^[a-z0-9_.-]{1,64}$'
  or(p_result ? 'responseModel'and coalesce(p_result->>'responseModel','')!~'^[A-Za-z0-9_.:/@-]{1,80}$')
  or coalesce((p_result->>'costUsd')::numeric,0)not between 0 and 100 or coalesce((p_result->>'inputTokens')::integer,0)<0 or coalesce((p_result->>'outputTokens')::integer,0)<0
  or coalesce((p_result->>'latencyMs')::integer,0)<0 then return jsonb_build_object('ok',false,'code','invalid');end if;
 update public.lab_ai_calls set provider=p_result->>'provider',response_model=p_result->>'responseModel',outcome=p_result->>'outcome',input_tokens=(p_result->>'inputTokens')::integer,
  output_tokens=(p_result->>'outputTokens')::integer,cost_usd=coalesce((p_result->>'costUsd')::numeric,0),latency_ms=(p_result->>'latencyMs')::integer,
  fallback_used=coalesce((p_result->>'fallbackUsed')::boolean,false),finished_at=clock_timestamp()where id=k.id;
 return jsonb_build_object('ok',true,'replayed',false);
end$$;

-- Finish a job once. disposition:
--  done      values (only for match, unknown or mismatch identity; none for several patients), identity, summary;
--  rejected  the file broke a limit (size, pages, type, encryption, malformed, hash); final;
--  retry     a provider or output error; queued again with backoff, failed after the third attempt;
--  defer     calls are switched off or a spend cap was reached; queued again, the attempt not counted.
create function public.lab_ai_job_finish(p_job uuid,p_lease uuid,p_result jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare j public.lab_ai_jobs;a public.clinic_result_attachments;disp text;oc text;idst text;x jsonb;n int:=0;pages int;
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

-- 8. Doctor (assigned, active; same switch as document release plus this one) -------------------------------
create function public._lab_ai_job_json(j public.lab_ai_jobs)returns jsonb language sql stable security definer set search_path=''as $$
 select jsonb_build_object('jobId',j.id,'fileId',j.file_id,'state',j.state,'outcome',j.outcome,'attempts',j.attempts,'pageCount',j.page_count,
  'identityStatus',j.identity_status,'identity',j.identity,'identityConfirmedAt',j.identity_confirmed_at,'identityNote',j.identity_note,
  'summary',j.summary,'provider',j.provider,'model',j.model,'createdAt',j.created_at,'finishedAt',j.finished_at,
  'counts',(select jsonb_build_object('total',count(*),'unverified',count(*)filter(where status='unverified'),'verified',count(*)filter(where status in('verified','corrected')),
    'rejected',count(*)filter(where status='rejected'),'attention',count(*)filter(where attention is not null and status<>'rejected'))from public.lab_ai_values where job_id=j.id),
  'calls',(select jsonb_build_object('count',count(*),'costUsd',coalesce(sum(cost_usd),0),'models',coalesce(jsonb_agg(distinct model)filter(where reserved),'[]'))from public.lab_ai_calls where job_id=j.id))
$$;

-- Overview for the member page: the reading state of each current clinic document.
create function public.doctor_lab_ai_overview(p_user_id uuid)returns jsonb
language plpgsql stable security definer set search_path=''as $$
begin
 perform public._assigned_active_doctor(p_user_id);
 if not public._doctor_completion_enabled()or not public._lab_ai_enabled()then return jsonb_build_object('version','lab-ai-overview-v1','enabled',false,'files','[]'::jsonb);end if;
 return jsonb_build_object('version','lab-ai-overview-v1','enabled',true,'files',coalesce((select jsonb_agg(jsonb_build_object('fileId',m.file_id)||
   case when j.id is null then jsonb_build_object('state','not_requested')else public._lab_ai_job_json(j)-'identity'-'summary'
    ||jsonb_build_object('hasSummary',j.summary is not null)end order by m.uploaded_at desc,m.file_id)
  from public._member_clinic_documents(p_user_id)m left join public.lab_ai_jobs j on j.attachment_id=m.attachment_id),'[]'));
end$$;

-- The verification screen: the job, its values and the summary for one current document.
create function public.doctor_lab_ai_read(p_user_id uuid,p_file uuid)returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare d uuid;m record;j public.lab_ai_jobs;
begin
 d:=public._assigned_active_doctor(p_user_id);
 if not public._doctor_completion_enabled()or not public._lab_ai_enabled()then return jsonb_build_object('version','lab-ai-read-v1','enabled',false);end if;
 select * into m from public._member_clinic_documents(p_user_id)x where x.file_id=p_file;
 if not found then raise insufficient_privilege;end if;
 select * into j from public.lab_ai_jobs where attachment_id=m.attachment_id;
 return jsonb_build_object('version','lab-ai-read-v1','enabled',true,'fileId',p_file,'name',m.name,'clinic',m.clinic_name,'uploadedAt',m.uploaded_at,
  'openedByYou',exists(select 1 from public.patient_document_opens o where o.file_id=p_file and o.attachment_id=m.attachment_id and o.actor_id=d and o.actor_kind='doctor'),
  'job',case when j.id is null then null else public._lab_ai_job_json(j)end,
  'values',coalesce((select jsonb_agg(jsonb_build_object('valueId',v.id,'seq',v.seq,'testName',v.test_name,'catalogueRef',v.catalogue_ref,'valueText',v.value_text,'value',v.value,'unit',v.unit,
    'refLow',v.ref_low,'refHigh',v.ref_high,'refText',v.ref_text,'labFlag',v.lab_flag,'collectedOn',v.collected_on,'labName',v.lab_name,'page',v.page,'snippet',v.snippet,'checks',to_jsonb(v.checks),
    'attention',v.attention,'attentionRule',v.attention_rule,'status',v.status,'correctedValue',v.corrected_value,'correctedUnit',v.corrected_unit,'reviewNote',v.review_note,'reviewedAt',v.reviewed_at,
    'reviewedByYou',v.reviewed_by=d)order by v.seq)from public.lab_ai_values v where v.job_id=j.id),'[]'));
end$$;

-- Ask for a reading (first time, or again after a failure). A rejected file stays rejected: the same
-- bytes would break the same limit.
create function public.doctor_lab_ai_request(p_user_id uuid,p_file uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare d uuid;m record;j public.lab_ai_jobs;
begin
 perform set_config('lock_timeout','1500ms',true);
 d:=public._assigned_active_doctor(p_user_id);
 if not public._doctor_completion_enabled()or not public._lab_ai_enabled()then return jsonb_build_object('status','disabled');end if;
 select * into m from public._member_clinic_documents(p_user_id)x where x.file_id=p_file;
 if not found then return jsonb_build_object('status','stale');end if;
 insert into public.lab_ai_jobs(attachment_id,file_id,user_id,requested_by)values(m.attachment_id,p_file,p_user_id,d)on conflict(attachment_id)do nothing returning * into j;
 if j.id is not null then return jsonb_build_object('status','queued');end if;
 select * into j from public.lab_ai_jobs where attachment_id=m.attachment_id for update;
 if j.state='failed'then
  update public.lab_ai_jobs set state='queued',attempts=0,outcome=null,next_attempt_at=clock_timestamp(),finished_at=null,requested_by=d where id=j.id;
  return jsonb_build_object('status','queued');
 end if;
 return jsonb_build_object('status','unchanged','state',j.state);
exception when lock_not_available then return jsonb_build_object('status','unavailable');
end$$;

-- Confirm that the PDF belongs to this member when the sheet's identity did not clearly match. A
-- mismatch needs a reason. The doctor must have opened the PDF. Several patients cannot be confirmed.
create function public.doctor_lab_ai_identity_confirm(p_command jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare d uuid;m uuid;jid uuid;j public.lab_ai_jobs;note text;
begin
 perform set_config('lock_timeout','1500ms',true);
 if jsonb_typeof(p_command)is distinct from 'object'or p_command-array['version','memberId','jobId','note']<>'{}'or not(p_command?&array['version','memberId','jobId'])
  or p_command->>'version'is distinct from 'lab-ai-identity-v1'then return jsonb_build_object('status','invalid');end if;
 begin m:=(p_command->>'memberId')::uuid;jid:=(p_command->>'jobId')::uuid;exception when invalid_text_representation then return jsonb_build_object('status','invalid');end;
 note:=nullif(btrim(coalesce(p_command->>'note','')),'');
 if length(note)>300 then return jsonb_build_object('status','invalid');end if;
 d:=public._assigned_active_doctor(m);
 if not public._doctor_completion_enabled()or not public._lab_ai_enabled()then return jsonb_build_object('status','disabled');end if;
 select * into j from public.lab_ai_jobs where id=jid and user_id=m for update;
 if not found or j.state<>'done'or not public._lab_ai_current(j.attachment_id)then return jsonb_build_object('status','stale');end if;
 if j.identity_confirmed_at is not null or j.identity_status='match'then return jsonb_build_object('status','unchanged');end if;
 if j.identity_status='multiple_patients'then return jsonb_build_object('status','not-allowed');end if;
 if j.identity_status='mismatch'and note is null then return jsonb_build_object('status','reason-required');end if;
 if not exists(select 1 from public.patient_document_opens o where o.file_id=j.file_id and o.attachment_id=j.attachment_id and o.actor_id=d and o.actor_kind='doctor')then
  return jsonb_build_object('status','open-first');end if;
 update public.lab_ai_jobs set identity_confirmed_by=d,identity_confirmed_at=clock_timestamp(),identity_note=note where id=j.id;
 return jsonb_build_object('status','confirmed');
exception when lock_not_available then return jsonb_build_object('status','unavailable');
end$$;

-- Review one value: confirm, correct (the AI reading is kept) or reject. Resending a submission
-- returns its recorded outcome.
create function public.doctor_lab_ai_value_review(p_command jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare d uuid;sub uuid;m uuid;vid uuid;act text;v public.lab_ai_values;j public.lab_ai_jobs;prior public.lab_ai_value_reviews;nv numeric;nu text;note text;before_v jsonb;
begin
 perform set_config('lock_timeout','1500ms',true);
 if jsonb_typeof(p_command)is distinct from 'object'or p_command-array['version','submissionId','memberId','valueId','action','value','unit','note']<>'{}'
  or not(p_command?&array['version','submissionId','memberId','valueId','action'])or p_command->>'version'is distinct from 'lab-ai-review-v1'
  or p_command->>'action'not in('confirm','correct','reject')then return jsonb_build_object('status','invalid');end if;
 begin sub:=(p_command->>'submissionId')::uuid;m:=(p_command->>'memberId')::uuid;vid:=(p_command->>'valueId')::uuid;
  nv:=case when p_command ? 'value'and jsonb_typeof(p_command->'value')='number'then(p_command->>'value')::numeric end;
 exception when invalid_text_representation then return jsonb_build_object('status','invalid');end;
 act:=p_command->>'action';nu:=nullif(btrim(coalesce(p_command->>'unit','')),'');note:=nullif(btrim(coalesce(p_command->>'note','')),'');
 if length(nu)>30 or length(note)>300 or(act='correct'and(nv is null or nv<=-1e9 or nv>=1e9))or(act<>'correct'and(p_command ? 'value'or p_command ? 'unit'))then
  return jsonb_build_object('status','invalid');end if;
 d:=public._assigned_active_doctor(m);
 if not public._doctor_completion_enabled()or not public._lab_ai_enabled()then return jsonb_build_object('status','disabled');end if;
 select * into prior from public.lab_ai_value_reviews where submission_id=sub;
 if found then
  if prior.value_id<>vid or prior.actor_id<>d or prior.action<>act then return jsonb_build_object('status','stale');end if;
  return jsonb_build_object('status','saved','replayed',true);
 end if;
 select * into v from public.lab_ai_values where id=vid and user_id=m for update;
 if not found then return jsonb_build_object('status','stale');end if;
 select * into j from public.lab_ai_jobs where id=v.job_id;
 if not public._lab_ai_current(v.attachment_id)then return jsonb_build_object('status','stale');end if;
 if j.identity_status is distinct from 'match'and j.identity_confirmed_at is null then return jsonb_build_object('status','identity-first');end if;
 if not exists(select 1 from public.patient_document_opens o where o.file_id=v.file_id and o.attachment_id=v.attachment_id and o.actor_id=d and o.actor_kind='doctor')then
  return jsonb_build_object('status','open-first');end if;
 before_v:=jsonb_build_object('status',v.status,'correctedValue',v.corrected_value,'correctedUnit',v.corrected_unit,'reviewNote',v.review_note,'reviewedBy',v.reviewed_by,'reviewedAt',v.reviewed_at);
 update public.lab_ai_values set status=case act when 'confirm'then 'verified'when 'correct'then 'corrected'else 'rejected'end,
  corrected_value=case when act='correct'then nv end,corrected_unit=case when act='correct'then coalesce(nu,v.unit)end,review_note=note,reviewed_by=d,reviewed_at=clock_timestamp()
  where id=v.id returning * into v;
 insert into public.lab_ai_value_reviews(value_id,submission_id,actor_id,action,before,after)values(v.id,sub,d,act,before_v,
  jsonb_build_object('status',v.status,'correctedValue',v.corrected_value,'correctedUnit',v.corrected_unit,'reviewNote',v.review_note,'reviewedBy',v.reviewed_by,'reviewedAt',v.reviewed_at));
 return jsonb_build_object('status','saved','replayed',false,'valueStatus',v.status);
exception when lock_not_available then return jsonb_build_object('status','unavailable');
end$$;

-- What the engine may treat as verified: values a person confirmed or corrected, on a current
-- attachment. Internal; nothing reads it yet (Q9 pending), and unverified values never appear.
create function public._lab_ai_verified_values(p_user uuid)
returns table(value_id uuid,catalogue_ref text,value numeric,unit text,collected_on date,reviewed_by uuid,reviewed_at timestamptz)
language sql stable security definer set search_path=''as $$
 select v.id,v.catalogue_ref,coalesce(v.corrected_value,v.value),coalesce(v.corrected_unit,v.unit),v.collected_on,v.reviewed_by,v.reviewed_at
 from public.lab_ai_values v where v.user_id=p_user and v.status in('verified','corrected')and v.reviewed_by is not null and public._lab_ai_current(v.attachment_id)
$$;

-- 9. RLS and grants: no direct table access; functions only ----------------------------------------------
alter table public.lab_ai_capabilities enable row level security;
alter table public.lab_ai_jobs enable row level security;
alter table public.lab_ai_calls enable row level security;
alter table public.lab_ai_values enable row level security;
alter table public.lab_ai_value_reviews enable row level security;
revoke all on public.lab_ai_capabilities,public.lab_ai_jobs,public.lab_ai_calls,public.lab_ai_values,public.lab_ai_value_reviews from public,anon,authenticated,service_role;
revoke all on function public._lab_ai_enabled(),public._lab_ai_values_guard(),public._lab_ai_enqueue(),public._lab_ai_enqueue_file(),public._lab_ai_current(uuid),public._ai_spend(date,text),public._lab_clinic_bookings(uuid),
 public.lab_ai_job_claim(integer),public.lab_ai_call_reserve(uuid,uuid,text,text,text,boolean,numeric),public.lab_ai_call_finish(uuid,jsonb),public.lab_ai_job_finish(uuid,uuid,jsonb),public.lab_ai_reading_state(),
 public._lab_ai_job_json(public.lab_ai_jobs),public.doctor_lab_ai_overview(uuid),public.doctor_lab_ai_read(uuid,uuid),public.doctor_lab_ai_request(uuid,uuid),
 public.doctor_lab_ai_identity_confirm(jsonb),public.doctor_lab_ai_value_review(jsonb),public._lab_ai_verified_values(uuid)from public,anon,authenticated,service_role;
grant execute on function public.lab_ai_reading_state(),public.lab_ai_job_claim(integer),public.lab_ai_call_reserve(uuid,uuid,text,text,text,boolean,numeric),public.lab_ai_call_finish(uuid,jsonb),
 public.lab_ai_job_finish(uuid,uuid,jsonb)to service_role;
grant execute on function public.doctor_lab_ai_overview(uuid),public.doctor_lab_ai_read(uuid,uuid),public.doctor_lab_ai_request(uuid,uuid),
 public.doctor_lab_ai_identity_confirm(jsonb),public.doctor_lab_ai_value_review(jsonb)to authenticated;
