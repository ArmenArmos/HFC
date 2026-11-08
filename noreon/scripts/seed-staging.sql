-- Staging site seed: every feature switch on, like production-as-staging, for the separate
-- noreon-staging Supabase project (staging.noreon.health). NEVER run on production or on a
-- go-live database: it approves placeholder wording and turns on switches that lack sign-offs.
--
--   scripts/seed-environment.sql first (with sandbox_inert / 1 / sandbox-1 for the Telegram bot and policy),
--   then:  psql "$STAGING_DB_URL" -X -v ON_ERROR_STOP=1 -f scripts/seed-staging.sql
--
-- Real model calls and the reply switches are not here: the guard needs a passing model eval per
-- tier, run once from the staging backoffice (docs/operations/staging-site.md, "AI").
-- Idempotent.
begin;
do $$
declare t text;c text;n int;
begin
 -- table.column pairs that are plain singleton switches
 foreach t in array array[
  'admin_oversight_settings.admin_conversation_read_enabled','ai_plan_capabilities.enabled','bp_week_settings.enabled',
  'care_alert_settings.enabled','clinic_portal_capabilities.result_attach_enabled','clinic_portal_capabilities.storage_enabled',
  'clinic_portal_capabilities.clinic_admin_full_access','clinic_scheduling_capabilities.enabled','conversation_policy.app_chat_enabled',
  'conversation_policy.delivery_enabled','conversation_policy.zoe_chat_actions_enabled','doctor_completion_capabilities.enabled',
  'gp_report_capabilities.enabled','lab_ai_capabilities.member_upload_enabled','ldl_goal_settings.ldl_goal_enabled',
  'ldl_goal_settings.ldl_response_enabled','ldl_goal_settings.lipid_planner_enabled','member_callback_settings.enabled',
  'member_first_note_settings.enabled','member_medicine_settings.enabled','member_safety_settings.enabled',
  'multi_medicine_capabilities.enabled','nurse_chat_settings.enabled','nurse_visit_settings.enabled','programme_settings.enabled',
  'staff_message_notice_settings.enabled','staff_zoe_settings.staff_zoe_enabled','zoe_settings.structured_drafts_enabled']
 loop
  c:=split_part(t,'.',2);t:=split_part(t,'.',1);
  execute format('update public.%I set %I=true where singleton',t,c);
  get diagnostics n=row_count;
  if n=0 then execute format('insert into public.%I(singleton,%I)values(true,true)',t,c);end if;
 end loop;
end$$;
-- Placeholder wording for every template whose newest version is not approved yet. Staging only.
update public.system_message_templates m set approved=true,
 approval_note='Staging site wording, fictional site; never a clinical or legal sign-off.'
where not approved and version=(select max(x.version)from public.system_message_templates x where x.template_id=m.template_id and x.locale=m.locale);
commit;
