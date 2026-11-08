// WP R: realtime client logic with a fake socket and a fake clock (no network, no database).
// Run: node --no-warnings --conditions=noreon-server-test --import ./scripts/register-alias.mjs scripts/check-realtime-client.ts
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {backoffDelay,liveDue,parseSignal,refreshDelay,relaxedInterval,REALTIME_TIMING,RELAXED_MAX_MS,type RealtimeToken} from '@/lib/realtime/contracts';
import {createRealtimeController,type RealtimePorts,type SocketHandlers,type TokenResult} from '@/lib/realtime/controller';
import {memberPollDue,PENDING_LIVE_MS} from '@/lib/realtime/poll';
import {fetchRealtimeToken} from '@/lib/realtime/client';
import {createRealtimeTokenHandler,realtimeEnabled,tokenFor} from '@/lib/realtime/token-http';
import {pruneRealtimeSignals} from '@/lib/realtime/retention';
import {ZOE_POLL,ZOE_POLL_IDLE,pollAfterSend,pollDue} from '@/lib/zoe/app-chat-contracts';

const USER='5ea0f000-0000-4000-8000-000000000201',OTHER='5ea0f000-0000-4000-8000-000000000202';
const token=(userId=USER,expiresAt=Math.floor(Date.UTC(2026,10,8,12,0,0)/1000)+3600,accessToken='header.payload.signature-1'):RealtimeToken=>({accessToken,userId,expiresAt});
const row=(over:Record<string,unknown>={})=>({id:1,recipient_user_id:USER,kind:'member_thread',ref_id:'c1',created_at:'2026-11-08T12:00:00Z',...over});

// A fake clock with timers that run in time order.
function clock(start=Date.UTC(2026,10,8,12,0,0)){
 let now=start,next=1;
 const timers=new Map<number,{at:number;run:()=>void}>();
 return {
  now:()=>now,
  setTimer:(run:()=>void,ms:number)=>{const id=next++;timers.set(id,{at:now+ms,run});return id;},
  clearTimer:(id:unknown)=>{timers.delete(id as number);},
  pending:()=>[...timers.values()].map(t=>t.at-now).sort((a,b)=>a-b),
  async advance(ms:number){
   const end=now+ms;
   for(;;){
    const due=[...timers.entries()].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];
    if(!due)break;
    timers.delete(due[0]);now=due[1].at;due[1].run();
    await flush();
   }
   now=end;await flush();
  },
 };
}
const flush=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};

// A fake socket: records connects, auth updates and closes; the test drives statuses and rows.
function harness(results:TokenResult[]){
 const c=clock();
 const sockets:{token:RealtimeToken;handlers:SocketHandlers;auth:string[];closed:boolean}[]=[];
 const tokenCalls:string[]=[];
 const ports:RealtimePorts={
  token:async plane=>{tokenCalls.push(plane);return results.length>1?results.shift()!:results[0];},
  connect:(_plane,t,handlers)=>{const s={token:t,handlers,auth:[t.accessToken],closed:false};sockets.push(s);return {setAuth:a=>{s.auth.push(a);},close:()=>{s.closed=true;}};},
  now:c.now,setTimer:c.setTimer,clearTimer:c.clearTimer,random:()=>0,
 };
 const signals:string[]=[],states:string[]=[];let resyncs=0;
 const controller=createRealtimeController(ports,{plane:'member',onSignal:(k,r)=>signals.push(`${k}:${r}`),onResync:()=>{resyncs++;},onState:s=>states.push(s)});
 return {c,sockets,tokenCalls,controller,signals,states,resyncs:()=>resyncs};
}

