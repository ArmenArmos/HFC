-- Clinic portal (dark, behind the clinic scheduling switches). Khikar, 18 Oct 2026:
--  1. When a member rejects a time the clinic proposed, the clinic's booking row says so
--     (rejectedProposal) until the clinic acts on the booking again: a new proposal, a
--     confirm or decline, or a check-in. Only this clinic's own proposals are read.
--  2. The clinic's member list works without typing: an empty query lists every member the
--     clinic can already find, 25 per page, newest activity with this clinic first. Typing
--     filters with no minimum length. Who can be found (_clinic_known_members) and the audit
--     row (kind 'member-search', no search text) are unchanged.

-- Same as 20261017115559 plus rejectedProposal.
create or replace function public._clinic_schedule_row(c uuid,a public.booking_appointments)returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare cur public.booking_scheduling_notices;last public.booking_scheduling_notices;v public.booking_appointment_versions;kind text;arr jsonb;prev jsonb:=null;status text;
 checkin text;ref uuid;channel text;proposal jsonb;active boolean;rej public.clinic_booking_proposals;rejected jsonb:=null;
begin
 select * into cur from public.booking_scheduling_notices where id=a.notice_id;
 if a.status='notification-pending'and cur.clinic_id=c and cur.state='pending'and cur.purpose<>'cancellation'then
  kind:='pending';arr:=a.proposed_arrangement;prev:=a.current_arrangement;ref:=cur.id;channel:=cur.channel;
  status:=case when a.current_arrangement is null then 'requested'else 'change-requested'end;
 elsif a.status='confirmed'and a.current_arrangement->>'clinicId'=c::text then
  kind:='current';arr:=a.current_arrangement;ref:=a.notice_id;
  select p.source into channel from public.booking_manual_reservations r join public.booking_manual_capacity p on p.key=r.capacity_key where r.id=a.current_reservation_id;
  channel:=case when channel='clinic-hours'then 'portal'else 'email'end;
  select outcome into checkin from public.clinic_booking_checkins where reservation_id=a.current_reservation_id order by id desc limit 1;
  status:=coalesce(checkin,'confirmed');
 else
  select * into last from public.booking_scheduling_notices where appointment_id=a.id and clinic_id=c order by appointment_revision desc limit 1;
  if not found then return null;end if;
  select * into v from public.booking_appointment_versions where notice_id=last.id;
  kind:='history';arr:=v.proposed_arrangement;ref:=last.id;channel:=last.channel;
  status:=case when last.purpose='cancellation'and last.state='accepted'then 'cancelled'when last.state='declined'then 'declined'else 'other'end;
 end if;
 active:=status in('requested','change-requested','confirmed','arrived','no-show');
 select jsonb_build_object('id',p.id,'startsAt',p.starts_at,'endsAt',p.ends_at,'note',p.note,'createdAt',p.created_at)into proposal
  from public.clinic_booking_proposals p where p.appointment_id=a.id and p.clinic_id=c and p.state='open';
 -- The clinic's latest proposal for this booking was rejected by the member, the booking has
 -- not changed since, and the clinic has not decided or checked in after the rejection.
 if kind in('pending','current')and status in('requested','change-requested','confirmed','no-show')then
  select * into rej from public.clinic_booking_proposals p where p.appointment_id=a.id and p.clinic_id=c order by p.created_at desc,p.id desc limit 1;
  if found and rej.state='rejected'and rej.appointment_revision=a.revision
   and not exists(select 1 from public.clinic_booking_decisions d where d.appointment_id=a.id and d.clinic_id=c and d.created_at>rej.decided_at)
   and not exists(select 1 from public.clinic_booking_checkins k where k.appointment_id=a.id and k.clinic_id=c and k.recorded_at>rej.decided_at)then
   rejected:=jsonb_build_object('id',rej.id,'startsAt',rej.starts_at,'endsAt',rej.ends_at,'rejectedAt',rej.decided_at);
  end if;
 end if;
 return jsonb_build_object('appointmentId',a.id,'memberId',a.member_id,'revision',a.revision,'reference',ref,'kind',kind,'status',status,'channel',channel,
  'memberName',coalesce((select nullif(btrim(display_name),'')from public.profiles where id=a.member_id),''),
  'memberPhone',case when active then(select case when phone is null or phone=''then null when phone like '+%'then phone else '+'||phone end from auth.users where id=a.member_id)else null end,
  'startsAt',arr->>'startsAt','endsAt',arr->>'endsAt','previousStartsAt',prev->>'startsAt','previousEndsAt',prev->>'endsAt',
  'tests',public._clinic_schedule_tests(a.program_id,arr),'proposal',proposal,'rejectedProposal',rejected,
  'decline',(select jsonb_build_object('reason',d.reason,'at',d.created_at)from public.clinic_booking_decisions d where d.notice_id=ref and d.kind='declined'));
