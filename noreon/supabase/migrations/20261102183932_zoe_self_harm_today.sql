-- Task 8 review (Fable, PR #522). Self-harm thoughts without a plan get the fixed "today" reply (reason same_day_floor_self_harm,
-- forward self_harm). R2: the 103 route passes the consent gate because withholding it is the greater harm; so does this reply, or the
-- member gets nothing and nothing is forwarded. The zoe.receipt text goes through dispatch too, so the two hold functions exempt it.
-- R3: the care alert is raised at once, as on the 103 route, so "the team will know" is true when Zoe says it.
do $migration$
declare definition text;old text;replacement text;
begin
 definition:=pg_get_functiondef('public.zoe_run_finish(uuid,jsonb)'::regprocedure);
 old:=$old$ if not safety and not public._zoe_consent_ok(r.member_id)then$old$;
 replacement:=$new$ if not safety and not(same_day and rs='same_day_floor_self_harm'and p_result#>>'{health,forwardReason}'='self_harm')and not public._zoe_consent_ok(r.member_id)then$new$;
 if cardinality(string_to_array(definition,old))<>2 then raise exception 'Unexpected zoe_run_finish consent definition';end if;
 execute replace(definition,old,replacement);

 definition:=pg_get_functiondef('public._zoe_run_finish_core(uuid,jsonb)'::regprocedure);
 old:=$old$ if v_outcome='discarded'and v_reason in('urgent_route_no_model_call','urgent_in_window_no_model_call','urgent_health_answer_model','urgent_health_answer_red_flag_yes')
  and(public._care_alert_settings()).enabled is true then$old$;
 replacement:=$new$ if(v_outcome='discarded'and v_reason in('urgent_route_no_model_call','urgent_in_window_no_model_call','urgent_health_answer_model','urgent_health_answer_red_flag_yes')
  or v_outcome='summary_only'and v_reason='same_day_floor_self_harm'and hl->>'forwardReason'='self_harm')
  and(public._care_alert_settings()).enabled is true then$new$;
 if cardinality(string_to_array(definition,old))<>2 then raise exception 'Unexpected _zoe_run_finish_core alert definition';end if;
 execute replace(definition,old,replacement);
end $migration$;

create or replace function public._zoe_text_hold(p_message uuid)returns text
language sql stable security definer set search_path=''as $$
 select case when a.id is null or a.kind='urgent'then null
  when not public._zoe_consent_ok(a.member_id)and not exists(select 1 from public.zoe_runs z where z.id=a.run_id and z.reason_code='same_day_floor_self_harm')then 'zoe_consent_withdrawn'
  when public._zoe_doctor_mode(a.conversation_id)and exists(select 1 from public.conversation_approvals ap join public.conversation_drafts d on d.id=ap.draft_id
   where d.conversation_id=a.conversation_id and ap.created_at>a.created_at and(public._zoe_takeover_scope()='conversation'or a.message_seq<=ap.context_version))then 'doctor_takeover'
 end
 from(select 1)x left join public.zoe_member_answers a on a.system_message_id=p_message
$$;

create or replace function public._zoe_text_hold_queued(p_conversation uuid,p_reason text,p_through_seq bigint)returns integer
language plpgsql security definer set search_path=''as $$
declare sm public.system_messages;n integer:=0;
begin
 for sm in update public.system_messages s set state='held',reason=p_reason,state_seq=s.state_seq+1,updated_at=clock_timestamp()
  from public.zoe_member_answers a where a.system_message_id=s.id and a.conversation_id=p_conversation and a.kind<>'urgent'and s.state='queued'
   and(p_through_seq is null or a.message_seq<=p_through_seq)
   and not(p_reason='zoe_consent_withdrawn'and exists(select 1 from public.zoe_runs z where z.id=a.run_id and z.reason_code='same_day_floor_self_harm'))
  returning s.* loop
  perform public._system_message_audit(sm.id,'held',jsonb_build_object('reason',p_reason));n:=n+1;
 end loop;
 return n;
end$$;
