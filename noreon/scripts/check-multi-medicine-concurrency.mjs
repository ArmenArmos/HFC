// Fictional parallel transactions for a plan with several medicines. Two publications, a publication and a draft save, and a
// publication and a dose report must each end in one clear outcome: no half-written version, no approval that outlives what it
// covered, no deadlock. Cleans up after itself.
import assert from 'node:assert/strict';import {execFileSync,spawn} from 'node:child_process';import {randomUUID} from 'node:crypto';
const container=process.env.NOREON_TEST_DB_CONTAINER;
if(!container?.startsWith('supabase_db_'))throw Error('Set NOREON_TEST_DB_CONTAINER to an isolated local Supabase container.');
const sql=text=>execFileSync('docker',['exec','-i',container,'psql','-U','postgres','-X','-At','-v','ON_ERROR_STOP=1'],{input:text,encoding:'utf8'}).trim();
class Session{constructor(name){this.name=name;this.buffer='';this.error='';this.child=spawn('docker',['exec','-i',container,'psql','-U','postgres','-X','-At','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe']});this.child.stdout.on('data',data=>{this.buffer+=data;this.check?.();});this.child.stderr.on('data',data=>this.error+=data);this.child.on('exit',code=>this.reject?.(Error(`${name} exited ${code}: ${this.error}`)));}run(text){const marker=`done_${randomUUID().replaceAll('-','')}`;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(`${this.name} timed out: ${this.error}`)),10000);this.reject=error=>{clearTimeout(timer);reject(error);};this.check=()=>{if(this.buffer.includes(marker)){clearTimeout(timer);this.check=null;this.reject=null;const output=this.buffer.replace(marker,'').trim();this.buffer='';resolve(output);}};this.child.stdin.write(`${text}\n\\echo ${marker}\n`);});}close(){if(this.closed)return;this.closed=true;this.reject=null;if(!this.child.stdin.destroyed&&!this.child.stdin.writableEnded)this.child.stdin.end('rollback;\n\\q\n');}}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function blocked(name){for(let i=0;i<150;i++){if(sql(`select exists(select 1 from pg_stat_activity where application_name='${name}' and wait_event_type='Lock');`)==='t')return;await sleep(20);}throw Error(`${name} never waited on a lock`);}
const d=randomUUID(),member=randomUUID(),clinic=randomUUID();
const engine='{"version":"test-engine","urgency":"green","tests":[]}';
const base={explanation:'Fictional review',instructions:'Fictional instructions',followUp:'',medicationName:'',medicationDose:'',medicationInstructions:'',medicationTimes:[]};
const sessions=[];
async function session(label){const s=new Session(`multimed_${label}_${randomUUID().slice(0,8)}`);sessions.push(s);await s.run(`set application_name='${s.name}';set statement_timeout='8s';`);return s;}
const doctor=`select set_config('request.jwt.claims','{"sub":"${d}","role":"authenticated","session_id":"${d}","amr":[{"method":"password"}]}',false);`;
const service=`select set_config('request.jwt.claims','{"role":"service_role"}',false);`;
const revision=()=>Number(sql(`select revision from public.patient_clinical_cases where user_id='${member}';`));
const token=()=>sql(`select public.patient_clinical_evidence('${member}')->>'token';`);
const q=value=>`'${JSON.stringify(value).replaceAll("'","''")}'::jsonb`;
const regimen=rows=>({...base,medicines:rows});
const save=(draft,rev=revision())=>`${doctor}do $$begin perform public.save_patient_clinical_draft('${member}',${rev},'${token()}',${q(draft)});perform set_config('mm.result','ok',false);exception when others then perform set_config('mm.result',sqlstate,false);end$$;select current_setting('mm.result');`;
const review=()=>JSON.parse(sql(`${doctor}select public.doctor_regimen_review('${member}');`).split('\n').at(-1));
const hash=()=>review().draft.approvalHash;
// Prints ok or the SQLSTATE and message, so an expected refusal does not end the session.
const publish=(approval,rev=revision())=>`${service}do $$begin perform public.publish_patient_clinical_regimen('${member}','${d}',${rev},'${token()}','${engine}'::jsonb,gen_random_uuid(),'Fictional note','${approval}');perform set_config('mm.result','ok',false);exception when others then perform set_config('mm.result',sqlstate||' '||sqlerrm,false);end$$;select current_setting('mm.result');`;
// Match the fixed midnight schedule on the report transaction's Yerevan day. now() stays fixed even while locks wait.
const due="(date_trunc('day',now() at time zone 'Asia/Yerevan') at time zone 'Asia/Yerevan')";
const report=medication=>`${service}do $$declare r jsonb;begin r:=public.report_patient_dose_for('${member}','${medication}',${due},'taken',0);perform set_config('mm.result',r->>'status',false);exception when others then perform set_config('mm.result',sqlstate||' '||sqlerrm,false);end$$;select current_setting('mm.result');`;
const versions=()=>Number(sql(`select count(*) from public.patient_care_plan_versions where user_id='${member}';`));
const regimens=()=>Number(sql(`select count(*) from public.patient_care_plan_regimens where user_id='${member}';`));
const current=()=>sql(`select string_agg(m.name||' '||m.dose,', ' order by m.name) from public.patient_care_plan_medications l join public.patient_care_plans p on p.id=l.plan_id and p.active join public.patient_care_medications m on m.id=l.medication_id where l.user_id='${member}';`);
const row=(name,dose,time)=>({name,dose,instructions:'',times:[time]});
try{
 const time='00:00';
 sql(`insert into auth.users(id) values('${d}');insert into auth.users(id,phone,phone_confirmed_at) values('${member}','37498${String(Date.now()%1000000).padStart(6,'0')}',now());
 insert into public.workspace_clinics(id,name) values('${clinic}','Fictional race clinic');
 insert into public.workspace_staff(user_id,role,display_name,clinic_id) values('${d}','doctor','Fictional race doctor','${clinic}');
 insert into auth.sessions(id,user_id,created_at,updated_at) values('${d}','${d}',clock_timestamp(),clock_timestamp());
 insert into public.patient_consents(user_id,version) values('${member}','patient-pilot-v1');
 insert into public.patient_assessments(user_id,revision,completed_at) values('${member}',2,now());
 insert into public.patient_clinical_cases(user_id,assigned_doctor_id) values('${member}','${d}');
 update public.multi_medicine_capabilities set enabled=true;`);
 sql(`${service}select public.prepare_patient_clinical_review('${member}','${d}',${revision()},'${token()}','${engine}'::jsonb);`);
 sql(`${doctor}select public.command_patient_clinical_review('${member}',${revision()},'${token()}','consultation-decision','{"decision":"not-required","note":"Fictional decision"}');`);
 assert.match(sql(save(regimen([row('Fictional statin','20 mg',time)]))),/ok$/);
 assert.match(sql(publish(hash())),/ok$/,'first version');

 // 1. Two tabs approve the same regimen. The first holds the case; the second is refused at once, not queued, and cannot retry on its old approval.
 assert.match(sql(save(regimen([row('Fictional statin','20 mg',time),row('Fictional add-on','10 mg',time)]))),/ok$/);
 const approved=hash(),rev=revision(),before=versions();
 const first=await session('first');await first.run('begin;');assert.match(await first.run(publish(approved,rev)),/ok$/);
 const second=await session('second');assert.match(await second.run(publish(approved,rev)),/55P03/,'the second tab is refused while the first holds the case');
 await first.run('commit;');
 assert.equal(versions(),before+1,'one new version');assert.equal(regimens(),before+1,'one regimen row per version');
 assert.doesNotMatch(sql(publish(approved,rev)),/ok$/,'the second tab cannot publish afterwards');
 assert.equal(versions(),before+1);assert.equal(current(),'Fictional add-on 10 mg, Fictional statin 20 mg');

 // 2. A draft save in flight: publication is refused, and once the save commits the approval no longer covers the draft.
 const stale=hash(),staleRev=revision();
 const saver=await session('saver');await saver.run('begin;');
 assert.match(await saver.run(save(regimen([row('Fictional statin','40 mg',time),row('Fictional add-on','10 mg',time)]),staleRev)),/ok$/);
 const during=await session('during_save');assert.match(await during.run(publish(stale,staleRev)),/55P03/,'publication does not wait behind a save');
 await saver.run('commit;');
 assert.doesNotMatch(sql(publish(stale,staleRev)),/ok$/,'old revision and approval refused');
 assert.match(sql(publish(stale)),/Approve the current regimen/,'current revision with the old approval is refused too');
 assert.match(sql(publish(hash())),/ok$/,'the fresh approval publishes');
 assert.equal(current(),'Fictional add-on 10 mg, Fictional statin 40 mg');

 // Orders must predate midnight, even when the test runs late in the day. Bypass the fixture's immutability trigger.
 sql(`set session_replication_role=replica;update public.patient_care_medications set effective_at=${due}-interval '1 day',start_date=(now() at time zone 'Asia/Yerevan')::date-1 where user_id='${member}';update public.patient_care_plans set published_at=published_at-interval '1 day' where user_id='${member}' and not active;`);
 const ids=Object.fromEntries(sql(`select m.name,m.id from public.patient_care_plan_medications l join public.patient_care_plans p on p.id=l.plan_id and p.active join public.patient_care_medications m on m.id=l.medication_id where l.user_id='${member}';`).split('\n').map(line=>line.split('|')));
 const statin=ids['Fictional statin'],addon=ids['Fictional add-on'];

 // 3. A dose report holds its order and plan: publication is refused cleanly and leaves nothing behind, then succeeds.
 assert.match(sql(save(regimen([row('Fictional statin','40 mg',time)]))),/ok$/);
 const dose=await session('dose_first');await dose.run('begin;');assert.match(await dose.run(report(statin)),/saved$/);
 const held=versions(),holdHash=hash();
 const pub=await session('publish_during_dose');assert.match(await pub.run(publish(holdHash)),/55P03/,'publication refused while a dose holds the plan');
 // This race only needs the dose lock. Roll it back so the next race creates one dose even across Yerevan midnight.
 await dose.run('rollback;');assert.equal(versions(),held,'nothing half written');

 // 4. Publication holds the plan: a dose for the medicine it keeps waits and lands; a dose for the one it stops is refused, with no deadlock.
 const publisher=await session('publisher');await publisher.run('begin;');assert.match(await publisher.run(publish(holdHash)),/ok$/);
 const kept=await session('kept_dose'),dropped=await session('dropped_dose');
 const keptDose=kept.run(report(statin)),droppedDose=dropped.run(report(addon));
 await blocked(kept.name);await blocked(dropped.name);
 await publisher.run('commit;');
 assert.match(await keptDose,/saved$/,'the kept medicine still logs');assert.match(await droppedDose,/not-due$/,'the stopped medicine no longer logs');
 assert.equal(current(),'Fictional statin 40 mg');
 assert.equal(Number(sql(`select count(*) from public.patient_dose_events where user_id='${member}';`)),1,'one dose, on the kept order');
 console.log('Several-medicine publication: one outcome per race, approvals go stale with what they covered, doses follow the regimen, no deadlock.');
}finally{
 for(const s of sessions)s.close();await sleep(150);
 sql(`set session_replication_role=replica;
 delete from public.patient_dose_event_history where user_id='${member}';delete from public.patient_dose_events where user_id='${member}';
 delete from public.patient_message_outbox where user_id='${member}';delete from public.programme_checkpoints where member_id='${member}';
 delete from public.patient_care_plan_regimens where user_id='${member}';delete from public.patient_care_plan_versions where user_id='${member}';delete from public.patient_clinical_publications where user_id='${member}';
 delete from public.patient_care_plan_medications where user_id='${member}';delete from public.patient_care_medications where user_id='${member}';delete from public.patient_care_plans where user_id='${member}';
 delete from public.patient_clinical_case_events where user_id='${member}';delete from public.patient_clinical_cases where user_id='${member}';
 delete from public.patient_assessments where user_id='${member}';delete from public.patient_consents where user_id='${member}';
 delete from public.workspace_staff where user_id='${d}';delete from public.workspace_clinics where id='${clinic}';
 delete from auth.sessions where id='${d}';delete from auth.users where id in('${d}','${member}');
 update public.multi_medicine_capabilities set enabled=false;`);
}
