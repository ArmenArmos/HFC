-- Blood pressure flow in the new chat (dark: nothing calls these until NOREON_ZOE_APP_V3 is on).
--
-- A saved reading keeps the zone the rules gave it. Nothing here decides a zone: lib/clinical/zones does.
-- patient_measurements.source stays 'manual' (its check predates this), so where the value came from is a
-- separate column.
alter table public.patient_measurements
 add column zone text check(zone in('green','yellow','orange','red')),
 add column zone_rule_version text check(length(zone_rule_version)between 1 and 80),
 add column entry_source text check(entry_source='patient_text_entry');

alter table public.zoe_chat_cards drop constraint zoe_chat_cards_kind_check;
alter table public.zoe_chat_cards add constraint zoe_chat_cards_kind_check
 check(kind in('dose','bp','results','plan','visit','side_effect','message','menu','ldl','ask','medicines','account','repeat','red_flags'));

-- One reading and everything saved with it in the last p_minutes, oldest first: the episode the rules read.
-- The first id names the episode, so one episode raises one task per queue.
create function public.zoe_bp_episode(p_member uuid,p_submission uuid,p_minutes integer)returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare m public.patient_measurements;
begin
 if p_member is null or p_submission is null or p_minutes is null or p_minutes not between 1 and 60 then return jsonb_build_object('ok',false,'code','invalid');end if;
 select * into m from public.patient_measurements where user_id=p_member and submission_id=p_submission;
 if not found then return jsonb_build_object('ok',false,'code','not_found');end if;
 return jsonb_build_object('ok',true,'readingId',m.id,'readings',(select jsonb_agg(jsonb_build_object('id',r.id,'sbp',r.systolic,'dbp',r.diastolic)order by r.created_at,r.id)
  from(select * from public.patient_measurements where user_id=p_member and(id=m.id or(created_at>=m.created_at-make_interval(mins=>p_minutes)and created_at<=m.created_at))order by created_at desc,id desc limit 20)r));
end$$;

-- Stores what the rules said on the member's own reading. A later, higher answer in the same episode may replace it.
create function public.zoe_bp_reading_zone(p_member uuid,p_reading uuid,p_zone text,p_rule_version text)returns jsonb
language plpgsql security definer set search_path=''as $$
begin
 if p_member is null or p_reading is null or p_zone is null or p_zone not in('green','yellow','orange','red')or p_rule_version is null or length(p_rule_version)not between 1 and 80
 then return jsonb_build_object('ok',false,'code','invalid');end if;
 update public.patient_measurements set zone=p_zone,zone_rule_version=p_rule_version,entry_source='patient_text_entry'where id=p_reading and user_id=p_member;
 if not found then return jsonb_build_object('ok',false,'code','not_found');end if;
 return jsonb_build_object('ok',true);
end$$;

-- The working hours of the member's clinic: the assigned doctor's clinic. Empty when there is no doctor or no schedule.
create function public.zoe_member_clinic_hours(p_member uuid)returns jsonb
language sql stable security definer set search_path=''as $$
 select coalesce(jsonb_agg(jsonb_build_object('weekday',h.weekday,'opens',to_char(h.opens,'HH24:MI:SS'),'closes',to_char(h.closes,'HH24:MI:SS'))order by h.weekday),'[]'::jsonb)
 from public.patient_clinical_cases c
 join public.workspace_staff s on s.user_id=c.assigned_doctor_id and s.active and s.removed_at is null
 join public.clinic_schedule_hours h on h.clinic_id=s.clinic_id
 where c.user_id=p_member
$$;

revoke all on function public.zoe_bp_episode(uuid,uuid,integer),public.zoe_bp_reading_zone(uuid,uuid,text,text),public.zoe_member_clinic_hours(uuid)from public,anon,authenticated,service_role;
grant execute on function public.zoe_bp_episode(uuid,uuid,integer),public.zoe_bp_reading_zone(uuid,uuid,text,text),public.zoe_member_clinic_hours(uuid)to service_role;

-- Failed BP alerts live on the completed card. Success is appended, never rewrites the answer.
-- The live sweep probes only this small partial index, including while the V3 app switch is off.
create index zoe_bp_alert_retry on public.zoe_chat_cards(created_at,id)
 where kind='red_flags'and not outcome?'alert'
 and outcome @? '$.* ? (@.answer == true && @.alerted == false)';
