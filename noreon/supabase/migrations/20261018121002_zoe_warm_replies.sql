-- Zoe warm replies (Khikar, 18 Oct 2026 15:56, after "hi" in the app got only the fixed acknowledgement:
-- "let it talk, it should feel warm and helpful and caring"). Ships OFF. Design: lib/zoe/conversation.ts and
-- output/zoe-warm-replies-2026-10-18/DESIGN.md.
--
-- With zoe_settings.conversational_replies_enabled on:
--  * greetings, thanks, "how are you", "what can you do?", a farewell or a plain feeling get Zoe's own short
--    warm reply (low tier, guarded; fixed wording when no model can be used). The class is decided in app
--    code by a closed vocabulary, after the urgent words, the symptom red flags and the symptom intake.
--  * a message Zoe does not answer herself (a health question for the doctor) gets one warm fixed line
--    ("Thanks, Richard. I've passed this to Dr X; they'll reply here."), with no reply time.
--  * the fixed acknowledgement is not sent as well: on Telegram it is held for Zoe and released when she
--    sends nothing (or only the urgent text), or after 3 minutes as the backstop; in the app the thread shows
--    "Zoe is writing" instead, and the acknowledgement as the same backstop.
-- Switch off: exactly the behaviour before this migration.
--
-- 1. zoe_settings.conversational_replies_enabled (default off) and its guard; 2. run outcome chatted, answer
--    kinds chat and receipt; 3. templates zoe.chat and zoe.receipt (free body, UNAPPROVED: staging approves
--    them by SQL like zoe.answer, so a pre-launch reset leaves them off); 4. helpers; 5. zoe_run_context
--    (the switch, the doctor's name and what is already answered, read by the sweep after zoe_run_claim, which
--    this migration does not touch); 6. the held acknowledgement; 7. zoe_run_finish; 8. the member thread.
-- Red always wins and is unchanged: urgent words and red flags stop before any model, zoe.urgent and the
-- care-team alert go out as before, and care-alert screening never depends on any of this.

-- 1. The switch ---------------------------------------------------------------------------------------------
alter table public.zoe_settings add column conversational_replies_enabled boolean not null default false;
comment on column public.zoe_settings.conversational_replies_enabled is
 'Zoe replies herself to greetings, thanks and feelings, and sends a warm receipt instead of the fixed acknowledgement. Needs real calls allowed and a passing low-tier eval with the chat rows.';

create function public._zoe_conversational_guard()returns trigger language plpgsql set search_path=''as $$
begin
 if not new.conversational_replies_enabled then return new;end if;
 if not new.model_calls_allowed then
  raise exception using errcode='23514',message='Conversational replies need real AI calls allowed (model_calls_allowed)';end if;
 if tg_op='UPDATE'and old.conversational_replies_enabled then return new;end if;
 if not exists(select 1 from public.zoe_eval_runs e join public.zoe_tier_config c on c.tier='low'and c.model_id=e.model_id
  where e.mode='model'and e.tier='low'and e.must_failures=0 and e.harness_version ~ '\+chat-[1-9][0-9]*'and e.created_at>clock_timestamp()-interval '7 days')then
  raise exception using errcode='23514',message='Conversational replies need a passing model-mode eval of the low tier model with the chat rows in the last 7 days';end if;
 return new;
end$$;
create trigger zoe_conversational_guard before insert or update on public.zoe_settings for each row execute function public._zoe_conversational_guard();

-- 2. Outcomes and kinds ----------------------------------------------------------------------------------------
-- A suspected prompt injection in the run's unanswered messages, as the app detected it, whatever the outcome
-- (Codex review F3): the member limits and the admin alert count these, never finish reasons.
alter table public.zoe_runs add column injection_detected boolean not null default false;
alter table public.zoe_runs drop constraint zoe_runs_outcome_check;
alter table public.zoe_runs add constraint zoe_runs_outcome_check check(outcome in('draft_proposed','draft_blocked','summary_only','discarded','no_output','stale','skipped','answered',
 'intake_asked','intake_completed','intake_escalated','chatted'));
alter table public.zoe_member_answers drop constraint zoe_member_answers_kind_check;
alter table public.zoe_member_answers add constraint zoe_member_answers_kind_check check(kind in('answer','intake','urgent','chat','receipt','deflection'));
comment on column public.zoe_member_answers.kind is
 'answer: logistics/app help; intake: a symptom-sheet question or the closing text; urgent: the fixed 103 text after a red flag; chat: a conversational reply; receipt: the warm line when the message waits for the doctor; deflection: the fixed polite reply to a suspected prompt injection.';

