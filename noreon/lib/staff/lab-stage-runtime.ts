import 'server-only';
import{labStageCommandSchema,labStageResultSchema,staffLabReadSchema,type LabStageResult,type StaffLabRead}from'./lab-stage-schema';
import type{VisitRpc}from'./visit-evidence-runtime';
type Context={memberId:string;client:VisitRpc};
const invalid=():LabStageResult=>({status:'invalid',issues:[{path:'',message:'Check the lab stage details.'}]});

/** Uses only the authenticated scoped client; the database enforces assignment. */
export async function readLabStages(context:Context):Promise<StaffLabRead>{
 const response=await context.client.rpc('patient_staff_lab_stages',{p_member:context.memberId});
 if(response.error)throw Object.assign(Error('Lab stages are unavailable.'),{code:response.error.code});
 const parsed=staffLabReadSchema.safeParse(response.data);
 if(!parsed.success||parsed.data.memberId!==context.memberId)throw Error('Lab stages are unavailable.');
 return parsed.data;
}

/** A resend of the same command is safe: the database replays a stored stage
 * and never records a second one, so an unknown outcome can be checked by retrying. */
export async function saveLabStage(context:Context,raw:unknown):Promise<LabStageResult>{
 const parsed=labStageCommandSchema.safeParse(raw);if(!parsed.success)return invalid();
 const command=parsed.data;if(command.id!==context.memberId)return{status:'access'};
 try{
  const response=await context.client.rpc('patient_staff_lab_stage_command',{p_command:command});
  if(response.error){
   if(response.error.code==='42501')return{status:'access'};
   if(response.error.code==='55P03')return{status:'unavailable'};
   return{status:'outcome-unknown'};
  }
  const result=labStageResultSchema.safeParse(response.data);if(!result.success)return{status:'outcome-unknown'};
  if(result.data.status==='saved'&&result.data.submissionId!==command.submissionId)return{status:'outcome-unknown'};
  return result.data;
 }catch{return{status:'outcome-unknown'};}
}
