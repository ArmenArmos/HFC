-- Zoe V3 onboarding (PR 6): new columns, RLS and the write paths. Rolled back. Run after replaying migrations.
\set ON_ERROR_STOP on
begin;
set local session_replication_role=replica;
insert into auth.users(id,phone,phone_confirmed_at)values
 ('ce600000-0000-4000-8000-000000000001','37499006001',now()),('ce600000-0000-4000-8000-000000000002','37499006002',now());
insert into public.profiles(id,locale,display_name)values
 ('ce600000-0000-4000-8000-000000000001','en','Synthetic one'),('ce600000-0000-4000-8000-000000000002','en','Synthetic two');
-- An old row, written the way today's app writes it.
insert into public.member_medicines(id,user_id,name,dose,times,started_on)values
 ('ce600000-0000-4000-8000-00000000000a','ce600000-0000-4000-8000-000000000001','Synthetic daily','1 tablet',array['08:00'::time],current_date),
 ('ce600000-0000-4000-8000-00000000000b','ce600000-0000-4000-8000-000000000001','Synthetic course',null,array['09:00'::time],current_date),
 ('ce600000-0000-4000-8000-00000000000c','ce600000-0000-4000-8000-000000000002','Other member',null,array['09:00'::time],current_date);
insert into public.patient_assessments(user_id,answers)values('ce600000-0000-4000-8000-000000000001','{}');
insert into public.member_preferences(user_id)values('ce600000-0000-4000-8000-000000000002');
reset session_replication_role;
update public.member_medicine_settings set enabled=true where singleton;

do $$
declare m public.member_medicines;a public.patient_assessments;p public.member_preferences;
begin
 -- Defaults keep old rows valid, and unknown stays null.
 select * into m from public.member_medicines where id='ce600000-0000-4000-8000-00000000000a';
 if m.class is not null or m.status is not null or m.stop_reason is not null or m.provenance is not null or m.source<>'self-reported' then raise exception 'Old medicine row changed';end if;
 select * into a from public.patient_assessments where user_id='ce600000-0000-4000-8000-000000000001';
 if a.answer_sources<>'{}'::jsonb then raise exception 'Old assessment needs empty sources';end if;
 select * into p from public.member_preferences where user_id='ce600000-0000-4000-8000-000000000002';
 if p.preferred_channel is not null or p.caregiver_contact is not null then raise exception 'Old preferences changed';end if;
 if position('profile' in(select pg_get_constraintdef(oid)from pg_constraint where conrelid='public.zoe_chat_cards'::regclass and conname='zoe_chat_cards_kind_check'))=0 then raise exception 'Profile kind missing';end if;
 -- Grants.
 if has_function_privilege('anon','public.member_medicines_review(jsonb,jsonb)','execute')or has_function_privilege('anon','public.member_profile_card_save(text,jsonb)','execute')
  or has_function_privilege('anon','public.zoe_consent_accept_shown(text,text)','execute')then raise exception 'Anonymous onboarding writes must stay denied';end if;
 if has_function_privilege('authenticated','public.save_patient_assessment_sourced(uuid,bigint,jsonb,boolean,text,jsonb)','execute')then raise exception 'Sourced answers are service role only';end if;
 if has_table_privilege('authenticated','public.member_preferences','update')or has_table_privilege('authenticated','public.member_preferences','insert')then raise exception 'Preferences write only through functions';end if;
 if not(select relrowsecurity from pg_class where oid='public.member_preferences'::regclass)then raise exception 'Preferences RLS missing';end if;
 -- Nothing that feeds Zoe or staff names the caregiver or channel columns.
 if exists(select 1 from pg_proc proc join pg_namespace n on n.oid=proc.pronamespace where n.nspname='public'and proc.prosrc like '%caregiver_contact%'and proc.proname<>'member_profile_card_save')then
  raise exception 'Only the card save may touch the caregiver contact';end if;
 -- An unknown source is refused, and a null clears one.
 begin
  perform public.save_patient_assessment_sourced('ce600000-0000-4000-8000-000000000001',0,'{"q2.a":1}',false,null,'{"q2.a":"made_up"}');
  raise exception 'Unknown source accepted';
 exception when check_violation then null;end;
 if public.save_patient_assessment_sourced('ce600000-0000-4000-8000-000000000001',0,'{"q2.a":1,"q2.b":"UNKNOWN","q2.c":1}',false,null,'{"q2.a":"patient_reported_anamnesis","q2.b":"patient_reported_anamnesis","q2.c":"patient_reported_anamnesis"}')<>1 then raise exception 'Sourced save failed';end if;
 if public.save_patient_assessment_sourced('ce600000-0000-4000-8000-000000000001',1,'{"q2.a":1,"q2.b":"UNKNOWN"}',false,null,'{}')<>2 then raise exception 'Reconcile save failed';end if;
 if public.save_patient_assessment_sourced('ce600000-0000-4000-8000-000000000001',1,'{"q2.a":1}',false,null,'{}')<>-1 then raise exception 'A stale revision must not save';end if;
 if(select answer_sources from public.patient_assessments where user_id='ce600000-0000-4000-8000-000000000001')<>'{"q2.a":"patient_reported_anamnesis","q2.b":"patient_reported_anamnesis"}'::jsonb then raise exception 'A pruned answer kept its source, or a kept one lost it';end if;
 if public.save_patient_assessment_sourced('ce600000-0000-4000-8000-000000000001',2,'{"q2.a":1}',false,null,'{"q2.b":null}')<>3 then raise exception 'Sourced clear failed';end if;
 if(select answer_sources from public.patient_assessments where user_id='ce600000-0000-4000-8000-000000000001')<>'{"q2.a":"patient_reported_anamnesis"}'::jsonb then raise exception 'Sources wrong';end if;
