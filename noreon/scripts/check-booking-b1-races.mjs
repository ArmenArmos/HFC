import {clinicSqlTarget} from './fixtures/clinic-db-target.mjs';
/** B1 cancel races in real independent PostgreSQL sessions on the owned or CI replay only. No provider traffic. */
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
const {container,database}=clinicSqlTarget();
const args=['exec','-i',container,'psql','-U','postgres','-d',database,'-X','-qAt','-v','ON_ERROR_STOP=1'];
const sql=text=>execFileSync('docker',args,{input:text,encoding:'utf8'}).trim();
function session(){
 const child=spawn('docker',args);let out='',err='',readyResolve;const ready=new Promise(r=>readyResolve=r);
 child.stdout.on('data',x=>{out+=x;if(out.includes('B1_READY'))readyResolve();});child.stderr.on('data',x=>err+=x);
 const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>resolve({code,out,err}));});
 child.stdin.write("\\set VERBOSITY verbose\nset statement_timeout='6s';\n");
 return {child,ready,done};
}
async function run(text){const s=session();s.child.stdin.end(text);return s.done;}
const admin=randomUUID(),clinic=randomUUID(),members=[randomUUID(),randomUUID(),randomUUID()];
const content=`'noreon@example.invalid','synthetic-approved-v1','Fictional subject','Fictional text'`;
const claims=id=>`select set_config('request.jwt.claims',jsonb_build_object('sub','${id}','role','authenticated','session_id','${id}','amr',jsonb_build_array(jsonb_build_object('method','password')))::text,false);select set_config('request.jwt.claim.sub','${id}',false);`;
const offer=(id,ref,days)=>`jsonb_build_object('id','${id}','version','v1','source','b1-race','clinicId','${clinic}','mode','clinic','startsAt',now()+interval '${days} days','endsAt',now()+interval '${days} days 1 hour','timezone','Asia/Yerevan','clinicAddress','1 Fictional Race Street','preparation','Fictional','preparationVersion','p1','coveredTestIds','["race-lab"]'::jsonb,'followUps','[]'::jsonb,'reservationContract',jsonb_build_object('version','v','reference','${ref}'))`;
const slotA=randomUUID(),slotB=randomUUID();
const cancel=(member,command,revision)=>`set role service_role;select public.cancel_booking_appointment('${command}','${member}','${member}','${member}',${revision},null,${content});`;
const change=(member,command,revision)=>`set role service_role;select public.select_booking_appointment('${command}','${member}','${member}','${member}','${slotB}','v1',p_appointment_id=>'${member}',p_revision=>${revision},p_sender_email=>'noreon@example.invalid',p_template_version=>'synthetic-approved-v1',p_subject=>'Fictional subject',p_text_content=>'Fictional text');`;
let holder;
try{
 sql(`insert into auth.users(id,phone,phone_confirmed_at)values${members.map((m,i)=>`('${m}','3749977000${i}',now())`).join(',')},('${admin}',null,null);
  update public.profiles set display_name='Fictional race member',birth_date='1980-01-01',biological_sex='female'where id in(${members.map(m=>`'${m}'`).join(',')});
  insert into public.patient_consents(user_id,version)select id,'patient-pilot-v1'from unnest(array[${members.map(m=>`'${m}'::uuid`).join(',')}])id;
  insert into public.patient_assessments(user_id,revision,completed_at)select id,1,now()from unnest(array[${members.map(m=>`'${m}'::uuid`).join(',')}])id;
  insert into auth.sessions(id,user_id,created_at,updated_at)values('${admin}','${admin}',now(),now());
  insert into public.workspace_clinics(id,name,address,scheduling_email)values('${clinic}','Fictional race clinic','1 Fictional Race Street','race-clinic@example.invalid');
  insert into public.workspace_staff(user_id,role,display_name,clinic_id)values('${admin}','admin','Fictional race admin',null);
  update public.workspace_scheduling_settings set copy_email=coalesce(copy_email,'noreon-copy@example.invalid'),revision=revision+case when copy_email is null then 1 else 0 end;`);
 sql(`${claims(admin)}set role service_role;
  select public.register_manual_booking_offer('${admin}',${offer(slotA,'race-a-'+slotA,3)},10,now()+interval '3 days');
  select public.register_manual_booking_offer('${admin}',${offer(slotB,'race-b-'+slotB,4)},10,now()+interval '4 days');`);
 // Each member: sealed program, booked and confirmed through an accepted generation-1 email.
 for(const member of members){
  sql(`select public.register_booking_program('${member}','${member}','${member}',jsonb_build_object('memberId','${member}','sourceToken',c->>'token','requirementsToken',c->>'requirementsToken','engineVersion','synthetic-engine-v1','items',jsonb_build_array(jsonb_build_object('id','race-lab','title','Fictional lab','method','lab','preparation','','source','fixture'))))from(select public.patient_test_context('${member}')c)s;
   set role service_role;
   select public.select_booking_appointment('${member}','${member}','${member}','${member}','${slotA}','v1',p_sender_email=>'noreon@example.invalid',p_template_version=>'synthetic-approved-v1',p_subject=>'Fictional subject',p_text_content=>'Fictional text');
   select set_config('race.claim',public.claim_booking_notice('${member}','${member}',1,now()+interval '5 minutes','synthetic-engine-v1','noreon@example.invalid','synthetic-approved-v1')::text,false);
   select public.record_booking_notice_receipt('${member}','${member}',1,current_setting('race.claim')::jsonb->>'envelopeHash','accepted','fictional-receipt',jsonb_build_object('clinic','race-clinic@example.invalid','copy',current_setting('race.claim')::jsonb->>'copyEmail'));
   select public.apply_booking_notice_receipt('${member}','${member}','synthetic-engine-v1','noreon@example.invalid','synthetic-approved-v1');`);
  assert.equal(sql(`select status from public.booking_appointments where id='${member}'`),'confirmed');
 }
 // 1. Cancel and change of the same revision at once: exactly one commits.
 const [m1,m2,m3]=members;
 let results=await Promise.all([run(cancel(m1,randomUUID(),0)),run(change(m1,randomUUID(),0))]);
 assert.equal(results.filter(r=>r.code===0).length,1,JSON.stringify(results.map(r=>r.err)));
 assert.match(results.find(r=>r.code!==0).err,/40001|55P03/);
 assert.equal(sql(`select revision||':'||status from public.booking_appointments where id='${m1}'`),'1:notification-pending');
 assert.equal(sql(`select count(*) from public.booking_appointment_versions where appointment_id='${m1}'`),'2');
 // 2. Two different cancel commands at once: one cancellation notice, never two.
 results=await Promise.all([run(cancel(m2,randomUUID(),0)),run(cancel(m2,randomUUID(),0))]);
 assert.equal(results.filter(r=>r.code===0).length,1,JSON.stringify(results.map(r=>r.err)));
 assert.equal(sql(`select count(*) from public.booking_scheduling_notices where appointment_id='${m2}' and purpose='cancellation'`),'1');
 // 3. The same cancel command twice at once: one version, both succeed with the recorded result.
 const same=randomUUID();
 results=await Promise.all([run(cancel(m3,same,0)),run(cancel(m3,same,0))]);
 assert.ok(results.some(r=>r.code===0));assert.ok(results.every(r=>r.code===0||/40001|55P03/.test(r.err)),JSON.stringify(results.map(r=>r.err)));
 assert.equal(sql(`select count(*) from public.booking_scheduling_notices where appointment_id='${m3}' and purpose='cancellation'`),'1');
 // 4. A held case lock bounds a cancellation instead of letting it wait or slip through.
 holder=session();holder.child.stdin.write(`begin;select 1 from public.patient_clinical_cases where user_id='${m1}' for update;\n\\echo B1_READY\n`);await holder.ready;
 const blocked=await run(cancel(m1,randomUUID(),1));assert.notEqual(blocked.code,0);assert.match(blocked.err,/55P03|40001/);
 holder.child.stdin.end('rollback;');await holder.done;holder=null;
 // 5. A cancellation claim and a competing change of the pending revision: the change is refused.
 const pending=sql(`select notice_id from public.booking_appointments where id='${m3}'`);
 results=await Promise.all([run(`set role service_role;select public.claim_booking_notice('${pending}','${randomUUID()}',1,now()+interval '5 minutes','synthetic-engine-v1','noreon@example.invalid','synthetic-approved-v1');`),run(change(m3,randomUUID(),1))]);
 assert.notEqual(results[1].code,0,'A pending cancellation blocks a change');assert.match(results[1].err,/40001|55P03/);
 console.log('B1 cancel races passed: cancel vs change one winner, duplicate cancels one notice, same-command replay one version, case lock bounded, pending cancellation blocks change. Synthetic only; no provider contacted.');
}finally{
 if(holder){holder.child.stdin.end('rollback;');await holder.done;}
}
