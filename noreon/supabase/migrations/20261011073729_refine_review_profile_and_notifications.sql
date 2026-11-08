-- Date of birth and biological sex affect clinical context; name-only edits do not.
-- Routine readings and identity edits advance an existing review, without
-- creating recurring clinical work. Follow-up scheduling owns routine reviews.
create or replace function public.workspace_dispatch_case_review() returns trigger
language plpgsql security definer set search_path='' as $$
declare a jsonb;b jsonb;k text;opens boolean:=false;eligible boolean;reason text:='evidence';
begin
 if old.state is not distinct from new.state or old.evidence_revision=new.evidence_revision then return new;end if;
 a:=public.workspace_evidence_projection(old.state);b:=public.workspace_evidence_projection(new.state);
 for k in select jsonb_object_keys(b) order by 1 loop
  if (a->k is distinct from b->k and k not in ('measurements','profile'))
   or (k='profile' and (a#>'{profile,birthDate}' is distinct from b#>'{profile,birthDate}'
    or a#>'{profile,biologicalSex}' is distinct from b#>'{profile,biologicalSex}')) then
   opens:=true;reason:='evidence.'||k;
  end if;
 end loop;
 -- Keep previously published cases visible even while reassessment is incomplete.
 eligible:=new.state#>>'{state,assessment,completedAt}' is not null
  or new.state#>>'{workflow,publication,at}' is not null;
 perform public.workspace_reconcile_review_task(new.id,opens and eligible,reason);
 return new;
end $$;
revoke all on function public.workspace_dispatch_case_review() from public,anon,authenticated,service_role;

-- Notify members of a completed no-change review without exposing the private note.
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
 if p_kind in ('assignment.changed','consultation.changed','appointment.changed','booking.changed','plan.published','review.no_change','workflow.reset') and 'member:'||p_case <> actor then
 insert into public.workspace_notifications(event_id,recipient) values(e,'member:'||p_case) on conflict do nothing;
 end if;
end; $$;
