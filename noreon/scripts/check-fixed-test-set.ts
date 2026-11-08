/** Real member views and create action, with auth/storage IO replaced. No network or hosted data. */
import assert from 'node:assert/strict';
// @ts-expect-error Node 26 provides registerHooks; declarations target Node 20.
import {registerHooks} from 'node:module';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {z} from 'zod';
import {cardSchema} from '@/lib/zoe-chat-actions/registry';
import {amd} from '@/lib/pilot-commerce/format';
import {freshTestEvidence,suggestedTests} from '@/lib/real-booking/fresh-tests';
import type {MemberResults} from '@/lib/member-history/lab-results';
import * as bookingSchema from '@/lib/real-booking/schema';
import type {BookingProgram} from '@/lib/real-booking/appointment-schema';
import type {MemberPricing} from '@/components/pilot-commerce/member-pricing';

const hook=registerHooks({resolve(name:string,context:object,next:(s:string,c:object)=>object){
 const mocks:Record<string,string>={
  '@/lib/real-booking/actions':'export const memberBookingCommand=async()=>{throw Error("Unexpected write")};',
  '@/lib/zoe-chat-actions/next-step-actions':'export const followNextStep=async()=>{throw Error("Unexpected write")};export const requestReviewFromCard=followNextStep;',
  '@/app/patient/actions':'export const signOut=async()=>{};',
  'next/navigation':'export const useRouter=()=>({refresh(){}});',
 };
 return mocks[name]?{url:'data:text/javascript,'+encodeURIComponent(mocks[name]),shortCircuit:true}:next(name,context);
}});
const {RealMemberBooking,HomeVisitRequest}=await import('@/components/real-booking/member');
const {NextStepCard}=await import('@/components/chat-v2/next-step-card');
const {TestPrices}=await import('@/components/pilot-commerce/member-pricing');
hook.deregister();
const requirements:bookingSchema.BookingRequirement[]=[{id:'lipid-panel',title:'Lipid panel',method:'lab'},{id:'ecg',title:'ECG',method:'clinic'}];
const pricing:MemberPricing={payments:null,catalog:requirements.map((r,i)=>({testKey:r.id,nameEn:r.title,nameHy:r.title,includedInPackage:false,priceAmd:i?3000:6000,priceSource:'partner-approved'}))};
const data:bookingSchema.MemberBookingData={available:true,contextToken:'current',legacyCreationAvailable:true,homeRequestAvailable:true,requirements,homeTasks:[],requests:[]};
const id='00000000-0000-4000-8000-000000000001';
for(const locale of ['hy','ru','en']as const){
 for(const Component of [RealMemberBooking,HomeVisitRequest]){
  const html=renderToStaticMarkup(React.createElement(Component,{data,locale,pricing}));
  assert.doesNotMatch(html,/type="checkbox"|role="switch"|name="testIds"|data-test-remove/,'The member cannot choose a test subset');
  for(const r of requirements)assert.ok(html.includes(r.title),r.id+' is present');
  assert.ok(html.includes(amd(9000,locale)),'The full-set total is shown');
  assert.doesNotMatch(html.replace(/<script[\s\S]*?<\/script>/g,'').replace(/<[^>]*>/g,''),/—|!/);
 }
 const card=cardSchema.parse({id,requestId:id,kind:'tests_needed',source:'chip',sourceSeq:null,state:'open',outcome:{},claims:{},at:'2026-11-05T10:00:00Z',snapshot:{v:1,available:true,rows:[...requirements.map(r=>({...r,fresh:false})),{id:'fresh-test',title:'Already fresh',method:'lab',fresh:true}],pricing}});
 assert.ok(card.valid&&card.kind==='tests_needed');
 const html=renderToStaticMarkup(React.createElement(NextStepCard,{card,locale,onCard:()=>{},onAct:()=>{},onMessage:()=>{}}));
 assert.doesNotMatch(html,/Already fresh|type="checkbox"|role="switch"|data-test-remove/);
 for(const r of requirements)assert.ok(html.includes(r.title));
 assert.ok(html.includes(amd(9000,locale)),'Chat tests show the same full-set total');
 const missing={...pricing,catalog:pricing.catalog.slice(0,1)};
 const partial=renderToStaticMarkup(React.createElement(TestPrices,{items:requirements,pricing:missing,locale}));
 assert.doesNotMatch(partial,/data-test-total/,'Missing catalog entry hides the total');
 const unknown=renderToStaticMarkup(React.createElement(TestPrices,{items:requirements,pricing:{...pricing,catalog:pricing.catalog.map(t=>({...t,priceAmd:null}))},locale}));
 assert.doesNotMatch(unknown,/data-test-total/,'Null prices hide the total');
}

