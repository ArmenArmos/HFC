-- A member with no conversation yet ("No messages yet") made doctor_zoe_urgent_window fail: the record `w` was only
-- assigned inside `if c.id is not null`, and reading a field of an unassigned record raises. The doctor chat then showed
-- "Whether a 103 alert is open could not be loaded" for every such member (Gohar, QA 247, member Test Qa).
-- Same guards and result as before; _zoe_talking_urgent_window(null) matches no rows, so the record is always assigned
-- and the answer for a member without a conversation is "not open".
create or replace function public.doctor_zoe_urgent_window(p_member uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare me uuid:=public._zoe_mode_doctor(p_member);c public.conversations;w record;
begin
 select * into c from public.conversations where member_id=p_member;
 select * into w from public._zoe_talking_urgent_window(c.id);
 perform public._access_audit_record(p_member,'doctor_zoe_urgent_window','read');
 return jsonb_build_object('ok',true,'open',coalesce(w.started_at>=clock_timestamp()-interval '24 hours',false),
  'since',w.started_at,'openedBy',w.opened_by);
end$$;
