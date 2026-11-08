-- Synthetic default-confirmation checks. All fixtures roll back; no model or hosted data.
-- Off by default; the database re-checks identity, sample date against the visit day, range, flags and
-- code checks whatever the worker proposes; the guard refuses any other route; the doctor can still
-- confirm, correct or reject; a review is not undone; counts and the doctor's read show the new status.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(cond boolean,label text) returns void language plpgsql as $$begin
 if cond is distinct from true then raise exception 'TEST %',label;end if;
end$$;
create function pg_temp.raises(statement text,code text default '42501') returns boolean language plpgsql as $$begin
 execute statement;return false;
exception when others then
 if sqlstate=code then return true;end if;
 raise notice 'unexpected % %',sqlstate,sqlerrm;return false;
end$$;
-- a5c: doctor 02, member 04, nurse 06, clinic 07. Visit 41 on 15 Oct (Yerevan), visit 42 on 10 Oct.
insert into auth.users(id,phone,phone_confirmed_at)select ('a5c00000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid,case when n=4 then '374000970004'end,case when n=4 then now()end from unnest(array[2,4,6])n;
insert into public.workspace_clinics(id,name)values('a5c00000-0000-4000-8000-000000000007','Synthetic auto-accept clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values
 ('a5c00000-0000-4000-8000-000000000002','doctor','Synthetic auto-accept doctor','a5c00000-0000-4000-8000-000000000007'),
 ('a5c00000-0000-4000-8000-000000000006','nurse','Synthetic auto-accept nurse','a5c00000-0000-4000-8000-000000000007');
insert into public.patient_clinical_cases(user_id,assigned_doctor_id)values('a5c00000-0000-4000-8000-000000000004','a5c00000-0000-4000-8000-000000000002');
update public.profiles set display_name='Synthetic Member Four',birth_date='1970-01-02'where id='a5c00000-0000-4000-8000-000000000004';
insert into public.patient_care_visits(id,user_id,actor_id,actor_name,actor_role,clinic_id,created_at)values
 ('a5c00000-0000-4000-8000-000000000041','a5c00000-0000-4000-8000-000000000004','a5c00000-0000-4000-8000-000000000006','Synthetic nurse','nurse','a5c00000-0000-4000-8000-000000000007','2026-10-15 22:30+04'),
 ('a5c00000-0000-4000-8000-000000000042','a5c00000-0000-4000-8000-000000000004','a5c00000-0000-4000-8000-000000000006','Synthetic nurse','nurse','a5c00000-0000-4000-8000-000000000007','2026-10-10 10:00+04');
set local session_replication_role=replica;
insert into public.clinic_batch_files(id,batch_id,logical_key,attempt_id,actor_id,session_id,amr,jwt_expires_at,membership_id,membership_revision,submission_id,name,mime,declared_size,expected_sha256,object_key,object_id,measured_size,sha256,state,created_at)
select ('a5c00000-0000-4000-8000-0000000001'||n)::uuid,gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),'a5c00000-0000-4000-8000-000000000002',gen_random_uuid(),'[]',now(),gen_random_uuid(),1,gen_random_uuid(),
 'PRIVATE-AUTO-'||n||'.pdf','application/pdf',1000,repeat('a',64),'synthetic-auto-accept/'||n,('a5c00000-0000-4000-8000-0000000002'||n)::uuid,1000,repeat('a',64),'stored',now()
from generate_series(11,15)n;
insert into storage.objects(id,bucket_id,name,metadata)select ('a5c00000-0000-4000-8000-0000000002'||n)::uuid,'clinic-originals','synthetic-auto-accept/'||n,'{"size":1000}'from generate_series(11,15)n;
set local session_replication_role=origin;
update public.doctor_completion_capabilities set enabled=true where singleton;
update public.lab_ai_capabilities set enabled=true where singleton;

create function pg_temp.attach(n int,visit int) returns uuid language sql as $$
 insert into public.clinic_result_attachments(file_id,clinic_id,user_id,visit_id,actor_kind,actor_id,submission_id)
 values(('a5c00000-0000-4000-8000-0000000001'||n)::uuid,'a5c00000-0000-4000-8000-000000000007','a5c00000-0000-4000-8000-000000000004',
  ('a5c00000-0000-4000-8000-0000000000'||visit)::uuid,'noreon-admin','a5c00000-0000-4000-8000-000000000002',gen_random_uuid())returning id
$$;
-- A live password session for the user (staff RPCs require a managed session, 20261020195207).
create function pg_temp.as_user(n int) returns void language plpgsql security definer as $$declare c jsonb:=jsonb_build_object('sub','a5c00000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'),'role','authenticated','session_id','a5c00000-0000-4000-8000-0000000001'||lpad(n::text,2,'0'));begin
 insert into auth.sessions(id,user_id,created_at,updated_at)select (c->>'session_id')::uuid,(c->>'sub')::uuid,now(),now()
  where exists(select 1 from auth.users where id=(c->>'sub')::uuid)on conflict(id)do nothing;
 perform set_config('request.jwt.claims',(c||jsonb_build_object('amr',jsonb_build_array(jsonb_build_object('method','password'))))::text,true);
end$$;
create function pg_temp.as_service() returns void language sql as $$select set_config('request.jwt.claims','{"role":"service_role"}',true)$$;
create function pg_temp.job(n int) returns public.lab_ai_jobs language sql security definer as $$select * from public.lab_ai_jobs where file_id=('a5c00000-0000-4000-8000-0000000001'||n)::uuid order by created_at desc limit 1$$;
create function pg_temp.v(n int,q int) returns public.lab_ai_values language sql security definer as $$
 select v.* from public.lab_ai_values v join public.lab_ai_jobs j on j.id=v.job_id where j.file_id=('a5c00000-0000-4000-8000-0000000001'||n)::uuid and v.seq=q
$$;
-- An in-range haemoglobin the worker proposes; `extra` overrides fields.
create function pg_temp.value(extra jsonb default '{}') returns jsonb language sql as $$
 with fixture as(select jsonb_build_object('testName','Haemoglobin','catalogueRef','hemoglobin','valueText','140','value',140,'unit','g/L','refLow',120,'refHigh',160,'refText','120-160','labFlag',null,
  'collectedOn',(now()at time zone 'Asia/Yerevan')::date::text,'labName','Synthetic lab','page',1,'snippet','Haemoglobin 140 g/L','checks','[]'::jsonb,'attention',null,'attentionRule',null,'autoAccept',true)||extra v)
 select v||jsonb_build_object('snippet',case when extra ? 'snippet'then extra->>'snippet'
  else concat_ws(' ',v->>'testName',v->>'valueText',v->>'unit',case when v->>'refText' is not null then '['||(v->>'refText')||']'end)end)from fixture
$$;
create function pg_temp.done(vals jsonb,status text default 'match') returns jsonb language sql as $$
 select jsonb_build_object('disposition','done','outcome','extracted','pageCount',2,'sourceSha256',repeat('a',64),'identityStatus',status,
  'identity',jsonb_build_object('nameOnSheet','Synthetic Member Four'),'values',vals,'summary',null,'provider','noreon.fake','model','noreon-fake-lab-1')
$$;
create function pg_temp.finish(n int,vals jsonb,status text default 'match') returns jsonb language plpgsql as $$
declare j public.lab_ai_jobs:=pg_temp.job(n);begin return public.lab_ai_job_finish(j.id,j.lease_token,pg_temp.done(vals,status));end$$;
create function pg_temp.review(sub text,value uuid,act text,extra jsonb default '{}') returns jsonb language sql as $$
 select public.doctor_lab_ai_value_review(jsonb_build_object('version','lab-ai-review-v1','submissionId','a5c00000-0000-4000-8000-0000000009'||sub,
  'memberId','a5c00000-0000-4000-8000-000000000004','valueId',value,'action',act)||extra)
$$;
grant execute on function pg_temp.ok(boolean,text),pg_temp.raises(text,text),pg_temp.as_user(int),pg_temp.as_service(),pg_temp.job(int),pg_temp.v(int,int),pg_temp.value(jsonb),
 pg_temp.done(jsonb,text),pg_temp.finish(int,jsonb,text),pg_temp.review(text,uuid,text,jsonb) to authenticated,service_role;

select pg_temp.ok((select auto_accept_enabled from public.lab_ai_capabilities)=false,'automatic acceptance is off by default');
select pg_temp.ok((select column_default='false'from information_schema.columns where table_schema='public'and table_name='lab_ai_capabilities'and column_name='auto_accept_enabled'),'switch schema default remains false');
select pg_temp.attach(11,41),pg_temp.attach(12,41),pg_temp.attach(13,41),pg_temp.attach(14,42);
select pg_temp.as_service();
set local role service_role;
select pg_temp.ok(jsonb_array_length(public.lab_ai_job_claim(5))=4,'four jobs claimed');

