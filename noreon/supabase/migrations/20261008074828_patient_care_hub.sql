-- Member-facing clinical records. Clinical writes are restricted to trusted services.
create table public.patient_care_tests (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 title text not null check(length(title) between 1 and 500), preparation text,
 status text not null check(status in ('ordered','collected','cancelled')),
 ordered_by text not null, ordered_at timestamptz not null, due_at timestamptz, location text,
 source text not null check(source in ('clinic','laboratory','member')), source_label text not null,
 unique(id,user_id)
);
create table public.patient_care_results (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 test_id uuid, marker text not null, value double precision not null check(value > '-Infinity'::float8 and value < 'Infinity'::float8), unit text not null,
 reference_low double precision, reference_high double precision,
 collected_at timestamptz not null, received_at timestamptz not null,
 source text not null check(source in ('clinic','laboratory','member')), source_label text not null,
 reviewed_at timestamptz, reviewed_by text, explanation text,
 foreign key(test_id,user_id) references public.patient_care_tests(id,user_id),
 check((reviewed_at is null and reviewed_by is null and explanation is null) or (reviewed_at is not null and reviewed_by is not null)),
 check(reference_low is null or reference_high is null or reference_low <= reference_high)
);
create table public.patient_care_plans (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 clinician text not null, published_at timestamptz not null default now(), instructions text not null,
 active boolean not null default true, acknowledged_at timestamptz,
 unique(id,user_id)
);
create unique index patient_care_one_current_plan on public.patient_care_plans(user_id) where active;
create table public.patient_care_medications (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 plan_id uuid not null, name text not null, dose text not null, instructions text not null,
 times time[] not null check(cardinality(times) between 1 and 8),
 start_date date not null, end_date date, active boolean not null default true,
 unique(id,user_id), foreign key(plan_id,user_id) references public.patient_care_plans(id,user_id) on delete cascade,
 check(end_date is null or end_date >= start_date)
);
create table public.patient_care_appointments (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 clinician text, specialty text not null, location text, starts_at timestamptz,
 status text not null check(status in ('requested','confirmed','completed','cancelled')),
 check(status <> 'confirmed' or (starts_at is not null and location is not null))
);
create table public.patient_dose_events (
 user_id uuid not null references auth.users(id) on delete cascade,
 medication_id uuid not null, due_at timestamptz not null,
 status text not null check(status in ('taken','skipped')), recorded_at timestamptz not null default now(),
 primary key(user_id,medication_id,due_at),
 foreign key(medication_id,user_id) references public.patient_care_medications(id,user_id) on delete cascade
);

alter table public.patient_care_tests enable row level security;
alter table public.patient_care_results enable row level security;
alter table public.patient_care_plans enable row level security;
alter table public.patient_care_medications enable row level security;
alter table public.patient_care_appointments enable row level security;
alter table public.patient_dose_events enable row level security;
create policy own_care_tests on public.patient_care_tests for select using((select auth.uid())=user_id);
create policy own_care_results on public.patient_care_results for select using((select auth.uid())=user_id);
create policy own_care_plans on public.patient_care_plans for select using((select auth.uid())=user_id);
create policy own_care_medications on public.patient_care_medications for select using((select auth.uid())=user_id);
create policy own_care_appointments on public.patient_care_appointments for select using((select auth.uid())=user_id);
create policy own_dose_events on public.patient_dose_events for select using((select auth.uid())=user_id);
revoke all on public.patient_care_tests,public.patient_care_results,public.patient_care_plans,public.patient_care_medications,public.patient_care_appointments,public.patient_dose_events from anon,authenticated;
grant select on public.patient_care_tests,public.patient_care_results,public.patient_care_plans,public.patient_care_medications,public.patient_care_appointments,public.patient_dose_events to authenticated;
create index patient_care_tests_owner on public.patient_care_tests(user_id);
create index patient_care_results_owner on public.patient_care_results(user_id,collected_at desc);
create index patient_care_medications_owner on public.patient_care_medications(user_id,plan_id);
create index patient_care_appointments_owner on public.patient_care_appointments(user_id,starts_at desc);

-- Session identity is obtained inside the RPC; callers cannot choose an owner.
create function public.report_patient_dose(p_medication_id uuid,p_due_at timestamptz,p_status text)
returns void language plpgsql security definer set search_path='' as $$
declare m public.patient_care_medications; plan public.patient_care_plans; local_due timestamp;
begin
 if auth.uid() is null or p_status not in ('taken','skipped') or p_status is null then raise exception 'invalid dose report'; end if;
 select * into m from public.patient_care_medications where id=p_medication_id and user_id=auth.uid() for share;
 if not found or not m.active then raise exception 'medication unavailable'; end if;
 select * into plan from public.patient_care_plans where id=m.plan_id and user_id=auth.uid() for share;
 if not found or not plan.active or plan.published_at>now() then raise exception 'plan unavailable'; end if;
 local_due := timezone('Asia/Yerevan',p_due_at);
 if p_due_at is null or p_due_at>now() or local_due::date<>timezone('Asia/Yerevan',now())::date
    or local_due::date<m.start_date or (m.end_date is not null and local_due::date>m.end_date)
    or not(local_due::time=any(m.times)) then raise exception 'dose outside schedule'; end if;
 insert into public.patient_dose_events(user_id,medication_id,due_at,status)
 values(auth.uid(),m.id,p_due_at,p_status)
 on conflict(user_id,medication_id,due_at) do update set status=excluded.status,recorded_at=now();
end $$;
create function public.acknowledge_patient_plan(p_plan_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 update public.patient_care_plans set acknowledged_at=coalesce(acknowledged_at,now())
 where id=p_plan_id and user_id=auth.uid() and active and published_at<=now();
 if not found then raise exception 'plan unavailable'; end if;
end $$;
revoke execute on function public.report_patient_dose(uuid,timestamptz,text) from public,anon;
revoke execute on function public.acknowledge_patient_plan(uuid) from public,anon;
grant execute on function public.report_patient_dose(uuid,timestamptz,text) to authenticated;
grant execute on function public.acknowledge_patient_plan(uuid) to authenticated;
