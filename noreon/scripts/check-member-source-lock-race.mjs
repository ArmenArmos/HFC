// Two-member race replay for the per-member clinical source locks (quality review 2026-10-18 item 3).
// A booking command (command_patient_test_request, which freezes the member's clinical sources) and
// member writes (profile save, reading insert) run in independent sessions:
// - different members never block or fail each other, in either direction;
// - the same member still serialises: a write in flight makes the command fail fast (55P03), and a
//   command holding the freeze makes the member's write wait until it commits;
// - two readers of the same member still coexist.
// Fictional data on an isolated local container only; cleans up after itself.
import assert from 'node:assert/strict';import {execFileSync,spawn} from 'node:child_process';import {randomUUID} from 'node:crypto';
const container=process.env.NOREON_TEST_DB_CONTAINER;
if(!container?.startsWith('supabase_db_'))throw Error('Set NOREON_TEST_DB_CONTAINER to an isolated local Supabase container.');
const args=['exec','-i',container,'psql','-U','postgres','-X','-At','-v','ON_ERROR_STOP=1'];
const sql=text=>execFileSync('docker',args,{input:text,encoding:'utf8'}).trim();
class Session{constructor(name){this.name=name;this.buffer='';this.error='';this.child=spawn('docker',args,{stdio:['pipe','pipe','pipe']});this.child.stdout.on('data',data=>{this.buffer+=data;this.check?.();});this.child.stderr.on('data',data=>this.error+=data);this.child.on('exit',code=>this.reject?.(Error(`${name} exited ${code}: ${this.error}`)));}run(text){const marker=`done_${randomUUID().replaceAll('-','')}`;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(`${this.name} timed out: ${this.error}`)),10000);this.reject=error=>{clearTimeout(timer);reject(error);};this.check=()=>{if(this.buffer.includes(marker)){clearTimeout(timer);this.check=null;this.reject=null;const output=this.buffer.replace(marker,'').trim();this.buffer='';resolve(output);}};this.child.stdin.write(`${text}\n\\echo ${marker}\n`);});}close(){if(this.closed)return;this.closed=true;this.reject=null;if(!this.child.stdin.destroyed&&!this.child.stdin.writableEnded)this.child.stdin.end('rollback;\n\\q\n');}}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const sessions=[];
async function session(label){const s=new Session(`msl_${label}_${randomUUID().slice(0,8)}`);sessions.push(s);await s.run(`set application_name='${s.name}';set statement_timeout='8s';`);return s;}
const waitingOnLock=name=>sql(`select exists(select 1 from pg_stat_activity where application_name='${name}' and wait_event_type='Lock');`)==='t';
async function blocked(name){for(let i=0;i<150;i++){if(waitingOnLock(name))return;await sleep(20);}throw Error(`${name} never waited on a lock`);}
// Runs a statement in its own session and resolves with ok or the SQLSTATE, so a refusal does not end the session.
const attempt=body=>`do $$begin ${body}; perform set_config('msl.result','ok',false);exception when others then perform set_config('msl.result',sqlerrm||' '||sqlstate,false);end$$;select current_setting('msl.result');`;
const admin=randomUUID(),clinic=randomUUID(),run=String(Date.now()%100000).padStart(5,'0');
const members=['a','b'].map((label,i)=>({label,id:randomUUID(),request:randomUUID(),phone:`37497${i}${run}`}));
const [A,B]=members;
let revision={a:0,b:0};
const confirmBody=m=>{const terms=m.terms;return `perform set_config('request.jwt.claim.sub','${admin}',true);perform public.command_patient_test_request('${m.id}','${admin}',true,'${m.request}',${revision[m.label]},'${randomUUID()}','confirm',jsonb_build_object('provider','FICTIONAL provider','terms','${terms}'::jsonb,'obtainedAt',now(),'channel','phone','source','Fictional test only','preparation','Fictional preparation','replacesExisting',${revision[m.label]>0},'engine',jsonb_build_object('sourceToken',public.patient_test_context('${m.id}')->>'token','version','test-engine','tests','[{"id":"lipid-panel","title":"Lipid panel","method":"lab"}]'::jsonb)))`;};
async function confirm(m,s){const result=await (s??await session(`confirm_${m.label}`)).run(attempt(confirmBody(m)));if(result.endsWith('ok'))revision[m.label]++;const last=result.split('\n').pop();if(!/(ok|55P03)$/.test(last))throw Error(last);return last.slice(-5)==='55P03'?'55P03':last;}
const profileSave=m=>`update public.profiles set display_name='FICTIONAL member ${m.label} '||clock_timestamp()::text where id='${m.id}';`;
const reading=m=>`insert into public.patient_measurements(user_id,submission_id,systolic,diastolic,measured_at) values('${m.id}',gen_random_uuid(),121,79,now()-interval '1 day');`;
const scheduling=sql('select enabled from public.clinic_scheduling_capabilities where singleton');
try{
 sql(`insert into auth.users(id,phone,phone_confirmed_at) values('${A.id}','${A.phone}',now()),('${B.id}','${B.phone}',now()),('${admin}',null,null);
 insert into public.workspace_staff(user_id,role,display_name) values('${admin}','admin','FICTIONAL admin');
 ${members.map(m=>`update public.profiles set display_name='FICTIONAL member ${m.label}',birth_date='1980-01-01',biological_sex='female' where id='${m.id}';
 insert into public.patient_consents(user_id,version) values('${m.id}','patient-pilot-v1');insert into public.patient_assessments(user_id,completed_at) values('${m.id}',now());`).join('\n')}`);
 for(const [i,m] of members.entries()){
  m.terms=JSON.stringify({startsAt:new Date(Date.now()+(10+i)*86400000).toISOString(),endsAt:new Date(Date.now()+(10+i)*86400000+3600000).toISOString(),timezone:'Asia/Yerevan',mode:'clinic',location:'Fictional location'});
  sql(`select public._legacy_create_patient_test_request('${m.id}','${m.request}',public.patient_test_context('${m.id}')->>'token','${m.terms}','[{"id":"lipid-panel","title":"Lipid panel","method":"lab"}]','test-engine');`);
 }
 // Each revision bump needs a fresh confirm; reset by reading the stored revision.
 const sync=()=>{for(const m of members)revision[m.label]=Number(sql(`select revision from public.patient_test_requests where id='${m.request}'`));};

 // 1. Member B's profile save in flight: member A's booking command commits (before: 55P03 for everyone).
 const bWriter=await session('b_profile');await bWriter.run(`begin;${profileSave(B)}`);
 assert.equal(await confirm(A),'ok','another member saving their profile must not block a booking command');
 // 2. Same member: A's profile save in flight makes A's command fail fast with 55P03, no wait.
 const aWriter=await session('a_profile');await aWriter.run(`begin;${profileSave(A)}`);
 let started=Date.now();assert.equal(await confirm(A),'55P03','the same member saving must still fail the command fast');
 assert.ok(Date.now()-started<3000,'refusal is immediate, not a wait');
 await aWriter.run('rollback;');await bWriter.run('commit;');sync();

 // 3. Member B's reading insert in flight: A's command commits.
 const bReading=await session('b_reading');await bReading.run(`begin;${reading(B)}`);
 assert.equal(await confirm(A),'ok','another member recording a reading must not block a booking command');
 await bReading.run('rollback;');sync();

 // 4. A booking command holds A's freeze: B's reading and profile save finish at once; A's reading waits for the commit.
 const holder=await session('a_command_holds');await holder.run('begin;');assert.equal(await confirm(A,holder),'ok');
 const bFree=await session('b_free');started=Date.now();
 await bFree.run(`${reading(B)}${profileSave(B)}`);
 assert.ok(Date.now()-started<3000,'another member writes while a command holds this member\'s freeze');
 assert.equal(waitingOnLock(bFree.name),false);
 // 5. Two readers of the same member still coexist while the first holds the freeze.
 const reader=await session('a_second_reader');
 assert.equal((await reader.run(attempt(`perform public.lock_patient_clinical_sources('${A.id}')`))).split('\n').pop(),'ok','two readers of one member coexist');
 assert.equal((await reader.run(attempt(`perform public._conversation_source('${A.id}')`))).split('\n').pop(),'ok','the conversation freeze coexists with a booking freeze');
 await reader.run('rollback;');
 // 6. Member B's command is not blocked by A's held freeze either.
 sync();
 assert.equal(await confirm(B),'ok','a command for another member runs beside a held freeze');
 // 7. Member A's own reading waits until the command commits (a queued writer then also turns
 // away new readers of A with 55P03, exactly as a queued ROW EXCLUSIVE did against SHARE).
 const aWaits=await session('a_waits');const aWrite=aWaits.run(reading(A));
 await blocked(aWaits.name);
 assert.equal((await reader.run(attempt(`perform public.lock_patient_clinical_sources('${A.id}')`))).split('\n').pop().slice(-5),'55P03','a queued writer keeps new readers out');
 assert.equal(await confirm(B),'ok','member B is unaffected by member A\'s queue');
 await holder.run('commit;');await aWrite;
 assert.equal(sql(`select count(*) from public.patient_measurements where user_id='${A.id}'`),'1','the waiting write lands after the command commits');
 // 8. Item 45: the member booking read's schedule top-up skips a clinic whose schedule another transaction
 // holds (an admin save or another reader's generation) instead of queueing behind it.
 sql(`insert into public.workspace_clinics(id,name,address,active) values('${clinic}','FICTIONAL race clinic','1 Fictional Street',true);
 insert into public.clinic_schedules(clinic_id,active,slot_minutes,capacity,covered_test_ids,preparation,updated_by) values('${clinic}',true,30,1,'{lab-a}','Fictional preparation','${admin}');
 update public.clinic_scheduling_capabilities set enabled=true;`);
 const scheduleHolder=await session('schedule_holder');await scheduleHolder.run(`begin;select 1 from public.clinic_schedules where clinic_id='${clinic}' for update;`);
 const topUp=await session('top_up');started=Date.now();
 await topUp.run('select public.clinic_schedule_top_up();');
 assert.ok(Date.now()-started<3000,'top-up does not wait for a held schedule');
 assert.equal(sql(`select generated_on is null from public.clinic_schedules where clinic_id='${clinic}'`),'t','the held schedule is left to its holder');
 await scheduleHolder.run('rollback;');await topUp.run('select public.clinic_schedule_top_up();');
 assert.equal(sql(`select generated_on is not null from public.clinic_schedules where clinic_id='${clinic}'`),'t','the next top-up generates it');
 console.log('Per-member source locks: different members never block each other (booking command vs profile save and reading, both directions); the same member still fails fast or waits; readers coexist.');
}finally{
 for(const s of sessions)s.close();await sleep(150);
 sql(`${members.map(m=>`delete from public.patient_test_request_events where request_id='${m.request}';delete from public.patient_test_requests where id='${m.request}';delete from public.patient_measurements where user_id='${m.id}';delete from public.patient_clinical_case_events where user_id='${m.id}';delete from public.patient_clinical_cases where user_id='${m.id}';`).join('')}
 delete from public.clinic_schedules where clinic_id='${clinic}';delete from public.workspace_clinics where id='${clinic}';update public.clinic_scheduling_capabilities set enabled=${scheduling==='t'};
 delete from public.workspace_staff where user_id='${admin}';delete from auth.users where id in('${A.id}','${B.id}','${admin}');`);
}