// Run the actual member action. A legacy browser subset, forged id, empty set or malformed
// payload cannot alter the trusted engine requirements sent to the write boundary.
const writes:Array<Record<string,unknown>>=[];
const boundaries:Record<string,unknown>={
 '@/lib/observability/with-logging':{loggedAction:(_name:string,f:unknown)=>f},
 'next/cache':{revalidatePath(){}},'zod':{z},
 '@/lib/patient/auth':{requirePatient:async()=>({userId:id})},
 '@/lib/patient-care/clinical-publication-server':{clinicalWriteClient:()=>({rpc:async(_name:string,args:Record<string,unknown>)=>{writes.push(args);return {error:null};}})},
 './config':{realBookingEnabled:()=>true},'./legacy-mode':{bookingChannelConfigured:()=>false},
 './repository':{memberBookingContext:async()=>({contextToken:'current',sourceToken:'source',engine:{version:'fixture',tests:[...requirements,{id:'home',title:'Home readings',method:'home-log'}]}})},
 './schema':bookingSchema,'./form-error':{bookingFailure:()=>({ok:false})},
};
const exports:Record<string,unknown>={};
vm.runInNewContext(ts.transpileModule(readFileSync('lib/real-booking/actions.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,process:{env:{}},FormData,Error,require:(name:string)=>boundaries[name]??{}});
const action=exports.memberBookingCommand as (state:bookingSchema.BookingFormState,form:FormData)=>Promise<bookingSchema.BookingFormState>;
for(const subset of ['["lipid-panel"]','["forged"]','[]','malformed',null]){
 const form=new FormData();
 for(const [k,v]of Object.entries({operation:'create',requestId:id,contextToken:'current',startsAt:'2099-11-06T05:00:00Z',timezone:'Asia/Yerevan',mode:'home',location:'Synthetic address'}))form.set(k,v);
 if(subset!==null)form.set('testIds',subset);
 assert.equal((await action({ok:false,message:''},form)).ok,true);
 assert.deepEqual(JSON.parse(JSON.stringify(writes.at(-1)?.p_requirements)),requirements,'Server decides the full suggested set');
}
console.log('Fixed test set: HY/RU/EN web/home/chat rendering, complete and unknown totals, fresh-row suppression, forged subsets ignored. Mocked auth/storage IO.');

// Full exact panel coverage plus the explicit medicine-change receipt is required.
const results:MemberResults={approvalRequired:true,version:'member-upload-results-v1',enabled:true,documents:[{documentId:id,fileName:'Fixture',resultDate:'2026-10-12',state:'approved',approvedAt:'2026-10-13T10:00:00Z',doctorName:null,interpretation:null}],values:['total_cholesterol','hdl_c','ldl_c','triglycerides'].map(key=>({valueId:id,documentId:id,testName:key,catalogueRef:key,valueText:'3',value:3,unit:null,refLow:null,refHigh:null,refText:null,date:'2026-10-12',checked:true,doctorEdited:false}))};
const receipt={snapshot:{document:{id}},outcome:{document:{docType:'lab',studyDate:'2026-10-12',medicineChangedSince:false}}};
const select=(r:MemberResults|null,receipts:unknown[],today='2026-11-05')=>suggestedTests(requirements,freshTestEvidence(requirements,r,receipts),today).map(t=>t.id);
assert.deepEqual(select(results,[receipt]),['ecg'],'The fresh lipid panel is omitted from the bookable set');
assert.deepEqual(select(results,[receipt],'2028-11-05'),['lipid-panel','ecg'],'An expired result is suggested again');
for(const facts of [{medicineChangedSince:true},{medicineChangedSince:'UNKNOWN'},{studyDate:null},{studyDate:'2099-01-01'}]){
 assert.deepEqual(select(results,[{...receipt,outcome:{document:{...receipt.outcome.document,...facts}}}]),['lipid-panel','ecg']);
}
assert.deepEqual(select(results,[{...receipt,outcome:{document:{...receipt.outcome.document,medicineChangedSince:'UNKNOWN'}}},receipt]),['lipid-panel','ecg'],'A newer unknown answer supersedes the older confirmation');
assert.deepEqual(select({...results,values:results.values.slice(1)},[receipt]),['lipid-panel','ecg'],'A partial panel is still suggested');
assert.deepEqual(select({...results,values:results.values.map(v=>({...v,checked:false}))},[receipt]),['lipid-panel','ecg']);
assert.deepEqual(select({...results,documents:results.documents.map(d=>({...d,state:'waiting'}))},[receipt]),['lipid-panel','ecg']);
assert.deepEqual(select(results,[]),['lipid-panel','ecg'],'A dated upload alone is insufficient');
assert.deepEqual(select(null,[receipt]),['lipid-panel','ecg']);
console.log('Saved-result adapter: complete approved panel, expiry, future/unknown dates, medicine change/unknown, newer receipts and partial coverage passed.');

// Read the real member freshness adapter through paginated RLS query boundaries.
const {readAllPages}=await import('@/lib/patient-care/pagination');
const freshness=await import('@/lib/real-booking/fresh-tests');
let pages=0,receiptFailure=false;const receiptOrders:string[]=[];let reverseReceipts:Record<string,unknown>[]|null=null;
const query={select(){return this;},eq(){return this;},order(column:string){receiptOrders.push(column);return this;},range:async(from:number)=>{pages++;const ordered=reverseReceipts?[...reverseReceipts].sort((a,b)=>String(b[receiptOrders.at(-2)!]).localeCompare(String(a[receiptOrders.at(-2)!]))):[receipt,...Array.from({length:499},()=>({}))];return {data:ordered.slice(from,from+500),error:receiptFailure?{}:null};}};
const readExports:Record<string,unknown>={};
const readBoundaries:Record<string,unknown>={
 'server-only':{},'@/lib/supabase/server':{createClient:async()=>({from:(table:string)=>{assert.equal(table,'zoe_chat_cards');return query;}})},
 '@/lib/member-history/ai-server':{readOwnLabResults:async()=>results},
 '@/lib/patient-care/pagination':{readAllPages},'@/lib/member-history/measures':{yerevanToday:()=> '2026-11-05'},'./fresh-tests':freshness,
};
vm.runInNewContext(ts.transpileModule(readFileSync('lib/real-booking/fresh-tests-read.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:readExports,Date,require:(name:string)=>readBoundaries[name]??{}});
const readSuggested=readExports.readMemberSuggestedTests as typeof import('../lib/real-booking/fresh-tests-read').readMemberSuggestedTests;
assert.deepEqual((await readSuggested(requirements)).map(t=>t.id),['ecg']);assert.equal(pages,2,'Receipt history is not capped at the forty displayed chat cards');
assert.deepEqual(receiptOrders.slice(0,2),['updated_at','id'],'Last saved answer wins even if its card was opened earlier');
reverseReceipts=[{...receipt,created_at:'2026-11-05T10:00:00Z',updated_at:'2026-11-05T11:00:00Z'},{...receipt,created_at:'2026-11-05T09:00:00Z',updated_at:'2026-11-05T12:00:00Z',outcome:{document:{...receipt.outcome.document,medicineChangedSince:true}}}];
assert.deepEqual((await readSuggested(requirements)).map(t=>t.id),['lipid-panel','ecg'],'An earlier-opened card saved last with a medicine change keeps the test suggested');
reverseReceipts=null;
receiptFailure=true;await assert.rejects(()=>readSuggested(requirements),/history unavailable/);receiptFailure=false;

// Exercise actual pilot preparation with stored clinical fixture and injected RPCs.
const {readAppointmentData,createAppointmentPorts}=await import('@/lib/real-booking/appointment-runtime');
const answers=JSON.parse(readFileSync('scripts/fixtures/patient-answers.json','utf8'));
const evidence={visits:[],profile:{name:'Synthetic',birthDate:'1974-01-01',biologicalSex:answers['q1.sex'].value},consent:{version:'patient-pilot-v1'},assessment:{revision:1,assessment_date:'2026-10-12',answers,completed_at:'2026-10-12T00:00:00Z',urgent_rule:null},measurements:[],reports:[]};
const rpcNames:string[]=[],sealed:Array<{id:string}[]>=[];
const read={rpc:async(name:string)=>({data:name==='patient_test_booking_requests'?[]:name==='booking_pilot_workspace_details'?{memberId:id,phone:null,purposes:{},clinics:{}}:name==='booking_pilot_workspace'?{member:{id,name:'Synthetic'},appointments:[]}:null,error:null})};
const write={rpc:async(name:string,args:Record<string,unknown>={})=>{
 rpcNames.push(name);
 if(name==='booking_program_source')return {data:{token:'source',requirementsToken:'requirements',data:evidence},error:null};
 assert.equal(name,'register_booking_program');sealed.push((args.p_program as {items:{id:string}[]}).items);
 return {data:{id:args.p_id,memberId:id},error:null};
}};
const context={memberId:id,actorId:id,read,write,runtime:null,invalidate:()=>{},suggestTests:async(items:BookingProgram['items'])=>freshness.suggestedTests(items,freshness.freshTestEvidence(items,results,[receipt]),'2026-11-05')};
const pilot=await readAppointmentData(context);
assert.ok(pilot.data.program.length>0,'The pilot fixture keeps its other suggested tests');
assert.ok(!pilot.data.program.some(t=>t.id==='lipid-panel'),'Pilot display omits the proven fresh panel');
assert.ok(!sealed.at(-1)?.some(t=>t.id==='lipid-panel'),'The sealed pilot booking also omits the fresh panel');
// Freshness can expire while the member is looking at the list and total. Keep the
// slot/version identical and exercise the actual command and runtime, mocking only RPC IO.
const {runAppointmentSelection}=await import('@/lib/real-booking/appointment-commands');
const selection={commandId:id,offerId:id,offerVersion:'v1',homeAddress:null,suggestedSetFingerprint:JSON.stringify(pilot.data.program.map(t=>t.id))};
let today='2026-11-05',recordedBooking:unknown=null,admittedBooking:unknown=null;
const bookingRpc={rpc:async(name:string,args:Record<string,unknown>={})=>{
 rpcNames.push(name);
 if(name==='recover_booking_command'){
  assert.deepEqual(args.p_selection,{offerId:id,offerVersion:'v1',homeAddress:null},'UI freshness is not part of the stored SQL command identity');
  return {data:recordedBooking,error:null};
 }
 if(name==='booking_program_source')return {data:{token:'source',requirementsToken:'requirements',data:evidence},error:null};
 if(name==='register_booking_program')return {data:{id:args.p_id,memberId:id},error:null};
 if(name==='booking_pilot_offers')return {data:[{clinicName:'Synthetic clinic',offer:{id,version:'v1',source:'clinic-hours',clinicId:id,mode:'clinic',startsAt:'2030-01-01T09:00:00+04:00',endsAt:'2030-01-01T10:00:00+04:00',timezone:'Asia/Yerevan',clinicAddress:'Synthetic clinic',preparation:'Synthetic preparation',preparationVersion:'v1',coveredTestIds:pilot.data.program.filter(t=>t.method!=='home-log').map(t=>t.id),followUps:[],reservationContract:{version:'manual-v1',reference:'synthetic'}}}],error:null};
 if(name==='select_booking_appointment')return {data:admittedBooking,error:null};
 throw Error('Unexpected booking RPC '+name);
}};
const clinicContext={...context,portal:true,write:bookingRpc,suggestTests:async(items:BookingProgram['items'])=>freshness.suggestedTests(items,freshness.freshTestEvidence(items,results,[receipt]),today)};
today='2028-11-05';rpcNames.length=0;
assert.deepEqual(await runAppointmentSelection(clinicContext,selection,createAppointmentPorts(clinicContext)),{ok:false,code:'tests-changed'},'An expired lipid panel cannot be added to the reviewed booking');
assert.deepEqual(rpcNames,['recover_booking_command','booking_program_source'],'A changed set never registers a program, reads offers or writes an appointment');
for(const suggestTests of [async(items:BookingProgram['items'])=>(await context.suggestTests(items)).slice(1),async()=>[]]){
 rpcNames.length=0;
 const fewer={...clinicContext,suggestTests};
 assert.deepEqual(await runAppointmentSelection(fewer,selection,createAppointmentPorts(fewer)),{ok:false,code:'tests-changed'},'Removing tests, including an all-fresh set, also requires refresh');
 assert.deepEqual(rpcNames,['recover_booking_command','booking_program_source']);
}
// A valid saved command wins even when the old form has no fingerprint at all.
recordedBooking={version:'email-pilot-v1',id,memberId:id,revision:0,status:'notification-pending',program:pilot.data.program,current:null,proposed:{offerId:id,offerVersion:'v1',clinicId:id,mode:'clinic',startsAt:'2030-01-01T09:00:00+04:00',endsAt:'2030-01-01T10:00:00+04:00',timezone:'Asia/Yerevan',location:'Synthetic clinic',preparation:'Synthetic preparation',preparationVersion:'v1',coveredTestIds:pilot.data.program.filter(t=>t.method!=='home-log').map(t=>t.id),followUps:[]},noticeId:id,createdAt:'2026-11-05T10:00:00Z'};
for(const replay of [selection,(( {suggestedSetFingerprint,...legacy})=>{void suggestedSetFingerprint;return legacy;})(selection)]){
 rpcNames.length=0;
 assert.deepEqual(await runAppointmentSelection(clinicContext,replay,createAppointmentPorts(clinicContext)),{ok:true,code:'pending',commandRecorded:true});
 assert.deepEqual(rpcNames,['recover_booking_command'],'Recorded commands recover before freshness validation, without new writes');
}
admittedBooking=recordedBooking;recordedBooking=null;today='2026-11-05';rpcNames.length=0;
assert.deepEqual(await runAppointmentSelection(clinicContext,selection,createAppointmentPorts(clinicContext)),{ok:true,code:'pending',commandRecorded:true});
assert.ok(rpcNames.includes('select_booking_appointment'),'An unchanged reviewed set still reaches appointment admission');
const {suggestTests:unused,...staffContext}=context;void unused;
await readAppointmentData({...staffContext,actorId:'00000000-0000-4000-8000-000000000002'});
assert.ok(sealed.at(-1)?.some(t=>t.id==='lipid-panel'),'Staff derivation is unchanged');
rpcNames.length=0;
const emptyContext={...context,suggestTests:async()=>[]};
const empty=await readAppointmentData(emptyContext);
assert.deepEqual(empty.data.program,[]);assert.deepEqual(empty.data.offers,[]);assert.equal(empty.data.available,true);
assert.ok(!rpcNames.includes('register_booking_program'),'All-fresh sets never create an empty seal');
await assert.rejects(()=>createAppointmentPorts(emptyContext).prepare(),/No new tests/,'A forged selection cannot book an empty set');
console.log('Freshness reads and pilot: paginated receipts, outage hold, same displayed/sealed set, all-fresh empty state and unchanged staff program passed. Mocked RPCs.');

// The display token changes with the suggested set, before the member create action writes.
let hideFresh=true;
const repoExports:Record<string,unknown>={};
const repoBoundaries:Record<string,unknown>={
 'server-only':{},'zod':{z},
 '@/lib/patient/auth':{requirePatient:async()=>({userId:id})},
 '@/lib/supabase/server':{createClient:async()=>({rpc:async()=>({error:null,data:{token:'source',requirementsToken:'requirements',data:{}}})})},
 '@/lib/patient-care/clinical-case-repository':{snapshotSchema:z.object({evidence:z.object({})})},
 '@/lib/patient-care/clinical-review-engine':{clinicalReviewEngine:()=>({version:'fixture',tests:requirements})},
 './fresh-tests-read':{readMemberSuggestedTests:async()=>hideFresh?requirements.slice(1):requirements},
};
vm.runInNewContext(ts.transpileModule(readFileSync('lib/real-booking/repository.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:repoExports,require:(name:string)=>repoBoundaries[name]??{}});
const bookingContext=repoExports.memberBookingContext as typeof import('../lib/real-booking/repository').memberBookingContext;
const freshContext=await bookingContext();hideFresh=false;const staleContext=await bookingContext();
assert.notEqual(freshContext.contextToken,staleContext.contextToken,'A changed suggested set invalidates an old preference form');
assert.deepEqual(freshContext.engine.tests.map(t=>t.id),['ecg']);
assert.deepEqual(staleContext.engine.tests.map(t=>t.id),requirements.map(t=>t.id));
console.log('Member booking repository: same freshness adapter and changed-set form token passed. Mocked context IO.');
