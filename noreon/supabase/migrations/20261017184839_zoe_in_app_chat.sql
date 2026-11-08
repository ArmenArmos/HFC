-- Zoe in the member app: one conversation per member across the app and Telegram (Khikar, 17 Oct 22:48).
--
-- The app writes into the same conversations / conversation_messages rows as Telegram, with the
-- existing source 'authenticated_member'. Everything downstream is the Telegram path unchanged:
-- the doctor alert row (and its staff notice), care-alert screening of every stored message, the
-- Zoe sweep (urgent words, scope, tier routing, redaction, spend reservation, output guard, a
-- pending draft only the assigned doctor can approve), and the reply machine. Nothing here can
-- send to a member or call a model.
--
-- 1. conversation_policy.app_chat_enabled: the one switch (dark by default). It decides whether
--    the member reads the thread in the app (the app action also refuses new text while it is off).
-- 2. conversation_receive: the Telegram intake rules for app text: the 4096 UTF-16 size cap, the
--    same member eligibility, the same intake window and limit, and the doctor alert row.
-- 3. conversation_member_thread: the member's own thread (their messages from both channels, the
--    approved Telegram acknowledgement wording, and approved replies released under the same
--    context rule as a Telegram send, recorded in conversation_app_releases). No drafts, AI
--    output, summaries, approvals metadata or transport details.
-- 4. zoe_run_claim: app messages are claimed exactly like Telegram ones.
-- 5. conversation_awaiting_replies: a reply held only because the member has no Telegram is not
--    "not delivered" once it has been released to the member in the app.

-- 1. The switch ------------------------------------------------------------------------------------
alter table public.conversation_policy add column app_chat_enabled boolean not null default false;
comment on column public.conversation_policy.app_chat_enabled is
 'Dark switch for the member app Zoe chat (one conversation across app and Telegram). Off: the app shows the deterministic Zoe screen.';

-- 2. App intake: same rules as Telegram text --------------------------------------------------------
-- Red always wins happens before this call (the app opens the 103 screen on urgent words and still
-- stores the text so the care team is alerted by the same screening). Over the intake limit nothing
-- is stored and the member is told so in the app; Telegram cannot tell them, so it records the
-- overflow instead. Both use the same window and limit from conversation_policy.
create or replace function public.conversation_receive(p_command jsonb)returns jsonb language plpgsql security definer set search_path=''as $$
declare a jsonb;c public.conversations;r jsonb;p public.conversation_policy;rid uuid;doc uuid;
begin
 if jsonb_typeof(p_command)is distinct from 'object'or not(p_command?&array['requestId','text'])or p_command-array['requestId','text']<>'{}'or jsonb_typeof(p_command->'requestId')is distinct from 'string'or jsonb_typeof(p_command->'text')is distinct from 'string'
  -- Same size cap as a Telegram text message (channel_inbox, conversation_endpoints.max_utf16).
  or public._conversation_utf16(p_command->>'text')not between 1 and 4096 or btrim(p_command->>'text')=''then return jsonb_build_object('ok',false,'code','invalid_command');end if;
 rid:=(p_command->>'requestId')::uuid;
 perform pg_advisory_xact_lock(hashtextextended('conversation-command:'||auth.uid()::text||':'||rid::text,0));
 a:=public._conversation_user(auth.uid(),false);
 -- Same eligibility as Telegram intake: confirmed phone, not banned, not staff, has a clinical case.
 if not public._telegram_member_eligible(auth.uid())then return jsonb_build_object('ok',false,'code','not_eligible');end if;
 insert into public.conversations(member_id)values(auth.uid())on conflict(member_id)do nothing;
 select * into c from public.conversations where member_id=auth.uid()for update;
 r:=public._conversation_replay(c.id,a,rid::text,p_command);if r is not null then return r;end if;
 select * into p from public.conversation_policy where singleton;
 if(select count(*)from public.conversation_messages where conversation_id=c.id and created_at>clock_timestamp()-make_interval(secs=>p.intake_window_seconds))>=p.intake_max_messages then
  insert into public.conversation_audit(conversation_id,actor_id,kind,detail)values(c.id,auth.uid(),'message.rate_limited',jsonb_build_object('channel','app','requestId',rid));
  return jsonb_build_object('ok',false,'code','rate_limited');end if;
 update public.conversations set version=version+1 where id=c.id returning * into c;
 insert into public.conversation_messages(conversation_id,seq,author_id,body,source,request_id)values(c.id,c.version,auth.uid(),p_command->>'text','authenticated_member',rid);
 update public.conversation_intents set state='invalidated'where state='open'and draft_id in(select id from public.conversation_drafts where conversation_id=c.id);
 update public.conversation_deliveries set state='held',reason='newer_member_message',state_seq=state_seq+1 where conversation_id=c.id and state='queued';
 update public.conversation_deliveries set review_after_send=true where conversation_id=c.id and state in('sending','unknown');
 update public.conversation_drafts set state='superseded'where conversation_id=c.id and state in('pending','info_requested');
 insert into public.conversation_audit(conversation_id,actor_id,kind,detail)values(c.id,auth.uid(),'message.received',jsonb_build_object('channel','app','requestId',rid,'seq',c.version));
 -- Same doctor alert row as Telegram text (it drives the staff notice); no Telegram acknowledgement
 -- is queued: the app shows the acknowledgement in the thread.
 select assigned_doctor_id into doc from public.patient_clinical_cases where user_id=auth.uid();
 insert into public.conversation_doctor_alerts(conversation_id,member_id,doctor_id,message_seq,inbox_id)values(c.id,auth.uid(),doc,c.version,null);
 return public._conversation_receipt(c.id,a,rid::text,p_command,jsonb_build_object('ok',true,'conversationId',c.id,'version',c.version,'replayed',false));