-- 1. Switch off: a proposal changes nothing.
select pg_temp.ok((pg_temp.finish(11,jsonb_build_array(pg_temp.value()))->>'autoAccepted')::int=0,'switch off: nothing accepted');
reset role;
select pg_temp.ok((pg_temp.v(11,1)).status='unverified','switch off: the value waits for the doctor');

-- 2. Every safeguard is re-checked even when a worker proposes every value.
create temporary table auto_cases(seq int generated always as identity,delta jsonb,accepted boolean,label text);
insert into auto_cases(delta,accepted,label)values
 ('{}',true,'plain haemoglobin'),
 ('{"testName":"LDL-C","catalogueRef":"ldl_c","valueText":"7","value":7,"unit":"mmol/L","refLow":0,"refHigh":3,"refText":"<3","labFlag":"high","attention":"threshold","attentionRule":"THRESHOLD.phase2LdlHigh"}',true,'out-of-range LDL'),
 ('{"testName":"HbA1c","catalogueRef":"hba1c","valueText":"12","value":12,"unit":"%","refLow":4,"refHigh":6,"refText":"4-6","labFlag":"high","attention":"threshold","attentionRule":"THRESHOLD.hba1cUrgent"}',true,'high HbA1c'),
 ('{"autoAccept":false}',false,'worker did not propose'),
 ('{"checks":["unit_missing"]}',false,'failed code check'),
 ('{"attention":"needs_doctor"}',false,'unexplained attention mark'),
 -- A stored rule must have an attention mark; otherwise the whole extraction is invalid.
 ('{"attention":"needs_doctor","attentionRule":"unexplained"}',false,'unexplained attention rule'),
 ('{"unit":"unknown"}',false,'unmappable unit'),
 ('{"catalogueRef":null}',false,'unmapped analyte'),
 ('{"testName":"Panel 7"}',false,'model-only mapping'),
 ('{"valueText":"140 H"}',false,'annotated number'),
 ('{"valueText":"<140","value":null}',false,'censored value'),
 ('{"value":141}',false,'printed/stored mismatch'),
 ('{"valueText":"251","value":251}',false,'implausible haemoglobin'),
 ('{"collectedOn":null}',false,'missing sample date'),
 (jsonb_build_object('collectedOn',((now()at time zone 'Asia/Yerevan')::date+1)::text),false,'future sample date'),
 (jsonb_build_object('collectedOn',((now()at time zone 'Asia/Yerevan')::date-401)::text),false,'401 days before upload'),
 (jsonb_build_object('collectedOn',((now()at time zone 'Asia/Yerevan')::date-400)::text),true,'400-day boundary'),
 ('{"refLow":null,"refHigh":null,"refText":null}',true,'no printed range'),
 ('{"valueText":"122","value":122}',true,'range margin removed'),
 ('{"refText":"120-180 (male);110-140 (female)"}',false,'conditional reference prose in the snippet blocks confirmation'),
 ('{"labFlag":"high"}',true,'printed high flag alone'),
 ('{"labFlag":"low"}',true,'printed low flag alone'),
 ('{"labFlag":"critical","attention":"lab_critical"}',true,'clinical alert retained'),
 ('{"valueText":"170","value":170,"attention":"needs_doctor"}',true,'explained out-of-range attention'),
 ('{"unit":null}',false,'missing dimensional unit'),
 ('{"catalogueRef":"not_in_catalogue"}',false,'unknown catalogue key'),
 ('{"testName":"LDL-C","catalogueRef":"hdl_c"}',false,'mapping conflict without a worker check'),
 ('{"testName":"LDL-C","catalogueRef":"ldl_c","valueText":"200","value":200,"unit":"mg/dL"}',true,'convertible unit'),
 ('{"testName":"LDL-C","catalogueRef":"ldl_c","valueText":"15.000001","value":15.000001,"unit":"mmol/L"}',false,'above LDL window'),
 ('{"testName":"LDL-C","catalogueRef":"ldl_c","valueText":"0.099999","value":0.099999,"unit":"mmol/L"}',false,'below LDL window'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"50","value":50,"unit":"mmol/L","snippet":"Glucose 50 mg/dL"}',false,'glucose unit swap'),
 ('{"testName":"Urea","catalogueRef":"urea","valueText":"30","value":30,"unit":"mmol/L","snippet":"Urea 30 mg/dL"}',false,'urea unit swap'),
 ('{"testName":"LDL-C","catalogueRef":"ldl_c","valueText":"5","value":5,"unit":"mg/dL","snippet":"LDL-C 5 mmol/L"}',false,'LDL unit swap'),
 ('{"testName":"HbA1c","catalogueRef":"hba1c","valueText":"12","value":12,"unit":"%","snippet":"HbA1c 12 mmol/mol"}',false,'HbA1c mmol/mol read as percent'),
 ('{"testName":"HbA1c","catalogueRef":"hba1c","valueText":"12","value":12,"unit":"mmol/mol","snippet":"HbA1c 12 %"}',false,'HbA1c percent read as mmol/mol'),
 ('{"testName":"Creatinine","catalogueRef":"creatinine","valueText":"20","value":20,"unit":"µmol/L","snippet":"Creatinine 20 mg/dL"}',false,'creatinine mg/dL read as micromolar'),
 ('{"testName":"Creatinine","catalogueRef":"creatinine","valueText":"20","value":20,"unit":"mg/dL","snippet":"Creatinine 20 µmol/L"}',false,'creatinine micromolar read as mg/dL'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose 50 mmol/L; reference 3 - 5 mmol/L"}',false,'ambiguous source: Glucose 50 mmol/L; reference 3 - 5 mmol/L'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose 2 5 mmol/L"}',false,'ambiguous source: Glucose 2 5 mmol/L'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose 5; result 5 mmol/L"}',false,'ambiguous source: Glucose 5; result 5 mmol/L'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"50 mmol/L; reference 3 - 5 mmol/L"}',false,'ambiguous source: 50 mmol/L; reference 3 - 5 mmol/L'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"< 5 mmol/L"}',false,'ambiguous source: < 5 mmol/L'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose 5 mmol/L / kg"}',false,'ambiguous source: Glucose 5 mmol/L / kg'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose 5 mmol/L/ kg"}',false,'ambiguous source: Glucose 5 mmol/L/ kg'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose 5 mmol/mol"}',false,'ambiguous source: Glucose 5 mmol/mol'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"90","value":90.0,"unit":"mg/dL","snippet":"Glucose 90 mg/dL/kg"}',false,'ambiguous source: Glucose 90 mg/dL/kg'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"90","value":90.0,"unit":"mg/dL","snippet":"Glucose 90 mg/dL / kg"}',false,'ambiguous source: Glucose 90 mg/dL / kg'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose 5 mmol/L · kg"}',false,'ambiguous source: Glucose 5 mmol/L · kg'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose 5 mmol/L * kg"}',false,'ambiguous source: Glucose 5 mmol/L * kg'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose 5 mmol/L ^ 2"}',false,'ambiguous source: Glucose 5 mmol/L ^ 2'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose 5 mmol/L per kg"}',false,'ambiguous source: Glucose 5 mmol/L per kg'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose 5 mmol/L в кг"}',false,'ambiguous source: Glucose 5 mmol/L в кг'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose 5 mmol/L kg"}',false,'ambiguous source: Glucose 5 mmol/L kg'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose 5  mmol/L"}',false,'ambiguous source: Glucose 5  mmol/L'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose 5\tmmol/L"}',false,'ambiguous source: Glucose 5 mmol/L'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose 5.0 mmol/L"}',false,'ambiguous source: Glucose 5.0 mmol/L'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose .5 mmol/L"}',false,'ambiguous source: Glucose .5 mmol/L'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose 5e0 mmol/L"}',false,'ambiguous source: Glucose 5e0 mmol/L'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose < \t 5 mmol/L"}',false,'ambiguous source: Glucose <   5 mmol/L'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose > \t 5 mmol/L"}',false,'ambiguous source: Glucose >   5 mmol/L'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose ≤ \t 5 mmol/L"}',false,'ambiguous source: Glucose ≤   5 mmol/L'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose ≥ \t 5 mmol/L"}',false,'ambiguous source: Glucose ≥   5 mmol/L'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose ~ \t 5 mmol/L"}',false,'ambiguous source: Glucose ~   5 mmol/L'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose - \t 5 mmol/L"}',false,'ambiguous source: Glucose -   5 mmol/L'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose – \t 5 mmol/L"}',false,'ambiguous source: Glucose –   5 mmol/L'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose to \t 5 mmol/L"}',false,'ambiguous source: Glucose to   5 mmol/L'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose до \t 5 mmol/L"}',false,'ambiguous source: Glucose до   5 mmol/L'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose от \t 5 mmol/L"}',false,'ambiguous source: Glucose от   5 mmol/L'),
 ('{"testName":"LDL-C","catalogueRef":"ldl_c","valueText":"3.9","value":3.9,"unit":"mmol/L","snippet":"LDL-C 3.9 mmol/L (<3.0)"}',true,'result before reference range'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose 5 mmol/L; reference 3 - 5 mmol/L"}',true,'result before reference text'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"5 mmol/L (<6)"}',true,'result from start without test name'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5.0","value":5.0,"unit":"mmol/L","snippet":"Glucose 5.0 mmol/L"}',true,'exact printed decimal'),
 ('{"testName":"LDL-C","catalogueRef":"ldl_c","valueText":"3.9","value":3.9,"unit":"mmol/L","snippet":"LDL-C 3.9 mmol/L"}',true,'corroborated LDL'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"90","value":90,"unit":"mg/dL","snippet":"Glucose 90 mg/dL"}',true,'corroborated glucose'),
 ('{"testName":"HbA1c","catalogueRef":"hba1c","valueText":"5.5","value":5.5,"unit":"%","snippet":"HbA1c 5.5 %"}',true,'corroborated HbA1c percent'),
 ('{"testName":"HbA1c","catalogueRef":"hba1c","valueText":"42","value":42,"unit":"mmol/mol","snippet":"HbA1c 42 mmol/mol Hb"}',true,'corroborated HbA1c molar'),
 ('{"testName":"Creatinine","catalogueRef":"creatinine","valueText":"90","value":90,"unit":"umol/L","snippet":"Creatinine 90 µmol / L"}',true,'corroborated creatinine micromolar'),
 ('{"testName":"Creatinine","catalogueRef":"creatinine","valueText":"1","value":1,"unit":"mg/dL","snippet":"Creatinine 1 MG / DL"}',true,'corroborated creatinine mass'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose 5 mmol/L H (corrected result: 50 mmol/L)","refLow":null,"refHigh":null,"refText":null}',false,'reference grammar: Glucose 5 mmol/L H (corrected result: 50 mmol/L)'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose 5 mmol/L H [corrected result: 50 mmol/L]","refLow":null,"refHigh":null,"refText":null}',false,'reference grammar: Glucose 5 mmol/L H [corrected result: 50 mmol/L]'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose 5 mmol/L H (исправленный результат: 50 mmol/L)","refLow":null,"refHigh":null,"refText":null}',false,'reference grammar: Glucose 5 mmol/L H (исправленный результат: 50 mmol/L)'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose 5 mmol/L H [исправленный результат: 50 mmol/L]","refLow":null,"refHigh":null,"refText":null}',false,'reference grammar: Glucose 5 mmol/L H [исправленный результат: 50 mmol/L]'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose 5 mmol/L H (ուղղված արդյունք: 50 mmol/L)","refLow":null,"refHigh":null,"refText":null}',false,'reference grammar: Glucose 5 mmol/L H (ուղղված արդյունք: 50 mmol/L)'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose 5 mmol/L H [ուղղված արդյունք: 50 mmol/L]","refLow":null,"refHigh":null,"refText":null}',false,'reference grammar: Glucose 5 mmol/L H [ուղղված արդյունք: 50 mmol/L]'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose 5 mmol/L (3-6) [3-6]","refLow":null,"refHigh":null,"refText":null}',false,'reference grammar: Glucose 5 mmol/L (3-6) [3-6]'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose 5 mmol/L (3-6) (3-6)","refLow":null,"refHigh":null,"refText":null}',false,'reference grammar: Glucose 5 mmol/L (3-6) (3-6)'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose 5 mmol/L (3-6) corrected","refLow":null,"refHigh":null,"refText":null}',false,'reference grammar: Glucose 5 mmol/L (3-6) corrected'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose 5 mmol/L [3-6] նոր","refLow":null,"refHigh":null,"refText":null}',false,'reference grammar: Glucose 5 mmol/L [3-6] նոր'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose 5 mmol/L (3-6) 50","refLow":null,"refHigh":null,"refText":null}',false,'reference grammar: Glucose 5 mmol/L (3-6) 50'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose 5 mmol/L [3-6];","refLow":null,"refHigh":null,"refText":null}',false,'reference grammar: Glucose 5 mmol/L [3-6];'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose 5 mmol/L (ref: 3-6 result 50)","refLow":null,"refHigh":null,"refText":null}',false,'reference grammar: Glucose 5 mmol/L (ref: 3-6 result 50)'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose 5 mmol/L [норма: 3-6 измерение 50]","refLow":null,"refHigh":null,"refText":null}',false,'reference grammar: Glucose 5 mmol/L [норма: 3-6 измерение 50]'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose 5 mmol/L (նորմ: 3-6 նոր 50)","refLow":null,"refHigh":null,"refText":null}',false,'reference grammar: Glucose 5 mmol/L (նորմ: 3-6 նոր 50)'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose 5 mmol/L (repeat 50)","refLow":null,"refHigh":null,"refText":null}',false,'reference grammar: Glucose 5 mmol/L (repeat 50)'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose 5 mmol/L [result 50]","refLow":null,"refHigh":null,"refText":null}',false,'reference grammar: Glucose 5 mmol/L [result 50]'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose 5 mmol/L ()","refLow":null,"refHigh":null,"refText":null}',false,'reference grammar: Glucose 5 mmol/L ()'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose 5 mmol/L []","refLow":null,"refHigh":null,"refText":null}',false,'reference grammar: Glucose 5 mmol/L []'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose 5 mmol/L (5)","refLow":null,"refHigh":null,"refText":null}',false,'reference grammar: Glucose 5 mmol/L (5)'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose 5 mmol/L (=6)","refLow":null,"refHigh":null,"refText":null}',false,'reference grammar: Glucose 5 mmol/L (=6)'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose 5 mmol/L (~6)","refLow":null,"refHigh":null,"refText":null}',false,'reference grammar: Glucose 5 mmol/L (~6)'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose 5 mmol/L (ref: <6 50)","refLow":null,"refHigh":null,"refText":null}',false,'reference grammar: Glucose 5 mmol/L (ref: <6 50)'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose 5 mmol/L ref 3-6 50","refLow":null,"refHigh":null,"refText":null}',false,'reference grammar: Glucose 5 mmol/L ref 3-6 50'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose 5 mmol/L ref 3-6 corrected","refLow":null,"refHigh":null,"refText":null}',false,'reference grammar: Glucose 5 mmol/L ref 3-6 corrected'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose 5 mmol/L ref (3-6)","refLow":null,"refHigh":null,"refText":null}',false,'reference grammar: Glucose 5 mmol/L ref (3-6)'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose 5 mmol/L ref H 3-6","refLow":null,"refHigh":null,"refText":null}',false,'reference grammar: Glucose 5 mmol/L ref H 3-6'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose 5 mmol/L ref:: 3-6","refLow":null,"refHigh":null,"refText":null}',false,'reference grammar: Glucose 5 mmol/L ref:: 3-6'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose 5 mmol/L (3-6 mg/L)","refLow":null,"refHigh":null,"refText":null}',false,'reference grammar: Glucose 5 mmol/L (3-6 mg/L)'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose 5 mmol/L [<6 mg/L]","refLow":null,"refHigh":null,"refText":null}',false,'reference grammar: Glucose 5 mmol/L [<6 mg/L]'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose 5 mmol/L (3 mmol/L - 6 mmol/L)","refLow":null,"refHigh":null,"refText":null}',false,'reference grammar: Glucose 5 mmol/L (3 mmol/L - 6 mmol/L)'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose 5 mmol/L (3-6) H","refLow":null,"refHigh":null,"refText":null}',false,'reference grammar: Glucose 5 mmol/L (3-6) H'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose 5 mmol/L H L","refLow":null,"refHigh":null,"refText":null}',false,'reference grammar: Glucose 5 mmol/L H L'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose 5 mmol/L normal 70 to 100 mg/dL","refLow":null,"refHigh":null,"refText":null}',false,'reference grammar: Glucose 5 mmol/L normal 70 to 100 mg/dL'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose 5 mmol/L референсные 70-100","refLow":null,"refHigh":null,"refText":null}',false,'reference grammar: Glucose 5 mmol/L референсные 70-100'),
 ('{"testName":"LDL-C","catalogueRef":"ldl_c","valueText":"3.9","value":3.9,"unit":"mmol/L","snippet":"LDL-C 3.9 mmol/L (<3.0)","refLow":null,"refHigh":null,"refText":null}',true,'reference grammar: LDL-C 3.9 mmol/L (<3.0)'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"90","value":90.0,"unit":"mg/dL","snippet":"Glucose 90 mg/dL","refLow":null,"refHigh":null,"refText":null}',true,'reference grammar: Glucose 90 mg/dL'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5.6","value":5.6,"unit":"mmol/L","snippet":"Glucose 5.6 mmol/L (3.9 - 5.6 mmol/L)","refLow":null,"refHigh":null,"refText":null}',true,'reference grammar: Glucose 5.6 mmol/L (3.9 - 5.6 mmol/L)'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5.6","value":5.6,"unit":"mmol/L","snippet":"Glucose 5.6 mmol/L H [ref: 3.9-5.6]","refLow":null,"refHigh":null,"refText":null}',true,'reference grammar: Glucose 5.6 mmol/L H [ref: 3.9-5.6]'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5.6","value":5.6,"unit":"mmol/L","snippet":"Glucose 5.6 mmol/L ref 3.9 - 5.6","refLow":null,"refHigh":null,"refText":null}',true,'reference grammar: Glucose 5.6 mmol/L ref 3.9 - 5.6'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5.6","value":5.6,"unit":"mmol/L","snippet":"Glucose 5.6 mmol/L (reference: <6 mmol/L)","refLow":null,"refHigh":null,"refText":null}',true,'reference grammar: Glucose 5.6 mmol/L (reference: <6 mmol/L)'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5.6","value":5.6,"unit":"mmol/L","snippet":"Glucose 5.6 mmol/L [normal: >3.9]","refLow":null,"refHigh":null,"refText":null}',true,'reference grammar: Glucose 5.6 mmol/L [normal: >3.9]'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5.6","value":5.6,"unit":"mmol/L","snippet":"Glucose 5.6 mmol/L (range: ≤5.6)","refLow":null,"refHigh":null,"refText":null}',true,'reference grammar: Glucose 5.6 mmol/L (range: ≤5.6)'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5.6","value":5.6,"unit":"mmol/L","snippet":"Glucose 5.6 mmol/L [норма: ≥3.9]","refLow":null,"refHigh":null,"refText":null}',true,'reference grammar: Glucose 5.6 mmol/L [норма: ≥3.9]'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5.6","value":5.6,"unit":"mmol/L","snippet":"Glucose 5.6 mmol/L (референс: 3,9–5,6 ммоль/л)","refLow":null,"refHigh":null,"refText":null}',true,'reference grammar: Glucose 5.6 mmol/L (референс: 3,9–5,6 ммоль/л)'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5.6","value":5.6,"unit":"mmol/L","snippet":"Glucose 5.6 mmol/L [референсные значения: 3.9—5.6]","refLow":null,"refHigh":null,"refText":null}',true,'reference grammar: Glucose 5.6 mmol/L [референсные значения: 3.9—5.6]'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5.6","value":5.6,"unit":"mmol/L","snippet":"Glucose 5.6 mmol/L (նորմ: 3.9-5.6 մմոլ/լ)","refLow":null,"refHigh":null,"refText":null}',true,'reference grammar: Glucose 5.6 mmol/L (նորմ: 3.9-5.6 մմոլ/լ)'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5.6","value":5.6,"unit":"mmol/L","snippet":"Glucose 5.6 mmol/L [հղումային: <6]","refLow":null,"refHigh":null,"refText":null}',true,'reference grammar: Glucose 5.6 mmol/L [հղումային: <6]'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5.6","value":5.6,"unit":"mmol/L","snippet":"Glucose 5.6 mmol/L референсные значения: 3.9-5.6","refLow":null,"refHigh":null,"refText":null}',true,'reference grammar: Glucose 5.6 mmol/L референсные значения: 3.9-5.6'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5.6","value":5.6,"unit":"mmol/L","snippet":"Glucose 5.6 mmol/L норм: <6","refLow":null,"refHigh":null,"refText":null}',false,'reference grammar: Glucose 5.6 mmol/L норм: <6'),
 ('{"snippet":null}',false,'missing snippet'),
 ('{"snippet":"Haemoglobin 140"}',false,'no source unit'),
 ('{"snippet":"g/L Haemoglobin 140"}',false,'unit before number'),
 ('{"snippet":"Haemoglobin 1140 g/L"}',false,'different printed number'),
 ('{"snippet":"Haemoglobin 140 g/L (g/dL)"}',false,'conflicting source units'),
 ('{"snippet":"Haemoglobin 140 g/L (14g/dL)"}',false,'compact conflicting source units'),
 ('{"snippet":"Haemoglobin 140 g/Litre"}',false,'unit prefix is not a token'),
 ('{"testName":"HOMA-IR","catalogueRef":"homa_ir","valueText":"2","value":2,"unit":null,"snippet":"HOMA-IR 2"}',false,'dimensionless value has no source unit'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"18.018017","value":18.018017,"unit":"mg/dL"}',false,'below printed glucose window'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"1081.081083","value":1081.081083,"unit":"mg/dL"}',false,'above printed glucose window'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"18.018018","value":18.018018,"unit":"mg/dL"}',false,'inside printed glucose window but outside canonical window'),
 ('{"testName":"HbA1c","catalogueRef":"hba1c","valueText":"9.269784","value":9.269784,"unit":"mmol/mol"}',false,'below printed HbA1c window'),
 ('{"testName":"HbA1c","catalogueRef":"hba1c","valueText":"195.102756","value":195.102756,"unit":"mmol/mol"}',false,'above printed HbA1c window'),
 ('{"testName":"Creatinine","catalogueRef":"creatinine","valueText":"0.113121","value":0.113121,"unit":"mg/dL"}',false,'below printed creatinine window'),
 ('{"testName":"Creatinine","catalogueRef":"creatinine","valueText":"33.936653","value":33.936653,"unit":"mg/dL"}',false,'above printed creatinine window'),
 ('{"testName":"Creatinine","catalogueRef":"creatinine","valueText":"90","value":90,"unit":"µmol/L","snippet":"Creatinine 90 мкмоль/л"}',true,'Russian source unit'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5.5","value":5.5,"unit":"mmol/L","snippet":"Glucose 5,5 մմոլ/լ"}',true,'Armenian source unit'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"90","value":90,"unit":"mg/dL","snippet":"Glucose 90mg／dL"}',true,'compact unit and fullwidth slash'),
 ('{"testName":"Գլյուկոզա","catalogueRef":"fasting_glucose","valueText":"5.5","value":5.5,"unit":"mmol/L","snippet":"ԳԼՅՈՒԿՈԶԱ 5,5 մմոլ/լ"}',true,'Armenian name and comma decimal'),
 ('{"testName":"Глюкоза","catalogueRef":"fasting_glucose","valueText":"5.5","value":5.5,"unit":"mmol/L","snippet":"ГЛЮКОЗА 5,5 ммоль/л"}',true,'Russian name and comma decimal'),
 ('{"testName":"Lp(a)","catalogueRef":"lpa","valueText":"100","value":100,"unit":"nmol/L","snippet":"LP(A) 100 nmol/L"}',true,'literal parentheses in name'),
 ('{"testName":"Glucose (serum)+","catalogueRef":"fasting_glucose","valueText":"5","value":5,"unit":"mmol/L","snippet":"Glucose (serum)+ 5 mmol/L"}',true,'literal regex characters in name'),
 ('{"testName":"25(OH)D","catalogueRef":"vitamin_d","valueText":"30","value":30,"unit":"ng/mL","snippet":"25(OH)D 30 ng/mL"}',true,'digits and parentheses belong to the name'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose reference: 5 mmol/L; result: 50 mmol/L"}',false,'structural source: Glucose reference: 5 mmol/L; result: 50 mmol/L'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"3","value":3.0,"unit":"mmol/L","snippet":"Glucose 3 mmol/L - 5 mmol/L; result 50 mmol/L"}',false,'structural source: Glucose 3 mmol/L - 5 mmol/L; result 50 mmol/L'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose result: 5 mmol/L"}',false,'structural source: Glucose result: 5 mmol/L'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose ref 5 mmol/L"}',false,'structural source: Glucose ref 5 mmol/L'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose норма 5 mmol/L"}',false,'structural source: Glucose норма 5 mmol/L'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose референс 5 mmol/L"}',false,'structural source: Glucose референс 5 mmol/L'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose արդյունք 5 mmol/L"}',false,'structural source: Glucose արդյունք 5 mmol/L'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose նորմ 5 mmol/L"}',false,'structural source: Glucose նորմ 5 mmol/L'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose: 5 mmol/L"}',false,'structural source: Glucose: 5 mmol/L'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose = 5 mmol/L"}',false,'structural source: Glucose = 5 mmol/L'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"3","value":3.0,"unit":"mmol/L","snippet":"Glucose 3 mmol/L – 5 mmol/L"}',false,'structural source: Glucose 3 mmol/L – 5 mmol/L'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"3","value":3.0,"unit":"mmol/L","snippet":"Glucose 3 mmol/L — 5 mmol/L"}',false,'structural source: Glucose 3 mmol/L — 5 mmol/L'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"3","value":3.0,"unit":"mmol/L","snippet":"Glucose 3 mmol/L to 5 mmol/L"}',false,'structural source: Glucose 3 mmol/L to 5 mmol/L'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"3","value":3.0,"unit":"mmol/L","snippet":"Glucose 3 mmol/L до 5 mmol/L"}',false,'structural source: Glucose 3 mmol/L до 5 mmol/L'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"3","value":3.0,"unit":"mmol/L","snippet":"Glucose 3 mmol/L մինչև 5 mmol/L"}',false,'structural source: Glucose 3 mmol/L մինչև 5 mmol/L'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose 5 mmol/L; result: 50 mmol/L"}',false,'structural source: Glucose 5 mmol/L; result: 50 mmol/L'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5.6","value":5.6,"unit":"mmol/L","snippet":"Glucose 5.6 mmol/L 3.9 - 5.6 mmol/L"}',false,'structural source: Glucose 5.6 mmol/L 3.9 - 5.6 mmol/L'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose 5 mmol/L H 50 mmol/L"}',false,'structural source: Glucose 5 mmol/L H 50 mmol/L'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose 5 mmol/L (3-6); 50 mmol/L"}',false,'structural source: Glucose 5 mmol/L (3-6); 50 mmol/L'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose 5 mmol/L; reference 3-6; result 50 mmol/L"}',false,'structural source: Glucose 5 mmol/L; reference 3-6; result 50 mmol/L'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose 5 mmol/L; reference result 50 mmol/L"}',false,'structural source: Glucose 5 mmol/L; reference result 50 mmol/L'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose 5 mmol/L (3-6"}',false,'structural source: Glucose 5 mmol/L (3-6'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose 5 mmol/L [3-6)"}',false,'structural source: Glucose 5 mmol/L [3-6)'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"90","value":90,"unit":"mg/dL","snippet":"Glucose 90 mg/dL H"}',true,'explicit reference or status: H'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"90","value":90,"unit":"mg/dL","snippet":"Glucose 90 mg/dL L"}',true,'explicit reference or status: L'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"90","value":90,"unit":"mg/dL","snippet":"Glucose 90 mg/dL HH"}',true,'explicit reference or status: HH'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"90","value":90,"unit":"mg/dL","snippet":"Glucose 90 mg/dL LL"}',true,'explicit reference or status: LL'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"90","value":90,"unit":"mg/dL","snippet":"Glucose 90 mg/dL ↑"}',true,'explicit reference or status: ↑'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"90","value":90,"unit":"mg/dL","snippet":"Glucose 90 mg/dL ↓"}',true,'explicit reference or status: ↓'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"90","value":90,"unit":"mg/dL","snippet":"Glucose 90 mg/dL *"}',true,'explicit reference or status: *'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"90","value":90,"unit":"mg/dL","snippet":"Glucose 90 mg/dL high"}',true,'explicit reference or status: high'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"90","value":90,"unit":"mg/dL","snippet":"Glucose 90 mg/dL low"}',true,'explicit reference or status: low'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"90","value":90,"unit":"mg/dL","snippet":"Glucose 90 mg/dL выше"}',true,'explicit reference or status: выше'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"90","value":90,"unit":"mg/dL","snippet":"Glucose 90 mg/dL ниже"}',true,'explicit reference or status: ниже'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"90","value":90,"unit":"mg/dL","snippet":"Glucose 90 mg/dL բարձր"}',true,'explicit reference or status: բարձր'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"90","value":90,"unit":"mg/dL","snippet":"Glucose 90 mg/dL ցածր"}',true,'explicit reference or status: ցածր'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"90","value":90,"unit":"mg/dL","snippet":"Glucose 90 mg/dL [70-100]"}',true,'explicit reference or status: [70-100]'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"90","value":90,"unit":"mg/dL","snippet":"Glucose 90 mg/dL H (70-100)"}',true,'explicit reference or status: H (70-100)'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"90","value":90,"unit":"mg/dL","snippet":"Glucose 90 mg/dL H; ref: 70-100 mg/dL"}',true,'explicit reference or status: H; ref: 70-100 mg/dL'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"90","value":90,"unit":"mg/dL","snippet":"Glucose 90 mg/dL reference 70 - 100 mg/dL"}',true,'explicit reference or status: reference 70 - 100 mg/dL'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"90","value":90,"unit":"mg/dL","snippet":"Glucose 90 mg/dL normal 70 to 100 mg/dL"}',false,'explicit reference or status: normal 70 to 100 mg/dL'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"90","value":90,"unit":"mg/dL","snippet":"Glucose 90 mg/dL range 70-100"}',true,'explicit reference or status: range 70-100'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"90","value":90,"unit":"mg/dL","snippet":"Glucose 90 mg/dL норма 70-100"}',true,'explicit reference or status: норма 70-100'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"90","value":90,"unit":"mg/dL","snippet":"Glucose 90 mg/dL референс 70-100"}',true,'explicit reference or status: референс 70-100'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"90","value":90,"unit":"mg/dL","snippet":"Glucose 90 mg/dL референсные 70-100"}',false,'explicit reference or status: референсные 70-100'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"90","value":90,"unit":"mg/dL","snippet":"Glucose 90 mg/dL նորմ 70-100"}',true,'explicit reference or status: նորմ 70-100'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"90","value":90,"unit":"mg/dL","snippet":"Glucose 90 mg/dL հղումային 70-100"}',true,'explicit reference or status: հղումային 70-100');
