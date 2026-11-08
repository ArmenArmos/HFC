import assert from 'node:assert/strict';
// @ts-expect-error Node 24 runtime hook; project types target Node 20.
import {registerHooks} from 'node:module';
import {signDemoBody} from '@/lib/reports/demo-bridge';
import {SAMPLE_EXTRACTION} from '@/lib/reports/demo';
const f:{content:unknown[]|null}={content:null};Object.assign(globalThis,{__explanationBoundary:f});
const hook=registerHooks({resolve(s:string,c:object,next:(s:string,c:object)=>object){
 if(s==='@supabase/supabase-js')return {url:'data:text/javascript,export const createClient=()=>({rpc:async()=>({data:true,error:null})});',shortCircuit:true};
 if(s==='@/lib/reports/provider')return {url:'data:text/javascript,'+encodeURIComponent(`export const REPORT_MODEL='fictional',PROMPT_VERSION='report-import-v2',EXTRACTION_INSTRUCTION='extract';export const explanationInstruction=()=> 'explain';export async function callReportModel(args){globalThis.__explanationBoundary.content=args.content;return {summary:'Fictional explanation',attention:[],questions:[],items:[]}}`),shortCircuit:true};
 return next(s,c);
}});
try{
 const secret='test-only-provider-boundary-secret-at-least-32';
 Object.assign(process.env,{NOREON_DEPLOYMENT_TARGET:'app',NEXT_PUBLIC_PATIENT_DEMO:'false',NOREON_DEMO_AI_ENABLED:'true',OPENAI_API_KEY:'test-not-a-real-provider-key',NOREON_DEMO_AI_BRIDGE_SECRET:secret});
 const {POST}=await import('@/app/api/internal/demo-report/route');
 const body=JSON.stringify({requestId:crypto.randomUUID(),sessionHash:'a'.repeat(64),category:'staff',payload:{op:'explain',consent:true,locale:'en',reviewed:SAMPLE_EXTRACTION}});
 const time=String(Date.now());
 const response=await POST(new Request('https://app.noreon.health/api/internal/demo-report',{method:'POST',headers:{'content-type':'application/json','x-demo-time':time,'x-demo-signature':signDemoBody(secret,time,body)},body}));
 assert.equal(response.status,200);
 assert.equal(f.content,null,'Source-bound summaries must not send report identities or content to a model');
 const result=await response.json();assert.equal(result.model,'source-bound-templates');assert.ok(!JSON.stringify(result).includes('Mariam Example'));
 assert.equal(SAMPLE_EXTRACTION.personName,'Mariam Example');
 console.log('Actual summary bridge sends no report content to an AI provider, including older client requests.');
}finally{hook.deregister();Reflect.deleteProperty(globalThis,'__explanationBoundary');}
