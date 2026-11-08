-- QA F-01 (17 Oct 2026): an admin arranging a consultation needs a way to reach the member.
-- Admin only. Returns each member's sign-in phone and whether a Noreon Telegram chat is linked,
-- keyed by member id. Staff and clinic accounts are never returned, and ids that are not
-- members are simply absent. A separate function keeps admin_consultations_to_arrange's
-- released shape, so an app deployed before this migration keeps parsing it.
create function public.admin_member_contacts(p_members uuid[])returns jsonb
language plpgsql security definer set search_path=''as $$
begin
 perform public._real_staff_require_admin();
 if p_members is null or cardinality(p_members)>200 then raise invalid_parameter_value using message='Between 0 and 200 members';end if;
 return coalesce((select jsonb_object_agg(p.id,jsonb_build_object('phone',public._auth_phone(p.id),
   'telegramLinked',exists(select 1 from public.conversation_endpoints e where e.member_id=p.id and e.adapter='telegram'and e.active)))
  from public.profiles p
  where p.id=any(p_members)
   and not exists(select 1 from public.workspace_staff s where s.user_id=p.id)
   and not exists(select 1 from public.clinic_portal_memberships m where m.user_id=p.id)),'{}'::jsonb);
end$$;
revoke all on function public.admin_member_contacts(uuid[])from public,anon,authenticated,service_role;
grant execute on function public.admin_member_contacts(uuid[])to authenticated;