-- All catalogue-window endpoints are also tested below with the database guard itself.
grant select on auto_cases to service_role,authenticated;
update public.lab_ai_capabilities set auto_accept_enabled=true where singleton;
select pg_temp.as_service();
set local role service_role;
select pg_temp.ok((pg_temp.finish(12,(select jsonb_agg(pg_temp.value(delta)order by seq)from auto_cases))->>'autoAccepted')::int=(select count(*)from auto_cases where accepted),'database accepts exactly the eligible proposals');
select pg_temp.ok((pg_temp.finish(13,jsonb_build_array(pg_temp.value()),'mismatch')->>'autoAccepted')::int=0,'identity mismatch blocks');
select pg_temp.ok((pg_temp.finish(14,jsonb_build_array(pg_temp.value()),'unknown')->>'autoAccepted')::int=0,'identity unknown blocks despite visit date');
reset role;
select pg_temp.ok((pg_temp.v(12,1)).status='auto_accepted'and(pg_temp.v(12,1)).auto_accepted_at is not null and(pg_temp.v(12,1)).auto_accept_rule='lab-auto-accept-v2'
 and(pg_temp.v(12,1)).reviewed_by is null,'system provenance, no doctor recorded');
select pg_temp.ok((select bool_and(v.status=case when c.accepted then 'auto_accepted'else 'unverified'end)
 from auto_cases c join public.lab_ai_values v on v.id=(pg_temp.v(12,c.seq)).id),'every safeguard has the expected status');
