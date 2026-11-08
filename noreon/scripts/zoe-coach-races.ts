// Zoe coach C0 races against the isolated database (20261020103406; COACH_SPEC §8.8, §11 C0). Synthetic members only.
//  A. The risk path: a coach run is claimed, the member sends a red-flag reply while the coach text is being published.
//     Publication waits on the conversation row lock, then is refused; the reply is claimed by the real inbound sweep
//     (zoe_run_claim, runZoeSweep with the fake provider) and the urgent route runs; the next coach claim is cancelled.
//  B. Concurrent sweeps: two claims at once give one coach run (row locks, the per-member lock, the daily cap counted
//     inside it); two schedules at once give one row.
//  C. A doctor takeover during publication: publication waits, then is refused; nothing is stored.
//  D. A consent withdrawal during the Telegram claim: the claim does not wait (busy), then holds the teaser; no attempt.
//  F. Busy members are skipped, not waited for (Astra N2): a held coach lock, a held event row, and a doctor's reply holding the
//     conversation (the claim used to wait on it through the zoe_runs foreign key while holding the coach lock the takeover needs).
// Run: NOREON_TEST_DB_CONTAINER=<lane container> node --conditions=noreon-server-test --import ./scripts/register-alias.mjs scripts/zoe-coach-races.ts
import assert from 'node:assert/strict';
import {execFileSync,spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {runZoeSweep,type ZoeRpc} from '@/lib/zoe/server';
import {createFakeProvider} from '@/lib/zoe/provider';

const container=process.env.NOREON_TEST_DB_CONTAINER;
if(!container?.startsWith('supabase_db_'))throw Error('Set NOREON_TEST_DB_CONTAINER to an isolated local Supabase container.');
const sql=(text:string)=>execFileSync('docker',['exec','-i',container,'psql','-U','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'],{input:text,encoding:'utf8'}).trim();
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));

class Session{
 name:string;buffer='';error='';child:ChildProcessWithoutNullStreams;check:(()=>void)|null=null;reject:((e:Error)=>void)|null=null;closed=false;
 constructor(name:string){this.name=name;this.child=spawn('docker',['exec','-i',container!,'psql','-U','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe']});
  this.child.stdout.on('data',d=>{this.buffer+=d;this.check?.();});this.child.stderr.on('data',d=>this.error+=d);this.child.on('exit',code=>this.reject?.(Error(`${name} exited ${code}: ${this.error}`)));}
 run(text:string):Promise<string>{const marker=`done_${randomUUID().replaceAll('-','')}`;return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error(`${this.name} timed out: ${this.error}`)),10000);this.reject=e=>{clearTimeout(timer);reject(e);};
  this.check=()=>{if(this.buffer.includes(marker)){clearTimeout(timer);this.check=null;this.reject=null;const out=this.buffer.replace(marker,'').trim();this.buffer='';resolve(out);}};
  this.child.stdin.write(`${text}\n\\echo ${marker}\n`);});}
 close():Promise<void>{if(!this.closed){this.closed=true;this.reject=null;if(!this.child.stdin.destroyed&&!this.child.stdin.writableEnded)this.child.stdin.end('rollback;\n\\q\n');}
  return this.child.exitCode!==null?Promise.resolve():new Promise(r=>this.child.once('exit',()=>r()));}
}
const sessions:Session[]=[];
async function session(label:string){const s=new Session(`coach_${label}_${randomUUID().slice(0,8)}`);sessions.push(s);await s.run(`set application_name='${s.name}';set statement_timeout='8s';`);return s;}
async function blocked(name:string){for(let i=0;i<150;i++){if(sql(`select exists(select 1 from pg_stat_activity where application_name='${name}' and wait_event_type='Lock');`)==='t')return;await sleep(20);}throw Error(`${name} never waited on a lock`);}
const last=(out:string)=>JSON.parse(out.split('\n').pop()!);
const q=(v:string)=>`'${v.replaceAll("'","''")}'`;
const asService=`select set_config('request.jwt.claims','{"role":"service_role"}',true);set local role service_role;`;
const asMember=(m:string)=>`select set_config('request.jwt.claims',${q(JSON.stringify({sub:m,role:'authenticated',amr:[{method:'otp'}],session_id:m}))},true);set local role authenticated;`;
const svc=(call:string)=>JSON.parse(sql(`begin;${asService}select (${call})::jsonb::text;commit;`).split('\n').pop()!);