end $$;

select set_config('request.jwt.claims','{"sub":"ce600000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
do $$
declare added uuid:='ce600000-0000-4000-8000-0000000000dd';r jsonb;
begin
 -- A member cannot write directly, or reach another member's row.
 begin insert into public.member_preferences(user_id,caregiver_contact)values('ce600000-0000-4000-8000-000000000002','{}');raise exception 'Direct write allowed';
 exception when insufficient_privilege then null;end;
 if public.member_medicines_review('[{"id":"ce600000-0000-4000-8000-00000000000c","status":"continuous","stopReason":null}]','[]')->>'status'<>'not-found'then raise exception 'Another member''s medicine was reachable';end if;
 if exists(select 1 from public.member_preferences where user_id='ce600000-0000-4000-8000-000000000002')then raise exception 'Another member''s preferences are readable';end if;
 -- A bad reason, and a reason without a stopped course.
 if public.member_medicines_review('[{"id":"ce600000-0000-4000-8000-00000000000a","status":"course_stopped","stopReason":"made_up"}]','[]')->>'status'<>'invalid'then raise exception 'Bad reason accepted';end if;
 if public.member_medicines_review('[{"id":"ce600000-0000-4000-8000-00000000000a","status":"prn","stopReason":"forgot"}]','[]')->>'status'<>'invalid'then raise exception 'Reason without a course accepted';end if;
 -- One failing row writes nothing.
 if public.member_medicines_review('[{"id":"ce600000-0000-4000-8000-00000000000a","status":"prn","stopReason":null},{"id":"ce600000-0000-4000-8000-00000000000c","status":"prn","stopReason":null}]','[]')->>'status'<>'not-found'then raise exception 'Mixed list saved';end if;
 if(public.member_medicine_details_read()->0->>'status')is not null then raise exception 'A refused list wrote a row';end if;
 -- The whole list, and its replay.
 r:=jsonb_build_object('c','[{"id":"ce600000-0000-4000-8000-00000000000a","status":"continuous","stopReason":null},{"id":"ce600000-0000-4000-8000-00000000000b","status":"course_stopped","stopReason":"values_normal"}]'::jsonb,
  'a',jsonb_build_array(jsonb_build_object('requestId',added,'name','Synthetic new','dose',null,'times',jsonb_build_array('10:00'),'status','prn','stopReason',null)));
 for i in 1..2 loop
  if public.member_medicines_review(r->'c',r->'a')->>'status'<>'saved'then raise exception 'List save failed on try %',i;end if;
 end loop;
 if jsonb_array_length(public.member_medicine_details_read())<>3 or(select count(*)from jsonb_array_elements(public.member_medicine_details_read())e where(e.value->>'stopped')::boolean)<>1 then raise exception 'A stopped course is listed once, as stopped, and a replay adds nothing';end if;
 -- Restore: the same row, once, and only the member's own stopped course.
 if public.member_medicine_restore('ce600000-0000-4000-8000-00000000000c')->>'status'<>'not-found'then raise exception 'Another member''s medicine restored';end if;
 if public.member_medicine_restore('ce600000-0000-4000-8000-00000000000a')->>'status'<>'not-found'then raise exception 'An active medicine has nothing to restore';end if;
 for i in 1..2 loop
  if public.member_medicine_restore('ce600000-0000-4000-8000-00000000000b')->>'status'<>'saved'then raise exception 'Restore failed on try %',i;end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(public.member_medicine_details_read())e where(e.value->>'stopped')::boolean)
  or jsonb_array_length(public.member_medicine_details_read())<>3 then raise exception 'Restore left a stopped row or a duplicate';end if;
 -- Profile: both fields, then the refusals.
 perform public.member_profile_card_save('text','{"name":"Synthetic friend","phone":"+37491000000"}');
 begin perform public.member_profile_card_save('text','{"name":"X","phone":"nope"}');raise exception 'Bad phone accepted';exception when check_violation then null;end;
 begin perform public.member_profile_card_save('text','{"name":"X","phone":"+37491000000","extra":"y"}');raise exception 'Extra key accepted';exception when check_violation then null;end;
 begin perform public.member_profile_card_save('fax',null);raise exception 'Bad channel accepted';exception when check_violation then null;end;
 if(select preferred_channel from public.member_preferences)<>'text'then raise exception 'Member cannot read their own row';end if;
