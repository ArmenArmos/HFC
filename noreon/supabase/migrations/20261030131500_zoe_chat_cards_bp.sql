-- Zoe chat cards: a blood pressure reading in Telegram (member-cards lane, after the dose). Telegram has no form, so the
-- member types the numbers. That message goes through Zoe like any other, and the sweep then offers a card that shows the
-- numbers back with one button; the press saves through the same rules as the app. Dark with zoe_chat_actions_enabled.
--
-- The rules stay the features': one body with the member as an argument, the session entry points unchanged, and service
-- entry points for a member a channel adapter verified (as 20261030102535 for the dose). Saved is not delivered: a saved
-- reading tells nobody, on either channel, and the card says so.

-- 1. The reading and the BP week for a verified actor --------------------------------------------------------------------

create function public._record_patient_measurement(uid uuid,p_submission_id uuid,p_systolic integer,p_diastolic integer,p_pulse integer,p_measured_at timestamptz)
returns uuid language plpgsql security definer set search_path='' as $$
declare saved public.patient_measurements;
begin
 if uid is null then raise exception 'verified membership required';end if;
 perform 1 from auth.users where id=uid and phone is not null and phone_confirmed_at is not null for share;
 if not found or not exists(select 1 from public.profiles where id=uid and length(trim(display_name))>0 and birth_date is not null and biological_sex in ('male','female'))
 or not exists(select 1 from public.patient_consents where user_id=uid and version='patient-pilot-v1')
 or not exists(select 1 from public.patient_assessments where user_id=uid) then raise exception 'verified membership required';end if;
 if p_submission_id is null or p_submission_id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
 or p_systolic is null or p_systolic not between 60 and 300
 or p_diastolic is null or p_diastolic not between 30 and 200 or p_diastolic>=p_systolic
 or (p_pulse is not null and p_pulse not between 20 and 250)
 or p_measured_at is null or not isfinite(p_measured_at) or p_measured_at>now()+interval '5 minutes' then raise exception 'invalid measurement';end if;
 insert into public.patient_measurements(user_id,submission_id,systolic,diastolic,pulse,measured_at)
 values(uid,p_submission_id,p_systolic,p_diastolic,p_pulse,p_measured_at)
 on conflict(user_id,submission_id) do nothing returning * into saved;
 if saved.id is null then
  select * into saved from public.patient_measurements where user_id=uid and submission_id=p_submission_id;
  if saved.id is null then raise exception 'measurement unavailable';end if;
  if saved.systolic<>p_systolic or saved.diastolic<>p_diastolic or saved.pulse is distinct from p_pulse or saved.measured_at<>p_measured_at then raise exception 'measurement conflict';end if;
 end if;
 return saved.id;
end $$;
create or replace function public.record_patient_measurement(p_submission_id uuid,p_systolic integer,p_diastolic integer,p_pulse integer,p_measured_at timestamptz)
returns uuid language plpgsql security definer set search_path='' as $$
begin
 return public._record_patient_measurement(auth.uid(),p_submission_id,p_systolic,p_diastolic,p_pulse,p_measured_at);
end $$;

create function public._bp_week_member_read(uid uuid)returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare s public.bp_week_settings;
begin
 select * into s from public.bp_week_settings where singleton;
 if not s.enabled then return jsonb_build_object('version','bp-week-v1','enabled',false);end if;
 return jsonb_build_object('version','bp-week-v1','enabled',true,'memberCanStart',s.member_can_start,'today',public._bp_week_today(),
  'currentDevice',(select jsonb_build_object('model',d.model,'serial',d.serial,'since',a.assigned_at)
   from public.bp_device_assignments a join public.bp_devices d on d.id=a.device_id where a.member_id=uid and a.ended_at is null),
  'weeks',coalesce((select jsonb_agg(public._bp_week_json(w)order by w.starts_on desc,w.created_at desc)
   from(select * from public.bp_weeks where member_id=uid order by starts_on desc,created_at desc limit 4)w),'[]'::jsonb));
end$$;
create or replace function public.bp_week_member_read()returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare uid uuid:=auth.uid();
begin
 if uid is null then raise insufficient_privilege;end if;
 return public._bp_week_member_read(uid);
