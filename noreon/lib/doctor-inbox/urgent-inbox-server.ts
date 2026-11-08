import 'server-only';
import {careAlertInboxSchema,type CareAlert} from '@/lib/care-alerts/contracts';
import type {MedicinesRpc} from '@/lib/member-medicines/server';
import {doctorInboxSchema,orderAlerts,type AlertItem,type DoctorInbox} from './contracts';
import {readDoctorUrgentWindows} from './urgent-windows-server';
import {log} from '@/lib/observability/logger';

const alertItem=(alert:CareAlert):AlertItem=>({kind:'care_alert',lane:'P0',id:`alert:${alert.id}`,memberId:alert.memberId,memberName:alert.memberName,
 at:alert.createdAt,rank:alert.state==='open'?0:1,confidence:'rule',ai:'none',sources:[],alert});

/** Both existing alert queries are bounded and select different rows. Keep their union so neither surface loses work.
 * Counts describe the rows shown: an unseen alert's member cannot safely be deduplicated against a window.
 */
export async function readDoctorUrgentInbox(client:MedicinesRpc,known:{inbox?:Pick<DoctorInbox,'p0'|'p0Total'|'asOf'>;liveAlerts?:CareAlert[]}={}){
 const unavailable:string[]=[];
 let inbox=known.inbox,live=known.liveAlerts;
 let liveAsOf:string|undefined;
 if(!inbox)try{
  const result=await client.rpc('doctor_ai_inbox');
  if(result.error)throw Error('Doctor alerts unavailable');
  inbox=doctorInboxSchema.parse(result.data);
 }catch{log.warn('Doctor urgent alerts could not be read');unavailable.push('care_alerts');}
 if(!live)try{
  const result=await client.rpc('care_alert_inbox',{p_view:'live',p_limit:200});
  if(result.error)throw Error('Doctor alerts unavailable');
  const parsed=careAlertInboxSchema.parse(result.data);
  live=parsed.alerts;liveAsOf=parsed.asOf;
 }catch{log.warn('Doctor urgent alerts could not be read');unavailable.push('care_alerts');}
 const byId=new Map<string,AlertItem>();
 for(const item of inbox?.p0??[])if(item.alert.state!=='resolved')byId.set(item.alert.id,item);
 // Reuse inbox metadata for overlapping alerts; list-only alerts get the same P0 shape.
 for(const alert of live??[])if(alert.state!=='resolved')byId.set(alert.id,{...(byId.get(alert.id)??alertItem(alert)),memberName:alert.memberName,rank:alert.state==='open'?0:1,alert});
 const urgent=await readDoctorUrgentWindows(client).catch(()=>null);
 if(!urgent)unavailable.push('urgent_windows');
 return {asOf:inbox?.asOf??liveAsOf??new Date().toISOString(),alerts:orderAlerts([...byId.values()]),windows:urgent?.windows??[],windowsTotal:urgent?.total??0,
  capped:!!inbox&&inbox.p0Total>inbox.p0.length||(live?.length??0)>=200||!!urgent&&urgent.total>urgent.windows.length,
  unavailable:[...new Set(unavailable)]};
}
