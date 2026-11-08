import {AI_READ_LABEL} from '@/lib/lab-ai/provenance';
import 'server-only';
import {unstable_rethrow} from 'next/navigation';
import {doctorPlanReadSchema,type DoctorPlanRead} from './contracts';

type Rpc={rpc:(name:never,args:never)=>PromiseLike<{data:unknown;error:{code?:string}|null}>};
/** The assigned doctor's view of the plan draft feature for one member. Null when unreadable: the feature stays hidden. */
export async function readDoctorAiPlan(client:unknown,memberId:string):Promise<DoctorPlanRead|null>{
 try{
  const r=await (client as Rpc).rpc('doctor_ai_plan_read' as never,{p_user_id:memberId} as never);
  if(r.error)return null;
  const parsed=doctorPlanReadSchema.safeParse(r.data);
  if(!parsed.success)return null;
  const plan=parsed.data;
  // Add the report date to the display label; stored source ids and items remain intact.
  if(plan.enabled&&plan.latest)plan.latest={...plan.latest,items:plan.latest.items.map(item=>{
   const value=item.source.kind==='lab'?plan.labValues.find(value=>value.valueId===item.source.ref):null;
   const date=value?.collectedOn;
   if(value?.status==='auto_accepted')return {...item,source:{...item.source,label:`${item.source.label} · ${AI_READ_LABEL.en}${date?` · ${date}`:''}`}};
   return date?{...item,source:{...item.source,label:`${item.source.label} · ${date}`}}:item;
  })};
  return plan;
 }catch(error){unstable_rethrow(error);return null;}
}
