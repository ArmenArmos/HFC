-- The coordinator task for a medicine that ran out or costs too much is logistics: one more fixed word on the admin queue,
-- still no clinical content (the admin checks on zone, summary and red flags stay).
do $$declare c text;begin
 for c in select conname from pg_constraint where conrelid='public.care_queue_tasks'::regclass and contype='c'
  and pg_get_constraintdef(oid)like'%lab_booking_needed%' loop
  execute format('alter table public.care_queue_tasks drop constraint %I',c);
 end loop;
end$$;
alter table public.care_queue_tasks add constraint care_queue_tasks_admin_reason_check
 check(queue<>'admin'or reason_code in('lab_booking_needed','lab_reschedule','fasting_failed','lab_no_show','missing_baseline_labs','followup_labs_due','medicine_access_help'));

alter table public.zoe_chat_cards drop constraint zoe_chat_cards_kind_check;
alter table public.zoe_chat_cards add constraint zoe_chat_cards_kind_check
 check(kind in('dose','bp','results','plan','visit','side_effect','message','menu','ldl','ask','medicines','account','repeat','red_flags','profile','document','prep','fasting','symptom_gate','consult_questions','sams'));

-- A reason is a member event only. The admin receives a logistics code and an empty summary.
-- Moving a reminder changes the organizational offset only, never a prescribed time.
create function public.zoe_v3_dose_reason(p_member uuid,p_card uuid,p_op uuid,p_reason text,p_later boolean)returns jsonb
language plpgsql security definer set search_path=''as $$
declare k public.zoe_chat_cards;r jsonb;n jsonb;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if not public._zoe_chat_actions_on()then return jsonb_build_object('ok',false,'code','disabled');end if;
 if p_op is null or p_later is null or p_reason is null or p_reason not in('forgot','values_normal','side_effect_or_fear','ran_out_or_cost')or(p_later and p_reason<>'forgot')or not public._telegram_member_eligible(p_member)then return jsonb_build_object('ok',false,'code','invalid');end if;
 select * into k from public.zoe_chat_cards where id=p_card and member_id=p_member for update;
 if not found or k.kind<>'ask'or k.snapshot->>'v3'is distinct from 'true'then return jsonb_build_object('ok',false,'code','invalid');end if;
 if k.outcome?'answer'then
  if k.outcome#>>'{answer,reason}'is distinct from p_reason or (k.outcome#>>'{answer,later}')::boolean is distinct from p_later then return jsonb_build_object('ok',false,'code','stale');end if;
  select public._zoe_chat_card_json(x)into n from public.zoe_chat_cards x where x.member_id=p_member and x.request_id=md5('v3-sams:'||p_card::text)::uuid;
  return jsonb_build_object('ok',true,'card',public._zoe_chat_card_json(k),'next',n);
 end if;
 r:=public.zoe_chat_card_claim(p_member,p_card,'answer',p_op,jsonb_build_object('reason',p_reason,'later',p_later));
 if not coalesce((r->>'ok')::boolean,false)then return r;end if;
 if r#>'{claim,payload}'is distinct from jsonb_build_object('reason',p_reason,'later',p_later)then return jsonb_build_object('ok',false,'code','stale');end if;
 if p_later then
  insert into public.patient_reminder_preferences(user_id,revision,preferences)
  values(p_member,1,'{"medicationEnabled":true,"medicationOffsetMinutes":15,"bpEnabled":false,"bpTimes":["08:00","20:00"],"quietStart":"22:00","quietEnd":"07:00"}')
  on conflict(user_id)do update set preferences=public.patient_reminder_preferences.preferences||'{"medicationOffsetMinutes":15}'::jsonb,revision=public.patient_reminder_preferences.revision+1,updated_at=clock_timestamp();
 end if;
 if p_reason='side_effect_or_fear'then
  n:=public.zoe_chat_card_post(p_member,md5('v3-sams:'||p_card::text)::uuid,'sams','chip',null,jsonb_build_object('v',1,'episodeId',p_card));
  if not coalesce((n->>'ok')::boolean,false)then raise exception using errcode='40001',message='Safety questions unavailable';end if;
 elsif p_reason='ran_out_or_cost'then
  n:=public.care_queue_raise(p_member,'admin',null,'medicine_access_help','zoe-v3-plan-v1',null,null,'{}',null,'dose-access:'||p_card::text);
  if not coalesce((n->>'ok')::boolean,false)then raise exception using errcode='40001',message='Coordinator task unavailable';end if;
 end if;
 r:=public.zoe_chat_card_record(p_member,p_card,'answer',jsonb_build_object('reason',p_reason,'later',p_later),true);
 if not coalesce((r->>'ok')::boolean,false)then raise exception using errcode='40001',message='Reason receipt unavailable';end if;
 return r||case when p_reason='side_effect_or_fear'then jsonb_build_object('next',n->'card')else '{}'::jsonb end;
end$$;
revoke all on function public.zoe_v3_dose_reason(uuid,uuid,uuid,text,boolean)from public,anon,authenticated,service_role;
grant execute on function public.zoe_v3_dose_reason(uuid,uuid,uuid,text,boolean)to service_role;

-- SAMS has no RF registry code. Permit this exact typed rule through the existing care-alert path.
create or replace function public.care_alert_screen(p_member uuid,p_source text,p_source_ref text,p_outcome text,p_reason text,p_red_flags text[],p_rule text,p_rule_version text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare m uuid:=p_member;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if(public._care_alert_settings()).enabled is not true then return jsonb_build_object('ok',false,'code','alerts_off');end if;
 if p_source is null or p_source not in('message','lab','zoe')or coalesce(p_source_ref,'')!~'^[A-Za-z0-9_.:-]{1,128}$'
  or p_outcome is null or p_outcome not in('escalate','recorded','skipped')
  or coalesce(p_reason,'')!~'^[a-z0-9_.:-]{1,80}$'or coalesce(p_rule,'')!~'^[a-z0-9_.:-]{1,80}$'or coalesce(length(p_rule_version),0)not between 1 and 80
  or not(coalesce(p_red_flags,'{}')<@ array['RF-01','RF-02','RF-03','RF-04','RF-05','RF-06','RF-07','RF-08','RF-09','RF-10','RF-11','RF-12'])
  -- 20261031134000: an escalation needs a red flag, except a lab result and the message matcher's urgent words (which may have none).
  or(p_outcome='escalate'and cardinality(coalesce(p_red_flags,'{}'))=0 and p_source<>'lab'and not(p_source='message'and p_reason='urgent_words_matched')
   and not(p_source='zoe'and p_reason='sams_red'and p_rule='zoe.sams'and p_source_ref like 'sams:%'))
 then return jsonb_build_object('ok',false,'code','invalid');end if;
 if p_source='message'then
  begin
   select author_id into m from public.conversation_messages where id=p_source_ref::uuid;
  exception when invalid_text_representation then return jsonb_build_object('ok',false,'code','invalid');
  end;
  if m is null then return jsonb_build_object('ok',false,'code','unknown_message');end if;
 end if;
 if m is null or not exists(select 1 from auth.users where id=m)then return jsonb_build_object('ok',false,'code','unknown_member');end if;
 return public._care_alert_screen(m,p_source,p_source_ref,p_outcome,p_reason,p_red_flags,p_rule,p_rule_version);
end$$;
