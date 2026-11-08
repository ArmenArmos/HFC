// Execute readInbox itself with real Supabase queries against a fictional HTTP
// boundary. Identity and database responses are controlled; scoping stays real.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createClient} from '@supabase/supabase-js';
import type {StaffIdentity} from '../lib/staff/types';
let identity: StaffIdentity | null = {id:'nurse-current',email:'fictional@example.invalid',name:'Fictional nurse',role:'nurse',clinicId:'clinic-current'};
type Row = {id:number;recipient:string;read_at:null;workspace_activity:{id:number;case_id:string;kind:string;created_at:string;workspace_cases:{assigned_doctor_id:string;assigned_nurse_id:string;expires_at:string}}};
const row = (id:number,caseId:string,recipient='staff:nurse-current',nurse='nurse-current',doctor='doctor-current'):Row => ({id,recipient,read_at:null,workspace_activity:{id,case_id:caseId,kind:'measurement-recorded',created_at:'2026-10-13T08:00:00Z',workspace_cases:{assigned_doctor_id:doctor,assigned_nurse_id:nurse,expires_at:'2030-01-01T00:00:00Z'}}});
let rows: Row[] = [];
let queryError = false;
let queries: URL[] = [];
let rpcCases: string[] = [];
let inFlight = 0;
let maxInFlight = 0;
const client = createClient('http://127.0.0.1:1','fictional-unused-key', {auth:{persistSession:false,autoRefreshToken:false},global:{fetch: async (input,init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  assert.equal(url.origin,'http://127.0.0.1:1','Test must never access an external database');
  if(url.pathname.endsWith('/workspace_notifications')) {
    queries.push(url);
    if(queryError) return Response.json({message:'Database unavailable'}, {status:503});
    const equal = (column:string,value:string) => !url.searchParams.has(column)||url.searchParams.get(column)===`eq.${value}`;
    return Response.json(rows.filter(value => equal('recipient',value.recipient)
      &&equal('workspace_activity.workspace_cases.assigned_nurse_id',value.workspace_activity.workspace_cases.assigned_nurse_id)
      &&equal('workspace_activity.workspace_cases.assigned_doctor_id',value.workspace_activity.workspace_cases.assigned_doctor_id)
      &&equal('workspace_activity.case_id',value.workspace_activity.case_id)));
  }
  assert.equal(url.pathname,'/rest/v1/rpc/staff_care_access');
  const body = JSON.parse(String(init?.body)) as {p_id:string;p_actor:string;p_native:boolean};
  assert.equal(body.p_actor,'nurse-current');
  assert.equal(body.p_native,false);
  rpcCases.push(body.p_id);
  inFlight++;maxInFlight=Math.max(maxInFlight,inFlight);
  try {
    await new Promise(resolve=>setTimeout(resolve,5));
    if(body.p_id==='access-error') return Response.json({message:'Access unavailable'}, {status:503});
    if(body.p_id==='inactive-clinic') return Response.json(false);
    if(body.p_id==='ambiguous-access') return Response.json({allowed:true});
    return Response.json(true);
  } finally {inFlight--;}
}}});
const exports: Record<string, unknown> = {};
const source = readFileSync('lib/notifications/server.ts','utf8');
const code = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
new vm.Script(code).runInNewContext({exports,require(name:string) {
  if(name==='server-only') return {};
  if(name==='@/lib/staff/auth') return {getStaff:async()=>identity,workspaceAdmin:()=>client};
  if(name==='@/lib/staff/cases') return {requireMemberCase:async()=>({id:'member-case'})};
  throw new Error(`Unexpected module ${name}`);
}});
const {readInbox} = exports as {readInbox:(staff:boolean)=>Promise<{id:number;caseId:string}[]>};
function reset() {queries=[];rpcCases=[];maxInFlight=0;queryError=false;}
rows=[...Array.from({length:10},(_,index)=>row(index+1,`allowed-${index}`)),row(11,'allowed-0'),row(12,'inactive-clinic'),row(13,'access-error'),row(14,'ambiguous-access'),row(15,'formerly-assigned','staff:nurse-current','another-nurse'),row(16,'another-recipient','staff:another-nurse')];
let inbox = await readInbox(true);
assert.deepEqual(Array.from(inbox,value=>value.id),[1,2,3,4,5,6,7,8,9,10,11],'Inactive, unavailable, ambiguous, reassigned and other-recipient metadata must be omitted');
assert.equal(queries[0].searchParams.get('recipient'),'eq.staff:nurse-current');
assert.equal(queries[0].searchParams.get('workspace_activity.workspace_cases.assigned_nurse_id'),'eq.nurse-current');
assert.equal(queries[0].searchParams.get('limit'),'100');
assert.ok(queries[0].searchParams.get('workspace_activity.workspace_cases.expires_at')?.startsWith('gt.'));
assert.equal(rpcCases.filter(id=>id==='allowed-0').length,1,'Several notifications for one case perform one current access check');
assert.equal(rpcCases.length,13);
assert.equal(maxInFlight,8,'Current access checks remain bounded to eight concurrent cases');
reset();rows=[row(1,'inactive-clinic'),row(2,'access-error'),row(3,'ambiguous-access')];
assert.equal((await readInbox(true)).length,0,'An entirely denied or unavailable nurse inbox fails closed');
reset();queryError=true;
await assert.rejects(readInbox(true),/Notifications could not be loaded/);
assert.equal(rpcCases.length,0);
reset();identity={...identity!,id:'doctor-current',role:'doctor'};
rows=[row(1,'doctor-case','staff:doctor-current'),row(2,'other-doctor-case','staff:doctor-current','nurse-current','doctor-other'),row(3,'wrong-recipient')];
inbox=await readInbox(true);
assert.deepEqual(Array.from(inbox,value=>value.id),[1]);
assert.equal(queries[0].searchParams.get('workspace_activity.workspace_cases.assigned_doctor_id'),'eq.doctor-current');
assert.equal(queries[0].searchParams.has('workspace_activity.workspace_cases.assigned_nurse_id'),false);
assert.equal(rpcCases.length,0,'Doctor recipient scoping needs no nurse access RPC');
reset();identity={...identity,id:'admin-current',role:'admin'};
rows=[row(1,'admin-case','staff:admin-current','other-nurse','other-doctor'),row(2,'wrong-recipient')];
assert.deepEqual(Array.from(await readInbox(true),value=>value.id),[1]);
assert.equal(queries[0].searchParams.get('recipient'),'eq.staff:admin-current');
assert.equal(queries[0].searchParams.has('workspace_activity.workspace_cases.assigned_doctor_id'),false);
assert.equal(queries[0].searchParams.has('workspace_activity.workspace_cases.assigned_nurse_id'),false);
assert.equal(rpcCases.length,0,'Admin inbox preserves recipient behavior without nurse RPC');
reset();identity=null;
await assert.rejects(readInbox(true));
assert.equal(queries.length,0,'Unauthenticated staff cannot read notification metadata');
console.log('Nurse inbox requires current assignment and exact active access, deduplicates bounded checks, fails closed, and preserves doctor/admin recipient scoping.');
