import 'server-only';
import {z} from 'zod';
import {labAiEnabled} from './config';
import {staffLabResultsSchema,type StaffLabResults} from './staff-results';

type Rpc={rpc:(name:string,args?:Record<string,unknown>)=>PromiseLike<{data:unknown;error:{code?:string}|null}>};
/** Assigned active doctor or active admin; the database refuses anyone else and records the read.
 * Undefined while the app switch is off (nothing shown); null means unreadable. */
export async function readStaffLabResults(client:unknown,memberId:string):Promise<StaffLabResults|null|undefined>{
 if(!labAiEnabled())return undefined;
 if(!z.uuid().safeParse(memberId).success)return null;
 try{
  const r=await (client as Rpc).rpc('staff_lab_ai_results',{p_user_id:memberId});
  if(r.error)return null;
  const p=staffLabResultsSchema.safeParse(r.data);
  return p.success?p.data:null;
 }catch{return null;}
}
