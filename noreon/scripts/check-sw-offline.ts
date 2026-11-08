// WP R: the member service worker (public/patient/sw.js) stays push-capable and serves only a static offline page for
// failed navigations; it never caches API, data or member responses. Static analysis plus a node:vm run with fakes.
// Run: node --no-warnings --conditions=noreon-server-test --import ./scripts/register-alias.mjs scripts/check-sw-offline.ts
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync('public/patient/sw.js','utf8');
const code=source.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/[^\n]*/g,'');

// 1. Static analysis -----------------------------------------------------------------------------------------------------
assert.doesNotMatch(code,/importScripts|indexedDB|localStorage/,'No imported code and no storage beyond the one cache');
assert.equal((code.match(/\.put\(/g)??[]).length,1,'Exactly one cache write');
assert.match(code,/\.put\(OFFLINE_URL, response\)/,'and it stores only the offline page');
assert.match(code,/const OFFLINE_URL = '\/patient\/offline\.html'/);
assert.doesNotMatch(code,/cache\.add|addAll|caches\.match\(request|caches\.match\(event/,'No request-keyed caching or lookup');
assert.match(code,/request\.mode !== 'navigate' \|\| request\.method !== 'GET'\) return;/,'Only GET navigations are handled');
assert.match(code,/url\.pathname\.startsWith\('\/api\/'\)\) return;/,'API paths are never handled');
assert.match(code,/!url\.pathname\.startsWith\('\/patient\/'\)/,'Only inside the worker\'s scope');
assert.match(code,/catch \{\s*const shell = await caches\.match\(OFFLINE_URL/,'The offline page is served only after the network fails');
assert.match(code,/addEventListener\('push'/,'Still push-capable');
assert.match(code,/addEventListener\('notificationclick'/);
const config=readFileSync('next.config.ts','utf8');
assert.match(config,/source: '\/patient\/sw\.js', headers: \[[\s\S]*?Cache-Control', value: 'no-store'[\s\S]*?Service-Worker-Allowed', value: '\/patient\/'/,'next.config keeps sw.js no-store and scoped to /patient/');
assert.match(readFileSync('proxy.ts','utf8'),/path === "\/patient\/sw\.js" \|\| path === "\/patient\/offline\.html"\) return NextResponse\.next/,'The proxy serves the worker and its offline page without a session redirect');
const page=readFileSync('public/patient/offline.html','utf8');
assert.match(page,/<html lang="hy">/,'Armenian by default');
assert.match(page,/lang="ru"/);assert.match(page,/lang="en"/);
assert.match(page,/href="tel:103"/,'The 103 call is one tap away');
assert.match(page,/Նորեոն Հելթ/);assert.doesNotMatch(page,/Զոե|Զոի|Noreon-/);
assert.doesNotMatch(page,/<script|#[0-9a-f]{3,6}\b|rgba?\(|hsla?\(|border-radius:\s*[\d.]+px/i,'No script, no colour literals, no px radius');
assert.doesNotMatch(page.replace(/<!doctype html>/i,'').replace(/<!--[\s\S]*?-->/g,''),/!/,'Voice guide: no exclamation marks');
console.log('PASS static analysis');

// 2. Run it in a sandbox --------------------------------------------------------------------------------------------------
type Listener=(event:Record<string,unknown>)=>void;
const listeners=new Map<string,Listener>();
const stored=new Map<string,Response>();const cacheNames=new Set<string>(['noreon-offline-shell-v0','someone-elses-cache']);
let network:'up'|'down'='up';const fetched:string[]=[];let skipped=0,claimed=0;
const shown:unknown[]=[];
const fakeCaches={
 open:async(name:string)=>{cacheNames.add(name);return {put:async(key:string,response:Response)=>{stored.set(`${name}|${key}`,response);}};},
 keys:async()=>[...cacheNames],
 delete:async(name:string)=>cacheNames.delete(name),
 match:async(key:string,options:{cacheName:string})=>stored.get(`${options.cacheName}|${key}`)?.clone(),
};
const fakeFetch=async(input:Request|string)=>{
 const url=typeof input==='string'?input:input.url;fetched.push(url);
 if(network==='down')throw new TypeError('Failed to fetch');
 const body=url.endsWith('/patient/offline.html')?page:'<html>member page</html>';
 const response=new Response(body,{status:200,headers:{'content-type':'text/html; charset=utf-8'}});
 Object.defineProperty(response,'type',{value:'basic'});
 return response;
};
const self={
 location:new URL('https://app.noreon.health/patient/sw.js'),
 addEventListener:(type:string,fn:Listener)=>listeners.set(type,fn),
 skipWaiting:async()=>{skipped++;},
 clients:{claim:async()=>{claimed++;},matchAll:async()=>[],openWindow:async()=>null},
 registration:{showNotification:async(title:string,options:unknown)=>{shown.push({title,options});}},
};
vm.runInNewContext(source,{self,caches:fakeCaches,fetch:fakeFetch,Request:class extends Request{constructor(url:string,init?:RequestInit){super(new URL(url,'https://app.noreon.health'),init);}},Response,URL,console});
const fire=async(type:string,event:Record<string,unknown>)=>{
 let waited:Promise<unknown>|undefined,responded:Promise<Response>|undefined;
 listeners.get(type)!({...event,waitUntil:(p:Promise<unknown>)=>{waited=p;},respondWith:(p:Promise<Response>)=>{responded=p;}});
 await waited;return responded?await responded:undefined;
};

await fire('install',{});
assert.deepEqual([...stored.keys()],['noreon-offline-shell-v1|/patient/offline.html'],'Install stores the offline page only');
assert.equal(skipped,1);
await fire('activate',{});
assert.ok(!cacheNames.has('noreon-offline-shell-v0'),'An older offline cache is removed');
assert.ok(cacheNames.has('someone-elses-cache'),'Other caches are left alone');
assert.equal(claimed,1);

const nav=(path:string,mode='navigate',method='GET')=>({request:{url:`https://app.noreon.health${path}`,mode,method}});
network='down';
for(const [path,mode,method] of [['/api/patient/zoe/thread','cors','GET'],['/api/patient/zoe/thread','navigate','GET'],['/patient/chat','cors','GET'],['/patient/chat','navigate','POST'],['/staff/real/members','navigate','GET'],['/patient/_next/data.json','same-origin','GET']] as const)
 assert.equal(await fire('fetch',nav(path,mode,method)),undefined,`${method} ${mode} ${path} is not handled by the worker`);
const offline=await fire('fetch',nav('/patient/chat'));
assert.ok(offline,'A failed member navigation is answered');
assert.match(await offline!.text(),/Կապ չկա/,'with the static offline page');
network='up';const before=stored.size;
const online=await fire('fetch',nav('/patient/chat?x=1'));
assert.equal(await online!.text(),'<html>member page</html>','Online, the page comes from the network');
assert.equal(stored.size,before,'and is never stored');
console.log('PASS navigation fallback');

// A failed install fetch never breaks push.
{
 listeners.clear();stored.clear();network='down';
 vm.runInNewContext(source,{self,caches:fakeCaches,fetch:fakeFetch,Request:class extends Request{constructor(url:string,init?:RequestInit){super(new URL(url,'https://app.noreon.health'),init);}},Response,URL,console});
 await fire('install',{});
 assert.equal(stored.size,0);assert.equal(skipped,2,'The install still completes offline');
 await fire('push',{data:{json:()=>({noticeId:'5ea0f000-0000-4000-8000-000000000301',text:'You have a new note'})}});
 assert.equal(shown.length,1,'Push still shows');
 await fire('push',{data:{json:()=>({noticeId:'x',text:'y',extra:1})}});
 assert.equal(shown.length,1,'and still refuses a malformed payload');
}
console.log('PASS push');

// 3. The member chat registers the worker and the manifest covers /patient.
assert.match(readFileSync('components/chat-v2/offline-banner.tsx','utf8'),/register\("\/patient\/sw\.js", \{ scope: "\/patient\/", updateViaCache: "none" \}\)/);
const manifest=readFileSync('app/manifest.ts','utf8');
assert.match(manifest,/start_url: backoffice \|\| process\.env\.NOREON_DEPLOYMENT_TARGET === "marketing" \? "\/" : "\/patient"/);
assert.match(manifest,/display: "standalone"/);assert.match(manifest,/lang: locale/);assert.match(manifest,/parseLocale\(.*"hy"\)/,'Armenian by default');
assert.match(manifest,/icon-512\.png/);
console.log('check-sw-offline: ok');
