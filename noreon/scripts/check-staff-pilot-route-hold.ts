/** CP14-F1/R1: actual staff route with the actual legacy gate and actual PilotStaffBooking.
 * Scheduling email off, zero pilot appointments: legacy states hide the pilot panel, but a
 * clinical hold stays visible (the member keeps it too). Auth/IO/shell injected; no DB/browser. */
import assert from'node:assert/strict';import * as nodeModule from'node:module';
type Resolution={url:string;shortCircuit?:boolean};
type Resolver=(specifier:string,context:unknown,next:(specifier:string,context:unknown)=>Resolution)=>Resolution;
const{registerHooks}=nodeModule as unknown as{registerHooks:(hooks:{resolve:Resolver})=>{deregister:()=>void}};
assert.equal(typeof registerHooks,'function','Route check needs the configured Node24+ test runtime');
import{renderToStaticMarkup}from'react-dom/server';
const testGlobal=globalThis as typeof globalThis&{__holdRouteStaff?:unknown;__holdRouteRead?:()=>Promise<unknown>};
const mocks=new Map([
 ['@/lib/staff/test-accounts','export async function readTestAccountFlags(){return new Set();}'],
 ['@/lib/staff/test-account-actions','export const resetTestAccount=()=>{},setTestAccount=()=>{};'],
 ['@/components/staff/test-account-controls','export function TestAccountBadge(){return null;}export function TestAccountFlagForm(){return null;}export function TestAccountResetButton(){return null;}'],
 ['@/lib/staff/staff-locale','export async function staffLocale(){return "en";}'],['@/lib/staff/lab-stage-runtime','export async function readLabStages(){return {version:"lab-stage-v1",memberId:"",revision:0,samples:[]};}'],['@/lib/staff/lab-stage-actions','export async function recordRealLabStage(){throw Error("No automatic lab stage");}'],['@/components/staff/real-lab-stages','export function RealLabStages(){return null;}'],['@/components/staff/visit-checklist','export function VisitChecklist(){return null;}'],
 ['@/lib/staff/real-coordination/repository','export async function readCoordinationWorkspace(){return {};}'],
 ['@/components/staff/real-coordination-tasks','export function RealCoordinationTasks(){return null;}'],
 ['@/lib/patient-care/clinical-case-repository','export async function requireRealStaff(){return globalThis.__holdRouteStaff;}export const snapshotSchema={parse:v=>v};'],
 ['@/components/real-review/review-controls','export function RealReviewControls(){return null;}'],
 ['@/components/real-review/forms','export function DraftForm(){return null;}'],
 ['@/components/staff/care-tasks','export function CareTasks(){return null;}'],
 ['@/components/staff/case-sections','export function CaseSections({children}){return children;}export function CasePanel({children}){return children;}export function CaseTabs(){return null;}'],
 ['@/lib/real-booking/repository','export async function getStaffBookingRequests(){return [];}'],
 ['@/components/real-booking/staff','export function RealStaffBooking(){return "LEGACY-REQUESTS";}'],
 ['@/lib/real-booking/appointment-repository','export async function getStaffAppointmentData(){return globalThis.__holdRouteRead();}'],
 ['@/lib/real-booking/appointment-actions','export const changeStaffAppointment=()=>{},cancelStaffAppointment=()=>{},startStaffAppointmentNotice=()=>{},retryStaffAppointmentNotice=()=>{},reconcileStaffAppointmentNotice=()=>{};'],
]);
const hooks=registerHooks({resolve(specifier,context,next){const source=mocks.get(specifier);return source?{url:'data:text/javascript,'+encodeURIComponent(source),shortCircuit:true}:next(specifier,context);}});
try{
 assert.notEqual(process.env.NOREON_SCHEDULING_EMAIL_ENABLED,'true','Check models the switched-off pilot');
 const{default:Page}=await import(new URL('../app/staff/real/(review)/members/[id]/page.tsx',import.meta.url).href);
 const id='b2300000-0000-4000-8000-000000000071';
 const snapshot={id,revision:0,evidenceToken:'synthetic',draft:null,draftSavedAt:null,draftStale:false,evidence:{profile:{name:'Fictional hold member',birthDate:'1980-01-01',biologicalSex:'female'},consent:null,assessment:null,measurements:[],reports:[]}};
 let crisis=false;
 const crisisSnapshot={...snapshot,evidence:{...snapshot.evidence,measurements:[{id,systolic:190,diastolic:95,pulse:null,measured_at:'2026-10-16T08:00:00Z'}]}};
 const program=[{id:'synthetic',title:'Synthetic test',method:'lab',preparation:''}];
 const pilot=(unavailableReason:string)=>async()=>({workspace:{member:{name:'Fictional hold member'}},data:{available:false,unavailableReason,program,offers:[],appointments:[]}});
 for(const role of['doctor','nurse','admin']){
  testGlobal.__holdRouteStaff={identity:{id,role,name:'Synthetic reviewer',clinicId:id},client:{rpc:async(name:string)=>{if(name!=='patient_clinical_case_snapshot')throw Error('Injected: not under test');return{data:snapshot,error:null};}}};
  const render=async()=>renderToStaticMarkup(await Page({params:Promise.resolve({id})}));
  testGlobal.__holdRouteRead=pilot('clinical-hold');
  const hold=await render();
  assert.ok(hold.includes('The assigned program needs clinical review before booking.'),role+': clinical hold stays visible with the pilot off');
  assert.ok(!/\bYour\b/.test(hold.slice(hold.indexOf('Visits and changes'))),role+': hold panel uses staff wording');
  assert.ok(hold.includes('LEGACY-REQUESTS'),role+': legacy requests still render');
  for(const reason of['legacy-reconciliation','configuration-unavailable']){
   testGlobal.__holdRouteRead=pilot(reason);
   const html=await render();
   assert.ok(!html.includes('Visits and changes'),`${role}: ${reason} with the pilot off and no history shows no pilot panel`);
   assert.ok(!html.includes('Visits are unavailable'),`${role}: ${reason} legacy mode is not an outage`);
   assert.ok(html.includes('LEGACY-REQUESTS'));
  }
  // CP14-F3: a source outage proves nothing clinical, so it is shown, never hidden as legacy.
  for(const reason of['source-unavailable','unavailable']){
   testGlobal.__holdRouteRead=pilot(reason);
   const html=await render();
   assert.ok(html.includes('Visits and changes'),`${role}: ${reason} is shown as an outage, not hidden`);
   assert.ok(!html.includes('needs clinical review'),`${role}: ${reason} without a hold claims no hold`);
   assert.ok(html.includes('LEGACY-REQUESTS'));
  }
 }
 // CP14-F3: crisis-range BP in the stored evidence while the booking source read fails.
 crisis=true;
 for(const role of['doctor','nurse']){
  testGlobal.__holdRouteStaff={identity:{id,role,name:'Synthetic reviewer',clinicId:id},client:{rpc:async(name:string)=>{if(name!=='patient_clinical_case_snapshot')throw Error('Injected: not under test');return{data:crisisSnapshot,error:null};}}};
  for(const reason of['source-unavailable','unavailable']){
   testGlobal.__holdRouteRead=pilot(reason);
   const html=renderToStaticMarkup(await Page({params:Promise.resolve({id})}));
   assert.ok(html.includes('The assigned program needs clinical review before booking.'),`${role}: hold from stored evidence shows despite ${reason}`);
  }
 }
 // CP14-F4: the pilot read itself throws; the evidence-derived hold must still show beside the outage.
 for(const role of['doctor','nurse']){
  for(const [evidence,held] of [[crisisSnapshot,true],[snapshot,false]] as const){
   testGlobal.__holdRouteStaff={identity:{id,role,name:'Synthetic reviewer',clinicId:id},client:{rpc:async(name:string)=>{if(name!=='patient_clinical_case_snapshot')throw Error('Injected: not under test');return{data:evidence,error:null};}}};
   testGlobal.__holdRouteRead=async()=>{throw Object.assign(Error('Injected booking workspace unavailable'),{code:'55P03'});};
   const html=renderToStaticMarkup(await Page({params:Promise.resolve({id})}));
   assert.ok(html.includes('Visits are unavailable.'),`${role}: pilot load failure stays an outage`);
   assert.equal(html.includes('The assigned program needs clinical review before booking.'),held,`${role}: hold shown exactly when the stored evidence holds booking`);
  }
 }
 // PR168 follow-up (Astra minor): PGRST202 (missing RPC, possibly a stale cache) no longer proves no pilot
 // history. It is an outage for every role; legacy requests and clinical holds stay visible.
 for(const role of['doctor','nurse','admin']){
  for(const [evidence,held] of [[crisisSnapshot,true],[snapshot,false]] as const){
   if(role==='admin'&&held)continue;
   testGlobal.__holdRouteStaff={identity:{id,role,name:'Synthetic reviewer',clinicId:id},client:{rpc:async(name:string)=>{if(name!=='patient_clinical_case_snapshot')throw Error('Injected: not under test');return{data:evidence,error:null};}}};
   testGlobal.__holdRouteRead=async()=>{throw Object.assign(Error('Booking workspace unavailable'),{code:'PGRST202'});};
   const html=renderToStaticMarkup(await Page({params:Promise.resolve({id})}));
   assert.ok(html.includes('Visits are unavailable'),`${role}: PGRST202 is an outage, never legacy mode`);
   assert.ok(html.includes('LEGACY-REQUESTS'),`${role}: legacy requests render`);
   assert.equal(html.includes('The assigned program needs clinical review before booking.'),held,`${role}: hold shown exactly when evidence holds booking`);
   assert.ok(!html.includes('Visits and changes'),`${role}: no pilot panel without a pilot read`);
  }
 }
 testGlobal.__holdRouteStaff={identity:{id,role:'admin',name:'Synthetic admin',clinicId:id},client:{rpc:async()=>{throw Error('Administrator never reads clinical evidence');}}};
 testGlobal.__holdRouteRead=pilot('unavailable');
 const admin=renderToStaticMarkup(await Page({params:Promise.resolve({id})}));
 assert.ok(admin.includes('Visits and changes')&&!admin.includes('needs clinical review'),'Admin cannot see clinical evidence: unknown state stays an outage, never legacy');
 assert.ok(crisis);
 console.log('Actual staff route with actual legacy gate: pilot off + no history hides derived legacy states, shows outages, keeps pilot and evidence-derived clinical holds visible (doctor/nurse; admin sees outage). Auth/IO/shell injected.');
}finally{hooks.deregister();delete testGlobal.__holdRouteStaff;delete testGlobal.__holdRouteRead;}
