import {z} from 'zod';
import {careAlertSchema} from '@/lib/care-alerts/contracts';
import {ldlResponseFactsSchema} from '@/lib/ldl/response-schema';
import {medicineAskSchema} from '@/lib/member-medicines/asks';

export type DecisionRpc={rpc:(name:string,args?:Record<string,unknown>)=>PromiseLike<{data:unknown;error:{code?:string}|null}>};
const base={id:z.uuid(),memberId:z.uuid(),revision:z.string().regex(/^[a-f0-9]{32}$/),at:z.string()};
export const itemCardSchema=z.discriminatedUnion('kind',[
 z.object({...base,kind:z.literal('alert'),data:careAlertSchema}),
 z.object({...base,kind:z.literal('ldl'),data:z.object({status:z.enum(['at_goal','above_goal','not_assessable']),facts:ldlResponseFactsSchema})}),
 z.object({...base,kind:z.literal('medicine'),data:z.object({kind:z.enum(['side_effect','decided_to_stop','refill']),ask:medicineAskSchema})}),
]);
export type ItemCard=z.infer<typeof itemCardSchema>;
export const itemDecisionSchema=z.strictObject({kind:z.enum(['alert','ldl','medicine']),id:z.uuid(),memberId:z.uuid(),revision:z.string().regex(/^[a-f0-9]{32}$/),note:z.string().trim().max(500).default('')});
const resultSchema=z.object({status:z.enum(['saved','stale','access','disabled','invalid','unavailable','outcome-unknown'])});
export type ItemResult=z.infer<typeof resultSchema>;

/** Used by workspace cards. Permission, revision and audit are one DB transaction. */
export async function runItemDecision(client:DecisionRpc,input:unknown):Promise<ItemResult>{
 const p=itemDecisionSchema.safeParse(input);if(!p.success)return {status:'invalid'};
 try{
  const v=p.data;
  const r=await client.rpc('doctor_decision_apply',{p_kind:v.kind,p_id:v.id,p_member:v.memberId,p_revision:v.revision,p_note:v.note});
  if(r.error)return {status:r.error.code==='42501'?'access':'outcome-unknown'};
  const result=resultSchema.safeParse(r.data);
  return result.success?result.data:{status:'outcome-unknown'};
 }catch{return {status:'outcome-unknown'};}
}
export async function readItemCards(client:DecisionRpc,memberId:string):Promise<ItemCard[]|null>{
 try{
  const r=await client.rpc('doctor_decision_items',{p_member:memberId});
  const p=z.object({items:z.array(itemCardSchema)}).safeParse(r.data);
  return !r.error&&p.success?p.data.items:null;
 }catch{return null;}
}
