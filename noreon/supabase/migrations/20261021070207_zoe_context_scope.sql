-- Zoe topic scope and per-topic doctor takeover (Armen and Khikar, 20 Oct; lead decision "20 Oct 22:51", Armen msg 251).
-- One continuous conversation stays. What changes:
--
-- 1. The member's "New question" divider: conversation_topic_breaks, one row per press, after the member's newest message.
--    conversation_member_new_topic() (the member, from the app chat) inserts it; conversation_member_thread() returns them as
--    'breaks' (only when there is one, so the app running during the deploy, whose thread schema is strict, never sees the key
--    before its own button exists) and doctor_conversation_topic_breaks(member) gives them to the doctor's page.
-- 2. The worker's topic context (zoe_run_topic, per claimed run): the newest divider, the topic the last run recorded (its first
--    member message and whether Zoe owns it since the doctor's newest reply), and a compact health profile for the summary:
--    questionnaire conditions, the member's own medicines, open care alerts (count and age), the next confirmed visit. Codes,
--    numbers and the member's medicine names only. lib/zoe/topic.ts decides which earlier turns the model sees.
-- 3. zoe_runs.topic_start_seq / topic_owner: what each finished run decided (the next run continues from it).
-- 4. zoe_settings.doctor_takeover_scope: 'topic' (default, Armen msg 251): in doctor mode Zoe may answer a new question the
--    topic check found clearly unrelated to the doctor's matter; the doctor still sees it, and the doctor's follow-ups stay
--    with the doctor; when unsure, the doctor. 'conversation': the takeover of 20261020082321 unchanged (Zoe silent on
--    everything). Urgent, 103-window, red-flag and crisis texts are unchanged in both.
-- 5. zoe_run_doctor_mode also returns the scope and the doctor's matter (newest reply, the member messages it answered).
-- 6. zoe_run_finish (the doctor-mode guard of 20261020082321) lets a run through to _zoe_run_finish_core when the scope is
--    'topic' and the run's topic owner is 'zoe'; it records every run's topic. Everything else as before.
-- 7. With the 'topic' scope doctor mode no longer counts as "Zoe will not reply": _zoe_replies_on holds the Telegram
--    acknowledgement for Zoe as usual (a held run releases it), and the app's settledSeq follows the runs, so the member sees
--    "Zoe is writing" until the run decides and then either Zoe's answer or "Sent to your care team".

-- 1. Dividers -------------------------------------------------------------------------------------------------------------
create table public.conversation_topic_breaks(
 id uuid primary key default gen_random_uuid(),
 conversation_id uuid not null references public.conversations(id)on delete cascade,
 member_id uuid not null references auth.users(id)on delete cascade,
 -- The member's newest message when they pressed it: the next message starts the new question.
 after_seq integer not null check(after_seq>=0),
 created_at timestamptz not null default clock_timestamp(),
 unique(conversation_id,after_seq)
);
create index conversation_topic_breaks_thread on public.conversation_topic_breaks(conversation_id,after_seq desc);
alter table public.conversation_topic_breaks enable row level security;
revoke all on public.conversation_topic_breaks from public,anon,authenticated,service_role;

-- The member presses "New question". Idempotent: a second press before another message changes nothing.
create function public.conversation_member_new_topic()returns jsonb
language plpgsql security definer set search_path=''as $$
declare m uuid:=auth.uid();c public.conversations;s integer;bid uuid;
begin
 if auth.role()is distinct from 'authenticated'or m is null then raise insufficient_privilege;end if;
 if not coalesce((select p.app_chat_enabled from public.conversation_policy p where p.singleton),false)then return jsonb_build_object('ok',false,'code','unavailable');end if;
 if not public._telegram_member_eligible(m)then return jsonb_build_object('ok',false,'code','not_eligible');end if;
 select * into c from public.conversations where member_id=m for update;
 if c.id is null then return jsonb_build_object('ok',true,'replayed',true);end if;
 s:=coalesce((select max(cm.seq)from public.conversation_messages cm where cm.conversation_id=c.id and cm.source in('telegram_member','authenticated_member')),0);
 if s=0 then return jsonb_build_object('ok',true,'replayed',true);end if;
 insert into public.conversation_topic_breaks(conversation_id,member_id,after_seq)values(c.id,m,s)on conflict(conversation_id,after_seq)do nothing returning id into bid;
 if bid is null then return jsonb_build_object('ok',true,'replayed',true,'afterSeq',s);end if;
 insert into public.conversation_audit(conversation_id,actor_id,kind,detail)values(c.id,m,'member.topic_break',jsonb_build_object('afterSeq',s,'breakId',bid));
 return jsonb_build_object('ok',true,'replayed',false,'afterSeq',s);
