/**
 * The staff report download (test gap 3): GET app/staff/real/(review)/members/[id]/reports/[reportId]/route.ts, the
 * actual handler, with only its session, database and storage boundaries stubbed. It signs with the service role, so a
 * report outside the member's own snapshot, a missing or deleted report, or a failed access record must reach no
 * signing call. A permitted request signs the right bucket and key for 60 seconds.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {z} from 'zod';
import {NextResponse} from 'next/server';
import {snapshotSchema} from '@/lib/patient-care/clinical-case-repository';

const MEMBER='3a000000-0000-4000-8000-000000000001',OTHER='3a000000-0000-4000-8000-000000000002';
const REPORT='3a000000-0000-4000-8000-0000000000a1',FOREIGN='3a000000-0000-4000-8000-0000000000a2';
const SIGNED='https://storage.invalid/signed/fictional?token=fictional';
const snapshot=(reports:string[])=>({id:'3a000000-0000-4000-8000-0000000000c1',revision:1,evidenceToken:'fictional',draft:null,draftSavedAt:null,draftStale:false,
 evidence:{profile:{name:null,birthDate:null,biologicalSex:null},consent:null,assessment:null,measurements:[],reports:reports.map(id=>({id,revision:1,state:'confirmed',reviewed:null,confirmedAt:null}))}});
snapshotSchema.parse(snapshot([REPORT]));

type World={staff?:'denied';snapshot?:{data:unknown;error:unknown};audit?:{error:unknown};row?:{data:unknown;error:unknown};signed?:{data:unknown;error:unknown};serviceThrows?:boolean};
function world(w:World={}){
 const calls={rpc:[] as {name:string;args:Record<string,unknown>}[],filters:[] as unknown[][],tables:[] as string[],sign:[] as {bucket:string;path:string;seconds:number}[],service:0};
 const client={rpc:async(name:string,args:Record<string,unknown>)=>{
  calls.rpc.push({name,args});
  if(name==='patient_clinical_case_snapshot')return w.snapshot??{data:snapshot(args.p_user_id===MEMBER?[REPORT]:[FOREIGN]),error:null};
  if(name==='staff_record_member_access')return w.audit??{error:null};
  throw Error(`Unexpected rpc ${name}`);
 }};
 const query={select(){return query;},eq(...a:unknown[]){calls.filters.push(['eq',...a]);return query;},is(...a:unknown[]){calls.filters.push(['is',...a]);return query;},maybeSingle:async()=>w.row??{data:{object_path:`${MEMBER}/report.pdf`},error:null}};
 const admin={from(table:string){calls.tables.push(table);return query;},storage:{from:(bucket:string)=>({createSignedUrl:async(path:string,seconds:number)=>{calls.sign.push({bucket,path,seconds});return w.signed??{data:{signedUrl:SIGNED},error:null};}})}};
 const exports:Record<string,unknown>={};
 const code=ts.transpileModule(readFileSync('app/staff/real/(review)/members/[id]/reports/[reportId]/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 new vm.Script(code).runInNewContext({exports,require(name:string){
  if(name==='@/lib/observability/with-logging')return {withRouteLogging:(fn:unknown)=>fn};
  if(name==='next/server')return {NextResponse};
  if(name==='zod')return {z};
  if(name==='@/lib/patient-care/clinical-case-repository')return {snapshotSchema,requireRealStaff:async()=>{if(w.staff==='denied')throw Error('NEXT_REDIRECT /staff/real/login');return {client};}};
  if(name==='@/lib/patient-care/clinical-publication-server')return {clinicalWriteClient:()=>{calls.service++;if(w.serviceThrows)throw Error('Clinical review is unavailable.');return admin;}};
  throw Error(`Unexpected boundary in the report route: ${name}`);
 }});
 const GET=exports.GET as (r:Request,c:{params:Promise<{id:string;reportId:string}>})=>Promise<Response>;
 return {calls,get:(id:string,reportId:string)=>GET(new Request(`https://backoffice.invalid/staff/real/members/${id}/reports/${reportId}`),{params:Promise.resolve({id,reportId})})};
}
// Objects built inside the vm have their own prototypes: compare plain copies.
const plain=(v:unknown)=>JSON.parse(JSON.stringify(v)) as unknown;
const noSigning=(h:ReturnType<typeof world>,label:string)=>assert.equal(h.calls.sign.length,0,`${label}: nothing is signed`);

{// A permitted request: the member's own report, audited, then signed for 60 seconds from the private bucket.
 const h=world();
 const r=await h.get(MEMBER,REPORT);
 assert.equal(r.status,307);assert.equal(r.headers.get('location'),SIGNED);
 assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(r.headers.get('referrer-policy'),'no-referrer');
 assert.deepEqual(h.calls.sign,[{bucket:'patient-reports',path:`${MEMBER}/report.pdf`,seconds:60}]);
 assert.deepEqual(h.calls.rpc.map(c=>c.name),['patient_clinical_case_snapshot','staff_record_member_access'],'the access record comes before the service client');
 assert.deepEqual(plain(h.calls.rpc[1]!.args),{p_member:MEMBER,p_surface:'member_report',p_object:REPORT});
 assert.deepEqual(h.calls.tables,['patient_reports']);
 assert.deepEqual(plain(h.calls.filters),[['eq','id',REPORT],['eq','user_id',MEMBER],['is','deleted_at',null]],'the row is pinned to the report, the member and not deleted');
}
{// Another member's report: not in this member's snapshot, so nothing further happens, whichever id is the wrong one.
 for(const [member,report] of [[MEMBER,FOREIGN],[OTHER,REPORT]] as const){
  const h=world();
  assert.equal((await h.get(member,report)).status,404);
  noSigning(h,'cross-member');assert.equal(h.calls.service,0,'the service client is never made');
  assert.deepEqual(h.calls.rpc.map(c=>c.name),['patient_clinical_case_snapshot'],'no access is recorded for what was not opened');
 }
}
{// Not this staff member's case: the snapshot read is refused.
 const h=world({snapshot:{data:null,error:{code:'42501'}}});
 assert.equal((await h.get(MEMBER,REPORT)).status,404);noSigning(h,'refused snapshot');assert.equal(h.calls.service,0);
}
{// A snapshot of an unexpected shape stops the request.
 const h=world({snapshot:{data:{evidence:{reports:[{id:REPORT}]}},error:null}});
 await assert.rejects(h.get(MEMBER,REPORT));noSigning(h,'malformed snapshot');assert.equal(h.calls.service,0);
}
{// No session: nothing is read.
 const h=world({staff:'denied'});
 await assert.rejects(h.get(MEMBER,REPORT),/NEXT_REDIRECT/);assert.equal(h.calls.rpc.length,0);noSigning(h,'no session');
}
{// Malformed ids never reach the database.
 const h=world();
 assert.equal((await h.get('not-a-uuid',REPORT)).status,404);assert.equal((await h.get(MEMBER,'not-a-uuid')).status,404);
 assert.equal(h.calls.rpc.length,0);noSigning(h,'malformed ids');
}
{// The access record failed: no document, and the service client is never made.
 const h=world({audit:{error:{code:'XX000'}}});
 const r=await h.get(MEMBER,REPORT);
 assert.equal(r.status,503);noSigning(h,'audit failure');assert.equal(h.calls.service,0);
}
{// A report deleted or gone since the snapshot, or a read that failed.
 for(const row of [{data:null,error:null},{data:null,error:{code:'PGRST'}}]){
  const h=world({row});
  assert.equal((await h.get(MEMBER,REPORT)).status,404);noSigning(h,'missing or deleted report');
 }
}
{// Signing itself failed: 503, and no link.
 const h=world({signed:{data:null,error:{message:'no such object'}}});
 const r=await h.get(MEMBER,REPORT);
 assert.equal(r.status,503);assert.equal(r.headers.get('location'),null);
}
console.log('check-staff-report-download-route: 9 scenarios passed (actual handler, boundaries stubbed)');
