import 'server-only';
import { workspaceAdmin, getStaff } from '@/lib/staff/auth';
import { requireMemberCase, getWorkspaceCase } from '@/lib/staff/cases';
import type { StaffIdentity } from '@/lib/staff/types';
export class NotificationUnauthorized extends Error {}
export async function inboxIdentity(staff: boolean) {
 if (staff) {
  const identity = await getStaff();
  if (!identity) throw new NotificationUnauthorized();
  return { key: `staff:${identity.id}`, staff: identity, caseId: null };
 }
 const item = await requireMemberCase().catch((error: unknown) => {
  if (error instanceof Error && ['unauthorized','not_found'].includes(error.message)) throw new NotificationUnauthorized();
  throw error;
 });
 return { key: `member:${item.id}`, staff: null, caseId: item.id };
}
export async function readInbox(staff: boolean) {
 const identity = await inboxIdentity(staff);
 let q = workspaceAdmin().from('workspace_notifications').select('id,read_at,workspace_activity!inner(id,case_id,kind,created_at,workspace_cases!inner(assigned_doctor_id,assigned_nurse_id,expires_at))')
 .eq('recipient', identity.key).gt('workspace_activity.workspace_cases.expires_at', new Date().toISOString());
 if (identity.staff?.role === 'doctor') q = q.eq('workspace_activity.workspace_cases.assigned_doctor_id',identity.staff.id);
 if (identity.staff?.role === 'nurse') q = q.eq('workspace_activity.workspace_cases.assigned_nurse_id',identity.staff.id);
 if (identity.caseId) q = q.eq('workspace_activity.case_id',identity.caseId);
 const {data,error} = await q.order('id',{ascending:false}).limit(100);
 if(error) throw new Error('Notifications could not be loaded. Try again.');
 let scoped=data??[];
 if(identity.staff?.role==='nurse'){
   const ids=[...new Set(scoped.map(n=>n.workspace_activity.case_id))];
   const allowed=new Set<string>();
   for(let offset=0;offset<ids.length;offset+=8){
     const checks=await Promise.all(ids.slice(offset,offset+8).map(async id=>{const result=await workspaceAdmin().rpc('staff_care_access',{p_id:id,p_actor:identity.staff!.id,p_native:false});return !result.error&&result.data===true?id:null;}));
     for(const id of checks)if(id)allowed.add(id);
   }
   scoped=scoped.filter(n=>allowed.has(n.workspace_activity.case_id));
 }
 return scoped.map(n => ({ id:n.id, readAt:n.read_at, kind:n.workspace_activity.kind, at:n.workspace_activity.created_at, caseId:n.workspace_activity.case_id }));
}
export async function markNotificationRead(staff: boolean,id: number) {
 const identity = await inboxIdentity(staff);
 const db=workspaceAdmin();
 const { data, error }=await db.from('workspace_notifications').select('id,workspace_activity!inner(case_id)').eq('id',id).eq('recipient',identity.key).maybeSingle();
 if(error || !data) throw new Error('Notification unavailable');
 if(identity.staff) await getWorkspaceCase(data.workspace_activity.case_id,identity.staff);
 else if(data.workspace_activity.case_id !== identity.caseId) throw new Error('Notification unavailable');
 const {error:saveError}=await db.from('workspace_notifications').update({read_at:new Date().toISOString()}).eq('id',id).eq('recipient',identity.key);
 if(saveError) throw new Error('Could not mark notification as read');
}
export async function caseHistory(caseId:string, staff:StaffIdentity) {
 await getWorkspaceCase(caseId,staff);
 const {data,error}=await workspaceAdmin().from('workspace_activity').select('id,kind,actor_label,created_at,case_revision').eq('case_id',caseId).order('id',{ascending:false}).limit(100);
 if(error) throw new Error('History could not be loaded');
 return data ?? [];
}
