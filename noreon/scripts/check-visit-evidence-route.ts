/** Actual route composition with injected IO; not an Auth/browser acceptance. */
import assert from'node:assert/strict';import * as nodeModule from'node:module';import{renderToStaticMarkup}from'react-dom/server';import type{VisitRead,VisitEvidenceProps}from'@/lib/staff/visit-evidence-schema';
type Resolution={url:string;shortCircuit?:boolean};type Resolver=(s:string,c:unknown,next:(s:string,c:unknown)=>Resolution)=>Resolution;
const{registerHooks}=nodeModule as unknown as{registerHooks:(h:{resolve:Resolver})=>{deregister:()=>void}};
const state=globalThis as typeof globalThis&{__visitRouteStaff?:unknown;__visitRouteProps?:VisitEvidenceProps};
const mocks=new Map([
 ['@/lib/staff/test-accounts','export async function readTestAccountFlags(){return new Set();}'],
 ['@/lib/staff/test-account-actions','export const resetTestAccount=()=>{},setTestAccount=()=>{};'],
 ['@/components/staff/test-account-controls','export function TestAccountBadge(){return null;}export function TestAccountFlagForm(){return null;}export function TestAccountResetButton(){return null;}'],
 ['@/lib/staff/staff-locale','export async function staffLocale(){return "en";}'],['@/lib/staff/lab-stage-runtime','export async function readLabStages(){return {version:"lab-stage-v1",memberId:"",revision:0,samples:[]};}'],['@/lib/staff/lab-stage-actions','export async function recordRealLabStage(){throw Error("No automatic lab stage");}'],['@/components/staff/real-lab-stages','export function RealLabStages(){return null;}'],['@/components/staff/visit-checklist','export function VisitChecklist(){return null;}'],
 ['@/lib/staff/real-coordination/repository','export async function readCoordinationWorkspace(){return {};}'],['@/components/staff/real-coordination-tasks','export function RealCoordinationTasks(){return null;}'],
 ['@/lib/patient-care/clinical-case-repository','export async function requireRealStaff(){return globalThis.__visitRouteStaff;}export const snapshotSchema={parse:v=>v};'],
 ['@/components/real-review/review-controls','export function RealReviewControls(){return null;}'],['@/components/real-review/forms','export function DraftForm(){return null;}'],['@/components/staff/care-tasks','export function CareTasks(){return null;}'],
 ['@/components/staff/case-sections','export function CaseSections({children}){return children;}export function CasePanel({children}){return children;}export function CaseTabs(){return null;}'],
 ['@/lib/real-booking/repository','export async function getStaffBookingRequests(){return [];}'],['@/components/real-booking/staff','export function RealStaffBooking(){return null;}'],['@/components/real-booking/pilot-staff','export function PilotStaffBooking(){return null;}'],
 ['@/lib/real-booking/appointment-repository','export async function getStaffAppointmentData(){return {workspace:{member:{name:"Synthetic"}},data:{appointments:[]}};}'],
 ['@/lib/real-booking/appointment-actions','export const changeStaffAppointment=()=>{},cancelStaffAppointment=()=>{},startStaffAppointmentNotice=()=>{},retryStaffAppointmentNotice=()=>{},reconcileStaffAppointmentNotice=()=>{};'],
 ['@/lib/staff/visit-evidence-actions','export async function recordRealVisitEvidence(){throw Error("No automatic save");}export async function refreshRealVisitEvidence(){throw Error("No automatic recovery");}'],
 ['@/components/staff/real-visit-evidence','export function RealVisitEvidence(props){globalThis.__visitRouteProps={...props,command:props.commandAction,refresh:props.refreshAction};return null;}'],
]);
const hook=registerHooks({resolve(s,c,next){const source=mocks.get(s);return source?{url:'data:text/javascript,'+encodeURIComponent(source),shortCircuit:true}:next(s,c);}});
try{
 const{default:Page}=await import(new URL('../app/staff/real/(review)/members/[id]/page.tsx',import.meta.url).href);
 const member='b2400000-0000-4000-8000-000000000001',oldVisit='b2400000-0000-4000-8000-000000000010',appointment='b2400000-0000-4000-8000-000000000020';
 const accepted={version:'booking-visit-context-v1' as const,appointmentId:appointment,acceptedRevision:2,tests:[{id:'synthetic',title:'Synthetic lab',method:'lab' as const}]};
 for(const oldContext of[null,{...accepted,acceptedRevision:1}])for(const role of['nurse','doctor']){
  const data:VisitRead={version:'visit-evidence-v1',memberId:member,revision:1,bookingContext:accepted,collectionAvailability:'available',visits:[{id:oldVisit,createdAt:'2026-10-16T05:00:00Z',bookingContext:oldContext,entries:[]}]};
  const snapshot={id:member,revision:1,evidenceToken:'synthetic',draft:null,draftSavedAt:null,draftStale:false,evidence:{profile:{name:'Synthetic member',birthDate:'1980-01-01',biologicalSex:'female'},consent:null,assessment:null,measurements:[],reports:[],visits:data.visits}};
  state.__visitRouteStaff={identity:{id:member,role,name:'Synthetic reviewer',clinicId:member},actorScope:'opaque-synthetic-session',client:{rpc:async(name:string)=>{if(name==='patient_clinical_case_snapshot')return{data:snapshot,error:null};assert.equal(name,'patient_staff_visit_workspace');return{data,error:null};}}};delete state.__visitRouteProps;
  const html=renderToStaticMarkup(await Page({params:Promise.resolve({id:member})}));assert.ok(html.includes('Blood pressure readings</dt>'),'Counter names complete blood pressure rows');assert.ok(!html.includes('>Measurements</dt>'),'Counter does not claim all visit measurements');const props=Reflect.get(state,'__visitRouteProps')as VisitEvidenceProps|undefined;assert.ok(props);
  assert.notEqual(props.visitId,oldVisit,'Historical NULL/v1 visit must not trap a fresh linked visit');assert.equal(new Set([props.visitId,props.openSubmissionId,props.appendSubmissionId]).size,3);assert.equal(props.canRecord,role==='nurse');assert.deepEqual(props.data.visits,data.visits,'No implicit rebinding of old history');assert.equal(props.data.bookingContext?.acceptedRevision,2);assert.equal(typeof props.command,'function');assert.equal(typeof props.refresh,'function');
 }
 console.log('Actual route supplies explicit fresh visit candidates for NULL→accepted/v1→v2 and preserves immutable history, nurse-write/doctor-read hints and guarded ports. Injected Auth/IO/shell, no persistence proof.');
}finally{hook.deregister();delete state.__visitRouteStaff;delete state.__visitRouteProps;}
