-- PR 1 only: no Telegram route. Run as postgres in the isolated SQL-check database.
-- Existing check-nurse-visit-flow.sql, check-patient-care-visits.sql,
-- check-real-coordination-{db,paging-db}.sql and check-nurse-handoffs.sql stay unchanged.
\set ON_ERROR_STOP on
begin;
create function pg_temp.actor_assert(ok boolean,label text)returns void language plpgsql as $$begin
 if ok is distinct from true then raise exception 'TEST %',label;end if;
end$$;
create function pg_temp.actor_login(u uuid,s uuid)returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub',coalesce(u::text,''),true);
 perform set_config('request.jwt.claim.role',case when u is null then 'service_role'else 'authenticated'end,true);
 perform set_config('request.jwt.claims',case when u is null then '{"role":"service_role"}'else
  jsonb_build_object('sub',u,'role','authenticated','session_id',s,'amr',jsonb_build_array(jsonb_build_object('method','password')))::text end,true);
end$$;
create temp table actor_fixture as select gen_random_uuid() nurse,gen_random_uuid() doctor,gen_random_uuid() other,
 gen_random_uuid() member,gen_random_uuid() unassigned,gen_random_uuid() clinic,gen_random_uuid() session,
 gen_random_uuid() binding,gen_random_uuid() web_visit,gen_random_uuid() telegram_visit;
grant select on actor_fixture to authenticated;
insert into auth.users(id,email)select u,u||'@example.invalid'from actor_fixture cross join lateral unnest(array[nurse,doctor,other,member,unassigned])u;
update auth.users u set phone=case when u.id=f.member then '999000771001'else '999000771002'end,phone_confirmed_at=now()
 from actor_fixture f where u.id in(f.member,f.unassigned);
insert into public.workspace_clinics(id,name)select clinic,'Synthetic actor clinic'from actor_fixture;
insert into public.workspace_staff(user_id,role,display_name,clinic_id)
 select nurse,'nurse','Synthetic actor nurse',clinic from actor_fixture union all
 select doctor,'doctor','Synthetic actor doctor',clinic from actor_fixture union all
 select other,'nurse','Synthetic other nurse',clinic from actor_fixture;
insert into auth.sessions(id,user_id,created_at,updated_at)select session,nurse,now(),now()from actor_fixture;
insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id)
 select member,doctor,nurse from actor_fixture union all select unassigned,doctor,other from actor_fixture;
insert into public.telegram_auth_bindings(id,auth_user_id,kind,principal_ref,account_ref,phone,address,generation)
 select binding,nurse,'staff','actor-parity:'||binding,'actor-parity','+999000770001','770001',1 from actor_fixture;
insert into public.patient_test_requests(id,user_id,status,requested_terms,requirements,algorithm_version,context_token,create_payload,current_arrangement)
 select v,member,'confirmed','{}','[{"id":"lipid-panel","title":"Lipid panel","method":"lab"}]','synthetic','synthetic','{}',
 jsonb_build_object('terms',jsonb_build_object('mode','home','startsAt',date_trunc('minute',now()),'endsAt',date_trunc('minute',now())+interval '1 hour','timezone','Asia/Yerevan','location','Synthetic location'))
 from actor_fixture cross join lateral unnest(array[web_visit,telegram_visit])v;
update public.nurse_visit_settings set enabled=true;
delete from public.staff_telegram_policy;

-- Both channels execute the real mark -> step -> complete -> coordination sequence.
-- IDs are retained for exact receipt replay. Web uses the authenticated API; Telegram
-- uses owner-only bodies with a service JWT and no auth.uid() or auth.sessions row.
do $$
#variable_conflict use_variable
declare f record;channel text;src uuid;mark_id uuid;step_id uuid;complete_id uuid;visit_id uuid;open_id uuid;append_id uuid;
 cmd jsonb;r jsonb;again jsonb;task_id uuid;request_id uuid;
