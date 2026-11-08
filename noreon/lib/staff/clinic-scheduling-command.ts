import 'server-only';
import {clinicSchedulingInputSchema,copySchedulingInputSchema,clinicSchedulingResultSchema,copySchedulingResultSchema,type SchedulingActionState} from './clinic-scheduling-schema';
import type {z} from 'zod';
export type SchedulingInput=z.infer<typeof copySchedulingInputSchema>&{clinicId?:string};
type Response={data:unknown;error:{code?:string}|null;status?:number};
const unknown=():SchedulingActionState=>({ok:false,feedback:'unknown',outcomeUnknown:true});

/** Internal command: public server actions authorize before invoking this IO seam. */
export async function saveSchedulingSetting(kind:'clinic'|'copy',form:FormData,deps:{write:(input:SchedulingInput)=>Promise<Response>;invalidate:()=>void}):Promise<SchedulingActionState>{
 const input=(kind==='clinic'?clinicSchedulingInputSchema:copySchedulingInputSchema).safeParse({clinicId:form.get('clinicId'),requestId:form.get('requestId'),expectedRevision:form.get('expectedRevision'),email:form.get('email')});
 if(!input.success)return {ok:false,feedback:'invalid'};
 try{
  const response=await deps.write(input.data);
  if(response.error){
   if(response.status && response.status>=500 && response.status!==500)return unknown();
   const code=response.error.code;
   if(code==='40001')return {ok:false,feedback:'stale'};
   if(code==='42501')return {ok:false,feedback:'access'};
   if(code && ['22023','22003','23505','23514'].includes(code))return {ok:false,feedback:'rejected'};
   return unknown();
  }
  const result=(kind==='clinic'?clinicSchedulingResultSchema:copySchedulingResultSchema).safeParse(response.data);
  if(!result.success || result.data.email!==input.data.email || result.data.revision!==input.data.expectedRevision+1
    || (kind==='clinic' && (!('id' in result.data) || result.data.id!==('clinicId' in input.data?input.data.clinicId:undefined))))return unknown();
  deps.invalidate();
  return {ok:true,feedback:'saved',email:result.data.email,revision:result.data.revision};
 }catch{return unknown();}
}
