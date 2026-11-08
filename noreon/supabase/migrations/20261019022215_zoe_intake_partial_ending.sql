-- Zoe redesign PR2 (lead decision 18 Oct 20:58): when Zoe's intake turn cannot be used twice in a row (the
-- neutral fallback line, lib/zoe/symptoms/intake.ts NEUTRAL_LINE), the intake ends as "partially answered"
-- for the doctor. Only the allowed endings change; zoe_run_finish takes the ending from the summary.
alter table public.zoe_symptom_intakes drop constraint zoe_symptom_intakes_ending_check;
alter table public.zoe_symptom_intakes add constraint zoe_symptom_intakes_ending_check
 check(ending in('complete','member_stopped','red_flag','expired','about_someone_else','turn_limit','partial'));
