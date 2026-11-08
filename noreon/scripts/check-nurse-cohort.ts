// "Who has not logged BP this week" for the nurse (lib/nurse-chat/cohort-read.ts): own assigned members only, any reading source
// counts, a failed read is unknown, never "has not logged", and nothing runs while the device feature is off.
import assert from 'node:assert/strict';
import {runNurseMissingBp} from '@/lib/nurse-chat/cohort-read';

const id=(n:number)=>`c0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const row=(n:number)=>({id:id(n),name:`Member ${n}`,birthDate:'1980-01-01',birthYear:1980,phoneLast4:null,shortId:null,revision:0,doctorId:null,nurseId:null,createdAt:'2026-01-01T00:00:00Z',bookingCounts:{requested:0,providerProposed:0,confirmed:0,changePending:0}});
const reading=(at:string,source='manual')=>({id:'d0000000-0000-4000-8000-000000000001',systolic:130,diastolic:80,pulse:null,measuredAt:at,source,serial:null});
const now=new Date('2026-11-04T10:00:00Z'); // Wednesday; the week starts Monday 2 Nov
const devices=(n:number,readings:unknown)=>({version:'bp-device-v1',memberId:id(n),current:null,history:[],available:[],readings});

function client(opts:{rows:number[];hasMore?:boolean;readings:Record<number,unknown|'throw'>;searchError?:boolean}){
 const calls:string[]=[];
 return {calls,rpc:async(name:string,args?:Record<string,unknown>)=>{
  calls.push(name);
  if(name==='patient_clinical_case_search_identity')return opts.searchError?{data:null,error:{message:'x'}}:{data:{rows:opts.rows.map(row),hasMore:opts.hasMore??false,nextCursor:opts.hasMore?{createdAt:'2026-01-01T00:00:00Z',id:id(1)}:null},error:null};
  if(name==='bp_staff_member_devices'){
   const n=Number(String(args!.p_member).slice(-12));const value=opts.readings[n];
   if(value==='throw')throw new Error('read failed');
   return {data:devices(n,value),error:null};
  }
  throw new Error('Unexpected rpc '+name);
 }};
}
const on={NOREON_BP_DEVICES_ENABLED:'true'};

const off=client({rows:[1],readings:{1:[]}});
assert.deepEqual(await runNurseMissingBp(off,{},now),{kind:'unavailable'},'Off while the device feature is off');assert.deepEqual(off.calls,[],'and nothing is read');

const c=client({rows:[1,2,3,4,5,6],readings:{
 1:[reading('2026-11-03T08:00:00Z')],            // this week, manual: logged
 2:[reading('2026-10-30T08:00:00Z')],            // last week: missing
 3:[],                                           // never: missing
 4:null,                                         // unreadable record: unknown
 5:'throw',                                      // failed read: unknown
 6:[reading('2026-11-04T09:00:00Z','device'),reading('2026-10-01T08:00:00Z')], // device reading this week: logged
}});
const result=await runNurseMissingBp(c,on,now);
assert.equal(result.kind,'missing-bp');
if(result.kind==='missing-bp'){
 assert.deepEqual(result.rows.map(r=>r.id),[id(2),id(3)],'Only members with no reading this week');
 assert.equal(result.unknown,2,'A failed or unreadable read is unknown, never "has not logged"');
 assert.equal(result.from,'2026-11-02');assert.equal(result.to,'2026-11-04');assert.equal(result.checked,6);assert.equal(result.truncated,false);
}
assert.equal(c.calls.filter(name=>name==='patient_clinical_case_search_identity').length,1,'One search, the nurse\'s own assigned list');
const future=await runNurseMissingBp(client({rows:[1],readings:{1:[reading('2026-11-05T08:00:00Z')]}}),on,now);
assert.deepEqual(future.kind==='missing-bp'?future.rows.map(r=>r.id):null,[id(1)],'A reading dated after now is not a reading');
const more=await runNurseMissingBp(client({rows:[1],hasMore:true,readings:{1:[]}}),on,now);
assert.equal(more.kind==='missing-bp'&&more.truncated,true,'More members than one page is said');
assert.deepEqual(await runNurseMissingBp(client({rows:[],readings:{},searchError:true}),on,now),{kind:'unavailable'},'A failed search is unavailable');
const sunday=await runNurseMissingBp(client({rows:[1],readings:{1:[reading('2026-11-02T00:30:00Z')]}}),on,new Date('2026-11-08T10:00:00Z'));
assert.deepEqual(sunday.kind==='missing-bp'?[sunday.from,sunday.rows.length]:null,['2026-11-02',0],'On Sunday the week still began Monday');
console.log('Nurse missing-BP cohort: own members, any source counts, failed reads are unknown, off while the device feature is off.');