end$$;

create function public._bp_week_record(uid uuid,p_week uuid,p_slot text,p_submission uuid,p_systolic integer,p_diastolic integer,p_pulse integer,p_measured_at timestamptz)returns jsonb
language plpgsql security definer set search_path=''as $$
declare w public.bp_weeks;d integer;mid uuid;existing public.bp_week_readings;prior uuid;
begin
 if not(select enabled from public.bp_week_settings where singleton)then return jsonb_build_object('status','disabled');end if;
 if p_slot is null or p_slot not in('morning','evening')or p_measured_at is null or not isfinite(p_measured_at)then return jsonb_build_object('status','invalid');end if;
 select * into w from public.bp_weeks where id=p_week and member_id=uid;
 if not found then raise insufficient_privilege;end if;
 perform pg_advisory_xact_lock(hashtextextended('bp-week:'||uid::text,0));
 select * into w from public.bp_weeks where id=p_week;
 -- A retry of a saved submission replays, whatever happened to the week since.
 select id into prior from public.patient_measurements where user_id=uid and submission_id=p_submission;
 if prior is not null then
  select * into existing from public.bp_week_readings where measurement_id=prior;
  if existing.week_id=w.id and existing.slot=p_slot then
   mid:=public._record_patient_measurement(uid,p_submission,p_systolic,p_diastolic,p_pulse,p_measured_at);
   return jsonb_build_object('status','replayed','measurementId',mid,'day',existing.day,'slot',existing.slot);
  end if;
  return jsonb_build_object('status','conflict');
 end if;
 if w.stopped_at is not null then return jsonb_build_object('status','not-open');end if;
 d:=((p_measured_at at time zone 'Asia/Yerevan')::date-w.starts_on)+1;
 if public._bp_week_today()not between w.starts_on and w.starts_on+w.days-1 then return jsonb_build_object('status','not-open');end if;
 if d not between 1 and w.days then return jsonb_build_object('status','outside-week');end if;
 if(p_measured_at at time zone 'Asia/Yerevan')::date<>public._bp_week_today()then return jsonb_build_object('status','not-today');end if;
 if(select count(*)from public.bp_week_readings where week_id=w.id and day=d and slot=p_slot)>=w.readings_per_slot then
  return jsonb_build_object('status','slot-full','day',d,'slot',p_slot);end if;
 mid:=public._record_patient_measurement(uid,p_submission,p_systolic,p_diastolic,p_pulse,p_measured_at);
 insert into public.bp_week_readings(measurement_id,week_id,member_id,day,slot)values(mid,w.id,uid,d,p_slot);
 return jsonb_build_object('status','saved','measurementId',mid,'day',d,'slot',p_slot);
exception
 when raise_exception then
  if sqlerrm in('invalid measurement','measurement conflict','verified membership required')then
   return jsonb_build_object('status',case sqlerrm when 'measurement conflict'then 'conflict'when 'invalid measurement'then 'invalid'else 'not-member'end);
  end if;
  raise;
end$$;
create or replace function public.bp_week_record(p_week uuid,p_slot text,p_submission uuid,p_systolic integer,p_diastolic integer,p_pulse integer,p_measured_at timestamptz)returns jsonb
language plpgsql security definer set search_path=''as $$
declare uid uuid:=auth.uid();
begin
 if uid is null or auth.role()is distinct from 'authenticated'then raise insufficient_privilege;end if;
 return public._bp_week_record(uid,p_week,p_slot,p_submission,p_systolic,p_diastolic,p_pulse,p_measured_at);
end$$;

-- Service role only, for a member a channel adapter verified. Ineligible (phone gone, banned, staff) reads as off.
create function public.member_bp_read_for(p_member uuid)returns jsonb
language plpgsql stable security definer set search_path=''as $$
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if p_member is null or not public._telegram_member_eligible(p_member)then return jsonb_build_object('week',jsonb_build_object('version','bp-week-v1','enabled',false),'latest',null);end if;
 return jsonb_build_object('week',public._bp_week_member_read(p_member),
  'latest',(select jsonb_build_object('systolic',m.systolic,'diastolic',m.diastolic,'pulse',m.pulse,'measuredAt',m.measured_at)
   from public.patient_measurements m where m.user_id=p_member order by m.measured_at desc,m.id desc limit 1));