// 1. Contracts ---------------------------------------------------------------------------------------------------------
assert.deepEqual(parseSignal(row(),USER),{kind:'member_thread',ref:'c1'},'A row for this user parses to kind and ref');
assert.equal(parseSignal(row({recipient_user_id:OTHER}),USER),null,'A row for another recipient is ignored');
assert.equal(parseSignal(row({kind:'message_text'}),USER),null,'An unknown kind is ignored');
assert.equal(parseSignal({nope:true},USER),null,'A malformed row is ignored');
assert.equal(backoffDelay(0,()=>0),1_000);assert.equal(backoffDelay(3,()=>0),8_000);assert.equal(backoffDelay(30,()=>0),REALTIME_TIMING.BACKOFF_MAX_MS,'Backoff is capped');
assert.equal(backoffDelay(0,()=>1),1_300,'Jitter adds at most 30%');
const t0=Date.UTC(2026,10,8,12,0,0);
assert.equal(refreshDelay(t0/1000+3600,t0),3600_000-REALTIME_TIMING.REFRESH_BEFORE_MS,'The token is refreshed before it expires');
assert.equal(refreshDelay(t0/1000+10,t0),REALTIME_TIMING.MIN_REFRESH_MS,'Never in a tight loop');
assert.equal(relaxedInterval(60_000,false),60_000,'Unhealthy: the existing interval');
assert.equal(relaxedInterval(60_000,true),240_000,'Healthy: relaxed');
assert.equal(relaxedInterval(120_000,true),RELAXED_MAX_MS,'Never slower than the cap');
console.log('PASS contracts');

// 2. Subscribe, signal -> one re-read per kind and ref (coalesced) -----------------------------------------------------
{
 const h=harness([{status:'ok',token:token()}]);
 h.controller.start();await flush();
 assert.equal(h.tokenCalls.length,1,'start fetches one token');
 assert.equal(h.sockets.length,1,'and connects once');
 assert.equal(h.controller.healthy(),false,'Not healthy before SUBSCRIBED');
 h.sockets[0].handlers.onStatus('subscribed');
 assert.equal(h.controller.healthy(),true,'Healthy once subscribed');
 h.sockets[0].handlers.onRow(row());h.sockets[0].handlers.onRow(row({id:2}));h.sockets[0].handlers.onRow(row({id:3,kind:'member_cards',ref_id:'k1'}));
 h.sockets[0].handlers.onRow(row({id:4,recipient_user_id:OTHER}));
 assert.deepEqual(h.signals,[],'Signals wait for the coalescing window');
 await h.c.advance(REALTIME_TIMING.COALESCE_MS);
 assert.deepEqual(h.signals,['member_thread:c1','member_cards:k1'],'Two rows of one kind and ref are one re-read; another user\'s row never reaches the screen');
 assert.equal(h.resyncs(),0,'The first subscribe is no resync');
 h.controller.stop();
 assert.equal(h.sockets[0].closed,true,'stop closes the socket');
 assert.equal(h.controller.state(),'idle');
 console.log('PASS subscribe and signal');
}

// 3. Token refresh before expiry; another account reconnects -----------------------------------------------------------
{
 const first=token(USER,Math.floor(Date.UTC(2026,10,8,12,0,0)/1000)+600,'header.payload.signature-1');
 const second=token(USER,Math.floor(Date.UTC(2026,10,8,12,0,0)/1000)+4200,'header.payload.signature-2');
 const third=token(OTHER,Math.floor(Date.UTC(2026,10,8,12,0,0)/1000)+8000,'header.payload.signature-3');
 const h=harness([{status:'ok',token:first},{status:'ok',token:second},{status:'ok',token:third}]);
 h.controller.start();await flush();h.sockets[0].handlers.onStatus('subscribed');
 await h.c.advance(600_000-REALTIME_TIMING.REFRESH_BEFORE_MS-1);
 assert.equal(h.tokenCalls.length,1,'No refresh before its time');
 await h.c.advance(1);
 assert.equal(h.tokenCalls.length,2,'The token is fetched again before expiry');
 assert.deepEqual(h.sockets[0].auth,['header.payload.signature-1','header.payload.signature-2'],'and handed to the live socket (setAuth), without reconnecting');
 assert.equal(h.sockets.length,1);
 await h.c.advance(4200_000-600_000);
 assert.equal(h.tokenCalls.length,3,'The next refresh follows the new expiry');
 assert.equal(h.sockets.length,2,'A token for another account opens a new subscription for that account');
 assert.equal(h.sockets[0].closed,true,'and closes the old one');
 assert.equal(h.sockets[1].token.userId,OTHER);
 h.controller.stop();
 console.log('PASS token refresh');
}