exception when invalid_text_representation then return jsonb_build_object('ok',false,'code','invalid_command');
end$$;

-- 3. The member's thread ------------------------------------------------------------------------------
-- Only the signed-in member's own conversation (auth.uid(); no member argument). Pending, rejected
-- or superseded drafts and every AI output never appear.
--
-- Approved replies follow the same rule as a Telegram send (Fable F1): new information voids an
-- approval. A reply is released to the app when (a) Telegram carried or attempted it (accepted,
-- unknown, sending or definitely failed: the member may have it already), or (b) at the moment of
-- this read the context is still the one the doctor approved (conversation version, draft still
-- approved, clinical revision and source token unchanged), and the approving authority has not
-- lapsed. A release is recorded once and is sticky, so a reply never disappears after the member
-- may have read it, and the doctor's list can tell whether the member has it.
create table public.conversation_app_releases (
 approval_id uuid primary key references public.conversation_approvals(id),
 conversation_id uuid not null references public.conversations(id),
 member_id uuid not null references auth.users(id) on delete cascade,
 released_at timestamptz not null default clock_timestamp(),
 reason text not null check(reason in('context_current','telegram_attempted'))
);
create index conversation_app_releases_conversation on public.conversation_app_releases(conversation_id,released_at);
alter table public.conversation_app_releases enable row level security;
revoke all on public.conversation_app_releases from public,anon,authenticated,service_role;

create function public.conversation_member_thread()returns jsonb
language plpgsql security definer set search_path=''as $$
declare m uuid:=auth.uid();c public.conversations;loc text;since timestamptz;rev bigint;src text;
begin
 if auth.role()is distinct from 'authenticated'or m is null then raise insufficient_privilege;end if;
 if not coalesce((select p.app_chat_enabled from public.conversation_policy p where p.singleton),false)then return jsonb_build_object('ok',false,'code','unavailable');end if;
 if not public._telegram_member_eligible(m)then return jsonb_build_object('ok',false,'code','not_eligible');end if;
 select case when pr.locale='en'then 'en'else 'hy'end into loc from public.profiles pr where pr.id=m;
 select * into c from public.conversations where member_id=m;
 if c.id is not null and exists(select 1 from public.conversation_approvals ap join public.conversation_drafts d on d.id=ap.draft_id
   where d.conversation_id=c.id and not exists(select 1 from public.conversation_app_releases r where r.approval_id=ap.id))then
  select revision into rev from public.patient_clinical_cases where user_id=m;
  src:=public.patient_clinical_evidence(m)->>'token';
  insert into public.conversation_app_releases(approval_id,conversation_id,member_id,reason)
  select ap.id,c.id,m,case when dl.state in('accepted_by_provider','unknown','sending','definitely_failed')then 'telegram_attempted'else 'context_current'end
  from public.conversation_approvals ap join public.conversation_drafts d on d.id=ap.draft_id
  left join public.conversation_deliveries dl on dl.approval_id=ap.id
  where d.conversation_id=c.id and not exists(select 1 from public.conversation_app_releases r where r.approval_id=ap.id)
   and(dl.state in('accepted_by_provider','unknown','sending','definitely_failed')
    or(not coalesce(dl.state='held'and dl.reason='approval_authority_lapsed',false)
     and ap.context_version=c.version and d.state='approved'and d.clinical_revision=rev and d.source_token=src))
  on conflict do nothing;
 end if;
 -- The latest 100 member messages, and released replies since the oldest of them.
 select min(x.created_at)into since from(select created_at from public.conversation_messages where conversation_id=c.id order by seq desc limit 100)x;
 return jsonb_build_object('ok',true,'version',coalesce(c.version,0),
  'ack',(select t.body from public.system_message_templates t where t.template_id='telegram.ack'and t.locale=coalesce(loc,'hy')and t.approved order by t.version desc limit 1),
  'messages',coalesce((select jsonb_agg(jsonb_build_object('seq',x.seq,'text',x.body,'at',x.created_at,'channel',case when x.source='telegram_member'then 'telegram'else 'app'end,
    'requestId',case when x.source='authenticated_member'then x.request_id end)order by x.seq)
   from(select * from public.conversation_messages where conversation_id=c.id order by seq desc limit 100)x),'[]'),
  'replies',coalesce((select jsonb_agg(jsonb_build_object('id',ap.id,'text',ap.body,'at',ap.created_at,'doctorName',ap.doctor_name)order by ap.created_at,ap.id)
   from public.conversation_app_releases r join public.conversation_approvals ap on ap.id=r.approval_id
   where r.conversation_id=c.id and r.member_id=m and(since is null or ap.created_at>=since)),'[]'));