select pg_temp.ok((select count(*)from public.lab_ai_auto_confirmations where job_id=(pg_temp.job(12)).id)=(select count(*)from auto_cases where accepted),'one audit event per transition');
select pg_temp.ok((select bool_and(event='lab_value_auto_confirmed'and rule_version='lab-auto-accept-v2')from public.lab_ai_auto_confirmations where job_id=(pg_temp.job(12)).id),'event name and rule version recorded');
select pg_temp.ok((select count(*)from public.lab_ai_auto_confirmations where job_id in((pg_temp.job(11)).id,(pg_temp.job(13)).id,(pg_temp.job(14)).id))=0,'no events when disabled or unmatched');

select pg_temp.ok(public._lab_ai_auto_unit('µmol/L')='umol/l','micro unit normalization');
select pg_temp.ok(public._lab_ai_auto_unit('մկմոլ/լ')='umol/l','Armenian unit normalization');
select pg_temp.ok(public._lab_ai_auto_unit('ммоль/л')='mmol/l','Russian unit normalization');
select pg_temp.ok(public._lab_ai_auto_unit('10×9/L')<>'10^9/l','unrecognized multiplier is not invented');
select pg_temp.ok(public._lab_ai_auto_unit('×10^9/L')='10^9/l','cell count normalization');
select pg_temp.ok(public._lab_ai_auto_unit('mL/min/1.73m²')='ml/min/1.73m2','eGFR normalization');
select pg_temp.ok(pg_temp.raises('update public.lab_ai_auto_confirmations set rule_version=rule_version','55000'),'system audit is append-only');
-- The database applies every analyte's inclusive window, not only the examples above.
do $$
declare r record;v public.lab_ai_values;n numeric;
begin
 for r in select * from(values
 ('total_cholesterol','Total cholesterol','mmol/l',1,20),
 ('hdl_c','HDL-C','mmol/l',0.1,5),
 ('ldl_c','LDL-C','mmol/l',0.1,15),
 ('non_hdl_c','non-HDL-C','mmol/l',0.1,20),
 ('triglycerides','Triglycerides','mmol/l',0.1,50),
 ('apob','ApoB','g/l',0.1,5),
 ('lpa','Lp(a)','nmol/l',0,1000),
 ('hba1c','HbA1c','%',3,20),
 ('fasting_glucose','Fasting glucose','mmol/l',1,60),
 ('insulin','Fasting insulin','uiu/ml',0.1,1000),
 ('homa_ir','HOMA-IR','',0,100),
 ('c_peptide','C-peptide','ng/ml',0,50),
 ('creatinine','Creatinine','umol/l',10,3000),
 ('egfr','eGFR','ml/min/1.73m2',1,200),
 ('uacr','Urine albumin/creatinine ratio','mg/mmol',0,5000),
 ('urea','Urea','mmol/l',0.5,100),
 ('alt','ALT','u/l',1,10000),
 ('ast','AST','u/l',1,10000),
 ('ggt','GGT','u/l',1,10000),
 ('alp','ALP','u/l',1,10000),
 ('bilirubin_total','Total bilirubin','umol/l',0.5,1000),
 ('hemoglobin','Haemoglobin','g/l',20,250),
 ('wbc','White blood cells','10^9/l',0.1,500),
 ('platelets','Platelets','10^9/l',1,3000),
 ('ferritin','Ferritin','ng/ml',1,100000),
 ('esr','ESR','mm/h',0,200),
 ('crp','CRP','mg/l',0,500),
 ('fibrinogen','Fibrinogen','g/l',0.1,15),
 ('tsh','TSH','miu/l',0.001,500),
 ('free_t4','Free T4','pmol/l',1,200),
 ('anti_tpo','Anti-TPO','iu/ml',0,10000),
 ('uric_acid','Uric acid','umol/l',30,2000),
 ('homocysteine','Homocysteine','umol/l',1,500),
 ('vitamin_d','Vitamin D (25-OH)','ng/ml',1,300),
 ('vitamin_b12','Vitamin B12','pg/ml',10,5000),
 ('folate','Folate','ng/ml',0.5,100),
 -- Alternative units use six-decimal endpoints inside the canonical window.
 ('total_cholesterol','Total cholesterol','mg/dl',38.669761,773.395204),
 ('hdl_c','HDL-C','mg/dl',3.866977,193.348801),
 ('ldl_c','LDL-C','mg/dl',3.866977,580.046403),
 ('non_hdl_c','non-HDL-C','mg/dl',3.866977,773.395204),
 ('triglycerides','Triglycerides','mg/dl',8.857396,4428.697962),
 ('apob','ApoB','mg/dl',10.000000,500.000000),
 ('hba1c','HbA1c','mmol/mol',9.269786,195.102754),
 ('fasting_glucose','Fasting glucose','mg/dl',18.018019,1081.081081),
 ('insulin','Fasting insulin','mu/l',0.100000,1000.000000),
 ('insulin','Fasting insulin','pmol/l',0.600001,6000.000000),
 ('c_peptide','C-peptide','nmol/l',0.000000,16.550000),
 ('creatinine','Creatinine','mg/dl',0.113123,33.936651),
 ('egfr','eGFR','ml/min',1.000000,200.000000),
 ('uacr','Urine albumin/creatinine ratio','mg/g',0.000000,44247.787610),
 ('urea','Urea','mg/dl',3.003004,600.600600),
 ('bilirubin_total','Total bilirubin','mg/dl',0.029240,58.479532),
 ('hemoglobin','Haemoglobin','g/dl',2.000000,25.000000),
 ('wbc','White blood cells','10^3/ul',0.100000,500.000000),
 ('platelets','Platelets','10^3/ul',1.000000,3000.000000),
 ('ferritin','Ferritin','ug/l',1.000000,100000.000000),
 ('crp','CRP','mg/dl',0.000000,50.000000),
 ('fibrinogen','Fibrinogen','mg/dl',10.000000,1500.000000),
 ('tsh','TSH','uiu/ml',0.001000,500.000000),
 ('free_t4','Free T4','ng/dl',0.077701,15.540015),
 ('anti_tpo','Anti-TPO','u/ml',0.000000,10000.000000),
 ('uric_acid','Uric acid','mg/dl',0.504372,33.624747),
 ('vitamin_d','Vitamin D (25-OH)','nmol/l',2.500000,750.000000),
 ('vitamin_b12','Vitamin B12','pmol/l',7.380074,3690.036900),
 ('folate','Folate','nmol/l',1.133787,226.757369)
 )a(key,name,unit,lo,hi)loop
  foreach n in array array[r.lo,r.hi]loop
   v:=pg_temp.v(12,1);v.catalogue_ref:=r.key;v.test_name:=r.name;v.unit:=nullif(r.unit,'');v.value:=n;v.value_text:=n::text;
   v.snippet:=concat_ws(' ',r.name,n::text,nullif(r.unit,''));
   v.attention:=null;v.attention_rule:=null;v.lab_flag:=null;v.ref_low:=null;v.ref_high:=null;v.ref_text:=null;
   perform pg_temp.ok(public._lab_ai_auto_accept_ok(v)=(r.unit<>''),r.key||' inclusive boundary '||n);
  end loop;
  foreach n in array array[r.lo-0.000001,r.hi+0.000001]loop
   v.value:=n;v.value_text:=n::text;v.snippet:=concat_ws(' ',r.name,n::text,nullif(r.unit,''));
   perform pg_temp.ok(not public._lab_ai_auto_accept_ok(v),r.key||' outside boundary '||n);
  end loop;
  v.unit:='unrecognized';v.value:=r.lo;v.value_text:=r.lo::text;
  perform pg_temp.ok(not public._lab_ai_auto_accept_ok(v),r.key||' unknown unit');
 end loop;
