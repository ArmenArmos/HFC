-- Zoe urgent route text (Lead 19 Oct, QA R10 and the RU urgent locale). Outside a symptom intake, urgent words used
-- to get only the fixed zoe.urgent template on Telegram (EN/HY by profile locale) and nothing in the app thread. The
-- worker now sends the urgent text in the member's message language (EN/HY/RU), or the warmer crisis text when the
-- words are about self-harm; zoe_run_finish stores it as an urgent answer (the app thread shows it) and sends it on
-- Telegram when zoe.answer is approved, with zoe.urgent as the fallback, exactly as the intake's urgent path does.
-- Everything else is unchanged from 20261018121002 §7. Red still always wins: no model is called on this route.
-- STAGING wording pending Armen's sign-off before real members (PENDING_QUESTIONS P41b).

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
  -- Urgent route text (this migration): a discarded run carries a text only on the urgent route, short, in a supported language.
  or(v_outcome='discarded'and v_answer is not null and(v_reason not in('urgent_route_no_model_call','urgent_in_window_no_model_call')
   or length(v_answer)>700 or coalesce(v_lang,'')not in('en','hy','ru')))
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
 -- Urgent route (this migration; QA R10, RU urgent locale): Zoe's urgent text in the member's message language, or
 -- the warmer crisis text for self-harm words (conversation.ts CRISIS_TEXT), shows in the app thread and goes to
 -- Telegram when the zoe.answer wording is approved, as on the intake's urgent path. The fixed zoe.urgent template
 -- stays the Telegram fallback (no text from the worker, or the wording unapproved). STAGING wording pending Armen (P41b).
 if v_outcome='discarded'and v_reason in('urgent_route_no_model_call','urgent_in_window_no_model_call')then
  select * into msg from public.conversation_messages where conversation_id=r.conversation_id and seq=r.message_seq;
  if v_answer is not null and msg.id is not null then
   insert into public.zoe_member_answers(conversation_id,member_id,run_id,message_seq,body,language,provider,model,kind)
   values(r.conversation_id,r.member_id,r.id,r.message_seq,v_answer,v_lang,'noreon.rules','zoe-urgent-fixed','urgent')returning id into aid;
   if msg.source='telegram_member'and msg.request_id is not null and public._zoe_template_ok('zoe.answer',loc)then
    smid:=public._zoe_answer_enqueue(r.member_id,msg.request_id,v_answer);
    update public.zoe_member_answers set system_message_id=smid where id=aid;
   end if;
   insert into public.conversation_audit(conversation_id,actor_id,kind,detail)values(r.conversation_id,null,'zoe.urgent',jsonb_build_object('runId',r.id,'answerId',aid,'seq',r.message_seq,
    'language',v_lang,'channel',case when msg.source='telegram_member'then 'telegram'else 'app'end,'telegram',smid is not null));
  end if;
  if msg.source='telegram_member'and msg.request_id is not null and smid is null then
   perform public._system_message_enqueue('zoe.urgent',r.member_id,e,msg.request_id)from public.channel_inbox i join public.conversation_endpoints e on e.id=i.endpoint_id
    where i.id=msg.request_id and e.member_id=r.member_id and e.active;
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

-- create or replace keeps zoe_run_finish's grants (service_role only).
