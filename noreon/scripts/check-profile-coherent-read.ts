import assert from 'node:assert/strict';
// @ts-expect-error Node 26 runtime supports registerHooks; declarations target Node 20.
import {registerHooks} from 'node:module';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {Database} from '@/lib/db/types';
import {createDatabasePatientStore} from '@/lib/patient/database-store';

// A profile read captures the old committed value, then a concurrent atomic
// profile+assessment save commits before the next assessment request completes.
// This models independently timed REST requests without a real database.
function fixture(initialAssessment: boolean, changes: number, replaceIdentity = false) {
 let revision=0,identity='assessment-original',birthDate='1974-05-18',present=initialAssessment;
 const requests:string[]=[];
 const client={from(table:string){return {select(){return this;},eq(){return this;},
  single(){return query(table);},maybeSingle(){return query(table);},
 };}} as unknown as SupabaseClient<Database>;
 function query(table:string){
  requests.push(table);
  let data:unknown;
  if(table==='profiles'){
   data={display_name:'Synthetic read interleave',birth_date:birthDate,biological_sex:'male',locale:'en'};
   if(changes>0){changes--;birthDate='1973-05-18';if(replaceIdentity)identity='assessment-replacement';else revision++;present=true;}
  }else if(table==='patient_assessments')data=present?{id:identity,revision,assessment_date:'2026-10-15',answers:{},completed_at:null,urgent_rule:null}:null;
  else if(table==='patient_consents')data={version:'patient-pilot-v1'};
  else throw Error(`Unexpected table ${table}`);
  return Promise.resolve({data,error:null});
 }
 const store=createDatabasePatientStore(async()=>client,()=>{throw Error('Reader must never request a privileged writer');});
 // The cast lets this regression run RED against the original one-argument API.
 const read=store.read as (id:string,options?:{coherentProfile?:boolean})=>ReturnType<typeof store.read>;
 return {read,requests,client};
}
const interleaved=fixture(true,1);
const corrected=await interleaved.read('synthetic-owner',{coherentProfile:true});
assert.equal(corrected.profile!.birthDate,'1973-05-18','Profile and assessment version must come from a coherent snapshot after a concurrent correction');
assert.equal(corrected.assessment!.revision,1);
assert.equal(interleaved.requests.filter(table=>table==='profiles').length,2,'Concurrent correction retries the whole snapshot');
const creating=fixture(false,1);
const created=await creating.read('synthetic-owner',{coherentProfile:true});
assert.equal(created.profile!.birthDate,'1973-05-18','Absent→created assessment retries instead of pairing old profile with new version');
assert.equal(created.assessment!.revision,1);
assert.equal(creating.requests.filter(table=>table==='profiles').length,2);
const replaced=fixture(true,1,true);
const replacement=await replaced.read('synthetic-owner',{coherentProfile:true});
assert.equal(replacement.profile!.birthDate,'1973-05-18','Assessment identity changes also invalidate the snapshot even when revision matches');
assert.equal(replacement.assessment!.id,'assessment-replacement');
const churning=fixture(true,10);
await assert.rejects(churning.read('synthetic-owner',{coherentProfile:true}),/Patient storage unavailable/,'Continual changes fail closed');
assert.equal(churning.requests.filter(table=>table==='profiles').length,3,'Snapshot retry is bounded');
const unchanged=fixture(true,0);
await unchanged.read('synthetic-owner');
assert.equal(unchanged.requests.length,3,'Ordinary reads retain their three-query path');
console.log('Actual database reader with simulated concurrent commits: correction, creation, identity replacement retry; sustained churn fails closed; ordinary reads retain three requests.');

const forwarded=fixture(true,1);
Object.assign(globalThis,{__coherentProfileClient:forwarded.client});
const hook=registerHooks({resolve(s:string,c:{parentURL?:string},next:(s:string,c:object)=>object){
 const dependency=c.parentURL?.endsWith("/lib/patient/repository.ts") && (s==="./auth" || s==="./demo") ? "@/lib/patient/"+s.slice(2) : s;
 const mocks:Record<string,string>={
  '@/lib/supabase/server':'export const createClient=async()=>globalThis.__coherentProfileClient;',
  '@/lib/patient/auth':'export const requirePatient=async()=>({userId:"synthetic-owner"});',
  '@/lib/patient/demo':'export const demoEnabled=()=>false;export const demoStore=()=>{throw Error("Unexpected demo")};export const readDemo=()=>null;',
 };
 return mocks[dependency]?{url:'data:text/javascript,'+encodeURIComponent(mocks[dependency]),shortCircuit:true}:next(s,c);
}});
try{
 const {getPatientState}=await import('@/lib/patient/repository');
 const state=await getPatientState({coherentProfile:true});
 assert.equal(state.profile!.birthDate,'1973-05-18','Authenticated repository forwards the coherent read option to the actual database store');
 assert.equal(forwarded.requests.filter(table=>table==='profiles').length,2);
}finally{hook.deregister();Reflect.deleteProperty(globalThis,'__coherentProfileClient');}