end$$;
-- Replaying finish must not duplicate any transition or audit event.
select pg_temp.as_service();
set local role service_role;
select pg_temp.ok(pg_temp.finish(12,'[]')->>'replayed'='true','finish replay is idempotent');
reset role;
select pg_temp.ok((select count(*)from public.lab_ai_auto_confirmations where job_id=(pg_temp.job(12)).id)=(select count(*)from auto_cases where accepted),'audit count unchanged after replay');

-- 3. No other route: the guard re-checks eligibility and keeps provenance.
select pg_temp.ok(pg_temp.raises(format($q$update public.lab_ai_values set status='auto_accepted',auto_accepted_at=now(),auto_accept_rule='lab-auto-accept-v2' where id=%L$q$,(pg_temp.v(12,14)).id)),'an implausible value cannot be marked auto-confirmed');
select pg_temp.ok(pg_temp.raises(format($q$update public.lab_ai_values set status='auto_accepted',auto_accepted_at=now(),auto_accept_rule='lab-auto-accept-v2' where id=%L$q$,(pg_temp.v(13,1)).id)),'a value on an unmatched sheet cannot be marked auto-accepted');
select pg_temp.ok(pg_temp.raises(format($q$update public.lab_ai_values set status='auto_accepted',auto_accepted_at=now(),auto_accept_rule='lab-auto-accept-v2' where id=%L$q$,(pg_temp.v(12,4)).id)),'an eligible value is not marked outside lab_ai_job_finish');
select pg_temp.ok(pg_temp.raises(format($q$update public.lab_ai_values set status='auto_accepted',auto_accepted_at=now(),auto_accept_rule='lab-auto-accept-v2' where id=%L$q$,(pg_temp.v(12,26)).id)),'a value without a unit cannot be marked auto-accepted');
select pg_temp.ok(pg_temp.raises(format($q$update public.lab_ai_values set auto_accepted_at=now() where id=%L$q$,(pg_temp.v(12,1)).id),'55000'),'acceptance time is kept');
select pg_temp.ok(pg_temp.raises(format($q$update public.lab_ai_values set status='unverified',auto_accepted_at=null,auto_accept_rule=null where id=%L$q$,(pg_temp.v(12,1)).id),'55000'),'acceptance is not undone');
select pg_temp.ok(pg_temp.raises($q$insert into public.lab_ai_values(job_id,user_id,file_id,attachment_id,seq,test_name,value_text,page,status,auto_accepted_at,auto_accept_rule)
 select job_id,user_id,file_id,attachment_id,99,'X','1',1,'auto_accepted',now(),'lab-auto-accept-v2'from public.lab_ai_values limit 1$q$),'no value is born auto-accepted');
