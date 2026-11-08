// The nurse's adherence facts (lib/nurse-chat/adherence-read.ts): own members only, taken, skipped and no report kept apart, a failed read is
// unknown, no score and no ranking.
import assert from 'node:assert/strict';
import {runNurseAdherence} from '@/lib/nurse-chat/adherence-read';

const id=(n:number)=>`c0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const row=(n:number)=>({id:id(n),name:`Member ${n}`,birthDate:'1980-01-01',birthYear:1980,phoneLast4:null,shortId:null,revision:0,doctorId:null,nurseId:null,createdAt:'2026-01-01T00:00:00Z',bookingCounts:{requested:0,providerProposed:0,confirmed:0,changePending:0}});
const now=new Date('2026-11-04T10:00:00Z'); // Wednesday 14:00 Yerevan; the 7 days are 29 Oct to 4 Nov
const day=(d:string,time:string)=>`${d}T${time}:00+04:00`;
const med=(over:Record<string,unknown>)=>({id:'d1000000-0000-4000-8000-000000000001',source:'plan',name:'Atorvastatin',dose:'20 mg',times:['08:00'],startedOn:'2026-10-01',endDate:null,effectiveAt:null,doses:[],...over});
const own=(over:Record<string,unknown>)=>({id:'d2000000-0000-4000-8000-000000000001',source:'self-reported',name:'Vitamin D',dose:null,times:['08:00'],startedOn:'2026-10-01',createdAt:'2026-10-01T00:00:00Z',stoppedAt:null,doses:[],...over});
function client(opts:{rows:number[];hasMore?:boolean;meds:Record<number,unknown|'throw'>;searchError?:boolean}){
 const calls:string[]=[];
 return {calls,rpc:async(name:string,args?:Record<string,unknown>)=>{
  calls.push(name);
  if(name==='patient_clinical_case_search_identity')return opts.searchError?{data:null,error:{message:'x'}}:{data:{rows:opts.rows.map(row),hasMore:opts.hasMore??false,nextCursor:opts.hasMore?{createdAt:'2026-01-01T00:00:00Z',id:id(1)}:null},error:null};
  if(name==='member_medicines_staff_read'){
   const n=Number(String(args!.p_member).slice(-12));const value=opts.meds[n];
   if(value==='throw')throw new Error('read failed');
   return {data:value,error:null};
  }
  throw new Error('Unexpected rpc '+name);
 }};
}
const read=(plan:unknown[],self:unknown[]=[],enabled=true)=>enabled?{version:'member-medicines-v1',enabled:true,today:'2026-11-04',days:7,now:now.toISOString(),self,plan}:{version:'member-medicines-v1',enabled:false};
// 29 Oct .. 4 Nov at 08:00: expected 7 doses (the 4 Nov 08:00 dose is due before 14:00).
const dose=(d:string,status:string)=>({dueAt:day(d,'08:00'),status,recordedAt:day(d,'09:00')});

const c=client({rows:[1,2,3,4,5],meds:{
 1:read([med({doses:[dose('2026-11-04','taken'),dose('2026-11-03','taken'),dose('2026-11-02','skipped'),dose('2026-11-01','taken')]})]),
 2:read([],[own({})]),   // self-reported, nothing logged: all no report
 3:read([]),                                                  // nothing expected: not listed
 4:'throw',                                                   // failed read: unknown
 5:read([],[],false),                                         // disabled: unknown
}});
const result=await runNurseAdherence(c,now);
assert.equal(result.kind,'adherence');
if(result.kind==='adherence'){
 assert.deepEqual([result.from,result.to,result.days],['2026-10-29','2026-11-04',7]);
 assert.deepEqual(result.rows.map(r=>r.member.id),[id(1),id(2)],'Only members with doses expected, in the list order, not ranked');
 const a=result.rows[0]!.medicines[0]!;assert.deepEqual([a.name,a.source,a.expected,a.taken,a.skipped,a.noReport],['Atorvastatin','plan',7,3,1,3],'Taken, skipped and no report are kept apart');
 const b=result.rows[1]!.medicines[0]!;assert.deepEqual([b.name,b.dose,b.source,b.taken,b.skipped,b.noReport],['Vitamin D',null,'self',0,0,7],'Silence is "no report", never "skipped"');
 assert.equal(result.unknown,2,'A failed or disabled read is unknown');assert.equal(result.checked,5);assert.equal(result.truncated,false);
}
assert.equal(c.calls.filter(n=>n==='patient_clinical_case_search_identity').length,1,'One search: the nurse\'s own assigned list');
// A stopped self-reported medicine is not counted; a plan medicine ended before the window is not expected.
const stopped=await runNurseAdherence(client({rows:[1],meds:{1:read([med({endDate:'2026-10-20'})],[own({stoppedAt:'2026-10-25T00:00:00Z'})])}}),now);
assert.deepEqual(stopped.kind==='adherence'?stopped.rows.length:null,0,'Stopped and ended medicines expect nothing');
assert.equal((await runNurseAdherence(client({rows:[1],hasMore:true,meds:{1:read([])}}),now) as {truncated:boolean}).truncated,true,'More than one page is said');
assert.deepEqual(await runNurseAdherence(client({rows:[],meds:{},searchError:true}),now),{kind:'unavailable'});
console.log('Nurse adherence facts: own members, taken/skipped/no report apart, unknown reads said, no score or ranking.');
