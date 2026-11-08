-- Zoe's direct answers in the member app thread (follow-up to #232 and #236). Khikar, 17 Oct 22:48:
-- in-app Zoe is the same AI, pipeline and conversation as Telegram Zoe.
--
-- 1. zoe_run_finish: an answer to an app message is stored like a Telegram one (it was kept as a
--    summary, direct_answer_no_channel, until the app could show it). Both channels now need the
--    zoe.answer wording approved at answer time (direct_answer_unapproved otherwise), so an answer
--    is never stored where no member can see it. Everything else unchanged from 20261017190654 §5.
-- 2. conversation_member_thread: adds 'answers', the member's own zoe_member_answers rows, whatever
--    channel the message came from. Everything else unchanged from 20261017184839 §3.
-- Health still goes only through a doctor-approved reply; the urgent route still stops before any
-- model; the thread still carries no drafts, summaries or run details.

-- 1. Finish -----------------------------------------------------------------------------------------
create or replace function public.zoe_run_finish(p_run uuid,p_result jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare r public.zoe_runs;c public.conversations;v_outcome text;v_reason text;d uuid;cr bigint;src text;v_summary text;v_draft text;v_sealed text;reasons text[];v_tier text;v_tier_reason text;
 v_answer text;v_lang text;msg public.conversation_messages;aid uuid;smid uuid;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 select * into r from public.zoe_runs where id=p_run for update;
 if not found then return jsonb_build_object('ok',false,'code','run_unknown');end if;
 if r.state='finished'then return jsonb_build_object('ok',true,'outcome',r.outcome,'replayed',true);end if;
 v_outcome:=p_result->>'outcome';v_reason:=p_result->>'reason';v_summary:=nullif(btrim(p_result->>'summary'),'');v_draft:=nullif(btrim(p_result->>'draft'),'');v_sealed:=p_result->>'sealed';
 v_answer:=nullif(btrim(p_result->>'answer'),'');v_lang:=p_result->>'language';
 v_tier:=coalesce(p_result->>'tier',r.tier,'none');v_tier_reason:=coalesce(p_result->>'tierReason','not_routed');
 if length(v_sealed)>200000 then v_sealed:=null;end if;
 if v_outcome is null or v_outcome not in('draft_proposed','draft_blocked','summary_only','discarded','no_output','answered')or coalesce(v_reason,'')!~'^[a-z0-9_.:-]{1,80}$'
  or length(v_summary)>4000 or length(v_draft)>2000 or(v_outcome='draft_proposed'and(v_draft is null or v_summary is null))
  -- An answer is only ever for the low tier, with a summary for the doctor, from a reserved call.
  or(v_outcome='answered'and(v_answer is null or length(v_answer)>700 or v_summary is null or v_tier<>'low'or not r.reserved or coalesce(v_lang,'')not in('en','hy','ru')))
  or jsonb_typeof(coalesce(p_result->'guardReasons','[]'))<>'array'
  or coalesce(p_result->>'provider','none')!~'^[a-z0-9_.-]{1,64}$'or coalesce(p_result->>'model','none')!~'^[a-z0-9_.:/-]{1,80}$'
  or coalesce((p_result->>'costUsd')::numeric,0)<0
  or v_tier not in('none','low','medium','high')or v_tier_reason!~'^[a-z0-9_.:-]{1,80}$'
  -- A reserved run keeps the tier it reserved against.
  or(r.tier is not null and v_tier<>r.tier)then
  return jsonb_build_object('ok',false,'code','invalid');end if;
 select coalesce(array_agg(x)filter(where x~'^[a-z0-9_.:-]{1,80}$'),'{}')into reasons from jsonb_array_elements_text(p_result->'guardReasons')x;
 perform public._zoe_run_events(r,p_result->'events');
 if v_outcome='answered'then
  select * into c from public.conversations where id=r.conversation_id for update;
  if c.version<>r.context_version then v_outcome:='stale';v_reason:='newer_member_message';
  elsif c.draft_epoch<>r.draft_epoch then v_outcome:='stale';v_reason:='doctor_work_since_claim';
  elsif not coalesce((select direct_answers_enabled from public.zoe_settings where singleton),false)then v_outcome:='summary_only';v_reason:='direct_answers_off';
  -- The stand-in's fixed text never reaches a member.
  elsif coalesce(p_result->>'provider','none')in('none','noreon.fake')then v_outcome:='summary_only';v_reason:='stand_in_answer_not_sent';
  -- Zoe answers only while her answer wording is approved (the same approval the Telegram send
  -- checks, system_message_claim). Otherwise the doctor flow keeps the message: nobody would see
  -- the answer. Locale as the app thread and the Telegram templates use it.
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
 -- Telegram urgent messages also get the fixed urgent template (held until approved); app ones see the 103 screen.
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
  'outcome',case v_outcome when 'draft_proposed'then 'allow'when 'answered'then 'allow'when 'draft_blocked'then 'block'when 'summary_only'then 'recorded'when 'no_output'then 'failed'
   else case when v_reason in('urgent_route_no_model_call','urgent_in_window_no_model_call')then 'escalate'else 'skipped'end end,
  'reason',v_reason,'rule','zoe.pipeline','ruleVersion',left(coalesce(p_result->>'configVersion','unknown'),80),'actor','system',
  'attributes',jsonb_strip_nulls(jsonb_build_object('noreon.zoe.run.outcome',v_outcome,'noreon.draft.id',d::text,'noreon.zoe.answer.id',aid::text,'noreon.zoe.answer.telegram',smid is not null,
   'noreon.zoe.cost_usd',r.cost_usd,'gen_ai.usage.input_tokens',r.input_tokens,'gen_ai.usage.output_tokens',r.output_tokens,'noreon.zoe.latency_ms',r.latency_ms,
   'noreon.zoe.tier',r.tier,'noreon.zoe.tier_reason',r.tier_reason,'gen_ai.request.model',left(r.model,128),'noreon.zoe.fallback_used',r.fallback_used,
   'noreon.zoe.guard.reasons',left(array_to_string(reasons,','),128),'noreon.zoe.io_stored',r.sealed_io is not null)))));
 return jsonb_build_object('ok',true,'outcome',v_outcome,'replayed',false,'draftId',d,'answerId',aid);
end$$;


-- 2. The member's thread ------------------------------------------------------------------------------
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
-- create or replace keeps both functions' grants (service_role only; authenticated only).
