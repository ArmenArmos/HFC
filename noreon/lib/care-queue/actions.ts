'use server';
import {loggedAction} from '@/lib/observability/with-logging';
import {revalidatePath} from 'next/cache';
import {redirect} from 'next/navigation';
import type {Route} from 'next';
import {z} from 'zod';
import {requireRealStaff} from '@/lib/patient-care/clinical-case-repository';
import {zoeAppV3Enabled} from '@/lib/patient/zoe-app-v3';
import {careQueueMarkResultSchema,queueForRole} from './contracts';

const form=z.object({taskId:z.uuid(),seq:z.coerce.number().int().min(0),to:z.enum(['seen','answered'])});
const back=(notice:string,sandbox:boolean):never=>redirect(`/staff/real/care-queue?${sandbox?'view=sandbox&':''}notice=${notice}` as Route);

export const markCareQueueTask=loggedAction("markCareQueueTask",async function markCareQueueTask(data:FormData){
 const sandbox=data.get('view')==='sandbox';
 const p=form.safeParse({taskId:data.get('taskId'),seq:data.get('seq'),to:data.get('to')});
 if(!p.success)back('invalid',sandbox);
 if(!zoeAppV3Enabled())back('unavailable',sandbox);
 const {client,identity}=await requireRealStaff();
 if(!queueForRole(identity.role))back('access',sandbox);
 let notice='unavailable';
 try{
  const {data:result,error}=await client.rpc('care_queue_mark',{p_task:p.data!.taskId,p_expected_seq:p.data!.seq,p_to:p.data!.to});
  if(!error){const r=careQueueMarkResultSchema.parse(result);notice=r.ok?p.data!.to:r.code==='changed'||r.code==='backward'?'changed':'unavailable';}
 }catch{notice='unavailable';}
 revalidatePath('/staff/real/care-queue');
 back(notice,sandbox);
});
