-- Urgent screen follow-up (QA M-01, lead decision 17 Oct): the member's urgent screen can
-- say truthfully whether the care team was alerted, and no red flag disappears silently.
--
-- 1. Every change of a stored red flag (cleared, or replaced by another) is recorded in
--    urgent_answer_changes with the answers that changed. Append-only. Written by the
--    trigger, so no save path can skip it.
-- 2. A cleared red flag (for example a member correcting an answer chosen by mistake) still
--    raises a care-team alert, reason questionnaire_red_flag_cleared, carrying the flag that
--    was cleared. It merges into a live questionnaire alert like any repeat.
-- 3. care_alert_member_status(): the signed-in member's own view: whether alerts are on and
--    whether the care team has an alert for the current red flag. It says nothing about
--    whether anyone has read it.

create table public.urgent_answer_changes (
 id bigint generated always as identity primary key,
 member_id uuid not null references auth.users(id) on delete cascade,
 assessment_id uuid not null,
 revision bigint not null,
 previous_rule text not null,
 current_rule text,
 -- {fieldId: {"before": value, "after": value}} for answers whose value changed in this save.
 changed_fields jsonb not null default '{}'check(jsonb_typeof(changed_fields)='object'),
 alert_id uuid references public.care_alerts(id) on delete set null,
 -- Whether care-team alerts were on at the time: only then is a missing alert retried.
 alerts_on boolean not null default false,
 created_at timestamptz not null default clock_timestamp()
);
create index urgent_answer_changes_member on public.urgent_answer_changes(member_id,created_at);
create trigger urgent_answer_changes_append_only before update or delete on public.urgent_answer_changes
 for each row execute function public._care_alert_audit_immutable();

create or replace function public._care_alert_from_assessment()returns trigger
language plpgsql security definer set search_path=''as $$
declare cleared boolean:=tg_op='UPDATE'and old.urgent_rule is not null and new.urgent_rule is null;
 changed boolean:=tg_op='UPDATE'and old.urgent_rule is not null and new.urgent_rule is distinct from old.urgent_rule;
 r jsonb;aid uuid;fields jsonb;alerts_on boolean:=coalesce((public._care_alert_settings()).enabled,false);
begin
 if new.urgent_rule is null and not cleared then return null;end if;
 if new.urgent_rule is not null and tg_op='UPDATE'and old.urgent_rule is not distinct from new.urgent_rule then return null;end if;
 if alerts_on then
  begin
   if cleared then
    r:=public._care_alert_screen(new.user_id,'questionnaire',new.id::text||':'||new.revision,'escalate','questionnaire_red_flag_cleared',
     case when old.urgent_rule ~ '^RF-(0[1-9]|1[0-2])$'then array[old.urgent_rule]end,'clinical.red_flag',new.algorithm_version);
   else
    r:=public._care_alert_screen_assessment(new);
   end if;
   aid:=nullif(r->>'alertId','')::uuid;
  exception when others then
   begin
    perform public._conversation_trace(new.user_id,null,'patient_assessment',new.id::text,'care_alert','care_alert.raise_failed','failed',
     case when cleared then 'cleared_flag_alert_not_recorded'else 'alert_not_recorded_will_retry'end,'clinical.red_flag',new.algorithm_version,'system',null,
     jsonb_build_object('noreon.care_alert.source','questionnaire','noreon.error.sqlstate',sqlstate));
   exception when others then null;
   end;
  end;
 end if;
 if changed then
  -- Recorded whether or not alerts are on: a red flag never changes without a record.
  select coalesce(jsonb_object_agg(k,jsonb_build_object('before',old.answers->k->'value','after',new.answers->k->'value')),'{}')into fields
  from(select jsonb_object_keys(old.answers)k union select jsonb_object_keys(new.answers))keys
  where(old.answers->k->'value')is distinct from(new.answers->k->'value');
  insert into public.urgent_answer_changes(member_id,assessment_id,revision,previous_rule,current_rule,changed_fields,alert_id,alerts_on)
  values(new.user_id,new.id,new.revision,old.urgent_rule,new.urgent_rule,fields,aid,alerts_on);
  perform public._conversation_trace(new.user_id,null,'patient_assessment',new.id::text,'care_alert',
   case when cleared then 'care_alert.red_flag_cleared'else 'care_alert.red_flag_changed'end,'recorded',
   case when cleared then 'answer_changed_flag_cleared'else 'answer_changed_flag_replaced'end,'clinical.red_flag',new.algorithm_version,'member',new.user_id,
   jsonb_build_object('noreon.care_alert.previous_rule',old.urgent_rule,'noreon.care_alert.current_rule',new.urgent_rule,
    'noreon.care_alert.changed_fields',(select string_agg(k,',' order by k)from jsonb_object_keys(fields)k),'noreon.care_alert.alerted',aid is not null));
 end if;
 return null;
