import {z} from 'zod';
const rowSchema=z.object({fileId:z.uuid(),fileName:z.string(),at:z.string(),clinicName:z.string(),mismatch:z.enum(['name','birth_date','both']),reason:z.string().nullable(),
 sheet:z.object({name:z.string().nullable().optional(),birthDate:z.string().nullable().optional()}),member:z.object({name:z.string().nullable().optional(),birthDate:z.string().nullable().optional()}),current:z.boolean()});
export type UploadOverride=z.infer<typeof rowSchema>;
type Rpc={rpc:(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>};
/** Lab PDFs a clinic attached to this member after confirming the sheet differed (still attached). The
 * database checks the reader (admin, assigned doctor or nurse) and audits the read. Never throws: an
 * unavailable read shows nothing rather than breaking the member page. */
export async function readUploadOverrides(client:Rpc,memberId:string):Promise<UploadOverride[]>{
 try{const r=await client.rpc('staff_member_upload_overrides',{p_member:memberId});if(r.error)return [];const p=z.array(rowSchema).safeParse(r.data);return p.success?p.data.filter(x=>x.current):[];}catch{return [];}
}
