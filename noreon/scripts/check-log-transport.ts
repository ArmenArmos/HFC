import assert from 'node:assert/strict';
import {createServer,type IncomingMessage,type ServerResponse} from 'node:http';
import type {AddressInfo} from 'node:net';
import {NextRequest,NextResponse} from 'next/server';
import {axiomConfig} from '@/lib/observability/axiom';
import {createLogger} from '@/lib/observability/logger';
import {REQUEST_ID_HEADER,propagateRequestId,requestIdFrom} from '@/lib/observability/request-id';
import {withSupabaseLogging} from '@/lib/observability/supabase-fetch';
import {proxy} from '@/proxy';
import {loggedAction,withRouteLogging} from '@/lib/observability/with-logging';

/**
 * Logger transport and request-id checks against a local mock of Axiom's ingest endpoint:
 * batching, the auth header and NDJSON body, the short timeout, console-only fallback with
 * the variables unset, and the request id travelling from the proxy to Supabase calls.
 */
const quiet={log:()=>{},warn:()=>{},error:()=>{}};
const env={AXIOM_TOKEN:'xaat-test-token',AXIOM_DATASET:'noreon-app-test',AXIOM_DOMAIN:'eu-central-1.aws.edge.axiom.co',NOREON_LOG_CONSOLE:'off'};

type Received={url:string;auth:string|undefined;type:string|undefined;lines:Record<string,unknown>[]};
async function mockIngest(handler:(req:IncomingMessage,res:ServerResponse,body:string)=>void){
  const received:Received[]=[];
  const server=createServer((req,res)=>{let body='';req.on('data',c=>body+=c);req.on('end',()=>{received.push({url:req.url??'',auth:req.headers.authorization,type:req.headers['content-type'],lines:body?body.split('\n').map(l=>JSON.parse(l)):[]});handler(req,res,body);});});
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',()=>r()));
  const port=(server.address() as AddressInfo).port;
  // The logger posts to the configured https Axiom URL; the test redirects that one URL to the mock.
  const send:typeof fetch=(input,init)=>{const url=new URL(String(input));assert.equal(url.origin,'https://eu-central-1.aws.edge.axiom.co');return fetch(`http://127.0.0.1:${port}${url.pathname}`,init);};
  return {received,send,close:()=>new Promise<void>(r=>{server.closeAllConnections();server.close(()=>r());})};
}

// 1. Configuration: all three variables, an Axiom domain and a plain dataset name, or nothing.
assert.deepEqual(axiomConfig(env),{url:'https://eu-central-1.aws.edge.axiom.co/v1/ingest/noreon-app-test',token:'xaat-test-token'});
assert.equal(axiomConfig({}),null,'Unset variables mean console only');
assert.equal(axiomConfig({...env,AXIOM_TOKEN:''}),null);
assert.equal(axiomConfig({...env,AXIOM_DOMAIN:'evil.example.com'}),null,'Never sends anywhere but an Axiom domain');
assert.equal(axiomConfig({...env,AXIOM_DATASET:'../x'}),null);
assert.equal(axiomConfig({AXIOM_TOKEN:env.AXIOM_TOKEN,AXIOM_DATASET:env.AXIOM_DATASET}),null,'No default domain: never the US endpoint');

// 2. Unset variables: lines go to the console, nothing is buffered, the network is never called.
{
  const printed:string[]=[];let calls=0;
  const logger=createLogger({env:{NOREON_LOG_CONSOLE:'on'},console:{log:l=>printed.push(l),warn:l=>printed.push(l),error:l=>printed.push(l)},send:(async()=>{calls++;return new Response(null);}) as typeof fetch,schedule:f=>void f()});
  logger.info('route',{status:200});logger.error('error.unhandled',{error_name:'Error'});await logger.flush();
  assert.equal(printed.length,2);assert.equal(calls,0);assert.equal(logger.pending(),0);
  assert.equal(JSON.parse(printed[0]).msg,'route');
}

