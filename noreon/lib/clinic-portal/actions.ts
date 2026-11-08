'use server';
import {loggedAction} from '@/lib/observability/with-logging';
import{redirect}from'next/navigation';
import{clinicAuthClient,requireClinicPortal}from'./identity';
import{runClinicCommand,refreshClinicCommand,readClinicBatch}from'./runtime';
export const clinicSignOut=loggedAction("clinicSignOut",async function clinicSignOut(){const client=await clinicAuthClient();await client.auth.signOut({scope:'local'});redirect('/clinic/real/login');});
export const clinicCommand=loggedAction("clinicCommand",async function clinicCommand(clinicId:string,input:unknown,expectedScope:string){const context=await requireClinicPortal(clinicId);if(expectedScope!==context.actorScope)return{status:'access' as const};return runClinicCommand(context.rpc,context.identity,input);});
export const clinicRecover=loggedAction("clinicRecover",async function clinicRecover(clinicId:string,input:unknown,expectedScope:string){const context=await requireClinicPortal(clinicId);if(expectedScope!==context.actorScope)return{status:'unavailable' as const};return refreshClinicCommand(context.rpc,context.identity,input);});
export const clinicRead=loggedAction("clinicRead",async function clinicRead(clinicId:string,batchId:string,cursor:string|null,expectedScope:string){const context=await requireClinicPortal(clinicId);if(expectedScope!==context.actorScope)return{status:'unavailable' as const};return readClinicBatch(context.rpc,context.identity,batchId,cursor);});
