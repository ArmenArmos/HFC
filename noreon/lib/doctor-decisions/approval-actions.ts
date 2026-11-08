'use server';
import {revalidatePath} from 'next/cache';
import {loggedAction} from '@/lib/observability/with-logging';
import {requireRealStaff} from '@/lib/patient-care/clinical-case-repository';
import {realClinicalCommand} from '@/lib/patient-care/clinical-review-actions';
import type {ClinicalFormState} from '@/lib/patient-care/clinical-actions';
import {multiMedicineEnabled} from '@/lib/patient-care/regimen-config';
import {doctorDecisionsEnabled} from '@/lib/staff-zoe/workspace-config';
import {clinicalCardCommandSchema,clinicalCardForm} from './approvals';

/** An explicit typed press only. The existing page action performs all clinical checks and audited writes. */
export const pressClinicalCard=loggedAction('pressClinicalCard',async function pressClinicalCard(input:unknown):Promise<ClinicalFormState>{
 if(!doctorDecisionsEnabled())return {ok:false,message:'This action is switched off.'};
 const p=clinicalCardCommandSchema.safeParse(input);
 if(!p.success)return {ok:false,message:'Check the form details.'};
 if(p.data.kind==='regimen'&&!multiMedicineEnabled())return {ok:false,message:'This action is switched off.'};
 const {identity}=await requireRealStaff();
 if(identity.role!=='doctor')return {ok:false,message:'Assigned doctor access is required.'};
 const result=await realClinicalCommand({ok:false,message:''},clinicalCardForm(p.data));
 if(result.ok)revalidatePath('/staff/real/doctor-workspace');
 return result;
});
