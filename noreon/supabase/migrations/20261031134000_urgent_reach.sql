-- Urgent member messages reach people (workflow map 31 Oct, section 4, gaps 3, 4 and 5). No clinical rule changes: the urgent word
-- list, what counts as urgent, the thresholds and every member-facing text stay where they are. Nothing here calls a model.
--
-- 1. care_alert_screen (from 20261017083922): a message the urgent list matched escalates with or without a red flag code. Before
--    this the database refused it when the entry has no code (self-harm, poisoning, severe bleeding and others): no alert was
--    raised and the message was retried for a day. The refusal stays for every other no-code escalation.
-- 2. A Telegram member Zoe skips (no Zoe consent, no assigned doctor, Zoe settings off) gets the same fixed 103 text as anyone else.
--    zoe_run_claim still skips them and nothing about Zoe reading their messages changes: the worker (lib/zoe/unread-urgent.ts) runs
--    only the urgent word list over the Telegram messages that run covers, and zoe_unread_urgent_finish stores the fixed text as an
--    'urgent' answer, which is deliverable after consent is withdrawn (_zoe_text_hold, 20261023063508). It raises the care alert a
--    Zoe urgent route raises. A run is checked once (zoe_runs.urgent_checked_at); a failure leaves it for the next pass.
-- 3. doctor_ai_inbox (from 20261031024358): a thread Zoe forwarded at the same-day level or above is in the Today lane (P1) at any
--    age until the doctor decides, because that is what the member was told. The item kinds are unchanged.

-- 1. Message screening ----------------------------------------------------------------------------------------------------
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
  or(p_outcome='escalate'and cardinality(coalesce(p_red_flags,'{}'))=0 and p_source<>'lab'and not(p_source='message'and p_reason='urgent_words_matched'))
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

-- 2. The fixed 103 text for a member Zoe skips ------------------------------------------------------------------------------
alter table public.zoe_runs add column urgent_checked_at timestamptz;
comment on column public.zoe_runs.urgent_checked_at is
 'When the urgent word list ran over a skipped run''s Telegram messages (zoe_unread_urgent_finish). Null on every other run.';
-- Runs skipped before this migration are not checked: a 103 text for a message up to a day old would be a false alarm.
update public.zoe_runs set urgent_checked_at=clock_timestamp()
 where state='finished'and outcome='skipped'and reason_code in('zoe_settings_off','no_zoe_reads_messages_consent','no_assigned_doctor');
create index zoe_runs_unread_urgent on public.zoe_runs(finished_at)
 where state='finished'and outcome='skipped'and urgent_checked_at is null and reason_code in('zoe_settings_off','no_zoe_reads_messages_consent','no_assigned_doctor');

-- Skipped runs with a Telegram message not checked yet, oldest first, within a day. A run covers the member messages newer than the
-- previous inbound run, up to its own, as zoe_run_claim batches them. Service role only; the text goes to the word list in the worker
-- and is never stored or logged. freeMode: the settings half of the pipeline's switch for the 103 text.
create function public.zoe_unread_urgent_pending(p_limit integer)returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare s public.zoe_settings;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 select * into s from public.zoe_settings where singleton;
 return coalesce((select jsonb_agg(jsonb_build_object('runId',q.id,
   'locale',(select case when pr.locale='en'then 'en'else 'hy'end from public.profiles pr where pr.id=q.member_id),
   'freeMode',coalesce(s.health_answers_enabled and s.symptom_intake_enabled,false),
   'messages',(select jsonb_agg(jsonb_build_object('seq',w.seq,'text',w.body)order by w.seq)from(
     select m.seq,m.body from public.conversation_messages m where m.conversation_id=q.conversation_id and m.source='telegram_member'
      and m.seq<=q.message_seq and m.seq>q.prev order by m.seq desc limit 20)w))order by q.finished_at,q.id)
  from(select r.id,r.member_id,r.conversation_id,r.message_seq,r.finished_at,p.prev from public.zoe_runs r
   cross join lateral(select coalesce(max(z.message_seq),0)prev from public.zoe_runs z where z.conversation_id=r.conversation_id and z.kind='inbound'and z.message_seq<r.message_seq)p
   where r.state='finished'and r.outcome='skipped'and r.urgent_checked_at is null
    and r.reason_code in('zoe_settings_off','no_zoe_reads_messages_consent','no_assigned_doctor')
    and r.kind='inbound'and r.finished_at>clock_timestamp()-interval '1 day'
    and exists(select 1 from public.conversation_messages m where m.conversation_id=r.conversation_id and m.source='telegram_member'
     and m.seq<=r.message_seq and m.seq>p.prev)
   order by r.finished_at,r.id limit greatest(1,least(coalesce(p_limit,10),20)))q),'[]'::jsonb);