end$$;

-- The screening that raised the member's CURRENT red-flag occurrence, if any (Fable U2, N1a).
-- An occurrence starts at the latest recorded change (urgent_answer_changes) or later: a flag
-- that was cleared and set again needs a newer screening. Cleared-flag screenings never count.
create function public._care_alert_current_screening(m uuid,rule text)returns public.care_alert_screenings
language sql stable security definer set search_path=''as $$
 select s.* from public.care_alert_screenings s
 where s.source='questionnaire'and s.member_id=m and rule=any(s.red_flags)and s.reason_code<>'questionnaire_red_flag_cleared'
  and split_part(s.source_ref,':',2)~'^[0-9]+$'
  and split_part(s.source_ref,':',2)::bigint>=coalesce((select max(c.revision)from public.urgent_answer_changes c where c.member_id=m),0)
 order by s.screened_at desc limit 1
$$;

-- The member's own status for the urgent screen. "alerted" is true only when the screening for
-- the current occurrence raised an alert (in any state: staff resolving it does not undo telling them).
create function public.care_alert_member_status()returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare m uuid:=auth.uid();rule text;sc public.care_alert_screenings;a public.care_alerts;
begin
 if auth.role()is distinct from 'authenticated'or m is null then raise insufficient_privilege;end if;
 select urgent_rule into rule from public.patient_assessments where user_id=m;
 if rule is not null then
  sc:=public._care_alert_current_screening(m,rule);
  if sc.alert_id is not null then
   select * into a from public.care_alerts where id=sc.alert_id;
  end if;
 end if;
 return jsonb_build_object('ok',true,'alertsEnabled',coalesce((public._care_alert_settings()).enabled,false),'alerted',a.id is not null,'alertedAt',a.created_at);
end$$;

