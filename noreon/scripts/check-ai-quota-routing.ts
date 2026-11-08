import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
// @ts-expect-error Runtime Node supports registerHooks; declarations target Node 20.
import {registerHooks} from 'node:module';
import {signDemoBody} from '@/lib/reports/demo-bridge';
const calls:unknown[]=[];
Object.assign(globalThis,{__quotaRpc:async(name:string,args:unknown)=>{calls.push({name,args});return {data:false,error:null};}});
const hook=registerHooks({resolve(s:string,c:object,next:(s:string,c:object)=>object){
 if(s==='@supabase/supabase-js')return {url:'data:text/javascript,'+encodeURIComponent('export function createClient(){return {rpc:globalThis.__quotaRpc}}'),shortCircuit:true};
 return next(s,c);
}});
process.env.NOREON_DEPLOYMENT_TARGET='app';process.env.NEXT_PUBLIC_PATIENT_DEMO='false';process.env.NOREON_DEMO_AI_ENABLED='true';process.env.OPENAI_API_KEY='fictional-unused';process.env.NOREON_DEMO_AI_BRIDGE_SECRET='fictional-quota-secret-long-enough-1234';
const secret=process.env.NOREON_DEMO_AI_BRIDGE_SECRET;
const payload={op:'extract',consent:true,mime:'application/pdf',data:readFileSync('scripts/fixtures/reports/fictional-en.pdf').toString('base64')};
const base={requestId:'10000000-0000-4000-8000-000000000001',sessionHash:'a'.repeat(64),payload};
const req=(body:unknown,signedBody=body)=>{const timestamp=String(Date.now());return new Request('https://app.noreon.health/api/internal/demo-report',{method:'POST',headers:{'Content-Type':'application/json','x-demo-time':timestamp,'x-demo-signature':signDemoBody(secret,timestamp,JSON.stringify(signedBody))},body:JSON.stringify(body)});};
try {
 const {POST}=await import('@/app/api/internal/demo-report/route');
 for(const category of ['member','staff',undefined]){
  const body=category?{...base,category}:base;
  assert.equal((await POST(req(body))).status,429,'valid envelope must reach quota before provider');
  assert.deepEqual(calls.at(-1),{name:'claim_demo_report_ai',args:{p_request_id:base.requestId,p_session_hash:base.sessionHash,p_category:category??'member'}});
 }
 const count=calls.length;
 for(const category of ['admin',null,1])assert.equal((await POST(req({...base,category}))).status,400);
 assert.equal((await POST(req({...base,category:'staff'},{...base,category:'member'}))).status,401);
 assert.equal(calls.length,count,'invalid or tampered category must not consume quota');
 console.log('Actual bridge routes signed categories, defaults legacy to member, and rejects invalid/tampered category before quota. No provider called.');
}finally{hook.deregister();Reflect.deleteProperty(globalThis,'__quotaRpc');}
