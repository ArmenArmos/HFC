/** Saves a member's doctor and nurse as the two existing admin-checked actions.
 * The doctor goes first; the nurse then uses the revision that save returned, so
 * the nurse check runs against the newly chosen doctor's clinic. A doctor change clears the nurse in the
 * database (trigger clear_patient_nurse), so a kept nurse is sent again after a new doctor is saved; with no
 * doctor there is no nurse (quality review 18 Oct, aB-1). */
export type CareTeamSaveInput={id:string;revision:number;doctor:string;nurse:string;savedDoctor:string;savedNurse:string};
export type CareTeamActions={
 assignDoctor:(previous:{ok:boolean;message:string},form:FormData)=>Promise<{ok:boolean;message:string;revision?:number}>;
 assignNurse:(previous:{status:'idle'|'success'|'error';message:string},form:FormData)=>Promise<{status:'idle'|'success'|'error';message:string}>;
};
export type CareTeamSaveResult={outcome:'unchanged'|'saved'}|{outcome:'doctor-failed';message:string}|{outcome:'nurse-failed';doctorSaved:boolean;message:string};
export async function saveCareTeam(input:CareTeamSaveInput,actions:CareTeamActions):Promise<CareTeamSaveResult>{
 const doctorChanged=input.doctor!==input.savedDoctor,nurseChanged=input.nurse!==input.savedNurse;
 if(!doctorChanged&&!nurseChanged)return {outcome:'unchanged'};
 let revision=input.revision;
 if(doctorChanged){
  const form=new FormData();form.set('id',input.id);form.set('revision',String(revision));form.set('doctor',input.doctor);
  const result=await actions.assignDoctor({ok:false,message:''},form);
  if(!result.ok)return {outcome:'doctor-failed',message:result.message};
  revision=result.revision??revision;
 }
 if(nurseChanged||(doctorChanged&&input.doctor!==''&&input.nurse!=='')){
  const form=new FormData();form.set('caseId',input.id);form.set('revision',String(revision));form.set('nurseId',input.nurse);
  const result=await actions.assignNurse({status:'idle',message:''},form);
  if(result.status!=='success')return {outcome:'nurse-failed',doctorSaved:doctorChanged,message:result.message};
 }
 return {outcome:'saved'};
}
