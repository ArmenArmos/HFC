create table public.patient_message_dispatch_control (
 id smallint primary key default 1 check(id=1),
 revision bigint not null default 0 check(revision>=0),
 budget_day date not null default (now() at time zone 'UTC')::date,
 started_count integer not null default 0 check(started_count>=0),
 daily_limit integer not null default 200 check(daily_limit between 1 and 10000),
 paused_reason text check(paused_reason in ('provider-rejected','provider-unknown','stale-submission')),
 paused_at timestamptz,
 check((paused_reason is null)=(paused_at is null))
);
insert into public.patient_message_dispatch_control(id) values(1);
create table public.patient_message_control_events (
 revision bigint primary key,
 action text not null check(action in ('paused','resumed')),
 reason text not null check(reason in ('provider-rejected','provider-unknown','stale-submission','configuration-checked','unknown-reviewed','operator-reset')),
 daily_limit integer not null,
 created_at timestamptz not null default clock_timestamp()
);
alter table public.patient_message_dispatch_control enable row level security;
alter table public.patient_message_control_events enable row level security;
revoke all on public.patient_message_dispatch_control,public.patient_message_control_events from public,anon,authenticated,service_role;
grant select on public.patient_message_dispatch_control,public.patient_message_control_events to service_role;

alter function public.begin_patient_message_submission(uuid) rename to begin_patient_message_submission_uncontrolled;
revoke all on function public.begin_patient_message_submission_uncontrolled(uuid) from public,anon,authenticated,service_role;
create function public.begin_patient_message_submission(p_job_id uuid)
returns table(attempt_id uuid,destination text,channel text,template_key text,locale text)
language plpgsql security definer set search_path='' as $$
declare c public.patient_message_dispatch_control;r record;today date:=(clock_timestamp() at time zone 'UTC')::date;used integer;
begin
 select * into c from public.patient_message_dispatch_control where id=1 for update;
 -- Idempotent old-job calls cannot consume quota or trip admission errors.
 if not exists(select 1 from public.patient_message_outbox where id=p_job_id and state='queued') then return;end if;
 if c.paused_reason is not null then raise exception 'message dispatch paused';end if;
 used:=case when c.budget_day=today then c.started_count else 0 end;
 if used>=c.daily_limit then raise exception 'message daily limit';end if;
 if exists(select 1 from public.patient_message_attempts where status='submitting') then raise exception 'message dispatch busy';end if;
 select * into r from public.begin_patient_message_submission_uncontrolled(p_job_id);
 if not found then return;end if;
 update public.patient_message_dispatch_control set budget_day=today,started_count=used+1,revision=revision+1 where id=1;
 return query select r.attempt_id,r.destination,r.channel,r.template_key,r.locale;
end $$;
revoke all on function public.begin_patient_message_submission(uuid) from public,anon,authenticated,service_role;
grant execute on function public.begin_patient_message_submission(uuid) to service_role;

alter function public.finish_patient_message_submission(uuid,text,text) rename to finish_patient_message_submission_uncontrolled;
revoke all on function public.finish_patient_message_submission_uncontrolled(uuid,text,text) from public,anon,authenticated,service_role;
create function public.finish_patient_message_submission(p_attempt_id uuid,p_status text,p_provider_reference text) returns boolean
language plpgsql security definer set search_path='' as $$
declare c public.patient_message_dispatch_control;prior text;done boolean;reason text;next_revision bigint;
begin
 select * into c from public.patient_message_dispatch_control where id=1 for update;
 select status into prior from public.patient_message_attempts where id=p_attempt_id for update;
 done:=public.finish_patient_message_submission_uncontrolled(p_attempt_id,p_status,p_provider_reference);
 if done and prior is distinct from p_status and p_status in ('failed','unknown') and c.paused_reason is null then
  reason:=case when p_status='failed' then 'provider-rejected' else 'provider-unknown' end;
  update public.patient_message_dispatch_control set paused_reason=reason,paused_at=clock_timestamp(),revision=revision+1 where id=1 returning revision into next_revision;
  insert into public.patient_message_control_events(revision,action,reason,daily_limit) values(next_revision,'paused',reason,c.daily_limit);
 end if;
 return done;
end $$;
revoke all on function public.finish_patient_message_submission(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.finish_patient_message_submission(uuid,text,text) to service_role;

alter function public.mark_stale_patient_message_submissions() rename to mark_stale_patient_message_submissions_uncontrolled;
revoke all on function public.mark_stale_patient_message_submissions_uncontrolled() from public,anon,authenticated,service_role;
create function public.mark_stale_patient_message_submissions() returns integer
language plpgsql security definer set search_path='' as $$
declare c public.patient_message_dispatch_control;changed integer;next_revision bigint;
begin
 select * into c from public.patient_message_dispatch_control where id=1 for update;
 changed:=public.mark_stale_patient_message_submissions_uncontrolled();
 if changed>0 and c.paused_reason is null then
  update public.patient_message_dispatch_control set paused_reason='stale-submission',paused_at=clock_timestamp(),revision=revision+1 where id=1 returning revision into next_revision;
  insert into public.patient_message_control_events(revision,action,reason,daily_limit) values(next_revision,'paused','stale-submission',c.daily_limit);
 end if;
 return changed;
end $$;
revoke all on function public.mark_stale_patient_message_submissions() from public,anon,authenticated,service_role;
grant execute on function public.mark_stale_patient_message_submissions() to service_role;

create function public.resume_patient_message_dispatch(p_expected_revision bigint,p_acknowledgement text,p_daily_limit integer default null) returns boolean
language plpgsql security definer set search_path='' as $$
declare c public.patient_message_dispatch_control;next_revision bigint;next_limit integer;
begin
 if p_expected_revision is null or p_expected_revision<0 or p_acknowledgement is null or p_acknowledgement not in ('configuration-checked','unknown-reviewed','operator-reset') or (p_daily_limit is not null and p_daily_limit not between 1 and 10000) then raise exception 'invalid';end if;
 select * into c from public.patient_message_dispatch_control where id=1 for update;
 if c.revision<>p_expected_revision then return false;end if;
 if exists(select 1 from public.patient_message_attempts where status='submitting') then raise exception 'message dispatch busy';end if;
 next_limit:=coalesce(p_daily_limit,c.daily_limit);
 update public.patient_message_dispatch_control set paused_reason=null,paused_at=null,daily_limit=next_limit,revision=revision+1 where id=1 returning revision into next_revision;
 insert into public.patient_message_control_events(revision,action,reason,daily_limit) values(next_revision,'resumed',p_acknowledgement,next_limit);
 return true;
end $$;
revoke all on function public.resume_patient_message_dispatch(bigint,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.resume_patient_message_dispatch(bigint,text,integer) to service_role;
