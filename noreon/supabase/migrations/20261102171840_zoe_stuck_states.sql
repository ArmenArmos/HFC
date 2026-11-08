-- A doctor resolving a care alert explicitly closes that matter. A reply, draft rejection,
-- acknowledgement, or administrator resolution does not hand the conversation back.
alter table public.zoe_doctor_mode drop constraint zoe_doctor_mode_reason_check;
alter table public.zoe_doctor_mode add constraint zoe_doctor_mode_reason_check
 check(reason in('doctor_reply','hand_back','closed'));

do $migration$
declare definition text; old text; replacement text;
begin
 definition:=pg_get_functiondef('public.care_alert_resolve(uuid,bigint,text,text)'::regprocedure);
 old:=$old$select * into a from public.care_alerts where id=p_alert and member_id=m for update;$old$;
 replacement:=$new$-- Match the worker's conversation-before-alert order before changing either state.
 perform 1 from public.conversations where member_id=m for update;
 select * into a from public.care_alerts where id=p_alert and member_id=m for update;$new$;
 if cardinality(string_to_array(definition,old))<>2 then raise exception 'Unexpected care_alert_resolve lock definition';end if;
 definition:=replace(definition,old,replacement);
 old:=$old$return jsonb_build_object('ok',true,'changed',true,'alert',public._care_alert_json(a));$old$;
 replacement:=$new$if actor->>'role'='doctor' and public.staff_care_access(a.member_id,(actor->>'id')::uuid,true) then
  -- Existing assignment and care-access gate, checked under the case/conversation locks.
  perform public._zoe_mode_doctor(a.member_id);
  update public.zoe_doctor_mode set doctor_mode=false,changed_by=(actor->>'id')::uuid,
   changed_at=clock_timestamp(),reason='closed' where member_id=a.member_id and doctor_mode;
  if found then
   declare c public.conversations;nid uuid;
   begin
    select * into c from public.conversations where member_id=a.member_id;
    if public._zoe_active_for(a.member_id) then
     nid:=public._zoe_mode_notify(c.id,a.member_id,'zoe_back',clock_timestamp());
    end if;
    insert into public.conversation_audit(conversation_id,actor_id,kind,detail)
    values(c.id,(actor->>'id')::uuid,'zoe.doctor_mode_off',
     jsonb_build_object('version',c.version,'noticeId',nid,'reason','closed','alertId',a.id));
    perform public._access_audit_record(a.member_id,'doctor_zoe_mode','closed');
   end;
  end if;
 end if;
 return jsonb_build_object('ok',true,'changed',true,'alert',public._care_alert_json(a));$new$;
 if cardinality(string_to_array(definition,old))<>2 then raise exception 'Unexpected care_alert_resolve result definition';end if;
 execute replace(definition,old,replacement);
end $migration$;

-- The flagged alarm conversation uses this projection. The legacy urgent-window
-- RPC stays unchanged. A doctor reply is a durable boundary even after it leaves claim history.
create or replace function public._zoe_talking_urgent_window(p_conversation uuid)returns table(started_at timestamptz,opened_by text)
language sql stable security definer set search_path=''as $$
 with boundary as(select greatest(
  coalesce((select max(a.created_at)from public.zoe_member_answers a where a.conversation_id=p_conversation
   and a.kind<>'urgent'and a.created_at<=clock_timestamp()and not exists(
    select 1 from public.conversation_trace_events e where e.conversation_id=p_conversation
     and e.subject_kind='zoe_run'and e.subject_id=a.run_id::text and e.name='zoe.urgent.conversation'
     and e.reason_code='alarm_conversation_continues')),'-infinity'::timestamptz),
  coalesce((select max(ap.created_at)from public.conversation_approvals ap join public.conversation_drafts d on d.id=ap.draft_id
   where d.conversation_id=p_conversation and ap.created_at<=clock_timestamp()),'-infinity'::timestamptz),
  coalesce((select max(k.cleared_at)from public.zoe_urgent_clears k where k.conversation_id=p_conversation
   and k.cleared_at<=clock_timestamp()),'-infinity'::timestamptz))at),
 run as(select a.created_at,z.reason_code from public.zoe_member_answers a join public.zoe_runs z on z.id=a.run_id,boundary b
  where a.conversation_id=p_conversation and a.kind='urgent'and a.created_at>b.at and a.created_at<=clock_timestamp()
   and not(z.reason_code='urgent_in_window_no_model_call'and z.started_at<=b.at))
 select min(run.created_at),case when count(*)=0 then null
  when bool_and(run.reason_code in('urgent_health_answer_model','urgent_in_window_no_model_call'))
   and bool_or(run.reason_code='urgent_health_answer_model')then 'model'else 'rule'end from run
