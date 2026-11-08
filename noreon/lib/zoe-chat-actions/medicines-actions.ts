'use server';
import {z} from 'zod';
import {loggedAction} from '@/lib/observability/with-logging';
import {memberChatOnlyEnabled} from '@/lib/patient/member-chat-config';
import {addMyMedicine,updateMyMedicine,stopMyMedicine,answerMedicineAsk,dismissMedicineAsk,askCareTeamAboutRefill} from '@/lib/member-medicines/actions';
import {sessionActor,noActor} from './actor';
import {readZoeCard,claimCard,recordCard} from './server';
import {readMedicines,type MedicinesRead} from './medicines-read';
import {medicineCommandSchema,runMedicines,type MedicinesCardResult} from './medicines';
import type {CardActionResult} from './registry';
export const readMedicinesFromCard=loggedAction('readMedicinesFromCard',async function readMedicinesFromCard(id:unknown):Promise<{status:'ok';data:MedicinesRead}|{status:Exclude<CardActionResult['status'],'ok'>}>{
 if(!memberChatOnlyEnabled())return {status:'disabled'};
 if(!z.uuid().safeParse(id).success)return {status:'invalid'};
 if(!await sessionActor())return noActor();
 const card=await readZoeCard(id as string);
 if(!card?.valid||card.kind!=='medicines')return {status:'invalid'};
 // Closed cards show today's list read-only. Only an open editing card requires its original token.
 try{const data=await readMedicines();return card.state==='done'||data.token===card.snapshot.token?{status:'ok',data}:{status:'stale'};}catch{return {status:'unavailable'};}
});
const input=z.strictObject({cardId:z.uuid(),opId:z.uuid(),command:medicineCommandSchema});
export const changeMedicinesFromCard=loggedAction('changeMedicinesFromCard',async function changeMedicinesFromCard(raw:unknown):Promise<MedicinesCardResult>{
 if(!memberChatOnlyEnabled())return {status:'disabled'};
 const parsed=input.safeParse(raw);if(!parsed.success)return {status:'invalid'};
 const who=await sessionActor();if(!who)return noActor();
 try{return await runMedicines(who,{readCard:readZoeCard,claim:claimCard,record:recordCard,current:readMedicines,execute:async command=>{
  switch(command.kind){
   case 'add':return addMyMedicine({requestId:command.requestId,name:command.name,dose:command.dose,times:command.times});
   case 'edit':return updateMyMedicine({id:command.id,dose:command.dose,times:command.times});
   case 'times':return updateMyMedicine({id:command.id,dose:command.dose,times:command.times,expectedDose:command.expectedDose});
   case 'stop':return stopMyMedicine(command.id);
   case 'reason':return answerMedicineAsk({askId:command.askId,reason:command.reason});
   case 'keep':return dismissMedicineAsk(command.askId);
   case 'refill':return askCareTeamAboutRefill(command.askId);
  }
 }},parsed.data);}catch{return {status:'unavailable'};}
});
