'use server';
import {loggedAction} from '@/lib/observability/with-logging';
import {revalidatePath} from 'next/cache';
import {requireRealStaff} from '@/lib/patient-care/clinical-case-repository';
import {doctorCompletionEnabled} from './config';
import {runDocumentCommand,type DocumentRpc} from './document-runtime';
import type {DocumentResult} from './document-schema';

export const recordMemberDocumentRelease=loggedAction("recordMemberDocumentRelease",async function recordMemberDocumentRelease(memberId:string,input:unknown):Promise<DocumentResult>{
 if(!doctorCompletionEnabled())return{status:'disabled'};
 const {client,identity}=await requireRealStaff();
 if(identity.role!=='doctor')return{status:'access'};
 const result=await runDocumentCommand(client as unknown as DocumentRpc,memberId,input);
 if(result.status==='released'||result.status==='withdrawn')for(const path of[`/staff/real/members/${memberId}`,'/patient/results'])revalidatePath(path);
 return result;
});
