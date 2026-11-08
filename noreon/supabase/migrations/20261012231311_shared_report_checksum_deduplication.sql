-- Preserve legacy report history. New inserts deduplicate under the existing
-- per-case row lock; null checksums remain valid for fictional/legacy reports.
-- No destructive backfill or unique index over potentially duplicated history.
create or replace function public.workspace_write_report(p_id uuid,p_report_id text,p_op text,p_expected_revision integer default null,p_record jsonb default null,p_approval jsonb default null,p_actor uuid default null)
returns integer language plpgsql security definer set search_path='' as $$
declare r public.workspace_case_reports;n integer; candidate_path text; checksum text;
begin
 -- Per-attempt upload paths cannot be shared with a different attempt. Queue only
 -- after a definite rejection or a successful replay of another saved path.
 if p_op='discard-upload' then
  candidate_path:=p_record->>'object_path';
  if candidate_path is null or candidate_path !~ ('^'||p_id::text||'/'||p_report_id||'/[0-9a-f-]{36}$')
     or p_report_id !~ '^[0-9a-f-]{36}$' then raise exception 'invalid upload path';end if;
  perform 1 from public.workspace_cases where id=p_id for update;
  if exists(select 1 from public.workspace_case_reports where record->>'object_path'=candidate_path) then return 0;end if;
  insert into public.workspace_report_cleanup(object_path) values(candidate_path) on conflict do nothing;
  return 1;
 end if;
 perform 1 from public.workspace_cases where id=p_id and expires_at>now() for update;
 if not found then raise exception 'not_found';end if;
 if p_op in ('update','approve') then perform public.workspace_review_doctor(p_id,p_actor);end if;
 perform public.workspace_set_actor(p_actor,p_id);
 if p_op='insert' then
  if p_record->>'id' is distinct from p_report_id or p_record->>'user_id' is distinct from p_id::text then raise exception 'invalid';end if;
  if p_record ?| array['associations','associationHistory','contentRevision'] then raise exception 'protected report metadata';end if;
  checksum:=nullif(p_record->>'checksum','');
  select * into r from public.workspace_case_reports where case_id=p_id and id=p_report_id;
  if found then
   if checksum is not null and r.record->>'checksum'=checksum then return r.revision;end if;
   raise exception using errcode='23505',message='duplicate';
  end if;
  if checksum is not null and exists(select 1 from public.workspace_case_reports where case_id=p_id and record->>'checksum'=checksum) then
   raise exception using errcode='23505',message='duplicate';
  end if;
  if (select count(*) from public.workspace_case_reports where case_id=p_id)>=10 then raise exception 'report_limit';end if;
  insert into public.workspace_case_reports(case_id,id,record) values(p_id,p_report_id,p_record||jsonb_build_object('contentRevision',0,'associations','[]'::jsonb,'associationHistory','[]'::jsonb));return 0;
 end if;
 select * into r from public.workspace_case_reports where case_id=p_id and id=p_report_id for update;
 if not found then raise exception 'not_found';end if;
 if p_expected_revision is null or r.revision<>p_expected_revision then raise exception 'conflict';end if;
 if p_op='delete' then delete from public.workspace_case_reports where case_id=p_id and id=p_report_id;return r.revision+1;
 elsif p_op='update' then
  if p_record->>'id' is distinct from p_report_id or p_record->>'user_id' is distinct from p_id::text then raise exception 'invalid';end if;
  if coalesce(p_record->'associations','[]') is distinct from coalesce(r.record->'associations','[]')
   or coalesce(p_record->'associationHistory','[]') is distinct from coalesce(r.record->'associationHistory','[]')
   or coalesce(p_record->'contentRevision','0') is distinct from coalesce(r.record->'contentRevision','0') then raise exception 'protected report metadata';end if;
  if coalesce(p_record->'checksum','null') is distinct from coalesce(r.record->'checksum','null')
   or coalesce(p_record->'object_path','null') is distinct from coalesce(r.record->'object_path','null')
   or coalesce(p_record->'mime','null') is distinct from coalesce(r.record->'mime','null')
   or coalesce(p_record->'size_bytes','null') is distinct from coalesce(r.record->'size_bytes','null') then raise exception 'protected report identity';end if;
  p_record:=public.workspace_report_content_transition(r.record,p_record,clock_timestamp()::text);
  update public.workspace_case_reports set record=p_record,approval=null,revision=revision+1,updated_at=now() where case_id=p_id and id=p_report_id returning revision into n;
 elsif p_op='approve' then
  if r.record->>'state'<>'confirmed' or r.record->'reviewed' is null or r.record->'reviewed'='null'::jsonb or p_approval->>'revision' is distinct from r.record->>'revision' or p_approval->'report' is distinct from r.record then raise exception 'invalid';end if;
  update public.workspace_case_reports set approval=p_approval,revision=revision+1,updated_at=now() where case_id=p_id and id=p_report_id returning revision into n;
 else raise exception 'invalid operation';end if;
 return n;
end $$;