-- Retry sweep, replaced (Fable U1, U2/N1a): (1) a current red flag whose occurrence has no
-- screening; (2) a cleared red flag whose cleared-alert screening is missing. Both keyed by
-- occurrence, never by time, so a success is never re-raised.
create or replace function public.care_alert_assessments_retry(p_limit integer)returns jsonb
language plpgsql security definer set search_path=''as $$
declare a public.patient_assessments;c public.urgent_answer_changes;r jsonb;n integer:=0;f integer:=0;lim integer:=greatest(1,least(coalesce(p_limit,20),50));
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if(public._care_alert_settings()).enabled is not true then return jsonb_build_object('ok',true,'raised',0,'failed',0);end if;
 for a in select pa.* from public.patient_assessments pa where pa.urgent_rule is not null and pa.updated_at>clock_timestamp()-interval '1 day'
  and(public._care_alert_current_screening(pa.user_id,pa.urgent_rule)).source is null
  -- A non-RF code (unreachable today) is screened once per occurrence too (Fable U6).
  and not(pa.urgent_rule !~ '^RF-(0[1-9]|1[0-2])$'and exists(select 1 from public.care_alert_screenings s where s.source='questionnaire'and s.member_id=pa.user_id
   and s.reason_code='questionnaire_unknown_rule'and split_part(s.source_ref,':',2)~'^[0-9]+$'
   and split_part(s.source_ref,':',2)::bigint>=coalesce((select max(uc.revision)from public.urgent_answer_changes uc where uc.member_id=pa.user_id),0)))
  order by pa.updated_at limit lim loop
  begin
   r:=public._care_alert_screen_assessment(a);
   if(r->>'replayed')='false'then n:=n+1;end if;
  exception when others then f:=f+1;
  end;
 end loop;
 for c in select ch.* from public.urgent_answer_changes ch where ch.current_rule is null and ch.alert_id is null and ch.alerts_on and ch.created_at>clock_timestamp()-interval '1 day'
  and not exists(select 1 from public.care_alert_screenings s where s.source='questionnaire'and s.source_ref=ch.assessment_id::text||':'||ch.revision)
  order by ch.id limit lim loop
  begin
   r:=public._care_alert_screen(c.member_id,'questionnaire',c.assessment_id::text||':'||c.revision,'escalate','questionnaire_red_flag_cleared',
    case when c.previous_rule ~ '^RF-(0[1-9]|1[0-2])$'then array[c.previous_rule]end,'clinical.red_flag',
    coalesce((select algorithm_version from public.patient_assessments where id=c.assessment_id),'unknown'));
   if(r->>'replayed')='false'then n:=n+1;end if;
  exception when others then f:=f+1;
  end;
 end loop;
 return jsonb_build_object('ok',true,'raised',n,'failed',f);
end$$;

-- Staff card shows why the latest repeat happened, so a withdrawn answer is visible (Fable U3).
create or replace function public._care_alert_json(a public.care_alerts)returns jsonb language sql stable security definer set search_path=''as $$
 select jsonb_build_object('id',a.id,'memberId',a.member_id,'memberName',coalesce((select display_name from public.profiles where id=a.member_id),''),
  'source',a.source,'priority',a.priority,'reason',a.reason_code,'redFlags',to_jsonb(a.red_flags),'state',a.state,'stateSeq',a.state_seq,
  'occurrences',a.occurrences,'createdAt',a.created_at,'lastSeenAt',a.last_seen_at,
  'lastReason',(select e.detail->>'reason'from public.care_alert_audit e where e.alert_id=a.id and e.kind='repeated'order by e.id desc limit 1),
  'doctorName',(select display_name from public.workspace_staff where user_id=a.doctor_id),
  'acknowledgedAt',a.acknowledged_at,'acknowledgedBy',(select display_name from public.workspace_staff where user_id=a.acknowledged_by),
  'resolvedAt',a.resolved_at,'resolvedBy',(select display_name from public.workspace_staff where user_id=a.resolved_by),
  'resolution',a.resolution,'resolutionNote',a.resolution_note,
  'telegram',coalesce((select jsonb_agg(jsonb_build_object('recipient',coalesce(ws.display_name,''),'state',tm.state,'reason',tm.reason)order by d.created_at)
   from public.care_alert_deliveries d join public.telegram_auth_messages tm on tm.id=d.telegram_message_id left join public.workspace_staff ws on ws.user_id=d.recipient_id
   where d.alert_id=a.id and d.occurrence=a.occurrences),'[]'))
$$;

alter table public.urgent_answer_changes enable row level security;
revoke all on public.urgent_answer_changes from public,anon,authenticated,service_role;
revoke all on sequence public.urgent_answer_changes_id_seq from public,anon,authenticated,service_role;
revoke all on function public._care_alert_from_assessment(),public.care_alert_member_status(),public._care_alert_current_screening(uuid,text),public._care_alert_json(public.care_alerts),public.care_alert_assessments_retry(integer)from public,anon,authenticated,service_role;
grant execute on function public.care_alert_assessments_retry(integer)to service_role;
grant execute on function public.care_alert_member_status()to authenticated;
