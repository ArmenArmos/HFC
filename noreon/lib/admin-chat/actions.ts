'use server';
import {loggedAction} from '@/lib/observability/with-logging';
import {requireRealAdmin} from '@/lib/staff/real-admin';
import {telegramEnabled} from '@/lib/telegram-runtime/config';
import type {BookingRpc} from '@/lib/real-booking/appointment-runtime';
import {clinicSchedulingEnabled} from '@/lib/clinic-scheduling/schema';
import {adminChatEnabled} from './config';
import {adminIntent,type AdminChatResult} from './contracts';
import {readAdminOperations} from './read';

export const readAdminChat=loggedAction('readAdminChat',async function readAdminChat(input:unknown):Promise<AdminChatResult>{
 if(!adminChatEnabled())return {kind:'off'};
 let staff;
 try{staff=await requireRealAdmin();}catch{return {kind:'denied'};}
 const intent=adminIntent(input);
 if(!intent)return {kind:'invalid'};
 try{return {kind:'ready',view:await readAdminOperations(staff.client as unknown as BookingRpc,intent,{telegram:telegramEnabled(),portal:clinicSchedulingEnabled()})};}
 catch{return {kind:'unavailable'};}
});
