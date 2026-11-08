-- Admin conversation reading (Khikar, 18 Oct 16:12): active Noreon admins may read any member's
-- conversation, read-only, for oversight of the AI-first service. Every open is recorded.
--
-- 1. admin_oversight_settings.admin_conversation_read_enabled: the switch, default off. Changes are
--    recorded in config_audit. Before real members it stays off until the privacy notice names admin
--    reading and legal (P16/P21 family) covers it (output/GO_LIVE_GATES.md).
-- 2. admin_conversation_read(member, before): one consistent time window of one member's conversation: member messages from both
--    channels, Zoe answers of every kind, doctor replies with delivery state, drafts with their states,
--    Zoe runs, symptom intake summaries and the decision trace. Writes one access_audit row
--    (conversation.read.admin) before it returns anything.
-- 3. admin_conversation_list(filter): members with a conversation, newest activity first, with flags
--    (needs reply, Zoe intake active, urgent today) and times, never message text. Recorded too
--    (conversation.list.admin, no member).
-- 4. admin_conversation_read_enabled(): whether to show the backoffice link. A bit, no data.
-- The doctor functions are unchanged: nothing here widens conversation_workspace, zoe_runs_for_doctor
-- or zoe_symptom_intakes_for_doctor, and nothing here writes to a conversation.

-- 1. Switch -----------------------------------------------------------------------------------------
create table public.admin_oversight_settings(
 singleton boolean primary key default true check(singleton),
 admin_conversation_read_enabled boolean not null default false,
 updated_at timestamptz not null default clock_timestamp()
);
insert into public.admin_oversight_settings(singleton)values(true);
alter table public.admin_oversight_settings enable row level security;
revoke all on public.admin_oversight_settings from public,anon,authenticated,service_role;
create trigger admin_oversight_settings_config_audit after insert or update or delete on public.admin_oversight_settings
 for each row execute function public._config_audit_row('singleton','updated_at');

create function public._admin_conversation_read_on()returns boolean
language sql stable security definer set search_path=''as $$
 select coalesce((select s.admin_conversation_read_enabled from public.admin_oversight_settings s where s.singleton),false)
$$;
revoke all on function public._admin_conversation_read_on()from public,anon,authenticated,service_role;

-- 4. Link visibility: true only for an active admin while the switch is on. Never raises.
create function public.admin_conversation_read_enabled()returns boolean
language sql stable security definer set search_path=''as $$
 select public._admin_conversation_read_on() and exists(select 1 from public.workspace_staff s
  where s.user_id=auth.uid() and s.role='admin' and s.active and s.removed_at is null)
$$;
revoke all on function public.admin_conversation_read_enabled()from public,anon,authenticated,service_role;
grant execute on function public.admin_conversation_read_enabled()to authenticated;

-- 3. List ---------------------------------------------------------------------------------------------
create function public.admin_conversation_list(p_filter text default null)returns jsonb
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
    c.version>coalesce(dec.v,0)needs_reply,
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
revoke all on function public.admin_conversation_list(text)from public,anon,authenticated,service_role;
grant execute on function public.admin_conversation_list(text)to authenticated;

-- 2. Read -------------------------------------------------------------------------------------------
-- One page is one time window, so the thread is consistent: the newest 200 member messages before
-- p_before (all of them when fewer), and every Zoe answer, doctor reply and draft in the same window.
-- 'olderBefore' is the cursor for the previous window, null when nothing older exists. Each page is
-- one recorded read (object_id 'before=<cursor>' for older pages). Zoe runs, intakes and the trace are
-- the latest ones, with their totals, so the screen can say when it shows only part of them.
create function public.admin_conversation_read(p_member uuid,p_before timestamptz default null)returns jsonb
language plpgsql security definer set search_path=''as $$
declare a uuid:=public._real_staff_require_admin();c public.conversations;upto timestamptz:=coalesce(p_before,'infinity');since timestamptz:='-infinity';n int;older boolean;
 lo bigint;hi bigint;