select pg_temp.as_user(4);
set local role authenticated;
select pg_temp.ok(pg_temp.raises('select * from public.lab_ai_values'),'the member cannot read values');
select pg_temp.ok(pg_temp.raises('select * from public.lab_ai_auto_confirmations'),'the member cannot read system audit rows');
reset role;

-- 4. The doctor sees them and can still review; counts separate them from values waiting.
select pg_temp.as_user(2);
set local role authenticated;
select pg_temp.ok((select v->>'status'from jsonb_array_elements(public.doctor_lab_ai_read('a5c00000-0000-4000-8000-000000000004','a5c00000-0000-4000-8000-000000000112')->'values')v where (v->>'seq')::int=1)='auto_accepted','the doctor reads the status');
select pg_temp.ok((select (f->'counts'->>'autoAccepted')::int=(select count(*)from auto_cases where accepted) and(f->'counts'->>'unverified')::int=(select count(*)from auto_cases where not accepted) and(f->'counts'->>'verified')::int=0
 from jsonb_array_elements(public.doctor_lab_ai_overview('a5c00000-0000-4000-8000-000000000004')->'files')f where f->>'fileId'='a5c00000-0000-4000-8000-000000000112'),'counts separate system confirmation from exceptions');
reset role;
insert into public.patient_document_opens(user_id,file_id,attachment_id,actor_id,actor_kind)select j.user_id,j.file_id,j.attachment_id,'a5c00000-0000-4000-8000-000000000002','doctor'from pg_temp.job(12)j;
select pg_temp.as_user(2);
set local role authenticated;
select pg_temp.ok(pg_temp.review('01',(pg_temp.v(12,1)).id,'confirm')->>'valueStatus'='verified','the doctor confirms an accepted value');
select pg_temp.ok(pg_temp.review('03',(pg_temp.v(12,3)).id,'reject')->>'valueStatus'='rejected','doctor rejects an auto value');
select pg_temp.ok(pg_temp.review('02',(pg_temp.v(12,2)).id,'correct','{"value":139}')->>'valueStatus'='corrected','the doctor corrects an accepted value');
reset role;
select pg_temp.ok((select count(*)from public.lab_ai_value_reviews where value_id in((pg_temp.v(12,1)).id,(pg_temp.v(12,2)).id,(pg_temp.v(12,3)).id)and before->>'status'='auto_accepted')=3,'confirm, correct and reject each record the replaced auto confirmation');
select pg_temp.ok((pg_temp.v(12,1)).auto_accepted_at is not null and(pg_temp.v(12,1)).reviewed_by='a5c00000-0000-4000-8000-000000000002','provenance kept after the doctor confirms');
select pg_temp.ok(pg_temp.raises(format($q$update public.lab_ai_values set status='auto_accepted',reviewed_by=null,reviewed_at=null where id=%L$q$,(pg_temp.v(12,1)).id),'55000'),'a doctor review is not turned back into automatic acceptance');
-- Exercise the actual publication trigger against current rows on an AI-prepared draft.
-- The probe needs only user_id because that is the trigger's complete NEW-row input.
create temporary table publication_probe(user_id uuid);
create trigger publication_probe before insert on publication_probe for each row execute function public._clinical_publication_lab_check();
-- A doctor-written draft has no AI dependency; its source receipts are checked by the publisher.
savepoint manual_publication;
update public.lab_ai_capabilities set auto_accept_enabled=false where singleton;
select pg_temp.ok((select draft_lab_token is null from public.patient_clinical_cases where user_id='a5c00000-0000-4000-8000-000000000004'),'manual draft has no AI lab token');
insert into publication_probe values('a5c00000-0000-4000-8000-000000000004');
select pg_temp.ok((select count(*)from publication_probe)=1,'manual draft retains the null-token early return');
rollback to manual_publication;
select pg_temp.ok(pg_temp.raises($q$insert into publication_probe values('a5c00000-0000-4000-8000-000000000004')$q$,'40001'),'switch on: unverified current values also block a null-token draft');
-- With the switch off, match main exactly: compare a present token, without a status filter.
savepoint disabled_publication;
update public.lab_ai_capabilities set auto_accept_enabled=false where singleton;
update public.patient_clinical_cases set draft_lab_token=public._ai_plan_lab_token(user_id)where user_id='a5c00000-0000-4000-8000-000000000004';
select pg_temp.ok(exists(select 1 from public.lab_ai_values where user_id='a5c00000-0000-4000-8000-000000000004'and status='unverified'),'switch-off fixture retains unverified values');
insert into publication_probe values('a5c00000-0000-4000-8000-000000000004');
select pg_temp.ok((select count(*)from publication_probe)=1,'switch off: matching draft token passes despite unverified values, as on main');
update public.patient_clinical_cases set draft_lab_token='synthetic-stale-token'where user_id='a5c00000-0000-4000-8000-000000000004';
select pg_temp.ok(pg_temp.raises($q$insert into publication_probe values('a5c00000-0000-4000-8000-000000000004')$q$,'40001'),'switch off: stale draft token still blocks, as on main');
rollback to disabled_publication;
select pg_temp.ok((select auto_accept_enabled from public.lab_ai_capabilities where singleton),'switch on restored for unresolved-value assertions');
update public.patient_clinical_cases set draft_lab_token=public._ai_plan_lab_token(user_id)where user_id='a5c00000-0000-4000-8000-000000000004';
select pg_temp.ok(pg_temp.raises($q$insert into publication_probe values('a5c00000-0000-4000-8000-000000000004')$q$,'40001'),'unverified current values block an AI-prepared publication');
-- Clear every exception through the doctor's real review RPC, including mismatched-sheet identity first.
insert into public.patient_document_opens(user_id,file_id,attachment_id,actor_id,actor_kind)
 select j.user_id,j.file_id,j.attachment_id,'a5c00000-0000-4000-8000-000000000002','doctor'from public.lab_ai_jobs j
 where j.id in((pg_temp.job(11)).id,(pg_temp.job(13)).id,(pg_temp.job(14)).id);
