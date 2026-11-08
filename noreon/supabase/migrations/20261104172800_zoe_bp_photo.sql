-- Stamp assigned by the integrator (5 Nov): sorts after #607 voice (172300) and #673 (172500).
-- No photos, hashes, image text or extracted numbers enter the model-call ledger.
alter table public.patient_measurements drop constraint patient_measurements_entry_source_check;
alter table public.patient_measurements add constraint patient_measurements_entry_source_check
 check(entry_source in('patient_text_entry','patient_voice_confirmed','patient_photo_confirmed'));

-- Keep the existing writer's validation, ownership, idempotency and save trigger byte for byte.
-- A sourced variant inserts the label in the same transaction as the numbers.
do $migration$
declare definition text;old text;replacement text;
begin
 definition:=pg_get_functiondef('public._record_patient_measurement(uuid,uuid,integer,integer,integer,timestamptz)'::regprocedure);
 old:='public._record_patient_measurement(uid uuid, p_submission_id uuid, p_systolic integer, p_diastolic integer, p_pulse integer, p_measured_at timestamp with time zone)';
 replacement:='public._record_patient_measurement_sourced(uid uuid, p_submission_id uuid, p_systolic integer, p_diastolic integer, p_pulse integer, p_measured_at timestamp with time zone, p_entry_source text)';
 if cardinality(string_to_array(definition,old))<>2 then raise exception 'Unexpected measurement writer signature';end if;
 definition:=replace(definition,old,replacement);
 old:=$old$ if uid is null then raise exception 'verified membership required';end if;$old$;
 replacement:=$new$ if p_entry_source is null or p_entry_source not in('patient_text_entry','patient_photo_confirmed')then raise check_violation using message='Invalid measurement source';end if;
 if uid is null then raise exception 'verified membership required';end if;
 -- A photo-read reading is a member's own: a staff account cannot save one (Astra, 5 Nov).
 if p_entry_source='patient_photo_confirmed'and exists(select 1 from public.workspace_staff where user_id=uid)then raise insufficient_privilege;end if;$new$;
 if cardinality(string_to_array(definition,old))<>2 then raise exception 'Unexpected measurement writer validation';end if;
 definition:=replace(definition,old,replacement);
 old:=$old$ insert into public.patient_measurements(user_id,submission_id,systolic,diastolic,pulse,measured_at)
 values(uid,p_submission_id,p_systolic,p_diastolic,p_pulse,p_measured_at)$old$;
 replacement:=$new$ insert into public.patient_measurements(user_id,submission_id,systolic,diastolic,pulse,measured_at,entry_source)
 values(uid,p_submission_id,p_systolic,p_diastolic,p_pulse,p_measured_at,p_entry_source)$new$;
 if cardinality(string_to_array(definition,old))<>2 then raise exception 'Unexpected measurement writer insert';end if;
 execute replace(definition,old,replacement);
end $migration$;
revoke all on function public._record_patient_measurement_sourced(uuid,uuid,integer,integer,integer,timestamptz,text)from public,anon,authenticated,service_role;
create function public.record_patient_measurement_sourced(p_submission_id uuid,p_systolic integer,p_diastolic integer,p_pulse integer,p_measured_at timestamptz,p_entry_source text)returns uuid
language plpgsql security definer set search_path=''as $$
begin
 if auth.role()is distinct from 'authenticated'then raise insufficient_privilege;end if;
 return public._record_patient_measurement_sourced(auth.uid(),p_submission_id,p_systolic,p_diastolic,p_pulse,p_measured_at,p_entry_source);
end$$;
revoke all on function public.record_patient_measurement_sourced(uuid,integer,integer,integer,timestamptz,text)from public,anon,authenticated,service_role;
grant execute on function public.record_patient_measurement_sourced(uuid,integer,integer,integer,timestamptz,text)to authenticated;

