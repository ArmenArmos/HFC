-- Zoe app V3 database switches. Run after scripts/seed-environment.sql, when the new chat and Zoe app V3 go on
-- (NOREON_MEMBER_CHAT_V2 and NOREON_ZOE_APP_V3, docs/operations/go-live-environment.md). Without these rows the
-- V3 cards answer "disabled" and the blood pressure flow cannot raise a care-team alert, so a reset that only ran the
-- main seed would silently turn the feature off again.
--
--   psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f scripts/seed-environment-v3.sql
--
-- The main seed leaves these three switches off on a first insert and a re-run of it never changes them (as with
-- the AI switches). Dark until clinical sign-off ([A1], output/GO_LIVE_GATES.md): run this file only when V3 is on.
-- Idempotent.

begin;
update public.conversation_policy set app_chat_enabled=true,zoe_chat_actions_enabled=true where singleton;
update public.care_alert_settings set enabled=true,updated_at=clock_timestamp()where singleton;
do $$begin
 if not coalesce((select app_chat_enabled and zoe_chat_actions_enabled from public.conversation_policy where singleton),false)then
  raise exception 'Go-live V3 seed: conversation_policy row missing; run seed-environment.sql first';end if;
 if not coalesce((select enabled from public.care_alert_settings where singleton),false)then
  raise exception 'Go-live V3 seed: care_alert_settings row missing; run seed-environment.sql first';end if;
end$$;
commit;
