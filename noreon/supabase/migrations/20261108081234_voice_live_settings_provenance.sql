-- WP V (voice merge): Gemini Live as a streaming speech-to-text transport, spoken confirmation, voice settings for the
-- Noreon administrator.
--
-- 1. voice_settings gains live_enabled and live_model. The Live session is used only as streaming transcription with
--    turn detection; Zoe's words still come from the guarded text pipeline and the existing speech synthesis.
-- 2. voice_settings_events: an append-only trail of every settings change (who, which fields, version), registered in
--    the unified audit read as an admin change. voice_settings_admin_read / voice_settings_admin_update: Noreon
--    administrator only (_real_staff_require_admin), optimistic version check, idempotent on the request id.
-- 3. Rate limits for the single-use Live token routes: member_live and staff_live.
-- 4. Provenance: a reading dictated through a Live session and confirmed on its card is stored as
--    'patient_voice_live_confirmed'. The transcript reached the server through the browser, so no server receipt attests
--    it: like a typed reading it is an unverified member observation. It keeps the typed reading's safety net (the nurse
--    verification task at 180 and above) and is left out of the measured-BP aggregates, exactly as caregiver_reported is.

create or replace function pg_temp.widen_in_check(p_table regclass,p_constraint text,p_column text,p_add text[])returns void
language plpgsql as $$
declare def text;vals text[];
begin
 select pg_get_constraintdef(oid)into def from pg_constraint where conrelid=p_table and conname=p_constraint;
 if def is null then raise exception 'Constraint % not found',p_constraint;end if;
 select coalesce(array_agg(m[1] order by ord),'{}')into vals from regexp_matches(def,'''([^'']+)''::text','g')with ordinality t(m,ord);
 if cardinality(vals)=0 then raise exception 'Constraint % is not a value list',p_constraint;end if;
 select array_agg(v order by first_seen)into vals from(select v,min(o)first_seen from unnest(vals||p_add)with ordinality u(v,o)group by v)x;
 execute format('alter table %s drop constraint %I',p_table,p_constraint);
 execute format('alter table %s add constraint %I check(%I in(%s))',p_table,p_constraint,p_column,(select string_agg(quote_literal(v),',')from unnest(vals)v));
end$$;

-- 1. Live settings ----------------------------------------------------------------------------------------------------
alter table public.voice_settings
 add column live_enabled boolean not null default false,
 add column live_model text not null default 'gemini-live-2.5-flash-preview'
  constraint voice_settings_live_model_check check(live_model ~ '^(models/)?[a-z0-9][a-z0-9.-]{2,79}$');

-- 2. Settings trail and the administrator's read and update ------------------------------------------------------------
create table public.voice_settings_events(
 id bigint generated always as identity primary key,
 at timestamptz not null default clock_timestamp(),
 actor_id uuid not null,
 request_id uuid not null constraint voice_settings_events_request unique,
 from_version integer not null check(from_version>0),
 to_version integer not null,
 changed text[] not null constraint voice_settings_events_changed_check check(cardinality(changed)between 1 and 8
  and changed<@array['enabled','live_enabled','live_model','stt_model','stt_urgent_model','tts_model','tts_voice','tts_instructions']::text[]),
 constraint voice_settings_events_version_step check(to_version=from_version+1)
);
alter table public.voice_settings_events enable row level security;
revoke all on public.voice_settings_events from public,anon,authenticated,service_role;
grant select on public.voice_settings_events to service_role;
-- No policies: read through voice_settings_admin_read and the unified audit only.
create trigger voice_settings_events_immutable before update or delete on public.voice_settings_events
 for each row execute function public._audit_immutable();

create function public._voice_settings_json(s public.voice_settings)returns jsonb
language sql stable security definer set search_path=''as $$
 select jsonb_build_object('enabled',s.enabled,'liveEnabled',s.live_enabled,'liveModel',s.live_model,'sttModel',s.stt_model,
  'sttUrgentModel',s.stt_urgent_model,'ttsModel',s.tts_model,'ttsVoice',s.tts_voice,'version',s.version,
  'updatedAt',to_char(s.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
$$;
revoke all on function public._voice_settings_json(public.voice_settings)from public,anon,authenticated,service_role;

create function public.voice_settings_admin_read()returns jsonb
language plpgsql security definer set search_path=''as $$
declare s public.voice_settings;
begin
 perform public._real_staff_require_admin();
 select * into s from public.voice_settings where id;
 if not found then return jsonb_build_object('ok',false,'code','not_found');end if;
 return jsonb_build_object('ok',true,'settings',public._voice_settings_json(s),'history',coalesce((
  select jsonb_agg(jsonb_build_object('at',to_char(e.at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'actorId',e.actor_id,
   'fromVersion',e.from_version,'toVersion',e.to_version,'changed',to_jsonb(e.changed))order by e.at desc,e.id desc)
  from(select * from public.voice_settings_events order by at desc,id desc limit 10)e),'[]'::jsonb));
end$$;
revoke all on function public.voice_settings_admin_read()from public,anon,authenticated,service_role;
grant execute on function public.voice_settings_admin_read()to authenticated;

-- p_patch holds only the fields to change. Unknown keys, wrong types and out-of-range values are refused as a whole.
create function public.voice_settings_admin_update(p_request_id uuid,p_expected_version integer,p_patch jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare actor uuid;s public.voice_settings;n public.voice_settings;changed text[]:='{}';k text;prior public.voice_settings_events;
begin
 actor:=public._real_staff_require_admin();
 if p_request_id is null or p_expected_version is null or jsonb_typeof(p_patch)is distinct from 'object'or p_patch='{}'::jsonb
  or exists(select 1 from jsonb_object_keys(p_patch)x where x not in('enabled','live_enabled','live_model','stt_model','stt_urgent_model','tts_model','tts_voice','tts_instructions'))
 then return jsonb_build_object('ok',false,'code','invalid');end if;
 for k in select jsonb_object_keys(p_patch)loop
  if k in('enabled','live_enabled')and jsonb_typeof(p_patch->k)<>'boolean'then return jsonb_build_object('ok',false,'code','invalid');end if;
  if k not in('enabled','live_enabled')and jsonb_typeof(p_patch->k)<>'string'then return jsonb_build_object('ok',false,'code','invalid');end if;
 end loop;
 if p_patch?'live_model'and(p_patch->>'live_model')!~'^(models/)?[a-z0-9][a-z0-9.-]{2,79}$'
  or exists(select 1 from unnest(array['stt_model','stt_urgent_model','tts_model'])m where p_patch?m and length(btrim(p_patch->>m))not between 1 and 160)
  or p_patch?'tts_voice'and length(btrim(p_patch->>'tts_voice'))not between 1 and 80
  or p_patch?'tts_instructions'and length(btrim(p_patch->>'tts_instructions'))not between 1 and 599
 then return jsonb_build_object('ok',false,'code','invalid');end if;
 perform pg_advisory_xact_lock(hashtextextended('voice-settings',0));
 select * into prior from public.voice_settings_events where request_id=p_request_id;
 select * into s from public.voice_settings where id for update;
 if not found then return jsonb_build_object('ok',false,'code','not_found');end if;
 -- A retry of a recorded change answers with the settings as they are now.
 if prior.id is not null then
  if prior.actor_id<>actor then return jsonb_build_object('ok',false,'code','invalid');end if;
  return jsonb_build_object('ok',true,'replayed',true,'changed',true,'settings',public._voice_settings_json(s));
 end if;
 if s.version<>p_expected_version then return jsonb_build_object('ok',false,'code','stale','settings',public._voice_settings_json(s));end if;
 n:=s;
 if p_patch?'enabled'then n.enabled:=(p_patch->>'enabled')::boolean;end if;
 if p_patch?'live_enabled'then n.live_enabled:=(p_patch->>'live_enabled')::boolean;end if;
 if p_patch?'live_model'then n.live_model:=p_patch->>'live_model';end if;
 if p_patch?'stt_model'then n.stt_model:=btrim(p_patch->>'stt_model');end if;
 if p_patch?'stt_urgent_model'then n.stt_urgent_model:=btrim(p_patch->>'stt_urgent_model');end if;
 if p_patch?'tts_model'then n.tts_model:=btrim(p_patch->>'tts_model');end if;
 if p_patch?'tts_voice'then n.tts_voice:=btrim(p_patch->>'tts_voice');end if;
 if p_patch?'tts_instructions'then n.tts_instructions:=btrim(p_patch->>'tts_instructions');end if;
 if n.enabled is distinct from s.enabled then changed:=changed||'enabled'::text;end if;
 if n.live_enabled is distinct from s.live_enabled then changed:=changed||'live_enabled'::text;end if;
 if n.live_model is distinct from s.live_model then changed:=changed||'live_model'::text;end if;
 if n.stt_model is distinct from s.stt_model then changed:=changed||'stt_model'::text;end if;
 if n.stt_urgent_model is distinct from s.stt_urgent_model then changed:=changed||'stt_urgent_model'::text;end if;
 if n.tts_model is distinct from s.tts_model then changed:=changed||'tts_model'::text;end if;
 if n.tts_voice is distinct from s.tts_voice then changed:=changed||'tts_voice'::text;end if;
 if n.tts_instructions is distinct from s.tts_instructions then changed:=changed||'tts_instructions'::text;end if;
 if cardinality(changed)=0 then return jsonb_build_object('ok',true,'replayed',false,'changed',false,'settings',public._voice_settings_json(s));end if;
 update public.voice_settings set enabled=n.enabled,live_enabled=n.live_enabled,live_model=n.live_model,stt_model=n.stt_model,
  stt_urgent_model=n.stt_urgent_model,tts_model=n.tts_model,tts_voice=n.tts_voice,tts_instructions=n.tts_instructions,
  version=s.version+1,updated_at=clock_timestamp()where id returning * into n;
 insert into public.voice_settings_events(actor_id,request_id,from_version,to_version,changed)values(actor,p_request_id,s.version,n.version,changed);
 return jsonb_build_object('ok',true,'replayed',false,'changed',true,'settings',public._voice_settings_json(n));
end$$;
revoke all on function public.voice_settings_admin_update(uuid,integer,jsonb)from public,anon,authenticated,service_role;
grant execute on function public.voice_settings_admin_update(uuid,integer,jsonb)to authenticated;

-- The settings trail joins the unified audit read as an administrator change (never shown to a clinic).
do $migration$
declare def text:=pg_get_functiondef('public._audit_source_rows(timestamptz,timestamptz,uuid,uuid,text)'::regprocedure);patched text;
begin
 patched:=regexp_replace(def,'\s*\$function\$\s*$',$add$
 union all
 select e.at,'voice_settings:'||e.id,'admin_change','voice_settings','updated',e.actor_id,null::uuid,e.to_version::text
  from public.voice_settings_events e where e.at>=p_from and e.at<=p_to
   and(p_category is null or p_category='admin_change')and(p_actor is null or e.actor_id=p_actor)and p_member is null
$function$
$add$);
 if patched=def then raise exception 'Unexpected _audit_source_rows definition';end if;
 execute patched;
end $migration$;

-- 3. Live token limits: a token is single use and short lived, so a member needs one per voice conversation.
do $migration$
declare definition text;old text:=$old$('member_speech','user',60,60),$old$;
begin
 definition:=pg_get_functiondef('public._rate_limit_policy(text,text)'::regprocedure);
 if cardinality(string_to_array(definition,old))<>2 then raise exception 'Unexpected speech rate policy';end if;
 execute replace(definition,old,old||E'\n  (''member_live'',''source'',120,3600),\n  (''member_live'',''user'',30,3600),\n  (''staff_live'',''source'',240,3600),\n  (''staff_live'',''user'',60,3600),');
end $migration$;

-- 4. Provenance of a Live-dictated reading -------------------------------------------------------------------------------
select pg_temp.widen_in_check('public.patient_measurements','patient_measurements_entry_source_check','entry_source',array['patient_voice_live_confirmed']);
select pg_temp.widen_in_check('public.member_medicines','member_medicines_provenance_check','provenance',array['patient_voice_live_confirmed']);

-- The card snapshot decides the label, and only when the saved numbers and time are the ones the card showed.
create or replace function public._zoe_bp_entry_source()returns trigger
language plpgsql security definer set search_path=''as $$
declare source text;
begin
 if new.entry_source is null and new.submission_id is not null then
  select k.snapshot#>>'{typed,entrySource}'into source from public.zoe_chat_cards k where k.member_id=new.user_id and k.kind='bp'
   and k.claims#>>'{bp,op}'=new.submission_id::text
   and k.snapshot#>>'{typed,entrySource}'in('patient_voice_confirmed','patient_voice_live_confirmed')
   -- Only the dictated numbers and time keep voice provenance: an edited card saves as typed.
   and (k.snapshot#>>'{typed,systolic}')::integer is not distinct from new.systolic
   and (k.snapshot#>>'{typed,diastolic}')::integer is not distinct from new.diastolic
   and (k.snapshot#>>'{typed,pulse}')::integer is not distinct from new.pulse
   and (k.snapshot#>>'{typed,measuredAt}')::timestamptz is not distinct from new.measured_at
  limit 1;
  if source is not null then new.entry_source:=source;end if;
 end if;
 return new;
end$$;
revoke all on function public._zoe_bp_entry_source()from public,anon,authenticated,service_role;

-- Unverified like a typed reading: every measured-BP aggregate that leaves caregiver_reported out leaves it out too, and the
-- nurse verification task for a high typed reading covers it, labelled as member-reported.
do $migration$
declare r record;def text;patched text;
begin
 for r in select p.oid::regprocedure fn from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname='public'and p.proname in
  ('pilot_gm_overview','_gp_report_source_body','doctor_programme_member','zoe_run_health_context','_required_evidence_sources','_bp_weekly_trend')
 loop
  def:=pg_get_functiondef(r.fn);
  patched:=regexp_replace(def,'(\m[a-z_]*\.)?entry_source is distinct from ''caregiver_reported''',
   '\1entry_source is distinct from ''caregiver_reported'' and \1entry_source is distinct from ''patient_voice_live_confirmed''','g');
  if patched=def then raise exception 'Unexpected measured-BP definition of %',r.fn;end if;
  execute patched;
 end loop;
 def:=pg_get_functiondef('public._typed_bp_task(public.patient_measurements)'::regprocedure);
 patched:=replace(def,'m.entry_source not in(''patient_text_entry'',''caregiver_reported'')','m.entry_source not in(''patient_text_entry'',''caregiver_reported'',''patient_voice_live_confirmed'')');
 if patched=def or cardinality(string_to_array(def,'m.entry_source not in(''patient_text_entry'',''caregiver_reported'')'))<>2 then raise exception 'Unexpected typed BP task definition';end if;
 execute patched;
 def:=pg_get_functiondef('public.save_patient_assessment_sourced(uuid,bigint,jsonb,boolean,text,jsonb)'::regprocedure);
 patched:=replace(def,'''patient_voice_confirmed'',''patient_text_entry''','''patient_voice_confirmed'',''patient_voice_live_confirmed'',''patient_text_entry''');
 if patched=def or cardinality(string_to_array(def,'''patient_voice_confirmed'',''patient_text_entry'''))<>2 then raise exception 'Unexpected assessment source definition';end if;
 execute patched;
