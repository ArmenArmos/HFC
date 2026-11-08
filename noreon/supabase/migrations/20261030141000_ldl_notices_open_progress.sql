-- The three LDL notices (20261029211448) pass step 'open_progress', which the sign-in link check did not allow. For a member
-- with a linked chat the insert failed, _member_notice_safe swallowed it, and the notice was lost (parity finding 7).
alter table public.telegram_signin_links drop constraint telegram_signin_links_step_check;
alter table public.telegram_signin_links add constraint telegram_signin_links_step_check
 check(step in('next_profile','next_questionnaire','next_review','replies_off','open_care','open_results','open_home','open_messages','open_progress'));