end$$;

-- The word list's result for one skipped run: {seq,answer,language,alertReason,configVersion,events}. No seq: nothing urgent, the run
-- is only marked checked. With a seq: the fixed text on that Telegram message, as zoe_run_finish sends an urgent route (its answer
-- row, zoe.answer or the zoe.urgent fallback, its audit, the care alert with the same retry). The run itself stays skipped: Zoe did
-- not read the message and no model was called. The fixed text passes _zoe_text_hold because its kind is 'urgent'.
create function public.zoe_unread_urgent_finish(p_run uuid,p_result jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare r public.zoe_runs;msg public.conversation_messages;v_answer text;v_lang text;v_alert text;v_version text;flags text[];aid uuid;smid uuid;loc text;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 select * into r from public.zoe_runs where id=p_run for update;
 if not found or r.state<>'finished'or r.outcome is distinct from 'skipped'or r.kind<>'inbound'
  or r.reason_code not in('zoe_settings_off','no_zoe_reads_messages_consent','no_assigned_doctor')then return jsonb_build_object('ok',false,'code','not_a_skipped_run');end if;
 if r.urgent_checked_at is not null then return jsonb_build_object('ok',true,'outcome','checked','replayed',true);end if;
 if jsonb_typeof(p_result)is distinct from 'object'then return jsonb_build_object('ok',false,'code','invalid');end if;
 if jsonb_typeof(p_result->'seq')is distinct from 'number'then
  if p_result->>'seq'is not null then return jsonb_build_object('ok',false,'code','invalid');end if;
  update public.zoe_runs set urgent_checked_at=clock_timestamp()where id=r.id returning * into r;
  perform public._zoe_run_events(r,p_result->'events');
  return jsonb_build_object('ok',true,'outcome','checked','replayed',false);
 end if;
 v_answer:=nullif(btrim(p_result->>'answer'),'');v_lang:=p_result->>'language';v_alert:=p_result->>'alertReason';v_version:=left(coalesce(p_result->>'configVersion','unknown'),80);
 if v_answer is null or length(v_answer)>700 or coalesce(v_lang,'')not in('en','hy','ru')or coalesce(v_alert,'')not in('zoe_urgent_route','zoe_self_harm')
 then return jsonb_build_object('ok',false,'code','invalid');end if;
 perform 1 from public.conversations where id=r.conversation_id for update;
 select * into msg from public.conversation_messages m where m.conversation_id=r.conversation_id and m.seq=(p_result->>'seq')::bigint and m.source='telegram_member'
  and m.seq<=r.message_seq and m.seq>coalesce((select max(z.message_seq)from public.zoe_runs z where z.conversation_id=r.conversation_id and z.kind='inbound'and z.message_seq<r.message_seq),0);
 if not found then return jsonb_build_object('ok',false,'code','invalid');end if;
 update public.zoe_runs set urgent_checked_at=clock_timestamp()where id=r.id returning * into r;
 perform public._zoe_run_events(r,p_result->'events');
 loc:=coalesce((select case when pr.locale='en'then 'en'else 'hy'end from public.profiles pr where pr.id=r.member_id),'hy');
 insert into public.zoe_member_answers(conversation_id,member_id,run_id,message_seq,body,language,provider,model,kind)
 values(r.conversation_id,r.member_id,r.id,msg.seq,v_answer,v_lang,'noreon.rules','zoe-urgent-fixed','urgent')returning id into aid;
 if msg.request_id is not null and public._zoe_template_ok('zoe.answer',loc)then
  smid:=public._zoe_answer_enqueue(r.member_id,msg.request_id,v_answer);
  update public.zoe_member_answers set system_message_id=smid where id=aid;
 end if;
 if msg.request_id is not null and smid is null then
  perform public._system_message_enqueue('zoe.urgent',r.member_id,e,msg.request_id)from public.channel_inbox i join public.conversation_endpoints e on e.id=i.endpoint_id
   where i.id=msg.request_id and e.member_id=r.member_id and e.active;
 end if;
 insert into public.conversation_audit(conversation_id,actor_id,kind,detail)values(r.conversation_id,null,'zoe.urgent',jsonb_build_object('runId',r.id,'answerId',aid,'seq',msg.seq,
  'language',v_lang,'channel','telegram','telegram',smid is not null,'unread',true));
 if(public._care_alert_settings()).enabled is true then
  select coalesce(array_agg(distinct f order by f),'{}')into flags from jsonb_array_elements(case when jsonb_typeof(p_result->'events')='array'then p_result->'events'else '[]'end)ev,
   regexp_split_to_table(coalesce(ev#>>'{attributes,noreon.zoe.urgent.red_flags}',''),',')f where f~'^RF-(0[1-9]|1[0-2])$';
  begin
   perform public._zoe_urgent_alert(r.member_id,r.id,v_alert,flags,v_version);
  exception when others then
   perform public._conversation_trace(r.member_id,r.conversation_id,'zoe_run',r.id::text,'care_alert','care_alert.raise_failed','failed','zoe_urgent_alert_will_retry',
    'zoe.urgent_route',v_version,'system',null,jsonb_build_object('noreon.care_alert.source','zoe','noreon.error.sqlstate',sqlstate,
     'noreon.care_alert.reason',v_alert,'noreon.care_alert.red_flags',array_to_string(flags,',')));
  end;
 end if;
 return jsonb_build_object('ok',true,'outcome','urgent_sent','replayed',false,'answerId',aid);
end$$;
revoke all on function public.zoe_unread_urgent_pending(integer),public.zoe_unread_urgent_finish(uuid,jsonb)from public,anon,authenticated,service_role;
grant execute on function public.zoe_unread_urgent_pending(integer),public.zoe_unread_urgent_finish(uuid,jsonb)to service_role;
comment on function public.zoe_unread_urgent_pending(integer)is
 'Skipped runs (no Zoe consent, no assigned doctor, Zoe off) with Telegram messages the urgent word list has not seen yet. Worker only; no model.';
comment on function public.zoe_unread_urgent_finish(uuid,jsonb)is
 'Records the word list''s result for one skipped run: nothing, or the fixed 103 text on Telegram and the care alert. The run stays skipped.';


-- 3. The doctor's inbox ---------------------------------------------------------------------------------------------------
create or replace function public.doctor_ai_inbox()returns jsonb
language plpgsql security definer set search_path=''as $$
declare
 who jsonb:=public.real_clinical_staff_identity();
 me uuid;
 today date:=public._programme_today(clock_timestamp());
 p0 jsonb:='[]';items jsonb:='[]';part jsonb;missing text[]:='{}';
 p0_total integer;p0_cap constant integer:=200;lane_cap constant integer:=50;
 members uuid[];za jsonb:='[]';za_total integer:=0;
begin
 if who is null or who->>'role'is distinct from 'doctor'then raise insufficient_privilege using message='Assigned doctor session required';end if;
 me:=(who->>'id')::uuid;

 -- Members this doctor may read: assigned to them, with care access (as doctor_programme_queue). An array, not a
 -- temp table, so a caller's own session objects can never stand in for it.
 select coalesce(array_agg(k.user_id),'{}')into members from public.patient_clinical_cases k
  where k.assigned_doctor_id=me and public.staff_care_access(k.user_id,me,true);

 -- P0: care alerts. Open (new, or open again) before acknowledged; then oldest first.
 select count(*)into p0_total from public.care_alerts a where a.member_id=any(members)and a.state<>'resolved';
 select coalesce(jsonb_agg(x order by(x->>'rank')::int,(x->>'at')::timestamptz,x->>'id'),'[]')into p0 from(
  select jsonb_build_object('id','care_alert:'||a.id,'lane','P0','kind','care_alert','rank',case when a.state='open'then 0 else 1 end,
   'memberId',a.member_id,'at',a.created_at,'confidence','rule','ai','none',
   'sources',jsonb_build_array(jsonb_build_object('type','care_alert','ref',a.id::text),jsonb_build_object('type','source','ref',a.source))
    ||coalesce((select jsonb_agg(jsonb_build_object('type','rule','ref',f))from unnest(a.red_flags)f),'[]'),
   'alert',public._care_alert_json(a))x
  from public.care_alerts a where a.member_id=any(members)and a.state<>'resolved'
  order by(a.state='open')desc,a.created_at,a.id limit p0_cap)q;

 -- P1 and P2: lab files with values still to review. Flagged values make a P1 item; unflagged only, a P2 item.
 begin
  select coalesce(jsonb_agg(x),'[]')into part from(
   select jsonb_build_object('id','lab:'||v.file_id,'lane',case when bool_or(v.attention is not null)then 'P1'else 'P2'end,
    'kind',case when bool_or(v.attention is not null)then 'lab_attention'else 'lab_sheet'end,
    'rank',case when bool_or(v.attention='lab_critical'or v.lab_flag='critical')then 0 when bool_or(v.attention is not null)then 1 else 3 end,
    'memberId',v.user_id,'at',min(v.created_at),'confidence','H','ai','values',
    'fileId',v.file_id,'toReview',count(*),'flagged',count(*)filter(where v.attention is not null),
    'critical',count(*)filter(where v.attention='lab_critical'or v.lab_flag='critical'),
    'sources',coalesce(jsonb_agg(jsonb_build_object('type','lab_value','ref',v.id::text,'rule',v.attention_rule,'page',v.page)order by v.seq)
     filter(where v.attention is not null),'[]')||jsonb_build_array(jsonb_build_object('type','lab_file','ref',v.file_id::text)))x
   from public.lab_ai_values v
   where v.user_id=any(members)and v.status='unverified'and public._lab_ai_current(v.attachment_id)
   group by v.user_id,v.file_id)q;
  items:=items||part;
 exception when others then missing:=array_append(missing,'lab');end;

 -- P1 "worse" check-ins and P2 checkpoints due within 3 days (or overdue), while the programme is on.
 begin
  if public._programme_enabled()then
   select coalesce(jsonb_agg(x),'[]')into part from(
    select jsonb_build_object('id','checkpoint:'||c.id,'lane',case when i.feeling='worse'then 'P1'else 'P2'end,
     'kind',case when i.feeling='worse'then 'checkin_worse'else 'checkpoint_due'end,
     'rank',case when i.feeling='worse'then 2 when c.due_on<today then 0 else 2 end,
     'memberId',c.member_id,'at',coalesce(i.submitted_at,c.due_on::timestamptz),'confidence','H','ai','none',
     'checkpointId',c.id,'checkpointKind',c.kind,'dueOn',c.due_on,'overdue',c.due_on<today,'medicines',i.medicines,
     'sources',jsonb_build_array(jsonb_build_object('type','checkpoint','ref',c.id::text,'rule',c.kind))
      ||case when i.id is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object('type','checkin','ref',i.id::text))end)x
    from public.programme_checkpoints c
    left join public.programme_checkins i on i.checkpoint_id=c.id
    where c.member_id=any(members)and c.state in('scheduled','open')and(i.feeling='worse'or c.due_on<=today+3))q;
   items:=items||part;
  end if;
 exception when others then missing:=array_append(missing,'programme');end;

 -- P2 AI care plan drafts: the member's latest ready draft, not adopted, with no plan published since.
 begin
  if public._ai_plan_enabled()then
   select coalesce(jsonb_agg(x),'[]')into part from(
    select jsonb_build_object('id','plan:'||g.id,'lane','P2','kind','plan_draft','rank',1,
     'memberId',g.user_id,'at',g.created_at,'confidence','M','ai',case when g.mode='protocol_only'then 'protocol'else 'draft'end,
     'generationId',g.id,'stale',(g.lab_token is distinct from public._ai_plan_lab_token(g.user_id)or g.case_revision is distinct from k.revision),
     'sources',jsonb_build_array(jsonb_build_object('type','plan_generation','ref',g.id::text,'rule',g.prompt_version),
      jsonb_build_object('type','case_revision','ref',g.case_revision::text)))x
    from public.patient_clinical_cases k
    cross join lateral(select * from public.ai_plan_generations g where g.user_id=k.user_id and g.state='ready'order by g.created_at desc limit 1)g
    where k.user_id=any(members)and g.adopted_at is null
     and not exists(select 1 from public.patient_clinical_publications p where p.user_id=g.user_id and p.published_at>g.created_at))q;
   items:=items||part;
  end if;
 exception when others then missing:=array_append(missing,'plan');end;

 -- P1 and P3 replies, by the Replies page's rules (conversation_awaiting_replies) with two differences so that only a
 -- decision closes an item (review DI-01, DI-02): an undelivered reply stays until a newer reply or a rejection, at any
 -- age; and the wait starts at the oldest unanswered member event, a stored message or a media or over-limit message
 -- that has no stored row. Over 24 h is P1.
 -- Zoe's structured reply draft (#323) for the pending draft is carried on the item: the exact text, its revision and
 -- content hash (what an inbox Approve is bound to), and its sources. A question whose draft needs the doctor's
 -- judgement is P1 at any age. The draft is approvable from the inbox only when it is structured, current (conversation,
 -- clinical revision and evidence token unchanged), quotes the plan that is still published, needs no judgement, and the
 -- member has no unresolved care alert: P0 is never answered by a one-tap reply. The approval itself still goes through
 -- conversation_actions and conversation_command, which re-check all of this.
 begin
  select coalesce(jsonb_agg(x),'[]')into part from(
   select jsonb_build_object('id','reply:'||q.cid,'memberId',q.member_id,
    'lane',case when q.reason='not_delivered'or q.judgement or q.same_day or q.since<clock_timestamp()-interval '24 hours'then 'P1'else 'P3'end,
    'kind',case when q.reason='not_delivered'then 'reply_not_delivered'when q.since<clock_timestamp()-interval '24 hours'then 'reply_overdue'else 'reply_draft'end,
    'rank',case when q.reason='not_delivered'then 5 when q.judgement or q.same_day or q.since<clock_timestamp()-interval '24 hours'then 4 else 0 end,
    'at',case when q.reason='not_delivered'then q.delivered_at else q.since end,
    'confidence',case when q.reason='not_delivered'then 'rule'when q.draft_id is null or q.human_only or q.stale or(q.run_id is not null and not q.plan_current)then 'L'else 'M'end,
    'ai',case when q.reason='not_delivered'or q.draft_id is null or q.human_only then 'none'else 'draft'end,
    'unanswered',q.unanswered,'delivery',q.delivery,
    'sources',jsonb_build_array(jsonb_build_object('type','conversation','ref',q.cid::text,'seq',q.version))
     ||case when q.draft_id is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object('type','draft','ref',q.draft_id::text,'seq',q.draft_seq))end
     ||case when q.run_id is null or q.reason='not_delivered'then '[]'::jsonb else jsonb_build_array(jsonb_build_object('type','zoe_run','ref',q.run_id::text,'rule',q.s_version))
      ||case when q.plan_id is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object('type','plan_publication','ref',q.plan_id::text))end
      ||coalesce((select jsonb_agg(jsonb_build_object('type','plan_item','ref',e->>'id','rule',e->>'kind'))from jsonb_array_elements(q.quoted)e),'[]')end)
    ||case when q.reason='not_delivered'or q.draft_id is null then '{}'::jsonb else jsonb_build_object('draft',jsonb_build_object(
     'draftId',q.draft_id,'revision',q.draft_revision,'body',q.body,'contentHash',q.content_hash,'author',q.author,
     'structured',q.run_id is not null,'stale',q.stale,'planCurrent',q.plan_current,'openAlert',q.open_alert,
     'asked',q.asked,'acknowledgementId',q.ack_id,'needsJudgement',coalesce(q.needs_judgement,false),'outsidePlan',coalesce(q.outside_plan,false),
     'judgementReasons',coalesce(to_jsonb(q.judgement_reasons),'[]'),'doctorDecides',coalesce(to_jsonb(q.doctor_decides),'[]'),
     'approvable',q.run_id is not null and not q.stale and q.plan_current and not q.judgement and not q.open_alert))end x
   from(
    select q0.*,
     q0.draft_id is not null and(q0.draft_ctx<>q0.version or q0.draft_clinical is distinct from q0.case_revision
      or q0.draft_source is distinct from(case when q0.draft_id is null then null else public.patient_clinical_evidence(q0.member_id)->>'token'end))stale,
     q0.run_id is not null and q0.reason='new_message'and(coalesce(q0.needs_judgement,false)or coalesce(q0.outside_plan,false))judgement,
     q0.run_id is not null and q0.plan_id is not distinct from(select p.plan_id from public.patient_care_plans plan join public.patient_clinical_publications p on p.plan_id=plan.id and p.user_id=plan.user_id
      where plan.user_id=q0.member_id and plan.active and plan.published_at<=now()and p.published_at<=now()order by p.published_at desc limit 1)plan_current,
     exists(select 1 from public.care_alerts al where al.member_id=q0.member_id and al.state<>'resolved')open_alert
    from(
    select c.id cid,c.member_id,c.version,ld.state delivery,ld.created_at delivered_at,d.id draft_id,d.context_version draft_seq,
     d.revision draft_revision,d.context_version draft_ctx,d.clinical_revision draft_clinical,d.source_token draft_source,k.revision case_revision,
     rv.body,rv.content_hash,rv.author_kind author,
     rv.author_kind='staff'and not exists(select 1 from public.conversation_revisions ar where ar.draft_id=d.id and ar.author_kind='ai_assistant')human_only,
     s.run_id,s.version s_version,s.plan_id,s.quoted,s.asked,s.acknowledgement_id ack_id,s.needs_judgement,s.outside_plan,s.judgement_reasons,s.doctor_decides,
     (select count(*)from public.conversation_messages m2 where m2.conversation_id=c.id and m2.seq>coalesce(dec.v,0))::int unanswered,
     -- 20261031134000: Zoe sent something in the open window to the doctor at the same-day level or above (the zoe.forward audit
     -- zoe_run_finish writes). The member was told it needs a doctor today, so it is in Today at any age, until a decision.
     exists(select 1 from public.conversation_audit au where au.conversation_id=c.id and au.kind='zoe.forward'
      and(au.detail->>'seq')::bigint>coalesce(dec.v,0)and au.detail->>'urgency'in('same_day','emergency'))same_day,
     case when c.version>coalesce(dec.v,0)and zst.st is null then 'new_message'
      when ld.state in('definitely_failed','unknown')or(ld.state='held'and ld.reason is distinct from 'newer_member_message'
       and not(ld.reason='route_policy_missing'and exists(select 1 from public.conversation_app_releases ar where ar.approval_id=ld.approval_id)))
      then case when exists(select 1 from public.conversation_drafts d2 where d2.conversation_id=c.id and d2.state='rejected'and d2.created_at>ld.created_at)then null else 'not_delivered'end
     end reason,
     coalesce(least(
      (select min(cm.created_at)from public.conversation_messages cm where cm.conversation_id=c.id and cm.seq>coalesce(dec.v,0)),
      (select min(au.created_at)from public.conversation_audit au where au.conversation_id=c.id and au.kind in('message.media','message.overflow')
        and(au.detail->>'version')::bigint>coalesce(dec.v,0))),clock_timestamp())since
    from public.conversations c
    join public.patient_clinical_cases k on k.user_id=c.member_id
    left join lateral(select max(dd.context_version)v from public.conversation_drafts dd where dd.conversation_id=c.id and dd.state in('approved','rejected'))dec on true
    left join lateral(select dl.state,dl.reason,dl.created_at,dl.approval_id from public.conversation_deliveries dl where dl.conversation_id=c.id order by dl.created_at desc,dl.id desc limit 1)ld on true
    left join lateral(select dd.* from public.conversation_drafts dd where dd.conversation_id=c.id and dd.state='pending'order by dd.created_at desc,dd.id desc limit 1)d on true
    left join public.conversation_revisions rv on rv.draft_id=d.id and rv.revision=d.revision
    left join lateral(select zr.* from public.zoe_runs z join public.zoe_reply_drafts zr on zr.run_id=z.id where z.draft_id=d.id order by zr.created_at desc limit 1)s on true
    -- Part 2 (20261020060842): a thread Zoe fully answered is not "new message"; an undelivered reply still is.
    left join lateral(select public._zoe_answered_open(c.id)st)zst on true
    where c.member_id=any(members))q0)q
   where q.reason is not null)q2;
  items:=items||part;
 exception when others then missing:=array_append(missing,'replies');end;

 -- P1 finished symptom intakes the doctor has not answered yet (no reply decision at or after the intake's last message).
 begin
  select coalesce(jsonb_agg(x),'[]')into part from(
   select jsonb_build_object('id','intake:'||s.id,'lane','P1','kind','intake','rank',3,'memberId',s.member_id,'at',coalesce(s.finished_at,s.updated_at),
    'confidence','H','ai','summary','intakeId',s.id,'sheetId',s.sheet_id,'ending',s.ending,'redFlags',jsonb_array_length(coalesce(s.summary#>'{redFlags,hits}','[]')),
    'sources',jsonb_build_array(jsonb_build_object('type','intake','ref',s.id::text,'rule',s.sheet_id||'@'||s.sheet_version,'seq',s.last_seq)))x
   from public.zoe_symptom_intakes s
   where s.member_id=any(members)and s.state<>'active'
    and not exists(select 1 from public.conversation_drafts dd where dd.conversation_id=s.conversation_id and dd.state in('approved','rejected')and dd.context_version>=s.last_seq))q;
  items:=items||part;
 exception when others then missing:=array_append(missing,'intake');end;

 -- Part 2 (20261020060842): threads Zoe fully answered, not yet marked reviewed, newest first (not an item: the item kinds
 -- stay those the running app parses). Its own block, so a failure here is reported and never hides the lanes.
 begin
  select coalesce(jsonb_agg(x order by x->>'answeredAt'desc,x->>'memberId'),'[]'),count(*)into za,za_total from(
   select q.st||jsonb_build_object('memberName',coalesce(pr.display_name,''))x
   from(select c.member_id,public._zoe_answered_open(c.id)st from public.conversations c where c.member_id=any(members))q
   left join public.profiles pr on pr.id=q.member_id
   where q.st is not null and not(q.st->>'reviewed')::boolean)q2;
  za:=coalesce((select jsonb_agg(x order by n)from jsonb_array_elements(za)with ordinality e(x,n)where n<=lane_cap),'[]');
 exception when others then missing:=array_append(missing,'zoe_answered');za:='[]';za_total:=0;end;

 -- Names, lane order, caps. The order is lane, rank, age (oldest first), id; check:doctor-ai-inbox pins it.
 select coalesce(jsonb_agg(x||jsonb_build_object('memberName',coalesce(pr.display_name,''))order by x->>'lane',(x->>'rank')::int,(x->>'at')::timestamptz,x->>'id'),'[]')into items
 from(select x,row_number()over(partition by x->>'lane'order by(x->>'rank')::int,(x->>'at')::timestamptz,x->>'id')n from jsonb_array_elements(items)x)q
 left join public.profiles pr on pr.id=(x->>'memberId')::uuid where n<=lane_cap;
 select coalesce(jsonb_agg(x||jsonb_build_object('memberName',coalesce(x#>>'{alert,memberName}',''))order by(x->>'rank')::int,(x->>'at')::timestamptz,x->>'id'),'[]')into p0
 from jsonb_array_elements(p0)x;

 -- One access record per member shown, as other doctor reads.
 perform public._access_audit_record(mid,'doctor_inbox',null)
 from(select distinct(x->>'memberId')::uuid mid from jsonb_array_elements(p0||items||za)x)q;

 return jsonb_build_object('version','doctor-inbox-v1','ok',true,'asOf',clock_timestamp(),
  'p0',p0,'p0Total',p0_total,'items',items,'laneCap',lane_cap,'unavailable',to_jsonb(missing),'zoeAnswered',za,'zoeAnsweredTotal',za_total);
end$$;
-- create or replace keeps the grants of care_alert_screen (service_role) and doctor_ai_inbox (authenticated).
