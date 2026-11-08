-- A typed very high reading is saved at once as member-reported (Gohar's QA 267, 4 Nov): the existing save trigger then leaves the
-- quiet note for a first reading and raises the alert for a repeat; the answer says whether that note or alert row exists.
-- One row per member message and reading, whatever run or replay reaches it. Synthetic fixtures, rolled back.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.as_service()returns void language plpgsql as $$begin perform set_config('request.jwt.claims','{"role":"service_role"}',true);end$$;
create function pg_temp.as_user(m uuid)returns void language plpgsql as $$begin perform set_config('request.jwt.claims',jsonb_build_object('sub',m,'role','authenticated')::text,true);end$$;
-- The member's message, typed some minutes ago (seq in its conversation).
create function pg_temp.msg(m uuid,seq bigint,mins integer,who uuid default null)returns void language plpgsql as $$declare c uuid;begin
 select id into c from public.conversations where member_id=m;
 if c is null then insert into public.conversations(member_id)values(m)returning id into c;end if;
 insert into public.conversation_messages(conversation_id,seq,author_id,body,source,request_id,created_at)
 values(c,seq,coalesce(who,m),'synthetic message '||seq,'authenticated_member',gen_random_uuid(),clock_timestamp()-make_interval(mins=>mins));end$$;
-- Zoe's run on the newest message.
create function pg_temp.run(m uuid,seq bigint,state text default 'started')returns uuid language plpgsql as $$declare c uuid;r uuid;begin
 select id into c from public.conversations where member_id=m;
 insert into public.zoe_runs(conversation_id,member_id,message_seq,context_version,draft_epoch,state,outcome,spend_day,finished_at)
 values(c,m,seq,0,0,state,case when state='finished'then 'chatted'end,current_date,case when state='finished'then clock_timestamp()end)returning id into r;
 return r;end$$;
create function pg_temp.save(run uuid,seq bigint,idx integer,s integer,d integer)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_service();set local role service_role;j:=public.zoe_run_bp_typed_save(run,seq,idx,s,d);reset role;return j;end$$;

insert into auth.users(id,phone,phone_confirmed_at)values
 ('b1000000-0000-4000-8000-000000000001','37499090001',now()),('b1000000-0000-4000-8000-000000000002','37499090002',now()),
 ('b1000000-0000-4000-8000-000000000003','37499090003',now()),('b1000000-0000-4000-8000-000000000004','37499090004',now()),('b1000000-0000-4000-8000-000000000005','37499090005',now());
insert into public.workspace_clinics(id,name)values('b1000000-0000-4000-8000-000000000020','Synthetic typed-BP clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values('b1000000-0000-4000-8000-000000000003','doctor','Synthetic Doctor','b1000000-0000-4000-8000-000000000020');
insert into public.patient_clinical_cases(user_id)values('b1000000-0000-4000-8000-000000000001'),('b1000000-0000-4000-8000-000000000002'),('b1000000-0000-4000-8000-000000000003'),('b1000000-0000-4000-8000-000000000004'),('b1000000-0000-4000-8000-000000000005');
insert into public.care_alert_settings(enabled,telegram_delivery,sandbox_test_accounts)values(true,false,true)
 on conflict(singleton)do update set enabled=true,telegram_delivery=false,sandbox_test_accounts=true;

-- 1. A first typed 185/115: saved as the member's own, at the time they wrote it; a quiet note for the doctor; no alert yet.
do $$declare m uuid:='b1000000-0000-4000-8000-000000000001';j jsonb;r uuid;r2 uuid;begin
 perform pg_temp.msg(m,1,3);r:=pg_temp.run(m,1);
 j:=pg_temp.save(r,1,0,185,115);
 perform pg_temp.ok((j->>'ok')::boolean and (j->>'notified')::boolean,'a typed very high reading is saved, and its note exists');
 perform pg_temp.ok((select count(*)=1 and bool_and(systolic=185 and diastolic=115 and entry_source='patient_text_entry'and source='manual'
  and measured_at<now()-interval '2 minutes'and measured_at>now()-interval '4 minutes')from public.patient_measurements where user_id=m),'saved as the member''s own text entry, at the time they wrote it');
 perform pg_temp.ok((select count(*)=1 from public.bp_repeat_notes where member_id=m and closed_at is null and systolic=185),'a first reading leaves the quiet note for the doctor');
 perform pg_temp.ok(not exists(select 1 from public.care_alerts where member_id=m),'a first reading raises no alert');
 -- The same run again, and a later run over the same unanswered message: still one row.
 perform pg_temp.ok((pg_temp.save(r,1,0,185,115)->>'ok')::boolean,'a replay is accepted');
 perform pg_temp.msg(m,2,0);r2:=pg_temp.run(m,2);
 perform pg_temp.ok((pg_temp.save(r2,1,0,185,115)->>'ok')::boolean,'a later run over the same message is accepted');
 perform pg_temp.ok((select count(*)=1 from public.patient_measurements where user_id=m),'a replay or a second run saves no second row');
 -- Another reading in the same message is its own row.
 perform pg_temp.ok((pg_temp.save(r2,1,1,190,118)->>'ok')::boolean,'a second reading in one message');
 perform pg_temp.ok((select count(*)=2 from public.patient_measurements where user_id=m),'two readings in a message are two rows');
end$$;

-- 2. A batch: the first reading and its repeat arrive together. Both are saved in order, and the repeat raises the alert.
do $$declare m uuid:='b1000000-0000-4000-8000-000000000002';j jsonb;r uuid;begin
 perform pg_temp.msg(m,1,10);perform pg_temp.msg(m,2,0);r:=pg_temp.run(m,2);
 j:=pg_temp.save(r,1,0,185,115);
 perform pg_temp.ok((j->>'ok')::boolean,'the first reading of a batch is saved');
 j:=pg_temp.save(r,2,0,184,116);
 perform pg_temp.ok((j->>'ok')::boolean and (j->>'notified')::boolean,'the repeat is saved and its alert exists');
 perform pg_temp.ok((select count(*)=2 from public.patient_measurements where user_id=m),'both readings are on the record');
 perform pg_temp.ok((select count(*)=1 and bool_and(source='reading'and state='open'and priority='urgent')from public.care_alerts where member_id=m),'a typed repeat raises the alert');
end$$;

-- 3. Saved but not notified: with care alerts off a repeat is on the record and its alert does not exist, so no claim may be made,
-- even when an older open alert of the member's is still there.
do $$declare m uuid:='b1000000-0000-4000-8000-000000000004';j jsonb;r uuid;begin
 insert into public.care_alerts(member_id,source,reason_code,rule_id,rule_version,source_ref)values(m,'reading','bp_doctor_today','clinical.bp_one_rule','bp-one-rule-1','older-reading');
 update public.care_alert_settings set enabled=false where singleton;
 perform pg_temp.msg(m,1,10);perform pg_temp.msg(m,2,0);r:=pg_temp.run(m,2);
 perform pg_temp.save(r,1,0,185,115);
 j:=pg_temp.save(r,2,0,184,116);
 perform pg_temp.ok((j->>'ok')::boolean and not (j->>'notified')::boolean,'a repeat saved with alerts off is not notified');
 perform pg_temp.ok((select count(*)=2 from public.patient_measurements where user_id=m)and(select count(*)=1 from public.care_alerts where member_id=m),'the readings stay, and only the older alert exists');
 update public.care_alert_settings set enabled=true where singleton;
end$$;

-- 4. Refusals: bad numbers, a message that is not the member's own or is newer than the run, a run that is not open, a staff
-- account, any other caller.
do $$declare m uuid:='b1000000-0000-4000-8000-000000000005';s uuid:='b1000000-0000-4000-8000-000000000003';open uuid;begin
 perform pg_temp.msg(m,1,2);open:=pg_temp.run(m,1);
 perform pg_temp.ok(pg_temp.save(open,1,0,120,130)->>'code'='invalid','diastolic above systolic is refused');
 perform pg_temp.ok(pg_temp.save(open,1,0,320,100)->>'code'='invalid','an impossible value is refused');
 perform pg_temp.ok(pg_temp.save(open,1,20,185,115)->>'code'='invalid','a reading index beyond a message is refused');
 perform pg_temp.ok(pg_temp.save(open,9,0,185,115)->>'code'='invalid','a message that does not exist is refused');
 perform pg_temp.ok(pg_temp.save(gen_random_uuid(),1,0,185,115)->>'code'='invalid','an unknown run is refused');
 perform pg_temp.ok(pg_temp.save(pg_temp.run(m,3,'finished'),1,0,185,115)->>'code'='invalid','a finished run is refused');
 -- A message newer than the run.
 insert into public.conversation_messages(conversation_id,seq,author_id,body,source,request_id)
  select c.id,2,m,'synthetic newer message','authenticated_member',gen_random_uuid()from public.conversations c where c.member_id=m;
 perform pg_temp.ok(pg_temp.save(open,2,0,185,115)->>'code'='invalid','a message newer than the run is refused');
 perform pg_temp.msg(s,1,1);
 perform pg_temp.ok(pg_temp.save(pg_temp.run(s,1),1,0,185,115)->>'code'='invalid','a staff account is refused');
 perform pg_temp.ok(not exists(select 1 from public.patient_measurements where user_id in(m,s)),'refusals saved nothing');
 begin perform pg_temp.as_user(m);set local role authenticated;perform public.zoe_run_bp_typed_save(open,1,0,185,115);reset role;raise exception 'FAIL: a member called it';
 exception when insufficient_privilege then reset role;end;
 begin set local role anon;perform public.zoe_run_bp_typed_save(open,1,0,185,115);reset role;raise exception 'FAIL: anon called it';
 exception when insufficient_privilege then reset role;end;
end$$;
rollback;
\echo 'PASS typed BP save'