end $migration$;
alter table public.care_queue_tasks drop constraint care_queue_zone_or_verification,drop constraint care_queue_sla_or_verification;
alter table public.care_queue_tasks add constraint care_queue_zone_or_verification check(
 ((queue='admin')=(zone is null))or(queue='nurse'and zone is null and reason_code='bp_member_reported_high'
  and coalesce(summary->>'entrySource' in('patient_text_entry','caregiver_reported','patient_voice_live_confirmed'),false)and source_ref ~ '^typed-bp:[a-f0-9-]{36}$'));
alter table public.care_queue_tasks add constraint care_queue_sla_or_verification check(
 queue='admin'or sla_deadline is not null or(queue='nurse'and zone is null and reason_code='bp_member_reported_high'
  and coalesce(summary->>'entrySource' in('patient_text_entry','caregiver_reported','patient_voice_live_confirmed'),false)and source_ref ~ '^typed-bp:[a-f0-9-]{36}$'));

-- 5. Voice turns in Zoe's job: the newest message's voice_receipt (a server receipt for a recorded turn, a server-signed
-- Live marker for a Live turn) marks it as spoken, so the reply uses the voice style addendum (lib/zoe/voice-style.ts).
-- The flag is added only when true, so every other job keeps exactly the shape it had.
do $migration$
declare def text;patched text;
 old_row text:=$old$jsonb_build_object('seq',w.seq,'text',w.body,'minutesAgo',w.ago)$old$;
 old_select text:=$old$select m.seq,m.body,floor(extract(epoch from clock_timestamp()-m.created_at)/60)::integer ago from public.conversation_messages m$old$;
begin
 def:=pg_get_functiondef('public.zoe_run_claim(integer)'::regprocedure);
 if cardinality(string_to_array(def,old_row))<>2 or cardinality(string_to_array(def,old_select))<>2 then raise exception 'Unexpected zoe_run_claim definition';end if;
 patched:=replace(replace(def,old_row,'('||old_row||$new$||case when w.voice then jsonb_build_object('voice',true)else '{}'::jsonb end) $new$),
  old_select,$new$select m.seq,m.body,floor(extract(epoch from clock_timestamp()-m.created_at)/60)::integer ago,m.voice_receipt is not null voice from public.conversation_messages m$new$);
 execute patched;
end $migration$;