end$$;
revoke all on function public.conversation_member_thread()from public,anon,authenticated,service_role;
grant execute on function public.conversation_member_thread()to authenticated;

-- 4. Zoe claims app messages exactly like Telegram ones -------------------------------------------------
create or replace function public.zoe_run_claim(p_limit integer)returns jsonb
language plpgsql security definer set search_path=''as $$
declare s public.zoe_settings;rec record;r public.zoe_runs;jobs jsonb:='[]';consent boolean;skip text;since timestamptz;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 for r in update public.zoe_runs set state='finished',outcome='no_output',reason_code='worker_lost',finished_at=clock_timestamp()
  where state='started'and started_at<clock_timestamp()-interval '10 minutes'returning * loop
  perform public._zoe_run_events(r,jsonb_build_array(jsonb_build_object('name','zoe.route','outcome','failed','reason','worker_lost','rule','zoe.pipeline','ruleVersion','1','actor','system','attributes',jsonb_build_object('noreon.zoe.run.outcome','no_output'))));
 end loop;
 select * into s from public.zoe_settings where singleton;
 for rec in
  select c.id conversation_id,c.member_id,c.version,c.draft_epoch,lm.seq,cs.assigned_doctor_id,pr.display_name
  from public.conversations c
  join lateral(select m.seq,m.source,m.created_at from public.conversation_messages m where m.conversation_id=c.id order by m.seq desc limit 1)lm on true
  join public.patient_clinical_cases cs on cs.user_id=c.member_id
  left join public.profiles pr on pr.id=c.member_id
  where lm.source in('telegram_member','authenticated_member')and lm.created_at>clock_timestamp()-interval '24 hours'
   and not exists(select 1 from public.zoe_runs zr where zr.conversation_id=c.id and zr.message_seq>=lm.seq)
  order by lm.created_at limit greatest(1,least(coalesce(p_limit,10),20))
  for update of c skip locked
 loop
  -- K4: consent counts only while collection is on with a server-held wording.
  consent:=s.singleton is not null and s.consent_collection_enabled and s.consent_wording_version is not null
   and coalesce((select granted from public.zoe_consents where member_id=rec.member_id and kind='zoe_reads_messages'order by id desc limit 1),false);
  skip:=case when s.singleton is null or not s.consent_collection_enabled or s.consent_wording_version is null then 'zoe_settings_off'
   when not consent then 'no_zoe_reads_messages_consent' when rec.assigned_doctor_id is null then 'no_assigned_doctor'
   -- Fable Z-F3: a message the doctor already answered gets no AI draft.
   when exists(select 1 from public.conversation_approvals ap join public.conversation_drafts d on d.id=ap.draft_id
    where d.conversation_id=rec.conversation_id and ap.context_version>=rec.version)then 'already_answered'end;
  insert into public.zoe_runs(conversation_id,member_id,message_seq,context_version,draft_epoch,spend_day,state,outcome,reason_code,finished_at)
  values(rec.conversation_id,rec.member_id,rec.seq,rec.version,rec.draft_epoch,(clock_timestamp()at time zone coalesce(s.time_zone,'Asia/Yerevan'))::date,
   case when skip is null then 'started'else 'finished'end,case when skip is null then null else 'skipped'end,skip,case when skip is null then null else clock_timestamp()end)
  on conflict(conversation_id,message_seq)do nothing returning * into r;
  if r.id is null then continue;end if;
  perform public._zoe_run_events(r,jsonb_build_array(jsonb_build_object('name','zoe.guard.consent','outcome',case when skip is null then 'allow'else 'block'end,
   'reason',coalesce(skip,'zoe_reads_messages_granted'),'rule','zoe.consent','ruleVersion',coalesce(s.consent_wording_version,'none'),'actor','system',
   'attributes',jsonb_build_object('noreon.zoe.guard.name','consent','noreon.zoe.consent.kind','zoe_reads_messages'))));
  if skip is not null then r:=null;continue;end if;
  -- The window: member messages since the last approved reply (at most 20), and the last approved replies.
  since:=(select max(ap.created_at)from public.conversation_approvals ap join public.conversation_drafts d on d.id=ap.draft_id where d.conversation_id=rec.conversation_id);
  jobs:=jobs||jsonb_build_array(jsonb_build_object('runId',r.id,'memberId',rec.member_id,'messageSeq',rec.seq,'displayName',rec.display_name,
   'messages',(select jsonb_agg(jsonb_build_object('seq',w.seq,'text',w.body,'minutesAgo',w.ago)order by w.seq)from(
     select m.seq,m.body,floor(extract(epoch from clock_timestamp()-m.created_at)/60)::integer ago from public.conversation_messages m
     where m.conversation_id=rec.conversation_id and m.seq<=rec.seq and(since is null or m.created_at>since or m.seq=rec.seq)order by m.seq desc limit 20)w),
   'replies',coalesce((select jsonb_agg(jsonb_build_object('body',x.body,'minutesAgo',x.ago)order by x.created_at)from(
     select ap.body,ap.created_at,floor(extract(epoch from clock_timestamp()-ap.created_at)/60)::integer ago from public.conversation_approvals ap
     join public.conversation_drafts d on d.id=ap.draft_id where d.conversation_id=rec.conversation_id order by ap.created_at desc limit 3)x),'[]')));
  r:=null;
 end loop;
 return jobs;
