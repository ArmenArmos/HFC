-- A plan version with several medicines (20261030210000): by role, stale approval, immutability, rollback and Zoe's view.
-- Rolled back. Fictional fixtures only. Run: psql -v ON_ERROR_STOP=1 -f scripts/check-multi-medicine.sql
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.id(s text)returns uuid language sql as $$select ('72000000-0000-4000-8000-0000000000'||s)::uuid$$;
create function pg_temp.must_fail(command text,expected text)returns void language plpgsql as $$begin
 begin execute command;exception when others then if sqlerrm like '%'||expected||'%' then return;end if;raise;end;
 raise exception 'FAIL: command unexpectedly passed: %',command;end$$;
create function pg_temp.actor(p uuid,r text default 'authenticated')returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub',p::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',p,'role',r,'session_id',p,'amr',jsonb_build_array(jsonb_build_object('method','password')))::text,true);end$$;

-- 01 member, 02 other member, 03 member without a confirmed phone, 04 assigned doctor, 05 other doctor, 06 nurse, 07 admin
insert into auth.users(id,phone,phone_confirmed_at)values
 (pg_temp.id('01'),'37499081001',now()),(pg_temp.id('02'),'37499081002',now()),(pg_temp.id('03'),'37499081003',null),
 (pg_temp.id('04'),null,null),(pg_temp.id('05'),null,null),(pg_temp.id('06'),null,null),(pg_temp.id('07'),null,null);
update public.profiles set display_name='Fictional fixture',birth_date='1980-01-01',biological_sex='female' where id::text like '72000000%';
insert into public.patient_consents(user_id,version) select id,'patient-pilot-v1' from auth.users where id::text like '72000000%';
insert into public.patient_assessments(user_id,revision,completed_at) select id,2,now() from auth.users where id::text like '72000000%';
insert into public.workspace_clinics(id,name)values(pg_temp.id('10'),'Fictional clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values
 (pg_temp.id('04'),'doctor','Fictional doctor',pg_temp.id('10')),(pg_temp.id('05'),'doctor','Other fictional doctor',pg_temp.id('10')),
 (pg_temp.id('06'),'nurse','Fictional nurse',pg_temp.id('10')),(pg_temp.id('07'),'admin','Fictional admin',null);
insert into auth.sessions(id,user_id,created_at,updated_at) select user_id,user_id,clock_timestamp(),clock_timestamp() from public.workspace_staff where user_id::text like '72000000%';
insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id)values(pg_temp.id('01'),pg_temp.id('04'),pg_temp.id('06')),(pg_temp.id('02'),pg_temp.id('05'),null);

create temp table ctx as select pg_temp.id('01') uid,pg_temp.id('04') actor,public.patient_clinical_evidence(pg_temp.id('01'))->>'token' token,
 '{"version":"test-engine","urgency":"green","tests":[]}'::jsonb engine,
 '{"explanation":"Fictional review","instructions":"Fictional instructions","followUp":"","medicationName":"","medicationDose":"","medicationInstructions":"","medicationTimes":[]}'::jsonb base;
create temp table kv(k text primary key,v text);
grant select on ctx to authenticated,service_role;grant all on kv to authenticated,service_role;
create function pg_temp.rev()returns bigint language sql security definer as $$select revision from public.patient_clinical_cases where user_id=pg_temp.id('01')$$;
create function pg_temp.reg(j text)returns jsonb language sql as $$select (select base from ctx)||jsonb_build_object('medicines',j::jsonb)$$;
create function pg_temp.save(d jsonb)returns void language plpgsql as $$begin
 perform pg_temp.actor(pg_temp.id('04'));set local role authenticated;
 perform public.save_patient_clinical_draft((select uid from ctx),pg_temp.rev(),(select token from ctx),d);reset role;end$$;
create function pg_temp.review()returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.actor(pg_temp.id('04'));set local role authenticated;j:=public.doctor_regimen_review((select uid from ctx));reset role;return j;end$$;
create function pg_temp.pub(hash text,req uuid default gen_random_uuid(),note text default '')returns uuid language plpgsql as $$declare p uuid;begin
 perform pg_temp.actor(pg_temp.id('04'),'service_role');set local role service_role;
 p:=public.publish_patient_clinical_regimen((select uid from ctx),(select actor from ctx),pg_temp.rev(),(select token from ctx),(select engine from ctx),req,note,hash);reset role;return p;end$$;

