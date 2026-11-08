'use server';
import {loggedAction} from '@/lib/observability/with-logging';
import {revalidatePath} from 'next/cache';
import {requireRealStaff} from '@/lib/patient-care/clinical-case-repository';
import {labAiEnabled} from '@/lib/lab-ai/config';
import {runConfirmPassingLabValues,type LabRpcClient} from '@/lib/lab-ai/doctor-runtime';
import {confirmPassingInputSchema,confirmPassingVersion,type ConfirmPassingResult} from '@/lib/lab-ai/doctor-schema';

export const confirmPassingLabValues=loggedAction('confirmPassingLabValues',async function confirmPassingLabValues(input:unknown):Promise<ConfirmPassingResult>{
 const parsed=confirmPassingInputSchema.safeParse(input);if(!parsed.success)return {status:'invalid'};
 if(!labAiEnabled())return {status:'disabled'};
 const {client,identity}=await requireRealStaff();if(identity.role!=='doctor')return {status:'access'};
 const result=await runConfirmPassingLabValues(client as unknown as LabRpcClient,{...parsed.data,version:confirmPassingVersion});
 if(result.status==='saved')revalidatePath(`/staff/real/members/${parsed.data.memberId}`);
 return result;
});