-- Week routing and capacity remain in their existing writer. Its newly saved measurement gets
-- the source in this transaction; a replay keeps the original source. The trigger never reads this label.
create function public.bp_week_record_sourced(p_week uuid,p_slot text,p_submission uuid,p_systolic integer,p_diastolic integer,p_pulse integer,p_measured_at timestamptz,p_entry_source text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare result jsonb;
begin
 if auth.role()is distinct from 'authenticated'or auth.uid()is null then raise insufficient_privilege;end if;
 if p_entry_source is null or p_entry_source not in('patient_text_entry','patient_photo_confirmed')then raise check_violation using message='Invalid measurement source';end if;
 if p_entry_source='patient_photo_confirmed'and exists(select 1 from public.workspace_staff where user_id=auth.uid())then raise insufficient_privilege;end if;
 result:=public.bp_week_record(p_week,p_slot,p_submission,p_systolic,p_diastolic,p_pulse,p_measured_at);
 if result->>'status'='saved'then
  update public.patient_measurements set entry_source=p_entry_source where id=(result->>'measurementId')::uuid and user_id=auth.uid();
 end if;
 return result;
end$$;
revoke all on function public.bp_week_record_sourced(uuid,text,uuid,integer,integer,integer,timestamptz,text)from public,anon,authenticated,service_role;
grant execute on function public.bp_week_record_sourced(uuid,text,uuid,integer,integer,integer,timestamptz,text)to authenticated;

-- The zone annotator (as #607 voice left it) already keeps a source that is set. The voice trigger only labels
-- a reading whose source is still empty, so a photo-confirmed reading keeps its label even when the numbers equal the dictated ones.
do $migration$
declare definition text;old text:=$old$ if new.submission_id is not null and exists($old$;
begin
 definition:=pg_get_functiondef('public._zoe_bp_entry_source()'::regprocedure);
 if cardinality(string_to_array(definition,old))<>2 then raise exception 'Unexpected BP voice trigger definition';end if;
 execute replace(definition,old,$new$ if new.entry_source is null and new.submission_id is not null and exists($new$);
end $migration$;

-- Synchronous in-memory calls share the lab spend ledger and its existing reservation/finish.
-- A bp_photo row has no lab job. All ordinary lab calls still require their running job and lease.
alter table public.lab_ai_calls alter column job_id drop not null;
alter table public.lab_ai_calls drop constraint lab_ai_calls_purpose_check;
alter table public.lab_ai_calls add constraint lab_ai_calls_purpose_check check(purpose in('extract','summary','bp_photo'));
alter table public.lab_ai_calls add constraint lab_ai_calls_job_or_photo check((purpose='bp_photo')=(job_id is null));
do $migration$
declare definition text;old text;replacement text;
begin
 definition:=pg_get_functiondef('public.lab_ai_call_reserve(uuid,uuid,text,text,text,boolean,numeric)'::regprocedure);
 old:=$old$p_purpose not in('extract','summary')$old$;
 if cardinality(string_to_array(definition,old))<>2 then raise exception 'Unexpected lab reservation purpose';end if;
 definition:=replace(definition,old,$new$p_purpose not in('extract','summary','bp_photo')$new$);
 old:=$old$ select * into j from public.lab_ai_jobs where id=p_job for update;$old$;
 replacement:=$new$ if p_purpose='bp_photo'then
  if p_job is not null or p_lease is not null or p_local then return jsonb_build_object('ok',false,'code','invalid');end if;
 else
 select * into j from public.lab_ai_jobs where id=p_job for update;$new$;
 if cardinality(string_to_array(definition,old))<>2 then raise exception 'Unexpected lab reservation job guard';end if;
 definition:=replace(definition,old,replacement);
 old:=$old$ select * into s from public.zoe_settings where singleton;$old$;
 if cardinality(string_to_array(definition,old))<>2 then raise exception 'Unexpected lab reservation settings';end if;
 execute replace(definition,old,$new$ end if;
 select * into s from public.zoe_settings where singleton;
 -- The in-memory member photo needs the global model-call switch even in staging.
 if p_purpose='bp_photo'and not coalesce(s.model_calls_allowed,false)then return jsonb_build_object('ok',false,'code','model_calls_not_permitted');end if;$new$);
end $migration$;

-- Six attempts per member per minute, counted atomically by the existing database limiter.
do $migration$
declare definition text;old text:=$old$('member_upload','user',30,3600),$old$;
begin
 definition:=pg_get_functiondef('public._rate_limit_policy(text,text)'::regprocedure);
 if cardinality(string_to_array(definition,old))<>2 then raise exception 'Unexpected upload rate policy';end if;
 execute replace(definition,old,old||E'\n  (''bp_photo'',''user'',6,60),');
end $migration$;

-- The photo route's admission check: a member, not a staff account, before any model call.
create function public.bp_photo_member_allowed(p_member uuid)returns boolean
language sql stable security definer set search_path=''as $$
 select p_member is not null and not exists(select 1 from public.workspace_staff where user_id=p_member)
$$;
revoke all on function public.bp_photo_member_allowed(uuid)from public,anon,authenticated,service_role;
grant execute on function public.bp_photo_member_allowed(uuid)to service_role;
