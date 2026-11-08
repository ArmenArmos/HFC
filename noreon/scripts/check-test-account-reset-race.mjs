// Fictional parallel resets of one test account (double click, two tabs, admin and qa at once):
// the second request waits for the first and returns the same reset, so one placeholder, one
// reset row and one audit row result, and only one request claims the Auth phone change. Cleans up after itself.
import assert from 'node:assert/strict';import {execFileSync,spawn} from 'node:child_process';import {randomUUID} from 'node:crypto';
const container=process.env.NOREON_TEST_DB_CONTAINER;
if(!container?.startsWith('supabase_db_'))throw Error('Set NOREON_TEST_DB_CONTAINER to an isolated local Supabase container.');
const sql=text=>execFileSync('docker',['exec','-i',container,'psql','-U','postgres','-X','-At','-v','ON_ERROR_STOP=1'],{input:text,encoding:'utf8'}).trim();
class Session{constructor(name){this.name=name;this.buffer='';this.error='';this.child=spawn('docker',['exec','-i',container,'psql','-U','postgres','-X','-At','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe']});this.child.stdout.on('data',data=>{this.buffer+=data;this.check?.();});this.child.stderr.on('data',data=>this.error+=data);this.child.on('exit',code=>this.reject?.(Error(`${name} exited ${code}: ${this.error}`)));}run(text){const marker=`done_${randomUUID().replaceAll('-','')}`;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(`${this.name} timed out: ${this.error}`)),10000);this.reject=error=>{clearTimeout(timer);reject(error);};this.check=()=>{if(this.buffer.includes(marker)){clearTimeout(timer);this.check=null;this.reject=null;const output=this.buffer.replace(marker,'').trim();this.buffer='';resolve(output);}};this.child.stdin.write(`${text}\n\\echo ${marker}\n`);});}close(){if(this.closed)return;this.closed=true;this.reject=null;if(!this.child.stdin.destroyed&&!this.child.stdin.writableEnded)this.child.stdin.end('rollback;\n\\q\n');}}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function blocked(name){for(let i=0;i<150;i++){if(sql(`select exists(select 1 from pg_stat_activity where application_name='${name}' and wait_event_type='Lock');`)==='t')return;await sleep(20);}throw Error(`${name} never waited on a lock`);}
const member=randomUUID(),admin=randomUUID(),qa=randomUUID();
const sessions=[];
async function session(label,actor){const s=new Session(`tareset_${label}_${randomUUID().slice(0,8)}`);sessions.push(s);
 await s.run(`set application_name='${s.name}';set statement_timeout='8s';begin;set local role authenticated;select set_config('request.jwt.claims','{"sub":"${actor}","role":"authenticated","session_id":"${actor}","amr":[{"method":"password"}]}',true);`);return s;}
const begin=key=>`select public.test_account_reset_begin('${member}','${key}')::text;`;
const parse=out=>JSON.parse(out.split('\n').pop());
try{
 sql(`insert into auth.users(id,phone,phone_confirmed_at) values('${member}','37499${String(Date.now()%1000000).padStart(6,'0')}',now()),('${admin}',null,null),('${qa}',null,null);
 insert into public.workspace_staff(user_id,role,display_name,clinic_id) values('${admin}','admin','Fictional race admin',null),('${qa}','qa','Fictional race qa',null);
 insert into auth.sessions(id,user_id,created_at,updated_at) values('${admin}','${admin}',clock_timestamp(),clock_timestamp()),('${qa}','${qa}',clock_timestamp(),clock_timestamp());
 update public.profiles set is_test_account=true where id='${member}';`);

 // Two different clicks (keys) at once, admin and qa: the second waits, then returns the first reset.
 const a=await session('admin',admin),q=await session('qa',qa);
 const first=parse(await a.run(begin(randomUUID())));
 assert.equal(first.replay,false);
 const pending=q.run(begin(randomUUID()));
 await blocked(q.name);
 await a.run('commit;');
 const second=parse(await pending);
 await q.run('commit;');
 assert.equal(second.resetId,first.resetId,'a concurrent reset returns the first one');
 assert.equal(second.replay,true);

 // The same click twice at once (one request key): one reset.
 sql(`update public.test_account_resets set state='done',finished_at=clock_timestamp() where member_id='${member}';`);
 const key=randomUUID();
 const c1=await session('click1',qa),c2=await session('click2',qa);
 const r1=parse(await c1.run(begin(key)));
 const p2=c2.run(begin(key));
 await blocked(c2.name);
 await c1.run('commit;');
 const r2=parse(await p2);
 await c2.run('commit;');
 assert.equal(r2.resetId,r1.resetId,'a double click returns the same reset');
 assert.notEqual(r1.resetId,first.resetId,'a later reset is a new one');

 // Both clicks then race to claim the Auth call: one claims, the other waits and sees it busy.
 const k1=await session('claim1',qa),k2=await session('claim2',admin);
 const claim=id=>`select public.test_account_reset_claim('${id}')::text;`;
 const got=parse(await k1.run(claim(r1.resetId)));
 const p3=k2.run(claim(r1.resetId));
 await blocked(k2.name);
 await k1.run('commit;');
 const other=parse(await p3);
 await k2.run('commit;');
 assert.equal(got.ok,true,'the first request claims the Auth call');
 assert.deepEqual(other,{ok:false,code:'busy'},'the duplicate makes no Auth call');

 assert.equal(sql(`select count(*) from public.test_account_resets where member_id='${member}';`),'2');
 assert.equal(sql(`select count(*) from public.test_account_audit where member_id='${member}' and action='reset.started';`),'2');
 assert.equal(sql(`select test_account_reset_count from public.profiles where id='${member}';`),'2');
 console.log('check-test-account-reset-race: ok');
}finally{
 for(const s of sessions)s.close();
 await sleep(100);
 sql(`delete from public.test_account_audit where member_id='${member}';delete from public.test_account_resets where member_id='${member}';
  delete from public.auth_cleanup_jobs where auth_user_id='${member}';delete from public.workspace_staff where user_id in('${admin}','${qa}');
  delete from auth.users where id in('${member}','${admin}','${qa}');`);
}
