-- Zoe app V3 onboarding (build prompt PR 6): consent evidence, the communication profile card, medicine status, and
-- where each anamnesis answer came from. Everything here is additive: new columns are nullable or defaulted, and nothing
-- writes them until the app calls the new functions under NOREON_ZOE_APP_V3. The one replaced function,
-- member_medicine_update, behaves as before on rows whose new columns are null.

-- 1. The profile card ----------------------------------------------------------------------------------------------
alter table public.zoe_chat_cards drop constraint zoe_chat_cards_kind_check;
alter table public.zoe_chat_cards add constraint zoe_chat_cards_kind_check
  check(kind in('dose','bp','results','plan','visit','side_effect','message','menu','ldl','ask','medicines','account','repeat','red_flags','profile'));

-- 2. Consent evidence ----------------------------------------------------------------------------------------------
-- zoe_consents is the row the chat consent writes (zoe_consent_set, source zoe_screen); patient_consents is the sign-up
-- agreement. The table is append-only, so the hash goes in with the insert. zoe_consent_set stays exactly as it is, with
-- all its gates: the new function only hands it the hash through a transaction-local setting a trigger reads.
alter table public.zoe_consents add column text_hash text check(text_hash ~ '^[a-f0-9]{64}$');
alter table public.zoe_consents add column method text not null default 'tap' check(method in('tap','voice'));

create function public._zoe_consent_shown()returns trigger language plpgsql set search_path=''as $$
begin
 if new.granted and new.kind='zoe_reads_messages'then new.text_hash:=nullif(current_setting('noreon.zoe_consent_text_hash',true),'');end if;
 return new;
end$$;
create trigger zoe_consents_shown_text before insert on public.zoe_consents for each row execute function public._zoe_consent_shown();
revoke all on function public._zoe_consent_shown()from public,anon,authenticated,service_role;

-- A yes on the Zoe screen, with the sha-256 of the exact text the member was shown.
create function public.zoe_consent_accept_shown(p_wording_version text,p_text_hash text)returns jsonb
language plpgsql security invoker set search_path=''as $$
declare r jsonb;
begin
 if coalesce(p_text_hash,'')!~'^[a-f0-9]{64}$'then return jsonb_build_object('ok',false,'code','invalid');end if;
 perform set_config('noreon.zoe_consent_text_hash',p_text_hash,true);
 r:=public.zoe_consent_set('zoe_reads_messages',true,p_wording_version,'zoe_screen');
 perform set_config('noreon.zoe_consent_text_hash','',true);
 return r;
end$$;
revoke all on function public.zoe_consent_accept_shown(text,text)from public,anon,authenticated,service_role;
grant execute on function public.zoe_consent_accept_shown(text,text)to authenticated;

-- 3. Communication profile -----------------------------------------------------------------------------------------
-- Readable by the member only, through the existing own_member_preferences policy; no staff read and no Zoe read touches
-- these columns. contact_channel stays what it was (how a person reaches the member); preferred_channel is how the member
-- wants Zoe to talk with them.
alter table public.member_preferences add column preferred_channel text check(preferred_channel in('voice','text'));
alter table public.member_preferences add column caregiver_contact jsonb
 check(caregiver_contact is null or(jsonb_typeof(caregiver_contact)='object'and octet_length(caregiver_contact::text)<=300));