// 3. Batching: one request per flush, NDJSON lines, bearer token, size-capped batches.
{
  const mock=await mockIngest((_q,res)=>{res.writeHead(200,{'content-type':'application/json'});res.end('{}');});
  const flushes:(()=>Promise<void>)[]=[];
  const logger=createLogger({env,console:quiet,send:mock.send,schedule:f=>{flushes.push(f);},batchSize:50});
  for(let i=0;i<120;i++)logger.info('db.rpc',{rpc:'member_home',rpc_ms:i,db_status:200});
  assert.equal(logger.pending(),120,'Nothing is sent on the request path');
  assert.ok(flushes.length>=1&&flushes.length<=3,'Flushes are scheduled, not run per line');
  await flushes[0]();
  assert.equal(mock.received.length,3,'120 events go in batches of 50');
  assert.deepEqual(mock.received.map(r=>r.lines.length),[50,50,20]);
  for(const r of mock.received){assert.equal(r.url,'/v1/ingest/noreon-app-test');assert.equal(r.auth,'Bearer xaat-test-token');assert.equal(r.type,'application/x-ndjson');}
  assert.equal(mock.received[0].lines[0].rpc,'member_home');assert.ok(mock.received[0].lines[0]._time,'Axiom timestamp field set');
  assert.equal(logger.pending(),0);
  await mock.close();
}

// 4. Timeout: a hung ingest endpoint costs at most the timeout, never throws, and logs one warning.
{
  const mock=await mockIngest(()=>{/* never answers */});
  const warned:string[]=[];
  const logger=createLogger({env,console:{...quiet,warn:l=>warned.push(l)},send:mock.send,schedule:()=>{},timeoutMs:300});
  const writeStarted=performance.now();
  for(let i=0;i<10;i++)logger.info('route',{status:200});
  assert.ok(performance.now()-writeStarted<20,'Writing a line does not wait for the network');
  const flushStarted=performance.now();
  await logger.flush();
  const waited=performance.now()-flushStarted;
  assert.ok(waited>=250&&waited<1500,`Flush gives up after the timeout (${Math.round(waited)} ms)`);
  assert.equal(warned.length,1);assert.equal(JSON.parse(warned[0]).msg,'log.ingest_failed');assert.equal(JSON.parse(warned[0]).outcome,'timeout');
  assert.ok(!warned[0].includes('xaat-test-token'),'The token is never logged');
  await mock.close();
}

// 5. Error statuses and a full buffer: dropped events are counted, the oldest go first.
{
  const mock=await mockIngest((_q,res)=>{res.writeHead(403);res.end();});
  const warned:string[]=[];
  const logger=createLogger({env,console:{...quiet,warn:l=>warned.push(l)},send:mock.send,schedule:()=>{},maxBuffer:5});
  for(let i=0;i<8;i++)logger.info('route',{status:200,duration_ms:i});
  assert.equal(logger.pending(),5,'The buffer is bounded');
  await logger.flush();
  assert.equal(mock.received[0].lines.at(-1)?.msg,'log.dropped');assert.equal(mock.received[0].lines.at(-1)?.dropped,3);
  assert.equal(JSON.parse(warned[0]).db_status,403);
  await mock.close();
}

