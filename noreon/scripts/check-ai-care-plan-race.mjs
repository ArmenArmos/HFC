// Fictional parallel transactions for saving AI-prepared text (Codex #280 F2). A lab review, correction or
// detachment and save_patient_clinical_draft_from_ai must serialize: a change that commits first refuses the
// save; a save that holds its locks first makes the change wait until the save commits. Cleans up after itself.
import assert from 'node:assert/strict';import {execFileSync,spawn} from 'node:child_process';import {randomUUID} from 'node:crypto';
const container=process.env.NOREON_TEST_DB_CONTAINER;
if(!container?.startsWith('supabase_db_'))throw Error('Set NOREON_TEST_DB_CONTAINER to an isolated local Supabase container.');
const sql=text=>execFileSync('docker',['exec','-i',container,'psql','-U','postgres','-X','-At','-v','ON_ERROR_STOP=1'],{input:text,encoding:'utf8'}).trim();
class Session{constructor(name){this.name=name;this.buffer='';this.error='';this.child=spawn('docker',['exec','-i',container,'psql','-U','postgres','-X','-At','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe']});this.child.stdout.on('data',data=>{this.buffer+=data;this.check?.();});this.child.stderr.on('data',data=>this.error+=data);this.child.on('exit',code=>this.reject?.(Error(`${name} exited ${code}: ${this.error}`)));}run(text){const marker=`done_${randomUUID().replaceAll('-','')}`;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(`${this.name} timed out: ${this.error}`)),10000);this.reject=error=>{clearTimeout(timer);reject(error);};this.check=()=>{if(this.buffer.includes(marker)){clearTimeout(timer);this.check=null;this.reject=null;const output=this.buffer.replace(marker,'').trim();this.buffer='';resolve(output);}};this.child.stdin.write(`${text}\n\\echo ${marker}\n`);});}close(){if(this.closed)return;this.closed=true;this.reject=null;if(!this.child.stdin.destroyed&&!this.child.stdin.writableEnded)this.child.stdin.end('rollback;\n\\q\n');}}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function blocked(name){for(let i=0;i<150;i++){if(sql(`select exists(select 1 from pg_stat_activity where application_name='${name}' and wait_event_type='Lock');`)==='t')return;await sleep(20);}throw Error(`${name} never waited on a lock`);}
const d=randomUUID(),member=randomUUID(),clinic=randomUUID(),nurse=randomUUID(),visit=randomUUID(),file=randomUUID(),attachment=randomUUID(),job=randomUUID(),value=randomUUID();
const sessions=[];
async function session(label){const s=new Session(`aiplan_${label}_${randomUUID().slice(0,8)}`);sessions.push(s);await s.run(`set application_name='${s.name}';set statement_timeout='8s';`);return s;}
const login=`select set_config('request.jwt.claims','{"sub":"${d}","role":"authenticated","session_id":"${d}","amr":[{"method":"password"}]}',false);`;
const evidence=()=>sql(`select public.patient_clinical_evidence('${member}')->>'token';`);
function generation(){
 const id=sql(`select set_config('request.jwt.claims','{"role":"service_role"}',false);select public.ai_plan_reserve('${member}','${d}',(select revision from public.patient_clinical_cases where user_id='${member}'),'${evidence()}',public._ai_plan_lab_token('${member}'),repeat('b',64),'ai-plan-prompt-3','ai-plan-builder-2','en','high','noreon-protocol-1',true,0)->>'generationId';`).split('\n').pop();
 sql(`select set_config('request.jwt.claims','{"role":"service_role"}',false);select public.ai_plan_finish('${id}','{"state":"ready","mode":"protocol_only","outcome":"protocol_only","provider":"noreon.protocol","costUsd":0,"latencyMs":0,"draft":{"explanation":"Fictional.","instructions":"- Fictional.","followUp":""},"items":[]}');`);
 return id;
}
// Save through the AI path; prints ok or the SQLSTATE, so an expected refusal does not end the session.
const saveAi=(g,token)=>`${login}do $$begin perform public.save_patient_clinical_draft_from_ai('${member}',(select revision from public.patient_clinical_cases where user_id='${member}'),'${token}',
 '{"explanation":"Fictional AI text.","instructions":"- Fictional step.","followUp":"","medicationName":"","medicationDose":"","medicationInstructions":"","medicationTimes":[]}'::jsonb,'${g}');
 perform set_config('aiplan.result','ok',false);exception when others then perform set_config('aiplan.result',sqlstate,false);end$$;select current_setting('aiplan.result');`;
