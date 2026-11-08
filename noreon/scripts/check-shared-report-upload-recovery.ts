import {PROMPT_VERSION} from '@/lib/reports/provider';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
// @ts-expect-error Node 24 runtime hook; project types target Node 20.
import {registerHooks} from 'node:module';
import {createHash, randomUUID} from 'node:crypto';
import {signExtractionReceipt} from '@/lib/reports/provenance';
import {SAMPLE_EXTRACTION} from '@/lib/reports/demo';

type RecordValue = Record<string, unknown>;
type Row = {case_id:string;id:string;record:RecordValue;revision:number;approval:null;published:null};
const rows = new Map<string,Row>();
const objects = new Set<string>();
const cleanup = new Set<string>();
let mode = 'ok', readsFail = false, removesFail = false, uploadFails = false;
let inserts = 0, reads = 0, queueFails = false, cleanupCalls = 0, removalCalls = 0;
let delayedInsert: Row | null = null;
const database = {
  from(table:string) {
    const filters:Record<string,string>={};
    return {
      select(){return this;}, eq(key:string,value:string){filters[key]=value;return this;},
      async maybeSingle(){reads++;return {data:rows.get(filters.id) ?? null,error:readsFail||(mode==='read-lost-after-commit'&&reads>1)?{message:'unavailable'}:null};},
      delete(){assert.equal(table,'workspace_report_cleanup');return {eq:async (_key:string,path:string)=>{cleanup.delete(path);return {error:null};}};},
    };
  },
  storage:{from(bucket:string){assert.equal(bucket,'workspace-case-reports');return {
    async upload(path:string,_bytes:Buffer,options:{upsert:boolean}){assert.equal(options.upsert,false);if(uploadFails)return {error:{message:'offline'}};assert.ok(!objects.has(path),'Every attempt gets a distinct object path');objects.add(path);return {error:null};},
    async remove(paths:string[]){removalCalls++;if(removesFail)return {error:{message:'offline'}};paths.forEach(path=>objects.delete(path));return {error:null};},
  };}},
  async rpc(name:string,args:{p_op:string;p_report_id:string;p_id:string;p_record:RecordValue}){
    assert.equal(name,'workspace_write_report');
    if(args.p_op==='discard-upload'){
      cleanupCalls++;
      if(queueFails)return {data:null,error:{message:'offline'}};
      const path=String(args.p_record.object_path);
      if([...rows.values()].some(row=>row.record.object_path===path))return {data:0,error:null};
      cleanup.add(path);return {data:1,error:null};
    }
    assert.equal(args.p_op,'insert');inserts++;
    if(mode==='duplicate')return {data:null,error:{code:'23505',message:'duplicate'}};
    if(mode==='quota')return {data:null,error:{code:'P0001',message:'report_limit'}};
    if(mode==='unknown')return {data:null,error:{code:'',message:'network failure'}};
    if(mode==='throw')throw new Error('network failure');
    if(['same-id-race','unknown-with-canonical','throw-with-canonical'].includes(mode)){
      const existing={...args.p_record,object_path:`${args.p_id}/${args.p_report_id}/${randomUUID()}`,reviewed:{preserved:true}};
      objects.add(String(existing.object_path));
      rows.set(args.p_report_id,{case_id:args.p_id,id:args.p_report_id,record:existing,revision:4,approval:null,published:null});
      if(mode!=='same-id-race'){
        delayedInsert={case_id:args.p_id,id:args.p_report_id,record:structuredClone(args.p_record),revision:0,approval:null,published:null};
        if(mode==='throw-with-canonical')throw new Error('network failure');
        return {data:null,error:{code:'',message:'network failure'}};
      }
      return {data:4,error:null};
    }
    rows.set(args.p_report_id,{case_id:args.p_id,id:args.p_report_id,record:structuredClone(args.p_record),revision:0,approval:null,published:null});
    if(mode==='lost-response')return {data:null,error:{code:'',message:'network failure'}};
    return {data:0,error:null};
  },
};
Object.assign(globalThis,{__reportUploadDatabase:database});
const hook=registerHooks({resolve(s:string,c:object,next:(s:string,c:object)=>object){
  if(s==='./auth'||s==='@/lib/staff/auth')return {url:'data:text/javascript,'+encodeURIComponent('export function workspaceAdmin(){return globalThis.__reportUploadDatabase}'),shortCircuit:true};
  return next(s,c);
}});
try {
  const {addMemberReport}=await import('@/lib/staff/reports');
  const bytes=await readFile('scripts/fixtures/reports/fictional-en.pdf');
  const checksum=createHash('sha256').update(bytes).digest('hex');
  const caseId=randomUUID();
  const secret='test-only-provenance-key-at-least-32-characters';
  process.env.NOREON_DEMO_AI_BRIDGE_SECRET=secret;
  const evidence={caseId,checksum,mime:'application/pdf' as const,pages:1,extraction:SAMPLE_EXTRACTION,model:'server-model',prompt_version:PROMPT_VERSION as typeof PROMPT_VERSION};
  const makeRecord=()=>({id:randomUUID(),file_name:'fictional-en.pdf',mime:evidence.mime,extraction:SAMPLE_EXTRACTION,model:evidence.model,prompt_version:evidence.prompt_version,extraction_receipt:signExtractionReceipt(secret,evidence)});
  const upload=(record=makeRecord())=>addMemberReport(caseId,record,new File([bytes],record.file_name,{type:evidence.mime}));
  const reset=()=>{rows.clear();objects.clear();cleanup.clear();mode='ok';readsFail=false;removesFail=false;uploadFails=false;queueFails=false;inserts=0;reads=0;cleanupCalls=0;removalCalls=0;delayedInsert=null;};

  // A committed insert whose HTTP response is lost must not delete its live original.
  mode='lost-response';
  const originalRequest=makeRecord();
  const committed=await upload(originalRequest);
  assert.equal(objects.size,1);assert.ok(objects.has(String(committed.object_path)));assert.equal(cleanup.size,0);
  const original=structuredClone(committed);
  const retry=await upload(originalRequest);
  assert.deepEqual(retry,original);assert.equal(inserts,1,'Same-ID matching bytes retry returns existing report without a second insert');

  for(const failure of ['unknown','throw']){
    reset();mode=failure;
    await assert.rejects(upload(),/unavailable/);
    assert.equal(objects.size,1,'Unknown commit outcome preserves the candidate original');assert.equal(cleanup.size,0);
  }
  reset();mode='lost-response';readsFail=true;
  await assert.rejects(upload(),/unavailable/);
  assert.equal(objects.size,0,'An unavailable idempotency read must fail before creating an object');
  reset();mode='read-lost-after-commit';
  await assert.rejects(upload(),/unavailable/);
  assert.equal(objects.size,1,'Failed reconciliation after commit must preserve the live original');assert.equal(cleanup.size,0);

  reset();mode='duplicate';removesFail=true;
  await assert.rejects(upload(),/duplicate/);
  assert.equal(cleanup.size,1,'Rejected upload remains durably queued when storage removal fails');assert.equal(objects.size,1);
  reset();mode='duplicate';
  await assert.rejects(upload(),/duplicate/);assert.equal(objects.size,0);assert.equal(cleanup.size,0);
  reset();mode='duplicate';queueFails=true;
  await assert.rejects(upload(),/duplicate/);assert.equal(objects.size,1,'No direct removal when guarded cleanup queuing is unconfirmed');assert.equal(cleanup.size,0);
  reset();mode='quota';
  await assert.rejects(upload(),/report_limit/);assert.equal(objects.size,0);

  reset();mode='same-id-race';
  const winner=await upload();
  assert.deepEqual(winner.reviewed,{preserved:true});
  assert.equal(objects.size,1,'Concurrent same-ID loser cleans only its own candidate');assert.ok(objects.has(String(winner.object_path)));

  // Seeing another committed path does not prove a timed-out insert has stopped.
  // It can execute after that canonical row is deleted, adopting our candidate.
  for(const failure of ['unknown-with-canonical','throw-with-canonical']){
    reset();mode=failure;
    const canonical=await upload();
    assert.deepEqual(canonical.reviewed,{preserved:true});
    assert.equal(cleanupCalls,0,'Unknown insert with a competing canonical row must not queue candidate cleanup');
    assert.equal(removalCalls,0,'Unknown insert must never remove its candidate object');
    assert.equal(objects.size,2,'Both canonical and still-in-flight candidate originals are retained');
    const delayed=delayedInsert as Row | null;assert.ok(delayed);
    rows.delete(delayed.id); // Concurrent removal of the report observed by reconciliation.
    rows.set(delayed.id,delayed); // The previously timed-out insert now commits.
    assert.ok(objects.has(String(delayed.record.object_path)),'Delayed commit still has its original');
  }

  reset();const incoming=makeRecord();
  rows.set(incoming.id,{case_id:caseId,id:incoming.id,record:{id:incoming.id,checksum:'other-bytes',object_path:'original'},revision:0,approval:null,published:null});
  objects.add('original');
  await assert.rejects(upload(incoming),/duplicate/);assert.equal(inserts,0);assert.deepEqual([...objects],['original']);

  reset();uploadFails=true;
  await assert.rejects(upload(),/upload_failed/);assert.equal(inserts,0);assert.equal(cleanup.size,0);
  console.log('Actual upload service preserves committed/uncertain originals, retries matching IDs, and durably cleans only rejected per-attempt objects. Storage/PostgREST boundaries simulated.');
} finally {hook.deregister();Reflect.deleteProperty(globalThis,'__reportUploadDatabase');}