// 4. Reconnect with backoff; resync after a reconnect; off stops ---------------------------------------------------------
{
 const h=harness([{status:'ok',token:token()}]);
 h.controller.start();await flush();h.sockets[0].handlers.onStatus('subscribed');
 h.sockets[0].handlers.onStatus('error');
 assert.equal(h.controller.healthy(),false,'A channel error is unhealthy');
 assert.equal(h.sockets[0].closed,true,'The broken socket is closed');
 assert.equal(h.controller.state(),'retrying');
 // Late statuses from the closed socket change nothing.
 h.sockets[0].handlers.onStatus('subscribed');assert.equal(h.controller.healthy(),false,'A stale socket cannot claim health');
 await h.c.advance(999);assert.equal(h.sockets.length,1,'First retry waits the base backoff');
 await h.c.advance(1);assert.equal(h.sockets.length,2,'then reconnects');
 h.sockets[1].handlers.onStatus('closed');
 await h.c.advance(1_999);assert.equal(h.sockets.length,2,'Second retry backs off to 2 s');
 await h.c.advance(1);assert.equal(h.sockets.length,3);
 h.sockets[2].handlers.onStatus('subscribed');
 assert.equal(h.resyncs(),1,'A reconnect asks for one re-read (signals sent while down are lost)');
 h.sockets[2].handlers.onStatus('error');
 await h.c.advance(1_000);assert.equal(h.sockets.length,4,'After a healthy period the backoff starts from the base again');
 h.controller.stop();
 console.log('PASS reconnect backoff');
}
{
 const h=harness([{status:'retry'},{status:'retry'},{status:'ok',token:token()}]);
 h.controller.start();await flush();
 assert.equal(h.sockets.length,0,'A busy token route connects nothing');
 await h.c.advance(1_000);assert.equal(h.tokenCalls.length,2,'It asks again after the backoff');
 h.controller.nudge();await flush();
 assert.equal(h.tokenCalls.length,3,'Coming back online retries at once');
 assert.equal(h.sockets.length,1);
 h.controller.stop();
}
{
 const h=harness([{status:'off'}]);
 h.controller.start();await flush();
 assert.equal(h.controller.state(),'off','Off (feature off or signed out) stops');
 await h.c.advance(10*60_000);h.controller.nudge();await flush();
 assert.equal(h.tokenCalls.length,1,'and never asks again on this page');
 assert.deepEqual(h.c.pending(),[],'No timer is left behind');
 console.log('PASS off and retry');
}

// 5. Fallback polling: relaxed while healthy, back to normal when the socket drops ---------------------------------------
{
 // A staff poll ticking every 60 s (doctor chat, handover; the nurse conversation ticks every 30 s).
 let now=0,last=0,healthy=false;const runs:number[]=[];
 const tick=()=>{if(liveDue(last,now,60_000,healthy)){last=now;runs.push(now);}};
 const step=(ms:number)=>{now+=ms;tick();};
 step(60_000);assert.deepEqual(runs,[60_000],'Unhealthy: every 60 s');
 healthy=true;step(60_000);step(60_000);step(60_000);assert.deepEqual(runs,[60_000],'Healthy: the 60 s ticks skip');
 step(60_000);assert.deepEqual(runs,[60_000,300_000],'Healthy: every 240 s');
 last=now;step(60_000);assert.equal(runs.length,2,'A signal-triggered read counts as a run');
 healthy=false;step(60_000);assert.equal(runs.length,3,'Socket down: the next base tick reads');
}
{
 const t=1_000_000,p=pollAfterSend(t,0);
 for(const [now,last] of [[t+2_000,t+1_000],[t+65_000,t+62_000],[t+7*60_000,t+7*60_000-30_000]] as const)
  assert.equal(memberPollDue(p,now,last,false),pollDue(p,now,last),'Without a socket the member chat polls exactly as before');
 assert.equal(memberPollDue(p,t+2_000,t+1_000,true),false,'Healthy: not every tick while pending');
 assert.equal(memberPollDue(p,t+1_000+PENDING_LIVE_MS,t+1_000,true),true,'Healthy: pending reads every 5 s');
 assert.equal(memberPollDue(ZOE_POLL_IDLE,t+ZOE_POLL.REFRESH_MS,t,true),false,'Healthy: no idle read at 30 s');
 assert.equal(memberPollDue(ZOE_POLL_IDLE,t+relaxedInterval(ZOE_POLL.REFRESH_MS,true),t,true),true,'Healthy: idle reads every 2 min');
 console.log('PASS fallback polling');
}