end$$;

create function public._conversation_topic_breaks(p_conversation uuid)returns jsonb
language sql stable security definer set search_path=''as $$
 select coalesce((select jsonb_agg(jsonb_build_object('afterSeq',b.after_seq,'at',b.created_at)order by b.after_seq)
  from(select * from public.conversation_topic_breaks where conversation_id=p_conversation order by after_seq desc limit 100)b),'[]'::jsonb)
$$;

-- The assigned doctor (the same check as the doctor-mode page, 20261020082321).
create function public.doctor_conversation_topic_breaks(p_member uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare me uuid:=public._zoe_mode_doctor(p_member);c uuid;
begin
 select id into c from public.conversations where member_id=p_member;
 return jsonb_build_object('ok',true,'breaks',case when c is null then '[]'::jsonb else public._conversation_topic_breaks(c)end);
end$$;

-- 3. What each run decided ----------------------------------------------------------------------------------------------------
alter table public.zoe_runs add column topic_start_seq integer check(topic_start_seq>=0),
 add column topic_owner text check(topic_owner in('zoe','doctor')),
 add check((topic_start_seq is null)=(topic_owner is null));

-- 4. The setting ------------------------------------------------------------------------------------------------------------
alter table public.zoe_settings add column doctor_takeover_scope text not null default 'topic'check(doctor_takeover_scope in('topic','conversation'));
comment on column public.zoe_settings.doctor_takeover_scope is
 'Doctor takeover (20261020082321, 20261021070207): topic (default, Armen msg 251) = the doctor''s reply covers only their topic, a clearly unrelated new question is Zoe''s; conversation = Zoe silent on the whole conversation until the hand back.';

create function public._zoe_takeover_scope()returns text
language sql stable security definer set search_path=''as $$
 select coalesce((select s.doctor_takeover_scope from public.zoe_settings s where s.singleton),'conversation')
$$;

-- 2. The worker's topic context -----------------------------------------------------------------------------------------------
create function public.zoe_run_topic(p_runs uuid[])returns jsonb
language plpgsql stable security definer set search_path=''as $$
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if p_runs is null or cardinality(p_runs)>50 then return '[]'::jsonb;end if;
 return coalesce((select jsonb_agg(jsonb_build_object('runId',r.id,
   'breakAfterSeq',(select max(b.after_seq)from public.conversation_topic_breaks b where b.conversation_id=r.conversation_id and b.after_seq<r.message_seq),
   'startSeq',lt.topic_start_seq,
   -- Zoe owns the topic when the newest run that recorded one gave it to Zoe after the doctor's newest reply.
   'zoeOwns',coalesce(lt.topic_owner='zoe'and lt.finished_at>coalesce((select max(ap.created_at)from public.conversation_approvals ap join public.conversation_drafts d on d.id=ap.draft_id
     where d.conversation_id=r.conversation_id),'-infinity'::timestamptz),false),
   'profile',jsonb_build_object(
    'conditions',coalesce((select jsonb_agg(x.v)from(select jsonb_array_elements_text(case when jsonb_typeof(a.answers->'q6.conditions'->'value')='array'then a.answers->'q6.conditions'->'value'else '[]'end)v)x
      where x.v ~ '^[a-z_]{2,40}$'and x.v not in('none','unknown')),'[]'::jsonb),
    'bpDiagnosed',case when a.answers->'q5.diagnosed'->>'value' in('treated','untreated','no')then a.answers->'q5.diagnosed'->>'value'end,
    'medicines',coalesce((select jsonb_agg(jsonb_build_object('name',left(mm.name,120),'dose',left(mm.dose,80),'times',coalesce((select jsonb_agg(to_char(t,'HH24:MI')order by t)from unnest(mm.times[1:6])t),'[]'::jsonb),
      'sinceDays',greatest(0,(current_date-mm.started_on)))order by mm.created_at)
     from(select * from public.member_medicines x where x.user_id=r.member_id and x.stopped_at is null order by x.created_at limit 12)mm),'[]'::jsonb),
    'openAlerts',coalesce((select jsonb_agg(jsonb_build_object('daysAgo',floor(extract(epoch from clock_timestamp()-ca.created_at)/86400)::integer,'urgent',ca.priority='urgent')order by ca.created_at desc)
     from(select * from public.care_alerts y where y.member_id=r.member_id and y.state<>'resolved'and y.created_at>clock_timestamp()-interval '30 days'order by y.created_at desc limit 10)ca),'[]'::jsonb),
    'nextVisitInDays',(select greatest(0,floor(extract(epoch from ap2.starts_at-clock_timestamp())/86400))::integer from public.patient_care_appointments ap2
     where ap2.user_id=r.member_id and ap2.status='confirmed'and ap2.starts_at>clock_timestamp()order by ap2.starts_at limit 1))))
  from public.zoe_runs r
  left join lateral(select z.topic_start_seq,z.topic_owner,z.finished_at from public.zoe_runs z where z.conversation_id=r.conversation_id and z.id<>r.id and z.state='finished'
   and z.topic_start_seq is not null and z.message_seq<r.message_seq order by z.message_seq desc limit 1)lt on true
  left join lateral(select pa.answers from public.patient_assessments pa where pa.user_id=r.member_id and pa.completed_at is not null order by pa.completed_at desc limit 1)a on true
  where r.id=any(p_runs)and r.state='started'),'[]'::jsonb);
end$$;

-- 5. Doctor mode for the worker: the scope and the doctor's matter -------------------------------------------------------
create or replace function public.zoe_run_doctor_mode(p_runs uuid[])returns jsonb
language plpgsql stable security definer set search_path=''as $$
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if p_runs is null or cardinality(p_runs)>50 then return '[]'::jsonb;end if;
 return coalesce((select jsonb_agg(jsonb_build_object('runId',r.id,'doctorMode',public._zoe_doctor_mode(r.conversation_id),'scope',public._zoe_takeover_scope(),
   'doctorMatter',case when public._zoe_doctor_mode(r.conversation_id)then(
    select jsonb_build_object('reply',ap.body,'minutesAgo',floor(extract(epoch from clock_timestamp()-ap.created_at)/60)::integer,
     -- The member messages the reply answered: up to three, in the six hours before it.
     'messages',coalesce((select jsonb_agg(jsonb_build_object('text',w.body,'minutesAgo',floor(extract(epoch from clock_timestamp()-w.created_at)/60)::integer)order by w.seq)
      from(select m.seq,m.body,m.created_at from public.conversation_messages m where m.conversation_id=r.conversation_id and m.source in('telegram_member','authenticated_member')
       and m.created_at<=ap.created_at and m.created_at>ap.created_at-interval '6 hours'order by m.seq desc limit 3)w),'[]'::jsonb))
    from public.conversation_approvals ap join public.conversation_drafts d on d.id=ap.draft_id where d.conversation_id=r.conversation_id order by ap.created_at desc,ap.id desc limit 1)end))
  from public.zoe_runs r where r.id=any(p_runs)and r.state='started'),'[]'::jsonb);
end$$;

-- The doctor's page also says which scope applies (as 20261020082321, plus 'scope').
create or replace function public.doctor_zoe_mode(p_member uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare me uuid:=public._zoe_mode_doctor(p_member);c public.conversations;m public.zoe_doctor_mode;
begin
 select * into c from public.conversations where member_id=p_member;
 if c.id is not null then select * into m from public.zoe_doctor_mode where conversation_id=c.id;end if;
 perform public._access_audit_record(p_member,'doctor_zoe_mode','read');
 return jsonb_build_object('ok',true,'doctorMode',coalesce(m.doctor_mode,false),'zoeActive',public._zoe_active_for(p_member),
  'since',case when m.doctor_mode then m.changed_at end,
  'byName',case when m.doctor_mode then(select ws.display_name from public.workspace_staff ws where ws.user_id=m.changed_by)end,
  'intakePaused',coalesce(m.doctor_mode,false)and exists(select 1 from public.zoe_symptom_intakes i where i.conversation_id=c.id and i.state='active'),
  'scope',public._zoe_takeover_scope());
end$$;

-- 6. The finish -------------------------------------------------------------------------------------------------------------
-- As 20261020082321, plus: the run's topic is recorded (worker-supplied, checked here), and in doctor mode with the 'topic'
-- scope a run whose topic the check gave to Zoe finishes as if Zoe had the conversation.
create or replace function public.zoe_run_finish(p_run uuid,p_result jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare r public.zoe_runs;o text;rs text;safety boolean;held jsonb;res jsonb;tp jsonb;t_start integer;t_owner text;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 select * into r from public.zoe_runs where id=p_run for update;
 if not found or r.state='finished'or jsonb_typeof(p_result)is distinct from 'object'then return public._zoe_run_finish_core(p_run,p_result);end if;
 perform 1 from public.conversations where id=r.conversation_id for update;
 -- 20261021070207: the topic, only when well formed (otherwise the run simply records none).
 tp:=case when jsonb_typeof(p_result->'topic')='object'then p_result->'topic'end;
 if tp is not null and tp->>'owner'in('zoe','doctor')and coalesce(tp->>'startSeq','')~'^[0-9]{1,9}$'and(tp->>'startSeq')::integer<=r.message_seq then
  t_start:=(tp->>'startSeq')::integer;t_owner:=tp->>'owner';end if;
 -- In doctor mode only the check's own verdict counts (doctorTopic "no", which a run that did not know about doctor mode never
 -- carries): a worker that could not read doctor mode is held as before.
 if not public._zoe_doctor_mode(r.conversation_id)or(t_owner='zoe'and tp->>'doctorTopic'='no'and public._zoe_takeover_scope()='topic')then
  res:=public._zoe_run_finish_core(p_run,p_result);
  if t_owner is not null then update public.zoe_runs set topic_start_seq=t_start,topic_owner=t_owner where id=p_run;end if;
  if t_owner='zoe'and public._zoe_doctor_mode(r.conversation_id)then
   select * into r from public.zoe_runs where id=p_run;
   perform public._zoe_run_events(r,jsonb_build_array(jsonb_build_object('name','zoe.guard.doctor_mode','outcome','allow','reason','doctor_mode_other_topic',
    'rule','zoe.doctor_mode','ruleVersion','zoe-doctor-mode-2','actor','system','attributes',jsonb_build_object('noreon.zoe.guard.name','doctor_mode','noreon.zoe.doctor_mode.scope','topic'))));
  end if;
  return res;
 end if;
 o:=p_result->>'outcome';rs:=p_result->>'reason';
 safety:=o='intake_escalated'or(o='discarded'and rs in('urgent_route_no_model_call','urgent_in_window_no_model_call','urgent_health_answer_model','urgent_health_answer_red_flag_yes'));
 if safety then res:=public._zoe_run_finish_core(p_run,p_result-'receipt');
 else
  -- Doctor-facing outcomes (and a discard with no text) keep their reason, summary and draft; nothing goes to the member.
  if o in('draft_proposed','draft_blocked','summary_only','no_output')or(o='discarded'and jsonb_typeof(p_result->'answer')is distinct from 'string')then
   held:=p_result-'receipt'-'answer'-'language';
  else held:=(p_result-'receipt'-'answer'-'language'-'intake'-'chat'-'health'-'summary'-'draft')||jsonb_build_object('outcome','discarded','reason','doctor_mode_held');
  end if;
  res:=public._zoe_run_finish_core(p_run,held);
  if p_result is distinct from held then
   select * into r from public.zoe_runs where id=p_run;
   perform public._zoe_run_events(r,jsonb_build_array(jsonb_build_object('name','zoe.guard.doctor_mode','outcome','block','reason','doctor_mode_member_text_held',
    'rule','zoe.doctor_mode','ruleVersion','zoe-doctor-mode-2','actor','system','attributes',jsonb_build_object('noreon.zoe.guard.name','doctor_mode',
    'noreon.zoe.doctor_mode.outcome',left(coalesce(o,'none'),40)))));
  end if;
 end if;
 -- A run held for the doctor belongs to the doctor's matter, whatever the worker said.
 if t_owner is not null then update public.zoe_runs set topic_start_seq=t_start,topic_owner='doctor'where id=p_run;end if;
 return res;
end$$;

-- 7. Doctor mode with the 'topic' scope is not "Zoe will not reply" ------------------------------------------------------
create or replace function public._zoe_replies_on(m uuid)returns boolean
language sql stable security definer set search_path=''as $$
 select coalesce((select s.conversational_replies_enabled and s.consent_collection_enabled and s.consent_wording_version is not null
   and public._zoe_consent_current(m,'zoe_reads_messages')
   and exists(select 1 from public.patient_clinical_cases cs where cs.user_id=m and cs.assigned_doctor_id is not null)
   and public._zoe_template_ok('zoe.receipt',coalesce((select case when pr.locale='en'then 'en'else 'hy'end from public.profiles pr where pr.id=m),'hy'))
   -- 20261020082321: not while the doctor has the conversation; 20261021070207: only with the 'conversation' scope.
   and(s.doctor_takeover_scope='topic'
    or not exists(select 1 from public.conversations c join public.zoe_doctor_mode dm on dm.conversation_id=c.id where c.member_id=m and dm.doctor_mode))
  from public.zoe_settings s where s.singleton),false)
$$;

-- The member's chat (from 20261020082321; change marked 20261021070207): settledSeq follows the runs with the 'topic' scope.
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
   else coalesce((select max(z.message_seq)from public.zoe_runs z where z.conversation_id=c.id and z.state='finished'and z.outcome is distinct from 'stale'),0)end,
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

revoke all on function public.conversation_member_new_topic(),public._conversation_topic_breaks(uuid),public.doctor_conversation_topic_breaks(uuid),
 public._zoe_takeover_scope(),public.zoe_run_topic(uuid[]),public.zoe_run_doctor_mode(uuid[]),public.zoe_run_finish(uuid,jsonb)
 from public,anon,authenticated,service_role;
grant execute on function public.conversation_member_new_topic(),public.doctor_conversation_topic_breaks(uuid)to authenticated;
grant execute on function public.zoe_run_topic(uuid[]),public.zoe_run_doctor_mode(uuid[]),public.zoe_run_finish(uuid,jsonb)to service_role;
comment on function public.conversation_member_new_topic()is
 'The member''s "New question" button: a divider after their newest message. Zoe answers the next message as a new topic; the doctor sees the divider too.';
comment on function public.zoe_run_finish(uuid,jsonb)is
 'Doctor-mode guard (20261020082321, 20261021070207) around _zoe_run_finish_core: in doctor mode only urgent, 103-window and red-flag texts reach the member, unless the scope is topic and the run''s topic is Zoe''s. Records the run''s topic.';
