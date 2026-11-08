import assert from 'node:assert/strict';
import {signDemoBody} from '@/lib/reports/demo-bridge';
import {sourceBoundExplanation,sourceBoundCaseSummary,SOURCE_BOUND_OUTPUT_VERSION} from '@/lib/reports/source-bound-output';
import {SAMPLE_EXTRACTION} from '@/lib/reports/demo';
const secret='test-only-source-bound-bridge-secret';
Object.assign(process.env,{NOREON_DEPLOYMENT_TARGET:'app',NEXT_PUBLIC_PATIENT_DEMO:'false',NOREON_DEMO_AI_ENABLED:'true',OPENAI_API_KEY:'not-a-real-key',NOREON_DEMO_AI_BRIDGE_SECRET:secret});
const {POST}=await import('@/app/api/internal/demo-report/route');
const evidence={findings:[],bloodPressure:[{id:'bp-1',measuredAt:'2026-10-08T08:00:00Z',systolic:120,diastolic:80,pulse:null}],reportRows:[]};
const call=async(payload:unknown,category='staff')=>{
 const body=JSON.stringify({requestId:crypto.randomUUID(),sessionHash:'a'.repeat(64),category,payload});
 const time=String(Date.now());
 return POST(new Request('https://app.test/api/internal/demo-report',{method:'POST',headers:{'content-type':'application/json','x-demo-time':time,'x-demo-signature':signDemoBody(secret,time,body)},body}));
};
const originalFetch=globalThis.fetch;
globalThis.fetch=async()=>{throw Error('No provider or database request is allowed for source-bound output');};
try {
 for(const locale of ['en','hy'] as const){
  const response=await call({op:'explain',consent:true,locale,reviewed:{...SAMPLE_EXTRACTION,summary:'Start insulin',warnings:['Diagnose diabetes']}});
  assert.equal(response?.status,200);const result=await response!.json();
  assert.deepEqual(result.explanation,sourceBoundExplanation(SAMPLE_EXTRACTION,locale));
  assert.equal(result.prompt_version,SOURCE_BOUND_OUTPUT_VERSION);assert.equal(result.model,'source-bound-templates');
 }
 const response=await call({op:'case-summary',consent:true,evidence});assert.equal(response?.status,200);
 assert.deepEqual((await response!.json()).draft,sourceBoundCaseSummary(evidence));
 assert.equal((await call({op:'case-summary',consent:true,evidence},'member'))?.status,403);
 assert.equal((await call({op:'explain',consent:true,locale:'en',reviewed:{invalid:true}}))?.status,400);
 console.log('Actual internal route produces bounded source summaries without provider/DB calls, rejects malformed input and member clinical summaries.');
} finally {globalThis.fetch=originalFetch;}