create function public.member_profile_card_save(p_channel text,p_caregiver jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare uid uuid:=public._member_callback_member();
begin
 if p_channel is null or p_channel not in('voice','text')then raise check_violation using message='Choose how to contact you';end if;
 if p_caregiver is not null and(jsonb_typeof(p_caregiver)<>'object'
  or(select count(*)from jsonb_object_keys(p_caregiver))<>2 or not p_caregiver?&array['name','phone']
  or jsonb_typeof(p_caregiver->'name')<>'string'or jsonb_typeof(p_caregiver->'phone')<>'string'
  or length(btrim(p_caregiver->>'name'))not between 1 and 80
  or(p_caregiver->>'phone')!~'^\+?[0-9][0-9 ()-]{5,19}$')then
  raise check_violation using message='Check the contact details';end if;
 insert into public.member_preferences(user_id,preferred_channel,caregiver_contact)values(uid,p_channel,p_caregiver)
 on conflict(user_id)do update set preferred_channel=excluded.preferred_channel,caregiver_contact=excluded.caregiver_contact,updated_at=clock_timestamp();
 return jsonb_build_object('ok',true);
end$$;
revoke all on function public.member_profile_card_save(text,jsonb)from public,anon,authenticated,service_role;
grant execute on function public.member_profile_card_save(text,jsonb)to authenticated;

-- 4. Medicines -----------------------------------------------------------------------------------------------------
-- member_medicines.source already exists and only ever holds 'self-reported' (the staff and member reads depend on it), so
-- the provenance tag gets its own column. Unknown stays null. class is not asked of the member: it waits for a clinician.
alter table public.member_medicines add column class text check(class in('antihypertensive','lipid_lowering','other'));
alter table public.member_medicines add column status text check(status in('continuous','course_stopped','prn'));
alter table public.member_medicines add column stop_reason text
 check(stop_reason in('forgot','side_effect','cost_or_availability','ran_out','decided_to_stop','values_normal'));
alter table public.member_medicines add column provenance text check(provenance in('patient_reported_anamnesis','historical_record_uploaded_by_patient',
 'historical_record_uploaded_by_staff','patient_voice_confirmed','patient_text_entry','lab_ocr_confirmed','device_bluetooth_validated','clinician_measured_and_approved'));
alter table public.member_medicines add constraint member_medicines_stop_reason_course check(stop_reason is null or status='course_stopped');

-- As in 20261026190426_member_medicine_kept_times.sql, plus: a schedule change keeps what is known about the medicine.
create or replace function public.member_medicine_update(p_id uuid,p_dose text,p_times time[])returns jsonb
language plpgsql security definer set search_path=''as $$
declare uid uuid:=auth.uid();m public.member_medicines;ts time[];nowt timestamptz:=clock_timestamp();mid uuid;
begin
 if uid is null or auth.role()is distinct from 'authenticated'then raise insufficient_privilege;end if;
 if not(select enabled from public.member_medicine_settings where singleton)then return jsonb_build_object('status','disabled');end if;
 if exists(select 1 from public.workspace_staff where user_id=uid)or not exists(select 1 from public.profiles where id=uid)then raise insufficient_privilege;end if;
 if p_id is null or(p_dose is not null and length(btrim(p_dose))>120)or not public._member_medicine_times_ok(p_times)then return jsonb_build_object('status','invalid');end if;
 perform pg_advisory_xact_lock(hashtextextended('member-medicines:'||uid::text,0));
 select * into m from public.member_medicines where id=p_id and user_id=uid and stopped_at is null for update;
 if not found then return jsonb_build_object('status','not-found');end if;
 ts:=(select array_agg(t order by t)from unnest(p_times)t);
 if ts=m.times then
  update public.member_medicines set dose=nullif(btrim(p_dose),'')where id=m.id;
  return jsonb_build_object('status','saved','id',m.id);
 end if;
 insert into public.member_medicines(user_id,name,dose,times,started_on,effective_at,class,status,stop_reason,provenance)
  values(uid,m.name,nullif(btrim(p_dose),''),ts,(nowt at time zone 'Asia/Yerevan')::date,nowt,m.class,m.status,m.stop_reason,m.provenance)returning id into mid;
 update public.member_medicines set stopped_at=nowt,replaced_by=mid where id=m.id;
 -- A tick given early (up to 60 minutes ahead) for a time the new schedule keeps moves with it (Astra R393-01 follow-up).
 update public.member_medicine_doses set medicine_id=mid where medicine_id=m.id and due_at>=nowt and(due_at at time zone 'Asia/Yerevan')::time=any(ts);
 return jsonb_build_object('status','saved','id',mid);
end$$;

-- The member's status and stop reason, on a separate read: _member_medicine_json feeds staff and Zoe reads, which stay as
-- they are in this PR.
create function public.member_medicine_details_read()returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare uid uuid:=auth.uid();
begin
 if uid is null or auth.role()is distinct from 'authenticated'then raise insufficient_privilege;end if;
 if not(select enabled from public.member_medicine_settings where singleton)then return '[]'::jsonb;end if;
 -- Active rows, then courses the member ended, which they can restore. A row a schedule change replaced is neither.
 return coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'status',m.status,'stopReason',m.stop_reason,'stopped',m.stopped_at is not null,'name',m.name,'dose',m.dose,
   'times',(select jsonb_agg(to_char(t,'HH24:MI')order by t)from unnest(m.times)t))order by m.created_at)
  from public.member_medicines m where m.user_id=uid and(m.stopped_at is null or(m.status='course_stopped'and m.replaced_by is null))),'[]'::jsonb);
end$$;
revoke all on function public.member_medicine_details_read()from public,anon,authenticated,service_role;
grant execute on function public.member_medicine_details_read()to authenticated;

