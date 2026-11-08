-- N1/N2: nurse-authored in-app replies on the member's existing conversation.
-- App entry points require NOREON_NURSE_CHAT exactly true. Database authority is
-- always current assignment + live staff session, using the same locks as doctor replies.
-- No doctor approval, takeover, alert state, Telegram delivery or Zoe input is created here.
-- The DB switch also fences direct RPC calls; the environment flag alone cannot.
create table public.nurse_chat_settings (
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false
);
alter table public.nurse_chat_settings enable row level security;
revoke all on public.nurse_chat_settings from public,anon,authenticated,service_role;
create trigger nurse_chat_settings_config_audit after insert or update or delete on public.nurse_chat_settings
 for each row execute function public._config_audit_row('singleton');
insert into public.nurse_chat_settings(singleton)values(true);

create table public.conversation_nurse_replies (
 id uuid primary key default gen_random_uuid(),
 conversation_id uuid not null references public.conversations(id),
 nurse_id uuid not null references auth.users(id),
 nurse_name text not null,
 doctor_id uuid not null references auth.users(id),
 request_id uuid not null,
 context_version bigint not null check(context_version>=0),
 body text not null check(public._conversation_utf16(body) between 1 and 4096 and body~'[^[:space:]]'),
 created_at timestamptz not null default clock_timestamp(),
 unique(nurse_id,request_id)
);
create index conversation_nurse_replies_history on public.conversation_nurse_replies(conversation_id,created_at,id);
alter table public.conversation_nurse_replies enable row level security;
-- Deliberately no direct table policy: all access goes through the authorized RPCs.
revoke all on public.conversation_nurse_replies from public,anon,authenticated,service_role;
create trigger conversation_nurse_replies_immutable before update or delete on public.conversation_nurse_replies
 for each row execute function public._conversation_immutable();

create function public._conversation_nurse_replies(p_conversation uuid)returns jsonb
language sql stable security definer set search_path=''as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'text',r.body,'at',r.created_at,
  'senderName',r.nurse_name,'senderRole','nurse')order by r.created_at,r.id),'[]'::jsonb)
 from public.conversation_nurse_replies r where r.conversation_id=p_conversation
$$;
revoke all on function public._conversation_nurse_replies(uuid)from public,anon,authenticated,service_role;

create function public.conversation_nurse_workspace(p_member uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare a jsonb;c public.conversations;member_name text;doctor_name text;items jsonb;
begin
 perform 1 from public.nurse_chat_settings where singleton and enabled for share nowait;
 if not found then return jsonb_build_object('ok',false,'code','off');end if;
 a:=public._conversation_user(p_member,false);
 if a#>>'{doctor,role}'is distinct from 'nurse'then raise insufficient_privilege;end if;
 select * into c from public.conversations where member_id=p_member;
 select p.display_name into member_name from public.profiles p where p.id=p_member;
 select s.display_name into doctor_name from public.patient_clinical_cases pc join public.workspace_staff s on s.user_id=pc.assigned_doctor_id where pc.user_id=p_member;
 -- Only member-visible conversation material, never private doctor drafts or model traces.
 select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'text',q.body,'at',q.created_at,'senderName',q.name,'senderRole',q.role)order by q.created_at,q.id),'[]')into items from(
  select 'm'||m.seq::text id,m.body,m.created_at,coalesce(member_name,'') name,'member' role from public.conversation_messages m where m.conversation_id=c.id
  union all
  select ap.id::text,ap.body,ap.created_at,ap.doctor_name,'doctor' from public.conversation_approvals ap
   left join public.conversation_deliveries dl on dl.approval_id=ap.id
   where exists(select 1 from public.conversation_drafts d where d.id=ap.draft_id and d.conversation_id=c.id)
    and(dl.state in('accepted_by_provider','unknown')or exists(select 1 from public.conversation_app_releases ar where ar.approval_id=ap.id))
  union all
  select r.id::text,r.body,r.created_at,r.nurse_name,'nurse' from public.conversation_nurse_replies r where r.conversation_id=c.id
  union all
  select z.id::text,z.body,z.created_at,'Zoe','zoe' from public.zoe_member_answers z left join public.system_messages sm on sm.id=z.system_message_id
   where z.conversation_id=c.id and not coalesce(sm.state='held'and sm.reason in('template_unapproved','template_changed','template_withdrawn'),false)
  union all
  select n.id::text,n.body,n.created_at,'Zoe','zoe' from public.zoe_mode_notices n where n.conversation_id=c.id
 )q;
 perform public._access_audit_record(p_member,'member_messages',null);
 return jsonb_build_object('ok',true,'memberId',p_member,'memberName',coalesce(member_name,''),'doctorName',coalesce(doctor_name,''),
  'unsupportedMedia',exists(select 1 from public.conversation_audit au where au.conversation_id=c.id and au.kind='message.media'
   and(au.detail->>'version')::bigint>coalesce((select max(d.context_version)from public.conversation_drafts d where d.conversation_id=c.id and d.state in('approved','rejected')),0)),
  'unsavedOverLimit',exists(select 1 from public.conversation_audit au where au.conversation_id=c.id and au.kind='message.overflow'
   and(au.detail->>'version')::bigint>coalesce((select max(d.context_version)from public.conversation_drafts d where d.conversation_id=c.id and d.state in('approved','rejected')),0)),
  'version',coalesce(c.version,0),'canSend',coalesce((select app_chat_enabled from public.conversation_policy where singleton),false),'items',items);
