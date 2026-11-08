'use server';
import {unstable_rethrow} from 'next/navigation';
import {loggedAction} from '@/lib/observability/with-logging';
import {requireRealStaff} from '@/lib/patient-care/clinical-case-repository';
import {taskPageSchema,cursorSchema} from '@/lib/staff/real-coordination/schema';
import {readNurseVisits} from '@/lib/nurse-visit/runtime';
import {runStaffMemberIdentities} from '@/lib/staff/member-identity-command';
import {readNurseAlerts} from '@/lib/care-alerts/nurse';
import {log} from '@/lib/observability/logger';
import {nurseChatEnabled} from './config';

export const readNurseToday=loggedAction('readNurseToday',async function readNurseToday(cursor:unknown=null){
 if(!nurseChatEnabled())return {ok:false as const,code:'off' as const};
 const parsed=cursorSchema.nullable().safeParse(cursor);
 if(!parsed.success)return {ok:false as const,code:'unavailable' as const};
 try{
  const {client,identity}=await requireRealStaff();
  if(identity.role!=='nurse')return {ok:false as const,code:'denied' as const};
  const [tasks,visits,alerts]=await Promise.all([
   client.rpc('patient_coordination_queue',{p_filter:'active',p_after_created_at:parsed.data?.createdAt,p_after_id:parsed.data?.id,p_limit:50}),
   readNurseVisits({rpc:()=>client.rpc('nurse_visit_list')}).catch((error:{code?:string})=>{
    // Said out loud on her screen as "could not be read"; the code lands here so the failure is not silent.
    log.warn('Nurse Today visits could not be read',{code:error?.code??null});return null;
   }),
   readNurseAlerts(client),
  ]);
  const page=taskPageSchema.safeParse(tasks.data);
  const taskPage=!tasks.error&&page.success?page.data:null;
  if(!taskPage)log.warn('Nurse Today tasks could not be read',{code:tasks.error?.code??'shape'});
  const ids=[...new Set([...(taskPage?.tasks.map(task=>task.caseId)??[]),...(visits?.enabled?visits.visits.map(visit=>visit.memberId):[])])];
  const batches=[];
  for(let i=0;i<ids.length;i+=50)batches.push(runStaffMemberIdentities(ids.slice(i,i+50),client));
  const identities=(await Promise.all(batches)).flatMap(rows=>rows??[]);
  return {ok:true as const,page:taskPage,visits,...(alerts?{alerts}:{}),identities,asOf:new Date().toISOString()};
 }catch(error){unstable_rethrow(error);return {ok:false as const,code:'unavailable' as const};}
});
