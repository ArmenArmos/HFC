-- QA92: the member explicitly addresses one app message to the assigned doctor.
-- This is per-message routing; it does not change the conversation's doctor-takeover state.
alter table public.conversation_messages add column to_doctor boolean not null default false;
comment on column public.conversation_messages.to_doctor is
 'The member explicitly addressed this message to the doctor. Zoe still performs its safety checks.';

drop function public.conversation_receive(jsonb);
create function public.conversation_receive(p_command jsonb,p_to_doctor boolean default false)returns jsonb language plpgsql security definer set search_path=''as $$
declare a jsonb;c public.conversations;r jsonb;p public.conversation_policy;rid uuid;doc uuid;payload jsonb;m uuid:=auth.uid();
begin
 if p_to_doctor is null or jsonb_typeof(p_command)is distinct from 'object'or not(p_command?&array['requestId','text'])or p_command-array['requestId','text']<>'{}'or jsonb_typeof(p_command->'requestId')is distinct from 'string'or jsonb_typeof(p_command->'text')is distinct from 'string'
  -- Same size cap as a Telegram text message (channel_inbox, conversation_endpoints.max_utf16).
  or public._conversation_utf16(p_command->>'text')not between 1 and 4096 or btrim(p_command->>'text')=''then return jsonb_build_object('ok',false,'code','invalid_command');end if;
 if auth.role()is distinct from 'authenticated'or m is null then raise insufficient_privilege;end if;
 -- Keep default-mode payloads compatible with receipts recorded before this migration.
 -- The route is part of idempotency: a retry cannot silently redirect an accepted message.
 payload:=p_command||case when p_to_doctor then jsonb_build_object('toDoctor',true)else '{}'::jsonb end;
 rid:=(p_command->>'requestId')::uuid;
 perform pg_advisory_xact_lock(hashtextextended('conversation-command:'||m::text||':'||rid::text,0));
 -- Same eligibility as Telegram intake, checked first so the member is told what to do (18 Oct).
 if not exists(select 1 from auth.users where id=m and phone is not null and phone_confirmed_at is not null and(banned_until is null or banned_until<=clock_timestamp()))
  or exists(select 1 from public.workspace_staff where user_id=m)then return jsonb_build_object('ok',false,'code','not_eligible');end if;
 if not exists(select 1 from public.patient_clinical_cases where user_id=m)then return jsonb_build_object('ok',false,'code','needs_review_request');end if;
 begin
  a:=public._conversation_user(m,false);
 exception
  when lock_not_available then return jsonb_build_object('ok',false,'code','busy');
  -- Eligible member, refused authority: the auth session ended or the grant was revoked.
  when insufficient_privilege then return jsonb_build_object('ok',false,'code','sign_in_again');
 end;
 insert into public.conversations(member_id)values(m)on conflict(member_id)do nothing;
 select * into c from public.conversations where member_id=m for update;
 r:=public._conversation_replay(c.id,a,rid::text,payload);if r is not null then return r;end if;
 select * into p from public.conversation_policy where singleton;
 if(select count(*)from public.conversation_messages where conversation_id=c.id and created_at>clock_timestamp()-make_interval(secs=>p.intake_window_seconds))>=p.intake_max_messages then
  insert into public.conversation_audit(conversation_id,actor_id,kind,detail)values(c.id,m,'message.rate_limited',jsonb_build_object('channel','app','requestId',rid));
  return jsonb_build_object('ok',false,'code','rate_limited');end if;
 update public.conversations set version=version+1 where id=c.id returning * into c;
 insert into public.conversation_messages(conversation_id,seq,author_id,body,source,request_id,to_doctor)values(c.id,c.version,m,p_command->>'text','authenticated_member',rid,p_to_doctor);
 update public.conversation_intents set state='invalidated'where state='open'and draft_id in(select id from public.conversation_drafts where conversation_id=c.id);
 update public.conversation_deliveries set state='held',reason='newer_member_message',state_seq=state_seq+1 where conversation_id=c.id and state='queued';
 update public.conversation_deliveries set review_after_send=true where conversation_id=c.id and state in('sending','unknown');
 update public.conversation_drafts set state='superseded'where conversation_id=c.id and state in('pending','info_requested');
 insert into public.conversation_audit(conversation_id,actor_id,kind,detail)values(c.id,m,'message.received',jsonb_build_object('channel','app','requestId',rid,'seq',c.version));
 -- Same doctor alert row as Telegram text (it drives the staff notice); no Telegram acknowledgement
 -- is queued: the app shows the acknowledgement in the thread.
 select assigned_doctor_id into doc from public.patient_clinical_cases where user_id=m;
 insert into public.conversation_doctor_alerts(conversation_id,member_id,doctor_id,message_seq,inbox_id)values(c.id,m,doc,c.version,null);
 return public._conversation_receipt(c.id,a,rid::text,payload,jsonb_build_object('ok',true,'conversationId',c.id,'version',c.version,'replayed',false));
exception when invalid_text_representation then return jsonb_build_object('ok',false,'code','invalid_command');
end$$;

revoke all on function public.conversation_receive(jsonb,boolean)from public,anon,authenticated,service_role;
grant execute on function public.conversation_receive(jsonb,boolean)to authenticated;

