-- Integrator: stamp this placeholder AFTER main's newest migration before replay/merge.
-- Reuse zoe_chat_cards and its existing member SELECT RLS. No new table or member write grant.
-- Only visit snapshots may refresh; origin, recorded outcomes and claims remain immutable.
create or replace function public._zoe_chat_card_immutable()returns trigger
language plpgsql set search_path=''as $$
begin
 if new.id<>old.id or new.member_id<>old.member_id or new.request_id<>old.request_id or new.kind<>old.kind or new.source<>old.source
  or new.source_seq is distinct from old.source_seq or new.created_at<>old.created_at
  or not(new.outcome@>old.outcome)or not(new.claims@>old.claims)or(old.state='done'and new.state<>'done')
  or(new.snapshot<>old.snapshot and not(old.kind='visit'and jsonb_typeof(new.snapshot->'living')='object'
    and(new.snapshot#>>'{living,revision}')::bigint=coalesce((old.snapshot#>>'{living,revision}')::bigint,0)+1
    and(old.snapshot->'living'is null or old.snapshot#>>'{living,visitId}'=new.snapshot#>>'{living,visitId}')))then
  raise exception 'zoe_chat_cards rows are immutable' using errcode='23514';
 end if;
 return new;
end$$;

create unique index zoe_chat_cards_living_visit on public.zoe_chat_cards(member_id,(snapshot#>>'{living,visitId}'))
 where kind='visit'and snapshot?'living';

-- Server-only: no caller-supplied snapshot, status, dates, or publication id.
-- The same member lock as posting and continuation makes concurrent polls/menu taps replay.
create function public.zoe_living_visit_sync(p_member uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare a public.booking_appointments;h public.patient_test_requests;k public.zoe_chat_cards;q public.zoe_chat_cards;
 sid uuid;src text;created timestamptz;arr jsonb;starts timestamptz;phase text:='awaiting';counts jsonb;
 collected timestamptz;plan uuid;prep text;loc text;living jsonb;snap jsonb;proposal jsonb;item text;stamp timestamptz:=clock_timestamp();available boolean:=true;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if not public._zoe_chat_actions_on()or not public._telegram_member_eligible(p_member)or not public._zoe_consent_ok(p_member)then
  return jsonb_build_object('ok',false,'code','disabled');end if;
 perform pg_advisory_xact_lock(hashtextextended('zoe-chat-card:'||p_member::text,0));
 -- Do not fall back to an older confirmed visit when the newest booking was cancelled or failed.
 select * into a from public.booking_appointments where member_id=p_member order by created_at desc,id desc limit 1;
 select * into h from public.patient_test_requests where user_id=p_member
  and coalesce(current_arrangement#>>'{terms,mode}',requested_terms->>'mode')='home'order by created_at desc,id desc limit 1;
 -- A chat request is the real, recorded request, not merely a claimed or opened form.
 select * into q from public.zoe_chat_cards where member_id=p_member and kind='visit'
  and outcome#>>'{booking,kind}'='visit_request'
  and coalesce((outcome#>>'{booking,doneAt}')::timestamptz,created_at)>
   coalesce((select max(published_at)from public.patient_clinical_publications where user_id=p_member),'-infinity')
  order by coalesce((outcome#>>'{booking,doneAt}')::timestamptz,created_at)desc,id desc limit 1;
 -- No appointment/request FK exists for chat logistics. Keep an unlinked request at its
 -- last known status rather than guessing that a later appointment fulfils it.
 if q.id is not null and(q.snapshot->'living'is null or q.snapshot#>>'{living,source}'='request')then
  sid:=q.id;src:='request';created:=coalesce((q.outcome#>>'{booking,doneAt}')::timestamptz,q.created_at);
 elsif h.id is not null and h.created_at>coalesce(a.created_at,'-infinity')then
  sid:=h.id;src:='home-request';created:=h.created_at;arr:=h.current_arrangement->'terms';
  if h.status in('confirmed','completed')then phase:='confirmed';end if;
  available:=h.status in('requested','provider-proposed','confirmed','completed','change-pending');
 elsif a.id is not null then
  sid:=a.id;src:='appointment';created:=a.created_at;arr:=a.current_arrangement;
  available:=a.status in('notification-pending','confirmed')and(select purpose from public.booking_scheduling_notices where id=a.notice_id)is distinct from 'cancellation';
  if available then
   select jsonb_build_object('appointmentId',a.id,'proposalId',p.id,'startsAt',p.starts_at,'endsAt',p.ends_at,
    'clinicName',left(c.name,300),'clinicAddress',left(c.address,1000))into proposal
    from public.clinic_booking_proposals p join public.workspace_clinics c on c.id=p.clinic_id
    where p.appointment_id=a.id and p.state='open';
  end if;
  if proposal is null and a.status='confirmed'and a.current_arrangement is not null and a.current_reservation_id is not null
   and(select purpose from public.booking_scheduling_notices where id=a.notice_id)is distinct from 'cancellation'then phase:='confirmed';end if;
 else return jsonb_build_object('ok',true,'card',null);end if;
 select * into k from public.zoe_chat_cards where member_id=p_member and kind='visit'
  and snapshot#>>'{living,visitId}'=sid::text for update;
 if k.id is null and src='request'then k:=q;end if;
 if not available and k.id is not null then
  phase:=k.snapshot#>>'{living,status}';
  starts:=(k.snapshot#>>'{living,startsAt}')::timestamptz;plan:=(k.snapshot#>>'{living,planId}')::uuid;
 end if;
 if available and phase='confirmed'then
  starts:=(arr->>'startsAt')::timestamptz;loc:=left(arr->>'location',1000);
  -- Attendance includes clinic completion and preserves the clinic's no-show correction semantics.
  if public._nurse_visit_has_step(src,sid,'started')or(src='appointment'and
    public._booking_visit_attended(a.current_reservation_id))then phase:='arrived';end if;
  counts:=public._nurse_visit_counts(public._nurse_visit_items_marked(src,sid,false));
  -- A partial or subsequently corrected collection does not claim all samples were collected.
  if coalesce((counts->>'samplesPlanned')::int,0)>0 and counts->>'samplesTaken'=counts->>'samplesPlanned'then
   select max(occurred_at)into collected from public.nurse_visit_events where member_id=p_member and source=src and source_id=sid
    and arrangement=starts and step='samples-collected';
  end if;
  -- The existing lab-entry path can record collection without nurse-chat marks.
  -- Require every ordered lab test for this exact booked arrangement, and honour corrections.
  if collected is null and src='appointment'and exists(select 1 from jsonb_array_elements(public._nurse_visit_tests(src,sid))t where t->>'method'='lab')then
   select max(e.observed_instant)into collected from public.patient_care_visits cv
    join public.booking_appointment_versions av on av.appointment_id=sid and av.revision=cv.accepted_revision and av.proposed_arrangement=a.current_arrangement
    join public.patient_care_visit_entries e on e.visit_id=cv.id and e.user_id=p_member and public._patient_lab_current_collection(e)
    where cv.user_id=p_member and cv.appointment_id=sid and e.observed_instant<=stamp
     and not exists(select 1 from jsonb_array_elements(public._nurse_visit_tests(src,sid))t where t->>'method'='lab'
      and not exists(select 1 from public.patient_care_visit_entries x where x.visit_id=cv.id and x.user_id=p_member
       and x.payload->>'testId'=t->>'id'and x.observed_instant<=stamp and public._patient_lab_current_collection(x)));
  end if;
  if collected is not null and phase='arrived'then phase:='samples_collected';end if;
  -- Same current-round publication boundary as Home, strengthened by recorded collection.
  -- A draft, a future publication, an old plan or a plan before this visit cannot advance it.
  if phase='samples_collected'then
   select p.id into plan from public.patient_care_plans p join public.patient_clinical_publications c on c.plan_id=p.id and c.user_id=p.user_id
    where p.user_id=p_member and p.active and p.published_at<=stamp and c.published_at<=stamp
     and c.published_at>=greatest(created,starts,collected)
     and exists(select 1 from jsonb_array_elements(coalesce(c.evidence->'visits','[]'::jsonb))v
      join public.patient_care_visits cv on cv.id=(v->>'id')::uuid and cv.user_id=p_member
      where(src='appointment'and cv.appointment_id=sid and cv.booking_context->>'appointmentId'=sid::text)
       or(src='home-request'and exists(select 1 from public.nurse_visit_completions n where n.member_id=p_member and n.source=src and n.source_id=sid and n.visit_id=cv.id)))
     order by c.published_at desc,c.id desc limit 1;
   if plan is not null then phase:='plan_published';end if;
  end if;
  if src='appointment'then
   select coalesce(nullif(arr->>'preparation',''),s.preparation)into prep from public.clinic_schedules s
    where s.clinic_id=(arr->>'clinicId')::uuid;
   prep:=coalesce(prep,nullif(arr->>'preparation',''));
  else prep:=nullif(arr->>'preparation','');end if;
 end if;
 living:=jsonb_build_object('visitId',sid,'source',src,'revision',coalesce((k.snapshot#>>'{living,revision}')::bigint,0)+1,
  'status',phase,'startsAt',starts,'location',loc,'preparation',left(prep,4000),'planId',plan);
 snap:=jsonb_build_object('v',1,'available',available,'next',null,'proposal',proposal,'attention',not available,'living',living);
 item:='visit:'||sid::text||':'||phase;
 if k.id is null then
  insert into public.zoe_chat_cards(member_id,request_id,kind,source,snapshot,outcome)
   values(p_member,gen_random_uuid(),'visit','chip',snap,case when available then jsonb_build_object(item,jsonb_build_object('status',phase,'doneAt',stamp))else '{}'::jsonb end)returning * into k;
 elsif((k.snapshot->'living')-'revision')is distinct from(living-'revision')or k.snapshot->'available'is distinct from snap->'available'
  or k.snapshot->'proposal'is distinct from snap->'proposal'then
  update public.zoe_chat_cards set snapshot=snap,outcome=case when outcome?item then outcome else outcome||jsonb_build_object(item,jsonb_build_object('status',phase,'doneAt',stamp))end,
   updated_at=stamp where id=k.id returning * into k;
 end if;
 return jsonb_build_object('ok',true,'card',public._zoe_chat_card_json(k));
end$$;
revoke all on function public.zoe_living_visit_sync(uuid)from public,anon,authenticated,service_role;
grant execute on function public.zoe_living_visit_sync(uuid)to service_role;

-- Opt in from the new adapter. Keep the original five-argument RPC unchanged for
-- the old-app/new-schema interval: its strict visit schema cannot read living snapshots.
-- Booking CTAs resolve the same current card as the menu; receipts retain its real request id.
create function public.zoe_v3_next_step_follow_living(p_member uuid,p_card uuid,p_request uuid,p_target text,p_snapshot jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare k public.zoe_chat_cards; parent public.zoe_chat_cards; r jsonb; recorded jsonb; item text;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if not public._zoe_chat_actions_on()then return jsonb_build_object('ok',false,'code','disabled');end if;
 if p_member is null or p_card is null or p_request is null or not public._telegram_member_eligible(p_member) or not public._zoe_consent_ok(p_member)
  or p_target is null or p_snapshot is null or p_target not in('tests_needed','visit','results','plan','message','review')then return jsonb_build_object('ok',false,'code','invalid');end if;
 perform pg_advisory_xact_lock(hashtextextended('zoe-chat-card:'||p_member::text,0));
 select * into k from public.zoe_chat_cards where id=p_card and member_id=p_member for update;
 if not found or k.kind not in('next_step','tests_needed')then return jsonb_build_object('ok',false,'code','invalid');end if;
 item:=k.kind;
 if k.outcome?item then
  select public._zoe_chat_card_json(x) into r from public.zoe_chat_cards x where x.member_id=p_member and x.request_id=(k.outcome#>>array[item,'requestId'])::uuid;
  if r is null then return jsonb_build_object('ok',false,'code','unavailable');end if;
  return jsonb_build_object('ok',true,'card',public._zoe_chat_card_json(k),'next',r);
 end if;
 if k.state='done'then return jsonb_build_object('ok',false,'code','closed');end if;
 -- A stage can change while the adapter reads the target snapshot. Recheck the saved
 -- parent under the same lock as sync, before claiming an unfinished tests action.
 if k.kind='tests_needed'then
  select * into parent from public.zoe_chat_cards where member_id=p_member and kind='next_step' order by created_at desc,id desc limit 1;
  if not found or parent.outcome#>>'{next_step,requestId}' is distinct from k.request_id::text then
   return jsonb_build_object('ok',false,'code','stale');
  end if;
 end if;
 if(k.kind='next_step'and k.snapshot->>'target' is distinct from p_target
    and(k.snapshot->>'target' is distinct from 'tests_needed'or p_target<>'visit'))
  or(k.kind='tests_needed'and p_target<>'visit')then return jsonb_build_object('ok',false,'code','invalid');end if;
 r:=public.zoe_chat_card_claim(p_member,p_card,item,p_request,jsonb_build_object('target',p_target));
 if not coalesce((r->>'ok')::boolean,false)then return r;end if;
 if p_target='visit'then r:=public.zoe_living_visit_sync(p_member);else r:=null;end if;
 if r->'card'is null or r->'card'='null'::jsonb then
  r:=public.zoe_chat_card_post(p_member,p_request,p_target,'chip',null,p_snapshot);
 end if;
 if not coalesce((r->>'ok')::boolean,false)then raise exception using errcode='40001',message='Next step card unavailable';end if;
 recorded:=public.zoe_chat_card_record(p_member,p_card,item,jsonb_build_object('target',p_target,'requestId',r#>>'{card,requestId}'),true);
 if not coalesce((recorded->>'ok')::boolean,false)then raise exception using errcode='40001',message='Next step receipt unavailable';end if;
 return jsonb_build_object('ok',true,'card',recorded->'card','next',r->'card');
end$$;
revoke all on function public.zoe_v3_next_step_follow_living(uuid,uuid,uuid,text,jsonb)from public,anon,authenticated,service_role;
grant execute on function public.zoe_v3_next_step_follow_living(uuid,uuid,uuid,text,jsonb)to service_role;
