import 'server-only';
import {z} from 'zod';
import {zoeAppV3Enabled} from '@/lib/patient/zoe-app-v3';
import type {Rpc} from './server';
import {raiseCareQueueTasks} from '@/lib/care-queue/server';
import {adherenceContext,adherenceTasks,explicitStatin,followupLabTasks,labPublication,type StopIntent} from './plan-followup';

const report=z.object({state:z.enum(['ran','off']),posted:z.number().int().nonnegative(),failed:z.number().int().nonnegative()});
/** Original submitted stop intents remain replayable even after a newer medicine edit. */
export async function runV3StopFollowup(rpc:Rpc,memberId:string,stops:StopIntent[],env:Record<string,string|undefined>=process.env){
 if(!zoeAppV3Enabled(env))return false;
 const known=stops.filter(s=>explicitStatin(s.name));
 if(!known.length)return false;
 const tasks=known.flatMap(s=>adherenceTasks(memberId,{episode:s.episode,missedDoseDays:0,missedMeasurements:0,wantsToStopStatin:true},new Date().toISOString()));
 const r=await raiseCareQueueTasks(rpc,tasks,env);
 return r.failed===0&&r.raised+r.replayed===tasks.length;
}
export async function runV3Adherence(rpc:Rpc,memberId:string,env:Record<string,string|undefined>=process.env){
 if(!zoeAppV3Enabled(env))return {raised:0,replayed:0,failed:0,stopSent:false};
 const context=adherenceContext.parse(await rpc('zoe_v3_adherence_context',{p_member:memberId}));
 const stops=context.stops.filter(s=>explicitStatin(s.name));
 const episodes=[...context.episodes,...stops.map(s=>({episode:s.episode,missedDoseDays:0,missedMeasurements:0,wantsToStopStatin:true}))];
 const totals={raised:0,replayed:0,failed:0,stopSent:stops.length>0};
 for(const episode of episodes){
  const r=await raiseCareQueueTasks(rpc,adherenceTasks(memberId,episode,new Date().toISOString()),env);
  totals.raised+=r.raised;totals.replayed+=r.replayed;totals.failed+=r.failed;
  if(episode.wantsToStopStatin&&(r.failed>0||r.raised+r.replayed!==2))totals.stopSent=false;
 }
 return totals;
}
/** Called by the existing five-minute reminder job, even when Telegram is off. No outbound channel IO. */
export async function runV3PlanJobs(rpc:Rpc|null,env:Record<string,string|undefined>=process.env){
 if(!zoeAppV3Enabled(env)||env.NOREON_MEMBER_CHAT_V2!=='true')return {state:'off',posted:0,failed:0};
 if(!rpc)return {state:'unavailable',posted:0,failed:1};
 const reminders=report.parse(await rpc('zoe_v3_reminders_run',{}));
 const members=z.array(z.uuid()).parse(await rpc('zoe_v3_plan_members',{}));
 let raised=0,replayed=0,failed=reminders.failed;
 for(const memberId of members){
  try{const r=await runV3Adherence(rpc,memberId,env);raised+=r.raised;replayed+=r.replayed;failed+=r.failed;}catch{failed++;}
 }
 let unknownDrugClasses=0;
 const publications=z.array(labPublication).parse(await rpc('zoe_v3_lab_changes',{}));
 for(const publication of publications){
  const work=followupLabTasks(publication);unknownDrugClasses+=work.unknownDrugClasses;
  const r=await raiseCareQueueTasks(rpc,work.tasks,env);raised+=r.raised;replayed+=r.replayed;failed+=r.failed;
 }
 return {...reminders,raised,replayed,failed,unknownDrugClasses};
}
