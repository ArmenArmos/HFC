-- Zoe message pipeline (ZOE_DESIGN v6 worker part; K1, K5, K7 decided 16 Oct 2026).
-- An inbound Telegram member message is claimed as one Zoe run. The app runs the guards (urgent
-- words, scope, redaction), the provider and the output guard, and these functions record every
-- step as a conversation trace event, reserve spend against the daily cap, and turn a passing
-- AI draft into a PENDING draft that only the assigned doctor can approve (reply machine, K1).
-- Fake provider only: no provider SDK or network call exists, and zoe_settings.model_calls_allowed
-- stays CHECK-forced false, so only a local provider can reserve spend. Dark twice: the app flag
-- NOREON_ZOE_PIPELINE_ENABLED, and consent is void without the zoe_settings row.

-- 1. AI-authored revisions have no human author ----------------------------------------------
alter table public.conversation_revisions alter column author_id drop not null;
alter table public.conversation_revisions add constraint conversation_revisions_ai_author check(author_id is not null or author_kind='ai_assistant');

-- 2. Runs ---------------------------------------------------------------------------------------
-- One run per newest member message (O04, K09): a burst of messages gives one run for the
-- latest, and a crashed worker's run is recorded as lost, never retried into a second draft.
create table public.zoe_runs (
 id uuid primary key default gen_random_uuid(),
 conversation_id uuid not null references public.conversations(id)on delete cascade,
 member_id uuid not null references auth.users(id)on delete cascade,
 message_seq bigint not null,
 -- Captured at claim: a newer member message or doctor work makes the result stale (K04, K18).
 context_version bigint not null,
 draft_epoch bigint not null,
 state text not null default 'started'check(state in('started','finished')),
 outcome text check(outcome in('draft_proposed','draft_blocked','summary_only','discarded','no_output','stale','skipped')),
 reason_code text check(reason_code ~ '^[a-z0-9_.:-]{1,80}$'),
 provider text check(provider ~ '^[a-z0-9_.-]{1,64}$'),
 model text check(model ~ '^[a-z0-9_.:-]{1,80}$'),
 config_version text check(length(config_version)between 1 and 200),
 -- K7 ledger: a reservation holds estimate_usd until cost_usd replaces it.
 spend_day date not null,
 reserved boolean not null default false,
 estimate_usd numeric(12,6)not null default 0 check(estimate_usd>=0),
 cost_usd numeric(12,6)check(cost_usd>=0),
 input_tokens integer check(input_tokens>=0),output_tokens integer check(output_tokens>=0),latency_ms integer check(latency_ms>=0),
 redaction_count integer not null default 0 check(redaction_count>=0),
 guard_reasons text[]not null default '{}'check(cardinality(guard_reasons)<=40),
 -- Doctor-facing AI summary when no draft carries it (blocked or no draft). Guarded text.
 summary text check(length(summary)between 1 and 4000),
 draft_id uuid references public.conversation_drafts(id)on delete set null,
 -- Redacted prompt and response, sealed by the app (AES-256-GCM, key outside the database).
 sealed_io text check(length(sealed_io)<=200000),
 started_at timestamptz not null default clock_timestamp(),
 finished_at timestamptz,
 unique(conversation_id,message_seq),
 check((state='finished')=(outcome is not null and finished_at is not null))
);
create index zoe_runs_spend on public.zoe_runs(spend_day)where reserved;
create index zoe_runs_member on public.zoe_runs(member_id,started_at desc);
create index zoe_runs_started on public.zoe_runs(started_at)where state='started';
comment on table public.zoe_runs is
 'Zoe pipeline runs (fake provider only). summary and sealed_io hold member-derived text; retention is open (Q17), deleted with the account.';

