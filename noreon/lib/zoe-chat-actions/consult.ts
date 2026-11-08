import 'server-only';
import {claim,ownCard,record,type CardPorts,type CardResult} from './commands';
import type {MemberActor} from './actor';
import {symptomGateInput} from './labs-contract';
import {CONSULT,consultQuestionsText} from './consult-copy';
import type {z} from 'zod';
export type ConsultSend=(requestId:string,text:string)=>Promise<{status:string}>;
type Ports=Pick<CardPorts,'readCard'|'claim'|'record'>&{send:ConsultSend};
/** Both choices use the ordinary message-to-doctor path, including its existing 103 handling. No invented symptoms. */
export async function runSymptomGate(actor:MemberActor,ports:Ports,v:z.infer<typeof symptomGateInput>):Promise<CardResult>{
 if(actor.channel!=='app')return {status:'disabled'};
 const card=await ownCard(ports,v.cardId,'symptom_gate');if(!card)return {status:'invalid'};
 if(card.state==='done')return {status:'closed',card};
 const c=await claim(actor,ports,card,'symptom_gate',v.opId,v);if(!c.ok)return c.result;
 const p=symptomGateInput.safeParse(c.claim.payload);
 if(!p.success||p.data.choice!==v.choice||p.data.locale!==v.locale)return {status:'stale',card};
 const message=(p.data.choice==='acute'?CONSULT.acuteMessage:CONSULT.plannedMessage)[p.data.locale];
 const sent=await ports.send(c.claim.op,message);
 if(sent.status!=='sent'&&sent.status!=='urgent')return {status:'unavailable',card};
 return record(actor,ports,card,'symptom_gate',{choice:p.data.choice,requestId:c.claim.op,urgent:sent.status==='urgent'},true);
}

import {consultQuestionsInput} from './labs-contract';
type QuestionInput=z.infer<typeof consultQuestionsInput>;
export async function runConsultQuestions(actor:MemberActor,ports:Ports&{
 save(requestId:string,appointmentId:string|null,groups:QuestionInput['groups']):Promise<boolean>;
 markSent(requestId:string):Promise<boolean>;
},v:QuestionInput):Promise<CardResult>{
 if(actor.channel!=='app')return {status:'disabled'};
 const card=await ownCard(ports,v.cardId,'consult_questions');if(!card)return {status:'invalid'};
 if(card.state==='done')return {status:'closed',card};
 const c=await claim(actor,ports,card,'consult_questions',v.opId,v);if(!c.ok)return c.result;
 const p=consultQuestionsInput.safeParse(c.claim.payload);
 if(!p.success||JSON.stringify(p.data.groups)!==JSON.stringify(v.groups)||p.data.locale!==v.locale)return {status:'stale',card};
 const groups=p.data.groups.filter(g=>g.text);
 if(!await ports.save(c.claim.op,card.snapshot.appointmentId,groups))return {status:'failed',card};
 const text=consultQuestionsText(p.data.locale,groups);
 const sent=await ports.send(c.claim.op,text);
 if(sent.status!=='sent'&&sent.status!=='urgent')return {status:'unavailable',card};
 if(!await ports.markSent(c.claim.op))return {status:'unavailable',card};
 return record(actor,ports,card,'consult_questions',{requestId:c.claim.op,sent:true},true);
}