// The worker's RPCs, as the service role, one transaction each (what supabase-js does through PostgREST).
const lit=(k:string,v:unknown)=>v===null||v===undefined?'null':k==='p_runs'?q(`{${(v as string[]).join(',')}}`):typeof v==='object'?q(JSON.stringify(v)):q(String(v));
const rpc:ZoeRpc=async(name,args)=>{
 const params=Object.entries(args).map(([k,v])=>`${k}=>${lit(k,v)}`).join(',');
 const out=sql(`begin;${asService}select coalesce(to_jsonb(public.${name}(${params})),'null'::jsonb)::text;commit;`);
 return JSON.parse(out.split('\n').pop()!);
};

const P='e1c10000-0000-4000-8000-';
const id=(n:number)=>`${P}${String(n).padStart(12,'0')}`;
const M=[1,2,3,4,5,6].map(id),DOC=id(11),ADMIN=id(14),CLINIC=id(20);
const env={NOREON_ZOE_URGENT_PLACEHOLDER:'true',NOREON_ZOE_TEST_LEXICON:'false'};
const ev=(m:string,k='checkin')=>JSON.parse(sql(`select coalesce((select to_jsonb(e) from public.coach_events e where member_id='${m}' and kind='${k}'),'null'::jsonb)::text;`));
const publishArg=JSON.stringify({outcome:'publish',body:'Synthetic weekly check-in. How did the week go?',language:'en',provider:'vercel.ai_gateway',model:'anthropic/claude-sonnet-5.5',configVersion:'coach-race',costUsd:0});
// Why a claim came back empty (Astra N2-2): the member's rows, the clock, and every other session with what blocks it.
const diagnose=(m:string)=>sql(`select json_build_object('now',clock_timestamp(),'events',(select json_agg(json_build_object('kind',kind,'state',state,'reason',reason,'due',due_at,'retry',retry_at,'claimed',claimed_at)) from public.coach_events where member_id='${m}'),
 'sessions',(select json_agg(json_build_object('pid',pid,'app',application_name,'state',state,'wait',wait_event_type||':'||wait_event,'blockedBy',pg_blocking_pids(pid),'xact',xact_start,'query',left(query,120))) from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid() and backend_type='client backend'),
 'locks',(select json_agg(json_build_object('pid',pid,'type',locktype,'mode',mode,'granted',granted,'rel',relation::regclass::text,'obj',objid)) from pg_locks where pid<>pg_backend_pid() and locktype in('relation','tuple','transactionid','advisory') and not(locktype='relation' and granted)))::text;`);
const claimRun=(m:string)=>{const j=svc('public.zoe_coach_claim(10)');const job=j.jobs.find((x:{memberId:string})=>x.memberId===m);assert.ok(job,`claimed for ${m}: ${JSON.stringify(j)} ${job?'':diagnose(m)}`);return job.runId as string;};

for(const t of ['zoe_settings','conversation_policy','telegram_channel_settings'])
 assert.equal(sql(`select count(*) from public.${t};`),'0',`Race runner needs no ${t} row (an isolated, freshly replayed database)`);
