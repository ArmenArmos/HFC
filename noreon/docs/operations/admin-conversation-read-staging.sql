-- Admin conversation reading: switch on (prod-as-staging) and the rollback.
-- One switch, in the database: admin_oversight_settings.admin_conversation_read_enabled (seeded false).
-- On: active Noreon admins see "Conversations" in the backoffice and a "Conversation (read-only)" link
-- on the member page; each open writes access_audit conversation.read.admin (Activity log).
-- Before real members it stays off until the privacy notice names admin reading and legal covers it
-- (output/GO_LIVE_GATES.md, P16/P21 family). The change itself is recorded in config_audit.

-- Switch on.
update public.admin_oversight_settings set admin_conversation_read_enabled=true,updated_at=clock_timestamp() where singleton;

-- Check.
select admin_conversation_read_enabled,updated_at from public.admin_oversight_settings where singleton;

-- Who has read what (latest 20).
-- select at,actor_id,member_id,surface from public.access_audit where surface like 'conversation.%.admin' order by at desc limit 20;

-- Rollback (the pages show "Admin reading is off" at once; the audit rows stay).
-- update public.admin_oversight_settings set admin_conversation_read_enabled=false,updated_at=clock_timestamp() where singleton;
