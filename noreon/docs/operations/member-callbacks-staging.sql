-- Member callback requests (prototype D6): switch on for prod-as-staging.
-- Run in the Supabase SQL editor after the 20261017185155_member_preferences_callbacks migration.
-- Text size and contact preferences need no switch. The admin Telegram notice follows the
-- existing staff notice switch (staff_message_notice_settings.enabled); its wording
-- (callback_request.notice) is an unapproved placeholder and stays held until approved.
insert into public.member_callback_settings(singleton,enabled)values(true,true)
on conflict(singleton)do update set enabled=excluded.enabled,updated_at=clock_timestamp();
-- Off again:
-- update public.member_callback_settings set enabled=false,updated_at=clock_timestamp();