exception when insufficient_privilege then return jsonb_build_object('ok',false,'code','denied');
 when lock_not_available then return jsonb_build_object('ok',false,'code','unavailable');
end$$;
revoke all on function public.conversation_nurse_workspace(uuid)from public,anon,authenticated,service_role;
grant execute on function public.conversation_nurse_workspace(uuid)to authenticated;

create function public.conversation_nurse_reply(p_member uuid,p_request_id uuid,p_expected_version bigint,p_body text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare a jsonb;c public.conversations;r public.conversation_nurse_replies;doc uuid;
begin
 perform 1 from public.nurse_chat_settings where singleton and enabled for share nowait;
 if not found then return jsonb_build_object('ok',false,'code','off');end if;
 if p_request_id is null or p_expected_version is null or p_expected_version<0 or p_body is null
  or public._conversation_utf16(p_body)not between 1 and 4096 or p_body!~'[^[:space:]]'then return jsonb_build_object('ok',false,'code','invalid');end if;
 perform pg_advisory_xact_lock(hashtextextended('conversation-command:'||auth.uid()::text||':'||p_request_id::text,0));
 -- Check before replay too: reassignment, a removed nurse, ended session or revoked grant refuses a retry.
 a:=public._conversation_user(p_member,false);
 if a#>>'{doctor,role}'is distinct from 'nurse'then raise insufficient_privilege;end if;
 select * into r from public.conversation_nurse_replies where nurse_id=auth.uid()and request_id=p_request_id;
 if found then
  if r.conversation_id is distinct from(select id from public.conversations where member_id=p_member)
   or r.context_version is distinct from p_expected_version or r.body is distinct from p_body then return jsonb_build_object('ok',false,'code','request_conflict');end if;
  return jsonb_build_object('ok',true,'replyId',r.id,'replayed',true);
 end if;
 -- No false delivery promise: these replies publish in the app, which must be available.
 if not coalesce((select app_chat_enabled from public.conversation_policy where singleton),false)then return jsonb_build_object('ok',false,'code','unavailable');end if;
 insert into public.conversations(member_id)values(p_member)on conflict(member_id)do nothing;
 select * into c from public.conversations where member_id=p_member for update;
 if c.version<>p_expected_version then return jsonb_build_object('ok',false,'code','stale_context');end if;
 select assigned_doctor_id into doc from public.patient_clinical_cases where user_id=p_member;
 insert into public.conversation_nurse_replies(conversation_id,nurse_id,nurse_name,doctor_id,request_id,context_version,body)
 values(c.id,auth.uid(),a#>>'{doctor,displayName}',doc,p_request_id,c.version,p_body)returning * into r;
 -- Claim and finish take this same conversation lock. Fence already-claimed ordinary
 -- Zoe answers with the existing staff-work epoch; urgent output and doctor mode
 -- keep their existing rules. A replay returns above, so it cannot advance twice.
 update public.conversations set draft_epoch=draft_epoch+1 where id=c.id;
 insert into public.conversation_audit(conversation_id,actor_id,kind,detail)values(c.id,auth.uid(),'nurse.reply_sent',
  jsonb_build_object('replyId',r.id,'requestId',p_request_id,'doctorId',doc,'contextVersion',c.version,'channel','app'));
 return jsonb_build_object('ok',true,'replyId',r.id,'replayed',false);
exception when insufficient_privilege then return jsonb_build_object('ok',false,'code','denied');
 when lock_not_available then return jsonb_build_object('ok',false,'code','unavailable');
end$$;
revoke all on function public.conversation_nurse_reply(uuid,uuid,bigint,text)from public,anon,authenticated,service_role;
grant execute on function public.conversation_nurse_reply(uuid,uuid,bigint,text)to authenticated;

-- Preserve the member's exact existing eligibility, release, urgent and topic behavior.
alter function public.conversation_member_thread()rename to conversation_member_thread_before_nurse;
revoke all on function public.conversation_member_thread_before_nurse()from public,anon,authenticated,service_role;
create function public.conversation_member_thread()returns jsonb
language plpgsql security definer set search_path=''as $$
declare r jsonb;replies jsonb;
begin
 r:=public.conversation_member_thread_before_nurse();
 if r->>'ok'='true'then
  replies:=public._conversation_nurse_replies((select id from public.conversations where member_id=auth.uid()));
  if jsonb_array_length(replies)>0 then r:=r||jsonb_build_object('nurseReplies',replies);end if;
 end if;
 return r;
end$$;
revoke all on function public.conversation_member_thread()from public,anon,authenticated,service_role;
grant execute on function public.conversation_member_thread()to authenticated;

-- Responsible doctor sees the same frozen nurse attribution; doctor authority is unchanged.
create or replace function public.conversation_workspace(p_member uuid default null)returns jsonb
language plpgsql security definer set search_path=''as $$
declare r jsonb;replies jsonb;
begin
 r:=public.conversation_workspace_unlogged(p_member);
 if r is not null and coalesce(r->>'enabled','true')<>'false'then perform public._access_audit_record(p_member,'member_messages',null);end if;
 if r?'conversationId'then
  replies:=public._conversation_nurse_replies((r->>'conversationId')::uuid);
  if jsonb_array_length(replies)>0 then r:=r||jsonb_build_object('nurseReplies',replies);end if;
 end if;
 return r;
end$$;

-- Start from 20261031134000_urgent_reach: retain same-day forwards and every existing lane.
create or replace function public.doctor_ai_inbox()returns jsonb
language plpgsql security definer set search_path=''as $$
declare
 who jsonb:=public.real_clinical_staff_identity();
 me uuid;
 today date:=public._programme_today(clock_timestamp());
 p0 jsonb:='[]';items jsonb:='[]';part jsonb;missing text[]:='{}';
 p0_total integer;p0_cap constant integer:=200;lane_cap constant integer:=50;
 members uuid[];za jsonb:='[]';za_total integer:=0;nurse_activity jsonb:='[]';
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

 -- Recent nurse activity is information, not a clinical decision or a closed reply.
 -- Keep it separate from the existing item kinds, so an older app can still parse the lanes.
 begin
  select coalesce(jsonb_agg(x order by x->>'at'desc,x->>'id'),'[]')into nurse_activity from(
   select jsonb_build_object('id',r.id,'memberId',c.member_id,'memberName',coalesce(pr.display_name,''),
    'text',r.body,'at',r.created_at,'senderName',r.nurse_name,'senderRole','nurse')x
   from public.conversation_nurse_replies r join public.conversations c on c.id=r.conversation_id
   left join public.profiles pr on pr.id=c.member_id
   where c.member_id=any(members)and r.created_at>=clock_timestamp()-interval '24 hours'
   order by r.created_at desc,r.id limit lane_cap)q;
 exception when others then missing:=array_append(missing,'nurse_activity');end;

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
 from(select distinct(x->>'memberId')::uuid mid from jsonb_array_elements(p0||items||za||nurse_activity)x)q;

 return jsonb_build_object('version','doctor-inbox-v1','ok',true,'asOf',clock_timestamp(),
  'p0',p0,'p0Total',p0_total,'items',items,'laneCap',lane_cap,'unavailable',to_jsonb(missing),'zoeAnswered',za,'zoeAnsweredTotal',za_total,'nurseActivity',nurse_activity);
end$$;
