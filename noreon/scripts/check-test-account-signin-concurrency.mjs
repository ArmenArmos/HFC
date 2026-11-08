/** Two real PostgreSQL sessions in an explicitly owned, empty replay DB only.
 * Run after migrations: NOREON_TEST_DB_CONTAINER=<owned-replay> node scripts/check-test-account-signin-concurrency.mjs
 * This commits synthetic fixtures for cross-session visibility, then removes mutable
 * fixtures. Append-only sign-in audit rows stay in the disposable replay database.
 */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomInt,randomUUID} from 'node:crypto';
import {staffManagementTestDatabaseAllowed} from './staff-management-test-database.mjs';
const container=process.env.NOREON_TEST_DB_CONTAINER;
if(!staffManagementTestDatabaseAllowed(container))throw Error('Owned replay database required');
const phone='+999'+String(randomInt(1000000000,10000000000)),admin=randomUUID(),number=randomUUID();
const requestA=randomUUID(),requestB=randomUUID(),name='test_signin_race_'+randomUUID();
const service="set local request.jwt.claims='{\"role\":\"service_role\"}';set local role service_role;";
function sql(source){return new Promise((resolve,reject)=>{
 const child=spawn('docker',['exec','-i',container,'psql','-XqAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres']);
 let out='',err='';child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>err+=x);child.on('error',reject);
 child.on('close',code=>code===0?resolve(out.trim()):reject(Error(err)));
 child.stdin.end("set statement_timeout='10s';set lock_timeout='8s';\n"+source);
});}
// Keep the winner's transaction open until the other session is observed waiting.
function heldTransaction(source){
 const child=spawn('docker',['exec','-i',container,'psql','-XqAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres']);
 let out='',err='';const marker='accepted_'+randomUUID();
 const completed=new Promise((resolve,reject)=>{
  child.on('error',reject);child.on('close',code=>code===0?resolve(out):reject(Error(err)));
 });
 // Attach a handler immediately, including failures before the marker appears.
 completed.catch(()=>{});
 const accepted=new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('Winner did not reach acceptance')),10000);
  completed.catch(error=>{clearTimeout(timer);reject(error);});
  child.stdout.on('data',x=>{out+=x;if(out.includes(marker)){clearTimeout(timer);resolve(out.split('\n').filter(x=>x.startsWith('{')).map(x=>JSON.parse(x))[0]);}});
 });
 child.stderr.on('data',x=>err+=x);
 child.stdin.write(`begin;set local statement_timeout='10s';${source}\n\\echo ${marker}\n`);
 return {accepted,completed,commit(){child.stdin.end('commit;\n');},rollback(){child.stdin.end('rollback;\n');}};
}
const check=(rid,nonce)=>`${service}select public.test_signin_check('${rid}',repeat('${nonce}',64),'246810',repeat('a',64),true);`;
let seeded=false,settingsPresent=false,auditFloor='0',winner,loser,failed=false;
try{
 settingsPresent=await sql('select exists(select 1 from public.test_signin_settings);')==='t';
 auditFloor=await sql('select coalesce(max(id),0)from public.telegram_auth_audit;');
 assert.match(auditFloor,/^[0-9]+$/);
 await sql(`begin;
 do $$begin if exists(select 1 from public.test_signin_numbers)or exists(select 1 from public.test_signin_settings where enabled)then raise exception 'Empty disabled replay required';end if;end$$;
 insert into auth.users(id)values('${admin}');
 insert into public.test_signin_settings(singleton,enabled)values(true,true)on conflict(singleton)do update set enabled=true;
 insert into public.test_signin_numbers(id,phone,label,created_by,expires_at,code_hash)values('${number}','${phone}','Fictional single-use race','${admin}',clock_timestamp()+interval '1 day',extensions.crypt('246810',extensions.gen_salt('bf',10)));
 insert into public.auth_code_requests(id,phone,nonce_hmac,state,code_digest,code_sealed,lease_until)values
 ('${requestA}','${phone}',repeat('b',64),'sent',repeat('a',64),'fixture',clock_timestamp()+interval '15 seconds'),
 ('${requestB}','${phone}',repeat('c',64),'sent',repeat('a',64),'fixture',clock_timestamp()+interval '15 seconds');
 insert into public.test_signin_challenges(request_id,number_id)values('${requestA}','${number}'),('${requestB}','${number}');commit;`);
 seeded=true;
 // Both entry points ultimately call test_signin_check. It takes switch, then phone,
 // then request/challenge/number row locks. The losing transaction must read the
 // committed code_used_at marker even when it holds a different unused challenge.
 winner=heldTransaction(check(requestA,'b'));
 assert.equal((await winner.accepted).ok,true);
 loser=sql(`set application_name='${name}';begin;${check(requestB,'c')}commit;`);
 loser.catch(()=>{});
 const until=Date.now()+5000;let blocked=false;
 while(Date.now()<until){
  blocked=await sql(`select exists(select 1 from pg_stat_activity where application_name='${name}'and wait_event_type='Lock');`)==='t';
  if(blocked)break;
  await new Promise(resolve=>setTimeout(resolve,25));
 }
 assert.equal(blocked,true,'Second session waits on the acceptance transaction');
 winner.commit();await winner.completed;winner=undefined;
 assert.deepEqual(JSON.parse(await loser),{ok:false,code:'wrong_code'});
 assert.equal(await sql(`select count(*)from public.test_signin_challenges where number_id='${number}'and checked_at is not null;`),'1','Only one challenge accepted');
 assert.equal(await sql(`select code_used_at is not null and failed_attempts=1 from public.test_signin_numbers where id='${number}';`),'t','One spent issue and one refused replay');
 assert.equal(await sql(`select count(*)from public.telegram_auth_audit where id>${auditFloor} and kind='test_signin.code.accepted'and detail->>'phoneLast4'=right('${phone}',4);`),'1','Exactly one acceptance audit');
}catch(error){
 failed=true;
 throw error;
}finally{
 try{
  if(winner){winner.rollback();await winner.completed.catch(()=>{});}
  await loser?.catch(()=>{});
  // telegram_auth_audit_immutable forbids deleting even synthetic sign-in audit rows.
  // These acceptance audits have no actor, so retaining them does not pin the admin.
  if(seeded)await sql(`begin;delete from public.test_signin_challenges where number_id='${number}';delete from public.auth_code_requests where id in('${requestA}','${requestB}');delete from public.test_signin_numbers where id='${number}';delete from auth.users where id='${admin}';${settingsPresent?'update public.test_signin_settings set enabled=false;':'delete from public.test_signin_settings;'}commit;`);
 }catch(error){
  if(!failed)throw error;
  console.error('Cleanup also failed:',error);
 }
}
console.log('PASS two-session single-use race: switch → phone → row locks; one acceptance, one wrong_code, one spent issue.');