// 6. Request id: kept when safe, replaced when not, returned and passed on by the proxy.
assert.equal(requestIdFrom(new Headers({[REQUEST_ID_HEADER]:'req_abc12345'})),'req_abc12345');
assert.notEqual(requestIdFrom(new Headers({[REQUEST_ID_HEADER]:'<script>Anahit +37491234567</script>'})),'<script>Anahit +37491234567</script>');
assert.match(requestIdFrom(null),/^[0-9a-f-]{36}$/);
{
  const request=new NextRequest('https://app.noreon.health/patient/home',{headers:{cookie:'a=b'}});
  request.headers.set(REQUEST_ID_HEADER,'req_proxy_123');
  const plain=NextResponse.next();propagateRequestId(plain,request.headers,'req_proxy_123');
  assert.equal(plain.headers.get(REQUEST_ID_HEADER),'req_proxy_123','Returned in the response');
  assert.equal(plain.headers.get(`x-middleware-request-${REQUEST_ID_HEADER}`),'req_proxy_123','Visible to the app');
  assert.ok(plain.headers.get('x-middleware-override-headers')?.split(',').includes('cookie'),'Other request headers are still passed on');
  const withOverride=NextResponse.next({request});propagateRequestId(withOverride,request.headers,'req_proxy_123');
  assert.equal(withOverride.headers.get('x-middleware-override-headers')?.split(',').filter(k=>k===REQUEST_ID_HEADER).length,1);
  const redirect=NextResponse.redirect('https://app.noreon.health/');propagateRequestId(redirect,request.headers,'req_proxy_123');
  assert.equal(redirect.headers.get(REQUEST_ID_HEADER),'req_proxy_123');assert.equal(redirect.headers.has('x-middleware-override-headers'),false);
}

// 7. Inside a route handler the id reaches Supabase calls as a header and tags the DB and route lines.
{
  const lines:Record<string,unknown>[]=[];
  const capture=createLogger({env:{NOREON_LOG_CONSOLE:'on'},console:{log:l=>lines.push(JSON.parse(l)),warn:l=>lines.push(JSON.parse(l)),error:l=>lines.push(JSON.parse(l))}});
  const seen:Headers[]=[];
  const base=(async(_input:RequestInfo|URL,init?:RequestInit)=>{seen.push(new Headers(init?.headers));return new Response('[]',{status:200});}) as typeof fetch;
  const supabaseFetch=withSupabaseLogging(base,{env:{NEXT_PUBLIC_SUPABASE_URL:'https://abc.supabase.co'},logger:capture});
  const GET=withRouteLogging(async function GET(request:Request){
    await supabaseFetch('https://abc.supabase.co/rest/v1/rpc/member_home_summary?select=*',{method:'POST',body:JSON.stringify({p_member:'Anahit'}),headers:{apikey:'anon'}});
    await supabaseFetch('https://abc.supabase.co/rest/v1/members?phone=eq.%2B37491234567');
    await supabaseFetch('https://elsewhere.example/api');
    return Response.json({ok:true,url:request.url});
  });
  const response=await GET(new Request('https://app.noreon.health/staff/real/members/3f1c9a52-7d4e-4b8a-9c11-2e5f6a7b8c9d/gp-report?phone=1',{headers:{[REQUEST_ID_HEADER]:'req_route_123'}}));
  assert.equal(response.status,200);
  assert.equal(seen[0].get(REQUEST_ID_HEADER),'req_route_123','RPC carries the request id');
  assert.equal(seen[0].get('apikey'),'anon','Existing headers are kept');
  assert.equal(seen[2].get(REQUEST_ID_HEADER),null,'Non-Supabase calls are untouched');
  const rpc=lines.find(l=>l.msg==='db.rpc');
  assert.ok(rpc);assert.equal(rpc.rpc,'member_home_summary');assert.equal(rpc.request_id,'req_route_123');assert.equal(rpc.db_status,200);
  assert.ok(!JSON.stringify(lines).includes('Anahit')&&!JSON.stringify(lines).includes('37491234567'),'No arguments or query values are logged');
  assert.equal(lines.filter(l=>l.msg==='db.rest').length,0,'Fast successful table reads are not logged');
}

