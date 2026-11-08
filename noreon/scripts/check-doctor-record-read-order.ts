/** The doctor record's reads that lock the case row must not overlap: Postgres refuses the second with NOWAIT.
 * Synthetic RPC, no database. The fake refuses an overlap the same way, so the member's messages stay readable only
 * when the reads take turns. */
import assert from 'node:assert/strict';
import {readWorkspaceSelection} from '@/lib/staff-zoe/workspace-read';
import {staffRecordReader} from '@/lib/staff-zoe/server';
import {runDoctorHome} from '@/lib/staff-zoe/home-read';
import {retryOnLock} from '@/lib/doctor-decisions/read';

const member='aa110000-0000-4000-8000-000000000001',conversation='bb110000-0000-4000-8000-000000000001';
const LOCKING=new Set(['conversation_workspace','zoe_runs_for_doctor','doctor_chat_conversation','conversation_actions','doctor_decision_reply','doctor_approval_cards_read','bp_week_staff_read','member_medicines_staff_read','member_medicine_reasons_staff_read','nurse_visit_record','bp_staff_member_devices']);
const read={enabled:true,id:conversation,member:{id:member,name:'Example Member',birthYear:1970,sex:null},messages:[]};
function fake(data:(name:string)=>unknown){
 let holding=0,overlaps=0,calls:string[]=[];
 return {get overlaps(){return overlaps;},get calls(){return calls;},rpc:async(name:string)=>{
  calls=[...calls,name];
  const locks=LOCKING.has(name);
  if(locks&&holding){overlaps++;return {data:null,error:{code:'55P03'}};}
  if(locks)holding++;
  await new Promise(resolve=>setTimeout(resolve,2));
  if(locks)holding--;
  return {data:data(name),error:null};
 }};
}
const workspace={ok:true,conversationId:conversation,version:1,messages:[{seq:1,text:'Synthetic question',at:'2026-11-01T10:00:00Z',author:'member'}],replies:[],memberName:'Example Member',unsavedOverLimit:false,unsupportedMedia:false,clinicalRevision:0,draftEpoch:0,sourceToken:'synthetic',drafts:[],deliveries:[]};
const answers=(name:string)=>name==='staff_zoe_read'?read:name==='conversation_workspace'?workspace:name==='zoe_runs_for_doctor'?{ok:true,runs:[]}:name==='staff_zoe_status'?true:name==='staff_zoe_open'?{ok:true,conversationId:conversation}:null;

const client=fake(answers);
const now=new Date('2026-11-02T08:00:00Z');
const selection=await readWorkspaceSelection(client as never,conversation,staffRecordReader(client as never,'en',now),true);
const messages=selection.glance.find(result=>result.tool==='member_messages');
assert.ok(client.calls.includes('conversation_workspace'),'The record reads the member messages');
assert.equal(client.overlaps,0,'Locking reads never overlap');
assert.notEqual(messages?.state,'unavailable','The latest member message stays readable');

// Reads for the same record in parallel, as a model tool round does.
const tools=fake(answers),reader=staffRecordReader(tools as never,'en',now);
await Promise.all((['bp','adherence','visits','member_messages'] as const).map(tool=>reader(tool,member,'doctor')));
assert.equal(tools.overlaps,0,'A parallel tool round takes turns');
assert.ok(tools.calls.includes('zoe_runs_for_doctor'),'Zoe replies use the same locking turn as messages');

// The whole record, with decisions and BP after the glance.
const home=fake(answers);
await runDoctorHome({client:home as never,role:'doctor',locale:'en'},{kind:'select',memberId:member},{NOREON_DOCTOR_WORKSPACE:'true',NOREON_DOCTOR_CHAT_HOME:'true',NOREON_DOCTOR_DECISIONS:'true',NOREON_BP_DEVICES_ENABLED:'true'},now).catch(()=>null);
assert.equal(home.overlaps,0,'The whole record takes turns');

// Another tab can hold the lock for a moment. One retry, and a real refusal still comes back.
let tries=0;
const busy=retryOnLock({rpc:async()=>++tries===1?{data:null,error:{code:'55P03'}}:{data:'read',error:null}});
assert.equal((await busy.rpc('conversation_workspace')).data,'read');assert.equal(tries,2);
tries=0;
const refused=retryOnLock({rpc:async()=>{tries++;return {data:null,error:{code:'42501'}};}});
assert.equal((await refused.rpc('conversation_workspace')).error?.code,'42501');assert.equal(tries,1);
console.log('Doctor record reads: locking reads take turns in the glance, a tool round and the whole record; one retry on a held lock (fake RPC).');
