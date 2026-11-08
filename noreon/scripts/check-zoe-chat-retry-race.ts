/**
 * Zoe chat cards, Astra ZCA-POST-01: one send in flight per card, retries included. Real two-session races on the
 * local database (NOREON_TEST_DB_CONTAINER): each session runs what sendFromCard does (claim with a lease, the send
 * held in flight, record, release) in its own connection. After a text A was refused (rate limited):
 * 1. retry A is in flight, then an edited text B is confirmed in another tab;
 * 2. B is in flight, then A is retried;
 * 3. retry A and B are confirmed at the same instant (10 rounds).
 * Each must store exactly one distinct message. The message store is a scratch table standing in for
 * conversation_receive and, like it, stores a request id once. Committed fixtures, removed at the end; the switches are put back as they were.
 */
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';

const container=process.env.NOREON_TEST_DB_CONTAINER;
assert.ok(container&&container.startsWith('supabase_db_'),'Set NOREON_TEST_DB_CONTAINER to a local Supabase database container');
const PSQL=['exec','-i',container,'psql','-U','postgres','-X','-q','-t','-A','-v','ON_ERROR_STOP=1'];
const sql=(input:string)=>{
 const r=spawnSync('docker',PSQL,{input,encoding:'utf8'});
 if(r.status!==0)throw Error(r.stderr);
 return r.stdout.trim();
};
const session=(input:string)=>new Promise<string>((resolve,reject)=>{
 const p=spawn('docker',PSQL);let out='',err='';
 p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);
 p.on('close',code=>code===0?resolve(out.trim()):reject(Error(err)));
 p.stdin.end(input);
});

const M='ae000000-0000-4000-8000-000000000001';
const before=sql(`select coalesce((select app_chat_enabled||','||zoe_chat_actions_enabled from public.conversation_policy where singleton),'none')`);
sql(`create schema if not exists zca_race;create table if not exists zca_race.sent(card uuid,text text,request_id uuid,unique(card,request_id));
insert into auth.users(id,phone,phone_confirmed_at)values('${M}','37499095001',now())on conflict(id)do nothing;
insert into public.conversation_policy(singleton,version,grant_seconds,intent_seconds,intake_window_seconds,intake_max_messages)values(true,'zca-race',600,600,600,10)on conflict(singleton)do nothing;
update public.conversation_policy set app_chat_enabled=true,zoe_chat_actions_enabled=true where singleton;`);

const claimSql=(card:string,item:string,op:string,text:string)=>
 `select coalesce(j->>'attempt','') as attempt,j->'claim'->>'op' as op,j->>'code' as code from(select public.zoe_chat_card_claim('${M}','${card}','${item}','${op}',jsonb_build_object('text','${text}'))j)x \\gset`;
/** One sendFromCard in its own session: starts at `at` (epoch seconds), holds its send for `hold` seconds, then the chat send answers `result`. */
const attempt=(card:string,item:string,text:string,at:number,hold:number,result:'sent'|'rate_limited')=>session(`
select pg_sleep(greatest(0,${at}-extract(epoch from clock_timestamp())));
set role service_role;
${claimSql(card,item,randomUUID(),text)}
select :'attempt'<>'' as won \\gset
\\if :won
 select pg_sleep(${hold});
 ${result==='sent'
  ?`reset role;insert into zca_race.sent values('${card}','${text}',:'op')on conflict do nothing;set role service_role;
 select public.zoe_chat_card_record('${M}','${card}','${item}',jsonb_build_object('requestId',:'op'),true);`
  :`select public.zoe_chat_card_record('${M}','${card}','fail:${item.slice(5)}','{"status":"rate_limited"}',false);`}
 select public.zoe_chat_card_release('${M}','${card}',:'attempt'::uuid);
 select 'went ${text}';
\\else
 select 'refused ${text} '||coalesce(:'code','');
\\endif`);

/** A message card whose first text A was refused: claimed, recorded as not sent, its attempt ended. */
function refusedCard(){
 const card=randomUUID();
 sql(`insert into public.zoe_chat_cards(id,member_id,request_id,kind,source,snapshot)values('${card}','${M}',gen_random_uuid(),'message','chip','{"v":1}');`);
 sql(`set role service_role;\n${claimSql(card,'sent:aaa',randomUUID(),'Text A')}
select public.zoe_chat_card_record('${M}','${card}','fail:aaa','{"status":"rate_limited"}',false);
select public.zoe_chat_card_release('${M}','${card}',:'attempt'::uuid);`);
 return card;
}
const stored=(card:string)=>sql(`select string_agg(distinct text,'|' order by text) from zca_race.sent where card='${card}'`);
const now=()=>Number(sql(`select extract(epoch from clock_timestamp())`));

