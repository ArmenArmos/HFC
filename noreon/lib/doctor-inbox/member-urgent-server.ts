import 'server-only';
import {careAlertInboxSchema} from '@/lib/care-alerts/contracts';
import type {MedicinesRpc} from '@/lib/member-medicines/server';
import {memberUrgent,type MemberUrgent} from './member-urgent';
import {readDoctorUrgentWindows} from './urgent-windows-server';
import {log} from '@/lib/observability/logger';

/** Both reads are scoped and audited by the database. A failed or capped read is reported as incomplete, never as nothing urgent. */
export async function readMemberUrgent(client:MedicinesRpc,memberId:string):Promise<MemberUrgent>{
 const [alerts,windows]=await Promise.allSettled([
  client.rpc('care_alert_inbox',{p_view:'live',p_limit:200}).then(result=>{
   const parsed=careAlertInboxSchema.safeParse(result.data);
   if(result.error||!parsed.success)throw Error('Doctor alerts unavailable');
   return parsed.data.alerts;
  }),
  readDoctorUrgentWindows(client),
 ]);
 const list=alerts.status==='fulfilled'?alerts.value:[],open=windows.status==='fulfilled'?windows.value:null;
 if(alerts.status==='rejected')log.warn('Member urgent alerts could not be read');
 return {...memberUrgent(list,open?.windows??[],memberId),incomplete:alerts.status==='rejected'||!open||list.length>=200||open.total>open.windows.length};
}
