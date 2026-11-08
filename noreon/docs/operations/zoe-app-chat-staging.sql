-- Zoe chat in the member app: switch on (prod-as-staging) and the rollback.
-- One switch, in the database: conversation_policy.app_chat_enabled (default false, dark).
-- Off: /patient/zoe shows the deterministic screen (quick actions, approved answers, urgent
-- screening, hand-off to Telegram). On: the member's one conversation with their care team,
-- shared with Telegram. Real model calls stay governed separately by zoe_settings.model_calls_allowed.
-- Needs NOREON_REAL_MEMBER_REVIEW_ENABLED=true on the app (already on where doctors reply).

-- Switch on.
update public.conversation_policy set app_chat_enabled=true where singleton;

-- Check.
select app_chat_enabled,intake_window_seconds,intake_max_messages from public.conversation_policy where singleton;

-- Rollback (members keep their messages; the screen falls back at once).
-- update public.conversation_policy set app_chat_enabled=false where singleton;
