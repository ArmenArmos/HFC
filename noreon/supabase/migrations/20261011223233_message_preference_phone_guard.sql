-- Fail early if the function owner cannot hold the auth-row locks used by consent.
do $$ begin
 if not has_table_privilege(current_user,'auth.users','SELECT') or not has_table_privilege(current_user,'auth.users','UPDATE') then
  raise exception 'Message consent requires function-owner auth row-lock privileges';
 end if;
end $$;
-- Expected phone is a stale-form guard, never a destination supplied by the caller.
create function public.save_patient_message_preferences_for_phone(p_channel text,p_expected_revision integer,p_consent_version text,p_expected_phone text) returns integer
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();current_phone text;
begin
 if uid is null then raise exception 'unauthorized';end if;
 select '+'||ltrim(phone,'+') into current_phone from auth.users where id=uid for update;
 if not found then raise exception 'unauthorized';end if;
 if p_channel<>'none' and (p_expected_phone is null or current_phone is distinct from p_expected_phone) then raise exception 'phone changed';end if;
 return public.save_patient_message_preferences(p_channel,p_expected_revision,p_consent_version);
end $$;
revoke all on function public.save_patient_message_preferences_for_phone(text,integer,text,text) from public,anon,authenticated,service_role;
grant execute on function public.save_patient_message_preferences_for_phone(text,integer,text,text) to authenticated;
