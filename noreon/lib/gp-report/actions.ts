'use server';
import {loggedAction} from '@/lib/observability/with-logging';
import {revalidatePath} from 'next/cache';
import {requireRealStaff} from '@/lib/patient-care/clinical-case-repository';
import {approveGpReport,saveResultEntryRpc,type ApproveResult,type GpRpc} from './runtime';
import {resultsReportEnabled} from './config';
import type {ResultEntryField,SaveResultEntryResult} from './result-entry';

/** The assigned doctor approves the report shown; nothing is sent anywhere. */
export const approveMemberGpReport=loggedAction("approveMemberGpReport",async function approveMemberGpReport(memberId:string,shownToken:string,submissionId:string,shownResultsAssessment:boolean=false):Promise<ApproveResult>{
 const {client,identity}=await requireRealStaff();
 if(identity.role!=='doctor')return{status:'access'};
 const result=await approveGpReport(client as unknown as GpRpc,memberId,shownToken,submissionId,shownResultsAssessment);
 if(result.status==='approved')revalidatePath(`/staff/real/members/${memberId}`);
 return result;
});

export const saveResultEntry=loggedAction('saveResultEntry',async function saveResultEntry(memberId:string,field:ResultEntryField,value:number|'yes'|'no'|null,observedOn:string,submissionId:string):Promise<SaveResultEntryResult>{
 if(!resultsReportEnabled())return {status:'off'};
 const {client,identity}=await requireRealStaff();
 if(identity.role!=='doctor')return {status:'access'};
 const result=await saveResultEntryRpc(client as unknown as GpRpc,{memberId,field,value,observedOn,submissionId});
 if(result.status==='saved')revalidatePath(`/staff/real/members/${memberId}`);
 return result;
});
