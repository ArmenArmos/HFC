-- Content identity is independent from approval and optimistic-write revisions.
create function public.workspace_report_content_transition(p_old jsonb,p_new jsonb,p_at text) returns jsonb
language plpgsql immutable set search_path='' as $$
declare changed boolean;reason text;active jsonb;history jsonb;
begin
 changed:=coalesce(p_old->'extraction','null') is distinct from coalesce(p_new->'extraction','null')
  or coalesce(p_old->'reviewed','null') is distinct from coalesce(p_new->'reviewed','null');
 reason:=case when changed then 'content-changed' when p_new->>'state' is distinct from 'confirmed' then 'unconfirmed' else null end;
 active:=coalesce(p_old->'associations','[]');history:=coalesce(p_old->'associationHistory','[]');
 if reason is not null then
  history:=history||coalesce((select jsonb_agg(a||jsonb_build_object('reason',reason,'retiredAt',p_at)) from jsonb_array_elements(active) a),'[]');
  active:='[]';
 end if;
 return p_new||jsonb_build_object('revision',coalesce((p_old->>'revision')::bigint,0)+1,
  'contentRevision',coalesce((p_old->>'contentRevision')::bigint,0)+case when changed then 1 else 0 end,
  'associations',active,'associationHistory',history);
end $$;
revoke all on function public.workspace_report_content_transition(jsonb,jsonb,text) from public,anon,authenticated,service_role;

create or replace function public.workspace_write_report(p_id uuid,p_report_id text,p_op text,p_expected_revision integer default null,p_record jsonb default null,p_approval jsonb default null,p_actor uuid default null)
returns integer language plpgsql security definer set search_path='' as $$
declare r public.workspace_case_reports;n integer;
begin
 perform 1 from public.workspace_cases where id=p_id and expires_at>now() for update;
 if not found then raise exception 'not_found';end if;
 if p_op in ('update','approve') then perform public.workspace_review_doctor(p_id,p_actor);end if;
 perform public.workspace_set_actor(p_actor,p_id);
 if p_op='insert' then
  if p_record->>'id' is distinct from p_report_id or p_record->>'user_id' is distinct from p_id::text then raise exception 'invalid';end if;
  if p_record ?| array['associations','associationHistory','contentRevision'] then raise exception 'protected report metadata';end if;
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
  p_record:=public.workspace_report_content_transition(r.record,p_record,clock_timestamp()::text);
  update public.workspace_case_reports set record=p_record,approval=null,revision=revision+1,updated_at=now() where case_id=p_id and id=p_report_id returning revision into n;
 elsif p_op='approve' then
  if r.record->>'state'<>'confirmed' or r.record->'reviewed' is null or r.record->'reviewed'='null'::jsonb or p_approval->>'revision' is distinct from r.record->>'revision' or p_approval->'report' is distinct from r.record then raise exception 'invalid';end if;
  update public.workspace_case_reports set approval=p_approval,revision=revision+1,updated_at=now() where case_id=p_id and id=p_report_id returning revision into n;
 else raise exception 'invalid operation';end if;
 return n;
end $$;

create function public.workspace_associate_report(p_id uuid,p_report_id text,p_actor uuid,p_expected_evidence bigint,p_expected_report_revision integer,p_requirement_id text,p_rows integer[]) returns integer
language plpgsql security definer set search_path='' as $$
declare c public.workspace_cases;r public.workspace_case_reports;active jsonb;history jsonb;prior jsonb;entry jsonb;n integer;label text;stamp text:=clock_timestamp()::text;
begin
 select * into c from public.workspace_cases where id=p_id and expires_at>now() for update;
 if not found then raise exception 'not_found';end if;
 perform public.workspace_review_doctor(p_id,p_actor);
 perform public.workspace_set_actor(p_actor,p_id);
 if p_expected_evidence is null or c.evidence_revision<>p_expected_evidence then raise exception 'conflict';end if;
 select * into r from public.workspace_case_reports where case_id=p_id and id=p_report_id for update;
 if not found then raise exception 'not_found';end if;
 if p_expected_report_revision is null or r.revision<>p_expected_report_revision then raise exception 'conflict';end if;
 if p_rows is null or cardinality(p_rows)>100 or exists(select 1 from unnest(p_rows) x where x is null or x<0) or cardinality(p_rows)<>(select count(distinct x) from unnest(p_rows) x) then raise exception 'invalid rows';end if;
 if p_requirement_id is null or length(p_requirement_id)>200 then raise exception 'invalid requirement';end if;
 active:=coalesce(r.record->'associations','[]');history:=coalesce(r.record->'associationHistory','[]');
 select a into prior from jsonb_array_elements(active) a where a->>'requirementId'=p_requirement_id;
 if cardinality(p_rows)>0 then
  if c.state#>>'{workflow,recommendationsPending}'='true' or not exists(select 1 from jsonb_array_elements(coalesce(c.state#>'{workflow,requirements}','[]')) q where q->>'requirementId'=p_requirement_id and q->>'retiredAtRevision' is null) then raise exception 'inactive requirement';end if;
  if r.record->>'state' is distinct from 'confirmed' or jsonb_typeof(r.record#>'{reviewed,rows}') is distinct from 'array' then raise exception 'source check required';end if;
  if exists(select 1 from unnest(p_rows) x where x>=jsonb_array_length(r.record#>'{reviewed,rows}')) then raise exception 'invalid rows';end if;
  select display_name into label from public.workspace_staff where user_id=p_actor;
  entry:=jsonb_build_object('requirementId',p_requirement_id,'rowIndices',(select jsonb_agg(x order by x) from unnest(p_rows) x),
   'contentRevision',coalesce((r.record->>'contentRevision')::bigint,0),'actorId',p_actor,'actorLabel',label,'confirmedAt',stamp);
 elsif prior is null then return r.revision;
 end if;
 active:=coalesce((select jsonb_agg(a) from jsonb_array_elements(active) a where a->>'requirementId'<>p_requirement_id),'[]');
 if prior is not null then history:=history||jsonb_build_array(prior||jsonb_build_object('retiredAt',stamp,'reason',case when cardinality(p_rows)=0 then 'removed' else 'replaced' end));end if;
 if entry is not null then active:=active||jsonb_build_array(entry);end if;
 update public.workspace_case_reports set record=record||jsonb_build_object('revision',coalesce((record->>'revision')::bigint,0)+1,'associations',active,'associationHistory',history),
  approval=null,revision=revision+1,updated_at=now() where case_id=p_id and id=p_report_id returning revision into n;
 return n;
end $$;
revoke all on function public.workspace_associate_report(uuid,text,uuid,bigint,integer,text,integer[]) from public,anon,authenticated,service_role;
grant execute on function public.workspace_associate_report(uuid,text,uuid,bigint,integer,text,integer[]) to service_role;
