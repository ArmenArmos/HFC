create table public.workspace_clinics (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 160),
  address text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.workspace_staff (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin', 'doctor')),
  display_name text not null check (length(btrim(display_name)) between 1 and 160),
  clinic_id uuid references public.workspace_clinics(id) on delete restrict,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint workspace_staff_doctor_clinic check (role = 'admin' or clinic_id is not null)
);

create table public.workspace_cases (
  id uuid primary key default gen_random_uuid(),
  state jsonb not null default '{}'::jsonb,
  revision integer not null default 0 check (revision >= 0),
  assigned_doctor_id uuid references public.workspace_staff(user_id) on delete set null,
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now()
);

create index workspace_cases_assigned_expiry_idx
  on public.workspace_cases (assigned_doctor_id, expires_at);

alter table public.workspace_clinics enable row level security;
alter table public.workspace_staff enable row level security;
alter table public.workspace_cases enable row level security;

-- A signed-in staff member can only read their own membership. Operational
-- reads and writes go through the server's service-role client after checks.
create policy workspace_staff_read_self on public.workspace_staff
  for select to authenticated using (user_id = (select auth.uid()));

create policy workspace_clinics_admin_read on public.workspace_clinics
  for select to authenticated using (
    exists (
      select 1 from public.workspace_staff s
      where s.user_id = (select auth.uid()) and s.role = 'admin' and s.active
    )
  );

-- No browser access to case data, including authenticated users.

create table public.workspace_login_attempts (
  normalized_email text primary key,
  window_started_at timestamptz not null,
  attempt_count integer not null check (attempt_count > 0)
);
alter table public.workspace_login_attempts enable row level security;

create or replace function public.record_workspace_login_attempt(p_email text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(p_email));
  v_count integer;
begin
  if v_email = '' or length(v_email) > 320 then return false; end if;
  insert into public.workspace_login_attempts(normalized_email, window_started_at, attempt_count)
    values (v_email, now(), 1)
  on conflict (normalized_email) do update set
    window_started_at = case
      when public.workspace_login_attempts.window_started_at < now() - interval '15 minutes' then now()
      else public.workspace_login_attempts.window_started_at end,
    attempt_count = case
      when public.workspace_login_attempts.window_started_at < now() - interval '15 minutes' then 1
      else public.workspace_login_attempts.attempt_count + 1 end
  returning attempt_count into v_count;
  return v_count <= 8;
end;
$$;

revoke all on function public.record_workspace_login_attempt(text) from public, anon, authenticated;
grant execute on function public.record_workspace_login_attempt(text) to service_role;

create or replace function public.clear_workspace_login_attempts(p_email text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.workspace_login_attempts where normalized_email = lower(btrim(p_email));
$$;
revoke all on function public.clear_workspace_login_attempts(text) from public, anon, authenticated;
grant execute on function public.clear_workspace_login_attempts(text) to service_role;

create or replace function public.workspace_assign_case(
  p_id uuid,
  p_expected_revision integer,
  p_doctor_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_revision integer;
begin
  if p_doctor_id is not null and not exists (
    select 1
    from public.workspace_staff s
    join public.workspace_clinics c on c.id = s.clinic_id
    where s.user_id = p_doctor_id and s.role = 'doctor' and s.active and c.active
  ) then
    return -1;
  end if;

  update public.workspace_cases
  set assigned_doctor_id = p_doctor_id, revision = revision + 1
  where id = p_id and revision = p_expected_revision and expires_at > now()
  returning revision into v_revision;
  return coalesce(v_revision, -1);
end;
$$;
revoke all on function public.workspace_assign_case(uuid, integer, uuid) from public, anon, authenticated;
grant execute on function public.workspace_assign_case(uuid, integer, uuid) to service_role;