create or replace function public.zoe_run_doctor_mode(p_runs uuid[])returns jsonb
language plpgsql stable security definer set search_path=''as $$
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if p_runs is null or cardinality(p_runs)>50 then return '[]'::jsonb;end if;
 return coalesce((select jsonb_agg(jsonb_build_object('runId',r.id,'doctorMode',td.to_doctor or public._zoe_doctor_mode(r.conversation_id),
   -- Explicitly addressed messages never enter the unrelated-topic bypass.
   'scope',case when td.to_doctor then 'conversation'else public._zoe_takeover_scope()end,
   'doctorMatter',case when public._zoe_doctor_mode(r.conversation_id)then(
    select jsonb_build_object('reply',ap.body,'minutesAgo',floor(extract(epoch from clock_timestamp()-ap.created_at)/60)::integer,
     -- The member messages the reply answered: up to three, in the six hours before it.
     'messages',coalesce((select jsonb_agg(jsonb_build_object('text',w.body,'minutesAgo',floor(extract(epoch from clock_timestamp()-w.created_at)/60)::integer)order by w.seq)
      from(select m.seq,m.body,m.created_at from public.conversation_messages m where m.conversation_id=r.conversation_id and m.source in('telegram_member','authenticated_member')
       and m.created_at<=ap.created_at and m.created_at>ap.created_at-interval '6 hours'order by m.seq desc limit 3)w),'[]'::jsonb))
    from public.conversation_approvals ap join public.conversation_drafts d on d.id=ap.draft_id where d.conversation_id=r.conversation_id order by ap.created_at desc,ap.id desc limit 1)end))
  from public.zoe_runs r
  -- Every member message this run covers (newer than the previous inbound run, as zoe_run_claim batches them): one addressed
  -- to the doctor keeps the whole run with the doctor, so a quick follow-up to Zoe cannot pull the request back (Astra R388).
  cross join lateral(select exists(select 1 from public.conversation_messages cm where cm.conversation_id=r.conversation_id and cm.to_doctor
   and cm.seq<=r.message_seq and cm.seq>coalesce((select max(zr.message_seq)from public.zoe_runs zr where zr.conversation_id=r.conversation_id
    and zr.kind='inbound'and zr.message_seq<r.message_seq),0))to_doctor)td
  where r.id=any(p_runs)and r.state='started'),'[]'::jsonb);
end$$;

create or replace function public.conversation_member_thread()returns jsonb
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
  'zoeReplies',public._zoe_replies_on(m),
  -- Astra DT-03: in doctor mode no Zoe text is coming (a safety text still shows when it arrives), so every member message counts
  -- as settled and the app shows "Sent to your care team" instead of "Zoe is writing" (no change to the app's contract).
  -- 20261021070207: only with the 'conversation' scope; with 'topic' Zoe may answer, so the runs decide as usual.
  'settledSeq',case when public._zoe_doctor_mode(c.id)and public._zoe_takeover_scope()='conversation'then coalesce((select max(m2.seq)from public.conversation_messages m2 where m2.conversation_id=c.id),0)
   else greatest(coalesce((select max(z.message_seq)from public.zoe_runs z where z.conversation_id=c.id and z.state='finished'and z.outcome is distinct from 'stale'),0),
    coalesce((select max(cm.seq)from public.conversation_messages cm where cm.conversation_id=c.id and cm.to_doctor),0))end,
  'ack',(select t.body from public.system_message_templates t where t.template_id='telegram.ack'and t.locale=coalesce(loc,'hy')and t.approved order by t.version desc limit 1),
  'messages',coalesce((select jsonb_agg(jsonb_build_object('seq',x.seq,'text',x.body,'at',x.created_at,'channel',case when x.source='telegram_member'then 'telegram'else 'app'end,
    'requestId',case when x.source='authenticated_member'then x.request_id end)order by x.seq)
   from(select * from public.conversation_messages where conversation_id=c.id order by seq desc limit 100)x),'[]'),
  'replies',coalesce((select jsonb_agg(jsonb_build_object('id',ap.id,'text',ap.body,'at',ap.created_at,'doctorName',ap.doctor_name)order by ap.created_at,ap.id)
   from public.conversation_app_releases r join public.conversation_approvals ap on ap.id=r.approval_id
   where r.conversation_id=c.id and r.member_id=m and(since is null or ap.created_at>=since)),'[]'),
  -- Zoe's own texts, and (20261020082321) the doctor-mode lines, in time order.
  'answers',coalesce((select jsonb_agg(jsonb_build_object('id',q.id,'text',q.body,'at',q.created_at)order by q.created_at,q.id)from(
    select a.id,a.body,a.created_at from public.zoe_member_answers a left join public.system_messages sm on sm.id=a.system_message_id
    where a.conversation_id=c.id and a.member_id=m and(since is null or a.created_at>=since)
     and not coalesce(sm.state='held'and sm.reason in('template_unapproved','template_changed','template_withdrawn'),false)
    union all
    select n.id,n.body,n.created_at from public.zoe_mode_notices n where n.conversation_id=c.id and n.member_id=m and(since is null or n.created_at>=since))q),'[]'))
  -- 20261021070207: the "New question" dividers, only when there is one.
  ||case when exists(select 1 from public.conversation_topic_breaks b where b.conversation_id=c.id)then jsonb_build_object('breaks',public._conversation_topic_breaks(c.id))else '{}'::jsonb end;
end$$;

create or replace function public._zoe_answered_open(p_conversation uuid)returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare c public.conversations;dec bigint;z public.zoe_runs;h jsonb;
begin
 select * into c from public.conversations where id=p_conversation;
 if not found then return null;end if;
 select coalesce(max(d.context_version),0)into dec from public.conversation_drafts d where d.conversation_id=c.id and d.state in('approved','rejected');
 if c.version<=dec then return null;end if;
 -- A request addressed to the doctor remains in needs reply until a doctor decision closes its window,
 -- even if Zoe subsequently answers another question in this conversation.
 if exists(select 1 from public.conversation_messages cm where cm.conversation_id=c.id and cm.seq>dec and cm.to_doctor)then return null;end if;
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
