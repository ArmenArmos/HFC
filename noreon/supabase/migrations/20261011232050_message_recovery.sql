-- Retain rejected attempts while permitting an explicit, bounded new attempt.
alter table public.patient_message_attempts drop constraint patient_message_attempts_job_id_key;
create unique index patient_message_attempts_one_live on public.patient_message_attempts(job_id) where status<>'failed';
create index patient_message_attempts_job_history on public.patient_message_attempts(job_id,started_at,id);
alter table public.patient_message_attempts add column next_reconcile_at timestamptz not null default clock_timestamp(),add column reconcile_failures integer not null default 0 check(reconcile_failures between 0 and 20);
create table public.patient_message_recovery_events (
 id uuid primary key default gen_random_uuid(),
 attempt_id uuid references public.patient_message_attempts(id) on delete set null,
 action text not null check(action in ('retry','resume')),
 operator_label text not null check(operator_label ~ '^[A-Za-z0-9@._-]{3,100}$'),
 control_revision bigint,
 created_at timestamptz not null default clock_timestamp()
);
create unique index patient_message_recovery_one_retry on public.patient_message_recovery_events(attempt_id) where action='retry';
alter table public.patient_message_recovery_events enable row level security;
revoke all on public.patient_message_recovery_events from public,anon,authenticated,service_role;
grant select on public.patient_message_recovery_events to service_role;

create function public.retry_patient_message_submission(p_attempt_id uuid,p_operator_label text) returns boolean
language plpgsql security definer set search_path='' as $$
declare a public.patient_message_attempts;j public.patient_message_outbox;
begin
 if p_operator_label is null or p_operator_label !~ '^[A-Za-z0-9@._-]{3,100}$' then raise exception 'invalid';end if;
 perform 1 from public.patient_message_dispatch_control where id=1 for update;
 select * into a from public.patient_message_attempts where id=p_attempt_id for update;
 if not found or a.status<>'failed' or a.job_id is null then return false;end if;
 select * into j from public.patient_message_outbox where id=a.job_id for update;
 if not found or j.state<>'submitted' or j.expires_at<=clock_timestamp() then return false;end if;
 if exists(select 1 from public.patient_message_attempts where job_id=a.job_id and status<>'failed')
 or exists(select 1 from public.patient_message_recovery_events where attempt_id=a.id and action='retry')
 or (select count(*) from public.patient_message_attempts where job_id=a.job_id)>=3 then return false;end if;
 -- Each previous failed attempt can authorize only one retry, so an old request
 -- cannot requeue a subsequent failure. The next begin rechecks all consent/source gates.
 insert into public.patient_message_recovery_events(attempt_id,action,operator_label) values(a.id,'retry',p_operator_label);
 update public.patient_message_outbox set state='queued' where id=j.id;
 return true;
end $$;
revoke all on function public.retry_patient_message_submission(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.retry_patient_message_submission(uuid,text) to service_role;

-- All future resumes require explicit operator attribution, including CLI callers.
alter function public.resume_patient_message_dispatch(bigint,text,integer) rename to resume_patient_message_dispatch_unattributed;
revoke all on function public.resume_patient_message_dispatch_unattributed(bigint,text,integer) from public,anon,authenticated,service_role;
create function public.resume_patient_message_dispatch(p_expected_revision bigint,p_acknowledgement text,p_daily_limit integer default null,p_operator_label text default null) returns boolean
language plpgsql security definer set search_path='' as $$
declare done boolean;
begin
 if p_operator_label is null or p_operator_label !~ '^[A-Za-z0-9@._-]{3,100}$' then raise exception 'invalid operator';end if;
 done:=public.resume_patient_message_dispatch_unattributed(p_expected_revision,p_acknowledgement,p_daily_limit);
 if done then insert into public.patient_message_recovery_events(action,operator_label,control_revision) values('resume',p_operator_label,p_expected_revision+1);end if;
 return done;
end $$;
revoke all on function public.resume_patient_message_dispatch(bigint,text,integer,text) from public,anon,authenticated,service_role;
grant execute on function public.resume_patient_message_dispatch(bigint,text,integer,text) to service_role;

create function public.patient_message_reconciliation_candidates(p_limit integer default 25)
returns table(attempt_id uuid,provider_reference text)
language plpgsql security definer set search_path='' as $$
begin
 if p_limit is null or p_limit not between 1 and 25 then raise exception 'invalid';end if;
 return query select a.id,a.provider_reference from public.patient_message_attempts a
 where a.status='accepted' and a.next_reconcile_at<=clock_timestamp() and a.started_at>clock_timestamp()-interval '48 hours'
 and not exists(select 1 from public.patient_message_delivery_events e where e.attempt_id=a.id and e.status in ('delivered','read','failed','undelivered','canceled'))
 order by a.next_reconcile_at,a.id limit p_limit;
end $$;
revoke all on function public.patient_message_reconciliation_candidates(integer) from public,anon,authenticated,service_role;
grant execute on function public.patient_message_reconciliation_candidates(integer) to service_role;

create function public.defer_patient_message_reconciliation(p_attempt_id uuid,p_failed boolean) returns boolean
language plpgsql security definer set search_path='' as $$
declare failures integer;
begin
 if p_failed is null then raise exception 'invalid';end if;
 select case when p_failed then least(reconcile_failures+1,20) else 0 end into failures from public.patient_message_attempts where id=p_attempt_id and status='accepted' for update;
 if not found then return false;end if;
 update public.patient_message_attempts set reconcile_failures=failures,next_reconcile_at=clock_timestamp()+make_interval(secs=>least(21600,300*power(2,least(failures,7)))::integer) where id=p_attempt_id;
 return true;
end $$;
revoke all on function public.defer_patient_message_reconciliation(uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.defer_patient_message_reconciliation(uuid,boolean) to service_role;
