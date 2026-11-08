create function public.workspace_js_trim(s text) returns text
language sql immutable set search_path='' as $$
 select btrim(s,E' \t\n\r\v\f'||U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')
$$;
-- Continuity is part of the locked case, never supplied as a client publication.
create function public.workspace_medication_fields(d jsonb) returns jsonb
language sql immutable set search_path='' as $$
 select jsonb_build_object('name',public.workspace_js_trim(d->>'medicationName'),
 'dose',public.workspace_js_trim(d->>'medicationDose'),'instructions',public.workspace_js_trim(d->>'medicationInstructions'),
 'times',coalesce((select jsonb_agg(t order by t) from (select distinct value t from jsonb_array_elements(coalesce(d->'medicationTimes','[]'))) x),'[]'))
$$;
create function public.workspace_publication_order(w jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare p jsonb:=w->'publication'; oid text; o jsonb;
begin
 if nullif(public.workspace_js_trim(p#>>'{draft,medicationName}'),'') is null then return null; end if;
 oid:=coalesce(p->>'medicationOrderId','workflow-medication-'||(p->>'version'));
 select value into o from jsonb_array_elements(coalesce(w->'medicationOrders','[]')) where value->>'id'=oid;
 if o is not null then return o; end if;
 if p ? 'medicationOrderId' then raise exception 'The published medication order is unavailable.'; end if;
 return jsonb_build_object('id',oid,'originatingPlanId','workflow-plan-'||(p->>'version'),'effectiveAt',p->'at','retiredAt',null)||public.workspace_medication_fields(p->'draft');
end $$;
create function public.workspace_publication_continuity(w jsonb,p jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare prior jsonb:=public.workspace_publication_order(w); orders jsonb:=coalesce(w->'medicationOrders','[]'); history jsonb:=coalesce(w->'publicationHistory','[]'); fields jsonb:=public.workspace_medication_fields(p->'draft'); oid text; oldp jsonb:=w->'publication';
begin
 if prior is not null and not exists(select 1 from jsonb_array_elements(orders) o where o->>'id'=prior->>'id') then orders:=orders||jsonb_build_array(prior); end if;
 if prior is not null and prior->>'retiredAt' is null and (prior-'id'-'originatingPlanId'-'effectiveAt'-'retiredAt')=fields then
  p:=p||jsonb_build_object('medicationOrderId',prior->>'id');
 else
  if prior is not null then
   select coalesce(jsonb_agg(case when o->>'id'=prior->>'id' and o->>'retiredAt' is null then o||jsonb_build_object('retiredAt',p->'at') else o end order by n),'[]') into orders from jsonb_array_elements(orders) with ordinality x(o,n);
  end if;
  if nullif(fields->>'name','') is not null then
   oid:='workflow-medication-'||(p->>'version');
   if exists(select 1 from jsonb_array_elements(orders) o where o->>'id'=oid) then raise exception 'Medication order identity already exists.'; end if;
   orders:=orders||jsonb_build_array(fields||jsonb_build_object('id',oid,'originatingPlanId','workflow-plan-'||(p->>'version'),'effectiveAt',p->'at','retiredAt',null));
   p:=p||jsonb_build_object('medicationOrderId',oid);
  end if;
 end if;
 if oldp is not null and oldp<>'null'::jsonb then
  if prior is not null then oldp:=oldp||jsonb_build_object('medicationOrderId',prior->>'id'); end if;
  history:=history||jsonb_build_array(oldp);
 end if;
 return w||jsonb_build_object('publication',p,'publicationHistory',history,'medicationOrders',orders);
end $$;
create function public.workspace_care_continuity(c jsonb, prior jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
begin
 c:=coalesce(nullif(c,'null'),jsonb_build_object('stage','profile','events','[]'::jsonb,'acknowledged',false));
 if not c ? 'acknowledgements' then
  c:=c||jsonb_build_object('acknowledgements',case when c->>'acknowledged'='true' and prior->>'version' is not null then jsonb_build_array(jsonb_build_object('planId','workflow-plan-'||(prior->>'version'),'at',null)) else '[]'::jsonb end);
 end if;
 return c||jsonb_build_object('acknowledged',false);
end $$;
create function public.workspace_acknowledge_plan(p_id uuid,p_expected_revision integer,p_plan_id text) returns integer
language plpgsql security definer set search_path='' as $$
declare c public.workspace_cases; care jsonb; pid text;
begin
 select * into c from public.workspace_cases where id=p_id and expires_at>now() for update;
 if not found or c.revision<>p_expected_revision then raise exception 'workspace case conflict'; end if;
 pid:='workflow-plan-'||(c.state#>>'{workflow,publication,version}');
 if c.state#>>'{state,consentAccepted}' is distinct from 'true' or pid is null or p_plan_id is distinct from pid then raise exception 'Your care plan changed. Refresh and review the current plan.'; end if;
 care:=public.workspace_care_continuity(c.state->'care',c.state#>'{workflow,publication}');
 if not exists(select 1 from jsonb_array_elements(care->'acknowledgements') a where a->>'planId'=pid) then
  care:=jsonb_set(care,'{acknowledgements}',(care->'acknowledgements')||jsonb_build_array(jsonb_build_object('planId',pid,'at',clock_timestamp())));
 end if;
 care:=care||jsonb_build_object('acknowledged',true);
 if care=c.state->'care' then return c.revision; end if;
 perform public.workspace_set_actor(null,p_id);
 update public.workspace_cases set state=jsonb_set(state,'{care}',care),revision=revision+1 where id=p_id returning revision into p_expected_revision;
 return p_expected_revision;
end $$;
create function public.workspace_report_dose(p_id uuid,p_expected_revision integer,p_plan_id text,p_order_id text,p_due_at timestamptz,p_status text) returns integer
language plpgsql security definer set search_path='' as $$
declare c public.workspace_cases; care jsonb; o jsonb; pid text; stamp timestamptz:=clock_timestamp(); local_due timestamp; offset_minutes integer; events jsonb;
begin
 select * into c from public.workspace_cases where id=p_id and expires_at>now() for update;
 if not found or c.revision<>p_expected_revision then raise exception 'workspace case conflict'; end if;
 stamp:=clock_timestamp();
 pid:='workflow-plan-'||(c.state#>>'{workflow,publication,version}');
 if c.state#>>'{state,consentAccepted}' is distinct from 'true' or pid is null or p_plan_id is distinct from pid then raise exception 'Your care plan changed. Refresh and review the current plan.'; end if;
 o:=public.workspace_publication_order(c.state->'workflow');
 local_due:=p_due_at at time zone 'Asia/Yerevan';
 offset_minutes:=coalesce((c.state#>>'{reminderPreferences,preferences,medicationOffsetMinutes}')::integer,0);
 if offset_minutes not in (-15,0,15) then raise exception 'Invalid reminder preferences'; end if;
 if p_status is null or p_status not in ('taken','skipped') or o is null or p_order_id is distinct from o->>'id' or o->>'retiredAt' is not null
 or p_due_at is null or not isfinite(p_due_at) or p_due_at>stamp or p_due_at<(o->>'effectiveAt')::timestamptz
 or (local_due::date<>(stamp at time zone 'Asia/Yerevan')::date and (local_due+make_interval(mins=>offset_minutes))::date<>(stamp at time zone 'Asia/Yerevan')::date)
 or date_trunc('minute',local_due)<>local_due or not (o->'times' ? to_char(local_due,'HH24:MI')) then raise exception 'This dose is not available for check-in. Refresh the current schedule.'; end if;
 care:=public.workspace_care_continuity(c.state->'care',c.state#>'{workflow,publication}');
 care:=care||jsonb_build_object('acknowledged',exists(select 1 from jsonb_array_elements(care->'acknowledgements') a where a->>'planId'=pid));
 if exists(select 1 from jsonb_array_elements(care->'events') e where e->>'medicationId'=p_order_id and (e->>'dueAt')::timestamptz=p_due_at and e->>'status'=p_status) then return c.revision; end if;
 select coalesce(jsonb_agg(e order by n),'[]') into events from jsonb_array_elements(care->'events') with ordinality x(e,n)
 where not (e->>'medicationId'=p_order_id and (e->>'dueAt')::timestamptz=p_due_at);
 care:=jsonb_set(care,'{events}',events||jsonb_build_array(jsonb_build_object('medicationId',p_order_id,'planId',pid,'dueAt',p_due_at,'status',p_status,'recordedAt',stamp)));
 perform public.workspace_set_actor(null,p_id);
 update public.workspace_cases set state=jsonb_set(state,'{care}',care),revision=revision+1 where id=p_id returning revision into p_expected_revision;
 return p_expected_revision;
end $$;

create function public.workspace_clinical_context(s jsonb) returns jsonb
language sql immutable set search_path='' as $$
 select jsonb_build_object('birthDate',s#>'{state,profile,birthDate}','biologicalSex',s#>'{state,profile,biologicalSex}',
 'answers',coalesce((select jsonb_object_agg(k,case when jsonb_typeof(v->'value')='array' then (select coalesce(jsonb_agg(x order by x::text),'[]') from jsonb_array_elements(v->'value') x) else v->'value' end) from jsonb_each(coalesce(s#>'{state,assessment,answers}','{}')) a(k,v)),'{}'))
$$;
revoke all on function public.workspace_clinical_context(jsonb) from public,anon,authenticated,service_role;
create or replace function public.workspace_publish_review(p_id uuid,p_actor uuid,p_expected_revision integer,p_expected_evidence_revision bigint)
returns integer language plpgsql security definer set search_path='' as $$
declare c public.workspace_cases; w jsonb; pub jsonb; dname text; stamp timestamptz:=clock_timestamp(); key text; n integer; care jsonb;
begin
 select * into c from public.workspace_cases where id=p_id and expires_at>now() for update;
 if not found or c.revision<>p_expected_revision then raise exception 'workspace case conflict'; end if;
 stamp:=clock_timestamp();
 dname:=public.workspace_review_doctor(p_id,p_actor);
 w:=c.state->'workflow';
 if c.state#>>'{state,consentAccepted}' is distinct from 'true' or c.state#>>'{state,assessment,completedAt}' is null or c.state#>>'{state,assessment,urgentRule}' is not null then raise exception 'Complete the questionnaire and resolve urgent guidance before publication.'; end if;
 if w->>'clinicalContext' is not null and (w->>'clinicalContext')::jsonb is distinct from public.workspace_clinical_context(c.state) then raise exception 'Review the changed questionnaire before publication.'; end if;
 if w->>'recommendationsPending'='true' or w->>'allResultsAt' is null or exists(select 1 from jsonb_array_elements(w->'tests') t where not coalesce(w->'receivedTestIds','[]') ? (t->>'id')) then raise exception 'Receive every required test result before publication.'; end if;
 if w ? 'requirements' and exists(select 1 from jsonb_array_elements(w->'tests') t where not exists(
  select 1 from jsonb_array_elements(w->'requirements') q join jsonb_array_elements(coalesce(w->'receiptHistory','[]')) r on r->>'requirementId'=q->>'requirementId'
  where q->>'retiredAtRevision' is null and q#>>'{test,id}'=t->>'id' and q#>>'{test,method}'=t->>'method')) then raise exception 'Receive every current required test result before publication.'; end if;
 if w->>'consultation' not in ('required','not-required') or w->>'consultation' is null then raise exception 'Record whether a consultation is needed.'; end if;
 if w->>'consultation'='required' and (w#>>'{appointment,status}' is distinct from 'completed' or w#>>'{appointment,completedForContext}' is distinct from w->>'clinicalContext' or w->>'clinicalContext' is null or w#>>'{appointment,at}' is null or (w#>>'{appointment,at}')::timestamptz>stamp) then raise exception 'Complete the required consultation after its scheduled time.'; end if;
 if w->>'draftSaved' is distinct from 'true' or not public.workspace_valid_review_draft(w->'draft') or c.draft_saved_by is null then raise exception 'Save a valid review draft before publication.'; end if;
 if p_expected_evidence_revision is null or c.evidence_revision<>p_expected_evidence_revision or c.draft_evidence_revision is distinct from c.evidence_revision then raise exception 'Review the changed evidence and save the draft again.'; end if;
 perform 1 from public.workspace_case_reports where case_id=p_id order by id for update;
 if exists(select 1 from public.workspace_case_reports r where r.case_id=p_id and (r.approval is null or r.approval->>'revision' is distinct from r.record->>'revision')) then raise exception 'Check and approve every imported report before publication.'; end if;
 n:=coalesce((w->>'revision')::integer,0)+1;
 pub:=jsonb_build_object('workflowRevision',n,'at',stamp,'doctor',dname,'version',coalesce((w#>>'{publication,version}')::integer,0)+1,'resultTestIds',w->'receivedTestIds','resultReceipts',coalesce((select jsonb_agg(r) from jsonb_array_elements(coalesce(w->'receiptHistory','[]')) r where exists(select 1 from jsonb_array_elements(coalesce(w->'requirements','[]')) q where q->>'retiredAtRevision' is null and q->>'requirementId'=r->>'requirementId')),'[]'::jsonb),'draft',w->'draft');
 key:=(w->>'startedAt')||':'||n;
 perform public.workspace_set_actor(p_actor,p_id);
 update public.workspace_case_reports set published=jsonb_build_object('key',key,'approval',approval),updated_at=stamp where case_id=p_id;
 care:=public.workspace_care_continuity(c.state->'care',w->'publication');
 w:=public.workspace_publication_continuity(w,pub);
 w:=w||jsonb_build_object('revision',n,'events',jsonb_build_array(jsonb_build_object('at',stamp,'text','Fictional workflow: publish'))||coalesce(w->'events','[]'));
 update public.workspace_cases set state=jsonb_set(jsonb_set(state,'{workflow}',w),'{care}',care),revision=revision+1 where id=p_id returning revision into p_expected_revision;
 return p_expected_revision;
end $$;

create or replace function public.workspace_save_case(p_id uuid,p_expected_revision integer,p_state jsonb,p_publication_key text default null)
returns integer language plpgsql security definer set search_path='' as $$
declare c public.workspace_cases; k text;
begin
 select * into c from public.workspace_cases where id=p_id and expires_at>now() for update;
 if not found or c.revision<>p_expected_revision then raise exception 'workspace case conflict'; end if;
 if p_state->>'userId' is distinct from p_id::text then raise exception 'workspace case identity mismatch'; end if;
 if p_publication_key is not null then raise exception 'Use the publication command.'; end if;
 foreach k in array array['draft','draftSaved','startedAt','publication','publicationHistory','medicationOrders'] loop
  if p_state#>array['workflow',k] is distinct from c.state#>array['workflow',k] then raise exception 'Protected review fields require an explicit command.'; end if;
 end loop;
 foreach k in array array['events','acknowledged','acknowledgements'] loop
  if p_state#>array['care',k] is distinct from c.state#>array['care',k] then raise exception 'Care records require an explicit command.'; end if;
 end loop;
 update public.workspace_cases set state=p_state,revision=revision+1 where id=p_id returning revision into p_expected_revision;
 return p_expected_revision;
end $$;

create or replace function public.workspace_initialize_workflow(p_id uuid,p_expected_revision integer,p_workflow jsonb) returns integer
language plpgsql security definer set search_path='' as $$
declare c public.workspace_cases;
begin
 select * into c from public.workspace_cases where id=p_id and expires_at>now() for update;
 if not found or c.revision<>p_expected_revision then raise exception 'workspace case conflict'; end if;
 if c.state->'workflow' is not null or coalesce((p_workflow->>'draftSaved')::boolean,false) or p_workflow->'publication' is distinct from 'null'::jsonb then raise exception 'Invalid workflow initialization.'; end if;
 if coalesce(p_workflow->'publicationHistory','[]')<>'[]'::jsonb or coalesce(p_workflow->'medicationOrders','[]')<>'[]'::jsonb then raise exception 'Invalid historical review fields.'; end if;
 update public.workspace_cases set state=jsonb_set(state,'{workflow}',p_workflow),revision=revision+1 where id=p_id returning revision into p_expected_revision;
 return p_expected_revision;
end $$;

create or replace function public.workspace_reset_review(p_id uuid,p_actor uuid,p_expected_revision integer,p_workflow jsonb) returns integer
language plpgsql security definer set search_path='' as $$
declare c public.workspace_cases;
begin
 select * into c from public.workspace_cases where id=p_id and expires_at>now() for update;
 if not found or c.revision<>p_expected_revision then raise exception 'workspace case conflict'; end if;
 if not exists(select 1 from public.workspace_staff where user_id=p_actor and role='admin' and active) then raise exception 'admin required'; end if;
 if coalesce((p_workflow->>'draftSaved')::boolean,false) or p_workflow->'publication' is distinct from 'null'::jsonb then raise exception 'Invalid reset.'; end if;
 perform public.workspace_set_actor(p_actor,p_id);
 if coalesce(p_workflow->'publicationHistory','[]')<>'[]'::jsonb or coalesce(p_workflow->'medicationOrders','[]')<>'[]'::jsonb then raise exception 'Invalid historical review fields.'; end if;
 update public.workspace_cases set state=jsonb_set(jsonb_set(state,'{workflow}',p_workflow),'{care}',jsonb_build_object('stage',coalesce(state#>>'{care,stage}','profile'),'events','[]'::jsonb,'acknowledged',false)),
 revision=revision+1,draft_evidence_revision=null,draft_saved_by=null,draft_saved_at=null where id=p_id returning revision into p_expected_revision;
 return p_expected_revision;
end $$;

-- Helpers are owner-only; member commands are exposed only to the authenticated server boundary.
revoke all on function public.workspace_js_trim(text),public.workspace_medication_fields(jsonb),public.workspace_publication_order(jsonb),public.workspace_publication_continuity(jsonb,jsonb),public.workspace_care_continuity(jsonb,jsonb),public.workspace_acknowledge_plan(uuid,integer,text),public.workspace_report_dose(uuid,integer,text,text,timestamptz,text) from public,anon,authenticated,service_role;
grant execute on function public.workspace_acknowledge_plan(uuid,integer,text),public.workspace_report_dose(uuid,integer,text,text,timestamptz,text) to service_role;

create or replace function public.workspace_evidence_projection(s jsonb) returns jsonb
language sql immutable set search_path='' as $$
 select jsonb_build_object(
 'assessment',s#>'{state,assessment}', 'measurements',s->'measurements',
 'profile',(s#>'{state,profile}')-'locale', 'consent',s#>'{state,consentAccepted}',
 'tests',coalesce((select jsonb_agg(t-'title' order by t->>'id') from jsonb_array_elements(coalesce(s#>'{workflow,tests}','[]')) t),'[]'),
 'received',coalesce((select jsonb_agg(t order by t) from (select distinct value t from jsonb_array_elements(coalesce(s#>'{workflow,receivedTestIds}','[]'))) r),'[]'),
 'allResultsAt',s#>'{workflow,allResultsAt}',
 'pending',coalesce(s#>'{workflow,recommendationsPending}','false'),
 'requirements',case when s#>>'{workflow,recommendationsPending}'='true' then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('id',r->>'requirementId','testId',r#>>'{test,id}','method',r#>>'{test,method}') order by r->>'requirementId') from jsonb_array_elements(coalesce(s#>'{workflow,requirements}','[]')) r where r->>'retiredAtRevision' is null),'[]') end,
 'receipts',case when s#>>'{workflow,recommendationsPending}'='true' then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('requirementId',r->>'requirementId','receivedAt',r->'receivedAt') order by r->>'requirementId') from jsonb_array_elements(coalesce(s#>'{workflow,receiptHistory}','[]')) r where exists(select 1 from jsonb_array_elements(coalesce(s#>'{workflow,requirements}','[]')) q where q->>'requirementId'=r->>'requirementId' and q->>'retiredAtRevision' is null)),'[]') end)
$$;
