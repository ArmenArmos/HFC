-- Doctor inbox: Zoe's structured reply drafts (#323) in the Today inbox (#327), and the reason for a rejected draft.
-- 1. doctor_ai_inbox: the replies source carries the pending draft's exact text, revision, content hash and sources, a
--    question whose draft needs the doctor's judgement is P1 at any age, and the item says whether it may be approved
--    from the inbox. The item kinds and the doctor-inbox-v1 envelope are unchanged (Astra ID-02: the app deploys after
--    the migration, so the running app must still parse every item). Still read only.
-- 2. conversation_draft_reject_reason: the rejecting doctor's reason, written to the existing conversation trace.
-- 3. doctor_inbox_approve: the inbox's one-tap Approve. It re-checks the inbox eligibility (structured, no judgement,
--    plan still published, no unresolved care alert) under a per-member lock that every care alert write also takes,
--    then calls the unchanged conversation_command in the same transaction (Astra ID-01).

-- 1. The inbox ---------------------------------------------------------------------------------------------------
create or replace function public.doctor_ai_inbox()returns jsonb
language plpgsql security definer set search_path=''as $$
declare
 who jsonb:=public.real_clinical_staff_identity();
 me uuid;
 today date:=public._programme_today(clock_timestamp());
 p0 jsonb:='[]';items jsonb:='[]';part jsonb;missing text[]:='{}';
 p0_total integer;p0_cap constant integer:=200;lane_cap constant integer:=50;
 members uuid[];
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
     case when c.version>coalesce(dec.v,0)then 'new_message'
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

 -- Names, lane order, caps. The order is lane, rank, age (oldest first), id; check:doctor-ai-inbox pins it.
 select coalesce(jsonb_agg(x||jsonb_build_object('memberName',coalesce(pr.display_name,''))order by x->>'lane',(x->>'rank')::int,(x->>'at')::timestamptz,x->>'id'),'[]')into items
 from(select x,row_number()over(partition by x->>'lane'order by(x->>'rank')::int,(x->>'at')::timestamptz,x->>'id')n from jsonb_array_elements(items)x)q
 left join public.profiles pr on pr.id=(x->>'memberId')::uuid where n<=lane_cap;
 select coalesce(jsonb_agg(x||jsonb_build_object('memberName',coalesce(x#>>'{alert,memberName}',''))order by(x->>'rank')::int,(x->>'at')::timestamptz,x->>'id'),'[]')into p0
 from jsonb_array_elements(p0)x;

 -- One access record per member shown, as other doctor reads.
 perform public._access_audit_record(mid,'doctor_inbox',null)
 from(select distinct(x->>'memberId')::uuid mid from jsonb_array_elements(p0||items)x)q;

 return jsonb_build_object('version','doctor-inbox-v1','ok',true,'asOf',clock_timestamp(),
  'p0',p0,'p0Total',p0_total,'items',items,'laneCap',lane_cap,'unavailable',to_jsonb(missing));
end$$;

-- 2. The reason for a rejected reply draft (AI_FIRST_OPERATIONS §2 rule 4: one reason from a fixed list plus optional
-- free text). It is written to the existing conversation trace next to draft.rejected, as event draft.reject_reason, so
-- the reply drafts' approve / edit / reject counts and their reasons come from one journal. Only the doctor who rejected
-- the draft (the consumed reply.reject intent is theirs), while still the member's assigned doctor, may record it, once.
-- Nothing here changes the draft or reaches the member.
create function public.conversation_draft_reject_reason(p_draft uuid,p_reason text,p_note text default null)returns jsonb
language plpgsql security definer set search_path=''as $$
declare who jsonb:=public.real_clinical_staff_identity();me uuid;d public.conversation_drafts;c public.conversations;s public.zoe_reply_drafts;note text;
begin
 if who is null or who->>'role'is distinct from 'doctor'then raise insufficient_privilege using message='Assigned doctor session required';end if;
 me:=(who->>'id')::uuid;
 select * into d from public.conversation_drafts where id=p_draft for update;
 if not found then raise insufficient_privilege using message='Assigned doctor session required';end if;
 select * into c from public.conversations where id=d.conversation_id;
 if not exists(select 1 from public.patient_clinical_cases k where k.user_id=c.member_id and k.assigned_doctor_id=me and public.staff_care_access(k.user_id,me,true))then
  raise insufficient_privilege using message='Assigned doctor session required';end if;
 if coalesce(p_reason,'')not in('incorrect','unsafe','not_answered','tone_or_language','prefer_own_words','plan_changed','other')then
  return jsonb_build_object('ok',false,'code','reason_invalid');end if;
 note:=nullif(btrim(coalesce(p_note,'')),'');
 if length(note)>500 or(p_reason='other'and note is null)then return jsonb_build_object('ok',false,'code','note_invalid');end if;
 if d.state<>'rejected'or not exists(select 1 from public.conversation_intents i where i.draft_id=d.id and i.purpose='reply.reject'and i.state='consumed'and i.actor_id=me)then
  return jsonb_build_object('ok',false,'code','draft_not_rejected_by_you');end if;
 if exists(select 1 from public.conversation_trace_events e where e.conversation_id=c.id and e.subject_kind='conversation_draft'and e.subject_id=d.id::text and e.name='draft.reject_reason')then
  return jsonb_build_object('ok',true,'replayed',true);end if;
 select zr.* into s from public.zoe_runs z join public.zoe_reply_drafts zr on zr.run_id=z.id where z.draft_id=d.id order by zr.created_at desc limit 1;
 if not public._conversation_trace(c.member_id,c.id,'conversation_draft',d.id::text,'draft','draft.reject_reason','recorded',p_reason,'reply_draft.reject_reason','v1','doctor',me,
  jsonb_build_object('noreon.draft.revision',d.revision,'noreon.draft.structured',s.run_id is not null,'noreon.draft.version',s.version,
   'noreon.draft.acknowledgement_id',s.acknowledgement_id,'noreon.draft.needs_judgement',s.needs_judgement,'noreon.reject.note',note))then
  return jsonb_build_object('ok',false,'code','not_recorded');end if;
 return jsonb_build_object('ok',true,'replayed',false);
end$$;
revoke all on function public.conversation_draft_reject_reason(uuid,text,text)from public,anon,authenticated,service_role;
grant execute on function public.conversation_draft_reject_reason(uuid,text,text)to authenticated;
comment on function public.conversation_draft_reject_reason(uuid,text,text)is
 'The rejecting doctor records why a reply draft was rejected (fixed reason, optional note) as trace event draft.reject_reason. Feeds the reply-draft acceptance counts.';

-- 3. One-tap Approve from the inbox (Astra ID-01) ----------------------------------------------------------------------
-- Every write that raises, reopens or resolves a care alert takes a per-member transaction lock first. The inbox
-- approval takes the same lock before it looks for unresolved alerts, so an alert and an approval for one member are
-- serialized: either the alert is committed and visible (the approval is refused), or the approval commits first and
-- the alert follows it.
create function public._care_alert_member_lock()returns trigger language plpgsql security definer set search_path=''as $$
begin perform pg_advisory_xact_lock(hashtextextended('care-alert-member:'||new.member_id::text,0));return new;end$$;
revoke all on function public._care_alert_member_lock()from public,anon,authenticated,service_role;
create trigger care_alert_member_lock before insert or update of state on public.care_alerts for each row execute function public._care_alert_member_lock();

-- The command is the existing reply.approve command (intent from conversation_actions); conversation_command
-- re-checks actor, grant, assignment, revision, conversation, clinical context and content hash, and queues delivery.
create function public.doctor_inbox_approve(p_member uuid,p_command jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare who jsonb:=public.real_clinical_staff_identity();me uuid;i public.conversation_intents;d public.conversation_drafts;c public.conversations;s public.zoe_reply_drafts;cur uuid;
begin
 if who is null or who->>'role'is distinct from 'doctor'then raise insufficient_privilege using message='Assigned doctor session required';end if;
 me:=(who->>'id')::uuid;
 if p_member is null or not exists(select 1 from public.patient_clinical_cases k where k.user_id=p_member and k.assigned_doctor_id=me and public.staff_care_access(k.user_id,me,true))then
  raise insufficient_privilege using message='Assigned doctor session required';end if;
 if jsonb_typeof(p_command)is distinct from 'object'or p_command->>'purpose'is distinct from 'reply.approve'
  or coalesce(p_command->>'intentId','')!~'^[A-Fa-f0-9-]{32,36}$'then return jsonb_build_object('ok',false,'code','invalid_command');end if;
 perform pg_advisory_xact_lock(hashtextextended('care-alert-member:'||p_member::text,0));
 select * into i from public.conversation_intents where id=(p_command->>'intentId')::uuid;
 if not found then return jsonb_build_object('ok',false,'code','intent_unknown');end if;
 select * into d from public.conversation_drafts where id=i.draft_id;
 select * into c from public.conversations where id=d.conversation_id;
 if c.member_id is distinct from p_member then return jsonb_build_object('ok',false,'code','intent_wrong_member');end if;
 if exists(select 1 from public.care_alerts a where a.member_id=p_member and a.state<>'resolved')then return jsonb_build_object('ok',false,'code','open_alert');end if;
 select zr.* into s from public.zoe_runs z join public.zoe_reply_drafts zr on zr.run_id=z.id where z.draft_id=d.id order by zr.created_at desc limit 1;
 if s.run_id is null or s.needs_judgement or s.outside_plan then return jsonb_build_object('ok',false,'code','not_inbox_approvable');end if;
 select p.plan_id into cur from public.patient_care_plans plan join public.patient_clinical_publications p on p.plan_id=plan.id and p.user_id=plan.user_id
  where plan.user_id=p_member and plan.active and plan.published_at<=now()and p.published_at<=now()order by p.published_at desc limit 1;
 if s.plan_id is distinct from cur then return jsonb_build_object('ok',false,'code','plan_changed');end if;
 return public.conversation_command(p_command);
exception when invalid_text_representation then return jsonb_build_object('ok',false,'code','invalid_command');
end$$;
revoke all on function public.doctor_inbox_approve(uuid,jsonb)from public,anon,authenticated,service_role;
grant execute on function public.doctor_inbox_approve(uuid,jsonb)to authenticated;
comment on function public.doctor_inbox_approve(uuid,jsonb)is
 'One-tap Approve from the doctor''s Today inbox: inbox eligibility re-checked under the member''s care-alert lock, then the existing conversation_command (reply.approve).';