// 6. The browser token fetch maps statuses; the route checks origin, plane, session and limit; tokens never leak ---------
{
 const answer=(status:number,body:unknown)=>async()=>new Response(JSON.stringify(body),{status});
 const signal=new AbortController().signal;
 assert.deepEqual(await fetchRealtimeToken('member',signal,answer(200,token()) as typeof fetch),{status:'ok',token:token()});
 for(const s of [400,401,403,404])assert.equal((await fetchRealtimeToken('staff',signal,answer(s,{}) as typeof fetch)).status,'off',`${s} stops`);
 for(const s of [429,500,503])assert.equal((await fetchRealtimeToken('clinic',signal,answer(s,{}) as typeof fetch)).status,'retry',`${s} retries`);
 assert.equal((await fetchRealtimeToken('member',signal,(async()=>{throw new TypeError('Failed to fetch');}) as typeof fetch)).status,'retry','offline retries');
 assert.equal((await fetchRealtimeToken('member',signal,answer(200,{accessToken:'x'}) as typeof fetch)).status,'retry','A malformed answer is not used');
 let calledWith='';
 await fetchRealtimeToken('clinic',signal,(async(url:string,init:RequestInit)=>{calledWith=`${init.method} ${url} ${init.cache} ${init.credentials}`;return new Response('{}',{status:404});}) as unknown as typeof fetch);
 assert.equal(calledWith,'POST /api/realtime/token?plane=clinic no-store same-origin','Same-origin POST, never cached');

 assert.equal(realtimeEnabled({}),false,'Dark by default');
 assert.equal(realtimeEnabled({NOREON_REALTIME:'true',NEXT_PUBLIC_SUPABASE_URL:'https://x.supabase.co',NEXT_PUBLIC_SUPABASE_ANON_KEY:'anon'}),true);
 assert.equal(realtimeEnabled({NOREON_REALTIME:'1',NEXT_PUBLIC_SUPABASE_URL:'https://x.supabase.co',NEXT_PUBLIC_SUPABASE_ANON_KEY:'anon'}),false,'Exactly "true"');
 const planes:string[]=[];
 const handler=(over:Partial<Parameters<typeof createRealtimeTokenHandler>[0]>={})=>createRealtimeTokenHandler({enabled:()=>true,session:async plane=>{planes.push(plane);return token();},limit:async()=>({ok:true}),...over});
 const req=(plane:string,origin:string|null='https://app.noreon.health')=>new Request(`https://app.noreon.health/api/realtime/token?plane=${plane}`,{method:'POST',headers:origin?{origin}:{}});
 assert.equal((await handler({enabled:()=>false})(req('member'))).status,404,'Off: 404');
 assert.equal((await handler()(req('member',null))).status,403,'No origin: 403');
 assert.equal((await handler()(req('member','https://evil.example'))).status,403,'Cross origin: 403');
 assert.equal((await handler()(req('admin'))).status,400,'Unknown plane: 400');
 assert.equal((await handler({session:async()=>null})(req('staff'))).status,401,'No session on that plane: 401');
 assert.equal((await handler({session:async()=>{throw Error('auth down');}})(req('staff'))).status,503,'Auth down: 503');
 const limited=await handler({limit:async()=>({ok:false,retryAfter:42})})(req('clinic'));
 assert.equal(limited.status,429);assert.equal(limited.headers.get('retry-after'),'42');
 const ok=await handler()(req('staff'));
 assert.equal(ok.status,200);assert.equal(ok.headers.get('cache-control'),'private, no-store','Never cached');
 assert.deepEqual(Object.keys(await ok.json()).sort(),['accessToken','expiresAt','userId'],'Exactly the token, the user and the expiry');
 assert.ok(planes.includes('staff')&&planes.includes('clinic'),'The requested plane reads its own session');

 const now=Date.UTC(2026,10,8,12,0,0);
 const source=(session:unknown)=>({auth:{getSession:async()=>({data:{session},error:null})}}) as unknown as Parameters<typeof tokenFor>[0];
 assert.deepEqual(await tokenFor(source({access_token:'header.payload.signature-1',expires_at:now/1000+600,user:{id:USER}}),USER,now),{accessToken:'header.payload.signature-1',userId:USER,expiresAt:now/1000+600});
 assert.equal(await tokenFor(source({access_token:'header.payload.signature-1',expires_at:now/1000+600,user:{id:OTHER}}),USER,now),null,'A cookie session of another user is refused');
 assert.equal(await tokenFor(source({access_token:'header.payload.signature-1',expires_at:now/1000-1,user:{id:USER}}),USER,now),null,'An expired session is refused');
 assert.equal(await tokenFor(source(null),USER,now),null);
 const route=readFileSync('lib/realtime/token-http.ts','utf8');
 assert.doesNotMatch(route,/log\.|console\./,'The token route never logs');
 assert.match(readFileSync('app/api/realtime/token/route.ts','utf8'),/withRouteLogging\(createRealtimeTokenHandler\(realtimeTokenPorts\)\)/);
 assert.match(route,/rateLimit\('realtime_token'.*failClosed:true/,'Rate limited, fail closed');
 console.log('PASS token route');
}

// 7. Retention job ----------------------------------------------------------------------------------------------------
{
 const calls:number[]=[];let left=12_000;
 const report=await pruneRealtimeSignals(async(_name,args)=>{calls.push(args.p_limit);const n=Math.min(left,args.p_limit);left-=n;return {deleted:n,more:n===args.p_limit};},Date.now()+60_000);
 assert.deepEqual(report,{deleted:12_000,batches:3,more:false},'Batches until nothing older than two days is left');
 const stopped=await pruneRealtimeSignals(async()=>({deleted:5000,more:true}),Date.now()+1_000);
 assert.equal(stopped.batches,0,'Near the deadline nothing starts');
 await assert.rejects(pruneRealtimeSignals(async()=>({deleted:'x'}),Date.now()+60_000),'An unexpected answer fails the job');
 console.log('PASS retention');
}

// 8. Wiring: every chat surface subscribes and keeps its polling as the fallback -------------------------------------------
{
 const wiring:[string,RegExp[]][]=[
  ['components/patient/use-zoe-thread.ts',[/useRealtimeSignals\(\{ plane: "member"/,/memberPollDue\(/,/pollMayReplace\(/]],
  ['components/chat-v2/member-chat.tsx',[/realtime: !!initial/]],
  ['components/chat-v2/caring-view.tsx',[/plane: "member"/,/caregiver_notice/]],
  ['components/doctor-chat-v2/doctor-chat.tsx',[/plane:'staff'/,/setInterval\(\(\)=>\{if\(liveDue\(last,Date\.now\(\),60_000,liveHealthy\.current\)\)/]],
  ['components/doctor-chat-v2/handover.tsx',[/plane:'staff'/,/setInterval\(\(\)=>\{if\(liveDue\(last,Date\.now\(\),60_000,liveHealthy\.current\)\)/]],
  ['components/nurse-chat-v2/use-nurse-conversation.ts',[/plane:'staff'/,/liveDue\(last,Date\.now\(\),30_000,liveHealthy\.current\)/]],
  ['components/staff/admin-chat.tsx',[/plane:'staff'/]],
  ['components/clinic-portal/chat.tsx',[/plane:'clinic'/]],
 ];
 for(const [file,patterns] of wiring){const src=readFileSync(file,'utf8');for(const p of patterns)assert.match(src,p,`${file} ${p}`);}
 const notices=readFileSync('components/realtime/signal-notices.tsx','utf8');
 assert.match(notices,/role=\{urgent\?'alert':'status'\}/,'Urgent notices are alerts, the rest polite status');
 assert.match(notices,/aria-live=\{urgent\?'assertive':'polite'\}/);
 console.log('PASS wiring');
}
console.log('check-realtime-client: ok');
