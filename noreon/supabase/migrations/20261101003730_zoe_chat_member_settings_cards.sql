-- Secure-app cards reuse the existing member-owned card store, RLS, claims and audit.
-- Clinical intake keeps its existing assessment CAS and consent path, not a new table.
alter table public.zoe_chat_cards drop constraint zoe_chat_cards_kind_check;
alter table public.zoe_chat_cards add constraint zoe_chat_cards_kind_check
  check(kind in('dose','bp','results','plan','visit','side_effect','message','menu','ldl','ask','medicines','account'));

-- Chat edits times only. A concurrent dose-only edit on the classic page keeps the
-- same id, so a JavaScript snapshot check cannot protect it. Compare under the
-- existing medicine lock, then delegate scheduling to the original operation.
create function public.member_medicine_update_times(p_id uuid,p_times time[],p_expected_dose text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();m public.member_medicines;
begin
 if uid is null or auth.role() is distinct from 'authenticated' then raise insufficient_privilege;end if;
 if not(select enabled from public.member_medicine_settings where singleton) then return jsonb_build_object('status','disabled');end if;
 if exists(select 1 from public.workspace_staff where user_id=uid) or not exists(select 1 from public.profiles where id=uid) then raise insufficient_privilege;end if;
 perform pg_advisory_xact_lock(hashtextextended('member-medicines:'||uid::text,0));
 select * into m from public.member_medicines where id=p_id and user_id=uid and stopped_at is null for update;
 if not found then return jsonb_build_object('status','not-found');end if;
 if m.dose is distinct from nullif(btrim(p_expected_dose),'') then return jsonb_build_object('status','conflict');end if;
 return public.member_medicine_update(m.id,m.dose,p_times);
end $$;
revoke all on function public.member_medicine_update_times(uuid,time[],text) from public,anon,authenticated,service_role;
grant execute on function public.member_medicine_update_times(uuid,time[],text) to authenticated;
