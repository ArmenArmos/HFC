-- Member safety holds (decision tree v1.1 P342 chest-pain card, P371/P389 exercise pause after
-- fainting): switch on for prod-as-staging only. Run in the Supabase SQL editor after the
-- 20261017223944_member_safety_ui migration has been applied.
-- The wording is an unapproved placeholder (Armen/Tatevik). Keep this OFF for real members
-- until the copy and the clinical questions in output/member-safety-ui-2026-10-18/QUESTIONS.md
-- are signed off. Off = no row, or enabled=false.
insert into public.member_safety_settings(singleton,enabled)values(true,true)
on conflict(singleton)do update set enabled=excluded.enabled,updated_at=clock_timestamp();
-- Open holds for answers saved before the switch went on (dated from the saved answer; a
-- chest-pain card older than 30 days is skipped; never reopens a cleared hold). Returns the count.
select public.member_safety_backfill();
-- Check:
-- select kind,count(*) filter(where cleared_at is null) open,count(*) total from public.member_safety_holds group by kind;
-- Off again (holds stay recorded; members see nothing and staff decisions are refused):
-- update public.member_safety_settings set enabled=false,updated_at=clock_timestamp();
