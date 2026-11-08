'use server';
import {revalidatePath} from 'next/cache';
import {loggedAction} from '@/lib/observability/with-logging';
import {requireRealStaff} from '@/lib/patient-care/clinical-case-repository';
import {doctorDecisionsEnabled} from '@/lib/staff-zoe/workspace-config';
import {careAlertsEnabled} from '@/lib/care-alerts/contracts';
import {itemDecisionSchema,runItemDecision,type DecisionRpc,type ItemResult} from './items';

/** No text-to-command path: this endpoint accepts only an explicit card press with the displayed revision. */
export const pressDoctorItem=loggedAction('pressDoctorItem',async function pressDoctorItem(input:unknown):Promise<ItemResult>{
 const p=itemDecisionSchema.safeParse(input);if(!p.success)return {status:'invalid'};
 if(!doctorDecisionsEnabled()||(p.data.kind==='alert'&&!careAlertsEnabled()))return {status:'disabled'};
 const {client,identity}=await requireRealStaff();
 if(identity.role!=='doctor')return {status:'access'};
 const result=await runItemDecision(client as unknown as DecisionRpc,p.data);
 if(result.status==='saved'){
  revalidatePath('/staff/real/today');revalidatePath('/staff/real/alerts');
 }
 return result;
});
