-- A clinical review alone does not release a result to its member.
-- Existing rows remain withheld until a trusted service links the publication.
alter table public.patient_care_results
  add column publication_plan_id uuid,
  add constraint patient_care_results_publication_plan_owner_fkey
    foreign key (publication_plan_id, user_id)
    references public.patient_care_plans (id, user_id);

create index patient_care_results_publication on public.patient_care_results(publication_plan_id, user_id);

drop policy own_care_results on public.patient_care_results;
create policy own_published_care_results on public.patient_care_results for select
using (
  (select auth.uid()) = user_id
  and reviewed_at is not null
  and reviewed_by is not null
  and exists (
    select 1 from public.patient_care_plans p
    where p.id = patient_care_results.publication_plan_id
      and p.user_id = patient_care_results.user_id
      and p.published_at <= now()
  )
);
-- Historical publications stay readable when their plan is no longer active.
-- Existing grants remain read-only for authenticated members.
