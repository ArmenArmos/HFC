create or replace function public.workspace_audit_case() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' then perform public.workspace_record_event(new.id,'case.created',new.revision); return new; end if;
 if new.assigned_doctor_id is distinct from old.assigned_doctor_id then perform public.workspace_record_event(new.id,'assignment.changed',new.revision); end if;
 if new.state #> '{state,assessment}' is distinct from old.state #> '{state,assessment}' then
 perform public.workspace_record_event(new.id,case when new.state #>> '{state,assessment,completedAt}' is not null then 'questionnaire.completed' else 'questionnaire.updated' end,new.revision); end if;
 if new.state #> '{workflow,startedAt}' is distinct from old.state #> '{workflow,startedAt}' and old.state #>> '{workflow,startedAt}' is not null then perform public.workspace_record_event(new.id,'workflow.reset',new.revision); end if;
 if coalesce(new.state #> '{workflow,bookings}','[]'::jsonb) is distinct from coalesce(old.state #> '{workflow,bookings}','[]'::jsonb) then perform public.workspace_record_event(new.id,'booking.changed',new.revision); end if;
 if coalesce(new.state #> '{workflow,receivedTestIds}','[]'::jsonb) is distinct from coalesce(old.state #> '{workflow,receivedTestIds}','[]'::jsonb) then perform public.workspace_record_event(new.id,'results.updated',new.revision); end if;
 if coalesce(new.state #>> '{workflow,consultation}','undecided') is distinct from coalesce(old.state #>> '{workflow,consultation}','undecided') then perform public.workspace_record_event(new.id,'consultation.changed',new.revision); end if;
 if coalesce(new.state #> '{workflow,appointment}','null'::jsonb) is distinct from coalesce(old.state #> '{workflow,appointment}','null'::jsonb) then perform public.workspace_record_event(new.id,'appointment.changed',new.revision); end if;
 if new.state #> '{workflow,draft}' is distinct from old.state #> '{workflow,draft}' then perform public.workspace_record_event(new.id,'draft.saved',new.revision); end if;
 if new.state #> '{workflow,publication}' is distinct from old.state #> '{workflow,publication}' and new.state #>> '{workflow,publication,at}' is not null then perform public.workspace_record_event(new.id,'plan.published',new.revision); end if;
 return new;
end; $$;
revoke all on function public.workspace_audit_case() from public,anon,authenticated;

