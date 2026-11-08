-- Zoe chat cards: the member's LDL goal in the chat, in the app and on Telegram (parity gap 3: the pilot's main outcome). The card
-- is a snapshot of member_ldl_read, so it says what the goal card on Progress says. Its body moves into an internal function; the
-- session entry point is unchanged. Dark with zoe_chat_actions_enabled and ldl_goal_settings.

alter table public.zoe_chat_cards drop constraint zoe_chat_cards_kind_check;
alter table public.zoe_chat_cards add constraint zoe_chat_cards_kind_check check(kind in('dose','bp','results','plan','visit','side_effect','message','menu','ldl'));

create function public._member_ldl_read(uid uuid)returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare g public.ldl_goals;r public.ldl_retests;x public.ldl_responses;base jsonb;
begin
 if not public._ldl_goal_enabled()then return jsonb_build_object('version','ldl-member-v1','enabled',false);end if;
 select * into g from public.ldl_goals where member_id=uid order by version desc limit 1;
 if g.id is null and not exists(select 1 from public.ldl_index_events where member_id=uid and removed_at is null)
  and not exists(select 1 from public.ldl_lipid_therapies where member_id=uid and end_reason is distinct from 'entered_in_error')
 then return jsonb_build_object('version','ldl-member-v1','enabled',true,'inPathway',false);end if;
 base:=jsonb_build_object('version','ldl-member-v1','enabled',true,'inPathway',true,
  'goal',case when g.id is null then null else public._ldl_goal_json(g,false)end,
  'observations',case when g.id is null then '[]'::jsonb else public._ldl_observations(uid,false)end);
 if not public._ldl_response_enabled()then return base;end if;
 select * into r from public.ldl_retests where member_id=uid and state in('scheduled','requested','fenced')order by created_at desc limit 1;
 select * into x from public.ldl_responses where member_id=uid and closed_at is null order by created_at desc limit 1;
 return base||jsonb_build_object('retest',case when r.id is null then null else public._ldl_retest_json(r,false)end,
  'withDoctor',case when x.id is null then null else jsonb_build_object('since',x.created_at,
   'doctorName',(select s.display_name from public.workspace_staff s where s.user_id=x.doctor_id))end);
end$$;

create or replace function public.member_ldl_read()returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare uid uuid:=auth.uid();
begin
 if uid is null or auth.role()is distinct from 'authenticated'then raise insufficient_privilege;end if;
 return public._member_ldl_read(uid);
end$$;

-- Service role only, for a member a channel adapter verified. Ineligible reads as off.
create function public.member_ldl_read_for(p_member uuid)returns jsonb
language plpgsql stable security definer set search_path=''as $$
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if p_member is null or not public._telegram_member_eligible(p_member)then return jsonb_build_object('version','ldl-member-v1','enabled',false);end if;
 return public._member_ldl_read(p_member);
end$$;

revoke all on function public._member_ldl_read(uuid)from public,anon,authenticated,service_role;
revoke all on function public.member_ldl_read_for(uuid)from public,anon,authenticated;
grant execute on function public.member_ldl_read_for(uuid)to service_role;
