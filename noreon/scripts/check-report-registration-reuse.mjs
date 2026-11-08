/** Actual report page, context and registration reader; request client replaced, no network. */
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
process.env.NEXT_PUBLIC_PATIENT_DEMO='false';
process.env.NEXT_PUBLIC_SUPABASE_URL='http://localhost:61821';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY='fixture';
process.env.SUPABASE_SERVICE_ROLE_KEY='fixture';
globalThis.__review={authCalls:0,consent:true,authStatus:0};
const hook=registerHooks({resolve(s,c,next){
const stubs={
'@/components/patient/patient-shell':'export function PatientShell({children}){return children}',
'@/lib/supabase/server':`export async function createClient(){return {auth:{async getUser(){const r=globalThis.__review;r.authCalls++;return r.authStatus||r.authCalls>1?{data:{user:null},error:{status:r.authStatus||503}}:{data:{user:{id:"fictional",phone:"+12025550199",phone_confirmed_at:"2026-01-01"}},error:null}}},from(table){const data=table==="profiles"?{id:"fictional",locale:"en",birth_date:"1990-01-01",biological_sex:"male",display_name:"Fictional"}:table==="patient_assessments"?{id:"fictional-assessment",answers:{},revision:1}:globalThis.__review.consent?{version:"fixture"}:null;return {select(){return this},eq(){return this},async single(){return {data,error:null}},async maybeSingle(){return {data,error:null}}}}}}`,
};
if(stubs[s])return {url:'data:text/javascript,'+encodeURIComponent(stubs[s]),shortCircuit:true};
return next(s,c);
}});
try {
const {default:Page}=await import('@/app/patient/reports/page');
await Page();assert.equal(globalThis.__review.authCalls,1,'No second Auth call after valid context');
globalThis.__review.authCalls=0;globalThis.__review.consent=false;
await assert.rejects(Page,e=>(e.digest??'').includes('/patient/profile'));
for(const status of [408,429,503]){globalThis.__review.authCalls=0;globalThis.__review.authStatus=status;await assert.rejects(Page,e=>!e.digest&&/temporarily unavailable/.test(e.message))}
console.log('Actual reports page/context/database-reader check passes: one Auth read, full registration consent gate, Auth408/429/503 reach error boundary.');
}finally{hook.deregister()}
