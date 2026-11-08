'use server';
import {loggedAction} from '@/lib/observability/with-logging';
import{revalidatePath}from'next/cache';
import{requireRealStaff}from'@/lib/patient-care/clinical-case-repository';
import{pilotCatalogEnabled,pilotPaymentsEnabled}from'./config';
import{readAdminPayments,sendPilotCommand,type PilotRpc}from'./runtime';
import{configuredProvider}from'./provider';
import type{PilotResult}from'./schema';

async function admin(){
 const{client,identity}=await requireRealStaff();
 return identity.role==='admin'?client as unknown as PilotRpc:null;
}
const catalogActions=new Set(['create-test','update-test','set-price']);

export const recordPilotCommand=loggedAction("recordPilotCommand",async function recordPilotCommand(input:unknown):Promise<PilotResult>{
 const action=(input as{action?:unknown}|null)?.action;
 const catalog=typeof action==='string'&&catalogActions.has(action);
 if(catalog?!pilotCatalogEnabled():!pilotPaymentsEnabled())return{status:'disabled'};
 const client=await admin();if(!client)return{status:'access'};
 const result=await sendPilotCommand(client,input);
 if(result.status==='saved')revalidatePath(catalog?'/staff/real/catalog':'/staff/real/payments');
 return result;
});

/** Issues a payment link through the configured provider (fake only) and records its
 * reference. The amount comes from the stored record, never the browser, and a
 * payment that already has a reference is not sent to the provider again. The
 * member and medical details never reach the provider. */
export const issuePaymentLink=loggedAction("issuePaymentLink",async function issuePaymentLink(input:{paymentId:string;revision:number;submissionId:string}):Promise<PilotResult>{
 if(!pilotPaymentsEnabled())return{status:'disabled'};
 const client=await admin();if(!client)return{status:'access'};
 const provider=configuredProvider();if(!provider)return{status:'unavailable'};
 let payment;
 try{payment=(await readAdminPayments(client)).bookings.find(b=>b.payment?.id===input.paymentId)?.payment;}catch{return{status:'unavailable'};}
 if(!payment)return{status:'not-found'};
 if(payment.providerReference)return{status:'unchanged',current:payment.status};
 if(payment.revision!==input.revision)return{status:'stale',current:payment.status};
 if(payment.status!=='pending'&&payment.status!=='failed')return{status:'invalid'};
 let reference:string;
 try{reference=(await provider.createLink({paymentId:payment.id,amountAmd:payment.amountAmd,currency:'AMD'})).reference;}catch{return{status:'unavailable'};}
 const result=await sendPilotCommand(client,{action:'set-reference',submissionId:input.submissionId,paymentId:payment.id,revision:payment.revision,provider:provider.name,reference,reason:'Payment link issued (fake provider)'});
 if(result.status==='saved')revalidatePath('/staff/real/payments');
 return result;
});
