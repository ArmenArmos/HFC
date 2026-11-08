import {z} from 'zod';
/** Open clinic identity checks. The RPC audits each member and rechecks current doctor assignment. */
export const doctorUploadOverrideSchema=z.object({fileId:z.uuid(),fileName:z.string(),at:z.string(),clinicName:z.string(),mismatch:z.enum(['name','birth_date','both']),reason:z.string().nullable(),
 sheet:z.object({name:z.string().nullable().optional(),birthDate:z.string().nullable().optional()}),member:z.object({name:z.string().nullable().optional(),birthDate:z.string().nullable().optional()}),current:z.literal(true),
 noValuesRead:z.boolean().optional(),memberId:z.uuid(),memberName:z.string(),jobState:z.enum(['queued','running','done','rejected','failed']).nullable()});
export type DoctorUploadOverride=z.infer<typeof doctorUploadOverrideSchema>;
type Rpc={rpc:(...args:never[])=>unknown};
type RawRpc=(name:string,args?:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>;
/** Null is an unavailable identity gate, never permission to show unchecked values. */
export async function readDoctorUploadOverrides(client:Rpc,memberId?:string):Promise<DoctorUploadOverride[]|null>{
 try{const r=await (client.rpc as unknown as RawRpc)('doctor_mismatched_uploads',memberId?{p_member:memberId}:{});if(r.error)return null;const p=z.array(doctorUploadOverrideSchema).safeParse(r.data);return p.success?p.data:null;}catch{return null;}
}
