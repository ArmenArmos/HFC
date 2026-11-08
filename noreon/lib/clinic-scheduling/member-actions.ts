'use server';
import {loggedAction} from '@/lib/observability/with-logging';
import{requireClinicPortal}from'@/lib/clinic-portal/identity';
import{clinicSchedulingEnabled}from'./schema';
import{searchClinicMembers}from'./member-file';
/** Member search runs as a POST server action, so names and phone digits never appear in a URL,
 * browser history or request logs (review MF-1). The actor scope fences a stale tab. */
export const clinicMemberSearch=loggedAction("clinicMemberSearch",async function clinicMemberSearch(clinicId:string,expectedScope:string,query:string,page:number=1){
 if(!clinicSchedulingEnabled())return{status:'unavailable' as const};
 const context=await requireClinicPortal(clinicId);
 if(expectedScope!==context.actorScope)return{status:'unavailable' as const};
 return searchClinicMembers(context.rpc,clinicId,typeof query==='string'?query:'',typeof page==='number'?page:1);
});
