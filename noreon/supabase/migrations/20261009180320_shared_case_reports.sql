create table public.workspace_case_reports (
  case_id uuid not null references public.workspace_cases(id) on delete cascade,
  id text not null check (id ~ '^[0-9a-fA-F-]{36}$'),
  record jsonb not null,
  revision integer not null default 0 check (revision >= 0),
  approval jsonb,
  published jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (case_id, id)
);

create index workspace_case_reports_case_created_idx
  on public.workspace_case_reports (case_id, created_at desc);

alter table public.workspace_case_reports enable row level security;
revoke all on public.workspace_case_reports from public, anon, authenticated;
grant all on public.workspace_case_reports to service_role;

create or replace function public.lock_workspace_case_for_report_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case_id uuid;
begin
  v_case_id := case when tg_op = 'DELETE' then old.case_id else new.case_id end;
  perform 1 from public.workspace_cases where id = v_case_id for update;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.lock_workspace_case_for_report_change() from public, anon, authenticated;

create trigger workspace_case_reports_lock_case
before insert or update or delete on public.workspace_case_reports
for each row execute function public.lock_workspace_case_for_report_change();

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values (
  'workspace-case-reports',
  'workspace-case-reports',
  false,
  2097152,
  array['application/pdf', 'image/jpeg', 'image/png']
)
on conflict (id) do update set
  public = false,
  file_size_limit = 2097152,
  allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png'];

create or replace function public.workspace_save_case(
  p_id uuid,
  p_expected_revision integer,
  p_state jsonb,
  p_publication_key text default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_revision integer;
  v_publication_key text;
begin
  select revision into v_revision
  from public.workspace_cases
  where id = p_id and expires_at > now()
  for update;

  if not found or v_revision <> p_expected_revision then
    raise exception 'workspace case conflict';
  end if;
  if p_state->>'userId' is distinct from p_id::text then
    raise exception 'workspace case identity mismatch';
  end if;

  if p_publication_key is not null then
    v_publication_key := concat(
      p_state #>> '{workflow,startedAt}',
      ':',
      p_state #>> '{workflow,publication,workflowRevision}'
    );
    if v_publication_key is distinct from p_publication_key then
      raise exception 'workspace publication mismatch';
    end if;

    if exists (
      select 1 from public.workspace_case_reports r
      where r.case_id = p_id and (
        r.approval is null
        or r.approval->>'revision' is distinct from r.record->>'revision'
      )
    ) then
      raise exception 'workspace reports are not approved at the current revision';
    end if;

    update public.workspace_case_reports r
    set published = jsonb_build_object('key', p_publication_key, 'approval', r.approval),
    updated_at = now()
    where r.case_id = p_id;
  end if;

  update public.workspace_cases
  set state = p_state, revision = revision + 1
  where id = p_id
  returning revision into v_revision;
  return v_revision;
end;
$$;
revoke all on function public.workspace_save_case(uuid, integer, jsonb, text) from public, anon, authenticated;
grant execute on function public.workspace_save_case(uuid, integer, jsonb, text) to service_role;
