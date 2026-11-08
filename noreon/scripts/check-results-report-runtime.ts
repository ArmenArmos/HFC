import assert from 'node:assert/strict';
import {readResultsBlock,approveGpReport,saveResultEntryRpc,type GpRpc} from '@/lib/gp-report/runtime';
import {emptySource,FIXTURE_MEMBER,FIXTURE_READ_AT} from './gp-report-fixture';

// Isolated RPC transport only, no database or auth session. Test the actual report rebuild.
const previous=process.env.NOREON_RESULTS_REPORT;
try{
 let calls=0,approveContent:unknown;
 let source=emptySource();
 const rpc:GpRpc={rpc:async(name,args)=>{
  calls++;
  if(name==='doctor_result_entry_save')return {data:{id:'fictional-entry'},error:null};
  if(name==='doctor_gp_report_approve'){
   approveContent=args?.p_content;
   return {data:{version:1,approvedAt:FIXTURE_READ_AT,approvedByName:'Fictional doctor',contentSha256:'fictional'},error:null};
  }
  return {data:{enabled:true,memberId:FIXTURE_MEMBER,token:'a'.repeat(32),readAt:FIXTURE_READ_AT,source,doctorName:null,versions:[]},error:null};
 }};
 delete process.env.NOREON_RESULTS_REPORT;
 assert.equal((await readResultsBlock(rpc,FIXTURE_MEMBER)).status,'off');
 assert.equal(calls,0);
 process.env.NOREON_RESULTS_REPORT='true';
 assert.equal((await readResultsBlock(rpc,FIXTURE_MEMBER)).status,'none');
 source={...source,labResults:[{id:'fictional-triglycerides',marker:'Triglycerides',value:2,unit:'unrecognised',referenceLow:null,referenceHigh:null,referenceText:null,collectedAt:'2026-10-15',receivedAt:FIXTURE_READ_AT,source:'clinic',sourceLabel:null,reviewedAt:FIXTURE_READ_AT,reviewedBy:'Fictional doctor',sourceReportId:null}]};
 assert.equal((await readResultsBlock(rpc,FIXTURE_MEMBER)).status,'ready','a reviewed result reaches the block even when it cannot feed the engine');
 source={...source,clinicLabValues:[{id:'fictional',fileId:'file',status:'unverified',testName:'Do not show 6.66',catalogueRef:null,value:null,valueText:null,unit:null,referenceLow:null,referenceHigh:null,referenceText:null,collectedOn:null,attachedAt:FIXTURE_READ_AT,clinic:null,reviewedAt:null,reviewedBy:null}]};
 const ready=await readResultsBlock(rpc,FIXTURE_MEMBER);
 assert.equal(ready.status,'ready');
 if(ready.status==='ready'){
  assert.equal(ready.priorityLevel,'cannot-assess');
  assert.ok(ready.assessment.gates.includes('values_awaiting_review'));
  assert.ok(!JSON.stringify(ready).includes('6.66'));
 }
 assert.equal((await readResultsBlock({rpc:async()=>({data:null,error:{code:'42501'}})},FIXTURE_MEMBER)).status,'unavailable');
 assert.equal((await approveGpReport(rpc,FIXTURE_MEMBER,'a'.repeat(32),'d3e00000-0000-4000-8000-000000000002',false)).status,'stale','an old pre-results view cannot approve the new report');
 assert.equal(approveContent,undefined);
 await approveGpReport(rpc,FIXTURE_MEMBER,'a'.repeat(32),'d3e00000-0000-4000-8000-000000000002',true);
 assert.ok(Object.hasOwn(approveContent??{},'results'),'approval rebuild includes exactly the enabled section');
 delete process.env.NOREON_RESULTS_REPORT;
 assert.equal((await approveGpReport(rpc,FIXTURE_MEMBER,'a'.repeat(32),'d3e00000-0000-4000-8000-000000000003',true)).status,'stale','a results view cannot approve a report after the switch is disabled');
 process.env.NOREON_RESULTS_REPORT='true';
 assert.equal((await saveResultEntryRpc(rpc,{memberId:FIXTURE_MEMBER,field:'score2_percent',value:6,observedOn:'2026-10-16',submissionId:'d3e00000-0000-4000-8000-000000000002'})).status,'saved');
 for(const [code,status] of [['42501','access'],['55P03','off'],['22023','invalid'],['23514','invalid'],['other','outcome-unknown']]){
  assert.equal((await saveResultEntryRpc({rpc:async()=>({data:null,error:{code}})},{memberId:FIXTURE_MEMBER,field:'score2_percent',value:6,observedOn:'2026-10-16',submissionId:'d3e00000-0000-4000-8000-000000000002'})).status,status);
 }
}finally{if(previous===undefined)delete process.env.NOREON_RESULTS_REPORT;else process.env.NOREON_RESULTS_REPORT=previous;}
console.log('Results block gating, unavailable, reviewed-source projection and approval rebuild checks passed (isolated RPC).');