try{
 {// 1. Retry A in flight, then B.
  const card=refusedCard(),t=now()+1.5;
  const [a,b]=await Promise.all([attempt(card,'sent:aaa','Text A',t,1.5,'sent'),attempt(card,'sent:bbb','Text B',t+0.5,0,'sent')]);
  assert.match(a,/went Text A/);assert.match(b,/refused Text B busy/);
  assert.equal(stored(card),'Text A','retry A then B: one distinct message');
  console.log('race 1 (retry A in flight, then B):',a.split('\n').at(-1),'/',b.split('\n').at(-1));
 }
 {// 2. B in flight, then retry A.
  const card=refusedCard(),t=now()+1.5;
  const [b,a]=await Promise.all([attempt(card,'sent:bbb','Text B',t,1.5,'sent'),attempt(card,'sent:aaa','Text A',t+0.5,0,'sent')]);
  assert.match(b,/went Text B/);assert.match(a,/refused Text A busy/);
  assert.equal(stored(card),'Text B','B then retry A: one distinct message');
  console.log('race 2 (B in flight, then retry A):',b.split('\n').at(-1),'/',a.split('\n').at(-1));
 }
 {// 3. The same instant, 10 rounds: whichever claims first is the only one sent.
  const winners:string[]=[];
  for(let i=0;i<10;i++){
   const card=refusedCard(),t=now()+1;
   const out=await Promise.all([attempt(card,'sent:aaa','Text A',t,0.3,'sent'),attempt(card,'sent:bbb','Text B',t,0.3,'sent')]);
   assert.equal(out.filter(o=>/went Text/.test(o)).length,1,`round ${i+1}: exactly one send`);
   const s=stored(card);
   assert.ok(s==='Text A'||s==='Text B',`round ${i+1}: one distinct message (${s})`);
   winners.push(s);
  }
  console.log('race 3 (same instant, 10 rounds): one message each round; winners',winners.join(','));
 }
 {// 4. Retry A refused again while a second retry of A (another tab) is still going: B still waits.
  const card=refusedCard(),t=now()+1.5;
  const [a1,a2,b]=await Promise.all([attempt(card,'sent:aaa','Text A',t,0.2,'rate_limited'),attempt(card,'sent:aaa','Text A',t+0.1,2,'sent'),attempt(card,'sent:bbb','Text B',t+1,0,'sent')]);
  assert.match(a1,/went Text A/);assert.match(a2,/went Text A/);assert.match(b,/refused Text B busy/);
  assert.equal(stored(card),'Text A','overlapping retries: one distinct message');
  console.log('race 4 (overlapping retries, one refused): B',b.split('\n').at(-1));
 }
 {// 5. Two tabs retry A at once and both sends succeed: one request id stored, and the card records that one.
  const card=refusedCard(),t=now()+1.5;
  const [x,y]=await Promise.all([attempt(card,'sent:aaa','Text A',t,0.5,'sent'),attempt(card,'sent:aaa','Text A',t,0.5,'sent')]);
  assert.match(x,/went Text A/);assert.match(y,/went Text A/);
  assert.equal(sql(`select count(*) from zca_race.sent where card='${card}'`),'1','one stored message for one request id');
  assert.equal(sql(`select (select request_id::text from zca_race.sent where card='${card}')=(select outcome#>>'{sent:aaa,requestId}' from public.zoe_chat_cards where id='${card}')`),'t','the card records the stored request id');
  assert.equal(sql(`select send_attempts::text from public.zoe_chat_cards where id='${card}'`),'{}','both leases released');
  console.log('race 5 (same text from two tabs, both succeed): one stored request id');
 }
 console.log('check-zoe-chat-retry-race: all checks passed');
}finally{
 const [chat,cards]=before==='none'?[null,null]:before.split(',');
 sql(`drop schema zca_race cascade;delete from public.zoe_chat_cards where member_id='${M}';delete from auth.users where id='${M}';
${chat===null?`delete from public.conversation_policy where version='zca-race';`:`update public.conversation_policy set app_chat_enabled=${chat==='t'},zoe_chat_actions_enabled=${cards==='t'} where singleton;`}`);
}
