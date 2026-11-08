-- Doctor takeover of a member's Zoe conversation (Armen, 20 Oct): once the doctor replies in a member's conversation, the
-- doctor continues it and Zoe stops, until the doctor hands it back to Zoe from the conversation page. The member is told
-- both times. Safety default (lead, told to Armen): the urgent/103 text, the 103 window, the symptom red flags and the
-- self-harm crisis text still answer at once in doctor mode, and still raise their care alert (#366). Only Zoe's
-- model-written and conversational texts pause.
--
-- 1. zoe_doctor_mode: one row per conversation, who switched it and when. Every switch is also in conversation_audit
--    (zoe.doctor_mode_on / zoe.doctor_mode_off); the hand back is in access_audit too.
-- 2. Takeover: any approved doctor reply (conversation_approvals, which only the assigned doctor can write) switches the
--    thread to doctor mode, while Zoe is on for the member (Zoe consent current and Zoe replies switched on). A member
--    with Zoe off: no change. Doctor replies while already in doctor mode change nothing.
-- 3. doctor_zoe_hand_back(member): the assigned doctor (with care access) hands the thread back. doctor_zoe_mode(member)
--    reads the state for the conversation page. Members, nurses, admins and other doctors are refused.
-- 4. The member's line ("Your doctor is answering you now." / "Zoe is with you again.", EN/HY/RU): stored in
--    zoe_mode_notices and shown in the app chat as a Zoe text (inside conversation_member_thread's answers, so the
--    running app's contract is unchanged), and queued on Telegram (template zoe.mode, signed "Zoe: ") when the member has
--    an active Telegram route; it goes once staging approves zoe.mode (held at claim until then). COPY: UNAPPROVED v1, for Tatevik and Armen to confirm. The language is that of Zoe's
--    newest text to the member, else the app language.
-- 5. The worker reads doctor mode per claimed run (zoe_run_doctor_mode) and, after the urgent and red-flag checks, ends
--    the run with no model call (lib/zoe/pipeline.ts). zoe_run_finish is wrapped: in doctor mode a finish that would
--    send the member anything other than a safety text (urgent route, 103 window, red flag) is recorded as
--    discarded / doctor_mode_held with no member text and no receipt. This also covers a run already in flight when
--    the doctor took over. The previous function is kept, renamed, as _zoe_run_finish_core: a later change to the
--    finish edits _zoe_run_finish_core (scripts/check-zoe-doctor-takeover.sql fails if the wrapper is replaced).
-- 6. _zoe_replies_on is false in doctor mode (the Telegram acknowledgement is not held for Zoe), and the app's settledSeq
--    covers every member message, so the app shows "Sent to your care team" instead of "Zoe is writing".
-- Symptom intake: an active intake pauses (no turn is taken; the doctor sees its partial answers on the conversation
-- page) and ends by the usual 12-hour expiry, or goes on after the hand back. The per-member daily cap is unaffected:
-- doctor mode makes no model calls. No clinical rule changes.

-- 1. State ----------------------------------------------------------------------------------------------------------------
create table public.zoe_doctor_mode(
 conversation_id uuid primary key references public.conversations(id)on delete cascade,
 member_id uuid not null references auth.users(id)on delete cascade,
 doctor_mode boolean not null,
 changed_by uuid not null references auth.users(id),
 changed_at timestamptz not null default clock_timestamp(),
 reason text not null check(reason in('doctor_reply','hand_back')),
 check(doctor_mode=(reason='doctor_reply'))
);
alter table public.zoe_doctor_mode enable row level security;
revoke all on public.zoe_doctor_mode from public,anon,authenticated,service_role;

create table public.zoe_mode_notices(
 id uuid primary key default gen_random_uuid(),
 conversation_id uuid not null references public.conversations(id)on delete cascade,
 member_id uuid not null references auth.users(id)on delete cascade,
 kind text not null check(kind in('doctor_on','zoe_back')),
 body text not null check(length(body)between 1 and 200),
 language text not null check(language in('en','hy','ru')),
 system_message_id uuid references public.system_messages(id),
 created_at timestamptz not null default clock_timestamp()
);
create index zoe_mode_notices_thread on public.zoe_mode_notices(conversation_id,created_at);
alter table public.zoe_mode_notices enable row level security;
revoke all on public.zoe_mode_notices from public,anon,authenticated,service_role;

-- The Telegram template for the line (free body, signed "Zoe: " like every Zoe text). Unapproved like every template: the
-- Telegram copy is held at claim until staging approves it (docs/operations/staging-ai-mode.sql step 10; the go-live
-- withdrawal there includes it). The app line does not depend on it. Wording UNAPPROVED v1 (Tatevik, Armen).
insert into public.system_message_templates(template_id,version,locale,body,free_body,approval_note)values
 ('zoe.mode',1,'en','Zoe doctor-mode line (fixed text, supabase/migrations/20261020082321_zoe_doctor_takeover.sql).',true,'Approve on staging to send the doctor-mode lines on Telegram. Wording UNAPPROVED v1 (Tatevik, Armen).'),
 ('zoe.mode',1,'hy','Zoe doctor-mode line (fixed text, supabase/migrations/20261020082321_zoe_doctor_takeover.sql).',true,'Approve on staging to send the doctor-mode lines on Telegram. Wording UNAPPROVED v1 (Tatevik, Armen).');

create function public._zoe_doctor_mode(p_conversation uuid)returns boolean
language sql stable security definer set search_path=''as $$
 select coalesce((select m.doctor_mode from public.zoe_doctor_mode m where m.conversation_id=p_conversation),false)
$$;

-- Zoe writes to this member at all: Zoe consent current and Zoe's replies (conversational or health answers) switched on.
create function public._zoe_active_for(m uuid)returns boolean
language sql stable security definer set search_path=''as $$
 select coalesce((select(s.conversational_replies_enabled or s.health_answers_enabled)and public._zoe_consent_current(m,'zoe_reads_messages')
  from public.zoe_settings s where s.singleton),false)
$$;

-- 4. The member's line. UNAPPROVED v1 wording (Tatevik, Armen). Returns the notice id.
create function public._zoe_mode_notify(p_conversation uuid,m uuid,p_kind text,p_at timestamptz)returns uuid
language plpgsql security definer set search_path=''as $$
declare lang text;loc text;body text;nid uuid;pol public.conversation_policy;ep public.conversation_endpoints;t public.system_message_templates;smid uuid;
begin
 loc:=coalesce((select case when pr.locale='en'then 'en'else 'hy'end from public.profiles pr where pr.id=m),'hy');
 lang:=coalesce((select a.language from public.zoe_member_answers a where a.conversation_id=p_conversation order by a.created_at desc,a.id desc limit 1),loc);
 body:=case p_kind
  when 'doctor_on'then case lang when 'en'then 'Your doctor is answering you now.'when 'ru'then 'Сейчас вам отвечает ваш врач.'else 'Այժմ ձեզ պատասխանում է ձեր բժիշկը։'end
  else case lang when 'en'then 'Zoe is with you again.'when 'ru'then 'Zoe снова с вами.'else 'Zoe-ն կրկին ձեզ հետ է։'end end;
 insert into public.zoe_mode_notices(conversation_id,member_id,kind,body,language,created_at)values(p_conversation,m,p_kind,body,lang,p_at)returning id into nid;
 -- Telegram, when the member has an active route (the same route a doctor's reply takes). Approval is checked again at claim.
 select * into pol from public.conversation_policy where singleton;
 select e.* into ep from public.conversation_endpoints e where e.member_id=m and e.active and e.adapter='telegram'and e.expires_at>clock_timestamp()
  and e.policy_version=pol.version order by e.id limit 1;
 if ep.id is not null then
  select * into t from public.system_message_templates where template_id='zoe.mode'and locale=loc and free_body order by version desc limit 1;
  if found then
   insert into public.system_messages(member_id,template_id,template_version,locale,body,body_hash,endpoint_id,endpoint_generation)
   values(m,t.template_id,t.version,t.locale,'Zoe: '||body,public._system_message_hash(t.template_id,t.version,t.locale,'Zoe: '||body),ep.id,ep.generation)returning id into smid;
   perform public._system_message_audit(smid,'enqueued',jsonb_build_object('template',t.template_id,'version',t.version,'locale',t.locale));
   update public.zoe_mode_notices set system_message_id=smid where id=nid;
  end if;
 end if;
 return nid;
end$$;

-- 2. Takeover: the doctor's approved reply. Runs inside conversation_command, under its conversation lock.
create function public._zoe_doctor_takeover()returns trigger
language plpgsql security definer set search_path=''as $$
declare c public.conversations;nid uuid;
begin
 select cv.* into c from public.conversation_drafts d join public.conversations cv on cv.id=d.conversation_id where d.id=new.draft_id;
 if c.id is null or public._zoe_doctor_mode(c.id)or not public._zoe_active_for(c.member_id)then return null;end if;
 insert into public.zoe_doctor_mode(conversation_id,member_id,doctor_mode,changed_by,changed_at,reason)
 values(c.id,c.member_id,true,new.doctor_id,clock_timestamp(),'doctor_reply')
 on conflict(conversation_id)do update set doctor_mode=true,changed_by=excluded.changed_by,changed_at=excluded.changed_at,reason='doctor_reply';
 -- Shown just before the doctor's reply in the app chat.
 nid:=public._zoe_mode_notify(c.id,c.member_id,'doctor_on',new.created_at-interval '1 millisecond');
 insert into public.conversation_audit(conversation_id,actor_id,kind,detail)
 values(c.id,new.doctor_id,'zoe.doctor_mode_on',jsonb_build_object('approvalId',new.id,'version',c.version,'noticeId',nid,
  'intakeActive',exists(select 1 from public.zoe_symptom_intakes i where i.conversation_id=c.id and i.state='active')));
 return null;
end$$;
create trigger conversation_approvals_zoe_doctor_takeover after insert on public.conversation_approvals for each row execute function public._zoe_doctor_takeover();

-- 3. The doctor's surfaces ------------------------------------------------------------------------------------------------
create function public._zoe_mode_doctor(p_member uuid)returns uuid
language plpgsql stable security definer set search_path=''as $$
declare who jsonb:=public.real_clinical_staff_identity();me uuid;
begin
 if who is null or who->>'role'is distinct from 'doctor'then raise insufficient_privilege using message='Assigned doctor session required';end if;
 me:=(who->>'id')::uuid;
 if p_member is null or not exists(select 1 from public.patient_clinical_cases k where k.user_id=p_member and k.assigned_doctor_id=me and public.staff_care_access(k.user_id,me,true))then
  raise insufficient_privilege using message='Assigned doctor session required';end if;
 return me;
end$$;

create function public.doctor_zoe_mode(p_member uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare me uuid:=public._zoe_mode_doctor(p_member);c public.conversations;m public.zoe_doctor_mode;
begin
 select * into c from public.conversations where member_id=p_member;
 if c.id is not null then select * into m from public.zoe_doctor_mode where conversation_id=c.id;end if;
 perform public._access_audit_record(p_member,'doctor_zoe_mode','read');
 return jsonb_build_object('ok',true,'doctorMode',coalesce(m.doctor_mode,false),'zoeActive',public._zoe_active_for(p_member),
  'since',case when m.doctor_mode then m.changed_at end,
  'byName',case when m.doctor_mode then(select ws.display_name from public.workspace_staff ws where ws.user_id=m.changed_by)end,
  'intakePaused',coalesce(m.doctor_mode,false)and exists(select 1 from public.zoe_symptom_intakes i where i.conversation_id=c.id and i.state='active'));
end$$;

-- The hand back. Under the conversation row lock, which the doctor's reply and zoe_run_finish also take. Idempotent.
create function public.doctor_zoe_hand_back(p_member uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare me uuid:=public._zoe_mode_doctor(p_member);c public.conversations;nid uuid;
begin
 select * into c from public.conversations where member_id=p_member for update;
 if not found or not public._zoe_doctor_mode(c.id)then return jsonb_build_object('ok',true,'replayed',true);end if;
 update public.zoe_doctor_mode set doctor_mode=false,changed_by=me,changed_at=clock_timestamp(),reason='hand_back'where conversation_id=c.id;
 -- The member is told only while Zoe is on for them (consent withdrawn since: Zoe is not coming back to them).
 if public._zoe_active_for(p_member)then nid:=public._zoe_mode_notify(c.id,p_member,'zoe_back',clock_timestamp());end if;
 insert into public.conversation_audit(conversation_id,actor_id,kind,detail)values(c.id,me,'zoe.doctor_mode_off',jsonb_build_object('version',c.version,'noticeId',nid));
 perform public._access_audit_record(p_member,'doctor_zoe_mode','hand_back');
 return jsonb_build_object('ok',true,'replayed',false,'notified',nid is not null);
end$$;

-- 5. The worker ----------------------------------------------------------------------------------------------------------
create function public.zoe_run_doctor_mode(p_runs uuid[])returns jsonb
language plpgsql stable security definer set search_path=''as $$
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if p_runs is null or cardinality(p_runs)>50 then return '[]'::jsonb;end if;
 return coalesce((select jsonb_agg(jsonb_build_object('runId',r.id,'doctorMode',public._zoe_doctor_mode(r.conversation_id)))
  from public.zoe_runs r where r.id=any(p_runs)and r.state='started'),'[]'::jsonb);
end$$;

alter function public.zoe_run_finish(uuid,jsonb)rename to _zoe_run_finish_core;
revoke all on function public._zoe_run_finish_core(uuid,jsonb)from public,anon,authenticated,service_role;
comment on function public._zoe_run_finish_core(uuid,jsonb)is
 'zoe_run_finish before the doctor-mode guard (20261020082321). Change the finish here; zoe_run_finish wraps it.';

-- In doctor mode only safety texts reach the member; everything else is held with no member text and no receipt. The
-- run lock, then the conversation lock (the order _zoe_run_finish_core takes them).
create function public.zoe_run_finish(p_run uuid,p_result jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare r public.zoe_runs;o text;rs text;safety boolean;held jsonb;res jsonb;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 select * into r from public.zoe_runs where id=p_run for update;
 if not found or r.state='finished'or jsonb_typeof(p_result)is distinct from 'object'then return public._zoe_run_finish_core(p_run,p_result);end if;
 perform 1 from public.conversations where id=r.conversation_id for update;
 if not public._zoe_doctor_mode(r.conversation_id)then return public._zoe_run_finish_core(p_run,p_result);end if;
 o:=p_result->>'outcome';rs:=p_result->>'reason';
 safety:=o='intake_escalated'or(o='discarded'and rs in('urgent_route_no_model_call','urgent_in_window_no_model_call','urgent_health_answer_model','urgent_health_answer_red_flag_yes'));
 if safety then return public._zoe_run_finish_core(p_run,p_result-'receipt');end if;
 -- Doctor-facing outcomes (and a discard with no text) keep their reason, summary and draft; nothing goes to the member.
 if o in('draft_proposed','draft_blocked','summary_only','no_output')or(o='discarded'and jsonb_typeof(p_result->'answer')is distinct from 'string')then
  held:=p_result-'receipt'-'answer'-'language';
 else held:=(p_result-'receipt'-'answer'-'language'-'intake'-'chat'-'health'-'summary'-'draft')||jsonb_build_object('outcome','discarded','reason','doctor_mode_held');
 end if;
 res:=public._zoe_run_finish_core(p_run,held);
 if p_result is distinct from held then
  select * into r from public.zoe_runs where id=p_run;
  perform public._zoe_run_events(r,jsonb_build_array(jsonb_build_object('name','zoe.guard.doctor_mode','outcome','block','reason','doctor_mode_member_text_held',
   'rule','zoe.doctor_mode','ruleVersion','zoe-doctor-mode-1','actor','system','attributes',jsonb_build_object('noreon.zoe.guard.name','doctor_mode',
   'noreon.zoe.doctor_mode.outcome',left(coalesce(o,'none'),40)))));
 end if;
 return res;
end$$;

-- 6. Doctor mode is not "Zoe will reply" --------------------------------------------------------------------------------
create or replace function public._zoe_replies_on(m uuid)returns boolean
language sql stable security definer set search_path=''as $$
 select coalesce((select s.conversational_replies_enabled and s.consent_collection_enabled and s.consent_wording_version is not null
   and public._zoe_consent_current(m,'zoe_reads_messages')
   and exists(select 1 from public.patient_clinical_cases cs where cs.user_id=m and cs.assigned_doctor_id is not null)
   and public._zoe_template_ok('zoe.receipt',coalesce((select case when pr.locale='en'then 'en'else 'hy'end from public.profiles pr where pr.id=m),'hy'))
   -- 20261020082321: not while the doctor has the conversation.
   and not exists(select 1 from public.conversations c join public.zoe_doctor_mode dm on dm.conversation_id=c.id where c.member_id=m and dm.doctor_mode)
  from public.zoe_settings s where s.singleton),false)
$$;

-- 4. The member's chat (from 20261018121002; change marked 20261020082321): the doctor-mode lines are Zoe texts in answers.
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
  'settledSeq',case when public._zoe_doctor_mode(c.id)then coalesce((select max(m2.seq)from public.conversation_messages m2 where m2.conversation_id=c.id),0)
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
    select n.id,n.body,n.created_at from public.zoe_mode_notices n where n.conversation_id=c.id and n.member_id=m and(since is null or n.created_at>=since))q),'[]'));
end$$;

revoke all on function public._zoe_doctor_mode(uuid),public._zoe_active_for(uuid),public._zoe_mode_notify(uuid,uuid,text,timestamptz),public._zoe_doctor_takeover(),
 public._zoe_mode_doctor(uuid),public.doctor_zoe_mode(uuid),public.doctor_zoe_hand_back(uuid),public.zoe_run_doctor_mode(uuid[]),public.zoe_run_finish(uuid,jsonb)
 from public,anon,authenticated,service_role;
grant execute on function public.doctor_zoe_mode(uuid),public.doctor_zoe_hand_back(uuid)to authenticated;
grant execute on function public.zoe_run_doctor_mode(uuid[]),public.zoe_run_finish(uuid,jsonb)to service_role;
comment on function public.doctor_zoe_hand_back(uuid)is
 'The assigned doctor hands a member''s conversation back to Zoe after taking it over by replying. The member is told ("Zoe is with you again.", UNAPPROVED v1) in the app and on Telegram.';
comment on function public.zoe_run_finish(uuid,jsonb)is
 'Doctor-mode guard (20261020082321) around _zoe_run_finish_core: in doctor mode only urgent, 103-window and red-flag texts reach the member.';
