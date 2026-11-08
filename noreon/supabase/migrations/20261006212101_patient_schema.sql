alter table public.profiles
  add column birth_date date,
  add column biological_sex text check (biological_sex in ('male','female')),
  add column locale text not null default 'hy' check (locale in ('hy','en'));

create table public.patient_consents (
  user_id uuid not null references auth.users(id) on delete cascade,
  version text not null,
  accepted_at timestamptz not null default now(),
  primary key (user_id,version)
);
create table public.patient_assessments (
  id uuid not null default gen_random_uuid() unique,
  user_id uuid primary key references auth.users(id) on delete cascade,
  assessment_date date not null default timezone('Asia/Yerevan',now())::date,
  algorithm_version text not null default 'NRN-CLIN-ALG-001-v1.1',
  answers jsonb not null default '{}' check (jsonb_typeof(answers)='object' and octet_length(answers::text)<100000),
  revision bigint not null default 0 check (revision>=0),
  completed_at timestamptz,
  urgent_rule text,
  updated_at timestamptz not null default now()
);
create table public.patient_measurements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  submission_id uuid not null,
  systolic integer not null check(systolic between 60 and 300),
  diastolic integer not null check(diastolic between 30 and 200 and diastolic<systolic),
  pulse integer check(pulse between 20 and 250),
  measured_at timestamptz not null,
  source text not null default 'manual' check(source='manual'),
  created_at timestamptz not null default now(),
  unique(user_id,submission_id)
);
create index patient_measurements_by_owner_time on public.patient_measurements(user_id,measured_at desc);
alter table public.patient_consents enable row level security;
alter table public.patient_assessments enable row level security;
alter table public.patient_measurements enable row level security;
create policy "own patient consents" on public.patient_consents for select using ((select auth.uid())=user_id);
create policy "own patient assessment" on public.patient_assessments for select using ((select auth.uid())=user_id);
create policy "own patient measurements" on public.patient_measurements for select using ((select auth.uid())=user_id);
revoke insert,update,delete on public.profiles from anon,authenticated;
revoke all on public.patient_consents,public.patient_assessments,public.patient_measurements from anon,authenticated;
grant select on public.patient_consents,public.patient_assessments,public.patient_measurements to authenticated;

create function public.save_patient_profile(p_user_id uuid,p_name text,p_birth_date date,p_sex text,p_locale text,p_consent_version text,p_answers jsonb)
returns void language plpgsql security invoker set search_path='' as $$
begin
  if length(trim(p_name)) not between 1 and 100
    or extract(year from age(timezone('Asia/Yerevan',now())::date,p_birth_date)) not between 18 and 110
    or p_sex not in ('male','female') or p_locale not in ('hy','en')
    or p_consent_version<>'patient-pilot-v1' then raise exception 'invalid profile'; end if;
  update public.profiles set display_name=trim(p_name),birth_date=p_birth_date,biological_sex=p_sex,locale=p_locale,updated_at=now() where id=p_user_id;
  if not found then raise exception 'profile missing'; end if;
  insert into public.patient_consents(user_id,version) values(p_user_id,p_consent_version) on conflict do nothing;
  insert into public.patient_assessments(user_id,answers) values(p_user_id,p_answers)
    on conflict(user_id) do update set answers=public.patient_assessments.answers||excluded.answers,revision=public.patient_assessments.revision+1,completed_at=null,updated_at=now();
end $$;
create function public.save_patient_assessment(p_user_id uuid,p_expected_revision bigint,p_answers jsonb,p_complete boolean,p_urgent_rule text)
returns bigint language plpgsql security invoker set search_path='' as $$
declare new_revision bigint;
begin
  update public.patient_assessments set answers=p_answers,revision=revision+1,
    completed_at=case when p_complete and p_urgent_rule is null then now() else null end,
    urgent_rule=p_urgent_rule,updated_at=now()
    where user_id=p_user_id and revision=p_expected_revision returning revision into new_revision;
  return coalesce(new_revision,-1);
end $$;
revoke execute on function public.save_patient_profile(uuid,text,date,text,text,text,jsonb) from public,anon,authenticated;
revoke execute on function public.save_patient_assessment(uuid,bigint,jsonb,boolean,text) from public,anon,authenticated;
grant execute on function public.save_patient_profile(uuid,text,date,text,text,text,jsonb) to service_role;
grant execute on function public.save_patient_assessment(uuid,bigint,jsonb,boolean,text) to service_role;
