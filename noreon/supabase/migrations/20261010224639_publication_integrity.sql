-- Publication integrity: application writes serialize on the case before reports.
alter table public.workspace_cases
 add column evidence_revision bigint not null default 0,
 add column draft_evidence_revision bigint,
 add column draft_saved_by uuid,
 add column draft_saved_at timestamptz;
create table public.workspace_evidence_changes (
 id bigint generated always as identity primary key,
 case_id uuid not null references public.workspace_cases(id) on delete cascade,
 revision bigint not null,
 kind text not null,
 reference_id text,
 created_at timestamptz not null default now()
);
create index workspace_evidence_changes_case on public.workspace_evidence_changes(case_id,revision);
alter table public.workspace_evidence_changes enable row level security;
revoke all on public.workspace_evidence_changes from public,anon,authenticated,service_role;
grant select on public.workspace_evidence_changes to service_role;

create function public.workspace_evidence_projection(s jsonb) returns jsonb
language sql immutable set search_path='' as $$
 select jsonb_build_object(
 'assessment',s#>'{state,assessment}', 'measurements',s->'measurements',
 'profile',(s#>'{state,profile}')-'locale', 'consent',s#>'{state,consentAccepted}',
 'tests',coalesce((select jsonb_agg(t-'title' order by t->>'id') from jsonb_array_elements(coalesce(s#>'{workflow,tests}','[]')) t),'[]'),
 'received',coalesce((select jsonb_agg(t order by t) from (select distinct value t from jsonb_array_elements(coalesce(s#>'{workflow,receivedTestIds}','[]'))) r),'[]'),
 'allResultsAt',s#>'{workflow,allResultsAt}')
$$;
create function public.workspace_bump_case_evidence() returns trigger
language plpgsql security definer set search_path='' as $$
declare before_e jsonb; after_e jsonb;
begin
 before_e:=public.workspace_evidence_projection(old.state); after_e:=public.workspace_evidence_projection(new.state);
 if before_e is distinct from after_e then
  new.evidence_revision:=old.evidence_revision+1;
 end if;
 return new;
end $$;
create trigger workspace_case_evidence_before before update of state on public.workspace_cases
 for each row execute function public.workspace_bump_case_evidence();
create function public.workspace_log_case_evidence() returns trigger
language plpgsql security definer set search_path='' as $$
declare k text; a jsonb; b jsonb;
begin
 a:=public.workspace_evidence_projection(old.state); b:=public.workspace_evidence_projection(new.state);
 for k in select jsonb_object_keys(b) loop
  if a->k is distinct from b->k then
   insert into public.workspace_evidence_changes(case_id,revision,kind) values(new.id,new.evidence_revision,k);
  end if;
 end loop;
 return new;
end $$;
create trigger workspace_case_evidence_after after update of state on public.workspace_cases
 for each row execute function public.workspace_log_case_evidence();
create function public.workspace_bump_report_evidence() returns trigger
language plpgsql security definer set search_path='' as $$
declare c uuid; r bigint; rid text;
begin
 if tg_op='UPDATE' then
  if new.case_id<>old.case_id or new.id<>old.id then raise exception 'report identity immutable'; end if;
  if new.record is not distinct from old.record and new.approval is not distinct from old.approval then return new; end if;
 end if;
 c:=case when tg_op='DELETE' then old.case_id else new.case_id end;
 rid:=case when tg_op='DELETE' then old.id else new.id end;
 update public.workspace_cases set evidence_revision=evidence_revision+1 where id=c returning evidence_revision into r;
 if not found then
  if tg_op='DELETE' then return old; else return new; end if;
 end if;
 insert into public.workspace_evidence_changes(case_id,revision,kind,reference_id)
 values(c,r,'report.'||lower(tg_op),rid);
 if tg_op='DELETE' then return old; else return new; end if;
end $$;
create trigger workspace_report_evidence after insert or update or delete on public.workspace_case_reports
 for each row execute function public.workspace_bump_report_evidence();

-- Internal validator: callers must hold the case lock before this function.
create function public.workspace_review_doctor(p_id uuid,p_actor uuid) returns text
language plpgsql security definer set search_path='' as $$
declare d public.workspace_staff; active_clinic boolean; assigned uuid;
begin
 select assigned_doctor_id into assigned from public.workspace_cases where id=p_id;
 if p_actor is null or assigned is distinct from p_actor then raise exception 'Assign an active GP before review.'; end if;
 select * into d from public.workspace_staff where user_id=p_actor for share;
 if not found or not d.active or d.role<>'doctor' or d.clinic_id is null then raise exception 'Assign an active GP before review.'; end if;
 select active into active_clinic from public.workspace_clinics where id=d.clinic_id for share;
 if active_clinic is distinct from true then raise exception 'The assigned clinic is inactive.'; end if;
 return d.display_name;
end $$;
create function public.workspace_valid_review_draft(d jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare k text; t jsonb;
begin
 if jsonb_typeof(d) is distinct from 'object' then return false; end if;
 if (select count(*) from jsonb_object_keys(d))<>7 then return false; end if;
 foreach k in array array['explanation','instructions','followUp','medicationName','medicationDose','medicationInstructions'] loop
  if jsonb_typeof(d->k) is distinct from 'string' then return false; end if;
 end loop;
 if length(btrim(d->>'explanation')) not between 1 and 1500 or length(btrim(d->>'instructions')) not between 1 and 1500
 or btrim(d->>'instructions')='Add the approved care instructions.'
 or length(btrim(d->>'followUp'))>500 or length(btrim(d->>'medicationInstructions'))>500
 or length(btrim(d->>'medicationName'))>120 or length(btrim(d->>'medicationDose'))>120
 or jsonb_typeof(d->'medicationTimes') is distinct from 'array' then return false; end if;
 if jsonb_array_length(d->'medicationTimes')>4 then return false; end if;
 for t in select value from jsonb_array_elements(d->'medicationTimes') loop
  if jsonb_typeof(t)<>'string' or (t#>>'{}') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then return false; end if;
 end loop;
 return btrim(d->>'medicationName')='' or (btrim(d->>'medicationDose')<>'' and jsonb_array_length(d->'medicationTimes')>0);
end $$;
create function public.workspace_case_snapshot(p_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('case',to_jsonb(c),'reports',coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc,r.id) from public.workspace_case_reports r where r.case_id=c.id),'[]'),
 'changes',coalesce((select jsonb_agg(to_jsonb(e) order by e.revision,e.id) from public.workspace_evidence_changes e where e.case_id=c.id and e.revision>coalesce(c.draft_evidence_revision,-1)),'[]'))
 from public.workspace_cases c where c.id=p_id and c.expires_at>now()
$$;
create or replace function public.workspace_save_case(p_id uuid,p_expected_revision integer,p_state jsonb,p_publication_key text default null)
returns integer language plpgsql security definer set search_path='' as $$
declare c public.workspace_cases; k text;
begin
 select * into c from public.workspace_cases where id=p_id and expires_at>now() for update;
 if not found or c.revision<>p_expected_revision then raise exception 'workspace case conflict'; end if;
 if p_state->>'userId' is distinct from p_id::text then raise exception 'workspace case identity mismatch'; end if;
 if p_publication_key is not null then raise exception 'Use the publication command.'; end if;
 foreach k in array array['draft','draftSaved','startedAt','publication'] loop
  if p_state#>array['workflow',k] is distinct from c.state#>array['workflow',k] then raise exception 'Protected review fields require an explicit command.'; end if;
 end loop;
 update public.workspace_cases set state=p_state,revision=revision+1 where id=p_id returning revision into p_expected_revision;
 return p_expected_revision;
end $$;
create function public.workspace_create_case(p_id uuid,p_state jsonb,p_doctor uuid default null) returns integer
language plpgsql security definer set search_path='' as $$
begin
 if p_state->>'userId' is distinct from p_id::text or p_state ? 'workflow' then raise exception 'Invalid new case.'; end if;
 insert into public.workspace_cases(id,state,assigned_doctor_id,expires_at)
 values(p_id,p_state,p_doctor,to_timestamp((p_state->>'expiresAt')::double precision/1000));
 return 0;
end $$;
create function public.workspace_initialize_workflow(p_id uuid,p_expected_revision integer,p_workflow jsonb) returns integer
language plpgsql security definer set search_path='' as $$
declare c public.workspace_cases;
begin
 select * into c from public.workspace_cases where id=p_id and expires_at>now() for update;
 if not found or c.revision<>p_expected_revision then raise exception 'workspace case conflict'; end if;
 if c.state->'workflow' is not null or coalesce((p_workflow->>'draftSaved')::boolean,false) or p_workflow->'publication' is distinct from 'null'::jsonb then raise exception 'Invalid workflow initialization.'; end if;
 update public.workspace_cases set state=jsonb_set(state,'{workflow}',p_workflow),revision=revision+1 where id=p_id returning revision into p_expected_revision;
 return p_expected_revision;
end $$;
create function public.workspace_reset_review(p_id uuid,p_actor uuid,p_expected_revision integer,p_workflow jsonb) returns integer
language plpgsql security definer set search_path='' as $$
declare c public.workspace_cases;
begin
 select * into c from public.workspace_cases where id=p_id and expires_at>now() for update;
 if not found or c.revision<>p_expected_revision then raise exception 'workspace case conflict'; end if;
 if not exists(select 1 from public.workspace_staff where user_id=p_actor and role='admin' and active) then raise exception 'admin required'; end if;
 if coalesce((p_workflow->>'draftSaved')::boolean,false) or p_workflow->'publication' is distinct from 'null'::jsonb then raise exception 'Invalid reset.'; end if;
 perform public.workspace_set_actor(p_actor,p_id);
 update public.workspace_cases set state=jsonb_set(jsonb_set(state,'{workflow}',p_workflow),'{care}',jsonb_build_object('stage',coalesce(state#>>'{care,stage}','profile'),'events','[]'::jsonb,'acknowledged',false)),
 revision=revision+1,draft_evidence_revision=null,draft_saved_by=null,draft_saved_at=null where id=p_id returning revision into p_expected_revision;
 return p_expected_revision;
end $$;
create function public.workspace_delete_expired_case(p_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.workspace_cases where id=p_id and expires_at<=now() for update;
 if not found then return false; end if;
 delete from public.workspace_cases where id=p_id;
 return true;
end $$;

create function public.workspace_write_report(p_id uuid,p_report_id text,p_op text,p_expected_revision integer default null,p_record jsonb default null,p_approval jsonb default null,p_actor uuid default null)
returns integer language plpgsql security definer set search_path='' as $$
declare r public.workspace_case_reports; n integer;
begin
 perform 1 from public.workspace_cases where id=p_id and expires_at>now() for update;
 if not found then raise exception 'not_found'; end if;
 if p_op in ('update','approve') then perform public.workspace_review_doctor(p_id,p_actor); end if;
 perform public.workspace_set_actor(p_actor,p_id);
 if p_op='insert' then
  if p_record->>'id' is distinct from p_report_id or p_record->>'user_id' is distinct from p_id::text then raise exception 'invalid'; end if;
  if (select count(*) from public.workspace_case_reports where case_id=p_id)>=10 then raise exception 'report_limit'; end if;
  insert into public.workspace_case_reports(case_id,id,record) values(p_id,p_report_id,p_record); return 0;
 end if;
 select * into r from public.workspace_case_reports where case_id=p_id and id=p_report_id for update;
 if not found then raise exception 'not_found'; end if;
 if p_expected_revision is null or r.revision<>p_expected_revision then raise exception 'conflict'; end if;
 if p_op='delete' then delete from public.workspace_case_reports where case_id=p_id and id=p_report_id; return r.revision+1;
 elsif p_op='update' then
  if p_record->>'id' is distinct from p_report_id or p_record->>'user_id' is distinct from p_id::text then raise exception 'invalid'; end if;
  update public.workspace_case_reports set record=p_record,approval=null,revision=revision+1,updated_at=now() where case_id=p_id and id=p_report_id returning revision into n;
 elsif p_op='approve' then
  if r.record->>'state'<>'confirmed' or r.record->'reviewed' is null or r.record->'reviewed'='null'::jsonb or p_approval->>'revision' is distinct from r.record->>'revision' or p_approval->'report' is distinct from r.record then raise exception 'invalid'; end if;
  update public.workspace_case_reports set approval=p_approval,revision=revision+1,updated_at=now() where case_id=p_id and id=p_report_id returning revision into n;
 else raise exception 'invalid operation'; end if;
 return n;
end $$;

create function public.workspace_save_review_draft(p_id uuid,p_actor uuid,p_expected_revision integer,p_expected_evidence_revision bigint,p_draft jsonb)
returns integer language plpgsql security definer set search_path='' as $$
declare c public.workspace_cases; w jsonb;
begin
 select * into c from public.workspace_cases where id=p_id and expires_at>now() for update;
 if not found or c.revision<>p_expected_revision then raise exception 'workspace case conflict'; end if;
 perform public.workspace_review_doctor(p_id,p_actor);
 if p_expected_evidence_revision is null or c.evidence_revision<>p_expected_evidence_revision then raise exception 'Review the changed evidence before saving.'; end if;
 if not public.workspace_valid_review_draft(p_draft) then raise exception 'Save a valid review draft with approved instructions.'; end if;
 if c.state#>>'{state,assessment,completedAt}' is null or c.state->'workflow' is null then raise exception 'Complete the questionnaire before review.'; end if;
 perform public.workspace_set_actor(p_actor,p_id);
 w:=c.state->'workflow';
 w:=w||jsonb_build_object('draft',p_draft,'draftSaved',true,'revision',coalesce((w->>'revision')::integer,0)+1,
 'events',jsonb_build_array(jsonb_build_object('at',now(),'text','Fictional workflow: save-draft'))||coalesce(w->'events','[]'));
 update public.workspace_cases set state=jsonb_set(state,'{workflow}',w),revision=revision+1,
 draft_evidence_revision=evidence_revision,draft_saved_by=p_actor,draft_saved_at=now() where id=p_id returning revision into p_expected_revision;
 perform public.workspace_record_event(p_id,'evidence.reviewed',p_expected_revision);
 return p_expected_revision;
end $$;
create function public.workspace_publish_review(p_id uuid,p_actor uuid,p_expected_revision integer,p_expected_evidence_revision bigint)
returns integer language plpgsql security definer set search_path='' as $$
declare c public.workspace_cases; w jsonb; pub jsonb; dname text; stamp timestamptz:=clock_timestamp(); key text; n integer;
begin
 select * into c from public.workspace_cases where id=p_id and expires_at>now() for update;
 if not found or c.revision<>p_expected_revision then raise exception 'workspace case conflict'; end if;
 dname:=public.workspace_review_doctor(p_id,p_actor);
 w:=c.state->'workflow';
 if c.state#>>'{state,consentAccepted}' is distinct from 'true' or c.state#>>'{state,assessment,completedAt}' is null or c.state#>>'{state,assessment,urgentRule}' is not null then raise exception 'Complete the questionnaire and resolve urgent guidance before publication.'; end if;
 if w->>'allResultsAt' is null or exists(select 1 from jsonb_array_elements(w->'tests') t where not coalesce(w->'receivedTestIds','[]') ? (t->>'id')) then raise exception 'Receive every required test result before publication.'; end if;
 if w->>'consultation' not in ('required','not-required') or w->>'consultation' is null then raise exception 'Record whether a consultation is needed.'; end if;
 if w->>'consultation'='required' and (w#>>'{appointment,status}' is distinct from 'completed' or w#>>'{appointment,at}' is null or (w#>>'{appointment,at}')::timestamptz>stamp) then raise exception 'Complete the required consultation after its scheduled time.'; end if;
 if w->>'draftSaved' is distinct from 'true' or not public.workspace_valid_review_draft(w->'draft') or c.draft_saved_by is null then raise exception 'Save a valid review draft before publication.'; end if;
 if p_expected_evidence_revision is null or c.evidence_revision<>p_expected_evidence_revision or c.draft_evidence_revision is distinct from c.evidence_revision then raise exception 'Review the changed evidence and save the draft again.'; end if;
 perform 1 from public.workspace_case_reports where case_id=p_id order by id for update;
 if exists(select 1 from public.workspace_case_reports r where r.case_id=p_id and (r.approval is null or r.approval->>'revision' is distinct from r.record->>'revision')) then raise exception 'Check and approve every imported report before publication.'; end if;
 n:=coalesce((w->>'revision')::integer,0)+1;
 pub:=jsonb_build_object('workflowRevision',n,'at',stamp,'doctor',dname,'version',coalesce((w#>>'{publication,version}')::integer,0)+1,'resultTestIds',w->'receivedTestIds','draft',w->'draft');
 key:=(w->>'startedAt')||':'||n;
 perform public.workspace_set_actor(p_actor,p_id);
 update public.workspace_case_reports set published=jsonb_build_object('key',key,'approval',approval),updated_at=stamp where case_id=p_id;
 w:=w||jsonb_build_object('publication',pub,'revision',n,'events',jsonb_build_array(jsonb_build_object('at',stamp,'text','Fictional workflow: publish'))||coalesce(w->'events','[]'));
 update public.workspace_cases set state=jsonb_set(jsonb_set(state,'{workflow}',w),'{care}',jsonb_build_object('stage',coalesce(state#>>'{care,stage}','profile'),'events','[]'::jsonb,'acknowledged',false)),revision=revision+1 where id=p_id returning revision into p_expected_revision;
 return p_expected_revision;
end $$;

revoke insert,update,delete,truncate on public.workspace_cases,public.workspace_case_reports from service_role;
-- Explicit grants: every new helper defaults to private; only boundary RPCs are callable.
do $$ declare f record; begin
 for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in (
 'workspace_evidence_projection','workspace_bump_case_evidence','workspace_log_case_evidence','workspace_bump_report_evidence','workspace_review_doctor','workspace_valid_review_draft','workspace_case_snapshot','workspace_create_case','workspace_initialize_workflow','workspace_reset_review','workspace_delete_expired_case','workspace_write_report','workspace_save_review_draft','workspace_publish_review') loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',f.sig);
 end loop;
end $$;
grant execute on function public.workspace_case_snapshot(uuid),public.workspace_create_case(uuid,jsonb,uuid),public.workspace_initialize_workflow(uuid,integer,jsonb),public.workspace_reset_review(uuid,uuid,integer,jsonb),public.workspace_delete_expired_case(uuid),public.workspace_write_report(uuid,text,text,integer,jsonb,jsonb,uuid),public.workspace_save_review_draft(uuid,uuid,integer,bigint,jsonb),public.workspace_publish_review(uuid,uuid,integer,bigint) to service_role;
