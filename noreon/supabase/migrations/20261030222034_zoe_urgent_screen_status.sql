-- The Zoe 103 screen says what really happened (output/bp-entry-safety-2026-10-30/RESULTS.md, false promise 1). It told the
-- member nobody had been notified while a care alert was raised in the same flow.
-- care_alert_member_status() takes the request id of the message that opened the screen and answers in "zoe", about that message only:
--  alerted: its screening, or the Zoe run on it, raised an alert (in any state, as for the questionnaire);
--  pending: that is not settled yet, so neither "told" nor "not told" can be said. The screen opens before the alert exists: the
--   message is screened after the response and the sweep runs Zoe. It settles only on finished work, never on time passing or on
--   the switch (Astra ZUT-02): screening and claims take messages up to a day old, a failed raise is retried without expiry, and
--   both resume when alerts are switched back on.
--   A request that is not stored, or is another member's, stays pending: an older message never stands in for it (Astra ZUT-01).
-- Without a request id zoe is null. The keys the questionnaire screen reads are unchanged. No alert, threshold or route changes.
drop function public.care_alert_member_status();
create function public.care_alert_member_status(p_zoe_request uuid default null)returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare m uuid:=auth.uid();rule text;sc public.care_alert_screenings;a public.care_alerts;enabled boolean;
 msg public.conversation_messages;run public.zoe_runs;zoe_alerted boolean:=false;zoe_pending boolean:=false;
begin
 if auth.role()is distinct from 'authenticated'or m is null then raise insufficient_privilege;end if;
 select urgent_rule into rule from public.patient_assessments where user_id=m;
 if rule is not null then
  sc:=public._care_alert_current_screening(m,rule);
  if sc.alert_id is not null then
   select * into a from public.care_alerts where id=sc.alert_id;
  end if;
 end if;
 enabled:=coalesce((public._care_alert_settings()).enabled,false);
 if p_zoe_request is not null then
  select cm.* into msg from public.conversations c join public.conversation_messages cm on cm.conversation_id=c.id
   where c.member_id=m and cm.request_id=p_zoe_request and cm.source='authenticated_member';
  if msg.id is not null then
   select * into run from public.zoe_runs zr where zr.conversation_id=msg.conversation_id and zr.message_seq=msg.seq and zr.kind='inbound';
   zoe_alerted:=exists(select 1 from public.care_alert_screenings s where s.member_id=m and s.alert_id is not null
    and(s.source='message'and s.source_ref=msg.id::text or s.source='zoe'and s.source_ref in('urgent:'||run.id::text,'intake:'||run.id::text)));
  end if;
  -- An urgent run with no screening is a failed raise, which the sweep retries (care_alert_zoe_urgent_retry).
  zoe_pending:=not zoe_alerted
   and(msg.id is null or run.id is null or run.state<>'finished' or run.outcome='intake_escalated'
    or run.reason_code in('urgent_route_no_model_call','urgent_in_window_no_model_call','urgent_health_answer_model','urgent_health_answer_red_flag_yes')
    or not exists(select 1 from public.care_alert_screenings s where s.source='message'and s.source_ref=msg.id::text));
 end if;
 return jsonb_build_object('ok',true,'alertsEnabled',enabled,'alerted',a.id is not null,'alertedAt',a.created_at,
  'zoe',case when p_zoe_request is not null then jsonb_build_object('alerted',zoe_alerted,'pending',zoe_pending)end);
end$$;
revoke all on function public.care_alert_member_status(uuid)from public,anon,authenticated,service_role;
grant execute on function public.care_alert_member_status(uuid)to authenticated;