end$$;

-- 5. Awaiting replies: an app-only member's approved reply is not "not delivered" once it is released to them in the app ----
create or replace function public.conversation_awaiting_replies()returns jsonb
language plpgsql security definer set search_path=''as $$
declare who jsonb:=public.real_clinical_staff_identity();
begin
 if who is null or who->>'role'<>'doctor'then raise insufficient_privilege;end if;
 return jsonb_build_object('ok',true,'items',coalesce((select jsonb_agg(item order by item->>'reason',item->>'lastMessageAt')from(
  select jsonb_build_object('memberId',cs.user_id,'memberName',coalesce(pr.display_name,''),'lastMessageAt',greatest(lm.created_at,lmed.at),'unanswered',
   (select count(*)from public.conversation_messages m2 where m2.conversation_id=c.id and m2.seq>coalesce(dec.v,0)),
   'latestDelivery',ld.state,'latestReason',ld.reason,
   'reason',case when c.version>coalesce(dec.v,0)then 'new_message'else 'not_delivered'end,
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
  -- The conversation version moves with every member message, stored or over the
  -- intake limit, so a message that was not saved still puts the member on the list.
  -- An undelivered last reply stays listed for 30 days.
  where cs.assigned_doctor_id=(who->>'id')::uuid and(c.version>coalesce(dec.v,0)
   or(ld.created_at>clock_timestamp()-interval '30 days'and(ld.state in('definitely_failed','unknown')or(ld.state='held'and ld.reason is distinct from 'newer_member_message'
     -- A member with no Telegram who has the reply in the app chat (released to them, F2).
     and not(ld.reason='route_policy_missing'and exists(select 1 from public.conversation_app_releases r where r.approval_id=ld.approval_id))))
    -- A later decision (for example rejecting a draft as no reply needed) clears it.
    and not exists(select 1 from public.conversation_drafts d2 where d2.conversation_id=c.id and d2.state='rejected'and d2.created_at>ld.created_at))))q),'[]'));
end$$;
