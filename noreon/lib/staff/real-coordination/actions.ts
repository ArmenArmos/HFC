'use server';
import {loggedAction} from '@/lib/observability/with-logging';
import {z} from 'zod';
import {revalidatePath} from 'next/cache';
import {requireRealStaff} from '@/lib/patient-care/clinical-case-repository';
import {coordinationCommandSchema,taskSnapshotSchema,taskPageSchema,memberPageSchema,cursorSchema,taskFilterSchema,type CoordinationResult,type CoordinationSnapshot} from './schema';
export const coordinationCommand=loggedAction("coordinationCommand",async function coordinationCommand(input:unknown):Promise<CoordinationResult>{
 const parsed=coordinationCommandSchema.safeParse(input);
 if(!parsed.success)return {ok:false,error:'Check the task details and required note or reason.'};
 const {client}=await requireRealStaff();
 const c=parsed.data;
 const result=await client.rpc('patient_coordination_command',{p_case:c.caseId,p_task:c.taskId,p_expected_revision:c.revision,p_request:c.requestId,p_operation:c.operation,p_input:c.input});
 const saved=z.object({id:z.uuid(),revision:z.number().int().positive(),status:taskSnapshotSchema.shape.status}).safeParse(result.data);
 if(result.error||!saved.success||saved.data.id!==c.taskId||saved.data.revision!==c.revision+1)return {ok:false,uncertain:!result.error?.code||!['40001','42501','23514','22P02'].includes(result.error.code),error:result.error?.code==='23514'?'Check the task state and required note or reason.':'This task or your assignment changed, or the result could not be confirmed. Load current tasks before trying again.'};
 revalidatePath('/staff/real/tasks');revalidatePath(`/staff/real/members/${c.caseId}`);
 return {ok:true,...saved.data};
});
export const refreshCoordinationTask=loggedAction("refreshCoordinationTask",async function refreshCoordinationTask(id:unknown):Promise<{ok:true;task:CoordinationSnapshot}|{ok:false;error:string}>{
 const parsed=z.uuid().safeParse(id);
 if(!parsed.success)return {ok:false,error:'Current task access is required.'};
 const {client}=await requireRealStaff();
 const result=await client.rpc('patient_coordination_snapshot',{p_task:parsed.data});
 const task=taskSnapshotSchema.safeParse(result.data);
 if(result.error||!task.success)return {ok:false,error:'Current task could not load. Your entries are retained. Check your assignment and try again.'};
 return {ok:true,task:task.data};
});

export const readCoordinationPage=loggedAction("readCoordinationPage",async function readCoordinationPage(input:unknown){
 const parsed=z.object({caseId:z.uuid().optional(),filter:taskFilterSchema,cursor:cursorSchema.nullable().optional()}).strict().safeParse(input);
 if(!parsed.success)return {ok:false as const,error:'Check the task view.'};
 const {client}=await requireRealStaff();const c=parsed.data;
 const result=await client.rpc('patient_coordination_queue',{p_case:c.caseId,p_filter:c.filter,p_after_created_at:c.cursor?.createdAt,p_after_id:c.cursor?.id,p_limit:50});
 const page=taskPageSchema.safeParse(result.data);
 if(result.error||!page.success)return {ok:false as const,error:'Current tasks could not load. Check your access and try again.'};
 return {ok:true as const,page:page.data};
});
export const searchCoordinationMembers=loggedAction("searchCoordinationMembers",async function searchCoordinationMembers(input:unknown){
 const parsed=z.object({search:z.string().trim().max(100),cursor:cursorSchema.nullable().optional()}).strict().safeParse(input);
 if(!parsed.success)return {ok:false as const,error:'Check the member search.'};
 const {client}=await requireRealStaff();const c=parsed.data;
 const result=await client.rpc('patient_coordination_members',{p_search:c.search,p_after_created_at:c.cursor?.createdAt,p_after_id:c.cursor?.id,p_limit:50});
 const page=memberPageSchema.safeParse(result.data);
 if(result.error||!page.success)return {ok:false as const,error:'Assigned members could not load. Try searching again.'};
 return {ok:true as const,page:page.data};
});