-- One saved list, all or nothing, from the medicines card. p_changes: [{id,status,stopReason}] on the member's own rows.
-- p_added: [{requestId,name,dose,times,status,stopReason}]. A course that ended leaves the active list, as Stop does, so
-- no reminder goes on for it; the row keeps why. A retry of the same list replays: added rows by request id, changes
-- because the row already says so. Doctor plan medicines are not on this table.
create function public.member_medicines_review(p_changes jsonb,p_added jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare uid uuid:=auth.uid();c jsonb;m public.member_medicines;r jsonb;new_rows integer;mid uuid;
 statuses text[]:=array['continuous','course_stopped','prn'];
 reasons text[]:=array['forgot','side_effect','cost_or_availability','ran_out','decided_to_stop','values_normal'];
begin
 if uid is null or auth.role()is distinct from 'authenticated'then raise insufficient_privilege;end if;
 if not(select enabled from public.member_medicine_settings where singleton)then return jsonb_build_object('status','disabled');end if;
 if exists(select 1 from public.workspace_staff where user_id=uid)or not exists(select 1 from public.profiles where id=uid)then raise insufficient_privilege;end if;
 if jsonb_typeof(p_changes)is distinct from 'array'or jsonb_typeof(p_added)is distinct from 'array'
  or jsonb_array_length(p_changes)+jsonb_array_length(p_added)not between 1 and 40 then return jsonb_build_object('status','invalid');end if;
 for c in select value from jsonb_array_elements(p_changes)union all select value from jsonb_array_elements(p_added)loop
  if jsonb_typeof(c)<>'object'then return jsonb_build_object('status','invalid');end if;
  if c->>'status'is not null and not(c->>'status'=any(statuses))or c->>'stopReason'is not null and not(c->>'stopReason'=any(reasons))
   or c->>'stopReason'is not null and c->>'status'is distinct from 'course_stopped'then return jsonb_build_object('status','invalid');end if;
 end loop;
 perform pg_advisory_xact_lock(hashtextextended('member-medicines:'||uid::text,0));
 -- Everything is checked before the first write.
 for c in select value from jsonb_array_elements(p_changes)loop
  if c->>'status'is null or coalesce(c->>'id','')!~'^[0-9a-f-]{36}$'then return jsonb_build_object('status','invalid');end if;
  select * into m from public.member_medicines where id=(c->>'id')::uuid and user_id=uid;
  if not found or(m.stopped_at is not null and m.status is distinct from c->>'status')then return jsonb_build_object('status','not-found');end if;
 end loop;
 select count(*)into new_rows from jsonb_array_elements(p_added)a
  where not exists(select 1 from public.member_medicines x where x.user_id=uid and x.request_id::text=a.value->>'requestId');
 if(select count(*)from public.member_medicines where user_id=uid and stopped_at is null)+new_rows>20 then return jsonb_build_object('status','limit');end if;
 for c in select value from jsonb_array_elements(p_changes)loop
  update public.member_medicines set status=c->>'status',stop_reason=c->>'stopReason',provenance=coalesce(provenance,'patient_text_entry'),
   stopped_at=case when c->>'status'='course_stopped'then coalesce(stopped_at,clock_timestamp())else stopped_at end
   where id=(c->>'id')::uuid and user_id=uid;
 end loop;
 for c in select value from jsonb_array_elements(p_added)loop
  r:=public.member_medicine_add(c->>'name',c->>'dose',(select array_agg(t::time)from jsonb_array_elements_text(c->'times')t),(c->>'requestId')::uuid);
  -- Rolls the whole list back: the member sees one result for one list.
  if r->>'status'<>'added'then raise exception 'Medicine list save failed'using errcode='P0001';end if;
  mid:=(r->>'id')::uuid;
  update public.member_medicines set status=c->>'status',stop_reason=c->>'stopReason',provenance='patient_text_entry',
   stopped_at=case when c->>'status'='course_stopped'then coalesce(stopped_at,clock_timestamp())else stopped_at end
   where id=mid and user_id=uid;
 end loop;
 return jsonb_build_object('status','saved');
end$$;
revoke all on function public.member_medicines_review(jsonb,jsonb)from public,anon,authenticated,service_role;
grant execute on function public.member_medicines_review(jsonb,jsonb)to authenticated;

-- Undo for "Was a course". The same row comes back, so its ticks stay with it and no second row appears; what was said
-- moves to this log. Doses in the gap are not owed: effective_at starts the schedule again now, as a schedule change does.
create table public.member_medicine_status_events(
 id bigint generated always as identity primary key,
 medicine_id uuid not null,
 user_id uuid not null,
 status text not null,
 stop_reason text,
 stopped_at timestamptz not null,
 restored_at timestamptz not null default clock_timestamp(),
 foreign key(medicine_id,user_id)references public.member_medicines(id,user_id)on delete cascade
);
create index member_medicine_status_events_medicine on public.member_medicine_status_events(medicine_id);
alter table public.member_medicine_status_events enable row level security;
revoke all on public.member_medicine_status_events from public,anon,authenticated,service_role;

create function public.member_medicine_restore(p_id uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare uid uuid:=auth.uid();m public.member_medicines;nowt timestamptz:=clock_timestamp();
begin
 if uid is null or auth.role()is distinct from 'authenticated'then raise insufficient_privilege;end if;
 if not(select enabled from public.member_medicine_settings where singleton)then return jsonb_build_object('status','disabled');end if;
 if exists(select 1 from public.workspace_staff where user_id=uid)or not exists(select 1 from public.profiles where id=uid)then raise insufficient_privilege;end if;
 perform pg_advisory_xact_lock(hashtextextended('member-medicines:'||uid::text,0));
 select * into m from public.member_medicines where id=p_id and user_id=uid for update;
 if not found then return jsonb_build_object('status','not-found');end if;
 -- A retry after a lost reply.
 if m.stopped_at is null and exists(select 1 from public.member_medicine_status_events e where e.medicine_id=m.id)then return jsonb_build_object('status','saved','id',m.id);end if;
 if m.stopped_at is null or m.status is distinct from 'course_stopped'or m.replaced_by is not null then return jsonb_build_object('status','not-found');end if;
 -- Added again by hand since: restoring would list it twice.
 if exists(select 1 from public.member_medicines x where x.user_id=uid and x.stopped_at is null and lower(x.name)=lower(m.name))then return jsonb_build_object('status','duplicate');end if;
 if(select count(*)from public.member_medicines where user_id=uid and stopped_at is null)>=20 then return jsonb_build_object('status','limit');end if;
 insert into public.member_medicine_status_events(medicine_id,user_id,status,stop_reason,stopped_at)values(m.id,uid,m.status,m.stop_reason,m.stopped_at);
 update public.member_medicines set stopped_at=null,status=null,stop_reason=null,effective_at=nowt where id=m.id;
 return jsonb_build_object('status','saved','id',m.id);
end$$;
revoke all on function public.member_medicine_restore(uuid)from public,anon,authenticated,service_role;
grant execute on function public.member_medicine_restore(uuid)to authenticated;

-- A claim that ended in a definite refusal: nothing was written, so the member may send a corrected list. Only the
-- holder's own operation, and never once a result is recorded.
create function public.zoe_chat_card_unclaim(p_member uuid,p_card uuid,p_item text,p_op uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare k public.zoe_chat_cards;
begin
 select * into k from public.zoe_chat_cards where id=p_card and member_id=p_member and kind in('medicines','profile')for update;
 if not found or k.outcome?p_item or(k.claims#>>array[p_item,'op'])is distinct from p_op::text then return jsonb_build_object('ok',false);end if;
 update public.zoe_chat_cards set claims=claims-p_item,updated_at=clock_timestamp()where id=k.id;
 return jsonb_build_object('ok',true);
end$$;
revoke all on function public.zoe_chat_card_unclaim(uuid,uuid,text,uuid)from public,anon,authenticated,service_role;
grant execute on function public.zoe_chat_card_unclaim(uuid,uuid,text,uuid)to service_role;

-- 5. Where each anamnesis answer came from -------------------------------------------------------------------------
alter table public.patient_assessments add column answer_sources jsonb not null default '{}'
 check(jsonb_typeof(answer_sources)='object'and octet_length(answer_sources::text)<100000);

-- save_patient_assessment, which stays for callers without a source, plus the tag for each field saved. The stored map is
-- reconciled with the answers being saved, so an answer removed by a change to its parent loses its source in this update.
create function public.save_patient_assessment_sourced(p_user_id uuid,p_expected_revision bigint,p_answers jsonb,p_complete boolean,p_urgent_rule text,p_sources jsonb)
returns bigint language plpgsql security invoker set search_path=''as $$
declare new_revision bigint;
begin
 if jsonb_typeof(p_sources)is distinct from 'object'or exists(select 1 from jsonb_each(p_sources)e where jsonb_typeof(e.value)<>'null'and(e.value#>>'{}')not in('patient_reported_anamnesis','historical_record_uploaded_by_patient',
  'historical_record_uploaded_by_staff','patient_voice_confirmed','patient_text_entry','lab_ocr_confirmed','device_bluetooth_validated','clinician_measured_and_approved'))then
  raise check_violation using message='Unknown answer source';end if;
 update public.patient_assessments set answers=p_answers,
  answer_sources=(select coalesce(jsonb_object_agg(e.key,e.value),'{}'::jsonb)from jsonb_each(answer_sources||p_sources)e where jsonb_typeof(e.value)<>'null'and p_answers?e.key),
  revision=revision+1,
  completed_at=case when p_complete and p_urgent_rule is null then now()else null end,
  urgent_rule=p_urgent_rule,updated_at=now()
  where user_id=p_user_id and revision=p_expected_revision returning revision into new_revision;
 return coalesce(new_revision,-1);
end$$;
revoke all on function public.save_patient_assessment_sourced(uuid,bigint,jsonb,boolean,text,jsonb)from public,anon,authenticated,service_role;
grant execute on function public.save_patient_assessment_sourced(uuid,bigint,jsonb,boolean,text,jsonb)to service_role;
