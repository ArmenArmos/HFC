-- The plan publication event already notifies recipients. Retain the review
-- outcome in activity without sending a second publication notification.
create or replace function public.workspace_record_event(p_case uuid, p_kind text, p_revision integer)
returns void language plpgsql security definer set search_path = '' as $$
declare e bigint; d uuid; actor text; label text;
begin
 actor := coalesce(nullif(current_setting('noreon.actor',true),''),'system');
 label := coalesce(nullif(current_setting('noreon.actor_label',true),''),'System');
 insert into public.workspace_activity(case_id,kind,actor_id,actor_label,case_revision)
 values(p_case,p_kind,actor,label,p_revision) returning id into e;
 select assigned_doctor_id into d from public.workspace_cases where id=p_case;
 if p_kind in ('draft.saved','questionnaire.updated','review.published') then return; end if;
 insert into public.workspace_notifications(event_id,recipient)
 select e,'staff:'||user_id from public.workspace_staff where role='admin' and active and 'staff:'||user_id <> actor;
 if d is not null and 'staff:'||d <> actor then
 insert into public.workspace_notifications(event_id,recipient) values(e,'staff:'||d) on conflict do nothing;
 end if;
 if p_kind in ('assignment.changed','consultation.changed','appointment.changed','booking.changed','plan.published','review.no_change','workflow.reset') and 'member:'||p_case <> actor then
 insert into public.workspace_notifications(event_id,recipient) values(e,'member:'||p_case) on conflict do nothing;
 end if;
end; $$;
