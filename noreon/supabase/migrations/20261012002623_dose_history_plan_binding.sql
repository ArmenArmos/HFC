-- Snapshot the source plan instead of resolving it from a potentially changed order later.
alter table public.patient_dose_event_history add column plan_id uuid references public.patient_care_plans(id) on delete set null;
update public.patient_dose_event_history h set plan_id=m.plan_id from public.patient_care_medications m where m.id=h.medication_id and m.user_id=h.user_id;
create or replace function public.audit_patient_dose_event() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 insert into public.patient_dose_event_history(user_id,medication_id,due_at,revision,status,recorded_at,recorded_by,kind,plan_id)
 select new.user_id,new.medication_id,new.due_at,new.revision,new.status,new.recorded_at,auth.uid(),'report',m.plan_id
 from public.patient_care_medications m where m.id=new.medication_id and m.user_id=new.user_id;
 if not found then raise exception 'dose source unavailable';end if;
 return new;
end $$;