begin
 select * into f from actor_fixture;
 foreach channel in array array['web','telegram']loop
  src:=case when channel='web'then f.web_visit else f.telegram_visit end;
  mark_id:=gen_random_uuid();step_id:=gen_random_uuid();complete_id:=gen_random_uuid();visit_id:=gen_random_uuid();open_id:=gen_random_uuid();append_id:=gen_random_uuid();
  if channel='web'then perform pg_temp.actor_login(f.nurse,f.session);
  else delete from auth.sessions where user_id=f.nurse;perform pg_temp.actor_login(null,null);
   perform pg_temp.actor_assert(auth.uid()is null,'Telegram has no web actor');
   perform pg_temp.actor_assert((public._telegram_nurse_authority(f.binding,1)).user_id=f.nurse,'Binding derives the nurse');
  end if;
  if channel='web'then set local role authenticated;r:=public.nurse_visit_list();reset role;
  else r:=public._nurse_visit_list_as(f.nurse,f.binding,1);end if;
  perform pg_temp.actor_assert(r->>'enabled'='true'and exists(select 1 from jsonb_array_elements(r->'visits')v where v->>'id'=src::text),channel||' assigned visit listed');
  cmd:=jsonb_build_object('version','nurse-visit-v1','memberId',f.member,'source','home-request','sourceId',src,'submissionId',mark_id,
   'item','measure:bp','done',true,'note',null,'values',jsonb_build_object('systolic',132,'diastolic',84,'pulse',71));
  if channel='web'then set local role authenticated;r:=public.nurse_visit_mark(cmd);again:=public.nurse_visit_mark(cmd);reset role;
  else r:=public._nurse_visit_mark_as(f.nurse,f.binding,1,cmd);again:=public._nurse_visit_mark_as(f.nurse,f.binding,1,cmd);end if;
  perform pg_temp.actor_assert(r->>'status'='saved'and r->>'replayed'='false'and again=r||'{"replayed":true}'::jsonb,channel||' mark and exact replay');
  perform pg_temp.actor_assert((select count(*)=1 from public.nurse_visit_marks where member_id=f.member and submission_id=mark_id and actor_id=f.nurse),channel||' one nurse mark');
  cmd:=jsonb_build_object('version','nurse-visit-v1','memberId',f.member,'source','home-request','sourceId',src,'submissionId',step_id,'step','started');
  if channel='web'then set local role authenticated;r:=public.nurse_visit_step(cmd);again:=public.nurse_visit_step(cmd);reset role;
  else r:=public._nurse_visit_step_as(f.nurse,f.binding,1,cmd);again:=public._nurse_visit_step_as(f.nurse,f.binding,1,cmd);end if;
  perform pg_temp.actor_assert(r->>'status'='saved'and again=r||'{"replayed":true}'::jsonb,channel||' step and exact replay');
  perform pg_temp.actor_assert((select count(*)=1 from public.nurse_visit_events where submission_id=step_id and actor_id=f.nurse),channel||' one nurse step');
  -- Completion requires a final sample outcome on each channel, independently of BP.
  cmd:=jsonb_build_object('version','nurse-visit-v1','memberId',f.member,'source','home-request','sourceId',src,'submissionId',gen_random_uuid(),
   'item','sample:lipid-panel','done',false,'note','Synthetic sample unavailable','values',null);
  if channel='web'then set local role authenticated;r:=public.nurse_visit_mark(cmd);reset role;
  else r:=public._nurse_visit_mark_as(f.nurse,f.binding,1,cmd);end if;
  perform pg_temp.actor_assert(r->>'status'='saved',channel||' final sample exception');
  cmd:=jsonb_build_object('version','nurse-visit-v1','memberId',f.member,'source','home-request','sourceId',src,'submissionId',complete_id,
   'visitId',visit_id,'openSubmissionId',open_id,'appendSubmissionId',append_id,'reason','Synthetic unfinished items explained');
  if channel='web'then set local role authenticated;r:=public.nurse_visit_complete(cmd);again:=public.nurse_visit_complete(cmd);reset role;
  else r:=public._nurse_visit_complete_as(f.nurse,f.binding,1,cmd);again:=public._nurse_visit_complete_as(f.nurse,f.binding,1,cmd);end if;
  perform pg_temp.actor_assert(r->>'status'='saved'and again=r||'{"replayed":true}'::jsonb,channel||' complete and exact replay');
  perform pg_temp.actor_assert((select count(*)=1 from public.nurse_visit_completions nc where nc.source_id=src and nc.actor_id=f.nurse and nc.result=r and nc.channel=channel and case when channel='web'then nc.session_id=f.session and nc.binding_id is null else nc.session_id is null and nc.binding_id=f.binding and nc.binding_generation=1 end),channel||' one completion receipt');
  perform pg_temp.actor_assert((select status='completed'from public.patient_test_requests where id=src),channel||' home request completed');
  perform pg_temp.actor_assert((select count(*)=4 from public.patient_care_visit_entries x where x.visit_id=visit_id and x.user_id=f.member and x.actor_id=f.nurse),channel||' three BP observations and completion note');
  perform pg_temp.actor_assert((select count(*)=2 and bool_and(cr.actor_id=f.nurse and cr.channel=channel)from public.patient_care_visit_command_receipts cr where cr.user_id=f.member and cr.submission_id in(open_id,append_id)),channel||' open and append receipts');
  if channel='web'then
   perform pg_temp.actor_assert((select bool_and(session_id=f.session and binding_id is null and binding_generation is null)from public.patient_care_visit_command_receipts where user_id=f.member and submission_id in(open_id,append_id)),'Web receipts retain the real session');
   set local role authenticated;r:=public.nurse_visit_detail(f.member,'home-request',src);reset role;
  else
   perform pg_temp.actor_assert((select bool_and(session_id is null and binding_id=f.binding and binding_generation=1)from public.patient_care_visit_command_receipts where user_id=f.member and submission_id in(open_id,append_id)),'Telegram receipts have binding provenance without a fictional session');
   r:=public._nurse_visit_detail_as(f.nurse,f.binding,1,f.member,'home-request',src);
  end if;
  perform pg_temp.actor_assert(r->>'enabled'='true',channel||' detail remains readable');
  perform pg_temp.actor_assert(exists(select 1 from public.access_audit a where a.actor_id=f.nurse and a.actor_role='nurse'and a.member_id=f.member and a.object_id=src::text
   and a.channel=channel and case when channel='web'then a.session_id=f.session::text and a.binding_id is null else a.session_id is null and a.binding_id=f.binding and a.binding_generation=1 end),channel||' nurse read audit');
  task_id:=gen_random_uuid();request_id:=gen_random_uuid();
  insert into public.patient_coordination_tasks(id,patient_case_id,kind,title,instructions,creator_id,owner_id)
   values(task_id,f.member,'contact-followup','Synthetic task','Synthetic instructions',f.doctor,f.doctor);
  if channel='web'then set local role authenticated;
   r:=public.patient_coordination_command(f.member,task_id,1,request_id,'complete','{"note":"Synthetic completion"}');
   again:=public.patient_coordination_command(f.member,task_id,1,request_id,'complete','{"note":"Synthetic completion"}');reset role;
  else
   r:=public._patient_coordination_command_as(f.nurse,f.binding,1,f.member,task_id,1,request_id,'complete','{"note":"Synthetic completion"}');
   again:=public._patient_coordination_command_as(f.nurse,f.binding,1,f.member,task_id,1,request_id,'complete','{"note":"Synthetic completion"}');
  end if;
  perform pg_temp.actor_assert(r=jsonb_build_object('id',task_id,'revision',2,'status','completed')and again=r,channel||' coordination result and replay');
  perform pg_temp.actor_assert((select count(*)=1 from public.patient_coordination_events e where e.task_id=task_id and e.request_id=request_id and e.actor_id=f.nurse and e.actor_role='nurse'),channel||' one coordination event');
  perform pg_temp.actor_assert(exists(select 1 from public.patient_coordination_receipts cr where cr.request_id=request_id and cr.actor_id=f.nurse and cr.result=r
   and cr.channel=channel and case when channel='web'then cr.session_id=f.session and cr.binding_id is null else cr.session_id is null and cr.binding_id=f.binding and cr.binding_generation=1 end),channel||' coordination receipt provenance');
  if channel='web'then set local role authenticated;
   r:=public.patient_coordination_queue(f.member,'all');again:=public.patient_coordination_snapshot(task_id);reset role;
  else
   r:=public._patient_coordination_queue_as(f.nurse,f.binding,1,f.member,'all');
   again:=public._patient_coordination_snapshot_as(f.nurse,f.binding,1,task_id);
  end if;
  perform pg_temp.actor_assert(exists(select 1 from jsonb_array_elements(r->'tasks')t where t->>'id'=task_id::text)and again->>'id'=task_id::text,channel||' authorized queue and snapshot');
  perform pg_temp.actor_assert(exists(select 1 from public.access_audit a where a.object_id=task_id::text and a.surface='member_coordination'and a.actor_id=f.nurse and a.actor_role='nurse'and a.channel=channel
   and case when channel='web'then a.session_id=f.session::text and a.binding_id is null else a.session_id is null and a.binding_id=f.binding and a.binding_generation=1 end),channel||' coordination read audit');
 end loop;
