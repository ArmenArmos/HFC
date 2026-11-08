import 'server-only';
import {z} from 'zod';

type Query=Record<string,string|string[]|undefined>;
const cursor=z.object({startedAt:z.iso.datetime({offset:true}),attemptId:z.uuid()});
const reason=z.enum(['submission-unknown','submission-pending','submission-rejected','delivery-conflict','delivery-failed','reconciliation-failed','no-delivery-receipt','delivery-overdue']);
const statusSchema=z.object({
 control:z.object({revision:z.number().int().nonnegative(),budget_day:z.iso.date(),started_count:z.number().int().nonnegative(),daily_limit:z.number().int().positive(),paused_reason:z.enum(['provider-rejected','provider-unknown','stale-submission']).nullable(),paused_at:z.iso.datetime({offset:true}).nullable()}),
 attention:z.array(z.object({attempt_id:z.uuid(),started_at:z.iso.datetime({offset:true}),submission_status:z.enum(['submitting','accepted','failed','unknown']),reason,reconcile_failures:z.number().int().nonnegative()})).max(50),
 nextCursor:cursor.nullable(),
});
const spendSchema=z.object({policy:z.object({enabled:z.boolean(),currency:z.string().regex(/^[A-Z]{3}$/).nullable(),daily_limit_micros:z.number().int().nonnegative(),valid_until:z.iso.datetime({offset:true}).nullable()}),budgetDay:z.iso.date(),reservedMicros:z.number().int().nonnegative(),remainingMicros:z.number().int().nonnegative()});
export function messageViewCursor(query:Query){
 const parsed=cursor.safeParse({startedAt:query.before,attemptId:query.attempt});
 return parsed.success?parsed.data:null;
}
export type AdminMessageReadiness={operations:boolean;delivery:boolean;recovery:boolean;callbacks:boolean;sms:boolean;whatsapp:boolean};
export type AdminMessageView={readiness:AdminMessageReadiness}&({state:'ready';observedAt:number;status:z.infer<typeof statusSchema>;spending:z.infer<typeof spendSchema>}|{state:'disabled'|'unavailable'|'invalid'});
export type AdminMessageDependencies={authorize:()=>Promise<unknown>;open:()=>unknown;operation:(args:string[],db:unknown)=>Promise<unknown>};
/** Authorization precedes every configuration lookup and privileged client creation. */
export async function readAdminMessageView(query:Query,deps:AdminMessageDependencies,env:Record<string,string|undefined>=process.env):Promise<AdminMessageView>{
 await deps.authorize();
 const readiness={operations:env.NOREON_MESSAGE_OPERATIONS_ENABLED==='true',delivery:env.NOREON_MESSAGE_DELIVERY_ENABLED==='true',recovery:env.NOREON_MESSAGE_RECOVERY_READY==='true',callbacks:env.NOREON_TWILIO_CALLBACKS_ENABLED==='true',sms:env.NOREON_TWILIO_SMS_READY==='true',whatsapp:env.NOREON_TWILIO_WHATSAPP_READY==='true'};
 if(!readiness.operations)return {state:'disabled',readiness};
 const supplied=query.before!==undefined||query.attempt!==undefined;
 const after=messageViewCursor(query);
 if(supplied&&!after)return {state:'invalid',readiness};
 try{
  const db=deps.open();
  const [status,spending]=await Promise.all([deps.operation(after?['status',after.startedAt,after.attemptId]:['status'],db),deps.operation(['spend-status'],db)]);
  return {state:'ready',observedAt:Date.now(),readiness,status:statusSchema.parse(status),spending:spendSchema.parse(spending)};
 }catch{return {state:'unavailable',readiness};}
}
