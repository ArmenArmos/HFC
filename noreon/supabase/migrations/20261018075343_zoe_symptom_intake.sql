-- Zoe symptom intake (Khikar, 18 Oct 2026 11:32: "Zoe should be proper AI: no health advice, but hold
-- an overall conversation and ask questions ... Then say it will contact my doctor with the summary";
-- lead safety design 18 Oct). Ships OFF.
--
-- When a member mentions a symptom, Zoe asks the questions of a clinician-owned symptom sheet (DRAFT,
-- pending Armen's sign-off) in the high tier and fills a structured record; the app's deterministic
-- red-flag rules run on every message before any model and stop the intake for the 103 path and a
-- care-team alert; at the end the doctor gets a summary built from the record only, plus a Telegram
-- staff notice with no health details. Sheet content, rules, guard and summary live in the app
-- (lib/zoe/symptoms); the database holds the registry, the record, the switch and the delivery.
--
-- 1. zoe_settings.symptom_intake_enabled (default off). A trigger allows it only with real model calls
--    allowed, with staging_ai_mode or every registered sheet signed, and (when switched on) a passing
--    model-mode eval of the high tier that ran the intake rows in the last 7 days.
-- 2. zoe_symptom_sheets: the registry the app checks (id, version, draft/signed). Seeded as drafts.
-- 3. zoe_symptom_intakes: one row per intake; one active per conversation. RLS on, no table grants.
-- 4. zoe_runs outcomes intake_asked, intake_completed, intake_escalated; zoe_member_answers.kind.
-- 5. zoe_run_claim: the intake part of the job (switch, registry, active intake, latest reading,
--    the doctor's name, where red-flag checking restarts), and idle intakes expire after 12 hours
--    with their summary delivered. Otherwise unchanged from 20261018073940 (#265: the consent line).
-- 6. zoe_run_finish: the intake outcomes. Otherwise unchanged from 20261017202157 §1.
-- 7. Doctor and member reads; 8. the staff notice; 9. grants.

-- 1. Sheet registry ---------------------------------------------------------------------------------
create table public.zoe_symptom_sheets (
 sheet_id text not null check(sheet_id ~ '^[a-z][a-z0-9_]{1,39}$'),
 version integer not null check(version>0),
 status text not null default 'draft'check(status in('draft','signed')),
 -- Who signed it clinically (Armen or the designated clinical owner), and when. Never the app.
 signed_by text check(length(signed_by)between 1 and 120),
 signed_at timestamptz,
 registered_at timestamptz not null default clock_timestamp(),
 primary key(sheet_id,version),
 check((status='signed')=(signed_by is not null and signed_at is not null))
);
comment on table public.zoe_symptom_sheets is
 'Symptom sheets the app may use (content in lib/zoe/symptoms/sheets.ts). Draft until clinically signed; real members need every sheet signed (GO_LIVE_GATES).';
insert into public.zoe_symptom_sheets(sheet_id,version)values
 ('headache',1),('dizziness',1),('chest_discomfort',1),('palpitations',1),('shortness_of_breath',1),('swelling',1),('fatigue',1),('other',1);

-- 2. The switch ----------------------------------------------------------------------------------------
alter table public.zoe_settings add column symptom_intake_enabled boolean not null default false;
comment on column public.zoe_settings.symptom_intake_enabled is
 'Zoe asks the symptom sheet questions and sends the doctor a summary. Needs real calls, staging_ai_mode or signed sheets, and a passing intake eval.';

create function public._zoe_symptom_intake_guard()returns trigger language plpgsql set search_path=''as $$
begin
 if not new.symptom_intake_enabled then return new;end if;
 if not new.model_calls_allowed then
  raise exception using errcode='23514',message='Symptom intake needs real AI calls allowed (model_calls_allowed)';end if;
 -- Checked on every change, so staging AI mode cannot be switched off under unsigned sheets.
 if not new.staging_ai_mode and exists(select 1 from public.zoe_symptom_sheets where status<>'signed')then
  raise exception using errcode='23514',message='Symptom intake without staging_ai_mode needs every symptom sheet signed';end if;
 if tg_op='UPDATE'and old.symptom_intake_enabled then return new;end if;
 if not exists(select 1 from public.zoe_eval_runs e join public.zoe_tier_config c on c.tier='high'and c.model_id=e.model_id
  where e.mode='model'and e.tier='high'and e.must_failures=0 and e.harness_version ~ '\+intake-[1-9][0-9]*'and e.created_at>clock_timestamp()-interval '7 days')then
  raise exception using errcode='23514',message='Symptom intake needs a passing model-mode eval of the high tier model with the intake rows in the last 7 days';end if;
 return new;
end$$;
create trigger zoe_symptom_intake_guard before insert or update on public.zoe_settings for each row execute function public._zoe_symptom_intake_guard();

-- 3. Intakes -----------------------------------------------------------------------------------------
create table public.zoe_symptom_intakes (
 id uuid primary key default gen_random_uuid(),
 conversation_id uuid not null references public.conversations(id)on delete cascade,
 member_id uuid not null references auth.users(id)on delete cascade,
 sheet_id text not null,sheet_version integer not null,
 state text not null default 'active'check(state in('active','completed','stopped','escalated','expired')),
 language text not null check(language in('en','hy','ru')),
 started_seq bigint not null,last_seq bigint not null check(last_seq>=started_seq),
 last_run_id uuid references public.zoe_runs(id)on delete set null,
 -- The structured record (answers the app's checks accepted, questions asked, red flags). App-validated JSON.
 record jsonb not null check(jsonb_typeof(record)='object'and length(record::text)<=32000),
 -- The doctor summary, built by the app from the record only. While active: what the doctor gets if the member goes quiet.
 summary jsonb check(jsonb_typeof(summary)='object'and length(summary::text)<=32000),
 ending text check(ending in('complete','member_stopped','red_flag','expired','about_someone_else','turn_limit')),
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 finished_at timestamptz,
 foreign key(sheet_id,sheet_version)references public.zoe_symptom_sheets(sheet_id,version),
 check((state='active')=(finished_at is null)),
 check(state='active'or(summary is not null and ending is not null))
);
create unique index zoe_symptom_intakes_one_active on public.zoe_symptom_intakes(conversation_id)where state='active';
create index zoe_symptom_intakes_member on public.zoe_symptom_intakes(member_id,created_at desc);
create index zoe_symptom_intakes_idle on public.zoe_symptom_intakes(updated_at)where state='active';
comment on table public.zoe_symptom_intakes is
 'Zoe symptom intakes. record and summary hold member health answers; read only through definer functions; retention open (Q17), deleted with the account.';

-- One Telegram staff notice per finished intake and recipient (no health details).
create table public.zoe_symptom_intake_notices (
 intake_id uuid not null references public.zoe_symptom_intakes(id)on delete cascade,
 recipient_id uuid not null references auth.users(id)on delete cascade,
 recipient_role text not null check(recipient_role in('doctor','admin')),
 telegram_message_id uuid not null unique references public.telegram_auth_messages(id),
 created_at timestamptz not null default clock_timestamp(),
 primary key(intake_id,recipient_id)
);

-- 4. Run outcomes and answer kinds ------------------------------------------------------------------------
alter table public.zoe_runs drop constraint zoe_runs_outcome_check;
alter table public.zoe_runs add constraint zoe_runs_outcome_check check(outcome in('draft_proposed','draft_blocked','summary_only','discarded','no_output','stale','skipped','answered',
 'intake_asked','intake_completed','intake_escalated'));
alter table public.zoe_member_answers add column kind text not null default 'answer'check(kind in('answer','intake','urgent'));
comment on column public.zoe_member_answers.kind is
 'answer: logistics/app help; intake: a symptom-sheet question or the closing text; urgent: the fixed 103 text after a red flag.';

-- Staff notice wording: placeholders, held at claim until approved.
insert into public.system_message_templates(template_id,version,locale,body)values
 ('zoe_intake.notice',1,'en','UNAPPROVED PLACEHOLDER. Zoe has sent you a symptom summary for a member. Open it in the Noreon staff app.'),
 ('zoe_intake.notice',1,'hy','UNAPPROVED PLACEHOLDER. Zoe-ն ձեզ ուղարկել է անդամի ախտանիշների ամփոփում։ Բացեք այն Noreon-ի աշխատակազմի հավելվածում։');

-- 8. The staff notice (defined before the functions that call it) ------------------------------------------
-- Recipients as staff_message.notice (20261017121556): the assigned doctor when active staff, else every
-- active admin; only staff with an active staff Telegram binding. Content: a fixed sentence and an open
-- button to the conversation. No member name, no symptom, no answer. Never raises.
create function public._zoe_intake_notice(p_intake uuid)returns void
language plpgsql security definer set search_path=''as $$
declare i public.zoe_symptom_intakes;s public.staff_message_notice_settings;doc uuid;doctor_active boolean;r record;mid uuid;url text;queued integer:=0;
begin
 select * into i from public.zoe_symptom_intakes where id=p_intake;
 if not found then return;end if;
 select * into s from public.staff_message_notice_settings where singleton;
 if not found or not s.enabled then
  perform public._conversation_trace(i.member_id,i.conversation_id,'zoe_intake',i.id::text,'doctor_alert','zoe.intake.staff_notice_skipped','skipped','staff_notice_off','zoe.intake_notice','1','system',null,'{}');return;end if;
 select assigned_doctor_id into doc from public.patient_clinical_cases where user_id=i.member_id;
 doctor_active:=doc is not null and exists(select 1 from public.workspace_staff where user_id=doc and role='doctor'and active and removed_at is null);
 url:=s.staff_origin||case when doctor_active then '/staff/real/conversations/'||i.member_id::text when doc is null then '/staff/real/unassigned'else '/staff/real/members/'||i.member_id::text end;
 for r in select ws.user_id,ws.role,b.address,b.principal_ref from public.workspace_staff ws
  join lateral(select address,principal_ref from public.telegram_auth_bindings where auth_user_id=ws.user_id and kind='staff'and active order by created_at desc limit 1)b on true
  where ws.active and ws.removed_at is null and(case when doctor_active then ws.user_id=doc and ws.role='doctor'else ws.role='admin'end)
   and not exists(select 1 from public.zoe_symptom_intake_notices n where n.intake_id=i.id and n.recipient_id=ws.user_id)
  order by ws.user_id loop
  mid:=public._telegram_auth_enqueue('zoe_intake.notice',public._telegram_auth_locale(r.user_id),r.address,r.principal_ref,jsonb_build_object('kind','open_url','url',url),null);
  if mid is null then continue;end if;
  insert into public.zoe_symptom_intake_notices(intake_id,recipient_id,recipient_role,telegram_message_id)values(i.id,r.user_id,r.role,mid);
  queued:=queued+1;
 end loop;
 perform public._conversation_trace(i.member_id,i.conversation_id,'zoe_intake',i.id::text,'doctor_alert',
  case when queued>0 then 'zoe.intake.staff_notice_queued'else 'zoe.intake.staff_notice_skipped'end,case when queued>0 then 'queued'else 'skipped'end,
  case when queued>0 then 'staff_notice_queued'else 'no_enrolled_staff'end,'zoe.intake_notice','1','system',null,
  jsonb_build_object('noreon.staff_notice.recipients',queued,'noreon.staff_notice.to',case when doctor_active then 'assigned_doctor'else 'admins'end));
exception when others then
 raise warning 'zoe intake notice dropped (%)',sqlstate;
end$$;

-- 5. Claim -------------------------------------------------------------------------------------------------
create or replace function public.zoe_run_claim(p_limit integer)returns jsonb
language plpgsql security definer set search_path=''as $$
declare s public.zoe_settings;rec record;r public.zoe_runs;jobs jsonb:='[]';consent boolean;skip text;since timestamptz;ix public.zoe_symptom_intakes;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 for r in update public.zoe_runs set state='finished',outcome='no_output',reason_code='worker_lost',finished_at=clock_timestamp()
  where state='started'and started_at<clock_timestamp()-interval '10 minutes'returning * loop
  perform public._zoe_run_events(r,jsonb_build_array(jsonb_build_object('name','zoe.route','outcome','failed','reason','worker_lost','rule','zoe.pipeline','ruleVersion','1','actor','system','attributes',jsonb_build_object('noreon.zoe.run.outcome','no_output'))));
 end loop;
 -- An intake idle for 12 hours ends; the doctor still gets what the member answered.
 for ix in update public.zoe_symptom_intakes set state='expired',ending='expired',finished_at=clock_timestamp(),updated_at=clock_timestamp(),
   summary=jsonb_set(summary,'{ending}','"expired"')
  where state='active'and updated_at<clock_timestamp()-interval '12 hours'and summary is not null returning * loop
  perform public._conversation_trace(ix.member_id,ix.conversation_id,'zoe_intake',ix.id::text,'zoe','zoe.intake.expired','recorded','member_idle_12h','zoe.symptom_intake','1','system',null,
   jsonb_build_object('noreon.zoe.intake.sheet',ix.sheet_id));
  perform public._zoe_intake_notice(ix.id);
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
  -- Consent as 20261018073940 (#265): only a grant of the current wording (or one kept valid) counts.
  consent:=s.singleton is not null and s.consent_collection_enabled and s.consent_wording_version is not null
   and public._zoe_consent_current(rec.member_id,'zoe_reads_messages');
  skip:=case when s.singleton is null or not s.consent_collection_enabled or s.consent_wording_version is null then 'zoe_settings_off'
   when not consent then 'no_zoe_reads_messages_consent' when rec.assigned_doctor_id is null then 'no_assigned_doctor'
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
  since:=(select max(ap.created_at)from public.conversation_approvals ap join public.conversation_drafts d on d.id=ap.draft_id where d.conversation_id=rec.conversation_id);
  select * into ix from public.zoe_symptom_intakes where conversation_id=rec.conversation_id and state='active';
  jobs:=jobs||jsonb_build_array(jsonb_build_object('runId',r.id,'memberId',rec.member_id,'messageSeq',rec.seq,'displayName',rec.display_name,
   'messages',(select jsonb_agg(jsonb_build_object('seq',w.seq,'text',w.body,'minutesAgo',w.ago)order by w.seq)from(
     select m.seq,m.body,floor(extract(epoch from clock_timestamp()-m.created_at)/60)::integer ago from public.conversation_messages m
     -- An active intake keeps its own messages in the window, whatever was approved since.
     where m.conversation_id=rec.conversation_id and m.seq<=rec.seq and(since is null or m.created_at>since or m.seq=rec.seq or m.seq>=ix.started_seq)order by m.seq desc limit 20)w),
   'replies',coalesce((select jsonb_agg(jsonb_build_object('body',x.body,'minutesAgo',x.ago)order by x.created_at)from(
     select ap.body,ap.created_at,floor(extract(epoch from clock_timestamp()-ap.created_at)/60)::integer ago from public.conversation_approvals ap
     join public.conversation_drafts d on d.id=ap.draft_id where d.conversation_id=rec.conversation_id order by ap.created_at desc limit 3)x),'[]'),
   'answers',coalesce((select jsonb_agg(jsonb_build_object('body',x.body,'minutesAgo',x.ago)order by x.created_at)from(
     select a.body,a.created_at,floor(extract(epoch from clock_timestamp()-a.created_at)/60)::integer ago from public.zoe_member_answers a
     where a.conversation_id=rec.conversation_id and(since is null or a.created_at>since or a.message_seq>=ix.started_seq)order by a.created_at desc limit 10)x),'[]'),
   'directAnswers',coalesce(s.direct_answers_enabled,false))
   ||case when coalesce(s.symptom_intake_enabled,false)then jsonb_build_object('intake',jsonb_build_object('enabled',true,
     'registered',coalesce((select jsonb_agg(jsonb_build_object('id',sh.sheet_id,'version',sh.version)order by sh.sheet_id)from public.zoe_symptom_sheets sh),'[]'),
     'active',case when ix.id is null then null else jsonb_build_object('id',ix.id,'sheetId',ix.sheet_id,'sheetVersion',ix.sheet_version,'startedSeq',ix.started_seq,'language',ix.language,'record',ix.record)end,
     'doctorName',(select ws.display_name from public.workspace_staff ws where ws.user_id=rec.assigned_doctor_id and ws.active and ws.removed_at is null),
     'latestReading',(select jsonb_build_object('systolic',pm.systolic,'diastolic',pm.diastolic,'minutesAgo',greatest(0,floor(extract(epoch from clock_timestamp()-pm.measured_at)/60))::integer)
       from public.patient_measurements pm where pm.user_id=rec.member_id order by pm.measured_at desc limit 1),
     'redFlagsAfterSeq',coalesce((select max(zr.message_seq)from public.zoe_runs zr where zr.conversation_id=rec.conversation_id and zr.outcome='intake_escalated'),0)))
   else '{}'::jsonb end);
  r:=null;ix:=null;
 end loop;
 return jobs;
end$$;

-- 6. Finish ------------------------------------------------------------------------------------------------
-- The intake outcomes (new §6a); everything else unchanged from 20261017202157 §1.
-- §6a: red always wins: an escalation is never made stale (a newer message or doctor work) and its fixed
-- urgent text and care-team alert always go out. A question needs the conversation unchanged since the
-- claim. Model-written text from the stand-in is never sent and never written to the record; the sheet's
-- own wording and fixed texts are.
-- Intake texts use the zoe.answer channel and its approval like Zoe's other answers; the urgent text is
-- shown in the app thread whatever, and on Telegram also queued as zoe.urgent when zoe.answer is not approved.
create or replace function public.zoe_run_finish(p_run uuid,p_result jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare r public.zoe_runs;c public.conversations;v_outcome text;v_reason text;d uuid;cr bigint;src text;v_summary text;v_draft text;v_sealed text;reasons text[];v_tier text;v_tier_reason text;
 v_answer text;v_lang text;msg public.conversation_messages;aid uuid;smid uuid;
 ik jsonb;iid uuid;v_state text;v_kind text;v_author text;v_send boolean;answer_ok boolean;flags text[];
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 select * into r from public.zoe_runs where id=p_run for update;
 if not found then return jsonb_build_object('ok',false,'code','run_unknown');end if;
 if r.state='finished'then return jsonb_build_object('ok',true,'outcome',r.outcome,'replayed',true);end if;
 v_outcome:=p_result->>'outcome';v_reason:=p_result->>'reason';v_summary:=nullif(btrim(p_result->>'summary'),'');v_draft:=nullif(btrim(p_result->>'draft'),'');v_sealed:=p_result->>'sealed';
 v_answer:=nullif(btrim(p_result->>'answer'),'');v_lang:=p_result->>'language';
 v_tier:=coalesce(p_result->>'tier',r.tier,'none');v_tier_reason:=coalesce(p_result->>'tierReason','not_routed');
 ik:=case when jsonb_typeof(p_result->'intake')='object'then p_result->'intake'end;
 if length(v_sealed)>200000 then v_sealed:=null;end if;
 if v_outcome is null or v_outcome not in('draft_proposed','draft_blocked','summary_only','discarded','no_output','answered','intake_asked','intake_completed','intake_escalated')or coalesce(v_reason,'')!~'^[a-z0-9_.:-]{1,80}$'
  or length(v_summary)>4000 or length(v_draft)>2000 or(v_outcome='draft_proposed'and(v_draft is null or v_summary is null))
  or(v_outcome='answered'and(v_answer is null or length(v_answer)>700 or v_summary is null or v_tier<>'low'or not r.reserved or coalesce(v_lang,'')not in('en','hy','ru')))
  -- §6a: an intake outcome carries its intake, a text for the member and its language; the high tier or no model.
  or(v_outcome like 'intake\_%'and(ik is null or v_answer is null or length(v_answer)>700 or coalesce(v_lang,'')not in('en','hy','ru')or v_tier not in('none','high')
   or coalesce(ik->>'state','')not in('active','completed','stopped','escalated')or(v_outcome='intake_asked')<>(ik->>'state'='active')or(v_outcome='intake_escalated')<>(ik->>'state'='escalated')
   or coalesce(ik->>'answerSource','')not in('model','sheet','fixed')or coalesce(ik->>'language','')not in('en','hy','ru')
   or jsonb_typeof(ik->'record')is distinct from 'object'or length((ik->'record')::text)>32000
   or(jsonb_typeof(ik->'summary')is distinct from 'object'and(ik->>'state'<>'escalated'or ik->>'sheetId'<>'none'))or length(coalesce(ik->'summary','{}')::text)>32000
   or(ik->>'id'is not null and ik->>'id'!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
   or(ik->>'sheetId'<>'none'and not exists(select 1 from public.zoe_symptom_sheets sh where sh.sheet_id=ik->>'sheetId'and sh.version::text=ik->>'sheetVersion'))
   or(ik->>'sheetId'='none'and v_outcome<>'intake_escalated')
   or(jsonb_typeof(ik->'alertRedFlags')='array'and not(array(select jsonb_array_elements_text(ik->'alertRedFlags'))<@ array['RF-01','RF-02','RF-03','RF-04','RF-05']))))
  or(v_outcome not like 'intake\_%'and ik is not null)
  or jsonb_typeof(coalesce(p_result->'guardReasons','[]'))<>'array'
  or coalesce(p_result->>'provider','none')!~'^[a-z0-9_.-]{1,64}$'or coalesce(p_result->>'model','none')!~'^[a-z0-9_.:/-]{1,80}$'
  or coalesce((p_result->>'costUsd')::numeric,0)<0
  or v_tier not in('none','low','medium','high')or v_tier_reason!~'^[a-z0-9_.:-]{1,80}$'
  or(r.tier is not null and v_tier<>r.tier)then
  return jsonb_build_object('ok',false,'code','invalid');end if;
 select coalesce(array_agg(x)filter(where x~'^[a-z0-9_.:-]{1,80}$'),'{}')into reasons from jsonb_array_elements_text(p_result->'guardReasons')x;
 perform public._zoe_run_events(r,p_result->'events');
 if v_outcome like 'intake\_%'then
  select * into c from public.conversations where id=r.conversation_id for update;
  v_state:=ik->>'state';iid:=(ik->>'id')::uuid;
  if v_outcome<>'intake_escalated'and c.version<>r.context_version then v_outcome:='stale';v_reason:='newer_member_message';
  elsif v_outcome='intake_asked'and c.draft_epoch<>r.draft_epoch then v_outcome:='stale';v_reason:='doctor_work_since_claim';
  elsif v_outcome<>'intake_escalated'and iid is not null and not exists(select 1 from public.zoe_symptom_intakes where id=iid and conversation_id=c.id and state='active')then v_outcome:='stale';v_reason:='intake_not_active';
  elsif v_outcome<>'intake_escalated'and iid is null and exists(select 1 from public.zoe_symptom_intakes where conversation_id=c.id and state='active')then v_outcome:='stale';v_reason:='intake_already_active';
  else
   -- The intake row. A stand-in model turn never writes a member's record (its answers are fixtures).
   if ik->>'sheetId'<>'none'and not(ik->>'answerSource'='model'and coalesce(p_result->>'provider','none')in('none','noreon.fake'))then
    if iid is null then select id into iid from public.zoe_symptom_intakes where conversation_id=c.id and state='active';end if;
    if iid is not null and exists(select 1 from public.zoe_symptom_intakes where id=iid and conversation_id=c.id and state='active')then
     update public.zoe_symptom_intakes set state=v_state,record=ik->'record',summary=coalesce(ik->'summary',summary),ending=case when v_state<>'active'then ik#>>'{summary,ending}'end,
      language=ik->>'language',last_seq=greatest(last_seq,r.message_seq),last_run_id=r.id,updated_at=clock_timestamp(),finished_at=case when v_state<>'active'then clock_timestamp()end
     where id=iid;
    elsif iid is null then
     insert into public.zoe_symptom_intakes(conversation_id,member_id,sheet_id,sheet_version,state,language,started_seq,last_seq,last_run_id,record,summary,ending,finished_at)
     values(c.id,r.member_id,ik->>'sheetId',(ik->>'sheetVersion')::integer,v_state,ik->>'language',least((ik->>'startedSeq')::bigint,r.message_seq),r.message_seq,r.id,ik->'record',ik->'summary',
      case when v_state<>'active'then ik#>>'{summary,ending}'end,case when v_state<>'active'then clock_timestamp()end)returning id into iid;
    else iid:=null;
    end if;
   end if;
   -- The text to the member.
   v_kind:=case when v_outcome='intake_escalated'then 'urgent'else 'intake'end;
   v_author:=case when ik->>'answerSource'='model'then coalesce(p_result->>'provider','none')else 'noreon.rules'end;
   answer_ok:=coalesce((select t.approved from public.system_message_templates t where t.template_id='zoe.answer'and t.free_body
    and t.locale=coalesce((select case when pr.locale='en'then 'en'else 'hy'end from public.profiles pr where pr.id=r.member_id),'hy')order by t.version desc limit 1),false);
   v_send:=true;
   if v_author in('none','noreon.fake')then v_send:=false;v_reason:='stand_in_answer_not_sent';
   elsif v_kind<>'urgent'and not answer_ok then v_send:=false;v_reason:='intake_wording_unapproved';
   end if;
   select * into msg from public.conversation_messages where conversation_id=c.id and seq=r.message_seq;
   if v_send then
    insert into public.zoe_member_answers(conversation_id,member_id,run_id,message_seq,body,language,provider,model,kind)
    values(c.id,r.member_id,r.id,r.message_seq,v_answer,v_lang,v_author,case when v_author='noreon.rules'then 'symptom-intake-fixed'else coalesce(p_result->>'model','none')end,v_kind)returning id into aid;
    if msg.source='telegram_member'and msg.request_id is not null and(answer_ok or v_kind<>'urgent')then
     smid:=public._zoe_answer_enqueue(r.member_id,msg.request_id,v_answer);
     update public.zoe_member_answers set system_message_id=smid where id=aid;
    end if;
   end if;
   -- Red flag: Telegram also gets the fixed urgent template when the answer channel cannot carry it.
   if v_kind='urgent'and msg.source='telegram_member'and msg.request_id is not null and smid is null then
    perform public._system_message_enqueue('zoe.urgent',r.member_id,e,msg.request_id)from public.channel_inbox i join public.conversation_endpoints e on e.id=i.endpoint_id
     where i.id=msg.request_id and e.member_id=r.member_id and e.active;
   end if;
   -- Red flag: the care-team alert (source zoe; RF ids where one applies).
   if v_kind='urgent'and(public._care_alert_settings()).enabled is true then
    select coalesce(array_agg(x),'{}')into flags from jsonb_array_elements_text(coalesce(ik->'alertRedFlags','[]'))x;
    perform public._care_alert_screen(r.member_id,'zoe','intake:'||r.id::text,'escalate','symptom_red_flag',flags,'zoe.symptom_red_flags','symptom-red-flags-draft-1');
   end if;
   -- An ending: the doctor's summary is the intake row; the doctor gets the staff notice.
   if iid is not null and v_state<>'active'then perform public._zoe_intake_notice(iid);end if;
   insert into public.conversation_audit(conversation_id,actor_id,kind,detail)values(c.id,null,'zoe.intake',jsonb_build_object('runId',r.id,'intakeId',iid,'seq',r.message_seq,'state',v_state,
    'answerId',aid,'kind',v_kind,'source',ik->>'answerSource','channel',case when msg.source='telegram_member'then 'telegram'else 'app'end,'telegram',smid is not null));
  end if;
 elsif v_outcome='answered'then
  select * into c from public.conversations where id=r.conversation_id for update;
  if c.version<>r.context_version then v_outcome:='stale';v_reason:='newer_member_message';
  elsif c.draft_epoch<>r.draft_epoch then v_outcome:='stale';v_reason:='doctor_work_since_claim';
  elsif not coalesce((select direct_answers_enabled from public.zoe_settings where singleton),false)then v_outcome:='summary_only';v_reason:='direct_answers_off';
  elsif coalesce(p_result->>'provider','none')in('none','noreon.fake')then v_outcome:='summary_only';v_reason:='stand_in_answer_not_sent';
  elsif not coalesce((select t.approved from public.system_message_templates t where t.template_id='zoe.answer'and t.free_body
    and t.locale=coalesce((select case when pr.locale='en'then 'en'else 'hy'end from public.profiles pr where pr.id=r.member_id),'hy')
    order by t.version desc limit 1),false)then
   v_outcome:='summary_only';v_reason:='direct_answer_unapproved';
  else
   select * into msg from public.conversation_messages where conversation_id=c.id and seq=r.message_seq;
   insert into public.zoe_member_answers(conversation_id,member_id,run_id,message_seq,body,language,provider,model)
   values(c.id,r.member_id,r.id,r.message_seq,v_answer,v_lang,p_result->>'provider',coalesce(p_result->>'model','none'))returning id into aid;
   if msg.source='telegram_member'and msg.request_id is not null then
    smid:=public._zoe_answer_enqueue(r.member_id,msg.request_id,v_answer);
    update public.zoe_member_answers set system_message_id=smid where id=aid;
   end if;
   insert into public.conversation_audit(conversation_id,actor_id,kind,detail)values(c.id,null,'zoe.answered',jsonb_build_object('runId',r.id,'answerId',aid,'seq',r.message_seq,'channel',case when msg.source='telegram_member'then 'telegram'else 'app'end,'telegram',smid is not null));
  end if;
 elsif v_outcome='draft_proposed'then
  select * into c from public.conversations where id=r.conversation_id for update;
  if c.version<>r.context_version then v_outcome:='stale';v_reason:='newer_member_message';
  elsif c.draft_epoch<>r.draft_epoch then v_outcome:='stale';v_reason:='doctor_work_since_claim';
  elsif exists(select 1 from public.conversation_drafts dd join public.conversation_revisions rv on rv.draft_id=dd.id and rv.revision=dd.revision
   where dd.conversation_id=c.id and dd.state in('pending','info_requested')and dd.context_version=c.version and rv.author_kind='staff')then v_outcome:='summary_only';v_reason:='doctor_draft_present';
  else
   select revision into cr from public.patient_clinical_cases where user_id=r.member_id;
   src:=public.patient_clinical_evidence(r.member_id)->>'token';
   update public.conversation_intents set state='invalidated'where state='open'and draft_id in(select id from public.conversation_drafts where conversation_id=c.id);
   update public.conversation_drafts set state='superseded'where conversation_id=c.id and state in('pending','info_requested');
   update public.conversations set draft_epoch=draft_epoch+1 where id=c.id;
   insert into public.conversation_drafts(conversation_id,state,context_version,clinical_revision,source_token)values(c.id,'pending',c.version,cr,src)returning id into d;
   insert into public.conversation_revisions(draft_id,revision,body,summary,content_hash,author_id,author_kind,provenance)
   values(d,1,v_draft,v_summary,public._conversation_hash(c.id,r.member_id,v_draft),null,'ai_assistant',
    jsonb_build_object('kind','zoe','engine',coalesce(p_result->>'provider','none'),'version',left(coalesce(p_result->>'configVersion','unknown'),128),'protocolVersion','not-clinical','runId',r.id));
  end if;
 end if;
 if v_outcome='discarded'and v_reason in('urgent_route_no_model_call','urgent_in_window_no_model_call')then
  select * into msg from public.conversation_messages where conversation_id=r.conversation_id and seq=r.message_seq;
  if msg.source='telegram_member'and msg.request_id is not null then
   perform public._system_message_enqueue('zoe.urgent',r.member_id,e,msg.request_id)from public.channel_inbox i join public.conversation_endpoints e on e.id=i.endpoint_id
    where i.id=msg.request_id and e.member_id=r.member_id and e.active;
  end if;
 end if;
 update public.zoe_runs z set state='finished',outcome=v_outcome,reason_code=v_reason,provider=coalesce(p_result->>'provider','none'),model=coalesce(p_result->>'model','none'),
  config_version=left(coalesce(p_result->>'configVersion','unknown'),200),cost_usd=case when z.reserved then coalesce((p_result->>'costUsd')::numeric,0)end,
  input_tokens=(p_result#>>'{usage,inputTokens}')::integer,output_tokens=(p_result#>>'{usage,outputTokens}')::integer,latency_ms=(p_result->>'latencyMs')::integer,
  redaction_count=coalesce((p_result->>'redactionCount')::integer,0),guard_reasons=reasons,
  summary=case when d is null then v_summary end,draft_id=d,sealed_io=v_sealed,finished_at=clock_timestamp(),
  tier=v_tier,tier_reason=v_tier_reason,fallback_used=coalesce((p_result->>'fallbackUsed')::boolean,false)
 where z.id=r.id returning * into r;
 perform public._zoe_run_events(r,jsonb_build_array(jsonb_build_object('name','zoe.route',
  'outcome',case v_outcome when 'draft_proposed'then 'allow'when 'answered'then 'allow'when 'intake_asked'then 'allow'when 'intake_completed'then 'allow'when 'intake_escalated'then 'escalate'
   when 'draft_blocked'then 'block'when 'summary_only'then 'recorded'when 'no_output'then 'failed'
   else case when v_reason in('urgent_route_no_model_call','urgent_in_window_no_model_call')then 'escalate'else 'skipped'end end,
  'reason',v_reason,'rule','zoe.pipeline','ruleVersion',left(coalesce(p_result->>'configVersion','unknown'),80),'actor','system',
  'attributes',jsonb_strip_nulls(jsonb_build_object('noreon.zoe.run.outcome',v_outcome,'noreon.draft.id',d::text,'noreon.zoe.answer.id',aid::text,'noreon.zoe.answer.telegram',smid is not null,
   'noreon.zoe.intake.id',iid::text,'noreon.zoe.intake.state',v_state,
   'noreon.zoe.cost_usd',r.cost_usd,'gen_ai.usage.input_tokens',r.input_tokens,'gen_ai.usage.output_tokens',r.output_tokens,'noreon.zoe.latency_ms',r.latency_ms,
   'noreon.zoe.tier',r.tier,'noreon.zoe.tier_reason',r.tier_reason,'gen_ai.request.model',left(r.model,128),'noreon.zoe.fallback_used',r.fallback_used,
   'noreon.zoe.guard.reasons',left(array_to_string(reasons,','),128),'noreon.zoe.io_stored',r.sealed_io is not null)))));
 return jsonb_build_object('ok',true,'outcome',v_outcome,'replayed',false,'draftId',d,'answerId',aid,'intakeId',iid);
end$$;

-- 7. Reads ------------------------------------------------------------------------------------------------------
-- The assigned doctor reads a member's intakes (summary only; the record stays inside). Same check as zoe_runs_for_doctor.
create function public.zoe_symptom_intakes_for_doctor(p_member uuid)returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare who jsonb:=public.real_clinical_staff_identity();
begin
 if who is null or who->>'role'<>'doctor'or not exists(select 1 from public.patient_clinical_cases where user_id=p_member and assigned_doctor_id=auth.uid())then raise insufficient_privilege;end if;
 return jsonb_build_object('ok',true,'intakes',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'sheetId',i.sheet_id,'sheetVersion',i.sheet_version,'state',i.state,'ending',i.ending,
   'summary',i.summary,'startedAt',i.created_at,'updatedAt',i.updated_at,'finishedAt',i.finished_at)order by i.created_at desc)
  from(select * from public.zoe_symptom_intakes where member_id=p_member order by created_at desc limit 10)i),'[]'));
end$$;

-- The member's own intake state, for the app: whether the intake switch is on (the send action then also
-- runs the symptom red flags itself, before storing) and whether an intake is active. Nothing of the answers.
create function public.zoe_symptom_intake_member()returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare m uuid:=auth.uid();i public.zoe_symptom_intakes;
begin
 if auth.role()is distinct from 'authenticated'or m is null then raise insufficient_privilege;end if;
 select * into i from public.zoe_symptom_intakes where member_id=m and state='active';
 return jsonb_build_object('ok',true,'enabled',coalesce((select symptom_intake_enabled from public.zoe_settings where singleton),false),'active',i.id is not null,'sheetId',i.sheet_id);
end$$;

-- 9. RLS and grants -----------------------------------------------------------------------------------------------
alter table public.zoe_symptom_sheets enable row level security;
alter table public.zoe_symptom_intakes enable row level security;
alter table public.zoe_symptom_intake_notices enable row level security;
revoke all on public.zoe_symptom_sheets,public.zoe_symptom_intakes,public.zoe_symptom_intake_notices from public,anon,authenticated,service_role;
revoke all on function public._zoe_symptom_intake_guard(),public._zoe_intake_notice(uuid),public.zoe_symptom_intakes_for_doctor(uuid),public.zoe_symptom_intake_member()from public,anon,authenticated,service_role;
grant execute on function public.zoe_symptom_intakes_for_doctor(uuid),public.zoe_symptom_intake_member()to authenticated;
-- create or replace keeps zoe_run_claim and zoe_run_finish grants (service_role only).