select pg_temp.actor(pg_temp.id('04'),'service_role');
set local role service_role;
select public.prepare_patient_clinical_review(uid,actor,0,token,engine) from ctx;
reset role;
select pg_temp.actor(pg_temp.id('04'));
set local role authenticated;
select public.command_patient_clinical_review(uid,1,token,'consultation-decision','{"decision":"not-required","note":"Fictional decision"}') from ctx;
reset role;

-- 1. Dark: a regimen cannot be saved, the one-medicine path is untouched and gets a regimen row of its own.
select pg_temp.ok(not public._multi_medicine_enabled(),'switch is off by default');
select pg_temp.must_fail($q$select pg_temp.save(pg_temp.reg('[{"name":"Fictional statin","dose":"20 mg","instructions":"","times":["21:00"]}]'))$q$,'switched off');
select pg_temp.save((select base from ctx)||'{"medicationName":"Fictional statin","medicationDose":"20 mg","medicationInstructions":"Evening","medicationTimes":["21:00"]}');
do $$declare p uuid;begin
 perform pg_temp.actor(pg_temp.id('04'),'service_role');set local role service_role;
 p:=public.publish_patient_clinical_plan((select uid from ctx),(select actor from ctx),pg_temp.rev(),(select token from ctx),(select engine from ctx),gen_random_uuid());reset role;
 insert into kv values('v1',p::text);
 perform pg_temp.ok((select jsonb_array_length(medicines)=1 and medicines#>>'{0,name}'='Fictional statin' and changes='[]'::jsonb and previous_plan_id is null from public.patient_care_plan_regimens where plan_id=p),'first version has a regimen row and no changes');
end$$;
select pg_temp.ok((select (r->>'enabled')='false' and r->'draft'='null'::jsonb from pg_temp.review() r),'doctor read is empty while off');

-- 2. Validity: same rules as the form, and a regimen holds its medicines in one place only.
update public.multi_medicine_capabilities set enabled=true;
select pg_temp.ok(public.workspace_valid_review_draft(pg_temp.reg('[]')),'empty regimen is a valid plan without medicines');
select pg_temp.ok(not public.workspace_valid_review_draft(pg_temp.reg(j)),'refused: '||j) from unnest(array[
 '[{"name":"A","dose":"1 mg","instructions":"","times":["09:00"]},{"name":" a ","dose":"2 mg","instructions":"","times":["21:00"]}]',
 '[{"name":"","dose":"1 mg","instructions":"","times":["09:00"]}]','[{"name":"A","dose":" ","instructions":"","times":["09:00"]}]',
 '[{"name":"A","dose":"1 mg","instructions":"","times":[]}]','[{"name":"A","dose":"1 mg","instructions":"","times":["25:00"]}]',
 '[{"name":"A","dose":"1 mg","instructions":"","times":["01:00","02:00","03:00","04:00","05:00"]}]',
 '[{"name":"A","dose":"1 mg","instructions":"","times":["09:00"],"extra":"x"}]','{"name":"A"}']) j;
select pg_temp.ok(not public.workspace_valid_review_draft(pg_temp.reg((select jsonb_agg(jsonb_build_object('name','M'||g,'dose','1 mg','instructions','','times','["09:00"]'::jsonb))::text from generate_series(1,9)g))),'nine medicines refused');
select pg_temp.ok(not public.workspace_valid_review_draft(pg_temp.reg('[]')||'{"medicationName":"A","medicationDose":"1","medicationTimes":["09:00"]}'),'legacy fields beside a regimen refused');
select pg_temp.ok(public.workspace_valid_review_draft((select base from ctx)||'{"medicationName":"A","medicationDose":"1 mg","medicationTimes":["09:00"]}'),'one-medicine draft stays valid');
select pg_temp.ok(not public.workspace_valid_review_draft((select base from ctx)||'{"medicationName":"A"}'),'one-medicine draft still needs a dose');

-- 3. Adding a medicine keeps the first: same order, same dose log, and the change is recorded.
select pg_temp.save(pg_temp.reg('[{"name":"Fictional statin","dose":"20 mg","instructions":"Evening","times":["21:00"]},{"name":"Fictional add-on","dose":"10 mg","instructions":"","times":["21:00"]}]'));
select pg_temp.ok((select r#>'{draft,changes}'=jsonb_build_array(jsonb_build_object('kind','started','name','Fictional add-on','dose','10 mg','times','["21:00"]'::jsonb,'instructions','')) from pg_temp.review() r),'the doctor sees exactly one change');
do $$declare p uuid;begin
 perform pg_temp.actor(pg_temp.id('04'),'service_role');set local role service_role;
 begin perform public.publish_patient_clinical_plan_with_summary((select uid from ctx),(select actor from ctx),pg_temp.rev(),(select token from ctx),(select engine from ctx),gen_random_uuid(),'x');raise exception 'FAIL: published without approval';
 exception when raise_exception then if sqlerrm not like 'Approve the current regimen%' then raise;end if;end;
 begin perform public.publish_patient_clinical_regimen((select uid from ctx),(select actor from ctx),pg_temp.rev(),(select token from ctx),(select engine from ctx),gen_random_uuid(),'x','0123456789abcdef0123456789abcdef');raise exception 'FAIL: published with a wrong hash';
 exception when raise_exception then if sqlerrm not like 'Approve the current regimen%' then raise;end if;end;
 begin perform public.publish_patient_clinical_regimen((select uid from ctx),(select actor from ctx),pg_temp.rev(),(select token from ctx),(select engine from ctx),gen_random_uuid(),'x','not-a-hash');raise exception 'FAIL: published with a malformed hash';
 exception when invalid_parameter_value then null;end;
 reset role;
end$$;
do $$declare h text:=(pg_temp.review())#>>'{draft,approvalHash}';p uuid;req uuid:=gen_random_uuid();again uuid;card jsonb;begin
 p:=pg_temp.pub(h,req,'Fictional second medicine');
 insert into kv values('v2',p::text),('v2req',req::text);
 perform pg_temp.ok((select count(*)=2 from public.patient_care_plan_medications where plan_id=p),'both medicines are in the plan');
 perform pg_temp.ok((select count(*)=2 from public._member_plan_medicines((select uid from ctx),(clock_timestamp()at time zone 'Asia/Yerevan')::date)),'both are current for dose logging and reminders');
 -- Zoe's chat cards read the same plan on Telegram: both medicines, as the app shows them.
 update auth.users set phone=coalesce(phone,'37400000000'),phone_confirmed_at=coalesce(phone_confirmed_at,now()) where id=(select uid from ctx);
 set local role service_role;
 card:=public.member_plan_read_for((select uid from ctx));
 reset role;
 perform pg_temp.ok(jsonb_array_length(card#>'{plan,medicines}')=2,'the plan card lists both medicines: '||coalesce(card::text,'null'));
 perform pg_temp.ok((select count(*)=1 from public.patient_care_medications m join public.patient_care_plan_medications l on l.medication_id=m.id where l.plan_id=p and m.plan_id=(select v::uuid from kv where k='v1') and m.name='Fictional statin'),'the unchanged medicine keeps its order');
 again:=pg_temp.pub(h,req,'Fictional second medicine');
 perform pg_temp.ok(again=p,'a resend returns the recorded plan');
 perform pg_temp.ok((select count(*)=2 from public.patient_care_plan_regimens where user_id=(select uid from ctx)),'a resend adds no version');
end$$;

-- 4. A dose per medicine, both due at the same minute.
-- The chat and Telegram plan and dose cards read the same regimen.
do $$declare plan jsonb;doses jsonb;begin
 perform set_config('request.jwt.claims',jsonb_build_object('role','service_role')::text,true);
 set local role service_role;plan:=public.member_plan_read_for(pg_temp.id('01'));doses:=public.member_plan_doses_read_for(pg_temp.id('01'));reset role;
 perform pg_temp.ok(jsonb_array_length(plan#>'{plan,medicines}')=2,'the plan card lists both medicines');
 perform pg_temp.ok(jsonb_array_length(doses#>'{plan,medications}')=2,'the dose card lists both medicines');
end$$;

-- A dose must be due after its order took effect. Publication and this check share one transaction clock, so the fixture
-- moves both orders back an hour and to this minute, behind the immutability trigger.
set local session_replication_role=replica;
update public.patient_care_medications m set effective_at=now()-interval '1 hour',start_date=current_date-1,times=array[(date_trunc('minute',now())at time zone 'Asia/Yerevan')::time]
 where m.id in(select l.medication_id from public.patient_care_plan_medications l where l.plan_id=(select v::uuid from kv where k='v2'));
update public.patient_care_plans set published_at=now()-interval '1 day' where id=(select v::uuid from kv where k='v1');
set local session_replication_role=origin;
do $$declare due timestamptz:=date_trunc('minute',now());ids uuid[];m uuid;r jsonb;begin
 ids:=array(select l.medication_id from public.patient_care_plan_medications l where l.plan_id=(select v::uuid from kv where k='v2'));
 perform pg_temp.ok(cardinality(ids)=2,'two orders to log against');
 foreach m in array ids loop
  perform set_config('request.jwt.claims',jsonb_build_object('role','service_role')::text,true);
  set local role service_role;r:=public.report_patient_dose_for(pg_temp.id('01'),m,due,'taken',0);reset role;
  perform pg_temp.ok((r->>'status')='saved','dose saved: '||r::text);
 end loop;
 perform pg_temp.ok((select count(distinct medication_id)=2 from public.patient_dose_events where user_id=pg_temp.id('01') and due_at=due),'each medicine has its own dose at the same minute');
end$$;

-- 5. A titration step and a stop, as data: nothing here decides either. Earlier versions do not move.
select pg_temp.save(pg_temp.reg('[{"name":"fictional  STATIN","dose":"40 mg","instructions":"Evening","times":["08:00","21:00"]}]'));
do $$declare r jsonb:=pg_temp.review();before_v2 jsonb:=(select to_jsonb(x) from public.patient_care_plan_regimens x where plan_id=(select v::uuid from kv where k='v2'));p uuid;begin
 perform pg_temp.ok((select array_agg(c->>'kind' order by o) from jsonb_array_elements(r#>'{draft,changes}')with ordinality x(c,o))=array['dose_changed','schedule_changed','stopped'],'dose, times and stop are each recorded');
 p:=pg_temp.pub(r#>>'{draft,approvalHash}',gen_random_uuid(),'Fictional step');
 insert into kv values('v3',p::text);
 perform pg_temp.ok((select count(*)=1 from public.patient_care_plan_medications where plan_id=p),'the stopped medicine left the plan');
 perform pg_temp.ok((select to_jsonb(x) from public.patient_care_plan_regimens x where plan_id=(select v::uuid from kv where k='v2'))=before_v2,'version 2 is unchanged');
 perform pg_temp.ok((select count(*)=2 from public.patient_care_plan_medications where plan_id=(select v::uuid from kv where k='v2')),'version 2 keeps both medicines');
end$$;
select pg_temp.must_fail('update public.patient_care_plan_regimens set changes=''[]''','immutable');
select pg_temp.must_fail('delete from public.patient_care_plan_regimens','immutable');
select pg_temp.must_fail('update public.patient_care_medications set dose=''1 mg'' where user_id=pg_temp.id(''01'')','immutable');
select pg_temp.must_fail('delete from public.patient_care_plan_medications where user_id=pg_temp.id(''01'')','immutable');

-- 6. Stale approval: the hash the doctor saw stops working when what it covers moves.
select pg_temp.save(pg_temp.reg('[{"name":"Fictional statin","dose":"40 mg","instructions":"Evening","times":["08:00","21:00"]},{"name":"Fictional other","dose":"5 mg","instructions":"","times":["09:00"]}]'));
insert into kv select 'stale',(pg_temp.review())#>>'{draft,approvalHash}';
savepoint s1;
select pg_temp.save(pg_temp.reg('[{"name":"Fictional statin","dose":"80 mg","instructions":"Evening","times":["08:00","21:00"]},{"name":"Fictional other","dose":"5 mg","instructions":"","times":["09:00"]}]'));
select pg_temp.must_fail(format('select pg_temp.pub(%L)',(select v from kv where k='stale')),'Approve the current regimen');
rollback to s1;
savepoint s2;
-- A newer version published in between: the same draft now replaces a different plan.
do $$declare h text:=(select v from kv where k='stale');begin
 update public.patient_care_plans set active=false,retired_at=now() where user_id=(select uid from ctx) and active;
 perform pg_temp.ok((pg_temp.review())#>>'{draft,approvalHash}' is distinct from h,'the review now names a different plan');
end$$;
select pg_temp.must_fail(format('select pg_temp.pub(%L)',(select v from kv where k='stale')),'Approve the current regimen');
rollback to s2;
savepoint s3;
insert into public.patient_measurements(user_id,submission_id,systolic,diastolic,measured_at) select uid,gen_random_uuid(),120,80,now() from ctx;
select pg_temp.must_fail(format('select pg_temp.pub(%L)',(select v from kv where k='stale')),'Evidence changed');
rollback to s3;
savepoint s4;
update public.patient_clinical_cases set assigned_doctor_id=pg_temp.id('05') where user_id=(select uid from ctx);
select pg_temp.must_fail(format('select pg_temp.pub(%L)',(select v from kv where k='stale')),'Assigned active doctor');
rollback to s4;
savepoint s5;
do $$declare c bigint:=pg_temp.rev();begin
 perform pg_temp.actor(pg_temp.id('04'),'service_role');set local role service_role;
 begin perform public.publish_patient_clinical_regimen((select uid from ctx),(select actor from ctx),c-1,(select token from ctx),(select engine from ctx),gen_random_uuid(),'x',(select v from kv where k='stale'));raise exception 'FAIL: old revision published';
 exception when others then if sqlerrm like 'FAIL%' then raise;end if;end;
 reset role;
end$$;
rollback to s5;

-- 7. By role: the table is closed; each read returns only what that person may see.
do $$begin
 perform pg_temp.actor(pg_temp.id('01'));set local role authenticated;
 begin perform 1 from public.patient_care_plan_regimens;raise exception 'FAIL: member read the table';exception when insufficient_privilege then null;end;
 begin perform public.doctor_regimen_review(pg_temp.id('01'));raise exception 'FAIL: member used the doctor read';exception when insufficient_privilege then null;end;
 begin perform public.publish_patient_clinical_regimen(pg_temp.id('01'),pg_temp.id('04'),1,'x','{}',gen_random_uuid(),'x','x');raise exception 'FAIL: member published';exception when insufficient_privilege then null;end;
 begin perform public._draft_regimen('{}');raise exception 'FAIL: member reached a helper';exception when insufficient_privilege then null;end;
 reset role;
 perform pg_temp.actor(pg_temp.id('04'),'service_role');set local role service_role;
 begin perform 1 from public.patient_care_plan_regimens;raise exception 'FAIL: service role read the table';exception when insufficient_privilege then null;end;
 reset role;
 set local role anon;
 begin perform public.patient_care_plan_regimens();raise exception 'FAIL: anon read';exception when insufficient_privilege then null;end;
 begin perform public.doctor_regimen_review(pg_temp.id('01'));raise exception 'FAIL: anon doctor read';exception when insufficient_privilege then null;end;
 reset role;
end$$;
do $$declare a uuid;begin
 foreach a in array array[pg_temp.id('05'),pg_temp.id('06'),pg_temp.id('07')] loop
  perform pg_temp.actor(a);set local role authenticated;
  begin perform public.doctor_regimen_review(pg_temp.id('01'));raise exception 'FAIL: staff % read another doctor''s member',a;exception when insufficient_privilege then null;end;
  reset role;
 end loop;
end$$;
do $$declare r jsonb;begin
 perform pg_temp.actor(pg_temp.id('01'));set local role authenticated;r:=public.patient_care_plan_regimens();reset role;
 perform pg_temp.ok((r->>'enabled')='true' and jsonb_array_length(r->'versions')=3,'member sees own three versions');
 perform pg_temp.ok(r#>>'{versions,0,version}'='3' and (r#>>'{versions,0,current}')='true' and r#>>'{versions,1,changes,0,kind}'='started','newest first, with what changed');
 perform pg_temp.ok(not r::text like '%draft%' and not r::text like '%Fictional other%','the unpublished draft never reaches a member');
 perform pg_temp.actor(pg_temp.id('02'));set local role authenticated;r:=public.patient_care_plan_regimens();reset role;
 perform pg_temp.ok(r->'versions'='[]'::jsonb,'another member sees nothing');
 perform pg_temp.actor(pg_temp.id('03'));set local role authenticated;r:=public.patient_care_plan_regimens();reset role;
 perform pg_temp.ok(r->'versions'='[]'::jsonb and (r->>'enabled')='false','no confirmed phone, nothing');
end$$;

-- 8. The ECG block and the orange hold are not touched: a non-lab required test still refuses publication.
savepoint ecg;
update public.patient_clinical_cases set review=jsonb_set(review,'{engine,tests}','[{"id":"ecg","title":"ECG","method":"clinic"}]') where user_id=(select uid from ctx);
update public.patient_clinical_cases set draft_review_token=md5(review::text) where user_id=(select uid from ctx);
do $$declare h text:=(pg_temp.review())#>>'{draft,approvalHash}';begin
 perform pg_temp.actor(pg_temp.id('04'),'service_role');set local role service_role;
 begin perform public.publish_patient_clinical_regimen((select uid from ctx),(select actor from ctx),pg_temp.rev(),(select token from ctx),jsonb_set((select engine from ctx),'{tests}','[{"id":"ecg","title":"ECG","method":"clinic"}]'),gen_random_uuid(),'x',h);raise exception 'FAIL: ECG published';
 exception when raise_exception then if sqlerrm not like '%no supported native%' then raise;end if;end;
 reset role;
end$$;
rollback to ecg;

-- 9. Zoe keeps her strict fields and sees every medicine; a one-medicine plan reads exactly as before.
select pg_temp.ok(public._zoe_plan_medicines(d)=jsonb_build_object('medicationName','A','medicationDose','1 mg','medicationInstructions','Evening','medicationTimes','["21:00"]'::jsonb),'legacy shape unchanged')
 from (select (select base from ctx)||'{"medicationName":"A","medicationDose":"1 mg","medicationInstructions":"Evening","medicationTimes":["21:00"]}' d)x;
select pg_temp.ok(public._zoe_plan_medicines(pg_temp.reg('[{"name":"A","dose":"1 mg","instructions":"Evening","times":["21:00"]}]'))=jsonb_build_object('medicationName','A','medicationDose','1 mg','medicationInstructions','Evening','medicationTimes','["21:00"]'::jsonb),'one row reads as one medicine');
select pg_temp.ok(public._zoe_plan_medicines(pg_temp.reg('[]'))->>'medicationName'='','no medicines');
select pg_temp.ok(public._zoe_plan_medicines(null)->>'medicationName'='','no publication');
select pg_temp.ok(z->>'medicationName'='A 1 mg; B 2 mg' and z->>'medicationInstructions'='A at 09:00, 21:00, Evening; B at 09:00' and z->>'medicationDose'='' and z->'medicationTimes'='[]'::jsonb,'every medicine is named')
 from (select public._zoe_plan_medicines(pg_temp.reg('[{"name":"A","dose":"1 mg","instructions":"Evening","times":["21:00","09:00"]},{"name":"B","dose":"2 mg","instructions":"","times":["09:00"]}]')) z)x;
select pg_temp.ok(length(z->>'medicationName')<=200 and z->>'medicationName' like '%; and % more in the published plan' and length(z->>'medicationInstructions')<=500,'a long list says how many more: '||(z->>'medicationName'))
 from (select public._zoe_plan_medicines(pg_temp.reg((select jsonb_agg(jsonb_build_object('name',repeat('n',60)||g,'dose',repeat('d',60),'instructions',repeat('i',200),'times','["09:00"]'::jsonb))::text from generate_series(1,8)g))) z)x;
select pg_temp.ok(public._fit_regimen_lines(array[repeat('x',300),'B'],200)='2 medicines in the published plan','a first line too long still says how many');

-- 10. Rollback: switch off. Nothing published moves, new regimens stop, and a one-medicine draft cannot drop the others.
savepoint off_;
update public.multi_medicine_capabilities set enabled=false;
do $$declare h text;begin
 perform pg_temp.ok((select count(*)=3 from public.patient_care_plan_regimens where user_id=(select uid from ctx)),'versions stay');
 perform pg_temp.ok((select count(*)=1 from public._member_plan_medicines((select uid from ctx),(clock_timestamp()at time zone 'Asia/Yerevan')::date)),'the current medicines stay current');
end$$;
select pg_temp.must_fail(format('select pg_temp.pub(%L)',(select v from kv where k='stale')),'switched off');
rollback to off_;
-- A regimen plan, even of one, cannot be overwritten through the old form (Astra MM-4): not as a draft, and not at publication.
do $$declare p uuid;begin
 p:=pg_temp.pub((pg_temp.review())#>>'{draft,approvalHash}',gen_random_uuid(),'Fictional regimen of two');
end$$;
create function pg_temp.legacy_publish()returns void language plpgsql as $$begin
 perform pg_temp.actor(pg_temp.id('04'),'service_role');set local role service_role;
 perform public.publish_patient_clinical_plan((select uid from ctx),(select actor from ctx),pg_temp.rev(),(select token from ctx),(select engine from ctx),gen_random_uuid());reset role;end$$;
savepoint lossy_two;
select pg_temp.must_fail($q$select pg_temp.save((select base from ctx))$q$,'would drop medicines');
select pg_temp.must_fail($q$select pg_temp.save((select base from ctx)||'{"medicationName":"Fictional statin","medicationDose":"40 mg","medicationInstructions":"Evening","medicationTimes":["21:00"]}')$q$,'would drop medicines');
-- Even past the save guard, publication refuses: a prose-only draft and a one-medicine draft, switch on and off.
update public.patient_clinical_cases set draft=(select base from ctx) where user_id=(select uid from ctx);
select pg_temp.must_fail('select pg_temp.legacy_publish()','would drop medicines');
update public.multi_medicine_capabilities set enabled=false;
select pg_temp.must_fail('select pg_temp.legacy_publish()','would drop medicines');
rollback to lossy_two;
savepoint lossy_one;
do $$declare r jsonb;begin
 perform pg_temp.save(pg_temp.reg('[{"name":"Fictional statin","dose":"40 mg","instructions":"Evening","times":["21:00"]}]'));
 r:=pg_temp.review();perform pg_temp.pub(r#>>'{draft,approvalHash}',gen_random_uuid(),'Fictional regimen of one');
end$$;
update public.multi_medicine_capabilities set enabled=false;
select pg_temp.must_fail($q$select pg_temp.save((select base from ctx))$q$,'would drop medicines');
update public.patient_clinical_cases set draft=(select base from ctx) where user_id=(select uid from ctx);
select pg_temp.must_fail('select pg_temp.legacy_publish()','would drop medicines');
select pg_temp.ok((select count(*)=1 from public._member_plan_medicines((select uid from ctx),(clock_timestamp()at time zone 'Asia/Yerevan')::date)),'the one medicine stays current');
rollback to lossy_one;
-- An empty regimen is the doctor stopping everything: allowed, and every stop is recorded.
select pg_temp.save(pg_temp.reg('[]'));
do $$declare r jsonb:=pg_temp.review();p uuid;begin
 perform pg_temp.ok((select bool_and(c->>'kind'='stopped') and count(*)=2 from jsonb_array_elements(r#>'{draft,changes}')c),'both stops are shown before publication');
 p:=pg_temp.pub(r#>>'{draft,approvalHash}',gen_random_uuid(),'Fictional stop');
 perform pg_temp.ok((select count(*)=0 from public.patient_care_plan_medications where plan_id=p),'no medicine in the plan');
end$$;

-- 11. Zoe's complete reads on a published regimen at the largest size, within the limits her strict parsers set.
savepoint zoe;
do $$declare r jsonb;big jsonb:=(select jsonb_agg(jsonb_build_object('name','Fictional medicine '||g||' '||repeat('n',99),'dose',repeat('d',120),'instructions',repeat('i',500),'times','["08:00","12:00","16:00","20:00"]'::jsonb))from generate_series(1,8)g);begin
 perform pg_temp.save((select base from ctx)||jsonb_build_object('medicines',big));
 r:=pg_temp.review();perform pg_temp.pub(r#>>'{draft,approvalHash}',gen_random_uuid(),'Fictional large regimen');
end$$;
set local session_replication_role=replica;
insert into public.zoe_settings(singleton,structured_drafts_enabled,health_answers_enabled)values(true,true,true)on conflict(singleton)do update set structured_drafts_enabled=true,health_answers_enabled=true;
insert into public.conversations(id,member_id)values(pg_temp.id('40'),pg_temp.id('01'));
insert into public.zoe_runs(id,conversation_id,member_id,message_seq,context_version,draft_epoch,spend_day,state)values(pg_temp.id('50'),pg_temp.id('40'),pg_temp.id('01'),1,1,0,current_date,'started');
set local session_replication_role=origin;
do $$declare plan jsonb;context jsonb;d jsonb;line text;rec jsonb;begin
 perform set_config('request.jwt.claims',jsonb_build_object('role','service_role')::text,true);set local role service_role;
 plan:=public.zoe_run_plan(array[pg_temp.id('50')])#>'{0,plan}';context:=public.zoe_run_health_context(array[pg_temp.id('50')])#>'{0,data,plan}';reset role;
 foreach d in array array[plan,context] loop
  perform pg_temp.ok(length(d->>'medicationName') between 1 and 200 and length(d->>'medicationDose')=0 and length(d->>'medicationInstructions')<=500 and d->'medicationTimes'='[]'::jsonb,'Zoe fields within her limits: '||left(d::text,200));
  perform pg_temp.ok(d->>'medicationName' like '%in the published plan','a list that does not fit says so');
 end loop;
 -- A reply draft may quote the line exactly as her plan read shows it, and nothing else.
 line:=concat_ws(', ',plan->>'medicationName',plan->>'medicationInstructions');
 perform pg_temp.ok(length(line)>0,'quotable line');
 set local role service_role;
 rec:=public.zoe_run_record_reply_draft(pg_temp.id('50'),jsonb_build_object('version','v1','planId',plan->>'planId','asked','Fictional','acknowledgementId','A1','acknowledgement','Fictional','quoted',jsonb_build_array(jsonb_build_object('id','M1','kind','medicine','text','Not the plan line')),'doctorDecides','[]'::jsonb,'outsidePlan',false,'needsJudgement',false,'judgementReasons','[]'::jsonb));
 reset role;
 perform pg_temp.ok(rec->>'code'='quote_not_in_plan','a line outside the regimen is refused: '||rec::text);
end$$;
rollback to zoe;
-- A short regimen, end to end, including the quoted line.
savepoint zoe_short;
do $$declare r jsonb;begin
 perform pg_temp.save(pg_temp.reg('[{"name":"Fictional statin","dose":"40 mg","instructions":"Evening","times":["21:00"]},{"name":"Fictional add-on","dose":"10 mg","instructions":"","times":["09:00"]}]'));
 r:=pg_temp.review();perform pg_temp.pub(r#>>'{draft,approvalHash}',gen_random_uuid(),'Fictional short regimen');
end$$;
set local session_replication_role=replica;
insert into public.zoe_settings(singleton,structured_drafts_enabled,health_answers_enabled)values(true,true,true)on conflict(singleton)do update set structured_drafts_enabled=true,health_answers_enabled=true;
insert into public.conversations(id,member_id)values(pg_temp.id('40'),pg_temp.id('01'));
insert into public.zoe_runs(id,conversation_id,member_id,message_seq,context_version,draft_epoch,spend_day,state)values(pg_temp.id('50'),pg_temp.id('40'),pg_temp.id('01'),1,1,0,current_date,'started');
set local session_replication_role=origin;
do $$declare plan jsonb;rec jsonb;line text;begin
 perform set_config('request.jwt.claims',jsonb_build_object('role','service_role')::text,true);set local role service_role;
 plan:=public.zoe_run_plan(array[pg_temp.id('50')])#>'{0,plan}';reset role;
 perform pg_temp.ok(plan->>'medicationName'='Fictional statin 40 mg; Fictional add-on 10 mg','both medicines named: '||plan::text);
 line:=concat_ws(', ',plan->>'medicationName',plan->>'medicationInstructions');
 set local role service_role;
 rec:=public.zoe_run_record_reply_draft(pg_temp.id('50'),jsonb_build_object('version','v1','planId',plan->>'planId','asked','Fictional','acknowledgementId','A1','acknowledgement','Fictional','quoted',jsonb_build_array(jsonb_build_object('id','M1','kind','medicine','text',line)),'doctorDecides','[]'::jsonb,'outsidePlan',false,'needsJudgement',false,'judgementReasons','[]'::jsonb));
 reset role;
 perform pg_temp.ok((rec->>'ok')='true','the regimen line is quotable: '||rec::text);
end$$;
rollback to zoe_short;

-- 12. Audit S1-11 (4 Nov): the clinic admin's record carries no plan or medicines; only the care team sees them.
select pg_temp.ok(pg_get_functiondef('public.clinic_admin_patient_record(uuid,uuid)'::regprocedure) not like '%patient_care_plan%','clinic admin record reads no plan or medicines');
rollback;
\echo multi-medicine SQL: passed
