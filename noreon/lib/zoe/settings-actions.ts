'use server';
import {loggedAction} from '@/lib/observability/with-logging';
import {revalidatePath} from 'next/cache';
import {after} from 'next/server';
import {log,errorFields} from '@/lib/observability/logger';
import {requireRealStaff} from '@/lib/patient-care/clinical-case-repository';
import {zoeServiceRpc} from './server';
import {applyTierChangeCore,rollbackTierChangeCore,runTierModelEvalCore,zoeAiSettingsEnabled,type Rpc,type SettingsResult} from './settings-core';

async function admin(){
 const {client,identity}=await requireRealStaff();
 if(identity.role!=='admin')return null;
 const rpc:Rpc=async(name,args)=>{const r=await client.rpc(name as never,args as never);if(r.error)throw Error('AI settings unavailable');return r.data;};
 return {id:identity.id,rpc};
}

/** Runs the eval set for the candidate tier settings, then applies them only if it passes (model mode: in the background). */
export const applyZoeTierChange=loggedAction("applyZoeTierChange",async function applyZoeTierChange(input:unknown):Promise<SettingsResult>{
 if(!zoeAiSettingsEnabled())return {status:'disabled'};
 const a=await admin();if(!a)return {status:'access'};
 const result=await applyTierChangeCore(input,{adminId:a.id,admin:a.rpc,service:zoeServiceRpc(),
  defer:work=>after(async()=>{await work();revalidatePath('/staff/real/ai-settings');await log.flush();}),
  onError:(stage,error)=>log.error('Zoe tier change eval failed',{stage,...errorFields(error)})});
 revalidatePath('/staff/real/ai-settings');
 return result;
});

/** Restores the tier settings that were in place before a recorded change. */
export const rollbackZoeTierChange=loggedAction("rollbackZoeTierChange",async function rollbackZoeTierChange(input:unknown):Promise<SettingsResult>{
 if(!zoeAiSettingsEnabled())return {status:'disabled'};
 const a=await admin();if(!a)return {status:'access'};
 const result=await rollbackTierChangeCore(input,{admin:a.rpc});
 if(result.status==='rolled_back')revalidatePath('/staff/real/ai-settings');
 return result;
});

/**
 * Starts the model-mode eval (real calls) for one tier's current models. The run continues after the
 * response (up to the page's maxDuration) and records its result; the page shows the running job.
 */
export const runZoeModelEval=loggedAction("runZoeModelEval",async function runZoeModelEval(input:unknown):Promise<SettingsResult>{
 if(!zoeAiSettingsEnabled())return {status:'disabled'};
 const a=await admin();if(!a)return {status:'access'};
 const result=await runTierModelEvalCore(input,{adminId:a.id,admin:a.rpc,service:zoeServiceRpc(),
  defer:work=>after(async()=>{await work();await log.flush();}),
  onError:(stage,error)=>log.error('Zoe model eval failed',{stage,...errorFields(error)})});
 revalidatePath('/staff/real/ai-settings');
 return result;
});
