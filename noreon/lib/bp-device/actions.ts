'use server';
import {loggedAction} from '@/lib/observability/with-logging';
import{revalidatePath}from'next/cache';
import{requireRealStaff}from'@/lib/patient-care/clinical-case-repository';
import{bpDevicesEnabled}from'./config';
import{sendBpDeviceCommand,type BpRpc}from'./runtime';
import type{BpDeviceResult}from'./schema';

export const recordBpDeviceCommand=loggedAction("recordBpDeviceCommand",async function recordBpDeviceCommand(path:string,input:unknown):Promise<BpDeviceResult>{
 if(!bpDevicesEnabled())return{status:'disabled'};
 const{client,identity}=await requireRealStaff();
 if(identity.role!=='admin'&&identity.role!=='nurse')return{status:'access'};
 const result=await sendBpDeviceCommand(client as unknown as BpRpc,input);
 if(result.status==='saved'||result.status==='still-held')for(const target of new Set(['/staff/real/devices',path.startsWith('/staff/real/')?path:'/staff/real/devices']))revalidatePath(target);
 return result;
});
