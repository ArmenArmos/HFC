'use server';
import type {ClinicRpc} from '@/lib/clinic-portal/runtime';
import {revalidatePath} from 'next/cache';
import {loggedAction} from '@/lib/observability/with-logging';
import {requireClinicPortal} from '@/lib/clinic-portal/identity';
import {requireRealAdmin} from '@/lib/staff/real-admin';
import {decideChangeRequest} from './approvals';
import type {DecisionOutcome} from './approvals-schema';
function refreshApprovals(){
 revalidatePath('/clinic/real/approvals');revalidatePath('/clinic/real/records','layout');revalidatePath('/staff/real/clinics/approvals');
}
export const clinicChangeDecide=loggedAction('clinicChangeDecide',async function clinicChangeDecide(clinicId:string,expectedScope:string,input:unknown):Promise<DecisionOutcome>{
 const context=await requireClinicPortal(clinicId);
 if(context.identity.capability!=='clinic_admin'||context.actorScope!==expectedScope)return'refused';
 const outcome=await decideChangeRequest(context.rpc,clinicId,input);refreshApprovals();return outcome;
});
export const staffClinicChangeDecide=loggedAction('staffClinicChangeDecide',async function staffClinicChangeDecide(expectedScope:string,input:unknown):Promise<DecisionOutcome>{
 const context=await requireRealAdmin();if(context.actorScope!==expectedScope)return'refused';
 const outcome=await decideChangeRequest(context.client as unknown as ClinicRpc,null,input);refreshApprovals();return outcome;
});
