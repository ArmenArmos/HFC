-- Same whole-word placeholder rule as lib/member-staff-name.mjs. Check the full
-- display name before taking the first name; staff records and screens stay intact.
create or replace function public._member_notice_nurse_name(m uuid)returns text
language sql stable security definer set search_path=''as $$
 select case when ws.display_name ~* '(^|[^[:alnum:]_])(staging|test)([^[:alnum:]_]|$)' then null
  else public._member_notice_text(split_part(btrim(ws.display_name),' ',1)) end
 from public.patient_clinical_cases c join public.workspace_staff ws on ws.user_id=c.assigned_nurse_id and ws.role='nurse'and ws.active and ws.removed_at is null
 where c.user_id=m
$$;