end$$;

-- The nested lab handover must also work with no web actor or session.
do $$declare f record;v_program uuid:=gen_random_uuid();v_offer uuid:=gen_random_uuid();v_appointment uuid:=gen_random_uuid();
 v_reservation uuid:=gen_random_uuid();v_notice uuid:=gen_random_uuid();v_visit uuid:=gen_random_uuid();v_key text:=gen_random_uuid()::text;
 v_arr jsonb;v_result jsonb;v_command jsonb;
begin
 select * into f from actor_fixture;perform pg_temp.actor_login(null,null);
 insert into public.booking_program_seals(id,member_id,actor_id,source_token,requirements_token,engine_version,program)
  values(v_program,f.member,f.nurse,'synthetic',public.patient_test_context(f.member)->>'requirementsToken','synthetic-only',
   '{"items":[{"id":"hba1c","title":"HbA1c","method":"lab"}]}');
 insert into public.booking_manual_capacity(key,source,reference,clinic_id,starts_at,ends_at,capacity,valid_until,created_by)
  values(v_key,'synthetic',v_key,f.clinic,now()-interval '1 hour',now(),2,now()+interval '3 days',f.nurse);
 insert into public.booking_offer_snapshots(id,version,capacity_key,offer,created_by)values(v_offer,'synthetic',v_key,'{}',f.nurse);
 v_arr:=jsonb_build_object('coveredTestIds',jsonb_build_array('hba1c'),'mode','clinic','startsAt',now()-interval '1 hour','endsAt',now(),'location','Synthetic clinic','clinicId',f.clinic);
 insert into public.booking_appointments(id,member_id,program_id,requirements_token,revision,status,current_arrangement,proposed_arrangement,current_reservation_id,proposed_reservation_id,notice_id)
  values(v_appointment,f.member,v_program,public.patient_test_context(f.member)->>'requirementsToken',1,'confirmed',v_arr,v_arr,v_reservation,v_reservation,v_notice);
 insert into public.booking_manual_reservations(id,appointment_id,capacity_key,offer_id,offer_version,member_id,valid_until)
  values(v_reservation,v_appointment,v_key,v_offer,'synthetic',f.member,now()+interval '3 days');
 insert into public.booking_scheduling_notices(id,appointment_id,appointment_revision,program_id,reservation_id,clinic_id,clinic_revision,copy_revision,sender_email,clinic_email,copy_email,template_version,subject,text_content,envelope_hash,state)
  values(v_notice,v_appointment,1,v_program,v_reservation,f.clinic,0,0,'synthetic@example.invalid','synthetic@example.invalid','synthetic@example.invalid','synthetic','Synthetic','Never sent',repeat('a',64),'accepted');
 insert into public.booking_appointment_versions(appointment_id,revision,program_id,proposed_arrangement,notice_id,actor_id)
  values(v_appointment,1,v_program,v_arr,v_notice,f.nurse);
 v_result:=public._nurse_visit_mark_as(f.nurse,f.binding,1,jsonb_build_object('version','nurse-visit-v1','memberId',f.member,'source','appointment','sourceId',v_appointment,
  'submissionId',gen_random_uuid(),'item','sample:hba1c','done',true,'note',null,'values',null));
 perform pg_temp.actor_assert(v_result->>'status'='saved','Telegram sample mark saved');
 v_command:=jsonb_build_object('version','nurse-visit-v1','memberId',f.member,'source','appointment','sourceId',v_appointment,'submissionId',gen_random_uuid(),
  'visitId',v_visit,'openSubmissionId',gen_random_uuid(),'appendSubmissionId',gen_random_uuid(),'reason','Synthetic unfinished items explained');
 v_result:=public._nurse_visit_complete_as(f.nurse,f.binding,1,v_command);
 perform pg_temp.actor_assert(v_result->>'status'='saved','Telegram booked visit completed');
 perform pg_temp.actor_assert(exists(select 1 from public.patient_care_visit_entries e where e.visit_id=v_visit and e.actor_id=f.nurse and e.payload->>'kind'='collection'and e.payload->>'outcome'='collected'),'Telegram collection evidence saved');
 v_command:=jsonb_build_object('version','nurse-visit-v1','memberId',f.member,'source','appointment','sourceId',v_appointment,'submissionId',gen_random_uuid(),'step','samples-at-lab');
 v_result:=public._nurse_visit_step_as(f.nurse,f.binding,1,v_command);
 perform pg_temp.actor_assert(v_result->>'status'='saved','Telegram post-completion lab handover saved');
 perform pg_temp.actor_assert((select count(*)=1 from public.patient_care_lab_stages s join public.patient_care_visit_entries e on e.id=s.collection_entry_id
  where e.visit_id=v_visit and s.stage='at-lab'and s.actor_id=f.nurse and s.actor_role='nurse'),'Nested lab command retains nurse attribution');
 perform pg_temp.actor_assert(public._nurse_visit_step_as(f.nurse,f.binding,1,v_command)=v_result||'{"replayed":true}'::jsonb,'Lab handover replays without a duplicate stage');
 perform pg_temp.actor_assert(not exists(select 1 from auth.sessions where user_id=f.nurse),'Telegram handover created no session');
