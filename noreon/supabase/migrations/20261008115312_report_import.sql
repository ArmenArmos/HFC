create table public.patient_reports (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 object_path text not null unique, file_name text not null, mime text not null check(mime in ('application/pdf','image/jpeg','image/png')),
 size_bytes integer not null check(size_bytes between 1 and 8388608), created_at timestamptz not null default now(),
 state text not null default 'uploaded' check(state in ('uploaded','processing','needs_review','confirmed','failed','deleted')),
 revision integer not null default 0, lease_until timestamptz, checksum text, page_count integer,
 extraction jsonb, reviewed jsonb, explanation jsonb, error_code text,
 consent_version text not null, consent_at timestamptz not null default now(),
 model text, prompt_version text, confirmed_at timestamptz, deleted_at timestamptz
);
create unique index patient_reports_checksum on public.patient_reports(user_id,checksum) where deleted_at is null;
alter table public.patient_reports enable row level security;
revoke all on public.patient_reports from anon,authenticated;
grant select on public.patient_reports to authenticated;
create policy report_owner_read on public.patient_reports for select to authenticated using(user_id=auth.uid() and deleted_at is null);
create table public.report_ai_attempts (id bigint generated always as identity primary key, user_id uuid not null references auth.users(id) on delete cascade, report_id uuid not null references public.patient_reports(id) on delete cascade, operation text not null, created_at timestamptz not null default now());
alter table public.report_ai_attempts enable row level security;
revoke all on public.report_ai_attempts from anon,authenticated;
create index report_attempt_date on public.report_ai_attempts(created_at,user_id,operation);
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('patient-reports','patient-reports',false,8388608,array['application/pdf','image/jpeg','image/png']);
create policy report_original_read on storage.objects for select to authenticated using(bucket_id='patient-reports' and exists(select 1 from public.patient_reports r where r.object_path=name and r.user_id=auth.uid() and r.deleted_at is null));
-- Only server code can create signed uploads or mutate reports. The caller supplies
-- the owner obtained from a verified session, never from a client request body.
create function public.claim_report_job(p_id uuid,p_owner uuid,p_operation text,p_revision integer) returns integer
language plpgsql security definer set search_path=public as $$
declare r public.patient_reports; used integer; next_revision integer;
begin
 if p_operation not in ('extract','explain') then raise exception 'invalid_operation'; end if;
 perform pg_advisory_xact_lock(8764312);
 select * into r from public.patient_reports where id=p_id and user_id=p_owner and deleted_at is null for update;
 if not found or r.revision<>p_revision then raise exception 'conflict'; end if;
 if r.lease_until>now() then raise exception 'busy'; end if;
 if (p_operation='extract' and r.state not in ('uploaded','failed','processing')) or (p_operation='explain' and r.state<>'confirmed') then raise exception 'invalid_state'; end if;
 select count(*) into used from public.report_ai_attempts where created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC';
 if used>=50 then raise exception 'daily_limit'; end if;
 select count(*) into used from public.report_ai_attempts where user_id=p_owner and operation=p_operation and created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC';
 if used>=5 then raise exception 'daily_limit'; end if;
 insert into public.report_ai_attempts(user_id,report_id,operation) values(p_owner,p_id,p_operation);
 update public.patient_reports set revision=revision+1,lease_until=now()+interval '2 minutes',state=case when p_operation='extract' then 'processing' else state end,error_code=null where id=p_id returning revision into next_revision;
 return next_revision;
end $$;
revoke all on function public.claim_report_job(uuid,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.claim_report_job(uuid,uuid,text,integer) to service_role;
