'use server';
import {loggedAction} from '@/lib/observability/with-logging';
import{revalidatePath}from'next/cache';
import{requireClinicPortal}from'@/lib/clinic-portal/identity';
import{clinicSchedulingEnabled,type ScheduleResult,type SettingsResult,type TeamResult,type FreeSlot}from'./schema';
import{readFreeSlots,runScheduleCommand,runTeamCommand,saveScheduleSettings}from'./runtime';
/** The actor scope fences a stale tab after a session or membership change, as for result links. */
async function portal(clinicId:string,expectedScope:string){
 if(!clinicSchedulingEnabled())return null;
 const context=await requireClinicPortal(clinicId);
 return expectedScope===context.actorScope?context:null;
}
function refresh(){for(const path of['/clinic/real/bookings','/patient/service','/staff/real/members'])revalidatePath(path);revalidatePath('/staff/real/members/[id]','page');}
export const clinicScheduleCommand=loggedAction("clinicScheduleCommand",async function clinicScheduleCommand(clinicId:string,expectedScope:string,input:unknown):Promise<ScheduleResult>{
 const context=await portal(clinicId,expectedScope);if(!context)return{status:'access'};
 const result=await runScheduleCommand(context.rpc,clinicId,input);
 if(result.status==='saved')refresh();
 return result;
});
export const clinicFreeSlots=loggedAction("clinicFreeSlots",async function clinicFreeSlots(clinicId:string,expectedScope:string,day:string):Promise<FreeSlot[]|null>{
 const context=await portal(clinicId,expectedScope);if(!context)return null;
 return readFreeSlots(context.rpc,clinicId,day);
});
export const clinicSaveSchedule=loggedAction("clinicSaveSchedule",async function clinicSaveSchedule(clinicId:string,expectedScope:string,input:unknown):Promise<SettingsResult>{
 const context=await portal(clinicId,expectedScope);if(!context)return{status:'access'};
 const result=await saveScheduleSettings(context.rpc,clinicId,input);
 if(result.status==='saved'){revalidatePath('/clinic/real/hours');revalidatePath('/patient/service');}
 return result;
});
export const clinicTeamCommand=loggedAction("clinicTeamCommand",async function clinicTeamCommand(clinicId:string,expectedScope:string,input:unknown):Promise<TeamResult>{
 const context=await portal(clinicId,expectedScope);if(!context)return{status:'access'};
 const result=await runTeamCommand(context.rpc,clinicId,input);
 if(result.status==='saved')revalidatePath('/clinic/real/team');
 return result;
});
