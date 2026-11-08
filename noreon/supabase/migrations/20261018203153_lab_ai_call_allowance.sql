-- Lab reading call allowance (quality review 18 Oct, item 23 / aC-3).
--
-- lab_ai_call_reserve counted every lab_ai_calls row toward the six-call limit, including refused
-- reservations (spend cap, tier not configured), which make no provider call. Six 30-minute defers
-- therefore killed a job without a single call, and the doctor's "Read again" reset attempts but not
-- the count, so the job could never recover. Now only reserved calls count, and only those made since
-- the latest retry request. History rows are kept unchanged.

alter table public.lab_ai_jobs add column retry_requested_at timestamptz;

create or replace function public.lab_ai_call_reserve(p_job uuid,p_lease uuid,p_purpose text,p_tier text,p_model text,p_local boolean,p_estimate_usd numeric)returns jsonb
language plpgsql security definer set search_path=''as $$
declare j public.lab_ai_jobs;s public.zoe_settings;c public.zoe_tier_config;spent numeric;tier_spent numeric;cap numeric;tier_cap numeric;code text;day date;v_call uuid;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if p_purpose is null or p_purpose not in('extract','summary')or p_tier is null or p_tier not in('low','medium','high')or coalesce(p_model,'')!~'^[a-z0-9_.:/-]{1,80}$'
  or p_local is null or p_estimate_usd is null or p_estimate_usd<0 or p_estimate_usd>100 then return jsonb_build_object('ok',false,'code','invalid');end if;
 perform pg_advisory_xact_lock(hashtextextended('zoe-spend-cap',0));
 select * into j from public.lab_ai_jobs where id=p_job for update;
 if not found or j.state<>'running'or j.lease_token is distinct from p_lease then return jsonb_build_object('ok',false,'code','job_not_running');end if;
 -- Only calls actually made count (a refused reservation calls nothing), and only since the doctor's
 -- latest "Read again"; the rows themselves stay as the record.
 if(select count(*)from public.lab_ai_calls where job_id=j.id and reserved and created_at>=coalesce(j.retry_requested_at,'-infinity'::timestamptz))>=6
  then return jsonb_build_object('ok',false,'code','job_call_limit');end if;
 select * into s from public.zoe_settings where singleton;
 select * into c from public.zoe_tier_config where tier=p_tier;
 day:=(clock_timestamp()at time zone coalesce(s.time_zone,'Asia/Yerevan'))::date;
 cap:=least(coalesce(s.daily_spend_cap_usd,0),10);
 tier_cap:=least(coalesce(c.daily_cap_usd,0),cap);
 select x.total,x.tier_total into spent,tier_spent from public._ai_spend(day,p_tier)x;
 code:=case when not p_local and not public._zoe_real_calls_permitted(p_model)then 'model_calls_not_permitted'
  when c.tier is null then 'tier_not_configured'
  when not p_local and p_model is distinct from c.model_id and p_model is distinct from c.fallback_model_id then 'model_not_configured_for_tier'
  when tier_spent+p_estimate_usd>tier_cap then 'tier_spend_cap_reached'
  when spent+p_estimate_usd>cap then 'daily_spend_cap_reached'end;
 insert into public.lab_ai_calls(job_id,purpose,tier,model,local,spend_day,estimate_usd,reserved,refusal)
  values(j.id,p_purpose,p_tier,p_model,p_local,day,p_estimate_usd,code is null,code)returning lab_ai_calls.id into v_call;
 return case when code is null then jsonb_build_object('ok',true,'callId',v_call)else jsonb_build_object('ok',false,'code',code,'callId',v_call)end;
end$$;

-- Ask for a reading (first time, or again after a failure). A rejected file stays rejected: the same
-- bytes would break the same limit. "Read again" starts a new call allowance.
create or replace function public.doctor_lab_ai_request(p_user_id uuid,p_file uuid)returns jsonb
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
  update public.lab_ai_jobs set state='queued',attempts=0,outcome=null,next_attempt_at=clock_timestamp(),finished_at=null,requested_by=d,retry_requested_at=clock_timestamp()where id=j.id;
  return jsonb_build_object('status','queued');
 end if;
 return jsonb_build_object('status','unchanged','state',j.state);
exception when lock_not_available then return jsonb_build_object('status','unavailable');
end$$;
