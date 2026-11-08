import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
// @ts-expect-error Node 24 runtime hook; project types target Node 20.
import {registerHooks} from 'node:module';
import {createHash} from 'node:crypto';
import {signExtractionReceipt, EXTRACTION_RECEIPT_TTL_MS, EXTRACTION_PROMPT_VERSION} from '@/lib/reports/provenance';
import {SAMPLE_EXTRACTION} from '@/lib/reports/demo';
const state={writes:0};
Object.assign(globalThis,{__provenanceUpload:state});
const hook=registerHooks({resolve(s:string,c:object,next:(s:string,c:object)=>object){
 if(s==='./auth' || s==='@/lib/staff/auth') return {url:'data:text/javascript,'+encodeURIComponent(`const f=globalThis.__provenanceUpload;let row=null;export function workspaceAdmin(){return {from:()=>({select(){return this},eq(){return this},maybeSingle:async()=>({data:row,error:null})}),storage:{from:()=>({upload:async()=>{f.writes++;return {error:null}},remove:async()=>({error:null})})},rpc:async(_name,args)=>{f.writes++;row={case_id:args.p_id,id:args.p_report_id,record:args.p_record,revision:0,approval:null,published:null};return {data:0,error:null}}}}`),shortCircuit:true};
 return next(s,c);
}});
try{
 const {addMemberReport}=await import('@/lib/staff/reports');
 const bytes=await readFile('scripts/fixtures/reports/fictional-en.pdf');
 const file=new File([bytes],'report.pdf',{type:'application/pdf'});
 const record={id:crypto.randomUUID(),file_name:'report.pdf',mime:'application/pdf',extraction:SAMPLE_EXTRACTION,model:'forged-model',prompt_version:'forged-prompt'};
 await assert.rejects(()=>addMemberReport('case-one',record,file), /invalid_provenance/);
 assert.equal(state.writes,0,'Unsigned extraction must fail before storage or DB writes');
 const secret='test-only-provenance-key-at-least-32-characters';
 process.env.NOREON_DEMO_AI_BRIDGE_SECRET=secret;
 const evidence={caseId:'case-one',checksum:createHash('sha256').update(bytes).digest('hex'),mime:'application/pdf' as const,pages:1,extraction:SAMPLE_EXTRACTION,model:'server-model',prompt_version:EXTRACTION_PROMPT_VERSION} as const;
 const signed={...record,model:evidence.model,prompt_version:evidence.prompt_version,extraction_receipt:signExtractionReceipt(secret,evidence)};
 for(const modified of [
   {...signed,model:'another-model'},
   {...signed,prompt_version:'another-prompt'},
   {...signed,extraction:{...SAMPLE_EXTRACTION,summary:'Fabricated summary'}},
   {...signed,extraction:{...SAMPLE_EXTRACTION,rows:SAMPLE_EXTRACTION.rows.map(r=>({...r,literal:'999'}))}},
   {...signed,extraction_receipt:signExtractionReceipt(secret,evidence,Date.now()-EXTRACTION_RECEIPT_TTL_MS-1000)},
   {...signed,extraction_receipt:signExtractionReceipt(secret,evidence,Date.now()+60_000)},
   {...signed,extraction_receipt:{...signed.extraction_receipt,signature:'0'.repeat(64)}},
 ]) await assert.rejects(()=>addMemberReport('case-one',modified,file),/invalid_provenance/);
 await assert.rejects(()=>addMemberReport('case-two',signed,file),/invalid_provenance/);
 const other=new File([await readFile('scripts/fixtures/reports/fictional-summary.pdf')],'other.pdf',{type:'application/pdf'});
 await assert.rejects(()=>addMemberReport('case-one',signed,other),/invalid_provenance/);
 assert.equal(state.writes,0,'Every invalid receipt must fail before writes');
 const saved=await addMemberReport('case-one',signed,file);
 assert.equal(state.writes,2);assert.equal(saved.checksum,evidence.checksum);assert.equal((saved.extraction_provenance as {status:string}).status,'verified');
 assert.deepEqual(saved.extraction,SAMPLE_EXTRACTION);
 console.log('Unsigned extraction is rejected by the actual upload service before writes.');
}finally{hook.deregister();Reflect.deleteProperty(globalThis,'__provenanceUpload');}