create function public.care_alert_bp_flags_retry(p_limit integer)returns jsonb
language plpgsql security definer set search_path=''as $$
declare k public.zoe_chat_cards;a record;r jsonb;n integer:=0;f integer:=0;flag text;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if(public._care_alert_settings()).enabled is not true then return jsonb_build_object('ok',true,'raised',0,'failed',0);end if;
 for k in select * from public.zoe_chat_cards
  where kind='red_flags'and not outcome?'alert'and outcome @? '$.* ? (@.answer == true && @.alerted == false)'
  order by created_at,id limit greatest(1,least(coalesce(p_limit,20),50))for update skip locked loop
  select key,value into a from jsonb_each(k.outcome)where key like 'a:%'and value->>'answer'='true'limit 1;
  flag:=case a.key when 'a:chest_pain'then 'RF-01'when 'a:dyspnea'then 'RF-02'when 'a:faint'then 'RF-02'
   when 'a:neuro'then 'RF-04'when 'a:headache_dizziness'then 'RF-04'end;
  if flag is null then f:=f+1;continue;end if;
  begin
   r:=public.care_alert_screen(k.member_id,'zoe','bp-flag:'||k.id::text,'escalate','bp_red_flag_answered',array[flag],'zoe.bp_red_flags',coalesce(a.value->>'ruleVersion','zones-v1-2026-11-02'));
   if r->>'ok'='true'and r->>'alertId'is not null then
    update public.zoe_chat_cards set outcome=outcome||jsonb_build_object('alert',jsonb_build_object('alerted',true,'alertId',r->>'alertId','doneAt',clock_timestamp())),updated_at=clock_timestamp()where id=k.id;
    n:=n+1;
   else f:=f+1;end if;
  exception when others then f:=f+1;
  end;
 end loop;
 return jsonb_build_object('ok',true,'raised',n,'failed',f);
end$$;

-- Conversation delivery is separate from finishing the safety answers. The same request id replays the chat write.
create index zoe_bp_message_retry on public.zoe_chat_cards(member_id,created_at,id)
 where kind='red_flags'and not outcome?'delivery'and outcome @? '$.* ? (@.answer == true)';
create function public.zoe_bp_messages_pending(p_member uuid,p_limit integer)returns jsonb
language plpgsql stable security definer set search_path=''as $$
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 return coalesce((select jsonb_agg(public._zoe_chat_card_json(k)order by k.created_at,k.id)from(
  select * from public.zoe_chat_cards where member_id=p_member and kind='red_flags'and not outcome?'delivery'
   and outcome @? '$.* ? (@.answer == true)'
  order by created_at,id limit greatest(1,least(coalesce(p_limit,20),50)))k),'[]'::jsonb);
end$$;
create function public.zoe_bp_delivery_record(p_member uuid,p_card uuid,p_request uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare k public.zoe_chat_cards;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 select * into k from public.zoe_chat_cards where id=p_card and member_id=p_member and kind='red_flags'for update;
 if not found or not exists(select 1 from jsonb_each(k.outcome)a where a.key like 'a:%'and a.value->>'answer'='true'and a.value->>'requestId'=p_request::text)
 then return jsonb_build_object('ok',false,'code','invalid');end if;
 if not k.outcome?'delivery'then
  update public.zoe_chat_cards set outcome=outcome||jsonb_build_object('delivery',jsonb_build_object('requestId',p_request,'delivered',true,'doneAt',clock_timestamp())),updated_at=clock_timestamp()where id=k.id;
 end if;
 return jsonb_build_object('ok',true);
end$$;

-- Read active emergency outcomes independently of the newest 40 cards. Only explicit doctor/member clears close them;
-- ordinary messages, non-urgent replies and the episode/reading freshness windows cannot hide 103.
create index zoe_bp_emergencies on public.zoe_chat_cards(member_id,created_at,id)
 where kind='red_flags'and outcome @? '$.* ? (@.answer == true)';
create function public.zoe_bp_open_emergencies()returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare m uuid:=auth.uid();cleared timestamptz;
begin
 if auth.role()is distinct from 'authenticated'or m is null then raise insufficient_privilege;end if;
 if not public._zoe_chat_actions_on()then return jsonb_build_object('cards','[]'::jsonb,'clearedAt',null);end if;
 select greatest(
  coalesce((select max(k.cleared_at)from public.zoe_urgent_clears k where k.member_id=m and k.cleared_at<=clock_timestamp()),'-infinity'::timestamptz),
  coalesce((select max(a.created_at)from public.conversation_audit a join public.conversations c on c.id=a.conversation_id
   where c.member_id=m and a.kind='zoe.member_cleared_urgent'and a.created_at<=clock_timestamp()),'-infinity'::timestamptz))into cleared;
 return jsonb_build_object('clearedAt',case when cleared='-infinity'::timestamptz then null else cleared end,'cards',coalesce((select jsonb_agg(public._zoe_chat_card_json(k)order by k.created_at,k.id)
  from public.zoe_chat_cards k where k.member_id=m and k.kind='red_flags'and k.outcome @? '$.* ? (@.answer == true)'
   and exists(select 1 from jsonb_each(k.outcome)a where a.key like 'a:%'and a.value->>'answer'='true'
    and coalesce((a.value->>'doneAt')::timestamptz,k.created_at)>cleared)),'[]'::jsonb));
end$$;

revoke all on function public.care_alert_bp_flags_retry(integer),public.zoe_bp_messages_pending(uuid,integer),public.zoe_bp_delivery_record(uuid,uuid,uuid),public.zoe_bp_open_emergencies()from public,anon,authenticated,service_role;
grant execute on function public.care_alert_bp_flags_retry(integer),public.zoe_bp_messages_pending(uuid,integer),public.zoe_bp_delivery_record(uuid,uuid,uuid)to service_role;
grant execute on function public.zoe_bp_open_emergencies()to authenticated;
