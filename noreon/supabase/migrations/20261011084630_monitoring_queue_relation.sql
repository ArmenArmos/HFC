-- Explicit case relationship supports bounded queue projections through PostgREST.
alter table public.workspace_followup_work add constraint workspace_followup_work_case_id_fkey foreign key(case_id) references public.workspace_cases(id) on delete cascade;
