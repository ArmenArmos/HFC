-- A failed revision check must never remove a live original. Queue storage
-- cleanup in the same transaction as the row deletion, including case expiry.
create table public.workspace_report_cleanup (
 object_path text primary key,
 created_at timestamptz not null default now()
);
alter table public.workspace_report_cleanup enable row level security;
revoke all on public.workspace_report_cleanup from public,anon,authenticated,service_role;
grant select,delete on public.workspace_report_cleanup to service_role;
create function public.workspace_queue_report_cleanup() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if coalesce(old.record->>'object_path','')<>'' then
  insert into public.workspace_report_cleanup(object_path) values(old.record->>'object_path') on conflict do nothing;
 end if;
 return old;
end $$;
revoke all on function public.workspace_queue_report_cleanup() from public,anon,authenticated,service_role;
create trigger workspace_report_cleanup_deleted after delete on public.workspace_case_reports
for each row execute function public.workspace_queue_report_cleanup();