const correct=`set session_replication_role=replica;update public.lab_ai_values set status='corrected',corrected_value=coalesce(corrected_value,value)+0.1,reviewed_by='${d}',reviewed_at=clock_timestamp() where id='${value}';`;
try{
 sql(`insert into auth.users(id) values('${d}'),('${nurse}');insert into auth.users(id,phone,phone_confirmed_at) values('${member}','37498${String(Date.now()%1000000).padStart(6,'0')}',now());
 insert into public.workspace_clinics(id,name) values('${clinic}','Fictional race clinic');
 insert into public.workspace_staff(user_id,role,display_name,clinic_id) values('${d}','doctor','Fictional race doctor','${clinic}'),('${nurse}','nurse','Fictional race nurse','${clinic}');
 insert into auth.sessions(id,user_id,created_at,updated_at) values('${d}','${d}',clock_timestamp(),clock_timestamp());
 insert into public.patient_consents(user_id,version) values('${member}','patient-pilot-v1');
 insert into public.patient_assessments(user_id,revision,completed_at) values('${member}',2,now());
 insert into public.patient_clinical_cases(user_id,assigned_doctor_id) values('${member}','${d}');
 update public.ai_plan_capabilities set enabled=true;
 set session_replication_role=replica;
 insert into public.patient_care_visits(id,user_id,actor_id,actor_name,actor_role,clinic_id) values('${visit}','${member}','${nurse}','Fictional nurse','nurse','${clinic}');
 insert into public.clinic_batch_files(id,batch_id,logical_key,attempt_id,actor_id,session_id,amr,jwt_expires_at,membership_id,membership_revision,submission_id,name,mime,declared_size,expected_sha256,object_key,object_id,measured_size,sha256,state)
  values('${file}',gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),'${d}',gen_random_uuid(),'[]',now(),gen_random_uuid(),1,gen_random_uuid(),'FICTIONAL.pdf','application/pdf',1000,repeat('a',64),'fictional/${file}',gen_random_uuid(),1000,repeat('a',64),'stored');
 insert into public.clinic_result_attachments(id,file_id,clinic_id,user_id,visit_id,actor_kind,actor_id,submission_id) values('${attachment}','${file}','${clinic}','${member}','${visit}','noreon-admin','${d}',gen_random_uuid());
 insert into public.lab_ai_jobs(id,attachment_id,file_id,user_id,state,identity_status,outcome,finished_at) values('${job}','${attachment}','${file}','${member}','done','match','extracted',now());
 insert into public.lab_ai_values(id,job_id,user_id,file_id,attachment_id,seq,test_name,catalogue_ref,value_text,value,unit,page,status) values('${value}','${job}','${member}','${file}','${attachment}',1,'LDL-C','ldl_c','5.3',5.3,'mmol/l',1,'unverified');`);

 // 1. The lab correction holds its row first: the save waits on it, then sees the committed change and refuses.
 let g=generation(),token=evidence();
 const lab=await session('lab_first');await lab.run(`begin;${correct}`);
 const saver=await session('save_waits');const waiting=saver.run(saveAi(g,token));
 await blocked(saver.name);
 await lab.run('commit;');
 assert.match(await waiting,/40001$/,'a correction committed during the save refuses the AI text');

 // 2. The save holds its locks first: the correction waits until the save commits; the saved text predates it.
 g=generation();token=evidence();
 const saver2=await session('save_first');await saver2.run('begin;');assert.match(await saver2.run(saveAi(g,token)),/ok$/,'save succeeds on a current draft');
 const lab2=await session('lab_waits');const change=lab2.run(correct);
 await blocked(lab2.name);
 await saver2.run('commit;');await change;
 assert.match(sql(saveAi(g,token)),/40001$/,'after the correction the same draft is stale');

 // 3. A detachment waits for a save that holds the attachment lock.
 g=generation();token=evidence();
 const saver3=await session('save_before_detach');await saver3.run('begin;');assert.match(await saver3.run(saveAi(g,token)),/ok$/);
 const detacher=await session('detach_waits');const detach=detacher.run(`insert into public.clinic_result_detachments(attachment_id,actor_id,reason,submission_id) values('${attachment}','${d}','Fictional detach',gen_random_uuid());`);
 await blocked(detacher.name);
 await saver3.run('commit;');await detach;
 assert.match(sql(saveAi(g,token)),/40001$/,'after the detachment the same draft is stale');
 console.log('AI draft save serializes with lab review and detachment: a change committed first refuses the save; a save holding its locks makes the change wait.');
}finally{
 for(const s of sessions)s.close();await sleep(150);
 sql(`set session_replication_role=replica;
 delete from public.ai_plan_generations where user_id='${member}';delete from public.clinic_result_detachments where attachment_id='${attachment}';
 delete from public.lab_ai_values where id='${value}';delete from public.lab_ai_jobs where id='${job}';delete from public.clinic_result_attachments where id='${attachment}';
 delete from public.clinic_batch_files where id='${file}';delete from public.patient_care_visits where id='${visit}';
 delete from public.patient_clinical_case_events where user_id='${member}';delete from public.patient_clinical_cases where user_id='${member}';
 delete from public.patient_assessments where user_id='${member}';delete from public.patient_consents where user_id='${member}';
 delete from public.workspace_staff where user_id in('${d}','${nurse}');delete from public.workspace_clinics where id='${clinic}';
 delete from auth.sessions where id='${d}';delete from auth.users where id in('${d}','${nurse}','${member}');
 update public.ai_plan_capabilities set enabled=false;`);
}