end$$;

-- Old audit rows could omit session_id. New Telegram rows must never carry one.
do $$declare f record;begin
 select * into f from actor_fixture;
 insert into public.access_audit(actor_id,actor_role,member_id,surface)values(f.nurse,'nurse',f.member,'member_nurse_visit');
 begin
  insert into public.access_audit(actor_id,actor_role,member_id,surface,channel,session_id,binding_id,binding_generation)
   values(f.nurse,'nurse',f.member,'member_nurse_visit','telegram',f.session::text,f.binding,1);
  raise exception 'TEST Telegram audit accepted web session';
 exception when check_violation then null;end;
 begin
  insert into public.access_audit(actor_id,actor_role,member_id,surface,channel,binding_id)
   values(f.nurse,'nurse',f.member,'member_nurse_visit','telegram',f.binding);
  raise exception 'TEST Telegram audit accepted missing generation';
 exception when check_violation then null;end;
 begin
  insert into public.patient_care_visit_command_receipts(user_id,submission_id,actor_id,command,state)
   values(f.member,gen_random_uuid(),f.nurse,'{}','retired');
  raise exception 'TEST web visit receipt accepted missing session';
 exception when check_violation then null;end;
 begin
  insert into public.patient_coordination_receipts(request_id,actor_id,patient_case_id,input,result,channel,session_id,binding_id,binding_generation)
   values(gen_random_uuid(),f.nurse,f.member,'{}','{}','telegram',f.session,f.binding,1);
  raise exception 'TEST coordination Telegram receipt accepted web session';
 exception when check_violation then null;end;