// 8. The default logger writes the route line with status, duration, route template and member id.
{
  const printed:string[]=[];const original=console.log;
  process.env.NOREON_LOG_CONSOLE='on';
  console.log=(line:string)=>printed.push(line);
  try{
    const POST=withRouteLogging(async function POST(_request:Request){void _request;return new Response(null,{status:201});});
    await POST(new Request('https://app.noreon.health/staff/real/members/3f1c9a52-7d4e-4b8a-9c11-2e5f6a7b8c9d/reports/77?x=y',{method:'POST',headers:{[REQUEST_ID_HEADER]:'req_line_123'}}));
    const failing=withRouteLogging(async function GET(_request:Request):Promise<Response>{void _request;throw Object.assign(new Error('value "Anahit" failed'),{code:'23505'});});
    await assert.rejects(()=>failing(new Request('https://app.noreon.health/patient/answers')),/Anahit/,'The original error is rethrown unchanged');
    const action=loggedAction('saveAnswers',async(text:string)=>text.length);
    assert.equal(await action('chest pain'),10,'Actions still return their value outside a request');
  }finally{console.log=original;}
  const route=printed.map(l=>JSON.parse(l)).find(l=>l.msg==='route');
  assert.equal(route.status,201);assert.equal(route.method,'POST');assert.equal(route.request_id,'req_line_123');
  assert.equal(route.route,'/staff/real/members/:id/reports/:n');assert.equal(route.member_id,'3f1c9a52-7d4e-4b8a-9c11-2e5f6a7b8c9d');
  assert.equal(typeof route.duration_ms,'number');
}

// 9. The proxy writes one line per page request with coarse request facts, and none for static files.
{
  const printed:string[]=[];const original=console.log;
  process.env.NOREON_LOG_CONSOLE='on';console.log=(line:string)=>printed.push(line);
  try{
    const headers={host:'app.noreon.health','user-agent':'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Version/18.0 Mobile Safari/604.1','x-vercel-ip-country':'AM','x-real-ip':'203.0.113.77','x-forwarded-for':'203.0.113.77',cookie:'sb-abcd-auth-token=secret-session; theme=dark'};
    await proxy(new NextRequest('https://app.noreon.health/?utm_source=sms&phone=%2B37491234567',{headers}));
    await proxy(new NextRequest('https://app.noreon.health/fonts/inter.woff2',{headers}));
    await proxy(new NextRequest('https://app.noreon.health/favicon.ico',{headers}));
  }finally{console.log=original;}
  const lines=printed.map(l=>JSON.parse(l)).filter(l=>l.msg==='proxy');
  assert.equal(lines.length,1,'Static files write no line');
  const line=lines[0];
  assert.equal(line.route,'/');assert.equal(line.method,'GET');assert.equal(line.status,200);assert.match(line.request_id,/^[0-9a-f-]{36}$/);
  assert.equal(line.actor_kind,'member');assert.equal(line.ua_family,'safari');assert.equal(line.country,'AM');assert.equal(line.ip_prefix,'203.0.113.0/24');
  const text=JSON.stringify(line);
  for(const leak of ['113.77','secret-session','utm_source','37491234567','iPhone','Mozilla'])assert.ok(!text.includes(leak),`Proxy line leaks ${leak}`);
}

// 10. Default scheduling outside after(): one request's lines share one delayed send kept alive by waitUntil.
{
  const sends:number[]=[];const kept:Promise<unknown>[]=[];
  const key=Symbol.for('@next/request-context');
  const g=globalThis as unknown as Record<symbol,unknown>;const previous=g[key];
  g[key]={get:()=>({waitUntil:(p:Promise<unknown>)=>kept.push(p)})};
  try{
    const logger=createLogger({env,console:quiet,send:(async(_u:unknown,init?:RequestInit)=>{sends.push(String(init?.body).split('\n').length);return new Response(null,{status:200});}) as typeof fetch});
    logger.info('proxy',{status:200});await Promise.resolve();logger.info('db.rpc',{rpc:'a'});await new Promise(r=>setTimeout(r,20));logger.info('route',{status:200});
    assert.equal(sends.length,0,'Nothing is sent while the request is still running');
    assert.equal(kept.length,1,'One flush is handed to waitUntil');
    const keepAlive=setTimeout(()=>{},1000);await Promise.all(kept);clearTimeout(keepAlive);
    assert.deepEqual(sends,[3],'The request\'s lines go in one batch');
  }finally{g[key]=previous;}
}

console.log('Logger batches NDJSON to the ingest endpoint with a bounded buffer and timeout, stays console-only without variables, and carries the request id from proxy to route lines and Supabase calls.');