-- 3. Templates: free body (the text is Zoe's, checked in app code), unapproved until staging approves them -----------
insert into public.system_message_templates(template_id,version,locale,body,free_body,approval_note)values
 ('zoe.chat',1,'en','Zoe conversational reply (free text, guarded by lib/zoe/output-guard.ts, fixed fallback in lib/zoe/conversation.ts).',true,'Approve to let Zoe''s conversational replies reach members (staging AI mode). STAGING wording; copy sign-off pending.'),
 ('zoe.chat',1,'hy','Zoe conversational reply (free text, guarded by lib/zoe/output-guard.ts, fixed fallback in lib/zoe/conversation.ts).',true,'Approve to let Zoe''s conversational replies reach members (staging AI mode). STAGING wording; Tatevik sign-off pending.'),
 ('zoe.receipt',1,'en','Zoe warm receipt (fixed text with names, lib/zoe/conversation.ts receiptText).',true,'Approve to send the warm receipt instead of the fixed acknowledgement (staging AI mode). STAGING wording; copy sign-off pending.'),
 ('zoe.receipt',1,'hy','Zoe warm receipt (fixed text with names, lib/zoe/conversation.ts receiptText).',true,'Approve to send the warm receipt instead of the fixed acknowledgement (staging AI mode). STAGING wording; Tatevik sign-off pending.');
-- The admin notice for repeated injection attempts (Telegram staff channel): a placeholder, held at claim until approved.
insert into public.system_message_templates(template_id,version,locale,body)values
 ('zoe_abuse.notice',1,'en','UNAPPROVED PLACEHOLDER. A member has repeatedly tried to change how Zoe works. Zoe now sends that member fixed replies only. Open the conversation in the Noreon staff app.'),
 ('zoe_abuse.notice',1,'hy','UNAPPROVED PLACEHOLDER. Անդամը մի քանի անգամ փորձել է փոխել Zoe-ի աշխատանքը։ Zoe-ն այժմ այդ անդամին ուղարկում է միայն ֆիքսված պատասխաններ։ Բացեք զրույցը Noreon-ի աշխատակազմի հավելվածում։');

-- 4. Helpers -------------------------------------------------------------------------------------------------------
-- The newest version of a free-body template is approved in this locale.
create function public._zoe_template_ok(p_template text,p_locale text)returns boolean
language sql stable security definer set search_path=''as $$
 select coalesce((select t.approved from public.system_message_templates t where t.template_id=p_template and t.locale=p_locale and t.free_body order by t.version desc limit 1),false)
$$;
-- Zoe will answer this member's messages herself: the switch, a current Zoe consent (#265's rule, as in
-- zoe_run_claim), an assigned doctor, and the receipt wording approved in their language (so even a run
-- that ends without a reply of hers sends one line).
create function public._zoe_replies_on(m uuid)returns boolean
language sql stable security definer set search_path=''as $$
 select coalesce((select s.conversational_replies_enabled and s.consent_collection_enabled and s.consent_wording_version is not null
   and public._zoe_consent_current(m,'zoe_reads_messages')
   and exists(select 1 from public.patient_clinical_cases cs where cs.user_id=m and cs.assigned_doctor_id is not null)
   and public._zoe_template_ok('zoe.receipt',coalesce((select case when pr.locale='en'then 'en'else 'hy'end from public.profiles pr where pr.id=m),'hy'))
  from public.zoe_settings s where s.singleton),false)
$$;
-- One free-text Zoe message on the endpoint the member's Telegram message came in on (as _zoe_answer_enqueue,
-- for any free-body Zoe template), signed "Zoe: ". Approval is checked again at claim. _zoe_answer_enqueue
-- (direct answers, intake and urgent texts) now goes through it too, so every Zoe text on Telegram is signed.
create function public._zoe_text_enqueue(m uuid,p_inbox uuid,p_body0 text,p_template text)returns uuid
language plpgsql security definer set search_path=''as $$
declare l text;t public.system_message_templates;ep public.conversation_endpoints;new_id uuid;
 -- On Telegram, Zoe's texts are signed "Zoe: " so they are never mistaken for the doctor's replies
 -- (Khikar 18 Oct: "like Zoe is answering, just through Telegram"). The app thread labels them itself.
 p_body text:='Zoe: '||p_body0;
