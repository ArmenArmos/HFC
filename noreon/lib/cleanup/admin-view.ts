import 'server-only';
import {z} from 'zod';
const runSchema=z.object({run_id:z.uuid(),job_kind:z.literal('report-cleanup'),started_at:z.iso.datetime({offset:true}),ended_at:z.iso.datetime({offset:true}).nullable(),status:z.enum(['running','succeeded','failed']),attempted:z.number().int().nonnegative(),cleaned:z.number().int().nonnegative(),failed:z.number().int().nonnegative(),failure_category:z.enum(['database','storage','unexpected','mixed']).nullable()}).strict();
export type CleanupRun=z.infer<typeof runSchema>;
export type CleanupView={state:'ready';runs:CleanupRun[];older:boolean}|{state:'unavailable'}|{state:'invalid'};
export async function readCleanupView(query:Record<string,string|string[]|undefined>,deps:{authorize:()=>Promise<unknown>;read:(cursor:{p_before?:string;p_run_id?:string})=>Promise<{data:unknown;error:unknown}>}):Promise<CleanupView>{
 await deps.authorize();
 const older=query.before!==undefined||query.run!==undefined;
 const cursor=z.object({p_before:z.iso.datetime({offset:true}),p_run_id:z.uuid()}).safeParse({p_before:query.before,p_run_id:query.run});
 if(older&&!cursor.success)return {state:'invalid'};
 try{
  const result=await deps.read(cursor.success?cursor.data:{});
  if(result.error)return {state:'unavailable'};
  return {state:'ready',runs:z.array(runSchema).max(50).parse(result.data),older};
 }catch{return {state:'unavailable'};}
}
