import assert from 'node:assert/strict';
import {saveCareTeam,type CareTeamActions} from '@/lib/staff/care-team-save';
type Call={kind:'doctor'|'nurse';fields:Record<string,string>};
function actions(doctorResult:{ok:boolean;message:string;revision?:number},nurseResult:{status:'success'|'error';message:string}){
 const calls:Call[]=[];
 const value:CareTeamActions={
  assignDoctor:async(_p,form)=>{calls.push({kind:'doctor',fields:Object.fromEntries(form) as Record<string,string>});return doctorResult;},
  assignNurse:async(_p,form)=>{calls.push({kind:'nurse',fields:Object.fromEntries(form) as Record<string,string>});return nurseResult;},
 };
 return {calls,value};
}
const base={id:'case-1',revision:4,savedDoctor:'doc-a',savedNurse:'nurse-a'};
let a=actions({ok:true,message:'',revision:5},{status:'success',message:''});
assert.deepEqual(await saveCareTeam({...base,doctor:'doc-a',nurse:'nurse-a'},a.value),{outcome:'unchanged'});assert.equal(a.calls.length,0,'No change sends nothing');
a=actions({ok:true,message:'',revision:5},{status:'success',message:''});
assert.deepEqual(await saveCareTeam({...base,doctor:'doc-b',nurse:'nurse-b'},a.value),{outcome:'saved'});
assert.deepEqual(a.calls,[{kind:'doctor',fields:{id:'case-1',revision:'4',doctor:'doc-b'}},{kind:'nurse',fields:{caseId:'case-1',revision:'5',nurseId:'nurse-b'}}],'Doctor first, nurse uses the revision the doctor save returned');
a=actions({ok:true,message:''},{status:'success',message:''});
await saveCareTeam({...base,doctor:'doc-a',nurse:''},a.value);
assert.deepEqual(a.calls,[{kind:'nurse',fields:{caseId:'case-1',revision:'4',nurseId:''}}],'Nurse-only change keeps the current revision and can clear the nurse');
a=actions({ok:false,message:'Assignment changed'},{status:'success',message:''});
assert.deepEqual(await saveCareTeam({...base,doctor:'doc-b',nurse:'nurse-b'},a.value),{outcome:'doctor-failed',message:'Assignment changed'});assert.equal(a.calls.length,1,'A refused doctor save stops before the nurse');
a=actions({ok:true,message:'',revision:5},{status:'error',message:'Choose an active nurse'});
assert.deepEqual(await saveCareTeam({...base,doctor:'doc-b',nurse:'nurse-x'},a.value),{outcome:'nurse-failed',doctorSaved:true,message:'Choose an active nurse'});
// A new doctor clears the nurse in the database, so a kept nurse is sent again with the returned revision (aB-1).
a=actions({ok:true,message:'',revision:5},{status:'success',message:''});
assert.deepEqual(await saveCareTeam({...base,doctor:'doc-b',nurse:'nurse-a'},a.value),{outcome:'saved'});
assert.deepEqual(a.calls,[{kind:'doctor',fields:{id:'case-1',revision:'4',doctor:'doc-b'}},{kind:'nurse',fields:{caseId:'case-1',revision:'5',nurseId:'nurse-a'}}],'Doctor change keeps the chosen nurse');
// The kept nurse may not fit the new doctor's clinic: that is reported, never "saved".
a=actions({ok:true,message:'',revision:5},{status:'error',message:'Choose a nurse from this clinic'});
assert.deepEqual(await saveCareTeam({...base,doctor:'doc-b',nurse:'nurse-a'},a.value),{outcome:'nurse-failed',doctorSaved:true,message:'Choose a nurse from this clinic'});
// A doctor change with no nurse chosen sends only the doctor.
a=actions({ok:true,message:'',revision:5},{status:'success',message:''});
await saveCareTeam({...base,savedNurse:'',doctor:'doc-b',nurse:''},a.value);
assert.deepEqual(a.calls.map(c=>c.kind),['doctor'],'No nurse to keep');
// Unassigning the doctor also clears the nurse (no nurse without a doctor), so no nurse is sent.
a=actions({ok:true,message:'',revision:5},{status:'success',message:''});
await saveCareTeam({...base,doctor:'',nurse:'nurse-a'},a.value);
assert.deepEqual(a.calls,[{kind:'doctor',fields:{id:'case-1',revision:'4',doctor:''}}],'Unassigning the doctor sends only the doctor');
console.log('Care team save: unchanged sends nothing; doctor before nurse with the returned revision; failures stop or report the partial save.');
