-- Zoe chat cards: visits on Telegram. A member reads their next visit and accepts a time the clinic proposed, or the nurse visit
-- proposed for an LDL re-test, with one press. Both writes are the features' own (booking_portal_proposal_answer and
-- command_patient_test_request, already service-role with the member as an argument); only the reads are new. The portal read's
-- body moves into an internal function, and the session entry point is unchanged. Dark with zoe_chat_actions_enabled.

create function public._booking_portal_details(mm uuid)returns jsonb
language plpgsql stable security definer set search_path=''as $$begin
 return jsonb_build_object('memberId',mm,'enabled',public._clinic_scheduling_enabled(),
  'appointments',(select coalesce(jsonb_object_agg(a.id,jsonb_build_object(
   'channel',n.channel,'noticeState',n.state,
   'portalRevisions',(select coalesce(jsonb_agg(x.appointment_revision order by x.appointment_revision),'[]'::jsonb)from public.booking_scheduling_notices x where x.appointment_id=a.id and x.channel='portal'),
   'decline',(select jsonb_build_object('reason',d.reason,'at',d.created_at)from public.clinic_booking_decisions d where d.notice_id=n.id and d.kind='declined'),
   'proposal',(select jsonb_build_object('id',p.id,'startsAt',p.starts_at,'endsAt',p.ends_at,'note',p.note,'clinicId',p.clinic_id,'clinicName',c.name,'clinicAddress',c.address,'createdAt',p.created_at)
    from public.clinic_booking_proposals p join public.workspace_clinics c on c.id=p.clinic_id where p.appointment_id=a.id and p.state='open'),
   'checkin',(select jsonb_build_object('outcome',k.outcome,'at',k.recorded_at)from public.clinic_booking_checkins k where k.reservation_id=a.current_reservation_id order by k.id desc limit 1))),'{}'::jsonb)
  from public.booking_appointments a join public.booking_scheduling_notices n on n.id=a.notice_id where a.member_id=mm));
end$$;

create or replace function public.booking_portal_details(p_member uuid default null)returns jsonb
language plpgsql stable security definer set search_path=''as $$declare mm uuid:=coalesce(p_member,auth.uid());begin
 perform public._booking_assert_actor(mm,auth.uid());
 return public._booking_portal_details(mm);
end$$;

-- Service role only, for a member a channel adapter verified: the appointments as the workspace reads them, and each one's open proposal.
create function public.member_visits_read_for(p_member uuid)returns jsonb
language plpgsql stable security definer set search_path=''as $$
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if p_member is null or not public._telegram_member_eligible(p_member)then return null;end if;
 return jsonb_build_object('appointments',(select coalesce(jsonb_agg(public._booking_appointment_dto(a)order by a.created_at,a.id),'[]'::jsonb)from public.booking_appointments a where a.member_id=p_member),
  'portal',public._booking_portal_details(p_member));
end$$;

alter table public.zoe_chat_card_intents drop constraint zoe_chat_card_intents_action_check;
alter table public.zoe_chat_card_intents add constraint zoe_chat_card_intents_action_check check(action in('dose_taken','dose_skipped','bp_save','open_card','show_current','visit_accept','ldl_visit_accept'));

revoke all on function public._booking_portal_details(uuid)from public,anon,authenticated,service_role;
revoke all on function public.member_visits_read_for(uuid)from public,anon,authenticated;
grant execute on function public.member_visits_read_for(uuid)to service_role;
