import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
// @ts-expect-error Runtime provides registerHooks; project types target Node 20.
import {registerHooks} from 'node:module';
let rpcMode:'ticket'|'403'|'throw'='ticket';
Object.assign(globalThis,{__clinicPdfMode:()=>rpcMode});
// Exercise the installed SDK's nonstandard RPC error body, with an in-memory fetch.
const refusedClient=createClient('https://clinic-check.invalid','fictional-public-key',{
 auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
 global:{fetch:async()=>new Response('{"status":"refused"}',{status:403,headers:{'Content-Type':'application/json'}})},
});
const refused=await refusedClient.rpc('clinic_member_file_download',{});
assert.equal(refused.status,403);assert.equal(refused.data,null);
assert.deepEqual(refused.error,{status:'refused'},'supabase-js treats the refused JSON as an error without a code/message');
Object.assign(globalThis,{__clinicPdf403:refused});
const calls:{name:string;args:unknown}[]=[];
Object.assign(globalThis,{__clinicPdfAudit:calls});
registerHooks({resolve(s:string,c:object,next:(s:string,c:object)=>object){
 if(s==='@/lib/lab-ai/upload-trigger')return{url:'data:text/javascript,export function scheduleLabRead(){throw Error("PDF access must never kick lab reading")}',shortCircuit:true};
 if(s==='@/lib/clinic-portal/identity')return{url:`data:text/javascript,export async function requireClinicPortal(){return {identity:{clinicId:"c1000000-0000-4000-8000-000000000001"},actorScope:"current",rpc:{async rpc(name,args){globalThis.__clinicPdfAudit.push({name,args});if(globalThis.__clinicPdfMode()==="throw")throw Error("private@example.invalid 1975-04-05 +37499080177");if(globalThis.__clinicPdfMode()==="403")return globalThis.__clinicPdf403;return {error:null,data:{status:"ok",accessId:"c1000000-0000-4000-8000-000000000004",fileId:args.p_file}}}}}}`,shortCircuit:true};
 if(s==='@/lib/clinic-portal/lab-results-actions')return{url:'data:text/javascript,export async function clinicLabResults(){throw Error("unused render-only action")}export async function clinicLabLink(){throw Error("unused render-only action")}',shortCircuit:true};
 if(s==='@/lib/patient-care/clinical-publication-server')return{url:'data:text/javascript,export function clinicalWriteClient(){throw Error("Clinic PDF denial must never use service storage")}',shortCircuit:true};
 if(s==='@/lib/observability/with-logging')return{url:'data:text/javascript,export const withRouteLogging=f=>f',shortCircuit:true};
 return next(s,c);
}});
const memberId='c1000000-0000-4000-8000-000000000002',fileId='c1000000-0000-4000-8000-000000000003';
const logged:unknown[][]=[];
const originalError=console.error,originalWarn=console.warn;
console.error=(...args:unknown[])=>{logged.push(args);};console.warn=(...args:unknown[])=>{logged.push(args);};
const memberRoute=await import('@/app/clinic/real/members/[memberId]/files/[fileId]/route');
const batchRoute=await import('@/app/clinic/real/batches/[id]/files/[fileId]/route');
for(rpcMode of ['ticket','403','throw'] as const)for(const [route,params,rpc]of [[memberRoute,{memberId,fileId},'clinic_member_file_download'],[batchRoute,{id:memberId,fileId},'clinic_original_access']]as const){
 assert.ok('GET'in route,'Batch and member PDF URLs both explicitly refuse reads');
 const response=await (route as typeof memberRoute).GET(new Request('http://localhost/file?clinic=c1000000-0000-4000-8000-000000000001',{headers:{'x-clinic-ui-scope':'current'}}),{params:Promise.resolve(params as {memberId:string;fileId:string})});
 assert.equal(response.status,403,'Clinic session is refused even if an older database returns an access ticket');
 assert.equal(await response.text(),'','Refusal has no PDF bytes or sensitive error text');
 assert.match(response.headers.get('cache-control')!,/no-store/);
 assert.equal(response.headers.get('content-disposition'),null);
 assert.equal(calls.at(-1)?.name,rpc,'Attempt reaches the existing audited RPC');
 const before=calls.length;
 const stale=await (route as typeof memberRoute).GET(new Request('http://localhost/file',{headers:{'x-clinic-ui-scope':'stale'}}),{params:Promise.resolve(params as {memberId:string;fileId:string})});
 assert.equal(stale.status,403);assert.equal(await stale.text(),'');
 assert.equal(calls.length,before+1,'Even a stale UI scope receives an audited refusal');
}
const {clinicBookingSchema}=await import('@/lib/clinic-scheduling/schema');
const {openClinicOriginal}=await import('@/lib/clinic-portal/result-attach-runtime');
const {openClinicMemberPdf}=await import('@/lib/clinic-scheduling/member-file');
assert.equal(await openClinicOriginal(refusedClient,fileId),null,'Admin open handles the real SDK refusal error shape');
assert.equal(await openClinicMemberPdf(refusedClient,memberId,memberId,fileId),null,'Member open handles the real SDK refusal error shape');
for(const error of [{code:'42501',message:'denied'}]){
 const rpc={rpc:async()=>({data:null,error,status:403,statusText:'Forbidden'})};
 assert.equal(await openClinicOriginal(rpc,fileId),null,'Admin open handles supabase-js 403 without returning a target');
 assert.equal(await openClinicMemberPdf(rpc,memberId,memberId,fileId),null,'Member open handles supabase-js 403');
}
console.error=originalError;console.warn=originalWarn;
assert.doesNotMatch(JSON.stringify(logged),/private@example[.]invalid|1975-04-05|37499080177/,'RPC error details are never logged');
const {clinicLabFileSchema}=await import('@/lib/clinic-portal/lab-results-schema');
const {compareSchema}=await import('@/lib/clinic-admin/files-schema');
const reading={state:'done',outcome:'read',identityStatus:'mismatch',nameMatch:'no',birthYearMatch:'yes'};
const labFile={fileId,name:'Lab PDF',uploadedAt:'2026-11-05T08:00:00Z',linked:null,everLinked:false,suggestion:null,reading};
assert.ok(clinicLabFileSchema.safeParse(labFile).success,'Clinic reading accepts match outcomes only');
const canary='Fictional Member +37499080177 private@example.invalid 1975-04-05';
assert.equal(clinicLabFileSchema.safeParse({...labFile,reading:{...reading,nameOnSheet:canary}}).success,false,'Clinic DTO rejects extracted free text');
const comparison={status:'compared',read:true,differs:true,mismatch:'name',sheet:{nameMatch:'no',birthYearMatch:'yes'},member:{name:'Synthetic',birthDate:null}};
assert.ok(compareSchema.safeParse(comparison).success,'Clinic comparison accepts outcomes');
assert.equal(compareSchema.safeParse({...comparison,sheet:{...comparison.sheet,name:canary}}).success,false,'Clinic comparison rejects extracted names');
const {memberFileSchema}=await import('@/lib/clinic-scheduling/member-file');
const booking={appointmentId:fileId,memberId,revision:1,reference:fileId,kind:'current',status:'confirmed',channel:'portal',memberName:'Synthetic member',memberPhone:null,startsAt:'2099-01-01T08:00:00Z',endsAt:'2099-01-01T09:00:00Z',previousStartsAt:null,previousEndsAt:null,tests:[],proposal:null,decline:null};
assert.ok(clinicBookingSchema.safeParse(booking).success);
assert.equal(clinicBookingSchema.safeParse({...booking,memberPhone:'+99900000391'}).success,false,'Booking DTO refuses full phone');
const file={version:'clinic-member-file-v1',enabled:true,status:'ok',member:{memberId,name:'Synthetic',phone:null,birthDate:null},bookings:[],checkins:[],visits:[],files:[]};
assert.ok(memberFileSchema.safeParse(file).success);
assert.equal(memberFileSchema.safeParse({...file,member:{...file.member,phone:'+99900000391'}}).success,false,'Member DTO refuses full phone');
const {MemberResultsUpload}=await import('@/components/clinic-portal/member-results-upload');
const {ClinicLabResults}=await import('@/components/clinic-portal/lab-results');
for(const [locale,labels,yearLabels] of [
 ['en',['Name on the sheet matches','Name on the sheet does not match','Name match could not be checked'],['Birth year on the sheet matches','Birth year on the sheet does not match','Birth year match could not be checked']],
 ['hy',['Թերթիկում նշված անունը համընկնում է','Թերթիկում նշված անունը չի համընկնում','Անվան համընկնումը չհաջողվեց ստուգել'],['Թերթիկում նշված ծննդյան տարեթիվը համընկնում է','Թերթիկում նշված ծննդյան տարեթիվը չի համընկնում','Ծննդյան տարեթվի համընկնումը չհաջողվեց ստուգել']],
 ['ru',['Имя на бланке совпадает','Имя на бланке не совпадает','Не удалось проверить совпадение имени'],['Год рождения на бланке совпадает','Год рождения на бланке не совпадает','Не удалось проверить совпадение года рождения']],
] as const){
 for(const [i,match] of (['yes','no','unknown'] as const).entries()){
  const compare={...comparison,status:'compared' as const,mismatch:'name' as const,sheet:{nameMatch:match,birthYearMatch:match}};
  const upload={fileId,name:'Lab PDF',uploadedAt:'2026-11-05T08:00:00Z',fromRecord:true,state:'check' as const,attached:false,override:false,fileReading:'done' as const,memberReading:null,readingOn:true,compare};
  const memberHtml=renderToStaticMarkup(createElement(MemberResultsUpload,{locale,clinicId:memberId,memberId,actorScope:'synthetic',initial:{version:'clinic-member-files-v1',enabled:true,status:'ok',uploadAvailable:true,uploads:[upload],unmatched:[]},begin:async()=>({status:'unavailable' as const}),reserve:async()=>({status:'unavailable' as const}),read:async()=>({status:'unavailable' as const}),attach:async()=>({status:'unavailable' as const})}));
  const labHtml=renderToStaticMarkup(createElement(ClinicLabResults,{locale,clinicId:memberId,batchId:memberId,actorScope:'synthetic',refreshKey:0,initial:{version:'clinic-lab-results-v1',enabled:true,reading:true,members:[],files:[{...labFile,reading:{state:'done',outcome:'read',identityStatus:'mismatch',nameMatch:match,birthYearMatch:match}}]}}));
  for(const html of [memberHtml,labHtml]){
   assert.ok(html.includes(yearLabels[i]),`${locale}: both views render the ${match} birth-year outcome`);
   assert.ok(html.includes(labels[i]),`${locale}: both clinic views render the ${match} name outcome`);
   assert.doesNotMatch(html,/37499080177|private@example[.]invalid|1975-04-05/,'No extracted identity content in rendered views');
  }
 }
}
console.log('Clinic PDF/phone lockdown PASS: both actual GET handlers refuse/audit, no service reads, strict identity DTOs; EN/HY/RU outcome views. Identity/RPC mocked; React server rendering, not browser/Auth.');