end$$;
create function public.bp_week_record_for(p_member uuid,p_week uuid,p_slot text,p_submission uuid,p_systolic integer,p_diastolic integer,p_pulse integer,p_measured_at timestamptz)returns jsonb
language plpgsql security definer set search_path=''as $$
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if p_member is null or not public._telegram_member_eligible(p_member)then return jsonb_build_object('status','disabled');end if;
 begin
  return public._bp_week_record(p_member,p_week,p_slot,p_submission,p_systolic,p_diastolic,p_pulse,p_measured_at);
 exception when insufficient_privilege then return jsonb_build_object('status','not-found');
 end;
end$$;
-- A plain status instead of the session path's exceptions, because the channel has no error text to read.
create function public.member_measurement_record_for(p_member uuid,p_submission uuid,p_systolic integer,p_diastolic integer,p_pulse integer,p_measured_at timestamptz)returns jsonb
language plpgsql security definer set search_path=''as $$
declare mid uuid;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if p_member is null or not public._telegram_member_eligible(p_member)then return jsonb_build_object('status','disabled');end if;
 begin
  mid:=public._record_patient_measurement(p_member,p_submission,p_systolic,p_diastolic,p_pulse,p_measured_at);
 exception when raise_exception then
  if sqlerrm='measurement conflict'then return jsonb_build_object('status','conflict');end if;
  if sqlerrm='invalid measurement'then return jsonb_build_object('status','invalid');end if;
  if sqlerrm='verified membership required'then return jsonb_build_object('status','not-member');end if;
  raise;
 end;
 return jsonb_build_object('status','saved','measurementId',mid);
end$$;

-- 2. The button ----------------------------------------------------------------------------------------------------------

alter table public.zoe_chat_card_intents drop constraint zoe_chat_card_intents_action_check;
alter table public.zoe_chat_card_intents add constraint zoe_chat_card_intents_action_check check(action in('dose_taken','dose_skipped','bp_save','show_current'));

-- 3. A typed reading ------------------------------------------------------------------------------------------------------

-- A message that is only a reading (lib/zoe-chat-actions/typed-reading.ts decides that) usually gets a health answer, which
-- never opens a card (_zoe_chat_message_cleared). A card that only offers to save the member's own numbers may follow one,
-- when Zoe's answer passed its guards and nothing about it is urgent, same-day or sent on to a doctor automatically.
create function public._zoe_chat_reading_cleared(m uuid,p_seq bigint)returns boolean
language sql stable security definer set search_path=''as $$
 select public._zoe_chat_message_cleared(m,p_seq)or exists(
  select 1 from public.conversations c
  join public.conversation_messages cm on cm.conversation_id=c.id and cm.seq=p_seq
  join public.zoe_runs z on z.conversation_id=c.id and z.message_seq=p_seq
  where c.member_id=m and z.state='finished'
   and cm.seq=(select max(x.seq)from public.conversation_messages x where x.conversation_id=c.id)
   and cm.created_at>clock_timestamp()-interval '1 hour'
   and z.outcome='answered'and z.reason_code='health_answer_passed_guards'and not z.injection_detected
   and coalesce(z.forward,'none')in('none','asked'))
$$;

