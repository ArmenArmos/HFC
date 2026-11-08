import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {z} from 'zod';
import {unstable_rethrow} from 'next/navigation';
import {clinicalBookingFailure} from '../lib/real-booking/form-error';
import * as legacyMode from '@/lib/real-booking/legacy-mode';
import * as visitGate from '@/lib/real-booking/visit-gate';
import * as ldlRetest from '@/lib/ldl/retest';
// PR168 follow-up (Astra minor, prerequisite before pilot activation): production has the pilot
// schema since 16 Oct, so PGRST202 (missing RPC, e.g. a stale schema cache) no longer proves that
// no pilot history exists. Every pilot read failure is an outage and never re-opens legacy creation.
assert.equal('pilotSchemaAbsent'in legacyMode,false,'The PGRST202 inference is gone');
const missing=Object.assign(Error('Booking workspace unavailable'),{code:'PGRST202'});
const {legacyBookingMode}=legacyMode;
assert.equal(legacyBookingMode(null),false,'An unread pilot is never legacy mode');
let pilotError:unknown=missing;
const exported:Record<string,unknown>={};
const compile=(file:string)=>ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
new vm.Script(compile('lib/real-booking/repository.ts')).runInNewContext({exports:exported,require:(name:string)=>{
 if(name==='server-only')return {};
 // Freshness IO is outside this schema-outage regression. Keep its built-in
 // module whitelist unchanged: in particular, repository must not need crypto.
 if(name==='./fresh-tests-read')return {readMemberSuggestedTests:async(tests:unknown)=>tests};
 if(name==='next/navigation')return {unstable_rethrow};
 if(name==='./appointment-repository'){const read=async()=>{if(pilotError)throw pilotError;return {available:false,unavailableReason:'configuration-unavailable',program:[],offers:[],appointments:[]};};return {getMemberAppointmentData:read,getMemberAppointmentSummary:read};}
 if(name==='./legacy-mode')return legacyMode;
 if(name==='./scheduling-template')return {schedulingRuntime:()=>null};
 if(name==='zod')return {z};
 if(name==='@/lib/ldl/retest')return ldlRetest;
 if(name==='@/lib/clinical/rules/engine')return {ALGORITHM_VERSION:'synthetic'};
 if(name==='@/lib/patient/auth')return {requirePatient:async()=>({userId:'member'})};
 if(name==='@/lib/supabase/server')return {createClient:async()=>({rpc:async(rpc:string)=>rpc==='patient_test_booking_context'?{error:null,data:{token:'source',requirementsToken:'v2:requirements',data:{}}}:{error:null,data:[]}})};
 if(name==='@/lib/patient-care/clinical-case-repository')return {snapshotSchema:z.object({evidence:z.object({})}),requireRealStaff:async()=>{throw Error('Member path never reads staff');}};
 if(name==='@/lib/staff/real-staff-render')return {requireRealStaffForRender:async()=>{throw Error('Member path never reads staff');}};
 if(name==='@/lib/patient-care/clinical-publication-server')return {clinicalWriteClient:()=>{throw Error('Member read path never writes');}};
 if(name==='@/lib/patient-care/clinical-review-engine')return {clinicalReviewEngine:()=>({tests:[{id:'lipids',title:'Lipid profile',method:'lab'}]})};
 if(name==='./form-error')return {clinicalBookingFailure};
 if(name==='./visit-gate')return visitGate;
 if(name==='./config')return {realBookingEnabled:()=>true};
 if(name==='./schema')return {bookingRequestSchema:z.object({id:z.string()})};
 throw Error(`Unexpected import ${name}`);
},process:{env:{}}});
const load=exported.getMemberBookingData as (options?:{summaryOnly?:boolean})=>Promise<{legacyCreationAvailable?:boolean;available:boolean;requirements:unknown[]}>;
for(const summaryOnly of [false,true]){
 const data=await load({summaryOnly});
 assert.notEqual(data.legacyCreationAvailable,true,`PGRST202 never enables legacy creation (summaryOnly=${summaryOnly})`);
}
pilotError=null;
assert.equal((await load()).legacyCreationAvailable,true,'A readable, unconfigured pilot with no history keeps legacy creation');
pilotError=Object.assign(Error('Booking workspace unavailable'),{code:'PGRST303'});
assert.notEqual((await load()).legacyCreationAvailable,true,'A real pilot outage still never enables legacy creation');
console.log('Absent-pilot inference narrowed: PGRST202 and other read failures never enable legacy creation; a readable empty unconfigured pilot still does.');
