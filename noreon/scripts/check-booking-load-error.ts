/** Actual loader and page with injected IO; no Auth, database or hosted services. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
import {notFound,unstable_rethrow} from 'next/navigation';
import {PilotMemberBooking} from '@/components/real-booking/pilot-member';
import {readAppointmentData} from '@/lib/real-booking/appointment-runtime';
import type {Appointment,PilotBookingData} from '@/lib/real-booking/appointment-schema';
import * as formError from '@/lib/real-booking/form-error';
import * as legacyMode from '@/lib/real-booking/legacy-mode';
import {createLogger,errorFields,log} from '@/lib/observability/logger';
import {tx} from '@/lib/patient/copy';

const id='b3000000-0000-4000-8000-000000000001';
const clinic='b3000000-0000-4000-8000-000000000002';
const visit={offerId:id,offerVersion:'v1',clinicId:clinic,mode:'clinic' as const,startsAt:'2030-01-01T09:00:00+04:00',endsAt:'2030-01-01T10:00:00+04:00',timezone:'Asia/Yerevan' as const,location:'Synthetic clinic address',preparation:'Synthetic preparation',preparationVersion:'v1',coveredTestIds:['synthetic'],followUps:[]};
const appointment:Appointment={version:'email-pilot-v1',id,memberId:id,revision:0,status:'confirmed',program:[{id:'synthetic',title:'Synthetic test',method:'lab',preparation:''}],current:visit,proposed:visit,noticeId:id,createdAt:'2026-10-16T00:00:00Z',portal:{channel:'portal',noticeState:'accepted',portalRevisions:[0],decline:null,proposal:null,checkin:{outcome:'arrived',at:'2026-11-07T09:00:00Z'}}};
const summary:PilotBookingData={available:false,unavailableReason:null,program:[],offers:[],appointments:[appointment],clinics:{[clinic]:'Synthetic clinic'}};
const savedAppointment={...appointment};delete savedAppointment.portal;
const lines:Record<string,unknown>[]=[];
const capture=createLogger({env:{NOREON_LOG_CONSOLE:'on'},console:{log:line=>lines.push(JSON.parse(line)),warn:line=>lines.push(JSON.parse(line)),error:line=>lines.push(JSON.parse(line))}});
const originalError=log.error;
log.error=capture.error;
try{
 // Removing the runtime log or changing reason precedence must fail this check.
 for(const [error,reason] of [
  [Object.assign(Error('Injected preparation failure'),{code:'XX000'}),'unavailable'],
  [Error('Urgent guidance takes priority over routine publication.'),'clinical-hold'],
  [Error('Routine review is on hold: a recorded crisis-range blood pressure has no linked symptom triage or resolution. Arrange clinical assessment; later normal readings do not clear this hold.'),'clinical-hold'],
  [Error('Profile and questionnaire context disagree.'),'profile-mismatch'],
  [Object.assign(Error('Injected source change'),{code:'40001'}),'source-unavailable'],
 ] as const){
  lines.length=0;
  const result=await readAppointmentData({memberId:id,actorId:id,runtime:null,invalidate:()=>{},read:{rpc:async name=>({data:name==='booking_pilot_workspace'?{member:{id,name:'Private synthetic name'},appointments:[savedAppointment]}:name==='booking_pilot_workspace_details'?{memberId:id,phone:null,purposes:{},clinics:summary.clinics}:null,error:null})},write:{rpc:async()=>{throw error;}}});
  assert.equal(result.data.unavailableReason,reason);
  assert.equal(result.data.appointments[0].id,id,'Preparation failures preserve saved appointments');
  assert.equal(lines.length,1,'A preparation failure emits one diagnostic event');
  assert.equal(lines[0].msg,'booking.load_failed');
  assert.equal(lines[0].level,'error');
  assert.equal(lines[0].place,'runtime');
  assert.equal(lines[0].unavailable_reason,reason);
  assert.equal(lines[0].member_id,id);
  assert.equal(lines[0].error_name,'Error');
  assert.equal(lines[0].error_code,'code' in error?error.code:undefined);
  if(reason==='clinical-hold')assert.ok(!/blood pressure|crisis|triage|guidance/i.test(JSON.stringify(lines)),'A clinical hold logs no clinical wording');
  assert.ok(!JSON.stringify(lines).includes('Private synthetic name'));
 }

 let locale:'en'|'hy'|'ru'='en',loadError:unknown=Error('Injected loader failure'),summaryError:unknown=null,summaryReads=0,clinicalHold=false;
 let pilot:PilotBookingData|undefined;
 const Shell=({children}:{children:React.ReactNode})=>children;
 const modules:Record<string,unknown>={
  'react/jsx-runtime':jsx,
  'next/navigation':{unstable_rethrow,redirect:()=>{throw Error('Unexpected redirect');}},
  '@/components/patient-care/member-screens':{MemberScreen:Shell},
  '@/lib/patient/member-screens-config':{memberScreensPrototypeEnabled:()=>false},
  '@/lib/patient/copy':{tx},
  '@/lib/clinical/rules/engine':{evaluate:()=>({urgency:'green'})},
  '@/lib/clinical/rules/rules':{inCrisisRange:()=>false},
  '@/lib/patient/questionnaire':{pruneAnswers:()=>({}),assessmentProgress:()=>({complete:true})},
  '@/lib/patient/repository':{requireRegistered:async()=>({profile:{userId:id,locale},assessment:{answers:{},completedAt:null}})},
  '@/components/patient/patient-shell':{PatientShell:Shell},
  '@/components/patient-care/common':{CareLink:Shell},
  '@/components/patient-care/consultation-window-notice':{ConsultationWindowNotice:()=>null},
  '@/lib/real-booking/repository':{getMemberBookingData:async()=>({requests:[],pilot,clinicalHold})},
  '@/components/real-booking/member':{RealMemberBooking:()=>null,HomeVisitRequest:()=>null},
  '@/components/real-booking/pilot-member':{PilotMemberBooking},
  '@/lib/real-booking/appointment-repository':{getMemberAppointmentData:async()=>{throw loadError;},getMemberAppointmentSummary:async()=>{summaryReads++;if(summaryError)throw summaryError;return summary;}},
  '@/lib/real-booking/legacy-mode':legacyMode,
  '@/lib/real-booking/visit-gate':{completedRequestTestIds:()=>[]},
  '@/lib/real-booking/appointment-actions':{},
  '@/lib/real-booking/form-error':formError,
  '@/lib/observability/logger':{log,errorFields},
  '@/lib/pilot-commerce/member':{getMemberPricing:async()=>null},
  '@/lib/patient-care/lab-stage-repository':{getMemberLabStages:async()=>null},
  '@/lib/patient-care/repository':{getCareData:async()=>null},
  '@/lib/staff/lab-stage-schema':{},
  '@/lib/patient-care/journey-strip':{journeyStripIndex:()=>0,journeyStripInput:()=>({})},
  '@/lib/patient-care/journey-reads':{readJourneyExtras:async()=>({})},
 };
 const exported:{default?:()=>Promise<React.ReactNode>}={};
 vm.runInNewContext(ts.transpileModule(readFileSync('app/patient/service/page.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText,{exports:exported,crypto,require:(name:string)=>{assert.ok(name in modules,`Unexpected dependency ${name}`);return modules[name];}});
 const page=async()=>renderToStaticMarkup(await exported.default!());
 // The real booking component must render the recovered Arrived card above retry, in every locale.
 for(const [language,retry,unavailable] of [
  ['en','Refresh this page','Booking could not be loaded'],
  ['hy','Թարմացնել էջը','Չհաջողվեց բացել այցերի տվյալները'],
  ['ru','Обновить эту страницу','Не удалось загрузить запись'],
 ] as const){
  locale=language;lines.length=0;summaryReads=0;
  const html=await page();
  assert.equal(summaryReads,1,'A failed full loader falls back to the read-only summary');
  assert.ok(html.includes('query=Synthetic%20clinic%2C%20Synthetic%20clinic%20address'),'Recovered clinic address feeds the existing map link');
  assert.match(html,/Synthetic clinic/);
  assert.ok(html.indexOf('data-visit-card')<html.indexOf(unavailable),'Saved visit precedes the error state');
  assert.ok(html.includes(retry));
  assert.match(html,/href="\/patient\/service"/);
  assert.doesNotMatch(html,/<form/,'A recovered Arrived visit has no scheduling forms');
  assert.equal(lines.length,1);
  assert.equal(lines[0].msg,'booking.load_failed');
  assert.equal(lines[0].place,'page');
  assert.equal(lines[0].unavailable_reason,'unavailable');
  assert.equal(lines[0].member_id,id);
  assert.equal(lines[0].error_name,'Error');
 }
 locale='en';summaryError=Error('Injected summary failure');
 const unavailableHtml=await page();
 assert.match(unavailableHtml,/Booking could not be loaded/,'A failed summary still renders the retry state');
 assert.match(unavailableHtml,/Refresh this page/);
 assert.doesNotMatch(unavailableHtml,/data-visit-card/,'No appointment is invented when both reads fail');
 summaryError=null;clinicalHold=true;
 assert.match(await page(),/Your assigned program needs clinical review before booking/);
 assert.equal(lines.at(-1)?.unavailable_reason,'clinical-hold');
 clinicalHold=false;loadError=Error('Profile and questionnaire context disagree.');
 assert.match(await page(),/href="\/patient\/profile"/,'Profile mismatch keeps its existing guidance');
 assert.equal(lines.at(-1)?.unavailable_reason,'profile-mismatch');
 // Existing state objects must bypass recovery and retain their reasons.
 for(const [reason,message] of [
  ['clinical-hold','Your assigned program needs clinical review before booking'],
  ['profile-mismatch','Your profile and your health questions disagree'],
  ['configuration-unavailable','Booking is being prepared. Check again later.'],
 ] as const){
  pilot={...summary,unavailableReason:reason};summaryReads=0;lines.length=0;
  assert.ok((await page()).includes(message));assert.equal(summaryReads,0);assert.equal(lines.length,0);
 }
 pilot=undefined;
 const missing=(()=>{try{notFound();}catch(error){return error;}throw Error('Expected notFound');})();
 lines.length=0;loadError=missing;summaryReads=0;
 await assert.rejects(page,error=>error===missing);assert.equal(lines.length,0);assert.equal(summaryReads,0,'Framework interrupts escape before logging or recovery');
 loadError=Error('Injected loader failure');summaryError=missing;
 await assert.rejects(page,error=>error===missing,'Summary auth/framework interrupts also escape');
 console.log('Booking load failures: runtime logs and preserves saved visits; page recovers Arrived visits above retry in EN/HY/RU, tolerates failed summary, and preserves holds, mismatch, configuration and framework interrupts. Injected IO; no hosted services.');
}finally{
 log.error=originalError;
}