begin
 select e.* into ep from public.channel_inbox i join public.conversation_endpoints e on e.id=i.endpoint_id where i.id=p_inbox;
 if not found or ep.member_id<>m or not ep.active then return null;end if;
 select coalesce((select locale from public.profiles where id=m),'hy')into l;
 select * into t from public.system_message_templates where template_id=p_template and locale=l and free_body order by version desc limit 1;
 if not found then return null;end if;
 insert into public.system_messages(member_id,template_id,template_version,locale,body,body_hash,endpoint_id,endpoint_generation,source_inbox_id)
 values(m,t.template_id,t.version,t.locale,p_body,public._system_message_hash(t.template_id,t.version,t.locale,p_body),ep.id,ep.generation,p_inbox)
 on conflict(source_inbox_id,template_id)do nothing returning system_messages.id into new_id;
 if new_id is not null then perform public._system_message_audit(new_id,'enqueued',jsonb_build_object('template',t.template_id,'version',t.version,'locale',t.locale));end if;
 return new_id;
end$$;
create or replace function public._zoe_answer_enqueue(m uuid,p_inbox uuid,p_body text)returns uuid
language sql security definer set search_path=''as $$select public._zoe_text_enqueue(m,p_inbox,p_body,'zoe.answer')$$;

-- 5. Run context for the sweep ----------------------------------------------------------------------------------------
-- Per claimed run: the switch, the assigned doctor's display name, and the newest member message already
-- answered (a Zoe text, or the context of a doctor's approval). Service role only. Nothing else.
create function public.zoe_run_context(p_runs uuid[])returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare on_ boolean:=coalesce((select conversational_replies_enabled from public.zoe_settings where singleton),false);
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if p_runs is null or cardinality(p_runs)>50 then return '[]'::jsonb;end if;
 return coalesce((select jsonb_agg(jsonb_build_object('runId',r.id,'enabled',on_,
   'doctorName',(select ws.display_name from public.patient_clinical_cases cs join public.workspace_staff ws on ws.user_id=cs.assigned_doctor_id and ws.active and ws.removed_at is null
     where cs.user_id=r.member_id limit 1),
   -- Abuse limits: the member's Zoe spend today and the runs with a suspected injection in 24 hours.
   'memberSpentTodayUsd',coalesce((select sum(coalesce(z.cost_usd,z.estimate_usd))from public.zoe_runs z where z.member_id=r.member_id and z.reserved and z.spend_day=r.spend_day),0),
   'injectionsLast24h',(select count(*)from public.zoe_runs z where z.member_id=r.member_id and z.id<>r.id and z.state='finished'and z.finished_at>clock_timestamp()-interval '24 hours'
     and z.injection_detected),
   'locale',(select case when pr.locale='en'then 'en'else 'hy'end from public.profiles pr where pr.id=r.member_id),
   'answeredThroughSeq',greatest(
     coalesce((select max(a.message_seq)from public.zoe_member_answers a where a.conversation_id=r.conversation_id),0),
     coalesce((select max(ap.context_version)from public.conversation_approvals ap join public.conversation_drafts d on d.id=ap.draft_id where d.conversation_id=r.conversation_id),0))))
  from public.zoe_runs r where r.id=any(p_runs)and r.state='started'),'[]'::jsonb);
end$$;

-- 6. The held acknowledgement ---------------------------------------------------------------------------------------------
-- A Telegram acknowledgement for a stored member message waits for Zoe when she will answer it herself.
create function public._zoe_hold_ack()returns trigger language plpgsql security definer set search_path=''as $$
begin
 if new.template_id='telegram.ack'and new.state='queued'and new.source_inbox_id is not null
  and exists(select 1 from public.conversation_messages m where m.request_id=new.source_inbox_id and m.source='telegram_member')
  and public._zoe_replies_on(new.member_id)then
  new.state:='held';new.reason:='zoe_will_reply';
  perform public._conversation_trace(new.member_id,null,'system_message',new.id::text,'auto_ack','auto_ack.held_for_zoe','held','zoe_will_reply','zoe.conversation','1','system',null,
   jsonb_build_object('noreon.inbox.id',new.source_inbox_id));
 end if;
 return new;
end$$;
create trigger system_messages_zoe_hold_ack before insert on public.system_messages for each row execute function public._zoe_hold_ack();

create function public._zoe_ack_release(p_message uuid,p_reason text)returns void
language plpgsql security definer set search_path=''as $$
declare sm public.system_messages;
begin
 update public.system_messages set state='queued',reason=null,state_seq=state_seq+1,updated_at=clock_timestamp()
  where id=p_message and state='held'and reason='zoe_will_reply'returning * into sm;
 if sm.id is null then return;end if;
 perform public._system_message_audit(sm.id,'released',jsonb_build_object('reason',p_reason));
 perform public._conversation_trace(sm.member_id,null,'system_message',sm.id::text,'auto_ack','auto_ack.released','queued',p_reason,'zoe.conversation','1','system',null,
  jsonb_build_object('noreon.inbox.id',sm.source_inbox_id));
end$$;

-- The backstop, run by every Telegram sweep before it sends: an acknowledgement still held after 3 minutes
-- with no Zoe text for its message or a later one (pipeline off, worker lost, run skipped) goes out.
create function public.zoe_held_ack_release()returns jsonb
language plpgsql security definer set search_path=''as $$
declare n integer:=0;x record;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 for x in select sm.id from public.system_messages sm
  where sm.template_id='telegram.ack'and sm.state='held'and sm.reason='zoe_will_reply'and sm.created_at<clock_timestamp()-interval '3 minutes'
   and not exists(select 1 from public.conversation_messages m join public.zoe_member_answers a on a.conversation_id=m.conversation_id and a.message_seq>=m.seq and a.kind<>'urgent'
    left join public.system_messages zm on zm.id=a.system_message_id
    where m.request_id=sm.source_inbox_id and m.source='telegram_member'
     -- A Zoe text that will never go out (wording unapproved, changed or withdrawn, Codex review F5) does not count.
     and not coalesce(zm.state='held'and zm.reason in('template_unapproved','template_changed','template_withdrawn'),false))
  order by sm.created_at limit 100 loop
  perform public._zoe_ack_release(x.id,'zoe_no_text_after_3_minutes');n:=n+1;
 end loop;
 return jsonb_build_object('ok',true,'released',n);
end$$;

-- 6b. Repeated injection attempts: one admin notice per member per 24 hours (Telegram staff channel, when
-- staff notices are on and the wording is approved) and always an audit row and a trace event. The pipeline
-- itself throttles the member to fixed texts (lib/zoe/conversation.ts INJECTION_THROTTLE).
create function public._zoe_injection_alert(r public.zoe_runs)returns void
language plpgsql security definer set search_path=''as $$
declare n integer;s public.staff_message_notice_settings;x record;mid uuid;queued integer:=0;
begin
 select count(*)into n from public.zoe_runs z where z.member_id=r.member_id and z.state='finished'and z.finished_at>clock_timestamp()-interval '24 hours'and z.injection_detected;
 if n<3 or exists(select 1 from public.conversation_audit a where a.conversation_id=r.conversation_id and a.kind='zoe.injection_alert'and a.created_at>clock_timestamp()-interval '24 hours')then return;end if;
 select * into s from public.staff_message_notice_settings where singleton;
 if found and s.enabled then
  for x in select ws.user_id,b.address,b.principal_ref from public.workspace_staff ws
   join lateral(select address,principal_ref from public.telegram_auth_bindings where auth_user_id=ws.user_id and kind='staff'and active order by created_at desc limit 1)b on true
   where ws.active and ws.removed_at is null and ws.role='admin'order by ws.user_id loop
   mid:=public._telegram_auth_enqueue('zoe_abuse.notice',public._telegram_auth_locale(x.user_id),x.address,x.principal_ref,
    jsonb_build_object('kind','open_url','url',s.staff_origin||'/staff/real/members/'||r.member_id::text),null);
   if mid is not null then queued:=queued+1;end if;
  end loop;
 end if;
 insert into public.conversation_audit(conversation_id,actor_id,kind,detail)values(r.conversation_id,null,'zoe.injection_alert',jsonb_build_object('runId',r.id,'attempts24h',n,'adminNotices',queued));
 perform public._conversation_trace(r.member_id,r.conversation_id,'zoe_run',r.id::text,'zoe','zoe.guard.injection_throttled','escalate','repeated_injection_attempts','zoe.member_limits','1','system',null,
  jsonb_build_object('noreon.zoe.member.injections_24h',n,'noreon.staff_notice.recipients',queued));
exception when others then
 raise warning 'zoe injection alert dropped (%)',sqlstate;
end$$;

-- 7. Finish ---------------------------------------------------------------------------------------------------------------
-- New §7: outcome chatted, the warm receipt and the held acknowledgement's release. Everything else unchanged
-- from 20261018075343 §6 (the intake outcomes) and, before it, 20261017202157 §1.
create or replace function public.zoe_run_finish(p_run uuid,p_result jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare r public.zoe_runs;c public.conversations;v_outcome text;v_reason text;d uuid;cr bigint;src text;v_summary text;v_draft text;v_sealed text;reasons text[];v_tier text;v_tier_reason text;
 v_answer text;v_lang text;msg public.conversation_messages;aid uuid;smid uuid;
 ik jsonb;iid uuid;v_state text;v_kind text;v_author text;v_send boolean;answer_ok boolean;flags text[];
 conv_on boolean;ch jsonb;rc jsonb;v_receipt text;v_receipt_lang text;loc text;urgent boolean;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 select * into r from public.zoe_runs where id=p_run for update;
 if not found then return jsonb_build_object('ok',false,'code','run_unknown');end if;
 if r.state='finished'then return jsonb_build_object('ok',true,'outcome',r.outcome,'replayed',true);end if;
 v_outcome:=p_result->>'outcome';v_reason:=p_result->>'reason';v_summary:=nullif(btrim(p_result->>'summary'),'');v_draft:=nullif(btrim(p_result->>'draft'),'');v_sealed:=p_result->>'sealed';
 v_answer:=nullif(btrim(p_result->>'answer'),'');v_lang:=p_result->>'language';
 v_tier:=coalesce(p_result->>'tier',r.tier,'none');v_tier_reason:=coalesce(p_result->>'tierReason','not_routed');
 ik:=case when jsonb_typeof(p_result->'intake')='object'then p_result->'intake'end;
 ch:=case when jsonb_typeof(p_result->'chat')='object'then p_result->'chat'end;
 rc:=case when jsonb_typeof(p_result->'receipt')='object'then p_result->'receipt'end;
 v_receipt:=nullif(btrim(rc->>'text'),'');v_receipt_lang:=rc->>'language';
 conv_on:=coalesce((select conversational_replies_enabled from public.zoe_settings where singleton),false);
 loc:=coalesce((select case when pr.locale='en'then 'en'else 'hy'end from public.profiles pr where pr.id=r.member_id),'hy');
 if length(v_sealed)>200000 then v_sealed:=null;end if;
 if v_outcome is null or v_outcome not in('draft_proposed','draft_blocked','summary_only','discarded','no_output','answered','intake_asked','intake_completed','intake_escalated','chatted')or coalesce(v_reason,'')!~'^[a-z0-9_.:-]{1,80}$'
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
  -- §7: a conversational reply carries its class and source and a short text; the low tier or no model.
  or(v_outcome='chatted'and(ch is null or v_answer is null or length(v_answer)>700 or coalesce(v_lang,'')not in('en','hy','ru')or v_tier not in('none','low')
   or coalesce(ch->>'source','')not in('model','fixed')or coalesce(ch->>'kind','')not in('greeting','thanks','how_are_you','capabilities','emotional','farewell','identity','distress')))
  or(v_outcome<>'chatted'and ch is not null)
  -- §7: the warm receipt is a short fixed text in a supported language, never on an intake or chat outcome.
  or(rc is not null and(v_receipt is null or length(v_receipt)>700 or coalesce(v_receipt_lang,'')not in('en','hy','ru')or v_outcome like 'intake\_%'or v_outcome='chatted'
   or coalesce(rc->>'kind','receipt')not in('receipt','deflection')))
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
 elsif v_outcome='chatted'then
  -- §7: a conversational reply. Same freshness rules as a direct answer; the switch and the zoe.chat
  -- wording approval are checked here, at finish. Model text from the stand-in is never sent; the fixed
  -- wording (conversation.ts) is.
  select * into c from public.conversations where id=r.conversation_id for update;
  v_author:=case when ch->>'source'='model'then coalesce(p_result->>'provider','none')else 'noreon.rules'end;
  if c.version<>r.context_version then v_outcome:='stale';v_reason:='newer_member_message';
  elsif c.draft_epoch<>r.draft_epoch then v_outcome:='stale';v_reason:='doctor_work_since_claim';
  elsif not conv_on then v_outcome:='summary_only';v_reason:='conversational_replies_off';
  elsif v_author in('none','noreon.fake')then v_outcome:='summary_only';v_reason:='stand_in_answer_not_sent';
  elsif not public._zoe_template_ok('zoe.chat',loc)then v_outcome:='summary_only';v_reason:='chat_wording_unapproved';
  else
   select * into msg from public.conversation_messages where conversation_id=c.id and seq=r.message_seq;
   insert into public.zoe_member_answers(conversation_id,member_id,run_id,message_seq,body,language,provider,model,kind)
   values(c.id,r.member_id,r.id,r.message_seq,v_answer,v_lang,v_author,case when v_author='noreon.rules'then 'zoe-conversation-fixed'else coalesce(p_result->>'model','none')end,'chat')returning id into aid;
   if msg.source='telegram_member'and msg.request_id is not null then
    smid:=public._zoe_text_enqueue(r.member_id,msg.request_id,v_answer,'zoe.chat');
    update public.zoe_member_answers set system_message_id=smid where id=aid;
   end if;
   insert into public.conversation_audit(conversation_id,actor_id,kind,detail)values(c.id,null,'zoe.chatted',jsonb_build_object('runId',r.id,'answerId',aid,'seq',r.message_seq,
    'kind',ch->>'kind','source',ch->>'source','channel',case when msg.source='telegram_member'then 'telegram'else 'app'end,'telegram',smid is not null));
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
 -- §7: the warm receipt. Zoe sent nothing of her own and the message waits for the doctor: one fixed warm
 -- line (conversation.ts receiptText) when the switch is on and zoe.receipt is approved. Never for a stale
 -- run (a newer message has its own run) or urgent words.
 urgent:=v_reason in('urgent_route_no_model_call','urgent_in_window_no_model_call')or v_outcome='intake_escalated';
 if msg.id is null then select * into msg from public.conversation_messages where conversation_id=r.conversation_id and seq=r.message_seq;end if;
 -- An abusive message gets the app's sorry-for-the-wait line (QA 18 Oct C02: silence read as broken), never a model text.
 if aid is null and v_receipt is not null and conv_on and not urgent
  and v_outcome in('draft_proposed','draft_blocked','summary_only','no_output','discarded')
  and(select cv.version from public.conversations cv where cv.id=r.conversation_id)=r.context_version and public._zoe_template_ok('zoe.receipt',loc)then
  insert into public.zoe_member_answers(conversation_id,member_id,run_id,message_seq,body,language,provider,model,kind)
  values(r.conversation_id,r.member_id,r.id,r.message_seq,v_receipt,v_receipt_lang,'noreon.rules',case when rc->>'kind'='deflection'then 'zoe-deflection-fixed'else 'zoe-receipt-fixed'end,
   coalesce(rc->>'kind','receipt'))returning id into aid;
  if msg.source='telegram_member'and msg.request_id is not null then
   smid:=public._zoe_text_enqueue(r.member_id,msg.request_id,v_receipt,'zoe.receipt');
   update public.zoe_member_answers set system_message_id=smid where id=aid;
  end if;
  insert into public.conversation_audit(conversation_id,actor_id,kind,detail)values(r.conversation_id,null,'zoe.receipt',jsonb_build_object('runId',r.id,'answerId',aid,'seq',r.message_seq,
   'outcome',v_outcome,'channel',case when msg.source='telegram_member'then 'telegram'else 'app'end,'telegram',smid is not null));
 end if;
 -- §7: the Telegram acknowledgement held for Zoe (_zoe_hold_ack) goes out after all when she sends no text of
 -- her own, or only the urgent text (two messages beat none: zoe.urgent may be unapproved). A run overtaken by a
 -- newer message leaves it to that message's run (and the backstop).
 if msg.source='telegram_member'and msg.request_id is not null and v_outcome<>'stale'
  and(select cv.version from public.conversations cv where cv.id=r.conversation_id)=r.context_version
  and(aid is null or exists(select 1 from public.zoe_member_answers a where a.id=aid and a.kind='urgent'))then
  perform public._zoe_ack_release(sm.id,'zoe_sent_no_text')from public.system_messages sm
   where sm.source_inbox_id=msg.request_id and sm.template_id='telegram.ack'and sm.state='held'and sm.reason='zoe_will_reply';
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
  tier=v_tier,tier_reason=v_tier_reason,fallback_used=coalesce((p_result->>'fallbackUsed')::boolean,false),
  injection_detected=coalesce((p_result->>'injectionDetected')::boolean,false)
 where z.id=r.id returning * into r;
 if r.injection_detected then perform public._zoe_injection_alert(r);end if;
 perform public._zoe_run_events(r,jsonb_build_array(jsonb_build_object('name','zoe.route',
  'outcome',case v_outcome when 'draft_proposed'then 'allow'when 'answered'then 'allow'when 'chatted'then 'allow'when 'intake_asked'then 'allow'when 'intake_completed'then 'allow'when 'intake_escalated'then 'escalate'
   when 'draft_blocked'then 'block'when 'summary_only'then 'recorded'when 'no_output'then 'failed'
   else case when v_reason in('urgent_route_no_model_call','urgent_in_window_no_model_call')then 'escalate'else 'skipped'end end,
  'reason',v_reason,'rule','zoe.pipeline','ruleVersion',left(coalesce(p_result->>'configVersion','unknown'),80),'actor','system',
  'attributes',jsonb_strip_nulls(jsonb_build_object('noreon.zoe.run.outcome',v_outcome,'noreon.draft.id',d::text,'noreon.zoe.answer.id',aid::text,'noreon.zoe.answer.telegram',smid is not null,
   'noreon.zoe.intake.id',iid::text,'noreon.zoe.intake.state',v_state,'noreon.zoe.chat.kind',ch->>'kind','noreon.zoe.chat.source',ch->>'source',
   'noreon.zoe.answer.kind',(select a.kind from public.zoe_member_answers a where a.id=aid),
   'noreon.zoe.cost_usd',r.cost_usd,'gen_ai.usage.input_tokens',r.input_tokens,'gen_ai.usage.output_tokens',r.output_tokens,'noreon.zoe.latency_ms',r.latency_ms,
   'noreon.zoe.tier',r.tier,'noreon.zoe.tier_reason',r.tier_reason,'gen_ai.request.model',left(r.model,128),'noreon.zoe.fallback_used',r.fallback_used,
   'noreon.zoe.guard.reasons',left(array_to_string(reasons,','),128),'noreon.zoe.io_stored',r.sealed_io is not null)))));
 return jsonb_build_object('ok',true,'outcome',v_outcome,'replayed',false,'draftId',d,'answerId',aid,'intakeId',iid);
end$$;

-- 8. The member's thread ---------------------------------------------------------------------------------------------------
-- Adds zoeReplies and settledSeq (§8 below). Everything else unchanged from 20261017202157 §2.
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
  -- §8: Zoe answers every message herself (a reply, a question or the warm receipt), so the app shows a
  -- short "Zoe is writing" status instead of the fixed acknowledgement, which stays the backstop.
  'zoeReplies',public._zoe_replies_on(m),
  -- §8: the newest member message whose Zoe run has finished (not stale): after it, no Zoe text is coming.
  'settledSeq',coalesce((select max(z.message_seq)from public.zoe_runs z where z.conversation_id=c.id and z.state='finished'and z.outcome is distinct from 'stale'),0),
  'ack',(select t.body from public.system_message_templates t where t.template_id='telegram.ack'and t.locale=coalesce(loc,'hy')and t.approved order by t.version desc limit 1),
  'messages',coalesce((select jsonb_agg(jsonb_build_object('seq',x.seq,'text',x.body,'at',x.created_at,'channel',case when x.source='telegram_member'then 'telegram'else 'app'end,
    'requestId',case when x.source='authenticated_member'then x.request_id end)order by x.seq)
   from(select * from public.conversation_messages where conversation_id=c.id order by seq desc limit 100)x),'[]'),
  'replies',coalesce((select jsonb_agg(jsonb_build_object('id',ap.id,'text',ap.body,'at',ap.created_at,'doctorName',ap.doctor_name)order by ap.created_at,ap.id)
   from public.conversation_app_releases r join public.conversation_approvals ap on ap.id=r.approval_id
   where r.conversation_id=c.id and r.member_id=m and(since is null or ap.created_at>=since)),'[]'),
  -- Zoe's own answers (logistics and app help only, guarded, approved wording; zoe_run_finish), to
  -- a message from either channel: the app shows them whether or not Telegram carried them. A
  -- Telegram answer held because its wording was not approved, changed or withdrawn (the staging
  -- rollback) stays out. Nothing else Zoe wrote
  -- (drafts, summaries, run details) is read here.
  'answers',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'text',a.body,'at',a.created_at)order by a.created_at,a.id)
   from public.zoe_member_answers a left join public.system_messages sm on sm.id=a.system_message_id
   where a.conversation_id=c.id and a.member_id=m and(since is null or a.created_at>=since)
    and not coalesce(sm.state='held'and sm.reason in('template_unapproved','template_changed','template_withdrawn'),false)),'[]'));
