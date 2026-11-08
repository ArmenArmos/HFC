-- Minimal transactional history for the shared fictional workspace. No clinical values.
create table public.workspace_activity (
 id bigint generated always as identity primary key,
 case_id uuid not null references public.workspace_cases(id) on delete cascade,
 kind text not null,
 actor_id text not null,
 actor_label text not null,
 created_at timestamptz not null default now(),
 case_revision integer not null
);
create index workspace_activity_case on public.workspace_activity(case_id, id desc);
alter table public.workspace_activity enable row level security;
revoke all on public.workspace_activity from public, anon, authenticated, service_role;
grant select, insert on public.workspace_activity to service_role;
grant usage on sequence public.workspace_activity_id_seq to service_role;
create table public.workspace_notifications (
 id bigint generated always as identity primary key,
 event_id bigint not null references public.workspace_activity(id) on delete cascade,
 recipient text not null,
 read_at timestamptz,
 unique(event_id, recipient)
);
create index workspace_notifications_recipient on public.workspace_notifications(recipient, id desc);
alter table public.workspace_notifications enable row level security;
revoke all on public.workspace_notifications from public, anon, authenticated, service_role;
grant select, insert, update on public.workspace_notifications to service_role;
grant usage on sequence public.workspace_notifications_id_seq to service_role;

create function public.workspace_record_event(p_case uuid, p_kind text, p_revision integer)
returns void language plpgsql security definer set search_path = '' as $$
declare e bigint; d uuid; actor text; label text;
begin
 actor := coalesce(nullif(current_setting('noreon.actor',true),''),'system');
 label := coalesce(nullif(current_setting('noreon.actor_label',true),''),'System');
 insert into public.workspace_activity(case_id,kind,actor_id,actor_label,case_revision)
 values(p_case,p_kind,actor,label,p_revision) returning id into e;
 select assigned_doctor_id into d from public.workspace_cases where id=p_case;
 -- Draft saves are history only. Members never receive unapproved results or draft details.
 if p_kind = 'draft.saved' then return; end if;
 insert into public.workspace_notifications(event_id,recipient)
 select e,'staff:'||user_id from public.workspace_staff where role='admin' and active and 'staff:'||user_id <> actor;
 if d is not null and 'staff:'||d <> actor then
 insert into public.workspace_notifications(event_id,recipient) values(e,'staff:'||d) on conflict do nothing;
 end if;
 if p_kind in ('assignment.changed','consultation.changed','appointment.changed','booking.changed','plan.published','workflow.reset') and 'member:'||p_case <> actor then
 insert into public.workspace_notifications(event_id,recipient) values(e,'member:'||p_case) on conflict do nothing;
 end if;
end; $$;
revoke all on function public.workspace_record_event(uuid,text,integer) from public,anon,authenticated;

create function public.workspace_audit_case() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' then perform public.workspace_record_event(new.id,'case.created',new.revision); return new; end if;
 if new.assigned_doctor_id is distinct from old.assigned_doctor_id then perform public.workspace_record_event(new.id,'assignment.changed',new.revision); end if;
 if new.state #> '{state,assessment}' is distinct from old.state #> '{state,assessment}' then
 perform public.workspace_record_event(new.id,case when new.state #>> '{state,assessment,completedAt}' is not null then 'questionnaire.completed' else 'questionnaire.updated' end,new.revision); end if;
 if new.state #> '{workflow,startedAt}' is distinct from old.state #> '{workflow,startedAt}' and old.state->'workflow' is not null then perform public.workspace_record_event(new.id,'workflow.reset',new.revision); end if;
 if new.state #> '{workflow,bookings}' is distinct from old.state #> '{workflow,bookings}' then perform public.workspace_record_event(new.id,'booking.changed',new.revision); end if;
 if new.state #> '{workflow,receivedTestIds}' is distinct from old.state #> '{workflow,receivedTestIds}' then perform public.workspace_record_event(new.id,'results.updated',new.revision); end if;
 if new.state #> '{workflow,consultation}' is distinct from old.state #> '{workflow,consultation}' then perform public.workspace_record_event(new.id,'consultation.changed',new.revision); end if;
 if new.state #> '{workflow,appointment}' is distinct from old.state #> '{workflow,appointment}' then perform public.workspace_record_event(new.id,'appointment.changed',new.revision); end if;
 if new.state #> '{workflow,draft}' is distinct from old.state #> '{workflow,draft}' then perform public.workspace_record_event(new.id,'draft.saved',new.revision); end if;
 if new.state #> '{workflow,publication}' is distinct from old.state #> '{workflow,publication}' and new.state #>> '{workflow,publication,publishedAt}' is not null then perform public.workspace_record_event(new.id,'plan.published',new.revision); end if;
 return new;
end; $$;
revoke all on function public.workspace_audit_case() from public,anon,authenticated;
create trigger workspace_case_activity after insert or update on public.workspace_cases for each row execute function public.workspace_audit_case();

-- Server derives the actor after authentication; browser roles cannot execute these RPCs.
create function public.workspace_set_actor(p_actor uuid, p_case uuid) returns void language plpgsql security definer set search_path='' as $$
declare label text;
begin
 if p_actor is null then
 perform set_config('noreon.actor','member:'||p_case,true); perform set_config('noreon.actor_label','Member',true);
 else
 select display_name into label from public.workspace_staff where user_id=p_actor and active;
 if label is null then raise exception 'inactive actor'; end if;
 perform set_config('noreon.actor','staff:'||p_actor,true); perform set_config('noreon.actor_label',label,true);
 end if;
end; $$;
revoke all on function public.workspace_set_actor(uuid,uuid) from public,anon,authenticated;
create function public.workspace_save_case_audited(p_id uuid,p_expected_revision integer,p_state jsonb,p_actor uuid default null,p_publication_key text default null)
returns integer language plpgsql security definer set search_path='' as $$
begin
 perform public.workspace_set_actor(p_actor,p_id);
 return public.workspace_save_case(p_id,p_expected_revision,p_state,p_publication_key);
end; $$;
revoke all on function public.workspace_save_case_audited(uuid,integer,jsonb,uuid,text) from public,anon,authenticated;
grant execute on function public.workspace_save_case_audited(uuid,integer,jsonb,uuid,text) to service_role;
create function public.workspace_assign_case_audited(p_id uuid,p_expected_revision integer,p_doctor_id uuid,p_actor uuid)
returns integer language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.workspace_staff where user_id=p_actor and role='admin' and active) then raise exception 'admin required'; end if;
 perform public.workspace_set_actor(p_actor,p_id);
 return public.workspace_assign_case(p_id,p_expected_revision,p_doctor_id);
end; $$;
revoke all on function public.workspace_assign_case_audited(uuid,integer,uuid,uuid) from public,anon,authenticated;
grant execute on function public.workspace_assign_case_audited(uuid,integer,uuid,uuid) to service_role;
