// WP-11 items 13 and 46: refused reservations are shown as what they are; the longer lab-link member list.
import assert from 'node:assert/strict';
import {clinicCommandResultSchema} from '@/lib/clinic-portal/schema';
import {reservationRefusal} from '@/lib/clinic-portal/upload-outcome';
import {readClinicLabResults} from '@/lib/clinic-portal/lab-results-runtime';
const id='c1d00000-0000-4000-8000-000000000001',other='c1d00000-0000-4000-8000-000000000002';
// Item 13: the duplicate answer parses and names the stored file; every refusal is known, never "unknown".
const dup=clinicCommandResultSchema.parse({status:'rejected',submissionId:id,reason:'duplicate',fileId:other,noWrite:true});
assert.equal(reservationRefusal(dup),'duplicate');
assert.equal(clinicCommandResultSchema.safeParse({status:'rejected',submissionId:id,reason:'duplicate',noWrite:true}).success,false,'A duplicate must name the stored file');
assert.equal(clinicCommandResultSchema.safeParse({status:'rejected',submissionId:id,reason:'batch_full',fileId:other,noWrite:true}).success,false,'Only a duplicate carries a file id');
for(const reason of ['batch_full','unavailable','invalid'] as const)assert.equal(reservationRefusal({status:'rejected',submissionId:id,reason,noWrite:true}),reason);
assert.equal(reservationRefusal({status:'rejected',submissionId:id,reason:'conflict',noWrite:true}),'stale','A conflict saved nothing: send again with new identities');
assert.equal(reservationRefusal({status:'stale'}),'stale');
assert.equal(reservationRefusal({status:'access'}),'access');
assert.equal(reservationRefusal({status:'invalid'}),'invalid');
assert.equal(reservationRefusal({status:'unknown'}),null,'Only an unreadable answer is unknown');
// Item 46: the 1000-member list replaces the 300 one; without it (before the migration) the old list stays.
const member=(n:number)=>({memberId:`c1d00000-0000-4000-8000-${String(n).padStart(12,'0')}`,name:`Fictional ${n}`,birthDate:null,bookingAt:'2026-10-01T09:00:00+04:00'});
const results={version:'clinic-lab-results-v1',enabled:true,reading:false,files:[],members:Array.from({length:300},(_,i)=>member(i+1))};
const rpc=(members:unknown)=>({rpc:async(name:string)=>name==='clinic_portal_lab_results'?{data:results,error:null}:members instanceof Error?{data:null,error:{code:'PGRST202'}}:{data:members,error:null}});
const longer=await readClinicLabResults(rpc({version:'clinic-lab-members-v1',enabled:true,capped:true,members:Array.from({length:1000},(_,i)=>member(i+1))}) as never,id,other);
assert.ok(longer.status==='loaded'&&longer.data.members.length===1000&&longer.data.membersCapped===true,'Longer list with the capped flag');
const absent=await readClinicLabResults(rpc(new Error('absent')) as never,id,other);
assert.ok(absent.status==='loaded'&&absent.data.members.length===300&&absent.data.membersCapped===undefined,'Missing function: the released list stays');
const off=await readClinicLabResults(rpc({version:'clinic-lab-members-v1',enabled:false,capped:false,members:[]}) as never,id,other);
assert.ok(off.status==='loaded'&&off.data.members.length===300,'Switched-off answer never empties the released list');
console.log('Clinic upload refusals and lab-link member list: ok');
