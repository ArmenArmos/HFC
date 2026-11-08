/** Executes the actual async route/render with injected IO and simple shell
 * components. Proves route failure isolation/control-flow, not Auth or browser. */
import assert from'node:assert/strict';import * as nodeModule from'node:module';
// CI runs Node24; the repository's older Node typings omit this runtime API.
type Resolution={url:string;shortCircuit?:boolean};
type Resolver=(specifier:string,context:unknown,next:(specifier:string,context:unknown)=>Resolution)=>Resolution;
const{registerHooks}=nodeModule as unknown as{registerHooks:(hooks:{resolve:Resolver})=>{deregister:()=>void}};
assert.equal(typeof registerHooks,'function','Route boundary check needs the configured Node24+ test runtime');
import{renderToStaticMarkup}from'react-dom/server';import{notFound}from'next/navigation.js';
const testGlobal=globalThis as typeof globalThis&{__bookingRouteStaff?:unknown;__bookingRouteRead?:()=>Promise<never>};
const mocks=new Map([
 ['@/lib/staff/test-accounts','export async function readTestAccountFlags(){return new Set();}'],
 ['@/lib/staff/test-account-actions','export const resetTestAccount=()=>{},setTestAccount=()=>{};'],
 ['@/components/staff/test-account-controls','export function TestAccountBadge(){return null;}export function TestAccountFlagForm(){return null;}export function TestAccountResetButton(){return null;}'],
 ['@/lib/staff/staff-locale','export async function staffLocale(){return "en";}'],['@/lib/staff/lab-stage-runtime','export async function readLabStages(){return {version:"lab-stage-v1",memberId:"",revision:0,samples:[]};}'],['@/lib/staff/lab-stage-actions','export async function recordRealLabStage(){throw Error("No automatic lab stage");}'],['@/components/staff/real-lab-stages','export function RealLabStages(){return null;}'],['@/components/staff/visit-checklist','export function VisitChecklist(){return null;}'],
 ['@/lib/staff/real-coordination/repository','export async function readCoordinationWorkspace(){return {};}'],
 ['@/components/staff/real-coordination-tasks','export function RealCoordinationTasks(){return null;}'],
 ['@/lib/patient-care/clinical-case-repository','export async function requireRealStaff(){return globalThis.__bookingRouteStaff;}export const snapshotSchema={parse:v=>v};'],
 ['@/components/real-review/review-controls','export function RealReviewControls(){return null;}'],
 ['@/components/real-review/forms','export function DraftForm(){return null;}'],
 ['@/components/staff/care-tasks','export function CareTasks(){return null;}'],
 ['@/components/staff/case-sections','export function CaseSections({children}){return children;}export function CasePanel({children}){return children;}export function CaseTabs(){return null;}'],
 ['@/lib/real-booking/repository','export async function getStaffBookingRequests(){return [];}'],
 ['@/components/real-booking/staff','export function RealStaffBooking(){return null;}'],
 ['@/components/real-booking/pilot-staff','export function PilotStaffBooking(){throw Error("Unavailable visits must not render booking controls");}'],
 ['@/lib/real-booking/appointment-repository','export async function getStaffAppointmentData(){return globalThis.__bookingRouteRead();}'],
 ['@/lib/real-booking/appointment-actions','export const changeStaffAppointment=()=>{},cancelStaffAppointment=()=>{},startStaffAppointmentNotice=()=>{},retryStaffAppointmentNotice=()=>{},reconcileStaffAppointmentNotice=()=>{};'],
]);
const hooks=registerHooks({resolve(specifier,context,next){const source=mocks.get(specifier);return source?{url:'data:text/javascript,'+encodeURIComponent(source),shortCircuit:true}:next(specifier,context);}});
try{
 const{default:Page}=await import(new URL('../app/staff/real/(review)/members/[id]/page.tsx',import.meta.url).href);
 const id='b2300000-0000-4000-8000-000000000001';
 const snapshot={id,revision:0,evidenceToken:'synthetic',draft:null,draftSavedAt:null,draftStale:false,evidence:{profile:{name:'Fictional clinical patient',birthDate:'1980-01-01',biologicalSex:'female'},consent:null,assessment:null,measurements:[],reports:[]}};
 for(const role of['doctor','nurse']){
  testGlobal.__bookingRouteStaff={identity:{id,role,name:'Synthetic reviewer',clinicId:id},client:{rpc:async(name:string)=>{assert.equal(name,'patient_clinical_case_snapshot');return{data:snapshot,error:null};}}};
  testGlobal.__bookingRouteRead=async()=>{throw Object.assign(Error('Injected booking workspace lock unavailable'),{code:'55P03'});};
  const html=renderToStaticMarkup(await Page({params:Promise.resolve({id})}));
  assert.ok(html.includes('Visits are unavailable.'),role+' gets scoped visits failure');assert.ok(html.includes('Fictional clinical patient'));assert.ok(html.includes('Questionnaire evidence'));assert.ok(html.includes('Recorded measurements'),'Clinical evidence still renders');
  testGlobal.__bookingRouteRead=async()=>notFound();
  await assert.rejects(()=>Page({params:Promise.resolve({id})}),error=>typeof error==='object'&&error!==null&&'digest'in error&&typeof error.digest==='string'&&error.digest.includes('404'),'Framework notFound must be rethrown, never downgraded to unavailable');
 }
 console.log('Actual staff route: injected workspace55P03 renders unavailable visits plus doctor/nurse clinical evidence; guard notFound404 rethrown. IO/Auth/shell mocked; no DB/browser/provider.');
}finally{hooks.deregister();delete testGlobal.__bookingRouteStaff;delete testGlobal.__bookingRouteRead;}
