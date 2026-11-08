import {sourceBoundCaseSummary,sourceBoundExplanation,SOURCE_BOUND_OUTPUT_VERSION} from '@/lib/reports/source-bound-output';
import assert from 'node:assert/strict';
// @ts-expect-error Node 26 runtime provides registerHooks; project declarations target Node 20.
import {registerHooks} from 'node:module';
import {SAMPLE_EXTRACTION} from '@/lib/reports/demo';
import {createWorkflow} from '@/lib/service-workflow/model';
import {buildCaseLedger,selectCaseEvidence} from '@/lib/service-workflow/evidence-ledger';
const fixture={staff:{id:'fictional-doctor',role:'doctor'} as {id:string;role:string}|null,item:{id:'fictional-case',state:{workflow:createWorkflow([]),state:{assessment:null},measurements:[]},reports:[{id:"report-one",revision:3,record:{id:"report-one",revision:3,contentRevision:2,state:"confirmed",reviewed:SAMPLE_EXTRACTION}}]}};
// Replace only authenticated context adapters; execute the actual route and validator.
const fixtureUrl='data:text/javascript,'+encodeURIComponent('export const fixture=globalThis.__noreonAiRouteFixture;');
Object.assign(globalThis,{__noreonAiRouteFixture:fixture});
const hook=registerHooks({resolve(specifier:string,context:object,next:(specifier:string,context:object)=>object){
 if(specifier==='@/lib/staff/auth')return {url:'data:text/javascript,'+encodeURIComponent(`import {fixture} from ${JSON.stringify(fixtureUrl)}; export async function getStaff(){return fixture.staff;}`),shortCircuit:true};
 if(specifier==='@/lib/staff/cases')return {url:'data:text/javascript,'+encodeURIComponent(`import {fixture} from ${JSON.stringify(fixtureUrl)}; export async function getWorkspaceCase(){return fixture.item;}`),shortCircuit:true};
 return next(specifier,context);
}});
const originalFetch=globalThis.fetch;
let calls=0,lastPayload:unknown,lastCategory:unknown;let mutateDuringFetch=()=>{};let unsafeOutput=false;
globalThis.fetch=async (_input,init)=>{calls++;lastPayload=JSON.parse(String(init?.body)).payload;lastCategory=JSON.parse(String(init?.body)).category;mutateDuringFetch();const p=lastPayload as {op:string;evidence:Parameters<typeof sourceBoundCaseSummary>[0];reviewed:typeof SAMPLE_EXTRACTION;locale:'en'|'hy'};return Response.json({model:'source-bound-templates',prompt_version:SOURCE_BOUND_OUTPUT_VERSION,...(p.op==='explain'?{explanation:sourceBoundExplanation(p.reviewed,p.locale)}:{draft:sourceBoundCaseSummary(p.evidence)}),...(unsafeOutput?{draft:{summary:'Diagnose diabetes'}}:{})});};
process.env.NEXT_PUBLIC_PATIENT_DEMO='true';process.env.NOREON_DEMO_AI_ENABLED='true';process.env.NOREON_DEMO_AI_BRIDGE_SECRET='fictional-route-test-only-secret-123456';
try {
 const {POST}=await import('@/app/staff/ai/route');
 const full=buildCaseLedger({workflow:fixture.item.state.workflow,assessment:null,measurements:[],reports:fixture.item.reports.map(r=>r.record)}).evidence;
 const selected=selectCaseEvidence(full);
 const payload={op:'case-summary',consent:true,evidence:selected.evidence,omitted:selected.omitted,evidenceRevision:0};
 const request=(body:unknown,origin='http://localhost:3100')=>new Request('http://localhost:3100/staff/ai?caseId=fictional-case',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await POST(request({...payload,evidenceRevision:9}))).status,409);assert.equal(calls,0);
 assert.equal((await POST(request({...payload,omitted:{...selected.omitted,reportRows:99}}))).status,400);assert.equal(calls,0);
 assert.equal((await POST(request({...payload,consent:false}))).status,400);assert.equal(calls,0);
 assert.equal((await POST(request(payload,'https://other.invalid'))).status,403);assert.equal(calls,0);
 fixture.staff=null;assert.equal((await POST(request(payload))).status,401);assert.equal(calls,0);
 fixture.staff={id:'fictional-doctor',role:'doctor'};
 assert.equal((await POST(request(payload))).status,200);assert.equal(calls,1);
 assert.deepEqual(lastPayload,{op:'case-summary',consent:true,evidence:selected.evidence});
 assert.equal(lastCategory,'staff');
 unsafeOutput=true;assert.equal((await POST(request(payload))).status,400,'Unsafe upstream prose is rejected');unsafeOutput=false;
 const explain={op:'explain',consent:true,locale:'en',reportId:'report-one',reportRevision:3,contentRevision:2};
 const before=calls;
 assert.equal((await POST(request({...explain,reviewed:SAMPLE_EXTRACTION}))).status,400);assert.equal(calls,before);
 assert.equal((await POST(request({...explain,reportRevision:2}))).status,409);assert.equal(calls,before);
 const explanation=await POST(request(explain));assert.equal(explanation.status,200);
 assert.deepEqual(lastPayload,{op:'explain',consent:true,locale:'en',reviewed:{...SAMPLE_EXTRACTION,personName:null,laboratory:null}});
 const result=await explanation.json();
 assert.deepEqual(result.source,{reportId:'report-one',reportRevision:3,contentRevision:2});
 mutateDuringFetch=()=>{fixture.item.reports[0].revision++};
 assert.equal((await POST(request(explain))).status,409,'Mid-flight report revision change rejects the response');
 mutateDuringFetch=()=>{fixture.item.state.workflow.evidenceRevision=1};
 assert.equal((await POST(request(payload))).status,409,'Mid-flight ledger change rejects the response');
 console.log('Actual staff AI route rejects stale, malformed, unconsented and unauthorized input before upstream; accepted payload preserves bridge schema. No provider called.');
} finally {globalThis.fetch=originalFetch;hook.deregister();Reflect.deleteProperty(globalThis,'__noreonAiRouteFixture');}
