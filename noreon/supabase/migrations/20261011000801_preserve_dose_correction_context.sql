-- Correcting a dose retains its original publication context, including unknown legacy context.
create or replace function public.workspace_report_dose(p_id uuid,p_expected_revision integer,p_plan_id text,p_order_id text,p_due_at timestamptz,p_status text) returns integer
language plpgsql security definer set search_path='' as $$
declare c public.workspace_cases; care jsonb; o jsonb; pid text; stamp timestamptz:=clock_timestamp(); local_due timestamp; offset_minutes integer; events jsonb; prior_event jsonb;
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
 select e into prior_event from jsonb_array_elements(care->'events') e where e->>'medicationId'=p_order_id and (e->>'dueAt')::timestamptz=p_due_at limit 1;
 select coalesce(jsonb_agg(e order by n),'[]') into events from jsonb_array_elements(care->'events') with ordinality x(e,n)
 where not (e->>'medicationId'=p_order_id and (e->>'dueAt')::timestamptz=p_due_at);
 care:=jsonb_set(care,'{events}',events||jsonb_build_array(jsonb_build_object('medicationId',p_order_id,'planId',case when prior_event is not null then prior_event->>'planId' else pid end,'dueAt',p_due_at,'status',p_status,'recordedAt',stamp)));
 perform public.workspace_set_actor(null,p_id);
 update public.workspace_cases set state=jsonb_set(state,'{care}',care),revision=revision+1 where id=p_id returning revision into p_expected_revision;
 return p_expected_revision;
end $$;
