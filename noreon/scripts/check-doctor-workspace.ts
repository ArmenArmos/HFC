import assert from 'node:assert/strict';
import {doctorWorkspaceEnabled} from '@/lib/staff-zoe/workspace-config';
import {readDoctorWorkspace} from '@/lib/staff-zoe/workspace-read';

const id='11111111-1111-4111-8111-111111111111';
const cid='22222222-2222-4222-8222-222222222222';
const calls:string[]=[];
let enabled=true,deny=false,listDenied=false;
const client={async rpc(name:string,args?:Record<string,unknown>){calls.push(name);
 if(name==='staff_zoe_status')return {data:enabled,error:null};
 if(name==='patient_clinical_case_search_identity'){
  assert.deepEqual(args,{p_query:''});
  return {data:{rows:[],hasMore:false,nextCursor:null},error:listDenied?{code:'42501'}:null};
 }
 if(name==='staff_zoe_read')return deny?{data:null,error:{code:'42501'}}:{data:{enabled:true,id:cid,member:{id,name:'Recorded member',birthYear:1970,sex:null},messages:[]},error:null};
 throw Error(`Unexpected RPC ${name}`);
}};
assert.equal(doctorWorkspaceEnabled({}),false);
assert.equal(doctorWorkspaceEnabled({NOREON_DOCTOR_WORKSPACE:'true'}),true);
assert.equal(doctorWorkspaceEnabled({NOREON_DOCTOR_WORKSPACE:'TRUE'}),false);
// The real shared record reader is used, injected only to keep this orchestration check offline.
const reads:string[]=[];
const read=async(tool:string,memberId:string,role:string)=>{assert.equal(memberId,id);assert.equal(role,'doctor');reads.push(tool);
 return {tool,state:'none',facts:[],quotes:[],missing:[],href:`/staff/real/members/${id}`} as never;};
for(const role of ['admin','nurse']as const){calls.length=0;assert.equal(await readDoctorWorkspace(client,role,cid,read),null);assert.deepEqual(calls,[]);}
enabled=false;assert.equal(await readDoctorWorkspace(client,'doctor',cid,read),null);assert.equal(reads.length,0);
enabled=true;calls.length=0;
const x=await readDoctorWorkspace(client,'doctor',cid,read);
assert.equal(x?.conversation?.member.id,id);assert.equal(x?.refused,false);assert.equal(x?.members?.rows.length,0);
assert.ok(reads.includes('bp')&&reads.includes('plan')&&reads.includes('open_items'));
assert.ok(!calls.some(c=>/command|publish|approve|begin|finish/.test(c)),'Opening the workspace does no clinical writes or AI calls');
listDenied=true;
assert.equal((await readDoctorWorkspace(client,'doctor',undefined,read))?.members,null,'An audit refusal is unavailable, never a successful empty list');
listDenied=false;
reads.length=0;deny=true;
assert.equal((await readDoctorWorkspace(client,'doctor',cid,read))?.refused,true);assert.deepEqual(reads,[],'Denied conversation never reads a glance');
deny=false;reads.length=0;
const bad=await readDoctorWorkspace(client,'doctor','invalid',read);assert.equal(bad?.refused,true);assert.equal(reads.length,0);
console.log('Doctor workspace: role/status gates, scoped reads and refusal checks passed');

// Shared production reader: page and chat use the same fact mapping; a gate's member wins over the request.
const {staffRecordReader,staffTools}=await import('@/lib/staff-zoe/server');
const {AccessLost}=await import('@/lib/staff-zoe/turn');
const {FICTIONAL_RECORDS,MEMBER_A,MEMBER_B,EVAL_NOW}=await import('@/lib/staff-zoe/eval/fixtures');
const snapshots:string[]=[];
const rpc={async rpc(name:string,args?:Record<string,unknown>){
 if(name==='staff_zoe_gate')return {data:{memberId:MEMBER_B},error:null};
 assert.equal(name,'patient_clinical_case_snapshot');const member=String(args?.p_user_id);snapshots.push(member);
 return {data:FICTIONAL_RECORDS[member]?.snapshot,error:null};
}};
const reader=staffRecordReader(rpc,'en',EVAL_NOW);
const first=await reader('overview',MEMBER_A,'doctor');const second=await reader('overview',MEMBER_B,'doctor');
assert.equal(first.state,'ok');assert.ok(first.facts.some(f=>f.label==='Age'));assert.ok(!second.facts.some(f=>f.label==='Age'),'Member B cannot get member A’s cached age');
await reader('overview',MEMBER_A,'doctor');assert.deepEqual(snapshots,[MEMBER_A,MEMBER_B],'Cache is per member, within one request only');
const gated=await staffTools(rpc,'en',EVAL_NOW)('overview',{runId:cid,memberId:MEMBER_A,role:'doctor'});
assert.ok(!gated.facts.some(f=>f.label==='Age'),'Chat reads the member returned by staff_zoe_gate');
await assert.rejects(()=>staffTools({rpc:async()=>({data:null,error:{code:'42501'}})},'en',EVAL_NOW)('overview',{runId:cid,memberId:MEMBER_A,role:'doctor'}),AccessLost);
const failed=await readDoctorWorkspace(client,'doctor',cid,async()=>{throw new AccessLost();});
assert.equal(failed?.conversation,null);assert.equal(failed?.refused,true);assert.equal(failed?.glance.length,0,'Lost access clears all glance data');
const partial=await readDoctorWorkspace(client,'doctor',cid,async(tool,memberId)=>{if(tool==='bp')throw Error('Unavailable');return {tool,state:'none',facts:[],quotes:[],missing:[],href:`/staff/real/members/${memberId}`};});
assert.equal(partial?.glance.find(r=>r.tool==='bp')?.state,'unavailable');assert.equal(partial?.refused,false,'A read outage is not an empty clinical record or a lost session');
console.log('Doctor workspace shared reader: per-member cache, chat gate, lost access and partial outage passed');
