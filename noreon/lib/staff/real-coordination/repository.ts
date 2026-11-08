import 'server-only';
import {notFound} from 'next/navigation';
import {requireRealStaffForRender} from '@/lib/staff/real-staff-render';
import {memberPageSchema,taskPageSchema} from './schema';
export async function readCoordinationWorkspace(caseId?:string){
 const {client,identity}=await requireRealStaffForRender();
 const [tasks,members]=await Promise.all([client.rpc('patient_coordination_queue',caseId?{p_case:caseId}:{}),client.rpc('patient_coordination_members',caseId?{p_search:caseId}:{})]);
 if(caseId&&tasks.error?.code==='42501')notFound();
 if(tasks.error||members.error)throw Error('Coordination tasks could not load. Please try again.');
 return {actor:{id:identity.id,role:identity.role},page:taskPageSchema.parse(tasks.data),memberPage:memberPageSchema.parse(members.data)};
}
