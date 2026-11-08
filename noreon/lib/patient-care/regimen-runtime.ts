import 'server-only';
import {doctorRegimenReviewSchema,memberRegimensSchema,type DoctorRegimenReview,type RegimenVersion} from './regimen';
type Rpc={rpc(name:string,args?:Record<string,unknown>):PromiseLike<{data:unknown;error:unknown}>};
/** The member's own versions, or null when the feature is off or the read failed: only the "what changed" lines depend on it. */
export async function readMemberRegimens(client:Rpc):Promise<RegimenVersion[]|null>{
 const {data,error}=await client.rpc('patient_care_plan_regimens');
 if(error)return null;
 const read=memberRegimensSchema.safeParse(data);
 return read.success&&read.data.enabled?read.data.versions:null;
}
/** The assigned doctor's regimen review. Null means it could not be read, and publishing a regimen stays closed. */
export async function readDoctorRegimenReview(client:Rpc,memberId:string):Promise<DoctorRegimenReview|null>{
 const {data,error}=await client.rpc('doctor_regimen_review',{p_user_id:memberId});
 if(error)return null;
 const read=doctorRegimenReviewSchema.safeParse(data);
 return read.success?read.data:null;
}
