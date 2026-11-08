'use server';
import {loggedAction} from '@/lib/observability/with-logging';
import {requireClinicPortal} from '@/lib/clinic-portal/identity';
import {clinicScheduleCommand,clinicFreeSlots} from '@/lib/clinic-scheduling/actions';
import type {ScheduleResult,FreeSlot} from '@/lib/clinic-scheduling/schema';
import {clinicChatEnabled} from './config';
import {chatCommandSchema,chatQuerySchema} from './schema';
import {readClinicChat,type ClinicChatReply} from './runtime';
async function portal(clinicId:string,expectedScope:string){
 if(!clinicChatEnabled())return null;
 // Commands and reads deliberately use strict access, never the page's fallback clinic.
 const context=await requireClinicPortal(clinicId);
 return context.identity.clinicId===clinicId&&context.actorScope===expectedScope?context:null;
}
export const clinicChatRead=loggedAction('clinicChatRead',async function(clinicId:string,expectedScope:string,input:unknown):Promise<ClinicChatReply>{
 const context=await portal(clinicId,expectedScope);if(!context)return {kind:'access'};
 const query=chatQuerySchema.safeParse(input);if(!query.success)return {kind:'invalid'};
 return readClinicChat(context.rpc,context.identity,query.data);
});
export const clinicChatCommand=loggedAction('clinicChatCommand',async function(clinicId:string,expectedScope:string,input:unknown):Promise<ScheduleResult>{
 const context=await portal(clinicId,expectedScope);if(!context)return {status:'access'};
 const command=chatCommandSchema.safeParse(input);if(!command.success)return {status:'invalid'};
 const result=await clinicScheduleCommand(clinicId,expectedScope,command.data);
 return result.status==='saved'&&result.booking?{...result,booking:{...result.booking,memberPhone:null}}:result;
});
export const clinicChatSlots=loggedAction('clinicChatSlots',async function(clinicId:string,expectedScope:string,day:string):Promise<FreeSlot[]|null>{
 const context=await portal(clinicId,expectedScope);if(!context)return null;
 return clinicFreeSlots(clinicId,expectedScope,day);
});
