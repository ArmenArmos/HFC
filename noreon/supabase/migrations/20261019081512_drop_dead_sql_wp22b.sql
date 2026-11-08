-- Dead SQL (quality review WP-22b, item 59): functions with no caller in the app, config, triggers,
-- policies, constraints or operator docs; only their own check assertions referenced them.
--  * zoe_trace_record: superseded; the Zoe pipeline writes its trace through _zoe_run_events.
--  * record_workspace_login_attempt, clear_workspace_login_attempts and their table: the retired
--    demo admission throttle (staff sign-in is Supabase Auth with its own limits).
--  * workspace_backfill_review_tasks: a one-off backfill that has run.
-- Kept on purpose: functions other checks use as fixtures for live paths, operator tools named in
-- docs/operations, and APIs granted to staff that a UI may still read (care_alert_audit_log).
drop function public.zoe_trace_record(uuid,text,text,text,text,text,jsonb);
drop function public.record_workspace_login_attempt(text);
drop function public.clear_workspace_login_attempts(text);
drop table public.workspace_login_attempts;
drop function public.workspace_backfill_review_tasks();
