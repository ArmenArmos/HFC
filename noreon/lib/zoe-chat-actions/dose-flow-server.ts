import 'server-only';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {raiseCareQueueTasks} from '@/lib/care-queue/server';
import {taskFromZone} from '@/lib/care-queue/contracts';
import {ZONE_RULES_V1} from '@/lib/clinical/zones/config-v1';
import {slaDeadline} from '@/lib/clinical/zones/evaluate';
import {deliverRedMessage,raiseSafetyAlert,type FlagPorts} from './bp-flow-server';
import {failedFlow,sentToFrom} from './bp-flow';
import {claim,ownCard,record,type CardResult} from './commands';
import {evaluateSams,nextSamsQuestion,samsAnswers,samsItem,type SamsQuestion} from './dose-flow';
import {BARRIER} from './dose-copy';
import {say,type CardLocale} from './copy';
import type {MemberActor} from './actor';

const payload=z.object({answer:z.boolean(),locale:z.enum(['hy','en','ru'])});
export async function answerSams(who:MemberActor,ports:FlagPorts,v:{cardId:string;opId:string;question:SamsQuestion;answer:boolean;locale:CardLocale}):Promise<CardResult>{
 const card=await ownCard(ports,v.cardId,'sams');if(!card)return {status:'invalid'};
 const item=samsItem(v.question);
 if(card.outcome[item]===undefined&&nextSamsQuestion(samsAnswers(card))!==v.question)return {status:'stale',card};
 const c=await claim(who,ports,card,item,v.opId,{answer:v.answer,locale:v.locale});if(!c.ok)return c.result;
 const held=payload.safeParse(c.claim.payload);if(!held.success)return {status:'invalid',card};
 if(held.data.answer!==v.answer)return {status:'stale',card};
 if(card.outcome[item]!==undefined){await deliverRedMessage(ports,who.memberId,card);return {status:'ok',card};}
 const answers={...samsAnswers(card),[v.question]:v.answer},result=evaluateSams(answers);
 if(result.zone==='red'){
  const alerted=await raiseSafetyAlert(ports.rpc,{memberId:who.memberId,sourceRef:`sams:${card.snapshot.episodeId}`,reason:'sams_red',rule:'zoe.sams',ruleVersion:result.ruleVersion,redFlags:[]});
  const requestId=createHash('sha256').update(`sams:${card.id}`).digest('hex').replace(/^(.{8})(.{4}).(.{3}).(.{3})(.{12}).*$/,'$1-$2-5$3-8$4-$5');
  const text=say(held.data.locale,BARRIER.emergency);
  const done=await record(who,ports,card,item,{answer:v.answer,zone:'red',alerted,requestId,text,ruleVersion:result.ruleVersion,mandatoryTemplateId:result.mandatoryTemplateId},true);
  if(done.status==='ok')await deliverRedMessage(ports,who.memberId,done.card);
  return done;
 }
 if(nextSamsQuestion(answers))return record(who,ports,card,item,{answer:v.answer},false);
 const raises=taskFromZone(result,{memberId:who.memberId,sourceRef:`sams:${card.snapshot.episodeId}`,at:card.at,redFlagsStatus:'cleared',summary:{sams:answers}});
 // Lead's draft fallback, pending Armen's confirmation. This is follow-up for the dose concern,
 // not a new evaluator classification: its no-zone result and undefined-rule reasons stay intact.
 if(!raises.length){
  const warning=answers.darkUrine||answers.fever||answers.jaundice||answers.rightUpperPain;
  const zone=warning?'orange':'yellow',reason=warning?'sams_sign_without_muscle':'side_effect_reported';
  raises.push({memberId:who.memberId,sourceRef:`sams:${card.snapshot.episodeId}`,queue:'physician',zone,reason,ruleVersion:result.ruleVersion,redFlagsStatus:'cleared',suggestedAction:null,
   summary:{sams:answers,reasons:[reason,...result.reasons]},slaDeadline:slaDeadline({slaHours:ZONE_RULES_V1.slaHours[zone]},card.at)});
 }
 const report=ports.rpc?await raiseCareQueueTasks(ports.rpc,raises):null;
 if(!report||report.failed||report.tasks.length!==raises.length)return {status:'unavailable',card};
 const stored=report.tasks.find(t=>t.queue==='physician')??report.tasks[0];
 const flow={...failedFlow(),zone:stored.zone,ruleVersion:stored.ruleVersion,mandatoryTemplateId:result.mandatoryTemplateId,
  slaHours:stored.slaDeadline?Math.round((Date.parse(stored.slaDeadline)-Date.parse(stored.createdAt))/3_600_000):null,slaDeadline:stored.slaDeadline,
  sentTo:sentToFrom(report.tasks.flatMap(t=>t.queue==='admin'?[]:[t.queue])),nurseTask:report.tasks.some(t=>t.queue==='nurse'),taskIds:report.taskIds};
 return record(who,ports,card,item,{answer:v.answer,flow},true);
}