try{
 sql(`begin;
 insert into auth.users(id,phone,phone_confirmed_at) select u,'3749904'||right(u::text,4),now() from unnest(array['${M.join("','")}']::uuid[])u;
 insert into auth.users(id) values('${DOC}'),('${ADMIN}');
 insert into auth.sessions(id,user_id,created_at,updated_at) select u,u,now()-interval '1 hour',now() from unnest(array['${[...M,DOC,ADMIN].join("','")}']::uuid[])u;
 insert into public.workspace_clinics(id,name) values('${CLINIC}','Synthetic coach race clinic');
 insert into public.workspace_staff(user_id,role,display_name,clinic_id) values('${DOC}','doctor','Dr Coach Race','${CLINIC}');
 insert into public.workspace_staff(user_id,role,display_name) values('${ADMIN}','admin','Admin Coach Race');
 insert into public.patient_clinical_cases(user_id,assigned_doctor_id) select u,'${DOC}' from unnest(array['${M.join("','")}']::uuid[])u;
 update public.profiles set locale='en',display_name='Coach Race' where id in('${M.join("','")}');
 insert into public.patient_care_plans(id,user_id,clinician,instructions) select ('${P}'||lpad((100+n)::text,12,'0'))::uuid,('${P}'||lpad(n::text,12,'0'))::uuid,'Dr Coach Race','Synthetic plan.' from generate_series(1,6)n;
 insert into public.patient_clinical_publications(user_id,plan_id,request_id,actor_id,case_revision,evidence_token,evidence,review,draft)
  select ('${P}'||lpad(n::text,12,'0'))::uuid,('${P}'||lpad((100+n)::text,12,'0'))::uuid,gen_random_uuid(),'${DOC}',n,'synthetic','{}','{}','{}' from generate_series(1,6)n;
 insert into public.patient_reminder_preferences(user_id,preferences) select u,'{"quietStart":"03:00","quietEnd":"03:00"}' from unnest(array['${M.join("','")}']::uuid[])u;
 insert into public.conversation_policy(singleton,version,grant_seconds,intent_seconds,intake_window_seconds,intake_max_messages,synthetic_engine,delivery_enabled,app_chat_enabled)
  values(true,'synthetic-coach-race',3600,600,60,40,false,true,true);
 insert into public.telegram_channel_settings(account,bot_id,link_token_seconds,consent_version) values('noreon_coach_race',9041,600,'consent-coach-race');
 insert into public.telegram_auth_bindings(auth_user_id,kind,principal_ref,account_ref,phone,address,generation)
  select '${M[3]}'::uuid,'member','fictional-coach-race-04',public._telegram_account_ref(s),'+374990420004','5559404',1 from public.telegram_channel_settings s
  union all select '${M[4]}'::uuid,'member','fictional-coach-race-05',public._telegram_account_ref(s),'+374990420005','5559405',1 from public.telegram_channel_settings s;
 insert into public.system_message_templates(template_id,version,locale,body,approved,approval_note) values
  ('member.zoe_coach_teaser',90,'en','Synthetic race teaser.',true,'race fixture'),('member.zoe_coach_teaser',90,'hy','Synthetic race teaser HY.',true,'race fixture');
 insert into public.zoe_settings(singleton,consent_collection_enabled,consent_wording_version,staging_ai_mode,coach_window_start,coach_window_end,coach_checkins_wording_version)
  values(true,true,'zoe-consent-draft-1',true,'00:00','23:59:59.999999','coach-checkins-race-1');
 insert into public.zoe_eval_runs(tier,model_id,fallback_model_id,mode,harness_version,total_rows,must_failures,failures,requested_by)
  select tier,model_id,fallback_model_id,'model','zoe-check+model+rows-510+chat-33',510,0,0,'${ADMIN}' from public.zoe_tier_config;
 update public.zoe_settings set model_calls_allowed=true;
 update public.zoe_settings set conversational_replies_enabled=true;
 update public.zoe_settings set health_answers_enabled=true,coach_enabled=true;
 insert into public.zoe_consents(member_id,kind,granted,wording_version) select u,k,true,case k when 'zoe_reads_messages' then 'zoe-consent-draft-1' else 'coach-checkins-race-1' end
  from unnest(array['${M.join("','")}']::uuid[])u,unnest(array['zoe_reads_messages','zoe_coach_checkins'])k;
 commit;`);

 // A. Coach publication against an inbound red-flag reply --------------------------------------------------------------
 svc(`public.zoe_coach_schedule('${M[0]}','checkin',clock_timestamp())`);
 const runA=claimRun(M[0]);
 const member=await session('member'),coach=await session('publish');
 const sent=last(await member.run(`begin;${asMember(M[0])}select public.conversation_receive(${q(JSON.stringify({requestId:randomUUID(),text:'I have crushing chest pain right now'}))})::text;`));
 assert.equal(sent.ok,true,'the red-flag reply is received');
 const pending=coach.run(`begin;${asService}select public.zoe_coach_finish('${runA}',${q(publishArg)})::text;`);
 await blocked(coach.name);
 await member.run('commit;');
 const pub=last(await pending);await coach.run('commit;');
 assert.equal(pub.outcome,'discarded','A: publication refused');
 assert.equal(pub.reason,'coach_publication_refused_member_message_since_claim','A: because the member wrote after the claim');
 assert.equal(sql(`select count(*) from public.zoe_coach_messages where member_id='${M[0]}';`),'0','A: no coach text stored');
 assert.equal(ev(M[0]).state,'deferred','A: the coach row waits');
 const report=await runZoeSweep(rpc,{provider:createFakeProvider(),env});
 assert.ok(report.claimed>=1&&report.failed===0,`A: the inbound sweep claimed the reply: ${JSON.stringify(report)}`);
 const inbound=JSON.parse(sql(`select to_jsonb(z)::text from public.zoe_runs z where member_id='${M[0]}' and kind='inbound' order by started_at desc limit 1;`));
 assert.equal(inbound.state,'finished','A: the inbound run finished');
 assert.equal(inbound.reason_code,'urgent_route_no_model_call','A: the urgent route ran, no model call');
 assert.equal(sql(`select count(*) from public.zoe_member_answers where member_id='${M[0]}' and kind='urgent';`),'1','A: the 103 text was given');
 sql(`update public.coach_events set retry_at=clock_timestamp()-interval '1 second' where member_id='${M[0]}' and state='deferred';`);
 svc('public.zoe_coach_claim(10)');
 assert.deepEqual([ev(M[0]).state,ev(M[0]).reason],['cancelled','urgent_window'],'A: after the urgent route the coach row is cancelled (103 window)');

 // B. Concurrent sweeps and schedules ------------------------------------------------------------------------------------
 // Rows of tomorrow's week, eligible now: on Sunday a same-week retry would be past the week's end.
 svc(`public.zoe_coach_schedule('${M[1]}','checkin',clock_timestamp()+interval '1 day')`);svc(`public.zoe_coach_schedule('${M[1]}','nudge',clock_timestamp()+interval '1 day')`);
 sql(`select public._zoe_coach_move(id,'deferred','synthetic',now()) from public.coach_events where member_id='${M[1]}';`);
 const s1=await session('sweep1'),s2=await session('sweep2');
 const j1=last(await s1.run(`begin;${asService}select public.zoe_coach_claim(10)::text;`));
 const j2=last(await s2.run(`begin;${asService}select public.zoe_coach_claim(10)::text;`));
 await s1.run('commit;');await s2.run('commit;');
 const mine=(j:{jobs:{memberId:string}[]})=>j.jobs.filter(x=>x.memberId===M[1]).length;
 assert.equal(mine(j1)+mine(j2),1,'B: two sweeps at once: one coach run for the member');
 assert.equal(sql(`select count(*) from public.zoe_runs where member_id='${M[1]}' and kind<>'inbound';`),'1','B: one run row');
 assert.equal(sql(`select string_agg(state||':'||coalesce(reason,''),',' order by kind) from public.coach_events where member_id='${M[1]}';`),'generating:,deferred:cap_daily','B: the second row waits for the daily cap');
 const a1=await session('sched1'),a2=await session('sched2');
 await a1.run(`begin;${asService}select public.zoe_coach_schedule('${M[2]}','checkin',clock_timestamp())::text;`);
 const p2=a2.run(`begin;${asService}select public.zoe_coach_schedule('${M[2]}','checkin',clock_timestamp())::text;`);
 await blocked(a2.name);await a1.run('commit;');
 assert.equal(last(await p2).replayed,true,'B: the second schedule returns the first row');await a2.run('commit;');
 assert.equal(sql(`select count(*) from public.coach_events where member_id='${M[2]}';`),'1','B: one row per member, kind and week');

 // C. A doctor takeover during publication ------------------------------------------------------------------------------
 const runC=claimRun(M[2]);
 const doctor=await session('takeover'),pubC=await session('publishC');
 await doctor.run(`begin;select id from public.conversations where member_id='${M[2]}' for update;
  insert into public.zoe_doctor_mode(conversation_id,member_id,doctor_mode,changed_by,reason) select id,'${M[2]}',true,'${DOC}','doctor_reply' from public.conversations where member_id='${M[2]}';`);
 const pc=pubC.run(`begin;${asService}select public.zoe_coach_finish('${runC}',${q(publishArg)})::text;`);
 await blocked(pubC.name);await doctor.run('commit;');
 const c=last(await pc);await pubC.run('commit;');
 assert.equal(c.reason,'coach_publication_refused_coach_event_cancelled','C: the takeover cancelled the row first; publication refused');
 assert.equal(sql(`select count(*) from public.zoe_coach_messages where member_id='${M[2]}';`),'0','C: nothing stored');
 assert.deepEqual([ev(M[2]).state,ev(M[2]).reason],['cancelled','doctor_takeover'],'C: cancelled for the takeover');

 // D. A consent withdrawal during the Telegram claim ---------------------------------------------------------------------
 svc(`public.zoe_coach_schedule('${M[3]}','checkin',clock_timestamp())`);
 const runD=claimRun(M[3]);
 assert.equal(svc(`public.zoe_coach_finish('${runD}',${q(publishArg)})`).outcome,'published','D: published');
 const qd=svc(`public.zoe_coach_queue_teaser('${ev(M[3]).id}')`);assert.equal(qd.channel,'telegram','D: teaser queued');
 const withdraw=await session('withdraw'),tg=await session('tgclaim');
 await withdraw.run(`begin;${asMember(M[3])}select public.zoe_coach_consent_set('zoe_coach_checkins',false,'coach-checkins-race-1','settings')::text;`);
 const busy=last(await tg.run(`begin;${asService}select public.telegram_auth_message_claim('${qd.telegramMessageId}',gen_random_uuid())::text;`));await tg.run('commit;');
 assert.deepEqual(busy,{ok:false,code:'busy'},'D: the claim does not wait on the withdrawal');
 await withdraw.run('commit;');
 const after=svc(`public.telegram_auth_message_claim('${qd.telegramMessageId}',gen_random_uuid())`);
 assert.equal(after.ok,false,'D: not sent after the withdrawal');
 assert.equal(sql(`select state||':'||reason from public.telegram_auth_messages where id='${qd.telegramMessageId}';`),'held:coach_cancelled','D: the teaser is held');
 assert.equal(sql(`select count(*) from public.telegram_auth_message_attempts where message_id='${qd.telegramMessageId}';`),'0','D: no send attempt');
 assert.deepEqual([ev(M[3]).state,ev(M[3]).reason],['cancelled','no_coach_consent'],'D: cancelled');
 // E. A red-flag reply racing the Telegram claim of a published teaser (Astra C0-01) ---------------------------------
 svc(`public.zoe_coach_schedule('${M[4]}','checkin',clock_timestamp())`);
 const runE=claimRun(M[4]);
 assert.equal(svc(`public.zoe_coach_finish('${runE}',${q(publishArg)})`).outcome,'published','E: published');
 const qe=svc(`public.zoe_coach_queue_teaser('${ev(M[4]).id}')`);assert.equal(qe.channel,'telegram','E: teaser queued');
 const memE=await session('memberE'),tgE=await session('tgclaimE');
 assert.equal(last(await memE.run(`begin;${asMember(M[4])}select public.conversation_receive(${q(JSON.stringify({requestId:randomUUID(),text:'I have crushing chest pain right now'}))})::text;`)).ok,true,'E: reply received');
 const busyE=last(await tgE.run(`begin;${asService}select public.telegram_auth_message_claim('${qe.telegramMessageId}',gen_random_uuid())::text;`));await tgE.run('commit;');
 assert.deepEqual(busyE,{ok:false,code:'busy'},'E: the claim does not send while the member message is being written');
 await memE.run('commit;');
 const afterE=svc(`public.telegram_auth_message_claim('${qe.telegramMessageId}',gen_random_uuid())`);
 assert.deepEqual(afterE,{ok:false,code:'coach_deferred'},'E: after the message: deferred, not sent');
 assert.equal(ev(M[4]).reason,'inbound_pending','E: inbound first');
 assert.equal(sql(`select count(*) from public.telegram_auth_message_attempts where message_id='${qe.telegramMessageId}';`),'0','E: no send attempt');
 await runZoeSweep(rpc,{provider:createFakeProvider(),env});
 assert.equal(sql(`select reason_code from public.zoe_runs where member_id='${M[4]}' and kind='inbound' order by started_at desc limit 1;`),'urgent_route_no_model_call','E: the urgent route ran');
 sql(`update public.coach_events set retry_at=clock_timestamp()-interval '1 second' where member_id='${M[4]}' and state='deferred';`);svc('public.zoe_coach_claim(10)');
 assert.equal(ev(M[4]).state,'cancelled','E: the coach row is cancelled after the urgent route');

 // F. Busy members are skipped, not waited for (Astra N2) ---------------------------------------------------------------
 const due=()=>sql(`update public.coach_events set retry_at=null,due_at=clock_timestamp()-interval '1 second' where member_id='${M[5]}' and state in('scheduled','deferred');`);
 svc(`public.zoe_coach_schedule('${M[5]}','checkin',clock_timestamp())`);due();
 sql(`insert into public.conversations(member_id) values('${M[5]}') on conflict(member_id) do nothing;`);
 const hasJob=(j:{jobs:{memberId:string}[]})=>j.jobs.some(x=>x.memberId===M[5]);
 const holder=await session('holder'),sweepF=await session('sweepF');
 // F1. Another transaction holds the member's coach lock: skipped, unchanged; one claim after release.
 await holder.run(`begin;select pg_advisory_xact_lock(hashtextextended('zoe-coach:${M[5]}',0));`);
 const f1=last(await sweepF.run(`begin;${asService}select public.zoe_coach_claim(10)::text;`));await sweepF.run('commit;');
 assert.ok(!hasJob(f1),`F1: a held coach lock is skipped: ${diagnose(M[5])}`);assert.equal(ev(M[5]).state,'scheduled','F1: the row is unchanged');
 await holder.run('rollback;');
 // F2. Another transaction holds the event row: skipped, unchanged.
 await holder.run(`begin;select id from public.coach_events where member_id='${M[5]}' for update;`);
 const f2=last(await sweepF.run(`begin;${asService}select public.zoe_coach_claim(10)::text;`));await sweepF.run('commit;');
 assert.ok(!hasJob(f2),'F2: a held event row is skipped');assert.equal(ev(M[5]).state,'scheduled','F2: the row is unchanged');
 await holder.run('rollback;');
 // F3. A doctor's reply holds the conversation row, the claim runs, then the takeover writes doctor mode (its trigger takes the coach
 // lock). Before the fix the claim waited on the conversation while holding the coach lock: a deadlock. Now the claim skips at once.
 await holder.run(`begin;select id from public.conversations where member_id='${M[5]}' for update;`);
 const t0=Date.now();
 const f3=last(await sweepF.run(`begin;${asService}select public.zoe_coach_claim(10)::text;`));
 assert.ok(Date.now()-t0<3000&&!hasJob(f3),`F3: the claim skips the busy conversation without waiting: ${diagnose(M[5])}`);
 const take=holder.run(`insert into public.zoe_doctor_mode(conversation_id,member_id,doctor_mode,changed_by,reason) select id,'${M[5]}',true,'${DOC}','doctor_reply' from public.conversations where member_id='${M[5]}';`);
 await sweepF.run('commit;');await take;await holder.run('commit;');
 assert.deepEqual([ev(M[5]).state,ev(M[5]).reason],['cancelled','doctor_takeover'],'F3: the takeover committed and cancelled the row');
 assert.ok(!hasJob(svc('public.zoe_coach_claim(10)')),'F3: a later claim respects the cancellation');
 assert.equal(sql(`select count(*) from public.zoe_runs where member_id='${M[5]}' and kind<>'inbound';`),'0','F3: no coach run');
 console.log('zoe-coach-races: ok');
}finally{
 // Wait for every session to exit, so no open transaction holds a row the cleanup deletes (Astra N2-2).
 await Promise.all(sessions.map(s=>s.close()));
 // Synthetic rows only (this prefix), with triggers off so append-only journals and FK order do not block the cleanup.
 const ids=`array['${[...M,DOC,ADMIN].join("','")}']::uuid[]`;
 sql(`begin;set local session_replication_role=replica;
 delete from public.conversation_messages where conversation_id in(select id from public.conversations where member_id = any(${ids}));
 delete from public.conversation_audit where conversation_id in(select id from public.conversations where member_id = any(${ids}));
 do $$declare r record;begin
  for r in select c.table_schema,c.table_name,c.column_name from information_schema.columns c join information_schema.tables t on t.table_schema=c.table_schema and t.table_name=c.table_name
   where c.table_schema='public' and t.table_type='BASE TABLE' and c.column_name in('member_id','user_id','auth_user_id','actor_id','requested_by') and c.data_type='uuid' loop
   execute format('delete from %I.%I where %I = any(${ids.replaceAll("'","''")})',r.table_schema,r.table_name,r.column_name);
  end loop;end$$;
 delete from public.telegram_auth_message_attempts where message_id in(select id from public.telegram_auth_messages where address in('5559404','5559405'));
 delete from public.telegram_auth_messages where address in('5559404','5559405');
 delete from public.system_message_templates where template_id='member.zoe_coach_teaser' and approval_note='race fixture';
 delete from public.workspace_clinics where id='${CLINIC}';
 delete from public.zoe_settings;delete from public.conversation_policy where version='synthetic-coach-race';
 delete from public.telegram_channel_settings where account='noreon_coach_race';
 delete from public.profiles where id = any(${ids});delete from auth.sessions where user_id = any(${ids});delete from auth.users where id = any(${ids});
 commit;`);
}