end$$;

-- 8b. Zoe consent from the Zoe chat screen (lead 18 Oct 16:09: a member who signed up before consent at sign-up
-- could not find where to turn Zoe on). Source 'zoe_screen'; everything else unchanged from 20261018073940
-- (the same wording-version checks; a grant only, like the enrolment and Home card sources).
alter table public.zoe_consents drop constraint zoe_consents_source_check;
alter table public.zoe_consents add constraint zoe_consents_source_check check(source in('settings','enrolment','prompt','zoe_screen'));
create or replace function public.zoe_consent_set(p_kind text,p_granted boolean,p_wording_version text,p_source text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare m uuid:=auth.uid();s public.zoe_settings;cur boolean;cur_version text;stale boolean;v text;
begin
 if auth.role()is distinct from 'authenticated'or m is null then raise insufficient_privilege;end if;
 if p_kind is null or p_kind not in('zoe_reads_messages','zoe_scheduled_questions')or p_granted is null or coalesce(p_wording_version,'')!~'^[a-z0-9-]{1,64}$'
  or p_source is null or p_source not in('settings','enrolment','prompt','zoe_screen')then
  return jsonb_build_object('ok',false,'code','invalid');end if;
 -- Enrolment and the one-time card show one statement, about Zoe reading messages, and can only
 -- record a yes to it. "Not now" on the card records nothing.
 if p_source<>'settings'and(p_kind<>'zoe_reads_messages'or not p_granted)then return jsonb_build_object('ok',false,'code','invalid');end if;
 select * into s from public.zoe_settings where singleton;
 -- Granting needs collection on, a current server-held wording that matches what the member
 -- was shown, and an eligible member. Withdrawing is always possible.
 if p_granted then
  if not found or not s.consent_collection_enabled or s.consent_wording_version is null then return jsonb_build_object('ok',false,'code','unavailable');end if;
  if p_wording_version is distinct from s.consent_wording_version then return jsonb_build_object('ok',false,'code','stale','wordingVersion',s.consent_wording_version);end if;
  if not public._zoe_member_eligible(m)then return jsonb_build_object('ok',false,'code','not_eligible');end if;
 end if;
 -- An enrolment grant rides on the Agree the member just pressed: it needs that enrolment
 -- consent, recorded within the hour.
 if p_source='enrolment'and not exists(select 1 from public.patient_consents where user_id=m and accepted_at>clock_timestamp()-interval '1 hour')then
  return jsonb_build_object('ok',false,'code','not_eligible');end if;
 perform pg_advisory_xact_lock(hashtextextended('zoe-consent:'||m::text,0));
 select granted,wording_version into cur,cur_version from public.zoe_consents where member_id=m and kind=p_kind order by id desc limit 1;
 -- A grant of an outdated wording is no longer a decision about the current text (Fable F2).
 stale:=coalesce(cur,false)and s.singleton is not null and not public._zoe_wording_current(s,cur_version);
 -- Enrolment and the card only ever record a first decision, or a yes to new wording after a yes
 -- to old wording: they never overturn a choice about the current text, a "no" least of all.
 if p_source<>'settings'and cur is not null and not stale then return jsonb_build_object('ok',true,'changed',false)||public._zoe_consent_view(m);end if;
 if(p_granted and cur and not stale)or(not p_granted and not coalesce(cur,false))then
  return jsonb_build_object('ok',true,'changed',false)||public._zoe_consent_view(m);end if;
 -- A grant records the server's current wording. A withdrawal records the server's wording, or
 -- when none is held, the wording of the grant being withdrawn: never a client value.
 v:=case when p_granted then s.consent_wording_version
  else coalesce(s.consent_wording_version,(select wording_version from public.zoe_consents where member_id=m and kind=p_kind order by id desc limit 1))end;
 insert into public.zoe_consents(member_id,kind,granted,wording_version,source)values(m,p_kind,p_granted,v,p_source);
 perform public._conversation_trace(m,null,'zoe_consent',p_kind,'zoe',case when p_granted then 'zoe.consent.granted'else 'zoe.consent.withdrawn'end,
  case when p_granted then 'allow'else 'block'end,p_kind,'zoe.consent',v,'member',m,
  jsonb_build_object('noreon.zoe.consent.kind',p_kind,'noreon.zoe.consent.source',p_source));
 return jsonb_build_object('ok',true,'changed',true)||public._zoe_consent_view(m);
end$$;

-- 9. Grants ----------------------------------------------------------------------------------------------------------------
revoke all on function public._zoe_injection_alert(public.zoe_runs),public._zoe_conversational_guard(),public._zoe_template_ok(text,text),public._zoe_replies_on(uuid),public._zoe_text_enqueue(uuid,uuid,text,text),
 public.zoe_run_context(uuid[]),public._zoe_hold_ack(),public._zoe_ack_release(uuid,text),public.zoe_held_ack_release()from public,anon,authenticated,service_role;
grant execute on function public.zoe_run_context(uuid[]),public.zoe_held_ack_release()to service_role;
-- create or replace keeps zoe_run_finish (service_role) and conversation_member_thread (authenticated) grants.
