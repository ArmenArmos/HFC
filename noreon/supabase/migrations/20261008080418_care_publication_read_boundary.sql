drop policy own_care_plans on public.patient_care_plans;
create policy own_published_care_plans on public.patient_care_plans for select
using((select auth.uid())=user_id and published_at<=now());
drop policy own_care_medications on public.patient_care_medications;
create policy own_published_care_medications on public.patient_care_medications for select
using((select auth.uid())=user_id and exists (
 select 1 from public.patient_care_plans p where p.id=plan_id and p.user_id=patient_care_medications.user_id and p.published_at<=now()
));
