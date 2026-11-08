-- Flagged conversations may continue inside the member's alarm window (Armen, 31 Oct).
-- Rationale stays staff-only. Member explanations use structured trigger facts in conversation_audit.
-- No new table, grant, RLS, alert, safety hold or doctor-mode change. Flag-off keys are unchanged.
-- The effective window ignores only answers explicitly marked as flagged alarm continuations.
-- Member clears remain separate, as in #450: a clear with its acknowledgement held is still visible to the doctor.
create function public._zoe_talking_urgent_window(p_conversation uuid)returns table(started_at timestamptz,opened_by text)
language sql stable security definer set search_path=''as $$
 with boundary as(select greatest(
  coalesce((select max(a.created_at)from public.zoe_member_answers a where a.conversation_id=p_conversation
   and a.kind<>'urgent'and a.created_at<=clock_timestamp()and not exists(
    select 1 from public.conversation_trace_events e where e.conversation_id=p_conversation
     and e.subject_kind='zoe_run'and e.subject_id=a.run_id::text and e.name='zoe.urgent.conversation'
     and e.reason_code='alarm_conversation_continues')),'-infinity'::timestamptz),
  coalesce((select max(k.cleared_at)from public.zoe_urgent_clears k where k.conversation_id=p_conversation
   and k.cleared_at<=clock_timestamp()),'-infinity'::timestamptz))at),
 run as(select a.created_at,z.reason_code from public.zoe_member_answers a join public.zoe_runs z on z.id=a.run_id,boundary b
  where a.conversation_id=p_conversation and a.kind='urgent'and a.created_at>b.at and a.created_at<=clock_timestamp()
   and not(z.reason_code='urgent_in_window_no_model_call'and z.started_at<=b.at))
 select min(run.created_at),case when count(*)=0 then null
  when bool_and(run.reason_code in('urgent_health_answer_model','urgent_in_window_no_model_call'))
   and bool_or(run.reason_code='urgent_health_answer_model')then 'model'else 'rule'end from run
$$;
revoke all on function public._zoe_talking_urgent_window(uuid)from public,anon,authenticated,service_role;

