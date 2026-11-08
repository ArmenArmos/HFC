-- Member-facing 103 clear (Khikar, 31 Oct). Dark unless the worker flag is exactly true.
-- Existing tables, RLS and public signatures stay unchanged. No alert/booking/publication hold is resolved.

-- Additive context to the latest definition (20261022071955). Legacy keys are unchanged.
-- The effective member window is separate. Existing care alerts and safety/publication guards are untouched.
create or replace function public.zoe_run_urgent_window(p_runs uuid[])returns jsonb
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
    'clearThroughSeq',mc.through_seq,'clearSinceMinutes',case when mc.at is not null then greatest(0,floor(extract(epoch from clock_timestamp()-mc.at)/60)::integer)end,'readingId',pm.id,'readingVersion',pm.reading_version,'readingSavedAt',pm.created_at,
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
  cross join lateral(select case when w.started_at is null then null
    when mc.at is null or w.started_at>mc.at then w.started_at
    else(select min(a.created_at)from public.zoe_member_answers a join public.zoe_runs z on z.id=a.run_id
      where a.conversation_id=r.conversation_id and a.kind='urgent'and a.created_at>mc.at and a.created_at<=clock_timestamp()
       and not(z.reason_code='urgent_in_window_no_model_call'and z.started_at<=mc.at))end at)mw
  left join lateral(select m.*,m.xmin::text reading_version from public.patient_measurements m where m.user_id=r.member_id and m.measured_at<=clock_timestamp()
    order by m.measured_at desc,m.created_at desc,m.id desc limit 1)pm on true
  where r.id=any(p_runs)and r.state='started'),'[]'::jsonb);
end$$;

-- Latest finish definition: 20261023063508, with member-clear validation/audit added after consent.
create or replace function public.zoe_run_finish(p_run uuid,p_result jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare r public.zoe_runs;o text;rs text;safety boolean;same_day boolean;held jsonb;res jsonb;tp jsonb;t_start integer;t_owner text;mc jsonb;ctx jsonb;cv public.conversations;clear_at timestamptz;pm public.patient_measurements;
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
  select x->'memberClear'into ctx from jsonb_array_elements(public.zoe_run_urgent_window(array[r.id]))x;
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
 return res;
end$$;
