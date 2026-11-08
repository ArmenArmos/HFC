create or replace function public.workspace_audit_case() returns trigger language plpgsql security definer set search_path='' as $$
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
 if new.state #> '{workflow,publication}' is distinct from old.state #> '{workflow,publication}' and new.state #>> '{workflow,publication,at}' is not null then perform public.workspace_record_event(new.id,'plan.published',new.revision); end if;
 return new;
end; $$;
revoke all on function public.workspace_audit_case() from public,anon,authenticated;

-- Partial answers remain in history but do not notify the clinical team on every click.
create or replace function public.workspace_record_event(p_case uuid, p_kind text, p_revision integer)
returns void language plpgsql security definer set search_path = '' as $$
declare e bigint; d uuid; actor text; label text;
begin
 actor := coalesce(nullif(current_setting('noreon.actor',true),''),'system');
 label := coalesce(nullif(current_setting('noreon.actor_label',true),''),'System');
 insert into public.workspace_activity(case_id,kind,actor_id,actor_label,case_revision)
 values(p_case,p_kind,actor,label,p_revision) returning id into e;
 select assigned_doctor_id into d from public.workspace_cases where id=p_case;
 if p_kind in ('draft.saved','questionnaire.updated') then return; end if;
 insert into public.workspace_notifications(event_id,recipient)
 select e,'staff:'||user_id from public.workspace_staff where role='admin' and active and 'staff:'||user_id <> actor;
 if d is not null and 'staff:'||d <> actor then
 insert into public.workspace_notifications(event_id,recipient) values(e,'staff:'||d) on conflict do nothing;
 end if;
 if p_kind in ('assignment.changed','consultation.changed','appointment.changed','booking.changed','plan.published','workflow.reset') and 'member:'||p_case <> actor then
 insert into public.workspace_notifications(event_id,recipient) values(e,'member:'||p_case) on conflict do nothing;
 end if;
end; $$;
