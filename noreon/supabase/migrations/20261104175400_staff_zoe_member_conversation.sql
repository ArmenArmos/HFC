-- Restore the calling doctor's latest conversation without creating or auditing a row.
create function public.staff_zoe_member_conversation(p_member uuid)returns uuid
language plpgsql stable security definer set search_path=''as $$
declare s public.workspace_staff:=public._staff_zoe_staff();c uuid;
begin
 if s.role<>'doctor' or not public._staff_zoe_on() or p_member is null
  or not public.staff_care_access(p_member,s.user_id,true)then return null;end if;
 select id into c from public.staff_zoe_conversations
  where staff_id=s.user_id and member_id=p_member
  order by last_at desc,created_at desc,id desc limit 1;
 return c;
end$$;
revoke all on function public.staff_zoe_member_conversation(uuid) from public,anon,authenticated,service_role;
grant execute on function public.staff_zoe_member_conversation(uuid) to authenticated;
