import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawn,spawnSync} from 'node:child_process';
if(!process.env.NOREON_TEST_DB_CONTAINER?.startsWith('supabase_db_'))throw Error('Set NOREON_TEST_DB_CONTAINER to an isolated local Supabase container.');
const container=process.env.NOREON_TEST_DB_CONTAINER;
const args=['exec','-i',container,'psql','-U','postgres','-X','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'];
const sql=(source,ok=true)=>{const r=spawnSync('docker',args,{input:source,encoding:'utf8'});if(ok)assert.equal(r.status,0,r.stderr);return r;};
const value=source=>JSON.parse(sql(source).stdout.trim().split('\n').filter(x=>x.startsWith('{')).at(-1));
const id=n=>`c4410000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const claims=(actor=1)=>JSON.stringify({sub:id(actor),role:'authenticated',amr:[{method:actor===1?'otp':'password'}],session_id:id(actor===1?5:6)});
const as=(actor,source)=>`begin;select set_config('request.jwt.claims','${claims(actor)}',true);set local role authenticated;${source};commit;`;
const hold=async source=>{
 const child=spawn('docker',args,{stdio:['pipe','pipe','pipe']});let out='',err='';
 const completed=new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>code===0?resolve(out):reject(Error(err)));});
 const ready=new Promise((resolve,reject)=>{child.stdout.on('data',d=>{out+=d;if(out.includes('CONVERSATION_LOCK_READY'))resolve();});child.on('exit',()=>{if(!out.includes('CONVERSATION_LOCK_READY'))reject(Error(err||'No lock marker'));});});
 child.stderr.on('data',d=>err+=d);
 child.stdin.end(source.replace(/commit;\s*$/,"select 'CONVERSATION_LOCK_READY';select pg_sleep(1);commit;"));
 await ready;return {completed};
};
// A policy/fixture collision aborts before any writes; this runner never uses real rows.
assert.equal(sql('select count(*) from public.conversation_policy;').stdout.trim(),'0','Synthetic runner needs unconfigured policy');
assert.equal(sql(`select count(*)from auth.users where id in('${id(1)}','${id(2)}','${id(3)}');`).stdout.trim(),'0','Fixture IDs already present');
let seeded=false;
try{
 const fixture=readFileSync('scripts/check-conversation-persistence.sql','utf8').replaceAll('c4400000','c4410000').replaceAll('C4400000','C4410000').replace(/rollback;\s*$/,'commit;');
 sql(fixture);seeded=true;
 // The optional restart is restricted to this explicitly granted database container.
 if(process.env.NOREON_CONVERSATION_RESTART==='1'){
  const restarted=spawnSync('docker',['restart',container],{encoding:'utf8'});assert.equal(restarted.status,0,restarted.stderr);
  let ready=false;for(let n=0;n<30;n++){if(sql('select 1;',false).status===0){ready=true;break;}await new Promise(resolve=>setTimeout(resolve,500));}assert.ok(ready,'Database returns after restart');
  console.log('PASS actual database process restart with committed synthetic conversation history');
 }
 // Each sql() is a new PostgreSQL connection/process: history survives the writer exit.
 let ws=value(as(2,`select public.conversation_workspace('${id(1)}')`));
 assert.equal(ws.messages.length,2);assert.equal(ws.drafts.length,2);assert.equal(ws.deliveries.length,2);
 const retirePayload={op:'propose',memberId:id(1),requestId:id(50),expectedVersion:ws.version,clinicalRevision:ws.clinicalRevision,draftEpoch:ws.draftEpoch,source:ws.sourceToken,body:'Delayed race compose',summary:'Private delayed summary',provenance:{kind:'staff',engine:'doctor-authored',version:'1',protocolVersion:'not-applicable'}};
 const retirement=await hold(as(2,`select public.conversation_recover('${id(1)}','${id(50).toUpperCase()}','${JSON.stringify({...retirePayload,requestId:id(50).toUpperCase()})}')`));
 const delayed=value(as(2,`select public.conversation_compose('${id(1)}','${id(50)}',${ws.version},${ws.clinicalRevision},${ws.draftEpoch},'${ws.sourceToken}','Delayed race compose','Private delayed summary')`));
 await retirement.completed;assert.equal(delayed.code,'command_retired');
 assert.equal(sql(`select count(*)from public.conversation_receipts where actor_id='${id(2)}'and request_id='${id(50)}'and state='retired';`).stdout.trim(),'1');
 assert.equal(value(as(2,`select public.conversation_workspace('${id(1)}')`)).drafts.length,2,'Delayed retired command writes no draft');
 console.log('PASS two-connection uppercase recovery-first retirement blocks delayed canonical compose');
 const message={requestId:id(30),text:'Synthetic simultaneous request'};
 const receive=`select public.conversation_receive('${JSON.stringify(message)}'::jsonb)`;
 const first=await hold(as(1,receive));
 const replay=value(as(1,receive));await first.completed;assert.equal(replay.replayed,true);
 // Prepare fresh current draft using the actual stored source/version.
 ws=value(as(2,`select public.conversation_workspace('${id(1)}')`));
 value(as(2,`select public.conversation_compose('${id(1)}','${id(31)}',${ws.version},${ws.clinicalRevision},${ws.draftEpoch},'${ws.sourceToken}','Synthetic race reply','Factual race summary')`));
 let actions=value(as(2,`select public.conversation_actions('${id(1)}')`));
 const command=purpose=>({schema:1,purpose,intentId:actions.view.actions.find(x=>x.purpose===purpose).intentId,requestId:id(purpose==='reply.edit'?32:33).replaceAll('-',''),...(purpose==='reply.edit'?{body:'Synthetic edited race reply'}:{})});
 const editing=await hold(as(2,`select public.conversation_command('${JSON.stringify(command('reply.edit'))}')`));
 const approveDuringEdit=sql(as(2,`select public.conversation_command('${JSON.stringify(command('reply.approve'))}')`),false);
 assert.notEqual(approveDuringEdit.status,0);assert.match(approveDuringEdit.stderr,/55P03/);await editing.completed;
 const stale=value(as(2,`select public.conversation_command('${JSON.stringify(command('reply.approve'))}')`));assert.equal(stale.ok,false);
 actions=value(as(2,`select public.conversation_actions('${id(1)}')`));
 const arriving=await hold(as(1,`select public.conversation_receive('${JSON.stringify({requestId:id(34),text:'New member context during approval'})}')`));
 const approveDuringMessage=sql(as(2,`select public.conversation_command('${JSON.stringify({...command('reply.approve'),requestId:id(35).replaceAll('-','')})}')`),false);
 assert.notEqual(approveDuringMessage.status,0);assert.match(approveDuringMessage.stderr,/55P03/);await arriving.completed;
 const afterMessage=value(as(2,`select public.conversation_command('${JSON.stringify({...command('reply.approve'),requestId:id(35).replaceAll('-','')})}')`));assert.equal(afterMessage.ok,false);
 // Current clinic state must defeat a later claim; normal own-fictional-clinic mutation only.
 ws=value(as(2,`select public.conversation_workspace('${id(1)}')`));
 value(as(2,`select public.conversation_compose('${id(1)}','${id(36)}',${ws.version},${ws.clinicalRevision},${ws.draftEpoch},'${ws.sourceToken}','Synthetic claim reply','Factual claim summary')`));
 actions=value(as(2,`select public.conversation_actions('${id(1)}')`));
 const approved=value(as(2,`select public.conversation_command('${JSON.stringify({...command('reply.approve'),requestId:id(37).replaceAll('-','')})}')`));assert.equal(approved.ok,true);
 const changing=await hold(`begin;update public.workspace_clinics set active=false where id='${id(4)}';commit;`);
 const service=source=>`begin;select set_config('request.jwt.claims','{"role":"service_role"}',true);set local role service_role;${source};commit;`;
 const claimDuringChange=sql(service(`select public.conversation_claim('${approved.deliveryId}','${id(38)}')`),false);
 assert.notEqual(claimDuringChange.status,0);assert.match(claimDuringChange.stderr,/55P03/);await changing.completed;
 // CR5: lapsed approval authority is an explicit, audited hold rather than an error.
 const claimAfterChange=value(service(`select public.conversation_claim('${approved.deliveryId}','${id(38)}')`));
 assert.equal(claimAfterChange.code,'approval_authority_lapsed');
 assert.equal(sql(`select state||':'||reason from public.conversation_deliveries where id='${approved.deliveryId}';`).stdout.trim(),'held:approval_authority_lapsed');
 assert.equal(sql(`select count(*)from public.conversation_attempts where id='${id(38)}';`).stdout.trim(),'0');
 console.log('PASS separate-process retained history and two-connection same command, edit/approval, message/approval, current clinic/claim schedules (SQL-role fixture, not Auth proof)');
}finally{
 if(seeded){
  // Only this runner's fictional namespace. Session-local trigger bypass permits
  // removal of immutable fixture history without altering any trigger definitions.
  sql(`begin;set local session_replication_role=replica;
   delete from public.conversation_attempts where delivery_id in(select d.id from public.conversation_deliveries d join public.conversations c on c.id=d.conversation_id where c.member_id='${id(1)}');
   delete from public.conversation_deliveries where conversation_id in(select id from public.conversations where member_id='${id(1)}');
   delete from public.conversation_approvals where draft_id in(select d.id from public.conversation_drafts d join public.conversations c on c.id=d.conversation_id where c.member_id='${id(1)}');
   delete from public.conversation_intents where draft_id in(select d.id from public.conversation_drafts d join public.conversations c on c.id=d.conversation_id where c.member_id='${id(1)}');
   delete from public.conversation_revisions where draft_id in(select d.id from public.conversation_drafts d join public.conversations c on c.id=d.conversation_id where c.member_id='${id(1)}');
   delete from public.conversation_drafts where conversation_id in(select id from public.conversations where member_id='${id(1)}');
   delete from public.conversation_messages where conversation_id in(select id from public.conversations where member_id='${id(1)}');
   delete from public.conversation_receipts where conversation_id in(select id from public.conversations where member_id='${id(1)}');
   delete from public.conversation_audit where conversation_id in(select id from public.conversations where member_id='${id(1)}');
   delete from public.conversations where member_id='${id(1)}';
   delete from public.conversation_endpoints where member_id='${id(1)}';
   delete from public.conversation_grants where actor_id in('${id(1)}','${id(2)}','${id(3)}');
   delete from public.patient_clinical_cases where user_id='${id(1)}';
   delete from public.workspace_staff where user_id in('${id(2)}','${id(3)}');
   delete from public.workspace_clinics where id='${id(4)}';
   delete from auth.sessions where user_id in('${id(1)}','${id(2)}','${id(3)}');
   delete from public.profiles where id in('${id(1)}','${id(2)}','${id(3)}');
   delete from auth.users where id in('${id(1)}','${id(2)}','${id(3)}');
   delete from public.conversation_policy where version='synthetic-v1';commit;`);
  assert.equal(sql(`select count(*)from auth.users where id in('${id(1)}','${id(2)}','${id(3)}');`).stdout.trim(),'0');
 }
}