$$;

-- Refusal is persisted per alert, not inferred from the last ten visible answers.
-- A fresh full urgent text resets it; repeated reminders do not. No additional storage.
do $migration$
declare definition text; old text; replacement text;
begin
 definition:=pg_get_functiondef('public.zoe_run_alarm_window(uuid[])'::regprocedure);
 old:=$old$'openedBy',mw.opened_by,'throughSeq',mw.through_seq,$old$;
 replacement:=$new$'openedBy',mw.opened_by,'throughSeq',mw.through_seq,
    'refused103',exists(select 1 from public.zoe_runs refused where refused.conversation_id=r.conversation_id
     and refused.state='finished'and refused.forward_reason='refused_103'
     and refused.finished_at>=coalesce((select max(ua.created_at)from public.zoe_member_answers ua
      join public.zoe_runs urgent on urgent.id=ua.run_id where ua.conversation_id=r.conversation_id
       and ua.kind='urgent'and urgent.reason_code<>'urgent_in_window_no_model_call'
       and ua.created_at>=mw.at and ua.created_at<=clock_timestamp()),mw.at)
     and refused.finished_at<=clock_timestamp()),$new$;
 if cardinality(string_to_array(definition,old))<>2 then raise exception 'Unexpected zoe_run_alarm_window context definition';end if;
 execute replace(definition,old,replacement);
end $migration$;

-- A well-formed worker topic may continue unless it positively identifies the doctor's
-- matter. Preserve the per-run scope, including explicit write-to-doctor messages.
do $migration$
declare definition text; old text; replacement text;
begin
 definition:=pg_get_functiondef('public.zoe_run_finish(uuid,jsonb)'::regprocedure);
 old:=$old$if not public._zoe_doctor_mode(r.conversation_id)or(t_owner='zoe'and tp->>'doctorTopic'='no'and public._zoe_takeover_scope()='topic')then$old$;
 replacement:=$new$if not coalesce((public.zoe_run_doctor_mode(array[r.id])->0->>'doctorMode')::boolean,true)
 or(t_owner='zoe'and tp?'doctorTopic'
  and(tp->>'doctorTopic' is null or tp->>'doctorTopic' in('no','unsure'))
  and public.zoe_run_doctor_mode(array[r.id])->0->>'scope'='topic')then$new$;
 if cardinality(string_to_array(definition,old))<>2 then raise exception 'Unexpected zoe_run_finish topic definition';end if;
 definition:=replace(definition,old,replacement);
 -- Retain every asserted symptom family without adding a null key to older triggers.
 old:=$old$case when pm.id::text=alarm#>>'{reading,id}'then to_jsonb(pm.measured_at)end))end);$old$;
 replacement:=$new$case when pm.id::text=alarm#>>'{reading,id}'then to_jsonb(pm.measured_at)end))end);
   if jsonb_typeof(alarm->'symptoms')='array' then
    if jsonb_array_length(alarm->'symptoms')<=40 and not exists(
     select 1 from jsonb_array_elements(alarm->'symptoms')s
      where jsonb_typeof(s)<>'string' or s#>>'{}'!~'^[a-z][a-z0-9_]{0,39}$')then
     trigger:=trigger||jsonb_build_object('symptoms',alarm->'symptoms');
    end if;
   end if;$new$;
 if cardinality(string_to_array(definition,old))<>2 then raise exception 'Unexpected zoe_run_finish trigger definition';end if;
 execute replace(definition,old,replacement);
end $migration$;