end$$;

-- Authority refuses every stale/removed identity, independently of a JWT's actor.
create function pg_temp.authority_refused(b uuid,g bigint)returns boolean language plpgsql as $$begin
 perform public._telegram_nurse_authority(b,g);return false;
exception when insufficient_privilege then return true;end$$;
do $$declare f record;replacement uuid:=gen_random_uuid();begin
 select * into f from actor_fixture;perform pg_temp.actor_login(null,null);
 perform pg_temp.actor_assert(pg_temp.authority_refused(f.binding,0),'Old generation refused');
 update public.telegram_auth_bindings set kind='member'where id=f.binding;
 perform pg_temp.actor_assert(pg_temp.authority_refused(f.binding,1),'Member binding cannot authorize staff');
 update public.telegram_auth_bindings set kind='staff'where id=f.binding;
 perform pg_temp.actor_assert(public._nurse_visit_detail_as(f.other,f.binding,1,f.member,'home-request',f.telegram_visit)->>'status'='access','Explicit actor cannot impersonate the bound nurse');
 perform pg_temp.actor_assert(pg_temp.authority_refused(gen_random_uuid(),1),'Unknown binding refused');
 update auth.users set banned_until=clock_timestamp()+interval '1 hour'where id=f.nurse;
 perform pg_temp.actor_assert(pg_temp.authority_refused(f.binding,1),'Banned account refused');
 update auth.users set banned_until=null where id=f.nurse;
 insert into public.real_staff_invitations(email,display_name,clinic_id,issuer_id,auth_user_id,expected_auth_user_id,role)
  values('actor-parity@example.invalid','Synthetic pending nurse',f.clinic,f.doctor,f.nurse,f.nurse,'nurse');
 perform pg_temp.actor_assert(pg_temp.authority_refused(f.binding,1),'Pending staff admission refused');
 update public.real_staff_invitations set status='accepted',accepted_at=now(),verified_at=now()where auth_user_id=f.nurse;
 perform pg_temp.actor_assert((public._telegram_nurse_authority(f.binding,1)).user_id=f.nurse,'Accepted staff admission works without a session');
 update public.workspace_staff set active=false where user_id=f.nurse;
 perform pg_temp.actor_assert(pg_temp.authority_refused(f.binding,1),'Inactive nurse refused');
 update public.workspace_staff set active=false,removed_at=now()where user_id=f.nurse;
 perform pg_temp.actor_assert(pg_temp.authority_refused(f.binding,1),'Removed staff refused');
 update public.workspace_staff set active=true,removed_at=null,role='doctor'where user_id=f.nurse;
 perform pg_temp.actor_assert(pg_temp.authority_refused(f.binding,1),'Non-nurse refused');
 update public.workspace_staff set role='nurse'where user_id=f.nurse;
 update public.workspace_clinics set active=false where id=f.clinic;
 perform pg_temp.actor_assert(pg_temp.authority_refused(f.binding,1),'Inactive clinic refused');
 update public.workspace_clinics set active=true where id=f.clinic;
 update public.telegram_auth_bindings set active=false,revoked_at=now(),revoked_reason='replaced'where id=f.binding;
 insert into public.telegram_auth_bindings(id,auth_user_id,kind,principal_ref,account_ref,phone,address,generation)
  values(replacement,f.nurse,'staff','actor-parity:replacement','actor-parity','+999000770001','770002',2);
 perform pg_temp.actor_assert(pg_temp.authority_refused(f.binding,1),'Replaced binding refused');
 perform pg_temp.actor_assert(pg_temp.authority_refused(replacement,1),'Replacement with old generation refused');
 perform pg_temp.actor_assert((public._telegram_nurse_authority(replacement,2)).user_id=f.nurse,'Only current generation accepted');
 perform public._telegram_revoke_binding(replacement,'synthetic-test');
 perform pg_temp.actor_assert(pg_temp.authority_refused(replacement,2),'Revoked binding refused');
 perform pg_temp.actor_assert(public._nurse_visit_complete_as(f.nurse,replacement,2,(select command from public.nurse_visit_completions where source_id=f.telegram_visit))->>'status'='access','Revoked binding cannot replay a completion');
 -- Restore the fixture solely to exercise member assignment and replay after reassignment.
 update public.telegram_auth_bindings set active=true,revoked_at=null,revoked_reason=null where id=f.binding;
 -- A later, revoked generation must not resurrect an older binding.
 perform pg_temp.actor_assert(pg_temp.authority_refused(f.binding,1),'Old binding cannot be reactivated after replacement');
 update public.telegram_auth_bindings set generation=3 where id=f.binding;
 perform pg_temp.actor_assert(public._nurse_visit_detail_as(f.nurse,f.binding,3,f.unassigned,'home-request',f.telegram_visit)->>'status'='access','Unassigned detail refused');
 perform pg_temp.actor_assert(not public._patient_coordination_access_as(f.nurse,f.binding,3,f.unassigned),'Unassigned coordination access refused');
 begin perform public._patient_coordination_queue_as(f.nurse,f.binding,3,f.unassigned);raise exception 'TEST unassigned queue allowed';exception when insufficient_privilege then null;end;
 begin perform public._patient_coordination_command_as(f.nurse,f.binding,3,f.unassigned,gen_random_uuid(),1,gen_random_uuid(),'complete','{"note":"Synthetic"}');raise exception 'TEST unassigned command allowed';exception when insufficient_privilege then null;end;
 update public.patient_clinical_cases set assigned_nurse_id=f.other where user_id=f.member;
 perform pg_temp.actor_assert(public._patient_staff_visit_command_as(f.nurse,f.binding,3,(select command from public.patient_care_visit_command_receipts where actor_id=f.nurse and channel='telegram'limit 1))->>'status'='access','Visit evidence replay rechecks assignment');
 begin perform public._patient_visit_authorize_as(f.nurse,f.binding,3,f.member,true,false);raise exception 'TEST unassigned visit authorization allowed';exception when insufficient_privilege then null;end;
 begin perform public._patient_coordination_snapshot_as(f.nurse,f.binding,3,(select(input->>'taskId')::uuid from public.patient_coordination_receipts where actor_id=f.nurse and channel='telegram'limit 1));raise exception 'TEST reassigned snapshot allowed';exception when insufficient_privilege then null;end;
 perform pg_temp.actor_assert(public._nurse_visit_complete_as(f.nurse,f.binding,3,(select command from public.nurse_visit_completions where source_id=f.telegram_visit))->>'status'='access','Completion replay rechecks assignment');
 perform pg_temp.actor_assert(public._nurse_visit_mark_as(f.nurse,f.binding,3,(select jsonb_build_object('version','nurse-visit-v1','memberId',member_id,'source',source,'sourceId',source_id,'submissionId',submission_id,'item',item,'done',done,'note',note,'values',vals)from public.nurse_visit_marks where source_id=f.telegram_visit limit 1))->>'status'='access','Mark replay rechecks assignment');
 perform pg_temp.actor_assert(public._nurse_visit_step_as(f.nurse,f.binding,3,(select jsonb_build_object('version','nurse-visit-v1','memberId',member_id,'source',source,'sourceId',source_id,'submissionId',submission_id,'step',step)from public.nurse_visit_events where source_id=f.telegram_visit and step='started'))->>'status'='access','Step replay rechecks assignment');
 begin
  perform public._patient_coordination_command_as(f.nurse,f.binding,3,r.patient_case_id,(r.input->>'taskId')::uuid,(r.input->>'revision')::bigint,r.request_id,'complete',r.input->'input')
   from public.patient_coordination_receipts r where r.actor_id=f.nurse and r.channel='telegram';
  raise exception 'TEST reassigned coordination replay allowed';
 exception when insufficient_privilege then null;end;
