import {z} from 'zod';
import {clinicLabValueSchema} from './clinical-review-schema';
/** QA 174: the doctor's current clinic lab results with the values a doctor confirmed, as a receipt holds them. */
export const clinicLabSourcesSchema=z.object({version:z.literal('clinic-lab-receipt-sources-v1'),attachments:z.array(z.object({
 attachmentId:z.uuid(),fileId:z.uuid(),fileName:z.string(),clinic:z.string(),attachedAt:z.string(),values:z.array(clinicLabValueSchema).min(1)}))});
export type ClinicLabSource=z.infer<typeof clinicLabSourcesSchema>['attachments'][number];
type Rpc={rpc:(name:string,args?:Record<string,unknown>)=>PromiseLike<{data:unknown;error:{code?:string}|null}>};
/** Null means unreadable, never "no clinic results". The database enforces the assigned doctor. */
export async function readClinicLabSources(client:Rpc,memberId:string):Promise<ClinicLabSource[]|null>{
 if(!z.uuid().safeParse(memberId).success)return null;
 try{const r=await client.rpc('doctor_clinic_lab_receipt_sources',{p_user_id:memberId});if(r.error)return null;const p=clinicLabSourcesSchema.safeParse(r.data);return p.success?p.data.attachments:null;}catch{return null;}
}
