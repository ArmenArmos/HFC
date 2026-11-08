-- Per-dose CAS complements the case lock: action-time case reads cannot identify a stale rendered check-in.
-- Existing events retain their JSON shape and project as revision 1 until changed.
-- Their baseline is copied into history on the first successful report/retry, avoiding a broad state rewrite.
create table public.workspace_dose_event_history (
 case_id uuid not null references public.workspace_cases(id) on delete cascade,
 medication_id text not null,
 due_at timestamptz not null,
 revision bigint not null check (revision>0),
 plan_id text,
 status text not null check (status in ('taken','skipped')),
 recorded_at timestamptz not null,
 kind text not null check (kind in ('baseline','report')),
 primary key (case_id,medication_id,due_at,revision)
);
alter table public.workspace_dose_event_history enable row level security;
revoke all on public.workspace_dose_event_history from public,anon,authenticated,service_role;
grant select on public.workspace_dose_event_history to service_role;

create or replace function public.workspace_report_dose_versioned(p_id uuid,p_expected_revision integer,p_plan_id text,p_order_id text,p_due_at timestamptz,p_status text,p_expected_dose_revision bigint) returns integer
language plpgsql security definer set search_path='' as $$
declare c public.workspace_cases; care jsonb; o jsonb; pid text; stamp timestamptz:=clock_timestamp(); local_due timestamp; offset_minutes integer; events jsonb; prior_event jsonb; dose_revision bigint; next_event jsonb;
begin
 select * into c from public.workspace_cases where id=p_id and expires_at>now() for update;
 if not found or p_expected_revision is null or c.revision<>p_expected_revision then raise exception 'workspace case conflict'; end if;
 if p_expected_dose_revision is null or p_expected_dose_revision<0 then raise exception 'invalid dose report'; end if;
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
 select e into prior_event from jsonb_array_elements(care->'events') e where e->>'medicationId'=p_order_id and (e->>'dueAt')::timestamptz=p_due_at limit 1;
 -- Absent report is revision 0; pre-versioning reports project as baseline revision 1.
 dose_revision:=case when prior_event is null then 0 else coalesce((prior_event->>'revision')::bigint,1) end;
 if p_expected_dose_revision<>dose_revision and not(dose_revision=p_expected_dose_revision+1 and prior_event->>'status'=p_status) then
  raise exception 'dose revision conflict';
 end if;
 -- Seed legacy history lazily under the same lock, preserving unknown plan context.
 if prior_event is not null then
  insert into public.workspace_dose_event_history(case_id,medication_id,due_at,revision,plan_id,status,recorded_at,kind)
  values(p_id,p_order_id,p_due_at,dose_revision,prior_event->>'planId',prior_event->>'status',(prior_event->>'recordedAt')::timestamptz,'baseline')
  on conflict (case_id,medication_id,due_at,revision) do nothing;
 end if;
 -- Schedule and current publication checks above also apply to retries.
 if prior_event->>'status'=p_status then return c.revision; end if;
 select coalesce(jsonb_agg(e order by n),'[]') into events from jsonb_array_elements(care->'events') with ordinality x(e,n)
 where not (e->>'medicationId'=p_order_id and (e->>'dueAt')::timestamptz=p_due_at);
 next_event:=jsonb_build_object('medicationId',p_order_id,'planId',case when prior_event is not null then prior_event->>'planId' else pid end,'dueAt',p_due_at,'status',p_status,'recordedAt',stamp,'revision',dose_revision+1);
 care:=jsonb_set(care,'{events}',events||jsonb_build_array(next_event));
 insert into public.workspace_dose_event_history(case_id,medication_id,due_at,revision,plan_id,status,recorded_at,kind)
 values(p_id,p_order_id,p_due_at,dose_revision+1,next_event->>'planId',p_status,stamp,'report');
 perform public.workspace_set_actor(null,p_id);
 update public.workspace_cases set state=jsonb_set(state,'{care}',care),revision=revision+1 where id=p_id returning revision into p_expected_revision;
 return p_expected_revision;
end $$;

-- Migration-first rollout: old clients may create/retry a first report, but cannot silently correct it.
create or replace function public.workspace_report_dose(p_id uuid,p_expected_revision integer,p_plan_id text,p_order_id text,p_due_at timestamptz,p_status text) returns integer
language sql security definer set search_path='' as $$
 select public.workspace_report_dose_versioned(p_id,p_expected_revision,p_plan_id,p_order_id,p_due_at,p_status,0)
$$;
revoke all on function public.workspace_report_dose_versioned(uuid,integer,text,text,timestamptz,text,bigint),public.workspace_report_dose(uuid,integer,text,text,timestamptz,text) from public,anon,authenticated,service_role;
grant execute on function public.workspace_report_dose_versioned(uuid,integer,text,text,timestamptz,text,bigint),public.workspace_report_dose(uuid,integer,text,text,timestamptz,text) to service_role;

-- One statement snapshot keeps displayed event revisions and their history consistent.
create or replace function public.workspace_case_snapshot(p_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('case',to_jsonb(c),'monitoring',public.workspace_monitoring_snapshot(c.id),
 'doseHistory',coalesce((select jsonb_agg(to_jsonb(h) order by h.due_at desc,h.medication_id,h.revision) from public.workspace_dose_event_history h where h.case_id=c.id and h.due_at>=now()-interval '30 days'),'[]'),
 'reports',coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc,r.id) from public.workspace_case_reports r where r.case_id=c.id),'[]'),
 'changes',coalesce((select jsonb_agg(to_jsonb(e) order by e.revision,e.id) from public.workspace_evidence_changes e where e.case_id=c.id and e.revision>coalesce(c.draft_evidence_revision,-1)),'[]'),
 'reviewChanges',coalesce((select jsonb_agg(to_jsonb(e) order by e.revision,e.id) from public.workspace_evidence_changes e where e.case_id=c.id and e.revision>coalesce(c.reviewed_evidence_revision,-1)),'[]'),
 'reviewTasks',coalesce((select jsonb_agg(to_jsonb(t) order by t.opened_at desc,t.id) from public.workspace_review_tasks t where t.case_id=c.id),'[]'))
 from public.workspace_cases c where c.id=p_id and c.expires_at>now()
$$;
