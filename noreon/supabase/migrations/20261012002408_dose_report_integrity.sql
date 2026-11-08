-- Preserve known baseline facts; no attempt to reconstruct earlier overwritten reports.
alter table public.patient_dose_events add column revision bigint not null default 1 check(revision>=1);
create table public.patient_dose_event_history (
 user_id uuid not null,medication_id uuid not null,due_at timestamptz not null,
 revision bigint not null check(revision>=1),status text not null check(status in ('taken','skipped')),
 recorded_at timestamptz not null,recorded_by uuid,
 kind text not null check(kind in ('baseline','report')),
 primary key(user_id,medication_id,due_at,revision),
 foreign key(user_id,medication_id,due_at) references public.patient_dose_events(user_id,medication_id,due_at) on delete cascade
);
alter table public.patient_dose_event_history enable row level security;
revoke all on public.patient_dose_event_history from public,anon,authenticated,service_role;
grant select on public.patient_dose_event_history to authenticated;
create policy own_dose_event_history on public.patient_dose_event_history for select using((select auth.uid())=user_id);
insert into public.patient_dose_event_history(user_id,medication_id,due_at,revision,status,recorded_at,kind)
 select user_id,medication_id,due_at,revision,status,recorded_at,'baseline' from public.patient_dose_events;

create function public.version_patient_dose_event() returns trigger
language plpgsql set search_path='' as $$
begin
 if tg_op='INSERT' then new.revision:=1;return new;end if;
 if (new.user_id,new.medication_id,new.due_at) is distinct from (old.user_id,old.medication_id,old.due_at) then raise exception 'dose identity immutable';end if;
 if new.status=old.status then return null;end if;
 new.revision:=old.revision+1;new.recorded_at:=clock_timestamp();return new;
end $$;
create function public.audit_patient_dose_event() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 insert into public.patient_dose_event_history(user_id,medication_id,due_at,revision,status,recorded_at,recorded_by,kind)
 values(new.user_id,new.medication_id,new.due_at,new.revision,new.status,new.recorded_at,auth.uid(),'report');
 return new;
end $$;
revoke all on function public.version_patient_dose_event() from public,anon,authenticated,service_role;
revoke all on function public.audit_patient_dose_event() from public,anon,authenticated,service_role;
create trigger version_patient_dose_event before insert or update on public.patient_dose_events for each row execute function public.version_patient_dose_event();
create trigger audit_patient_dose_event after insert or update on public.patient_dose_events for each row execute function public.audit_patient_dose_event();

alter function public.report_patient_dose(uuid,timestamptz,text) rename to report_patient_dose_unversioned;
revoke all on function public.report_patient_dose_unversioned(uuid,timestamptz,text) from public,anon,authenticated,service_role;
create function public.report_patient_dose_versioned(p_medication_id uuid,p_due_at timestamptz,p_status text,p_expected_revision bigint)
returns bigint language plpgsql security definer set search_path='' as $$
declare current_event public.patient_dose_events;result bigint;
begin
 if auth.uid() is null or p_expected_revision is null or p_expected_revision<0 or p_status is null or p_status not in ('taken','skipped') then raise exception 'invalid dose report';end if;
 -- Same medication->plan lock order as the existing schedule validator.
 perform 1 from public.patient_care_medications where id=p_medication_id and user_id=auth.uid() for update;
 if not found then raise exception 'medication unavailable';end if;
 select * into current_event from public.patient_dose_events where user_id=auth.uid() and medication_id=p_medication_id and due_at=p_due_at;
 if current_event.revision is null then
  if p_expected_revision<>0 then raise exception 'dose revision conflict';end if;
 elsif p_expected_revision<>current_event.revision and not(current_event.revision=p_expected_revision+1 and current_event.status=p_status) then
  raise exception 'dose revision conflict';
 end if;
 -- Always revalidate current plan and due time, even on an otherwise idempotent retry.
 perform public.report_patient_dose_unversioned(p_medication_id,p_due_at,p_status);
 select revision into result from public.patient_dose_events where user_id=auth.uid() and medication_id=p_medication_id and due_at=p_due_at;
 return result;
end $$;
-- Legacy clients may create/retry the first report, but never overwrite a correction.
create function public.report_patient_dose(p_medication_id uuid,p_due_at timestamptz,p_status text)
returns void language plpgsql security definer set search_path='' as $$
begin perform public.report_patient_dose_versioned(p_medication_id,p_due_at,p_status,0);end $$;
revoke all on function public.report_patient_dose_versioned(uuid,timestamptz,text,bigint) from public,anon,authenticated,service_role;
revoke all on function public.report_patient_dose(uuid,timestamptz,text) from public,anon,authenticated,service_role;
grant execute on function public.report_patient_dose_versioned(uuid,timestamptz,text,bigint) to authenticated;
grant execute on function public.report_patient_dose(uuid,timestamptz,text) to authenticated;
