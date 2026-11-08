-- Doctor inbox, part 2 (Khikar 19 Oct; Zoe spec v1 §10): a thread Zoe fully answered in free mode, where the member did not
-- ask for the doctor, is "answered by Zoe" instead of "needs reply". The doctor sees it in its own group, can mark it
-- reviewed, or reopen it to needs reply. Before this every member message stayed on the needs-reply list even when Zoe had
-- answered it (lead decision 18 Oct 03:27, which this replaces for free-mode health answers only).
--
-- Safety rule: nothing urgent, flagged, forwarded or unanswered is ever moved out of needs reply. _zoe_answered_open is the
-- one place that decides, and it says "answered" only when every one of these holds for the thread's open window (member
-- messages after the doctor's last decision):
--  * Zoe's newest run is for the current conversation version (no member message, photo or over-limit message after it)
--    and finished; the window holds a health answer (outcome 'answered' with zoe_runs.forward set, which only free mode
--    does) with forward 'none', urgency below same day, and the answer stored;
--  * the newest such answer does not end with Zoe's own question (forward_reason 'zoe_question', or a question mark near the
--    end of the stored text): an open danger-sign or clarifying question is not an answer (Astra ZA-01);
--  * every other run in the window is the same kind of answer, a plain chat reply (not distress or emotional), or an ask
--    ("Shall I send this to your doctor?") that the member declined in the very next run (forward_reason 'member_declined',
--    recorded by the worker from this release; older runs never qualify; Astra ZA-02). Any careful line, urgent route, intake, draft, summary, failure,
--    logistics answer, or forward (auto, the member's yes or request; stale runs included) keeps it in needs reply;
--  * no zoe.forward or zoe.urgent audit in the window, no intake active or finished in it, no photo or over-limit message,
--    no pending draft, no unresolved care alert for the member (any source), and no reopen by the doctor since the last
--    decision.
-- An item leaves "answered by Zoe" when the doctor marks it reviewed (until the next member message), reopens it, or replies.
--
-- 1. _zoe_answered_open(conversation): the decision, or null. 2. doctor_zoe_answered_mark(member, action, version):
--    'reviewed' or 'reopen', written to conversation_audit (inbox.zoe_reviewed / inbox.zoe_reopened) by the assigned
--    doctor, bound to the conversation version they saw. 3. conversation_zoe_answered(): the doctor's "answered by Zoe"
--    list. 4. conversation_awaiting_replies, doctor_ai_inbox (replies lane; new top-level zoeAnswered, the doctor-inbox-v1
--    item kinds unchanged so the running app still parses it) and admin_conversation_list (needsReply) leave answered
--    threads out of needs reply. No clinical rule changes and no member-facing change.

create index conversation_audit_inbox_zoe on public.conversation_audit(conversation_id,kind)
 where kind in('inbox.zoe_reviewed','inbox.zoe_reopened','zoe.forward','zoe.urgent','zoe.answered','zoe.chatted','message.media','message.overflow');

-- 1. The decision ---------------------------------------------------------------------------------------------------------
create function public._zoe_answered_open(p_conversation uuid)returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare c public.conversations;dec bigint;z public.zoe_runs;h jsonb;
begin
 select * into c from public.conversations where id=p_conversation;
 if not found then return null;end if;
 select coalesce(max(d.context_version),0)into dec from public.conversation_drafts d where d.conversation_id=c.id and d.state in('approved','rejected');
 if c.version<=dec then return null;end if;
 -- Zoe's newest run in the window is for the current version and finished: a health answer or a plain chat reply (checked
 -- with every run below).
 select * into z from public.zoe_runs r where r.conversation_id=c.id and r.message_seq>dec order by r.message_seq desc limit 1;
 if not found or z.context_version<>c.version or z.state<>'finished'or z.outcome not in('answered','chatted')then return null;end if;
 -- Zoe's newest health answer in the window with nothing sent to the doctor.
 select * into z from public.zoe_runs r where r.conversation_id=c.id and r.message_seq>dec and r.state='finished'and r.outcome='answered'and r.forward='none'
  order by r.message_seq desc limit 1;
 if not found then return null;end if;
 -- Astra ZA-01: an answer that ends with Zoe's own question (a danger-sign or clarifying question) leaves the assessment open.
 -- The worker records it (forward_reason zoe_question); the stored text is checked too, for runs written before it did.
 if z.forward_reason='zoe_question'or exists(select 1 from public.zoe_member_answers a where a.run_id=z.id and right(btrim(a.body),300)~'[?？՞]')then return null;end if;
 select au.detail->'health'into h from public.conversation_audit au where au.conversation_id=c.id and au.kind='zoe.answered'and au.detail->>'runId'=z.id::text limit 1;
 if h is null or h->>'forward'is distinct from 'none'or coalesce(h->>'urgency','')not in('none','self_monitoring','planned','doctor_soon')then return null;end if;
 if not exists(select 1 from public.zoe_member_answers a where a.run_id=z.id)then return null;end if;
 -- Every run in the window: a forward of any kind (stale included) keeps the thread with the doctor.
 if exists(select 1 from public.zoe_runs r where r.conversation_id=c.id and r.message_seq>dec and r.forward in('auto','member_yes','member_request'))then return null;end if;
 if exists(select 1 from public.zoe_runs r where r.conversation_id=c.id and r.message_seq>dec and r.outcome is distinct from 'stale'and not(
   -- a health answer with nothing sent, below same day
   (r.state='finished'and r.outcome='answered'and r.forward='none'and exists(select 1 from public.conversation_audit au where au.conversation_id=c.id and au.kind='zoe.answered'
     and au.detail->>'runId'=r.id::text and au.detail#>>'{health,forward}'='none'and au.detail#>>'{health,urgency}'in('none','self_monitoring','planned','doctor_soon')))
   -- Zoe's ask, which the member declined in a later answered run
   or(r.state='finished'and r.outcome='answered'and r.forward='asked'and exists(select 1 from public.conversation_audit au where au.conversation_id=c.id and au.kind='zoe.answered'
     and au.detail->>'runId'=r.id::text and au.detail#>>'{health,urgency}'in('none','self_monitoring','planned','doctor_soon'))
    -- Astra ZA-02: the decline must answer this ask: the very next run in the window (stale ones included) is the no.
    and(select r2.state='finished'and r2.outcome='answered'and r2.forward='none'and r2.forward_reason='member_declined'from public.zoe_runs r2
     where r2.conversation_id=c.id and r2.message_seq>r.message_seq order by r2.message_seq limit 1)is true)
   -- a plain chat reply
   or(r.state='finished'and r.outcome='chatted'and exists(select 1 from public.conversation_audit au where au.conversation_id=c.id and au.kind='zoe.chatted'
     and au.detail->>'runId'=r.id::text and au.detail->>'kind'in('greeting','thanks','how_are_you','capabilities','farewell','identity')))))then return null;end if;
 if exists(select 1 from public.conversation_audit au where au.conversation_id=c.id and(
   (au.kind in('zoe.forward','zoe.urgent')and(au.detail->>'seq')::bigint>dec)
   or(au.kind in('message.media','message.overflow')and(au.detail->>'version')::bigint>dec)
   or(au.kind='inbox.zoe_reopened'and(au.detail->>'version')::bigint>dec)))then return null;end if;
 if exists(select 1 from public.zoe_symptom_intakes i where i.conversation_id=c.id and(i.state='active'or i.last_seq>dec))then return null;end if;
 if exists(select 1 from public.conversation_drafts d where d.conversation_id=c.id and d.state in('pending','info_requested'))then return null;end if;
 if exists(select 1 from public.care_alerts al where al.member_id=c.member_id and al.state<>'resolved')then return null;end if;
 return jsonb_build_object('conversationId',c.id,'memberId',c.member_id,'version',c.version,'runId',z.id,'answeredAt',z.finished_at,'urgency',h->>'urgency',
  'declined',exists(select 1 from public.zoe_runs r where r.conversation_id=c.id and r.message_seq>dec and r.forward_reason='member_declined'),
  'unanswered',(select count(*)from public.conversation_messages m where m.conversation_id=c.id and m.seq>dec),
  'reviewed',exists(select 1 from public.conversation_audit au where au.conversation_id=c.id and au.kind='inbox.zoe_reviewed'and(au.detail->>'version')::bigint>=c.version));
end$$;
revoke all on function public._zoe_answered_open(uuid)from public,anon,authenticated,service_role;
comment on function public._zoe_answered_open(uuid)is
 'Null unless Zoe fully answered the thread''s open window in free mode and nothing in it was forwarded, urgent, flagged, unanswered or reopened (see the migration header). The one rule for "answered by Zoe".';

-- 2. The doctor's review and reopen ---------------------------------------------------------------------------------------
-- Bound to the conversation version the doctor saw: a newer member message returns 'stale' and writes nothing. Under the
-- conversation row lock, which zoe_run_finish and the member's intake also take.
create function public.doctor_zoe_answered_mark(p_member uuid,p_action text,p_version bigint)returns jsonb
language plpgsql security definer set search_path=''as $$
declare who jsonb:=public.real_clinical_staff_identity();me uuid;c public.conversations;st jsonb;
begin
 if who is null or who->>'role'is distinct from 'doctor'then raise insufficient_privilege using message='Assigned doctor session required';end if;
 me:=(who->>'id')::uuid;
 if p_member is null or not exists(select 1 from public.patient_clinical_cases k where k.user_id=p_member and k.assigned_doctor_id=me and public.staff_care_access(k.user_id,me,true))then
  raise insufficient_privilege using message='Assigned doctor session required';end if;
 if p_action is null or p_action not in('reviewed','reopen')or p_version is null then return jsonb_build_object('ok',false,'code','invalid');end if;
 select * into c from public.conversations where member_id=p_member for update;
 if not found then return jsonb_build_object('ok',false,'code','not_answered_by_zoe');end if;
 if c.version<>p_version then return jsonb_build_object('ok',false,'code','stale');end if;
 st:=public._zoe_answered_open(c.id);
 if st is null then return jsonb_build_object('ok',false,'code','not_answered_by_zoe');end if;
 if p_action='reviewed'and(st->>'reviewed')::boolean then return jsonb_build_object('ok',true,'action',p_action,'replayed',true);end if;
 insert into public.conversation_audit(conversation_id,actor_id,kind,detail)
  values(c.id,me,case p_action when 'reviewed'then 'inbox.zoe_reviewed'else 'inbox.zoe_reopened'end,jsonb_build_object('version',c.version,'runId',st->>'runId'));
 perform public._access_audit_record(p_member,'doctor_inbox',case p_action when 'reviewed'then 'zoe_answered.reviewed'else 'zoe_answered.reopen'end);
 return jsonb_build_object('ok',true,'action',p_action,'replayed',false);
end$$;
revoke all on function public.doctor_zoe_answered_mark(uuid,text,bigint)from public,anon,authenticated,service_role;
grant execute on function public.doctor_zoe_answered_mark(uuid,text,bigint)to authenticated;
comment on function public.doctor_zoe_answered_mark(uuid,text,bigint)is
 'The assigned doctor marks a thread Zoe answered as reviewed (it leaves the "answered by Zoe" group until the next member message) or reopens it (back to needs reply until the doctor''s next decision).';

-- 3. The "answered by Zoe" list -------------------------------------------------------------------------------------------
-- The doctor's assigned members (with care access) whose open window Zoe answered and the doctor has not marked reviewed.
create function public.conversation_zoe_answered()returns jsonb
language plpgsql security definer set search_path=''as $$
declare who jsonb:=public.real_clinical_staff_identity();me uuid;items jsonb;
begin
 if who is null or who->>'role'is distinct from 'doctor'then raise insufficient_privilege using message='Assigned doctor session required';end if;
 me:=(who->>'id')::uuid;
 select coalesce(jsonb_agg(x order by x->>'answeredAt'desc,x->>'memberId'),'[]')into items from(
  select q.st||jsonb_build_object('memberName',coalesce(pr.display_name,''),'lastMessageAt',lm.created_at,
   'channel',case when lm.source='telegram_member'then 'telegram'else 'app'end)x
  from(select c.id,c.member_id,public._zoe_answered_open(c.id)st from public.conversations c join public.patient_clinical_cases k on k.user_id=c.member_id
   where k.assigned_doctor_id=me and public.staff_care_access(k.user_id,me,true))q
  left join public.profiles pr on pr.id=q.member_id
  left join lateral(select m.created_at,m.source from public.conversation_messages m where m.conversation_id=q.id order by m.seq desc limit 1)lm on true
  where q.st is not null and not(q.st->>'reviewed')::boolean
  order by q.st->>'answeredAt'desc,q.member_id limit 200)q2;
 perform public._access_audit_record((x->>'memberId')::uuid,'doctor_inbox','zoe_answered')from jsonb_array_elements(items)x;
 return jsonb_build_object('ok',true,'items',items);
end$$;
revoke all on function public.conversation_zoe_answered()from public,anon,authenticated,service_role;
grant execute on function public.conversation_zoe_answered()to authenticated;
comment on function public.conversation_zoe_answered()is
 'The assigned doctor''s threads that Zoe fully answered (free mode, nothing forwarded or urgent) and that they have not marked reviewed. Each member shown is recorded in access_audit.';

-- 4. The lists leave answered threads out of needs reply ----------------------------------------------------------------
-- doctor_ai_inbox (from 20261019075018; changes marked "Part 2"): the replies source, the zoeAnswered group, the access record.
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
    'lane',case when q.reason='not_delivered'or q.judgement or q.since<clock_timestamp()-interval '24 hours'then 'P1'else 'P3'end,
    'kind',case when q.reason='not_delivered'then 'reply_not_delivered'when q.since<clock_timestamp()-interval '24 hours'then 'reply_overdue'else 'reply_draft'end,
    'rank',case when q.reason='not_delivered'then 5 when q.judgement or q.since<clock_timestamp()-interval '24 hours'then 4 else 0 end,
    'at',case when q.reason='not_delivered'then q.delivered_at else q.since end,
    'confidence',case when q.reason='not_delivered'then 'rule'when q.draft_id is null or q.stale or(q.run_id is not null and not q.plan_current)then 'L'else 'M'end,
    'ai',case when q.reason='not_delivered'or q.draft_id is null then 'none'else 'draft'end,
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
     s.run_id,s.version s_version,s.plan_id,s.quoted,s.asked,s.acknowledgement_id ack_id,s.needs_judgement,s.outside_plan,s.judgement_reasons,s.doctor_decides,
     (select count(*)from public.conversation_messages m2 where m2.conversation_id=c.id and m2.seq>coalesce(dec.v,0))::int unanswered,
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
-- create or replace keeps doctor_ai_inbox's grants (authenticated).

-- conversation_awaiting_replies (from 20261017184839; changes marked "Part 2").
create or replace function public.conversation_awaiting_replies()returns jsonb
language plpgsql security definer set search_path=''as $$
declare who jsonb:=public.real_clinical_staff_identity();
begin
 if who is null or who->>'role'<>'doctor'then raise insufficient_privilege;end if;
 return jsonb_build_object('ok',true,'items',coalesce((select jsonb_agg(item order by item->>'reason',item->>'lastMessageAt')from(
  select jsonb_build_object('memberId',cs.user_id,'memberName',coalesce(pr.display_name,''),'lastMessageAt',greatest(lm.created_at,lmed.at),'unanswered',
   (select count(*)from public.conversation_messages m2 where m2.conversation_id=c.id and m2.seq>coalesce(dec.v,0)),
   'latestDelivery',ld.state,'latestReason',ld.reason,
   'reason',case when c.version>coalesce(dec.v,0)and zst.st is null then 'new_message'else 'not_delivered'end,
   'mediaPending',exists(select 1 from public.conversation_audit au where au.conversation_id=c.id and au.kind='message.media'and(au.detail->>'version')::bigint>coalesce(dec.v,0)),
   'overLimit',exists(select 1 from public.conversation_audit au where au.conversation_id=c.id and au.kind='message.overflow'and(au.detail->>'version')::bigint>coalesce(dec.v,0)),
   'channel',case when lm.source='telegram_member'or(lm.source is null and lmed.at is not null)or lmed.at>lm.created_at then 'telegram'else 'app'end)as item
  from public.patient_clinical_cases cs join public.conversations c on c.member_id=cs.user_id
  left join public.profiles pr on pr.id=cs.user_id
  -- A conversation may start with a message the bot cannot read: no stored message row.
  left join lateral(select m.seq,m.created_at,m.source from public.conversation_messages m where m.conversation_id=c.id order by m.seq desc limit 1)lm on true
  left join lateral(select max(au.created_at)at from public.conversation_audit au where au.conversation_id=c.id and au.kind='message.media')lmed on true
  left join lateral(select max(d.context_version)v from public.conversation_drafts d where d.conversation_id=c.id and d.state in('approved','rejected'))dec on true
  left join lateral(select dl.state,dl.reason,dl.created_at,dl.approval_id from public.conversation_deliveries dl where dl.conversation_id=c.id order by dl.created_at desc,dl.id desc limit 1)ld on true
  -- Part 2 (20261020060842): a thread Zoe fully answered waits in conversation_zoe_answered instead; an undelivered reply stays here.
  left join lateral(select public._zoe_answered_open(c.id)st)zst on true
  -- The conversation version moves with every member message, stored or over the
  -- intake limit, so a message that was not saved still puts the member on the list.
  -- An undelivered last reply stays listed for 30 days.
  where cs.assigned_doctor_id=(who->>'id')::uuid and((c.version>coalesce(dec.v,0)and zst.st is null)
   or(ld.created_at>clock_timestamp()-interval '30 days'and(ld.state in('definitely_failed','unknown')or(ld.state='held'and ld.reason is distinct from 'newer_member_message'
     -- A member with no Telegram who has the reply in the app chat (released to them, F2).
     and not(ld.reason='route_policy_missing'and exists(select 1 from public.conversation_app_releases r where r.approval_id=ld.approval_id))))
    -- A later decision (for example rejecting a draft as no reply needed) clears it.
    and not exists(select 1 from public.conversation_drafts d2 where d2.conversation_id=c.id and d2.state='rejected'and d2.created_at>ld.created_at))))q),'[]'));
end$$;

-- admin_conversation_list (from 20261018160427; change marked "Part 2").
create or replace function public.admin_conversation_list(p_filter text default null)returns jsonb
language plpgsql security definer set search_path=''as $$
declare a uuid:=public._real_staff_require_admin();since timestamptz;
begin
 if p_filter is not null and p_filter not in('needs_reply','intake_active','urgent_today')then raise invalid_parameter_value;end if;
 if not public._admin_conversation_read_on()then return jsonb_build_object('ok',true,'enabled',false,'items','[]'::jsonb);end if;
 -- "Today" is the Yerevan calendar day.
 since:=date_trunc('day',clock_timestamp()at time zone 'Asia/Yerevan')at time zone 'Asia/Yerevan';
 insert into public.access_audit(actor_id,actor_role,member_id,surface,object_id,session_id)
  values(a,'admin',null,'conversation.list.admin',p_filter,left(auth.jwt()->>'session_id',80));
 return jsonb_build_object('ok',true,'enabled',true,'items',coalesce((select jsonb_agg(jsonb_build_object(
   'memberId',q.member_id,'memberName',q.member_name,'doctorName',q.doctor_name,'lastActivityAt',q.last_at,
   'lastMemberMessageAt',q.last_member_at,'channel',q.channel,'needsReply',q.needs_reply,'intakeActive',q.intake_active,'urgentToday',q.urgent_today)
   order by q.last_at desc nulls last,q.member_id)
  from(select x.* from(
   select c.member_id,coalesce(pr.display_name,'')member_name,doc.display_name doctor_name,lm.created_at last_member_at,
    case when lm.source='telegram_member'then 'telegram'when lm.source is not null then 'app'end channel,
    greatest(lm.created_at,la.at,lp.at)last_at,
    -- Part 2 (20261020060842): not when Zoe fully answered the thread.
    c.version>coalesce(dec.v,0)and public._zoe_answered_open(c.id)is null needs_reply,
    exists(select 1 from public.zoe_symptom_intakes i where i.conversation_id=c.id and i.state='active')intake_active,
    (exists(select 1 from public.care_alerts al where al.member_id=c.member_id and(al.created_at>=since or al.last_seen_at>=since))
     or exists(select 1 from public.zoe_member_answers za where za.conversation_id=c.id and za.kind='urgent'and za.created_at>=since)
     or exists(select 1 from public.zoe_runs zr where zr.conversation_id=c.id and zr.finished_at>=since
      and(zr.outcome='intake_escalated'or zr.reason_code like 'urgent%')))urgent_today
   from public.conversations c
   left join public.profiles pr on pr.id=c.member_id
   left join public.patient_clinical_cases cs on cs.user_id=c.member_id
   left join public.workspace_staff doc on doc.user_id=cs.assigned_doctor_id
   left join lateral(select m.created_at,m.source from public.conversation_messages m where m.conversation_id=c.id order by m.seq desc limit 1)lm on true
   left join lateral(select max(za.created_at)at from public.zoe_member_answers za where za.conversation_id=c.id)la on true
   left join lateral(select max(ap.created_at)at from public.conversation_approvals ap join public.conversation_drafts d on d.id=ap.draft_id where d.conversation_id=c.id)lp on true
   left join lateral(select max(d.context_version)v from public.conversation_drafts d where d.conversation_id=c.id and d.state in('approved','rejected'))dec on true
  )x where(p_filter is null or(p_filter='needs_reply'and x.needs_reply)or(p_filter='intake_active'and x.intake_active)or(p_filter='urgent_today'and x.urgent_today))
  order by x.last_at desc nulls last,x.member_id limit 200)q),'[]'::jsonb));
end$$;