select pg_temp.as_user(2);
set local role authenticated;
select pg_temp.ok(public.doctor_lab_ai_identity_confirm(jsonb_build_object('version','lab-ai-identity-v1','memberId','a5c00000-0000-4000-8000-000000000004','jobId',(pg_temp.job(13)).id,'note','Synthetic PDF identity check'))->>'status'='confirmed','doctor overrides mismatch for review only');
select pg_temp.ok(public.doctor_lab_ai_identity_confirm(jsonb_build_object('version','lab-ai-identity-v1','memberId','a5c00000-0000-4000-8000-000000000004','jobId',(pg_temp.job(14)).id))->>'status'='confirmed','doctor confirms unknown sheet for review only');
reset role;
select pg_temp.ok(not public._lab_ai_auto_accept_ok(pg_temp.v(13,1)),'doctor identity override never makes automatic confirmation eligible');
select pg_temp.as_user(2);
set local role authenticated;
do $$
declare v public.lab_ai_values;r jsonb;n int;
begin
 -- Read ids through the granted fixture helper, not through the private table.
 for n in select seq from auto_cases loop
  v:=pg_temp.v(12,n);
  if v.status='unverified'then
   r:=public.doctor_lab_ai_value_review(jsonb_build_object('version','lab-ai-review-v1','submissionId',gen_random_uuid(),'memberId',v.user_id,'valueId',v.id,'action','reject'));
   perform pg_temp.ok(r->>'status'='saved','doctor clears exception');
  end if;
 end loop;
 foreach n in array array[11,13,14]loop
  v:=pg_temp.v(n,1);
  r:=public.doctor_lab_ai_value_review(jsonb_build_object('version','lab-ai-review-v1','submissionId',gen_random_uuid(),'memberId',v.user_id,'valueId',v.id,'action','reject'));
  perform pg_temp.ok(r->>'status'='saved','doctor clears other-sheet exception');
 end loop;