end$$;

-- Member list and search. An empty query lists all members known to this clinic. A query
-- matches the name, or, when it looks like a phone number, the phone digits. 25 per page,
-- newest activity with this clinic first (latest booking notice or linked lab PDF).
drop function public.clinic_member_search(uuid,text);
create function public.clinic_member_search(p_clinic uuid,p_query text,p_page integer default 1)returns jsonb
language plpgsql security definer set search_path=''as $$
declare m public.clinic_portal_memberships;q text:=btrim(coalesce(p_query,''));digits text;by_phone boolean;pattern text;rows jsonb;total integer;size constant integer:=25;
begin
 perform set_config('lock_timeout','1500ms',true);
 m:=public._clinic_scheduling_member(p_clinic,false);
 if not public._clinic_scheduling_enabled()then return jsonb_build_object('version','clinic-member-search-v2','enabled',false,'members','[]'::jsonb);end if;
 if length(q)>100 or p_page is null or p_page not between 1 and 10000 then raise invalid_parameter_value;end if;
 digits:=regexp_replace(q,'[^0-9]','','g');
 by_phone:=length(digits)>0 and q~'^[0-9 +()-]+$';
 pattern:='%'||replace(replace(replace(lower(q),'\','\\'),'%','\%'),'_','\_')||'%';
 with found as(
  select k.member_id,coalesce(nullif(btrim(p.display_name),''),'')name,p.birth_date,
   greatest((select max(n.created_at)from public.booking_scheduling_notices n join public.booking_appointments a on a.id=n.appointment_id where n.clinic_id=p_clinic and a.member_id=k.member_id),
    (select max(x.created_at)from public.clinic_result_attachments x where x.clinic_id=p_clinic and x.user_id=k.member_id))last_at
  from public._clinic_known_members(p_clinic)k join public.profiles p on p.id=k.member_id left join auth.users u on u.id=k.member_id
  where q=''or lower(coalesce(p.display_name,''))like pattern or(by_phone and coalesce(u.phone,'')like '%'||digits||'%')),
 page as(select * from found order by last_at desc nulls last,member_id limit size offset(p_page-1)*size)
 select(select count(*)from found),
  coalesce((select jsonb_agg(jsonb_build_object('memberId',x.member_id,'name',x.name,'phone',public._clinic_member_phone(x.member_id),'birthDate',x.birth_date)order by x.last_at desc nulls last,x.member_id)from page x),'[]'::jsonb)
 into total,rows;
 perform public._clinic_schedule_audit(p_clinic,m.user_id,'member-search',jsonb_build_object('results',jsonb_array_length(rows),'byDigits',by_phone,'membershipId',m.id,'role',m.role));
 return jsonb_build_object('version','clinic-member-search-v2','enabled',true,'members',rows,'total',total,'page',p_page,'pageSize',size);
end$$;
revoke all on function public.clinic_member_search(uuid,text,integer)from public,anon,authenticated,service_role;
grant execute on function public.clinic_member_search(uuid,text,integer)to authenticated;
