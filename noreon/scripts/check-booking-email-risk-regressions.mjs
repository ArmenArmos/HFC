/** Exact owned PostgreSQL regressions for the independent BEP findings. No providers. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {riskSessions} from './fixtures/booking-email-risk-sessions.mjs';
const container=process.env.NOREON_TEST_DB_CONTAINER;
const owned=container==='supabase_db_noreon-clinic-settings-qa';
const ci=process.env.GITHUB_ACTIONS==='true'&&process.env.CI==='true'&&container==='supabase_db_noreon-core';
if(!owned&&!ci)throw Error('Owned booking QA or repository CI database required');
const source=readFileSync('scripts/check-booking-email.sql','utf8');
const sections=source.split('-- A partial recipient receipt');assert.equal(sections.length,2,'Fixture boundary must be explicit');
const fixture=sections[0];
const evidence=process.env.NOREON_BOOKING_RISK_EVIDENCE_DIR??mkdtempSync(join(tmpdir(),'noreon-booking-risk-'));mkdirSync(evidence,{recursive:true});
const wanted=new Set(process.argv.slice(2));let executed=0;
const select=(command,subject='Synthetic schedule',text='Synthetic approved content only',extra='')=>`select public.select_booking_appointment('${command}','b2000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000020','b2000000-0000-4000-8000-000000000030','source-v1',p_sender_email=>'noreon@example.invalid',p_template_version=>'synthetic-approved-v1',p_subject=>'${subject}',p_text_content=>'${text}'${extra})`;
const cases=[
 ['BEP2_retry_reschedule',`
set local role service_role;
select set_config('bep.claim',public.claim_booking_notice('b2000000-0000-4000-8000-000000000020','b2000000-0000-4000-8000-000000000050',1,now()+interval '5 minutes','synthetic-engine-v1','noreon@example.invalid','synthetic-approved-v1')::text,true);
select public.record_booking_notice_receipt('b2000000-0000-4000-8000-000000000020','b2000000-0000-4000-8000-000000000050',1,current_setting('bep.claim')::jsonb->>'envelopeHash','failed');
select public.apply_booking_notice_receipt('b2000000-0000-4000-8000-000000000020','b2000000-0000-4000-8000-000000000050','synthetic-engine-v1','noreon@example.invalid','synthetic-approved-v1');
select public.claim_booking_notice('b2000000-0000-4000-8000-000000000020','b2000000-0000-4000-8000-000000000051',2,now()+interval '5 minutes','synthetic-engine-v1','noreon@example.invalid','synthetic-approved-v1');
select pg_temp.email_reject($probe$${select('b2000000-0000-4000-8000-000000000021','Synthetic change','Synthetic changed content',",p_appointment_id=>'b2000000-0000-4000-8000-000000000020',p_revision=>0")}$probe$,'40001');
`],
 ['BEP5_source_drift_replay',`
insert into public.patient_measurements(user_id,submission_id,systolic,diastolic,measured_at)values('b2000000-0000-4000-8000-000000000001',gen_random_uuid(),121,81,now());
create temp table recovered as ${select('b2000000-0000-4000-8000-000000000020')};
select pg_temp.email_assert((select select_booking_appointment=(select result from public.booking_appointment_commands where id='b2000000-0000-4000-8000-000000000020')from recovered),'Exact committed receipt survives ordinary source drift');
select pg_temp.email_reject($probe$${select('b2000000-0000-4000-8000-000000000021')}$probe$,'40001');
select pg_temp.email_reject($probe$${select('b2000000-0000-4000-8000-000000000020','Changed payload')}$probe$,'22023');
select pg_temp.email_assert((select count(*)=1 from public.booking_manual_reservations),'Recovery cannot allocate again');
select pg_temp.email_assert((select count(*)=1 from public.booking_appointment_versions),'Recovery cannot create a new version');
select pg_temp.email_assert((select count(*)=1 from public.booking_scheduling_notices),'Recovery cannot create a new notice');
`],
 ['BEP5_http_body_recovery',`
insert into public.patient_measurements(user_id,submission_id,systolic,diastolic,measured_at)values('b2000000-0000-4000-8000-000000000001',gen_random_uuid(),121,81,now());
select pg_temp.email_assert(public.recover_booking_command('b2000000-0000-4000-8000-000000000020','b2000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001',jsonb_build_object('offerId','b2000000-0000-4000-8000-000000000030','offerVersion','source-v1','homeAddress',null))=(select result from public.booking_appointment_commands where id='b2000000-0000-4000-8000-000000000020'),'Original HTTP selection recovers before deriving a changed program');
select pg_temp.email_reject($probe$select public.recover_booking_command('b2000000-0000-4000-8000-000000000020','b2000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','{"offerId":"b2000000-0000-4000-8000-000000000030","offerVersion":"forged-version","homeAddress":null}')$probe$,'22023');
`],
];
let failed=0;
for(const[name,probe]of cases){
 if(wanted.size&&!wanted.has(name))continue;executed++;
 const result=spawnSync('docker',['exec','-i',container,'psql','-U','postgres','-X','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],{input:fixture+'\n'+probe+'\nrollback;\n',encoding:'utf8'});
 writeFileSync(join(evidence,name+'.log'),`${result.stdout??''}\n${result.stderr??''}`);
 if(result.status!==0)failed++;
 console.log(name,result.status===0?'PASS':'FAIL');
}
const harness=riskSessions(container);
const ordered=[
 ['BEP1_conversion_fence',harness.secondMember({legacy:true}),async ctx=>{
  const name='bep1_old_guard',key=477320001;
  const sourceHash=ctx.pause('legacy',name,key);const holder=await ctx.hold(key);
  const old=ctx.run(ctx.claims(ctx.m2)+`select public.command_patient_test_request('${ctx.m2}','${ctx.m2}',false,'b2000000-0000-4000-8000-000000000040',0,'b2000000-0000-4000-8000-000000000062','cancel','{}');`,name);
  await ctx.waitAdvisory(name);
  const converted=await ctx.run(harness.selectSecond(ctx.m2,true));
  holder.child.stdin.end('commit;\n');await holder.done;const legacy=await old;
  const state=JSON.parse(ctx.sql(`select json_build_object('legacyStatus',(select status from public.patient_test_requests where id='b2000000-0000-4000-8000-000000000040'),'converted',(select count(*)from public.booking_legacy_conversions where legacy_id='b2000000-0000-4000-8000-000000000040'))`));
  writeFileSync(join(evidence,'BEP1_schedule.log'),JSON.stringify({sourceHash,converted,legacy,state},null,2));
  if(converted.code===0){assert.notEqual(legacy.code,0,'Converted record must deny the paused old command');assert.notEqual(state.legacyStatus,'cancelled');}
  else{assert.match(converted.err,/55P03|40001/);assert.equal(legacy.code,0,legacy.err);assert.equal(state.converted,0,'Serialized legacy winner blocks conversion');}
 }],
 ['BEP3_selection_assignment',harness.secondMember({nurseActor:true}),async ctx=>{
  const name='bep3_selection',key=477320002;ctx.pause('actor',name,key);const holder=await ctx.hold(key);
  const selecting=ctx.run(ctx.claims(ctx.nurse)+harness.selectSecond(ctx.nurse),name);
  await ctx.waitAdvisory(name);ctx.sql(`update public.patient_clinical_cases set assigned_nurse_id=null where user_id='${ctx.m2}';`);
  holder.child.stdin.end('commit;\n');await holder.done;const result=await selecting;
  writeFileSync(join(evidence,'BEP3_selection_schedule.log'),JSON.stringify(result,null,2));
  assert.notEqual(result.code,0,'Selection after revoked assignment must fail');assert.match(result.err,/42501/);
  assert.equal(ctx.sql("select count(*)from public.booking_appointment_commands where id='b2000000-0000-4000-8000-000000000024'"),'0');
 }],
 ['BEP3_claim_assignment',harness.secondMember({nurseActor:true}),async ctx=>{
  ctx.sql(ctx.claims(ctx.nurse)+harness.selectSecond(ctx.nurse));
  const name='bep3_claim',key=477320003;ctx.pause('actor',name,key);const holder=await ctx.hold(key);
  const claiming=ctx.run(ctx.claims(ctx.nurse)+"select public.claim_booking_notice('b2000000-0000-4000-8000-000000000024','b2000000-0000-4000-8000-000000000054',1,now()+interval '5 minutes','synthetic-engine-v1','noreon@example.invalid','synthetic-approved-v1');",name);
  await ctx.waitAdvisory(name);ctx.sql(`update public.patient_clinical_cases set assigned_nurse_id=null where user_id='${ctx.m2}';`);
  holder.child.stdin.end('commit;\n');await holder.done;const result=await claiming;
  writeFileSync(join(evidence,'BEP3_claim_schedule.log'),JSON.stringify(result,null,2));
  assert.equal(result.code,0,result.err);assert.equal(result.out.trim(),'','Revoked assignment cannot receive a send envelope');
  assert.equal(ctx.sql("select count(*)from public.booking_notice_attempts where notice_id='b2000000-0000-4000-8000-000000000024'"),'0');
 }],
 ['BEP3_receipt_replay',harness.secondMember({nurseActor:true}),async ctx=>{
  ctx.sql(ctx.claims(ctx.nurse)+harness.selectSecond(ctx.nurse));
  const name='bep3_receipt_replay';
  const key=ctx.sql("select hashtextextended('booking-command:b2000000-0000-4000-8000-000000000024',0)");
  const holder=await ctx.hold(key);
  // This waits on the ACTUAL production command advisory lock, with no
  // function instrumentation: initial authorization has already passed.
  const replaying=ctx.run(ctx.claims(ctx.nurse)+harness.selectSecond(ctx.nurse),name);
  await ctx.waitAdvisory(name);ctx.sql(`update public.patient_clinical_cases set assigned_nurse_id=null where user_id='${ctx.m2}';`);
  holder.child.stdin.end('commit;\n');await holder.done;const result=await replaying;
  writeFileSync(join(evidence,'BEP3_replay_schedule.log'),JSON.stringify(result,null,2));
  assert.notEqual(result.code,0,'Revoked staff cannot recover a receipt after waiting');assert.match(result.err,/42501/);
 }],
 ['BEP4_confirmed_legacy_current',harness.secondMember({legacy:true,confirmed:true}),async ctx=>{
  ctx.sql(harness.selectSecond(ctx.m2,true));
  const data=JSON.parse(ctx.sql("select public._booking_appointment_dto(a)from public.booking_appointments a where id='b2000000-0000-4000-8000-000000000024'"));
  const original=JSON.parse(ctx.sql("select current_arrangement from public.patient_test_requests where id='b2000000-0000-4000-8000-000000000040'"));
  writeFileSync(join(evidence,'BEP4_projection.log'),JSON.stringify({data,original},null,2));
  assert.deepEqual(data.legacyCurrent,original,'Confirmed historical current must remain exact in the pilot projection');
  assert.equal(ctx.sql("select count(*)from public.booking_manual_reservations where appointment_id='b2000000-0000-4000-8000-000000000024'"),'1','Do not invent a reservation for the historical provider');
  for(const outcome of ['failed','unknown','expired','accepted']){
   const accepted=outcome==='expired'||outcome==='accepted';
   const receipt=accepted?'accepted':outcome;
   const expected=outcome==='expired'?'reconciliation':outcome==='accepted'?'confirmed':outcome;
   const checked=await ctx.run(`begin;set local role service_role;
select set_config('bep.legacy_claim',public.claim_booking_notice('b2000000-0000-4000-8000-000000000024','b2000000-0000-4000-8000-000000000054',1,now()+interval '5 minutes','synthetic-engine-v1','noreon@example.invalid','synthetic-approved-v1')::text,true);
${outcome==='expired'?"reset role;update public.booking_manual_capacity set valid_until=now()-interval '1 second'where key=(select capacity_key from public.booking_manual_reservations where id='b2000000-0000-4000-8000-000000000024');set local role service_role;":''}
select public.record_booking_notice_receipt('b2000000-0000-4000-8000-000000000024','b2000000-0000-4000-8000-000000000054',1,current_setting('bep.legacy_claim')::jsonb->>'envelopeHash','${receipt}',${accepted?"'synthetic-legacy-receipt'":'null'},${accepted?"jsonb_build_object('clinic','clinic@example.invalid','copy','copy@example.invalid')":'null'});
select public.apply_booking_notice_receipt('b2000000-0000-4000-8000-000000000024','b2000000-0000-4000-8000-000000000054','synthetic-engine-v1','noreon@example.invalid','synthetic-approved-v1');
reset role;
do $$declare a public.booking_appointments;original jsonb;begin
 select * into a from public.booking_appointments where id='b2000000-0000-4000-8000-000000000024';
 select current_arrangement into original from public.patient_test_requests where id='b2000000-0000-4000-8000-000000000040';
 if a.status<>'${expected}'then raise exception 'Wrong legacy conversion outcome';end if;
 ${outcome==='accepted'?"if a.legacy_current is not null or a.current_arrangement<>a.proposed_arrangement then raise exception 'Valid acceptance must replace the legacy current';end if;":"if a.legacy_current is distinct from original or a.current_reservation_id is not null then raise exception 'Failed/unknown/late receipt must retain exact old provider truth without fake capacity';end if;"}
 if not exists(select 1 from public.booking_appointment_versions where appointment_id=a.id and legacy_snapshot->'current_arrangement'=original)then raise exception 'Original provider provenance/history lost';end if;
end$$;rollback;`);
   writeFileSync(join(evidence,`BEP4_${outcome}.log`),checked.out+'\n'+checked.err);
   assert.equal(checked.code,0,checked.err);
  }
 }],
];
for(const[name,extra,probe]of ordered){
 if(wanted.size&&!wanted.has(name))continue;executed++;
 try{await harness.withFixture(fixture,extra,probe);console.log(name,'PASS');}
 catch(error){failed++;writeFileSync(join(evidence,name+'.log'),error.stack??String(error));console.log(name,'FAIL:',error.message);}
}
assert.ok(executed>0,'No matching BEP cases');
console.log(`${executed} BEP cases; ${failed} failed. Evidence: ${evidence}`);process.exitCode=failed?1:0;