-- 3. Trace writer for a run -----------------------------------------------------------------------
-- Each app-supplied event is validated (zoe.* name, codes only, at most 24 scalar attributes) and
-- written through the single conversation trace writer. An invalid event never fails the run: it
-- is replaced by a zoe.trace.event_rejected event.
create function public._zoe_run_events(r public.zoe_runs,p_events jsonb)returns integer
language plpgsql security definer set search_path=''as $$
declare e jsonb;n integer:=0;attrs jsonb;ok boolean;
begin
 if jsonb_typeof(coalesce(p_events,'[]'))<>'array'or jsonb_array_length(coalesce(p_events,'[]'))>40 then p_events:=jsonb_build_array(jsonb_build_object('name','zoe.trace.event_rejected','outcome','recorded','reason','event_list_invalid','rule','zoe.trace','ruleVersion','1','actor','system','attributes','{}'::jsonb));end if;
 for e in select value from jsonb_array_elements(coalesce(p_events,'[]'))loop
  attrs:=coalesce(e->'attributes','{}');
  ok:=jsonb_typeof(e)='object'and coalesce(e->>'name','')~'^zoe\.[a-z0-9_.]{1,60}$'
   and e->>'outcome'in('allow','block','redact','escalate','recorded','skipped','failed')
   and coalesce(e->>'reason','')~'^[a-z0-9_.:-]{1,80}$'and coalesce(e->>'rule','')~'^[a-z0-9_.:-]{1,80}$'and length(coalesce(e->>'ruleVersion',''))between 1 and 80
   and e->>'actor'in('system','ai')and jsonb_typeof(attrs)='object';
  if ok then
   ok:=(select count(*)<=24 and coalesce(bool_and(k~'^[a-z][a-z0-9_.]{1,80}$'and jsonb_typeof(v)in('string','number','boolean')and(jsonb_typeof(v)<>'string'or length(v#>>'{}')<=128)),true)
    from jsonb_each(attrs)x(k,v));
  end if;
  if not ok then e:=jsonb_build_object('name','zoe.trace.event_rejected','outcome','recorded','reason','event_invalid','rule','zoe.trace','ruleVersion','1','actor','system');attrs:='{}';end if;
  if public._conversation_trace(r.member_id,r.conversation_id,'zoe_run',r.id::text,'zoe',e->>'name',e->>'outcome',e->>'reason',e->>'rule',e->>'ruleVersion',e->>'actor',null,
   attrs||jsonb_build_object('noreon.zoe.run.id',r.id::text,'noreon.message.seq',r.message_seq))then n:=n+1;end if;
 end loop;
 return n;
end$$;

-- 4. Claim ----------------------------------------------------------------------------------------
-- Service role. Reaps runs lost by a crashed worker (recorded, never retried), then claims the
-- newest Telegram member message of up to p_limit conversations. G0: no consent, no settings row or
-- no assigned doctor finishes the run as skipped with its reason; nothing is read for it.
create function public.zoe_run_claim(p_limit integer)returns jsonb
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
  where lm.source='telegram_member'and lm.created_at>clock_timestamp()-interval '24 hours'
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

-- 5. Spend reservation (K7) -------------------------------------------------------------------------
-- Serialised by one advisory lock: today's (Yerevan) reserved estimates and recorded costs plus this
-- estimate must stay within zoe_settings.daily_spend_cap_usd (US$10, never above). A non-local
-- provider additionally needs model_calls_allowed, which the table forbids, so it is always refused.
create function public.zoe_run_reserve(p_run uuid,p_estimate_usd numeric,p_local boolean,p_events jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare r public.zoe_runs;s public.zoe_settings;spent numeric;cap numeric;code text;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if p_estimate_usd is null or p_estimate_usd<0 or p_estimate_usd>100 or p_local is null then return jsonb_build_object('ok',false,'code','invalid');end if;
 perform pg_advisory_xact_lock(hashtextextended('zoe-spend-cap',0));
 select * into r from public.zoe_runs where id=p_run for update;
 if not found or r.state<>'started'or r.reserved then return jsonb_build_object('ok',false,'code','run_not_reservable');end if;
 perform public._zoe_run_events(r,p_events);
 select * into s from public.zoe_settings where singleton;
 cap:=least(coalesce(s.daily_spend_cap_usd,0),10);
 select coalesce(sum(coalesce(cost_usd,estimate_usd)),0)into spent from public.zoe_runs where spend_day=r.spend_day and reserved;
 code:=case when not p_local and not coalesce(s.model_calls_allowed,false)then 'model_calls_not_permitted'
  when spent+p_estimate_usd>cap then 'daily_spend_cap_reached'end;
 if code is null then update public.zoe_runs set reserved=true,estimate_usd=p_estimate_usd where id=r.id;end if;
 perform public._zoe_run_events(r,jsonb_build_array(jsonb_build_object('name','zoe.spend.reserve','outcome',case when code is null then 'allow'else 'block'end,
  'reason',coalesce(code,'within_daily_spend_cap'),'rule',case when code='model_calls_not_permitted'then 'zoe.k2.launch_gate'else 'zoe.k7.daily_spend_cap'end,'ruleVersion','k7-a-2026-10-16','actor','system',
  'attributes',jsonb_build_object('noreon.zoe.guard.name','spend_cap','noreon.zoe.spent_today_usd',spent,'noreon.zoe.estimate_usd',p_estimate_usd,'noreon.zoe.daily_cap_usd',cap,
   'noreon.zoe.spend_day',r.spend_day::text,'noreon.zoe.provider_local',p_local))));
 return case when code is null then jsonb_build_object('ok',true)else jsonb_build_object('ok',false,'code',code)end;
end$$;

-- 6. Finish -------------------------------------------------------------------------------------------
-- Records the result once (a repeat returns the recorded outcome, K09). A passing draft becomes a
-- pending ai_assistant draft only while the context it was made from is still current: a newer
-- member message (K04) or doctor work since the claim (K18, K19) makes it stale, and a doctor's own
-- pending draft for the current context is never replaced. It has no approval, intent or delivery
-- capability: the doctor approves exact text through the existing reply machine.
create function public.zoe_run_finish(p_run uuid,p_result jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare r public.zoe_runs;c public.conversations;v_outcome text;v_reason text;d uuid;cr bigint;src text;v_summary text;v_draft text;v_sealed text;reasons text[];
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 select * into r from public.zoe_runs where id=p_run for update;
 if not found then return jsonb_build_object('ok',false,'code','run_unknown');end if;
 if r.state='finished'then return jsonb_build_object('ok',true,'outcome',r.outcome,'replayed',true);end if;
 v_outcome:=p_result->>'outcome';v_reason:=p_result->>'reason';v_summary:=nullif(btrim(p_result->>'summary'),'');v_draft:=nullif(btrim(p_result->>'draft'),'');v_sealed:=p_result->>'sealed';
 -- Fable Z-F4: oversized sealed IO is not kept (recorded as not stored) rather than losing the run.
 if length(v_sealed)>200000 then v_sealed:=null;end if;
 if v_outcome is null or v_outcome not in('draft_proposed','draft_blocked','summary_only','discarded','no_output')or coalesce(v_reason,'')!~'^[a-z0-9_.:-]{1,80}$'
  or length(v_summary)>4000 or length(v_draft)>2000 or(v_outcome='draft_proposed'and(v_draft is null or v_summary is null))
  or jsonb_typeof(coalesce(p_result->'guardReasons','[]'))<>'array'
  or coalesce(p_result->>'provider','none')!~'^[a-z0-9_.-]{1,64}$'or coalesce(p_result->>'model','none')!~'^[a-z0-9_.:-]{1,80}$'
  or coalesce((p_result->>'costUsd')::numeric,0)<0 then
  return jsonb_build_object('ok',false,'code','invalid');end if;
 select coalesce(array_agg(x)filter(where x~'^[a-z0-9_.:-]{1,80}$'),'{}')into reasons from jsonb_array_elements_text(p_result->'guardReasons')x;
 perform public._zoe_run_events(r,p_result->'events');
 if v_outcome='draft_proposed'then
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
 update public.zoe_runs z set state='finished',outcome=v_outcome,reason_code=v_reason,provider=coalesce(p_result->>'provider','none'),model=coalesce(p_result->>'model','none'),
  config_version=left(coalesce(p_result->>'configVersion','unknown'),200),cost_usd=case when z.reserved then coalesce((p_result->>'costUsd')::numeric,0)end,
  input_tokens=(p_result#>>'{usage,inputTokens}')::integer,output_tokens=(p_result#>>'{usage,outputTokens}')::integer,latency_ms=(p_result->>'latencyMs')::integer,
  redaction_count=coalesce((p_result->>'redactionCount')::integer,0),guard_reasons=reasons,
  summary=case when d is null then v_summary end,draft_id=d,sealed_io=v_sealed,finished_at=clock_timestamp()
 where z.id=r.id returning * into r;
 perform public._zoe_run_events(r,jsonb_build_array(jsonb_build_object('name','zoe.route',
  'outcome',case v_outcome when 'draft_proposed'then 'allow'when 'draft_blocked'then 'block'when 'summary_only'then 'recorded'when 'no_output'then 'failed'
   else case when v_reason='urgent_route_no_model_call'then 'escalate'else 'skipped'end end,
  'reason',v_reason,'rule','zoe.pipeline','ruleVersion',left(coalesce(p_result->>'configVersion','unknown'),80),'actor','system',
  'attributes',jsonb_strip_nulls(jsonb_build_object('noreon.zoe.run.outcome',v_outcome,'noreon.draft.id',d::text,'noreon.zoe.cost_usd',r.cost_usd,
   'gen_ai.usage.input_tokens',r.input_tokens,'gen_ai.usage.output_tokens',r.output_tokens,'noreon.zoe.latency_ms',r.latency_ms,
   'noreon.zoe.guard.reasons',left(array_to_string(reasons,','),128),'noreon.zoe.io_stored',r.sealed_io is not null)))));
 return jsonb_build_object('ok',true,'outcome',v_outcome,'replayed',false,'draftId',d);
end$$;

-- 7. Reads ----------------------------------------------------------------------------------------------
-- The assigned doctor sees Zoe's recent runs for their own member: outcome, reasons and the
-- summary when no draft carries it. The draft itself is in the conversation workspace.
create function public.zoe_runs_for_doctor(p_member uuid)returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare who jsonb:=public.real_clinical_staff_identity();
begin
 if who is null or who->>'role'<>'doctor'or not exists(select 1 from public.patient_clinical_cases where user_id=p_member and assigned_doctor_id=auth.uid())then raise insufficient_privilege;end if;
 return jsonb_build_object('ok',true,'runs',coalesce((select jsonb_agg(jsonb_build_object('id',z.id,'messageSeq',z.message_seq,'outcome',z.outcome,'reason',z.reason_code,
  'summary',z.summary,'guardReasons',to_jsonb(z.guard_reasons),'provider',z.provider,'model',z.model,'draftId',z.draft_id,
  'draftState',(select d.state from public.conversation_drafts d where d.id=z.draft_id),
  'draftCurrent',(select d.context_version=c.version from public.conversation_drafts d join public.conversations c on c.id=d.conversation_id where d.id=z.draft_id),'finishedAt',z.finished_at)order by z.finished_at desc)
  from(select * from public.zoe_runs where member_id=p_member and state='finished'and outcome<>'skipped'order by finished_at desc limit 5)z),'[]'));
end$$;

-- Admin only, for the Trace page: one run's metadata and its sealed redacted input and output.
-- Every read is itself journaled.
create function public.zoe_run_detail(p_run uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare admin uuid:=public._real_staff_require_admin();r public.zoe_runs;
begin
 select * into r from public.zoe_runs where id=p_run;
 if not found then return jsonb_build_object('ok',false,'code','run_unknown');end if;
 perform public._conversation_trace(r.member_id,r.conversation_id,'zoe_run',r.id::text,'zoe','zoe.run.io_viewed','recorded','admin_opened_run_detail','zoe.trace_access','1','admin',admin,
  jsonb_build_object('noreon.zoe.run.id',r.id::text,'noreon.zoe.io_stored',r.sealed_io is not null));
 return jsonb_build_object('ok',true,'run',jsonb_build_object('id',r.id,'memberId',r.member_id,'messageSeq',r.message_seq,'outcome',r.outcome,'reason',r.reason_code,
  'provider',r.provider,'model',r.model,'configVersion',r.config_version,'costUsd',r.cost_usd,'inputTokens',r.input_tokens,'outputTokens',r.output_tokens,'latencyMs',r.latency_ms,
  'guardReasons',to_jsonb(r.guard_reasons),'redactionCount',r.redaction_count,'summary',r.summary,'draftId',r.draft_id,'startedAt',r.started_at,'finishedAt',r.finished_at,'sealed',r.sealed_io));
end$$;

-- 8. RLS and grants -------------------------------------------------------------------------------------
alter table public.zoe_runs enable row level security;
revoke all on public.zoe_runs from public,anon,authenticated,service_role;
revoke all on function public._zoe_run_events(public.zoe_runs,jsonb),public.zoe_run_claim(integer),public.zoe_run_reserve(uuid,numeric,boolean,jsonb),
 public.zoe_run_finish(uuid,jsonb),public.zoe_runs_for_doctor(uuid),public.zoe_run_detail(uuid)from public,anon,authenticated,service_role;
grant execute on function public.zoe_run_claim(integer),public.zoe_run_reserve(uuid,numeric,boolean,jsonb),public.zoe_run_finish(uuid,jsonb)to service_role;
grant execute on function public.zoe_runs_for_doctor(uuid),public.zoe_run_detail(uuid)to authenticated;
