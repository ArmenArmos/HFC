import * as bpUnit from '@/lib/bp-unit';
import * as consultationProposal from '@/lib/patient-care/consultation-proposal';
import * as noticeLinks from '@/lib/staff-zoe/notice-link';
import * as bpProvenance from "@/lib/patient/bp-provenance";
import {pdfArtifactSchema} from '@/lib/reports/pdf-artifact-schema';
import {careVisitSchema} from '@/lib/staff/visit-evidence-schema';
import {planVersionSchema} from '@/lib/doctor-completion/version-schema';
import * as nodeCrypto from 'node:crypto';
/** Actual page + queue/snapshot schemas, controlled Auth/RPC/child IO. No network. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
const require=createRequire(import.meta.url);
const navigation=require('next/navigation') as typeof import('next/navigation');
const {ZodError}=require('zod') as typeof import('zod');
const id='00000000-0000-4000-8000-000000000001';
const member={id,name:'Fictional member',revision:2,doctorId:null,nurseId:null,createdAt:'2026-10-15T10:00:00Z'};
const snapshot={id,revision:2,evidenceToken:'a'.repeat(32),draft:null,draftSavedAt:null,draftStale:false,review:null,evidence:{profile:{name:'Fictional clinical member',birthDate:null,biologicalSex:null},consent:null,assessment:null,measurements:[] as {id:string;systolic:number;diastolic:number;pulse:number|null;measured_at:string;entry_source:string}[],reports:[]}};
let chatOn=false;
let role='admin',queue:unknown=[],queueError:unknown=null,snapshotError:unknown=null,authError:unknown=null,taskError:unknown=null,memberError:unknown=null;
let taskData:unknown={tasks:[],nextCursor:null},memberData:unknown={members:[],nextCursor:null};
let expectedCaseId:string|undefined=id;
let calls:string[]=[];let pilotError:unknown=null;let legacy=false;
const component=(name:string)=>function Boundary({children}:{children?:React.ReactNode}){return React.createElement('section',{'data-component':name},children);};
const staffAuth=async()=>{
   calls.push('auth');if(authError)throw authError;
   return {actorScope:'synthetic-'+role,identity:{id,role},client:{rpc:async(name:string,args?:Record<string,unknown>)=>{
    if(name==='patient_clinical_case_queue'){calls.push('queue');return {data:queue,error:queueError};}
    if(name==='patient_clinical_case_snapshot'){calls.push('snapshot');return {data:snapshot,error:snapshotError};}
    if(name==='patient_coordination_queue'){calls.push('coordination');assert.equal(args?.p_case,expectedCaseId);return {data:taskData,error:taskError};}
    if(name==='patient_coordination_members'){calls.push('coordination-members');assert.equal(args?.p_search,expectedCaseId);return {data:memberData,error:memberError};}
    if(name==='admin_conversation_read_enabled'){assert.equal(role,'admin','Only the admin view asks for the conversation link');return {data:true,error:null};}
    throw Error(`Unexpected RPC ${name}`);
   }}};
  };
function load(path:string,schemaOnly=false):Record<string,unknown>{
 const exports:Record<string,unknown>={};
 const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 new vm.Script(code).runInNewContext({exports,Error,crypto:globalThis.crypto,require(name:string){
  if(name==='@/lib/staff-zoe/notice-link')return noticeLinks;
  if(name==='@/lib/bp-unit')return bpUnit;
  if(name==='node:crypto')return nodeCrypto;
  if(name==='@/lib/staff-zoe/workspace-config')return {doctorChatV2Enabled:()=>chatOn};
  if(name==='@/lib/reports/pdf-artifact-schema')return {pdfArtifactSchema};
  if(name==='@/lib/patient/bp-provenance')return bpProvenance;
  if(name==='@/lib/staff/visit-evidence-schema')return {careVisitSchema};
  if(name==='@/lib/doctor-completion/version-schema')return {planVersionSchema};
  if(name==='zod')return require(name);
  if(name==='server-only')return {};
  if(name==='react/jsx-runtime')return jsx;
  if(name==='next/navigation')return navigation;
  if(name==='next/link')return {__esModule:true,default:({href,children}:{href:string;children?:React.ReactNode})=>React.createElement('a',{href},children)};
  if(name==='lucide-react')return {MessagesSquare:()=>null};
  if(schemaOnly){
   if(name==='@/lib/staff/real-staff-access')return load('lib/staff/real-staff-access.ts',true);
   if(name==='./clinical-review-schema')return load('lib/patient-care/clinical-review-schema.ts',true);
   if(name==='@/lib/service-workflow/publication')return load('lib/service-workflow/publication.ts',true);
   if(['server-only','next/headers','@supabase/ssr','@/lib/supabase/server','@/lib/staff/hosts','./real-review-config','@/lib/staff/real-session-binding','@/lib/staff/staff-session-method','./real-session-binding','./staff-session-method','@/lib/staff-zoe/workspace-config'].includes(name))return {};
  }
  if(name==='@/lib/patient-care/clinical-case-repository')return {...schemas,requireRealStaff:staffAuth};
  if(name==='@/lib/staff/real-staff-render')return {requireRealStaffForRender:staffAuth};
  if(name==='@/lib/staff/real-coordination/repository')return load('lib/staff/real-coordination/repository.ts');
  if(name==='./schema')return load('lib/staff/real-coordination/schema.ts');
  if(name==='@/lib/real-booking/appointment-repository')return {getStaffAppointmentData:async(value:string)=>{assert.equal(value,id);calls.push('pilot');if(pilotError)throw pilotError;return {workspace:{member},data:{appointments:[]}};}};
  if(name==='@/lib/real-booking/legacy-mode')return {legacyBookingMode:(pilot:unknown)=>{assert.ok(pilot,'Legacy mode is only asked about a loaded pilot');return legacy;},withClinicalHold:(pilot:unknown)=>pilot,evidenceClinicalHold:()=>{assert.notEqual(role,'admin','Administrator never derives clinical state');return false;}};
  if(name==='@/lib/real-booking/appointment-actions')return Object.fromEntries(['changeStaffAppointment','cancelStaffAppointment','retryStaffAppointmentNotice','reconcileStaffAppointmentNotice','startStaffAppointmentNotice'].map(key=>[key,()=>{throw Error('Unexpected booking write');}]));
  if(name==='@/lib/staff/visit-evidence-runtime')return {readVisitEvidence:async(context:{memberId:string})=>{assert.equal(context.memberId,id);assert.notEqual(role,'admin','Administrator never reads visit facts');calls.push('visits');return {version:'visit-evidence-v1',memberId:id,revision:2,bookingContext:null,collectionAvailability:'unlinked',visits:[]};}};
  if(name==='@/lib/staff/staff-locale')return {staffLocale:async()=>'en'};
  // B7 BP monitors ship dark: the flag is off here, so the device read and panel never run.
  if(name==='@/lib/bp-device/config')return {bpDevicesEnabled:()=>false};
  if(name==='@/lib/admin-chat/config')return {adminChatEnabled:()=>false};
  if(name==='@/lib/nurse-chat/config')return {nurseChatEnabled:()=>false};
  if(name==='@/lib/bp-device/runtime')return {readBpMemberDevices:async()=>{throw Error('Unexpected BP device read while switched off');}};
  if(name==='@/lib/bp-device/actions')return {recordBpDeviceCommand:()=>{throw Error('Unexpected BP device write');}};
  if(name==='@/components/staff/bp-device-panel')return {BpDevicePanel:component('BpDevicePanel')};
  if(name==='@/components/staff/bp-readings-history')return {BpReadingsHistory:component('BpReadingsHistory')};
  if(name==='@/lib/staff/staff-locale-copy')return load('lib/staff/staff-locale-copy.ts');
  // B5 documents and versions ship dark: no read or write while switched off.
  if(name==='@/lib/doctor-completion/config')return {doctorCompletionEnabled:()=>false};
  if(name==='@/lib/doctor-completion/document-runtime')return {readDoctorDocuments:async()=>{throw Error('Unexpected document read while switched off');},readDoctorPlanVersions:async()=>{throw Error('Unexpected version read while switched off');}};
  if(name==='@/lib/lab-ai/config')return {labAiEnabled:()=>false};
  if(name==='@/lib/lab-ai/doctor-runtime')return {readLabOverview:async()=>{throw Error('Unexpected lab reading read while switched off');}};
  if(name==='@/lib/doctor-completion/document-actions')return {recordMemberDocumentRelease:()=>{throw Error('Unexpected document write');}};
  if(name==='@/components/staff/member-documents')return {MemberDocuments:component('MemberDocuments')};
  if(name==='@/components/staff/member-uploads')return {MemberUploads:component('MemberUploads')};
  // AI-read lab results (dark): the assigned doctor and administrators read them after access; off here.
  if(name==='@/lib/lab-ai/staff-results-server')return {readStaffLabResults:async(_client:unknown,value:string)=>{assert.equal(value,id);assert.notEqual(role,'nurse','Nurses never read AI lab results');labReads.push(role);return undefined;}};
  if(name==='@/lib/lab-ai/staff-results')return {resultsCardItems:()=>[]};
  // Member upload approval (20261021070050): read only with the lab reader on, written only from the doctor's form.
  if(name==='@/lib/lab-ai/member-approval-server')return {readMemberUploadApprovals:async()=>{throw Error('Unexpected approval read while switched off');}};
  if(name==='@/lib/lab-ai/actions')return {approveMemberUpload:()=>{throw Error('Unexpected approval write');}};
  if(name==='@/components/staff/lab-ai-results')return {LabResultsCard:component('LabResultsCard'),LabAiResults:component('LabAiResults')};
  if(name==='@/components/staff/upload-override-notice')return {UploadOverrideNotice:component('UploadOverrideNotice')};
  if(name==='@/lib/staff/upload-overrides')return {readUploadOverrides:async()=>[]};
  if(name==='@/lib/member-history/server')return {readMemberHistoryForStaff:async(_client:unknown,value:string)=>{assert.equal(value,id);assert.equal(role,'doctor','Only the doctor view reads member uploads');calls.push('member-uploads');return {documents:[],values:[]};}};
  if(name==='@/lib/staff/lab-stage-schema')return {labStages:['at-lab','results-received']};
  if(name==='@/lib/staff/lab-stage-runtime')return {readLabStages:async(context:{memberId:string})=>{assert.equal(context.memberId,id);assert.notEqual(role,'admin','Administrator never reads lab stages');calls.push('lab-stages');return {version:'lab-stage-v1',memberId:id,revision:1,samples:[]};}};
  if(name==='@/lib/staff/lab-stage-actions')return {recordRealLabStage:()=>{throw Error('Unexpected lab stage write');}};
  if(name==='@/components/staff/real-lab-stages')return {RealLabStages:component('RealLabStages')};
  if(name==='@/components/staff/visit-checklist')return {VisitChecklist:component('VisitChecklist')};
  if(name==='@/lib/staff/visit-evidence-actions')return {recordRealVisitEvidence:()=>{throw Error('Unexpected visit write');},refreshRealVisitEvidence:()=>{throw Error('Unexpected visit recovery');}};
  if(name==='@/components/real-booking/pilot-staff')return {PilotStaffBooking:component('PilotStaffBooking')};
  if(name==='@/components/staff/real-visit-evidence')return {RealVisitEvidence:component('RealVisitEvidence')};
  if(name==='@/lib/real-booking/repository')return {getStaffBookingRequests:async(value:string)=>{assert.equal(value,id);calls.push('bookings');return [];}};
  if(name==='@/lib/clinical/seed/questions')return {fieldById:()=>undefined};
  if(name==='@/components/patient-care/common')return {CareSection:component('CareSection'),stamp:()=>''};
  if(name==='@/components/staff/case-sections')return {CaseSections:component('CaseSections'),CaseTabs:component('CaseTabs'),CasePanel:component('CasePanel')};
  const children:Record<string,string>={'@/components/staff/real-coordination-tasks':'RealCoordinationTasks','@/components/real-review/review-controls':'RealReviewControls','@/components/real-review/publish-confirmation':'PublishConfirmationProvider','@/components/real-review/forms':'DraftForm','@/components/staff/care-tasks':'CareTasks','@/components/real-booking/staff':'RealStaffBooking'};
  if(name in children)return {[children[name]]:component(children[name])};
  if(name==='@/lib/staff/yerevan-time')return load('lib/staff/yerevan-time.ts');
  if(name==='@/lib/staff/member-contact')return {readMemberContacts:async()=>({})};
  if(name==='@/components/staff/member-contact')return {MemberContactLine:component('MemberContactLine')};
  if(name==='@/lib/staff/test-accounts')return {readTestAccountFlags:async()=>new Set()};
  if(name==='@/lib/staff/test-account-actions')return {resetTestAccount:()=>{throw Error('Unexpected reset');},setTestAccount:()=>{throw Error('Unexpected flag write');}};
  if(name==='@/components/staff/test-account-controls')return {TestAccountBadge:component('TestAccountBadge'),TestAccountFlagForm:component('TestAccountFlagForm'),TestAccountResetButton:component('TestAccountResetButton')};
  // GP report ships dark: the switch read says off, and administrators and nurses never read it.
  if(name==='@/lib/gp-report/runtime')return {readGpReport:async(_client:unknown,value:string)=>{assert.equal(value,id);assert.equal(role,'doctor','Only the doctor reads the GP report');return {status:'off'};},readApprovedGpReport:async()=>{throw Error('Unexpected approved GP report read while switched off');}};
  if(name==='@/lib/gp-report/document')return {languageBlocks:()=>{throw Error('Unexpected GP report render while switched off');}};
  if(name==='@/lib/gp-report/actions')return {approveMemberGpReport:()=>{throw Error('Unexpected GP report approval');}};
  if(name==='@/components/staff/gp-report-panel')return {GpReportPanel:component('GpReportPanel')};
  // Programme rhythm ships dark: the switch read says off, and administrators and nurses never read it.
  if(name==='@/lib/programme/runtime')return {readDoctorMember:async(_client:unknown,value:string)=>{assert.equal(value,id);assert.equal(role,'doctor','Only the doctor reads the programme');return {version:'programme-member-v1',enabled:false};}};
  if(name==='@/lib/programme/actions')return {confirmProgrammePlan:()=>{throw Error('Unexpected programme confirm');}};
  if(name==='@/components/staff/programme-panel')return {ProgrammePanel:component('ProgrammePanel')};
  // BP week and medicines ship dark: the reads say off, and administrators never read them.
  if(name==='@/lib/bp-week/server')return {readStaffBpWeek:async(_client:unknown,value:string)=>{assert.equal(value,id);assert.notEqual(role,'admin','Administrator never reads the BP week');return {version:'bp-week-v1',enabled:false};}};
  if(name==='@/lib/member-medicines/server')return {readStaffMedicines:async(_client:unknown,value:string)=>{assert.equal(value,id);assert.notEqual(role,'admin','Administrator never reads medicines');return {version:'member-medicines-v1',enabled:false};},
   readStaffMedicineReasons:async(_client:unknown,value:string)=>{assert.equal(value,id);assert.notEqual(role,'admin','Administrator never reads medicine reasons');return [];}};
  if(name==='@/components/staff/bp-week-medicines-panels')return {BpWeekMedicinesPanels:component('BpWeekMedicinesPanels')};
  // Safety holds ship dark: assigned doctor and admin read them, nurses never do (the database refuses them too).
  if(name==='@/lib/member-safety/staff')return {readStaffMemberSafety:async(_client:unknown,value:string)=>{assert.equal(value,id);assert.notEqual(role,'nurse','Nurses never read safety holds');safetyReads.push(role);return safetyData;}};
  if(name==='@/lib/member-safety/actions')return {decideMemberSafetyHold:()=>{throw Error('Unexpected safety decision');}};
  if(name==='@/lib/member-safety/contract')return load('lib/member-safety/contract.ts');
  if(name==='@/components/staff/member-safety-panel')return {MemberSafetyPanel:component('MemberSafetyPanel')};
  // AI plan draft (dark): only the assigned doctor reads it; the switch is off here.
  if(name==='@/lib/patient-care/clinical-review-current')return {currentClinicalReview:()=>false,sameClinicalValue:()=>false};
  if(name==='@/lib/ai-plan/current')return {currentAiDraft:()=>false};
  if(name==='@/lib/ai-plan/server')return {readDoctorAiPlan:async(_client:unknown,value:string)=>{assert.equal(value,id);assert.equal(role,'doctor','Only the doctor reads the AI plan draft');return {version:'ai-plan-read-v1',enabled:false};}};
  if(name==='@/components/staff/ai-plan-panel')return {AiPlanPanel:component('AiPlanPanel'),AiPlanPrepare:component('AiPlanPrepare')};
  // Nurse visits ship dark: the record read says off (the database leaves values out for the admin).
  if(name==='@/lib/first-note/runtime')return {readDoctorFirstNote:async(_client:unknown,value:string)=>{assert.equal(value,id);assert.equal(role,'doctor','Only the doctor reads the first note');return {version:'first-note-v1',enabled:false};}};
  if(name==='@/lib/first-note/compose')return {firstNoteNext:()=>{throw Error('Unexpected first note draft');},prepareFirstNote:()=>{throw Error('Unexpected first note draft');}};
  if(name==='@/lib/first-note/actions')return {approveFirstNote:()=>{throw Error('Unexpected first note approval');}};
  if(name==='@/components/staff/first-note-panel')return {FirstNotePanel:component('FirstNotePanel')};
  // LDL goal ships dark: the doctor read says off; nobody else reads it.
  if(name==='@/lib/ldl/runtime')return {readDoctorLdl:async(_client:unknown,value:string)=>{assert.equal(value,id);assert.equal(role,'doctor','Only the doctor reads the LDL goal');return {version:'ldl-goal-v1',enabled:false};}};
  if(name==='@/lib/ldl/actions')return {addLdlEvent:()=>{throw Error('Unexpected LDL write');},removeLdlEvent:()=>{throw Error('Unexpected LDL write');},addLdlTherapy:()=>{throw Error('Unexpected LDL write');},endLdlTherapy:()=>{throw Error('Unexpected LDL write');},setLdlGoal:()=>{throw Error('Unexpected LDL write');}};
  if(name==='@/components/staff/ldl-goal-panel')return {LdlGoalPanel:component('LdlGoalPanel')};
  if(name==='@/lib/ldl/response-actions')return {cancelLdlRetest:()=>{throw Error('Unexpected LDL write');}};
  if(name==='@/lib/lipid-planner/runtime')return {readLipidPlanner:async(_client:unknown,value:string)=>{assert.equal(value,id);assert.equal(role,'doctor','Only the doctor reads the lipid plan');return {version:'lipid-planner-v1',enabled:false};}};
  if(name==='@/lib/lipid-planner/plan')return {buildLipidPlan:()=>{throw Error('Unexpected lipid plan while off');}};
  if(name==='@/components/staff/lipid-plan-card')return {LipidPlanCard:component('LipidPlanCard')};
  // Open alerts and the 103 window for this member: only the assigned doctor reads them.
  if(name==='@/lib/doctor-inbox/member-urgent-server')return {readMemberUrgent:async(_client:unknown,value:string)=>{assert.equal(value,id);assert.equal(role,'doctor','Only the doctor reads the member urgent items');return {alerts:[],window:null,incomplete:false};}};
  if(name==='@/components/staff/member-urgent')return {MemberUrgentSection:component('MemberUrgentSection')};
  if(name==='@/lib/clinical/types')return {};
  // QA 174: only the assigned doctor reads the confirmed clinic lab values for receipts.
  if(name==='@/lib/patient-care/clinic-lab-sources')return {readClinicLabSources:async(_client:unknown,value:string)=>{assert.equal(value,id);assert.equal(role,'doctor','Only the doctor reads clinic lab receipt sources');return [];}};
  if(name==='@/lib/patient-care/required-evidence')return {readRequiredEvidenceSources:async(_client:unknown,value:string)=>{assert.equal(value,id);assert.equal(role,'doctor','Only the doctor reads required evidence sources');return null;}};
  if(name==='@/lib/nurse-visit/runtime')return {readNurseVisitRecord:async(_client:unknown,value:string)=>{assert.equal(value,id);return {version:'nurse-visit-v1',enabled:false,visits:[]};}};
  if(name==='@/components/staff/nurse-visit-record')return {NurseVisitRecordPanel:component('NurseVisitRecordPanel')};
  // Plans with several medicines ship dark: nobody reads the regimen review while the switch is off.
  if(name==='@/lib/patient-care/consultation-proposal')return consultationProposal;
  // This route fixture has no completed questionnaire, so the engine supplies no proposal.
  if(name==='@/lib/patient-care/clinical-review-engine')return {clinicalConsultationProposal:()=>null};
  if(name==='@/lib/patient-care/regimen-config')return {multiMedicineEnabled:()=>false};
  if(name==='@/lib/patient-care/regimen-runtime')return {readDoctorRegimenReview:()=>{throw Error('Unexpected regimen read');}};
  if(name==='@/components/patient-care/regimen-changes')return {RegimenChanges:component('RegimenChanges'),RegimenList:component('RegimenList')};
  throw Error(`Unexpected import ${name}`);
 }});
 return exports;
}
const schemas=load('lib/patient-care/clinical-case-repository.ts',true);
const page=load('app/staff/real/(review)/members/[id]/page.tsx').default as (props:{params:Promise<{id:string}>})=>Promise<React.ReactElement>;
const run=(value=id)=>page({params:Promise.resolve({id:value})});
let safetyReads:string[]=[];let labReads:string[]=[];let safetyData:unknown={enabled:false,role:'admin',holds:[]};
const reset=()=>{safetyReads=[];labReads=[];safetyData={enabled:false,role:'admin',holds:[]};role='admin';pilotError=null;legacy=false;queue=[];queueError=null;snapshotError=null;authError=null;taskError=null;memberError=null;taskData={tasks:[],nextCursor:null};memberData={members:[],nextCursor:null};calls=[];expectedCaseId=id;};
const notFound=(error:unknown)=>typeof error==='object'&&error!==null&&'digest'in error&&error.digest==='NEXT_HTTP_ERROR_FALLBACK;404';
reset();queue=Array.from({length:200},(_,index)=>({...member,id:`22222222-2222-4222-8222-${String(index).padStart(12,'0')}`}));
const olderCaseHtml=renderToStaticMarkup(await run());
assert.match(olderCaseHtml,/Member arrangements/,'A valid case beyond the bounded queue remains accessible');
assert.match(olderCaseHtml,/RealCoordinationTasks/);
assert.deepEqual(calls,['auth','pilot','auth','coordination','coordination-members','bookings']);
reset();taskError={code:'42501',message:'PRIVATE current case access required'};
await assert.rejects(()=>run(),notFound,'Scoped missing/inaccessible admin case must route to notFound');
assert.deepEqual(calls,['auth','pilot','auth','coordination','coordination-members'],'Scoped denial never reads bookings or the optional name queue');
assert.deepEqual(labReads,[],'Scoped denial never reads AI lab results');
reset();queue=[member];
const adminHtml=renderToStaticMarkup(await run());
assert.match(adminHtml,/Fictional member/);assert.match(adminHtml,/Member arrangements/);
assert.match(adminHtml,/RealStaffBooking/);assert.match(adminHtml,/RealCoordinationTasks/);
assert.deepEqual(calls,['auth','pilot','auth','coordination','coordination-members','bookings'],'Admin arrangements retain their existing flow');
assert.deepEqual(labReads,['admin'],'Admin reads AI lab results after access (switched off here: nothing shown)');
assert.match(adminHtml,/PilotStaffBooking/);
assert.deepEqual(safetyReads,['admin'],'Admin reads safety holds');assert.doesNotMatch(adminHtml,/MemberSafetyPanel/,'Switched off: no safety panel');
reset();queue=[member];safetyData={enabled:true,role:'admin',holds:[]};
assert.match(renderToStaticMarkup(await run()),/MemberSafetyPanel/,'Switched on: the admin sees the safety panel');
reset();queue=[member];safetyData=null;
assert.match(renderToStaticMarkup(await run()),/Safety holds are unavailable/,'An unreadable safety read says so');
reset();queue=[member];safetyData='refused';
assert.doesNotMatch(renderToStaticMarkup(await run()),/MemberSafetyPanel|Safety holds/,'Refused: nothing shown');
reset();queue=[member];legacy=true;
const adminLegacy=renderToStaticMarkup(await run());
assert.doesNotMatch(adminLegacy,/PilotStaffBooking/,'CP14-F1: admin sees no switched-off pilot panel either');assert.match(adminLegacy,/RealStaffBooking/);assert.match(adminLegacy,/Fictional member/);
for(const problem of [new Error('PRIVATE pilot outage'),Object.assign(new Error('PRIVATE pilot denied'),{code:'42501'})]){
 reset();pilotError=problem;const fallback=renderToStaticMarkup(await run());assert.match(fallback,/Visits are unavailable/);assert.doesNotMatch(fallback,/PRIVATE/);assert.equal(calls.includes('snapshot'),false,'Admin fallback still never reads clinical snapshot');assert.equal(calls.includes('queue'),false,'No unscoped name queue probe');
}
reset();authError=new Error('Auth unavailable');
await assert.rejects(()=>run(),error=>error===authError);assert.deepEqual(calls,['auth']);
reset();await assert.rejects(()=>run('invalid'),notFound);assert.deepEqual(calls,[]);
for(const clinician of ['doctor','nurse']){
 reset();role=clinician;
 const html=renderToStaticMarkup(await run());
 assert.match(html,/Fictional clinical member/);assert.match(html,new RegExp(`Assigned member · ${clinician}`));
 assert.match(html,/RealCoordinationTasks/);assert.match(html,/RealStaffBooking/);
 assert.equal(html.includes('DraftForm'),clinician==='doctor');
 assert.deepEqual(calls,['auth','pilot','snapshot','auth','coordination','coordination-members','bookings','visits','lab-stages',...(clinician==='doctor'?['member-uploads']:[])],'Clinician path retains its existing snapshot flow, then reads assigned lab stages; only the doctor reads member uploads');
 assert.equal(html.includes('MemberUploads'),clinician==='doctor','Member-reported earlier results show on the doctor view only');
 assert.deepEqual(safetyReads,clinician==='doctor'?['doctor']:[],'Only the doctor (not the nurse) reads safety holds');
 assert.match(html,/PilotStaffBooking/,'Configured pilot or pilot history shows the staff pilot panel');
 assert.equal(html.includes('MemberUrgentSection'),clinician==='doctor','Open alerts and the 103 window show on the doctor view only');
 reset();role=clinician;legacy=true;
 const legacyHtml=renderToStaticMarkup(await run());
 assert.doesNotMatch(legacyHtml,/PilotStaffBooking/,'CP14-F1: switched-off pilot without history shows no pilot panel');
 assert.doesNotMatch(legacyHtml,/Visits are unavailable/,'Legacy mode is not an outage');
 assert.match(legacyHtml,/RealStaffBooking/,'Legacy requests remain visible to staff');
 reset();role=clinician;taskError={code:'42501'};
 await assert.rejects(()=>run(),notFound,'Scoped coordination revocation after a successful clinician snapshot also fails closed');
 assert.deepEqual(calls,['auth','pilot','snapshot','auth','coordination','coordination-members']);
 reset();role=clinician;snapshotError={code:'42501'};
 await assert.rejects(()=>run(),notFound);assert.deepEqual(calls,['auth','pilot','snapshot']);
 reset();role=clinician;snapshotError={code:''};
 await assert.rejects(()=>run(),error=>error instanceof Error&&/Member evidence is unavailable/.test(error.message)&&!notFound(error));
 assert.deepEqual(calls,['auth','pilot','snapshot']);
}
for(const problem of [{code:'',message:'PRIVATE outage'},{code:'PGRST003',message:'PRIVATE timeout'}]){
 reset();taskError=problem;
 await assert.rejects(()=>run(),error=>error instanceof Error&&/Coordination tasks could not load/.test(error.message)&&!notFound(error));
 assert.equal((calls as string[]).includes('bookings'),false);
}
reset();memberError={code:'42501',message:'PRIVATE member-list denial'};
await assert.rejects(()=>run(),error=>error instanceof Error&&/Coordination tasks could not load/.test(error.message)&&!notFound(error),'Member-list denial does not prove the selected case missing');
reset();taskData={tasks:'invalid',nextCursor:null};
await assert.rejects(()=>run(),error=>error instanceof ZodError&&!notFound(error));
reset();expectedCaseId=undefined;taskError={code:'42501',message:'PRIVATE unscoped access denial'};
const readWorkspace=load('lib/staff/real-coordination/repository.ts').readCoordinationWorkspace as ()=>Promise<unknown>;
await assert.rejects(()=>readWorkspace(),error=>error instanceof Error&&/Coordination tasks could not load/.test(error.message)&&!notFound(error),'Unscoped queue failure cannot prove a selected case missing');
console.log('Actual member route and coordination repository checks passed: scoped denial returns Next 404; valid cases beyond the bounded queue remain accessible; outages, invalid data and clinician flows preserved. Auth/RPC/children controlled; no live DB evidence.');

// Both real clinical chart roles keep typed evidence visible and counts explicitly verified.
for(const clinician of ['doctor','nurse']){
 reset();role=clinician;
 snapshot.evidence.measurements.push({id:'b4000000-0000-4000-8000-000000000005',systolic:185,diastolic:115,pulse:null,measured_at:'2026-11-05T12:00:00Z',entry_source:'patient_text_entry'});
 const html=renderToStaticMarkup(await run());
 assert.equal((html.match(/0 verified readings · 1 member-reported, not verified/g)??[]).length,2,'review status and observation section both distinguish counts');
 assert.match(html,/185\/115/);assert.match(html,/Member-reported, not verified/);assert.doesNotMatch(html,/No measurements recorded/);
 snapshot.evidence.measurements.length=0;
}

// Classic links follow the same gate as the destination, including the role gate.
for(const enabled of [false,true])for(const viewer of ['doctor','nurse','admin']){
 reset();role=viewer;chatOn=enabled;
 const markup=renderToStaticMarkup(await run());
 assert.equal(markup.includes(`/staff/real/doctor-chat-v2/patient/${id}`),enabled&&viewer==='doctor',`${viewer}, chat ${enabled}: classic member chat link`);
}
chatOn=false;
console.log('Classic member chat links: flags on/off and doctor/nurse/admin roles passed (controlled IO).');
