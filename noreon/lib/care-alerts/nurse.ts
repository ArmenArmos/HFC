import {z} from 'zod';
import {careAlertSchema,careAlertsEnabled} from './contracts';
import {orderAlerts} from '@/lib/doctor-inbox/contracts';
import {log} from '@/lib/observability/logger';

/** One scoped reader for every nurse queue; the database supplies ownership and action history. */
export const nurseAlertSchema=careAlertSchema;
export type NurseAlert=z.infer<typeof nurseAlertSchema>;
export const nurseAlertInboxSchema=z.object({ok:z.literal(true),asOf:z.string(),total:z.number().int().nonnegative(),alerts:z.array(nurseAlertSchema)});

/** "unavailable" is a failed read and is never shown as "no alerts"; "off" means the alerts switch is off. */
export type NurseAlertRead={kind:'ready';alerts:NurseAlert[];total:number}|{kind:'off'}|{kind:'unavailable'};

export async function readNurseAlerts(client:{rpc:unknown},env:Record<string,string|undefined>=process.env):Promise<NurseAlertRead>{
 if(!careAlertsEnabled(env))return {kind:'off'};
 const unavailable=():NurseAlertRead=>{log.warn('Nurse urgent alerts could not be read');return {kind:'unavailable'};};
 try{
  const result=await (client as {rpc:(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>}).rpc('care_alert_nurse_inbox',{p_limit:50});
  if(result.error)return unavailable();
  const parsed=nurseAlertInboxSchema.safeParse(result.data);
  if(!parsed.success||parsed.data.alerts.some(a=>a.ownerName===undefined||a.ownerRole===undefined))return unavailable();
  // The doctor chat's order, one function for both roles; the database already pages in this order.
  const alerts=orderAlerts(parsed.data.alerts.map(alert=>({lane:'P0' as const,rank:alert.state==='open'?0:1,id:alert.id,alert}))).map(item=>item.alert);
  return {kind:'ready',alerts,total:parsed.data.total};
 }catch{return unavailable();}
}