create or replace function public.zoe_chat_card_post(p_member uuid,p_request uuid,p_kind text,p_source text,p_source_seq bigint,p_snapshot jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare k public.zoe_chat_cards;
begin
 if p_member is null or p_request is null or p_kind is null or p_source is null or p_snapshot is null then return jsonb_build_object('ok',false,'code','invalid');end if;
 if not public._zoe_chat_actions_on()then return jsonb_build_object('ok',false,'code','disabled');end if;
 perform pg_advisory_xact_lock(hashtextextended('zoe-chat-card:'||p_member::text,0));
 select * into k from public.zoe_chat_cards where member_id=p_member and request_id=p_request;
 if found then
  if k.kind=p_kind and k.source=p_source and k.source_seq is not distinct from p_source_seq then return jsonb_build_object('ok',true,'replayed',true,'card',public._zoe_chat_card_json(k));end if;
  return jsonb_build_object('ok',false,'code','conflict');
 end if;
 -- Only the BP card that shows typed numbers back may follow a health answer; every other card needs the plain rule.
 if p_source='typed'and(p_source_seq is null or not(case when p_kind='bp'and p_snapshot?'typed'then public._zoe_chat_reading_cleared(p_member,p_source_seq)else public._zoe_chat_message_cleared(p_member,p_source_seq)end)
   or exists(select 1 from public.zoe_chat_cards x where x.member_id=p_member and x.source_seq=p_source_seq))then
  return jsonb_build_object('ok',false,'code','not_cleared');
 end if;
 if(select count(*)from public.zoe_chat_cards where member_id=p_member and created_at>clock_timestamp()-interval '1 hour')>=40 then
  return jsonb_build_object('ok',false,'code','rate_limited');
 end if;
 begin
  insert into public.zoe_chat_cards(member_id,request_id,kind,source,source_seq,snapshot)
  values(p_member,p_request,p_kind,p_source,case when p_source='typed'then p_source_seq end,p_snapshot)returning * into k;
 exception when check_violation then return jsonb_build_object('ok',false,'code','invalid');
 end;
 return jsonb_build_object('ok',true,'replayed',false,'card',public._zoe_chat_card_json(k));
end$$;

-- As 20261030102535, and a message that only the reading rule cleared comes back too: 'cleared' says which, so its words
-- open no other card. The sweep settles every message it looks at, so these use up nothing.
create or replace function public.zoe_chat_card_telegram_candidates(p_limit integer)returns jsonb
language plpgsql stable security definer set search_path=''as $$
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if not public._zoe_chat_actions_on()then return '[]'::jsonb;end if;
 return coalesce((select jsonb_agg(jsonb_build_object('memberId',q.member_id,'seq',q.seq,'requestId',q.request_id,'text',q.body,'locale',q.locale,'at',q.created_at,'cleared',q.cleared))from(
  select c.member_id,m.seq,m.request_id,m.body,m.created_at,public._telegram_auth_locale(c.member_id)locale,public._zoe_chat_message_cleared(c.member_id,m.seq)cleared
  from public.zoe_runs z join public.conversations c on c.id=z.conversation_id
  join public.conversation_messages m on m.conversation_id=z.conversation_id and m.seq=z.message_seq
  where z.state='finished'and z.started_at>clock_timestamp()-interval '30 minutes'and z.finished_at>clock_timestamp()-interval '15 minutes'
   and m.source='telegram_member'and public._zoe_chat_reading_cleared(c.member_id,m.seq)
   and not exists(select 1 from public.zoe_chat_card_scans x where x.member_id=c.member_id and x.seq=m.seq)
   and not exists(select 1 from public.zoe_chat_cards x join public.zoe_chat_card_sends y on y.card_id=x.id where x.member_id=c.member_id and x.source_seq=m.seq)
   and exists(select 1 from public.conversation_endpoints e where e.member_id=c.member_id and e.adapter='telegram'and e.active and e.expires_at>clock_timestamp())
  order by z.finished_at limit greatest(1,least(coalesce(p_limit,20),50)))q),'[]'::jsonb);
end$$;

revoke all on function public._record_patient_measurement(uuid,uuid,integer,integer,integer,timestamptz),public._bp_week_member_read(uuid),
 public._bp_week_record(uuid,uuid,text,uuid,integer,integer,integer,timestamptz),public._zoe_chat_reading_cleared(uuid,bigint)from public,anon,authenticated,service_role;
revoke all on function public.member_bp_read_for(uuid),public.bp_week_record_for(uuid,uuid,text,uuid,integer,integer,integer,timestamptz),
 public.member_measurement_record_for(uuid,uuid,integer,integer,integer,timestamptz)from public,anon,authenticated;
grant execute on function public.member_bp_read_for(uuid),public.bp_week_record_for(uuid,uuid,text,uuid,integer,integer,integer,timestamptz),
 public.member_measurement_record_for(uuid,uuid,integer,integer,integer,timestamptz)to service_role;