create function public.zoe_run_alarm_window(p_runs uuid[])returns jsonb
language plpgsql stable security definer set search_path=''as $$
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if p_runs is null or cardinality(p_runs)>50 then return '[]'::jsonb;end if;
 return coalesce((select jsonb_agg(jsonb_build_object('runId',r.id,
   'urgentSinceMinutes',case when w.started_at is not null then floor(extract(epoch from clock_timestamp()-w.started_at)/60)::integer end,
   'urgentOpenedBy',w.opened_by,
   'urgentThroughSeq',case when w.started_at is not null then(select max(a.message_seq)from public.zoe_member_answers a
     where a.conversation_id=r.conversation_id and a.kind='urgent'and a.created_at>=w.started_at and a.created_at<=clock_timestamp())end,
   'memberClear',jsonb_build_object('startedAt',mw.at,
    'sinceMinutes',case when mw.at is not null then floor(extract(epoch from clock_timestamp()-mw.at)/60)::integer end,
    'clearThroughSeq',mc.through_seq,'clearSinceMinutes',case when mc.at is not null then greatest(0,floor(extract(epoch from clock_timestamp()-mc.at)/60)::integer)end,'readingId',pm.id,'readingVersion',pm.reading_version,'readingSavedAt',pm.created_at,'readingMeasuredAt',pm.measured_at,
    'trigger',tr.detail->'trigger',
    'openedBy',mw.opened_by,'throughSeq',mw.through_seq,
    'suppressStoredReading',coalesce(pm.id::text=mc.detail->>'readingId'and pm.reading_version=mc.detail->>'readingVersion',false),
    'readingClearReason',case when mw.at is not null and pm.systolic<180 and pm.diastolic<120 then
      case when pm.created_at>mw.at and pm.measured_at>mw.at then 'new_reading'
       when exists(select 1 from public.conversation_audit ca join public.zoe_member_answers a on a.run_id::text=ca.detail->>'runId'
        where ca.conversation_id=r.conversation_id and ca.kind='zoe.urgent_reading'and a.kind='urgent'
         and a.created_at>=mw.at and ca.detail->>'readingId'=pm.id::text)
       then 'corrected_reading'end end)))
  from public.zoe_runs r cross join lateral public._zoe_urgent_window(r.conversation_id)w
  left join lateral(select ca.created_at at,ca.detail,(ca.detail->>'messageSeq')::bigint through_seq from public.conversation_audit ca
    where ca.conversation_id=r.conversation_id and ca.kind='zoe.member_cleared_urgent'order by ca.created_at desc,ca.id desc limit 1)mc on true
  cross join lateral public._zoe_talking_urgent_window(r.conversation_id)tw
  cross join lateral(select case when tw.started_at is null then null
    when mc.at is null or tw.started_at>mc.at then tw.started_at
    else(select min(a.created_at)from public.zoe_member_answers a join public.zoe_runs z on z.id=a.run_id
      where a.conversation_id=r.conversation_id and a.kind='urgent'and a.created_at>mc.at and a.created_at<=clock_timestamp()
       and not(z.reason_code='urgent_in_window_no_model_call'and z.started_at<=mc.at))end at)anchor
  cross join lateral(select anchor.at,
    (select case when count(*)=0 then null
      when bool_and(z.reason_code in('urgent_health_answer_model','urgent_in_window_no_model_call'))
       and bool_or(z.reason_code='urgent_health_answer_model')then 'model'else 'rule'end
     from public.zoe_member_answers a join public.zoe_runs z on z.id=a.run_id
     where a.conversation_id=r.conversation_id and a.kind='urgent'and a.created_at>=anchor.at
      and a.created_at<=clock_timestamp())opened_by,
    (select max(a.message_seq)from public.zoe_member_answers a where a.conversation_id=r.conversation_id
     and a.kind='urgent'and a.created_at>=anchor.at and a.created_at<=clock_timestamp())through_seq)mw
  left join lateral(select m.*,m.xmin::text reading_version from public.patient_measurements m where m.user_id=r.member_id and m.measured_at<=clock_timestamp()
    order by m.measured_at desc,m.created_at desc,m.id desc limit 1)pm on true
  left join lateral(select ca.detail from public.zoe_member_answers a join public.zoe_runs z on z.id=a.run_id
    left join public.conversation_audit ca on a.run_id::text=ca.detail->>'runId'
     and a.conversation_id=ca.conversation_id and ca.kind='zoe.alarm_trigger'
    where a.conversation_id=r.conversation_id and a.kind='urgent'and z.reason_code<>'urgent_in_window_no_model_call'
     and a.created_at>=mw.at and a.created_at<=clock_timestamp()
    order by a.created_at desc,ca.id desc limit 1)tr on true
  where r.id=any(p_runs)and r.state='started'),'[]'::jsonb);
end$$;


revoke all on function public.zoe_run_alarm_window(uuid[])from public,anon,authenticated,service_role;
grant execute on function public.zoe_run_alarm_window(uuid[])to service_role;