end$$;

-- Private bodies must be unavailable through every API role (including service_role).
do $$declare p record;r text;begin
 for p in select oid,proname from pg_proc where pronamespace='public'::regnamespace
  and(proname in('_telegram_nurse_authority','_telegram_nurse_case_access','_nurse_visit_nurse_as','_patient_staff_lab_stage_command_as','_nurse_visit_sync_lab_as','_patient_visit_authorize_as','_patient_coordination_access_as','_access_audit_record_as',
   '_patient_staff_visit_command_as','_patient_coordination_queue_as','_patient_coordination_snapshot_as','_patient_coordination_snapshot_unlogged_as',
   '_patient_coordination_command_as','_patient_coordination_command_before_nurse_handoffs_as')or proname in('_nurse_visit_list_as','_nurse_visit_detail_as','_nurse_visit_mark_as','_nurse_visit_step_as','_nurse_visit_complete_as'))loop
  foreach r in array array['anon','authenticated','service_role']loop
   perform pg_temp.actor_assert(not has_function_privilege(r,p.oid,'execute'),p.proname||' is private from '||r);
  end loop;
 end loop;
 for p in select oid,proname from pg_proc where pronamespace='public'::regnamespace and proname in('nurse_visit_list','nurse_visit_detail','nurse_visit_mark','nurse_visit_step','nurse_visit_complete','patient_staff_visit_command','patient_staff_lab_stage_command','patient_coordination_queue','patient_coordination_snapshot','patient_coordination_command')loop
  perform pg_temp.actor_assert(has_function_privilege('authenticated',p.oid,'execute')and not has_function_privilege('anon',p.oid,'execute')and not has_function_privilege('service_role',p.oid,'execute'),p.proname||' retains web-only grants');
 end loop;
end$$;
rollback;
