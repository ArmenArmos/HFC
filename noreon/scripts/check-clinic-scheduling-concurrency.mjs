/** Actual lock races on the explicitly owned replay or repository CI DB only. */
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const container=process.env.NOREON_TEST_DB_CONTAINER;
if(container!=='supabase_db_noreon-clinic-settings-qa' && !(process.env.CI==='true'&&process.env.GITHUB_ACTIONS==='true'&&container==='supabase_db_noreon-core'))throw Error('Owned clinic-settings replay/CI database required');
const admin=randomUUID(),other=randomUUID(),clinic=randomUUID();
const q=value=>`'${String(value).replaceAll("'","''")}'`;
function session(){
 const app=`clinic-settings-${randomUUID()}`;
 const child=spawn('docker',['exec','-i',container,'psql','-qAt','-X','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres']);
 let out='',err='',readyResolve;
 const ready=new Promise(resolve=>readyResolve=resolve);
 child.stdout.on('data',data=>{out+=data;if(out.includes('LOCK_READY'))readyResolve();});child.stderr.on('data',data=>err+=data);
 const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>resolve({code,out,err}));});
 child.stdin.write(`\\set VERBOSITY verbose\nset statement_timeout='8s';set application_name=${q(app)};\n`);
 return {child,ready,done,app};
}
async function sql(text){const s=session();s.child.stdin.end(text);return s.done;}
async function checked(text){const r=await sql(text);assert.equal(r.code,0,r.err);return r.out.trim();}
const actor=(id=admin)=>`set request.jwt.claim.sub=${q(id)};set request.jwt.claims=${q(JSON.stringify({sub:id,role:'authenticated',session_id:id,amr:[{method:'password'}]}))};set role authenticated;`;
const clinicSave=(revision,request,email,id=admin)=>`${actor(id)}select public.real_admin_update_clinic_scheduling_email(${q(clinic)},${revision},${q(request)},${q(email)});`;
const copySave=(revision,request,email)=>`${actor()}select public.real_admin_update_scheduling_copy_email(${revision},${q(request)},${q(email)});`;
let holder,copyBefore;
async function race(first,second,code,label){
 holder=session();holder.child.stdin.write(`begin;${first}\n\\echo LOCK_READY\n`);
 await Promise.race([holder.ready,holder.done.then(r=>{throw Error(`Holder failed: ${r.err}`);})]);
 const follower=session();follower.child.stdin.end(second);
 let blocked=false;
 for(let i=0;i<40;i++){
  if(await checked(`select exists(select from pg_stat_activity where application_name=${q(follower.app)} and wait_event_type='Lock');`)==='t'){blocked=true;break;}
  await new Promise(resolve=>setTimeout(resolve,20));
 }
 assert.equal(blocked,true,`${label}: must block on a real database lock`);
 holder.child.stdin.end('commit;');assert.equal((await holder.done).code,0);holder=null;
 const result=await follower.done;
 if(code){assert.notEqual(result.code,0);assert.match(result.err,new RegExp(code));}else assert.equal(result.code,0,result.err);
 console.log(`PASS ${label}`);return result;
}
try{
 copyBefore=JSON.parse(await checked('select row_to_json(s) from public.workspace_scheduling_settings s where id;'));
 await checked(`insert into auth.users(id,email)values(${q(admin)},${q(admin+'@example.invalid')}),(${q(other)},${q(other+'@example.invalid')});insert into auth.sessions(id,user_id,created_at,updated_at)values(${q(admin)},${q(admin)},clock_timestamp(),clock_timestamp()),(${q(other)},${q(other)},clock_timestamp(),clock_timestamp());insert into public.workspace_staff(user_id,role,display_name)values(${q(admin)},'admin','Synthetic settings race'),(${q(other)},'admin','Other settings race');insert into public.workspace_clinics(id,name)values(${q(clinic)},'Synthetic settings race');`);
 await race(clinicSave(0,randomUUID(),'first@example.invalid'),clinicSave(0,randomUUID(),'stale@example.invalid'),'40001','clinic same-revision single winner');
 const request=randomUUID();await race(clinicSave(1,request,'second@example.invalid'),clinicSave(1,request,'second@example.invalid'),null,'clinic duplicate request original result');
 assert.equal(await checked(`select scheduling_revision from public.workspace_clinics where id=${q(clinic)};`),'2');
 assert.equal(await checked(`select count(*) from public.real_staff_admin_events where clinic_id=${q(clinic)} and kind='clinic_scheduling_updated';`),'2');
 const actorRequest=randomUUID();await race(clinicSave(2,actorRequest,'third@example.invalid'),clinicSave(2,actorRequest,'third@example.invalid',other),'22023','request actor binding across concurrent administrators');
 const rev=copyBefore.revision;
 await race(copySave(rev,randomUUID(),'copy-first@example.invalid'),copySave(rev,randomUUID(),'copy-stale@example.invalid'),'40001','copy same-revision single winner');
 const copyRequest=randomUUID();await race(copySave(rev+1,copyRequest,'copy-second@example.invalid'),copySave(rev+1,copyRequest,'copy-second@example.invalid'),null,'copy duplicate request original result');
 assert.equal(await checked('select revision from public.workspace_scheduling_settings where id;'),String(rev+2));
 console.log('Clinic/copy real-session races passed; no provider calls.');
}finally{
 if(holder){holder.child.kill('SIGKILL');await holder.done.catch(()=>{});}
 await checked(`delete from public.real_staff_admin_events where actor_id in(${q(admin)},${q(other)});delete from public.clinic_scheduling_operations where actor_id in(${q(admin)},${q(other)});delete from public.workspace_staff where user_id in(${q(admin)},${q(other)});delete from public.workspace_clinics where id=${q(clinic)};delete from auth.sessions where user_id in(${q(admin)},${q(other)});delete from auth.users where id in(${q(admin)},${q(other)});${copyBefore?`update public.workspace_scheduling_settings set copy_email=${copyBefore.copy_email===null?'null':q(copyBefore.copy_email)},revision=${copyBefore.revision} where id;`:''}`);
}
