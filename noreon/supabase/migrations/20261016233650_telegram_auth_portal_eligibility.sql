-- T-auth B-2b-1 (review I-1): the sign-in state says which portal the account may use, so a
-- staff-only account is not sent through the clinic Telegram step (and a clinic-only account
-- not through the staff one). `eligible` keeps its B-1 meaning (either portal). Grants unchanged.
create or replace function public.staff_signin_state()returns jsonb
language plpgsql security definer set search_path=''as $$
declare u uuid:=auth.uid();sid uuid;
begin
 if auth.role()is distinct from 'authenticated'or u is null then raise insufficient_privilege;end if;
 sid:=(auth.jwt()->>'session_id')::uuid;
 return jsonb_build_object('ok',true,'required',public._staff_signin_required(),'admitted',public._staff_session_admitted(u,sid)and public._staff_signin_required(),
  'enrolled',exists(select 1 from public.telegram_auth_bindings where auth_user_id=u and kind='staff'and active),'eligible',public._staff_signin_eligible(u),
  'staffEligible',exists(select 1 from public.workspace_staff s where s.user_id=u and s.active and s.removed_at is null
   and(s.role='admin'or exists(select 1 from public.workspace_clinics c where c.id=s.clinic_id and c.active))),
  'clinicEligible',exists(select 1 from public.clinic_portal_memberships m join public.workspace_clinics c on c.id=m.clinic_id and c.active where m.user_id=u and m.active));
exception when invalid_text_representation then raise insufficient_privilege;
end$$;