end $$;
reset role;

do $$
declare m public.member_medicines;
begin
 select * into m from public.member_medicines where id='ce600000-0000-4000-8000-00000000000b';
 if m.stopped_at is not null or m.status is not null or m.stop_reason is not null or m.provenance<>'patient_text_entry'or m.class is not null or m.effective_at is null then raise exception 'Restore did not bring the row back';end if;
 if(select count(*)from public.member_medicines where name='Synthetic course')<>1 then raise exception 'Restore made a second row';end if;
 if not exists(select 1 from public.member_medicine_status_events where medicine_id=m.id and status='course_stopped'and stop_reason='values_normal')then raise exception 'Restore lost the history';end if;
 if has_table_privilege('authenticated','public.member_medicine_status_events','select')or not(select relrowsecurity from pg_class where oid='public.member_medicine_status_events'::regclass)then raise exception 'Status log must be closed';end if;
 if has_function_privilege('authenticated','public.zoe_chat_card_unclaim(uuid,uuid,text,uuid)','execute')then raise exception 'Unclaim is service role only';end if;
 if(select provenance from public.member_medicines where name='Synthetic new')<>'patient_text_entry'then raise exception 'New row needs its source';end if;
end $$;

-- A schedule change keeps what is known.
select set_config('request.jwt.claims','{"sub":"ce600000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
do $$
begin
 if public.member_medicine_update('ce600000-0000-4000-8000-00000000000a','1 tablet',array['07:00'::time])->>'status'<>'saved'then raise exception 'Schedule change failed';end if;
end $$;
reset role;
do $$
begin
 if not exists(select 1 from public.member_medicines where name='Synthetic daily'and stopped_at is null and status='continuous'and provenance='patient_text_entry')then raise exception 'Schedule change lost the status';end if;
end $$;

-- Consent: the gate is the same, and the row carries the hash; append-only still holds. Zoe off refuses with no row.
insert into public.zoe_settings(singleton)values(true)on conflict do nothing;
update public.zoe_settings set consent_collection_enabled=false where singleton;
select set_config('request.jwt.claims','{"sub":"ce600000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
do $$
begin
 if public.zoe_consent_accept_shown('x','short')->>'code'<>'invalid'then raise exception 'Bad hash accepted';end if;
 if(public.zoe_consent_accept_shown('x',repeat('a',64))->>'ok')::boolean then raise exception 'Consent gate weakened';end if;
end $$;
reset role;
do $$
begin
 if exists(select 1 from public.zoe_consents where member_id='ce600000-0000-4000-8000-000000000001')then raise exception 'A refused consent left a row';end if;
 -- The trigger, on a direct insert as zoe_consent_set makes one.
 perform set_config('noreon.zoe_consent_text_hash',repeat('b',64),true);
 insert into public.zoe_consents(member_id,kind,granted,wording_version,source)values('ce600000-0000-4000-8000-000000000001','zoe_reads_messages',true,'synthetic','zoe_screen');
 perform set_config('noreon.zoe_consent_text_hash','',true);
 insert into public.zoe_consents(member_id,kind,granted,wording_version,source)values('ce600000-0000-4000-8000-000000000002','zoe_reads_messages',true,'synthetic','prompt');
 if(select text_hash from public.zoe_consents where member_id='ce600000-0000-4000-8000-000000000001')<>repeat('b',64)then raise exception 'Hash not stored';end if;
 if(select method from public.zoe_consents where member_id='ce600000-0000-4000-8000-000000000001')<>'tap'then raise exception 'Method default wrong';end if;
 if(select text_hash from public.zoe_consents where member_id='ce600000-0000-4000-8000-000000000002')is not null then raise exception 'A consent without shown text must stay null';end if;
end $$;
rollback;
select 'check-zoe-v3-onboarding.sql: all checks passed';