begin
 if p_member is null then raise invalid_parameter_value;end if;
 if not public._admin_conversation_read_on()then return jsonb_build_object('ok',false,'code','disabled');end if;
 if not exists(select 1 from public.patient_clinical_cases where user_id=p_member)then return jsonb_build_object('ok',false,'code','not_found');end if;
 -- Recorded before anything is read, in the same transaction as the read.
 insert into public.access_audit(actor_id,actor_role,member_id,surface,object_id,session_id)
  values(a,'admin',p_member,'conversation.read.admin',case when p_before is not null then left('before='||p_before::text,200)end,left(auth.jwt()->>'session_id',80));
 select * into c from public.conversations where member_id=p_member;
 select count(*),min(x.created_at),min(x.seq),max(x.seq)into n,since,lo,hi from(select m.created_at,m.seq from public.conversation_messages m
  where m.conversation_id=c.id and m.created_at<upto order by m.seq desc limit 200)x;
 if n<200 then since:='-infinity';lo:=null;end if;
 -- Zoe answers go with the message they answer (review F1 follow-up: an urgent answer may come after
 -- newer messages), so the window is the messages' seq range, not the answers' own time.
 if p_before is null then hi:=null;end if;
 older:=since>'-infinity'and(exists(select 1 from public.conversation_messages m where m.conversation_id=c.id and m.created_at<since)
  or exists(select 1 from public.zoe_member_answers za where za.conversation_id=c.id and za.message_seq<lo)
  or exists(select 1 from public.conversation_drafts d where d.conversation_id=c.id and d.created_at<since));
 return jsonb_build_object('ok',true,'memberId',p_member,'asOf',statement_timestamp(),
  'memberName',coalesce((select display_name from public.profiles where id=p_member),''),
  'doctorName',(select ws.display_name from public.patient_clinical_cases cs join public.workspace_staff ws on ws.user_id=cs.assigned_doctor_id where cs.user_id=p_member),
  'conversationId',c.id,
  'window',jsonb_build_object('before',p_before,'from',case when since>'-infinity'then since end,'olderBefore',case when older then since end),
  'messages',coalesce((select jsonb_agg(jsonb_build_object('seq',m.seq,'text',m.body,'at',m.created_at,
    'channel',case when m.source='telegram_member'then 'telegram'else 'app'end)order by m.seq)
   from public.conversation_messages m where m.conversation_id=c.id and m.created_at>=since and m.created_at<upto),'[]'::jsonb),
  -- Every Zoe answer to a message in the window (whenever it was written), including ones held back from Telegram; heldReason says why.
  'zoeAnswers',coalesce((select jsonb_agg(jsonb_build_object('id',za.id,'kind',za.kind,'text',za.body,'at',za.created_at,'messageSeq',za.message_seq,
    'telegramState',sm.state,'heldReason',case when sm.state='held'then sm.reason end)order by za.created_at,za.id)
   from public.zoe_member_answers za left join public.system_messages sm on sm.id=za.system_message_id
   where za.conversation_id=c.id and(lo is null or za.message_seq>=lo)and(hi is null or za.message_seq<=hi)),'[]'::jsonb),
  -- Every approved doctor reply in the window, whatever happened to its delivery.
  'replies',coalesce((select jsonb_agg(jsonb_build_object('approvalId',ap.id,'text',ap.body,'at',ap.created_at,'doctorName',ap.doctor_name,
    'deliveryState',dl.state,'deliveryReason',dl.reason)order by ap.created_at,ap.id)
   from public.conversation_approvals ap join public.conversation_drafts d on d.id=ap.draft_id
   left join public.conversation_deliveries dl on dl.approval_id=ap.id
   where d.conversation_id=c.id and ap.created_at>=since and ap.created_at<upto),'[]'::jsonb),
  'drafts',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'state',d.state,'createdAt',d.created_at,'contextVersion',d.context_version,
    'revisions',(select count(*)from public.conversation_revisions r where r.draft_id=d.id),
    'latest',(select jsonb_build_object('revision',r.revision,'text',r.body,'summary',r.summary,'authorKind',r.author_kind,
      'authorName',(select ws.display_name from public.workspace_staff ws where ws.user_id=r.author_id),'at',r.created_at)
     from public.conversation_revisions r where r.draft_id=d.id order by r.revision desc limit 1))order by d.created_at,d.id)
   from public.conversation_drafts d where d.conversation_id=c.id and d.created_at>=since and d.created_at<upto),'[]'::jsonb),
  -- Same shape as zoe_runs_for_doctor: the latest 20, with the total.
  'zoeRunsTotal',(select count(*)from public.zoe_runs where member_id=p_member and state='finished'and outcome<>'skipped'),
  'zoeRuns',coalesce((select jsonb_agg(jsonb_build_object('id',z.id,'messageSeq',z.message_seq,'outcome',z.outcome,'reason',z.reason_code,
    'summary',z.summary,'guardReasons',to_jsonb(z.guard_reasons),'provider',z.provider,'model',z.model,'draftId',z.draft_id,
    'draftState',(select d.state from public.conversation_drafts d where d.id=z.draft_id),
    'draftCurrent',(select d.context_version=c.version from public.conversation_drafts d where d.id=z.draft_id),
    'answer',(select za.body from public.zoe_member_answers za where za.run_id=z.id),'finishedAt',z.finished_at)order by z.finished_at desc)
   from(select * from public.zoe_runs where member_id=p_member and state='finished'and outcome<>'skipped'order by finished_at desc limit 20)z),'[]'::jsonb),
  -- Same shape as zoe_symptom_intakes_for_doctor (the summary, not the record): the latest 10, with the total.
  'intakesTotal',(select count(*)from public.zoe_symptom_intakes where member_id=p_member),
  'intakes',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'sheetId',i.sheet_id,'sheetVersion',i.sheet_version,'state',i.state,'ending',i.ending,
    'summary',i.summary,'startedAt',i.created_at,'updatedAt',i.updated_at,'finishedAt',i.finished_at)order by i.created_at desc)
   from(select * from public.zoe_symptom_intakes where member_id=p_member order by created_at desc limit 10)i),'[]'::jsonb),
  -- The admin trace (latest 300; the Trace page pages further), read here so one open is one audit row.
  'traceTotal',(select count(*)from public.conversation_trace_events where member_id=p_member),
  'trace',coalesce(public.conversation_trace_unlogged(p_member,null)->'events','[]'::jsonb));
end$$;
revoke all on function public.admin_conversation_read(uuid,timestamptz)from public,anon,authenticated,service_role;
grant execute on function public.admin_conversation_read(uuid,timestamptz)to authenticated;