end$$;
reset role;
select pg_temp.ok((select count(*)from public.lab_ai_values where user_id='a5c00000-0000-4000-8000-000000000004'and status='auto_accepted')>0,'system-confirmed values still exist');
-- Refresh the AI draft's fixture token after the doctor's reviews changed the source.
update public.patient_clinical_cases set draft_lab_token=public._ai_plan_lab_token(user_id)where user_id='a5c00000-0000-4000-8000-000000000004';
insert into publication_probe values('a5c00000-0000-4000-8000-000000000004');
select pg_temp.ok((select count(*)from publication_probe)=1,'remaining auto-confirmed values do not block the publication lab guard');
savepoint confirmed_manual_publication;
update public.patient_clinical_cases set draft_lab_token=null where user_id='a5c00000-0000-4000-8000-000000000004';
insert into publication_probe values('a5c00000-0000-4000-8000-000000000004');
select pg_temp.ok((select count(*)from publication_probe)=2,'switch on: auto-confirmed values also pass for a null-token draft');
rollback to confirmed_manual_publication;
update public.patient_clinical_cases set draft_lab_token='synthetic-stale-token'where user_id='a5c00000-0000-4000-8000-000000000004';
select pg_temp.ok(pg_temp.raises($q$insert into publication_probe values('a5c00000-0000-4000-8000-000000000004')$q$,'40001'),'switch on: auto-confirmation never bypasses draft freshness');
-- Separate switch-on job: the original 199-case batch stays within the 200-value limit.
create temporary table table_cases(seq int generated always as identity,delta jsonb,accepted boolean,label text);
insert into table_cases(delta,accepted,label)values
 ('{"testName":"HDL cholesterol","catalogueRef":"hdl_c","valueText":"1.2","value":1.2,"unit":"mmol/L","snippet":"HDL cholesterol 1.2 mmol/L > 1.0","refLow":1,"refHigh":null,"refText":"> 1.0","labFlag":null,"attention":null,"attentionRule":null}',true,'table grammar: HDL cholesterol 1.2 mmol/L > 1.0'),
 ('{"testName":"LDL cholesterol","catalogueRef":"ldl_c","valueText":"3.7","value":3.7,"unit":"mmol/L","snippet":"LDL cholesterol 3.7 mmol/L < 3.0","refLow":null,"refHigh":3,"refText":"< 3.0","labFlag":null,"attention":"needs_doctor","attentionRule":null}',true,'table grammar: LDL cholesterol 3.7 mmol/L < 3.0'),
 ('{"testName":"Total cholesterol","catalogueRef":"total_cholesterol","valueText":"5.6","value":5.6,"unit":"mmol/L","snippet":"Total cholesterol 5.6 mmol/L < 5.2","refLow":null,"refHigh":5.2,"refText":"< 5.2","labFlag":null,"attention":"needs_doctor","attentionRule":null}',true,'table grammar: Total cholesterol 5.6 mmol/L < 5.2'),
 ('{"testName":"Triglycerides","catalogueRef":"triglycerides","valueText":"1.6","value":1.6,"unit":"mmol/L","snippet":"Triglycerides 1.6 mmol/L < 1.7","refLow":null,"refHigh":1.7,"refText":"< 1.7","labFlag":null,"attention":null,"attentionRule":null}',true,'table grammar: Triglycerides 1.6 mmol/L < 1.7'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose 5 mmol/L 3 - 5 mmol/L; result 50 mmol/L","refLow":3,"refHigh":5,"refText":"3 - 5","labFlag":null,"attention":null,"attentionRule":null}',false,'table grammar: Glucose 5 mmol/L 3 - 5 mmol/L; result 50 mmol/L'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose 5 mmol/L < 3.0","refLow":null,"refHigh":6.1,"refText":"< 6.1","labFlag":null,"attention":null,"attentionRule":null}',false,'table grammar: Glucose 5 mmol/L < 3.0'),
 ('{"testName":"LDL","catalogueRef":"ldl_c","valueText":"3.7","value":3.7,"unit":"mmol/L","snippet":"LDL 3.7 mmol/L < 3.0 (corrected 50 mmol/L)","refLow":null,"refHigh":3,"refText":"< 3.0","labFlag":null,"attention":"needs_doctor","attentionRule":null}',false,'table grammar: LDL 3.7 mmol/L < 3.0 (corrected 50 mmol/L)'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose 5 mmol/L 50","refLow":null,"refHigh":null,"refText":null,"labFlag":null,"attention":null,"attentionRule":null}',false,'table grammar: Glucose 5 mmol/L 50'),
 -- Missing reference text is stored as null, never the constraint-invalid empty string.
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose 5 mmol/L < 6.1","refLow":null,"refHigh":null,"refText":null,"labFlag":null,"attention":null,"attentionRule":null}',false,'table grammar: Glucose 5 mmol/L < 6.1'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose 5 mmol/L H 3.0—6.1 MMOL / L","refLow":3,"refHigh":6.1,"refText":" 3,0 – 6,1 ","labFlag":null,"attention":null,"attentionRule":null}',true,'table grammar: Glucose 5 mmol/L H 3.0—6.1 MMOL / L'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose 5 mmol/L 3–6","refLow":3,"refHigh":6,"refText":"3 - 6","labFlag":null,"attention":null,"attentionRule":null}',true,'table grammar: Glucose 5 mmol/L 3–6'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose 5 mmol/L <6.1","refLow":null,"refHigh":6.1,"refText":"< 6.1","labFlag":null,"attention":null,"attentionRule":null}',true,'table grammar: Glucose 5 mmol/L <6.1'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose 5 mmol/L ≤ 6.1","refLow":null,"refHigh":6.1,"refText":"≤ 6.1","labFlag":null,"attention":null,"attentionRule":null}',true,'table grammar: Glucose 5 mmol/L ≤ 6.1'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose 5 mmol/L ≤ 6.1","refLow":null,"refHigh":6.1,"refText":"< 6.1","labFlag":null,"attention":null,"attentionRule":null}',false,'table grammar: Glucose 5 mmol/L ≤ 6.1'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose 5 mmol/L < 6.1 mg/L","refLow":null,"refHigh":6.1,"refText":"< 6.1","labFlag":null,"attention":null,"attentionRule":null}',false,'table grammar: Glucose 5 mmol/L < 6.1 mg/L'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose 5 mmol/L < 6.1 corrected","refLow":null,"refHigh":6.1,"refText":"< 6.1 corrected","labFlag":null,"attention":null,"attentionRule":null}',false,'table grammar: Glucose 5 mmol/L < 6.1 corrected'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose reference: 5 mmol/L < 6.1; result: 50 mmol/L","refLow":null,"refHigh":6.1,"refText":"< 6.1","labFlag":null,"attention":null,"attentionRule":null}',false,'table grammar: Glucose reference: 5 mmol/L < 6.1; result: 50 mmol/L'),
 ('{"testName":"Glucose","catalogueRef":"fasting_glucose","valueText":"5","value":5.0,"unit":"mmol/L","snippet":"Glucose 5 mmol/L H (corrected result: 50 mmol/L)","refLow":null,"refHigh":6.1,"refText":"< 6.1","labFlag":null,"attention":null,"attentionRule":null}',false,'table grammar: Glucose 5 mmol/L H (corrected result: 50 mmol/L)');
grant select on table_cases to service_role;
select pg_temp.ok((select auto_accept_enabled from public.lab_ai_capabilities where singleton),'table rows: switch is on');
select pg_temp.attach(15,41);
select pg_temp.as_service();
set local role service_role;
select pg_temp.ok(jsonb_array_length(public.lab_ai_job_claim(5))=1,'table rows: one job claimed');
select pg_temp.ok((pg_temp.finish(15,(select jsonb_agg(pg_temp.value(delta)order by seq)from table_cases))->>'autoAccepted')::int=(select count(*)from table_cases where accepted),'table rows: exactly eligible proposals confirm');
reset role;
select pg_temp.ok((select count(*)from table_cases c join public.lab_ai_values v on v.id=(pg_temp.v(15,c.seq)).id)=18,'table rows: every fixture stored');
select pg_temp.ok((select bool_and(v.status=case when c.accepted then 'auto_accepted'else 'unverified'end)
 from table_cases c join public.lab_ai_values v on v.id=(pg_temp.v(15,c.seq)).id),'table rows: each fixture has the expected status');
select pg_temp.ok((select bool_and(v.ref_low is not distinct from (c.delta->>'refLow')::numeric
 and v.ref_high is not distinct from (c.delta->>'refHigh')::numeric
 and v.attention is not distinct from c.delta->>'attention' and v.lab_flag is null)
 from table_cases c join public.lab_ai_values v on v.id=(pg_temp.v(15,c.seq)).id),'table rows: reference bounds and clinical attention retained');
select pg_temp.ok((select count(*)from public.lab_ai_auto_confirmations where job_id=(pg_temp.job(15)).id)=(select count(*)from table_cases where accepted),'table rows: one audit event per confirmation');
rollback;
\echo 'lab auto-accept SQL checks passed'