-- The existing clear validation now reads the same effective member window as the flagged worker.
create or replace function public.zoe_run_finish(p_run uuid,p_result jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare r public.zoe_runs;o text;rs text;safety boolean;same_day boolean;held jsonb;res jsonb;tp jsonb;t_start integer;t_owner text;mc jsonb;ctx jsonb;cv public.conversations;clear_at timestamptz;pm public.patient_measurements;alarm jsonb;trigger jsonb;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 select * into r from public.zoe_runs where id=p_run for update;
 if not found or r.state='finished'or jsonb_typeof(p_result)is distinct from 'object'then return public._zoe_run_finish_core(p_run,p_result);end if;
 select * into cv from public.conversations where id=r.conversation_id for update;
 o:=p_result->>'outcome';rs:=p_result->>'reason';
 safety:=o='intake_escalated'or(o='discarded'and rs in('urgent_route_no_model_call','urgent_in_window_no_model_call','urgent_health_answer_model','urgent_health_answer_red_flag_yes'));
 -- 20261023063508 (Codex A2-2): the fixed same-day line on an exit (lib/zoe/pipeline.ts sameDayExit): a receipt, recorded as same-day.
 same_day:=o='summary_only'and coalesce(rs,'')like 'same\_day\_floor\_%'and p_result#>>'{health,urgency}'='same_day'and jsonb_typeof(p_result->'receipt')='object';
 -- 20261023063508 (Codex A2-3): consent again at publication, under the conversation lock the withdrawal takes. A withdrawn (or no
 -- longer current) consent publishes nothing ordinary: no answer, receipt, chat, intake turn, summary or draft. The fixed 103 texts
 -- (urgent route, red flag) still go: the member wrote an emergency, and withholding the 103 advice is the greater harm (the
 -- coach withdrawal of 20261020103406 cancels coach texts, none of which is a safety text).
 if not safety and not public._zoe_consent_ok(r.member_id)then
  held:=(p_result-'receipt'-'answer'-'language'-'intake'-'chat'-'health'-'summary'-'draft'-'topic')||jsonb_build_object('outcome','discarded','reason','consent_withdrawn');
  res:=public._zoe_run_finish_core(p_run,held);
  select * into r from public.zoe_runs where id=p_run;
  perform public._zoe_run_events(r,jsonb_build_array(jsonb_build_object('name','zoe.guard.consent','outcome','block','reason','consent_withdrawn_member_text_held',
   'rule','zoe.consent','ruleVersion','zoe-a2-consent-1','actor','system','attributes',jsonb_build_object('noreon.zoe.guard.name','consent','noreon.zoe.consent.stage','finish',
   'noreon.zoe.consent.outcome',left(coalesce(o,'none'),40)))));
  return res;
 end if;
 -- Khikar 31 Oct: a worker requests a member clear only with NOREON_ZOE_MEMBER_CLEAR exactly true.
 -- Service-only, fresh state under the same conversation lock; no care-alert or safety-hold mutation.
 mc:=p_result->'memberClear';
 if rs='member_cleared_urgent_window'and o='summary_only'and jsonb_typeof(mc)='object'then
  select x->'memberClear'into ctx from jsonb_array_elements(public.zoe_run_alarm_window(array[r.id]))x;
  if cv.version<>r.context_version or cv.draft_epoch<>r.draft_epoch
   or p_result->>'memberClearEnabled'is distinct from 'true'
   or ctx->>'startedAt'is null or mc->>'startedAt'is distinct from ctx->>'startedAt'
   or mc->>'readingId'is distinct from ctx->>'readingId'
   or mc->>'readingVersion'is distinct from ctx->>'readingVersion'
   or (ctx->>'sinceMinutes')::integer>120
   or coalesce(mc->>'reason','')not in('feels_well','reading_disputed','member_request','new_reading','corrected_reading')
   or(mc->>'reason'in('new_reading','corrected_reading')and mc->>'reason'is distinct from ctx->>'readingClearReason')then
   return public._zoe_run_finish_core(p_run,(p_result-'memberClear'-'receipt'-'answer'-'summary')||jsonb_build_object('outcome','no_output','reason','member_clear_stale'));
  end if;
  -- Keep doctor takeover and publication controls. A held acknowledgement still records the clear for the doctor.
  held:=case when public._zoe_doctor_mode(r.conversation_id)then p_result-'receipt'else p_result end;
  res:=public._zoe_run_finish_core(p_run,held);
  if res->>'ok'='true'and(select state='finished'and outcome<>'stale'from public.zoe_runs where id=p_run)then
   clear_at:=clock_timestamp();
   insert into public.conversation_audit(conversation_id,actor_id,kind,detail,created_at)
   values(r.conversation_id,r.member_id,'zoe.member_cleared_urgent',jsonb_build_object('runId',r.id,'messageSeq',r.message_seq,
    'reason',mc->>'reason','windowStartedAt',mc->>'startedAt','readingId',mc->>'readingId','readingVersion',mc->>'readingVersion'),clear_at);
   perform public._zoe_run_events(r,jsonb_build_array(jsonb_build_object('name','zoe.urgent.member_cleared','outcome','recorded',
    'reason',mc->>'reason','rule','zoe.member_clear','ruleVersion','zoe-member-clear-1','actor','system',
    'attributes',jsonb_build_object('noreon.zoe.member_clear.member_id',r.member_id,'noreon.zoe.member_clear.at',clear_at,
     'noreon.zoe.member_clear.message_seq',r.message_seq,'noreon.zoe.member_clear.reading_id',coalesce(mc->>'readingId','none')))));
  end if;
  return res;
 end if;
 -- Remember only the ID of a crisis reading at a fresh alarm, so an in-place correction is distinguishable
 -- from a calm reading that already existed before the alarm. Never put readings in audit/log text.
 if safety and p_result->>'memberClearEnabled'='true'and rs<>'urgent_in_window_no_model_call'then
  select * into pm from public.patient_measurements where user_id=r.member_id and measured_at<=clock_timestamp()
   order by measured_at desc,created_at desc,id desc limit 1;
  if pm.systolic>=180 or pm.diastolic>=120 then
   insert into public.conversation_audit(conversation_id,kind,detail)values(r.conversation_id,'zoe.urgent_reading',jsonb_build_object('runId',r.id,'readingId',pm.id));
  end if;
  -- Only fixed structured facts cross the member boundary. Never copy the full result, model text or rationale.
  alarm:=p_result->'alarmTrigger';
  if jsonb_typeof(alarm)='object'and jsonb_typeof(alarm->'rules')='array'
   and jsonb_array_length(alarm->'rules')<=40 and coalesce(alarm->>'messageHash','')~'^[a-f0-9]{64}$'then
   trigger:=jsonb_build_object('kind',case when jsonb_typeof(alarm->'reading')='object'then 'saved_reading'
     when jsonb_array_length(alarm->'rules')>0 then 'symptom_words'else 'urgency_check'end,
    'rules',(select coalesce(jsonb_agg(code),'[]'::jsonb)from jsonb_array_elements_text(alarm->'rules')code where code~'^[A-Za-z][A-Za-z0-9_-]{0,79}$'),
    'messageHash',alarm->>'messageHash',
    'symptom',case when alarm->>'symptom'~'^[a-z][a-z0-9_]{0,39}$'then alarm->>'symptom'end,
    'reading',case when jsonb_typeof(alarm->'reading')='object'
      and jsonb_typeof(alarm#>'{reading,systolic}')='number'and jsonb_typeof(alarm#>'{reading,diastolic}')='number'
     then jsonb_build_object('systolic',alarm#>'{reading,systolic}','diastolic',alarm#>'{reading,diastolic}',
      'id',alarm#>'{reading,id}','version',left(alarm#>>'{reading,version}',32),
      'measuredAt',coalesce(nullif(alarm#>'{reading,measuredAt}','null'::jsonb),
       case when pm.id::text=alarm#>>'{reading,id}'then to_jsonb(pm.measured_at)end))end);
  end if;
 end if;
 -- 20261021070207: the topic, only when well formed (otherwise the run simply records none).
 tp:=case when jsonb_typeof(p_result->'topic')='object'then p_result->'topic'end;
 if tp is not null and tp->>'owner'in('zoe','doctor')and coalesce(tp->>'startSeq','')~'^[0-9]{1,9}$'and(tp->>'startSeq')::integer<=r.message_seq then
  t_start:=(tp->>'startSeq')::integer;t_owner:=tp->>'owner';end if;
 -- In doctor mode only the check's own verdict counts (doctorTopic "no", which a run that did not know about doctor mode never
 -- carries): a worker that could not read doctor mode is held as before.
 if not public._zoe_doctor_mode(r.conversation_id)or(t_owner='zoe'and tp->>'doctorTopic'='no'and public._zoe_takeover_scope()='topic')then
  res:=public._zoe_run_finish_core(p_run,p_result);
  if t_owner is not null then update public.zoe_runs set topic_start_seq=t_start,topic_owner=t_owner where id=p_run;end if;
  if t_owner='zoe'and public._zoe_doctor_mode(r.conversation_id)then
   select * into r from public.zoe_runs where id=p_run;
   perform public._zoe_run_events(r,jsonb_build_array(jsonb_build_object('name','zoe.guard.doctor_mode','outcome','allow','reason','doctor_mode_other_topic',
    'rule','zoe.doctor_mode','ruleVersion','zoe-doctor-mode-2','actor','system','attributes',jsonb_build_object('noreon.zoe.guard.name','doctor_mode','noreon.zoe.doctor_mode.scope','topic'))));
  end if;
  if trigger is not null and res->>'ok'='true'and exists(select 1 from public.zoe_member_answers a where a.run_id=r.id and a.kind='urgent')then
   insert into public.conversation_audit(conversation_id,kind,detail)
    values(r.conversation_id,'zoe.alarm_trigger',jsonb_build_object('runId',r.id,'trigger',trigger));
  end if;
  return res;
 end if;
 if safety then res:=public._zoe_run_finish_core(p_run,p_result-'receipt');
 -- 20261023063508 (Codex A2-2): the fixed same-day line reaches the member in doctor mode too (it is the app's text, not Zoe's).
 elsif same_day then res:=public._zoe_run_finish_core(p_run,p_result);
 else
  -- Doctor-facing outcomes (and a discard with no text) keep their reason, summary and draft; nothing goes to the member.
  if o in('draft_proposed','draft_blocked','summary_only','no_output')or(o='discarded'and jsonb_typeof(p_result->'answer')is distinct from 'string')then
   held:=p_result-'receipt'-'answer'-'language';
  else held:=(p_result-'receipt'-'answer'-'language'-'intake'-'chat'-'health'-'summary'-'draft')||jsonb_build_object('outcome','discarded','reason','doctor_mode_held');
  end if;
  res:=public._zoe_run_finish_core(p_run,held);
  if p_result is distinct from held then
   select * into r from public.zoe_runs where id=p_run;
   perform public._zoe_run_events(r,jsonb_build_array(jsonb_build_object('name','zoe.guard.doctor_mode','outcome','block','reason','doctor_mode_member_text_held',
    'rule','zoe.doctor_mode','ruleVersion','zoe-doctor-mode-2','actor','system','attributes',jsonb_build_object('noreon.zoe.guard.name','doctor_mode',
    'noreon.zoe.doctor_mode.outcome',left(coalesce(o,'none'),40)))));
  end if;
 end if;
 -- A run held for the doctor belongs to the doctor's matter, whatever the worker said.
 if t_owner is not null then update public.zoe_runs set topic_start_seq=t_start,topic_owner='doctor'where id=p_run;end if;
 if trigger is not null and res->>'ok'='true'and exists(select 1 from public.zoe_member_answers a where a.run_id=r.id and a.kind='urgent')then
  insert into public.conversation_audit(conversation_id,kind,detail)
   values(r.conversation_id,'zoe.alarm_trigger',jsonb_build_object('runId',r.id,'trigger',trigger));
 end if;
 return res;
end$$;

-- Keep the existing assigned-doctor clear available after a flagged ordinary answer.
create or replace function public.doctor_zoe_urgent_window(p_member uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare me uuid:=public._zoe_mode_doctor(p_member);c public.conversations;w record;
begin
 select * into c from public.conversations where member_id=p_member;
 if c.id is not null then select * into w from public._zoe_talking_urgent_window(c.id);end if;
 perform public._access_audit_record(p_member,'doctor_zoe_urgent_window','read');
 return jsonb_build_object('ok',true,'open',coalesce(w.started_at>=clock_timestamp()-interval '120 minutes',false),
  'since',w.started_at,'openedBy',w.opened_by);
end$$;

-- The clear. Under the conversation row lock (zoe_run_finish takes it too), so a clear and an urgent text never interleave.
-- Idempotent: nothing open, nothing written.
create or replace function public.doctor_zoe_clear_urgent(p_member uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare me uuid:=public._zoe_mode_doctor(p_member);c public.conversations;w record;kid uuid;
begin
 select * into c from public.conversations where member_id=p_member for update;
 if not found then return jsonb_build_object('ok',true,'replayed',true);end if;
 select * into w from public._zoe_talking_urgent_window(c.id);
 if w.started_at is null or w.started_at<clock_timestamp()-interval '120 minutes'then return jsonb_build_object('ok',true,'replayed',true);end if;
 insert into public.zoe_urgent_clears(conversation_id,member_id,cleared_by,opened_by,window_started_at)
 values(c.id,p_member,me,w.opened_by,w.started_at)returning id into kid;
 insert into public.conversation_audit(conversation_id,actor_id,kind,detail)
 values(c.id,me,'zoe.urgent_cleared',jsonb_build_object('clearId',kid,'openedBy',w.opened_by,'windowStartedAt',w.started_at,'version',c.version));
 perform public._access_audit_record(p_member,'doctor_zoe_urgent_window','clear');
 return jsonb_build_object('ok',true,'replayed',false,'openedBy',w.opened_by);
end$$;
