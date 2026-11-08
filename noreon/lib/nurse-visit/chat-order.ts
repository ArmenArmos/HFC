import {collectionStatus} from './collection';
import type {NurseVisitReady,NurseVisitItem,NurseVisitStepCommand} from './schema';
export type VisitQuestion={kind:'step';step:NurseVisitStepCommand['step']}|{kind:'item';item:NurseVisitItem}|{kind:'finish'};
export type ChatVisitQuestion=VisitQuestion|{kind:'collection'};
export const questionKey=(question:ChatVisitQuestion)=>question.kind==='item'?question.item.key:question.kind==='step'?`step:${question.step}`:question.kind==='collection'?'collection':'finish';
/** Only actions supplied by the visit RPC are eligible. Skips last for this round only. */
export function nextQuestion(visit:NurseVisitReady,skipped?:readonly string[]):VisitQuestion|null;
export function nextQuestion(visit:NurseVisitReady,skipped:readonly string[],collectionCard:true):ChatVisitQuestion|null;
export function nextQuestion(visit:NurseVisitReady,skipped:readonly string[]=[],collectionCard=false):ChatVisitQuestion|null{
 const has=(step:NurseVisitStepCommand['step'])=>visit.steps.some(entry=>entry.step===step);
 const step=(name:NurseVisitStepCommand['step']):VisitQuestion|null=>!has(name)&&!skipped.includes(`step:${name}`)?{kind:'step',step:name}:null;
 const early=new Date(Date.parse(visit.visit.startsAt)+4*3600_000).toISOString().slice(0,10)>visit.today;
 if(visit.visit.bookingStatus==='cancelled')return null;
 if(visit.completion)return has('samples-collected')?step('samples-at-lab'):null;
 if(early)return step('confirmed');
 if(collectionCard){
  for(const group of visitBlocks(visit))for(const question of group.questions){
   const key=questionKey(question);if(skipped.includes(key))continue;
   if(!visitQuestionPending(visit,question))continue;
   return question;
  }
  return null;
 }
 const first=step('confirmed')??step('started');if(first)return first;
 const item=(predicate:(item:NurseVisitItem)=>boolean):VisitQuestion|null=>{const found=visit.items.find(entry=>!entry.mark&&!skipped.includes(entry.key)&&predicate(entry));return found?{kind:'item',item:found}:null;};
 const beforeSamples=item(entry=>entry.kind==='check'&&entry.section==='safety')??item(entry=>entry.kind==='check'&&entry.section==='sampling')??item(entry=>entry.kind==='sample');
 if(beforeSamples)return beforeSamples;
 const collected=visit.items.some(entry=>entry.kind==='sample'&&entry.mark?.done)?step('samples-collected'):null;
 if(collected)return collected;
 const lab=has('samples-collected')?step('samples-at-lab'):null;if(lab)return lab;
 return item(entry=>entry.kind==='check'&&entry.section==='bp')??item(entry=>entry.kind==='measurement')??item(entry=>entry.kind==='device')??(skipped.includes('finish')?null:{kind:'finish'});
}

/** Groups include saved/skipped actions, keeping the denominator stable. */
export type VisitBlock={id:'arrival'|'bp'|'body'|'samples'|'finish';questions:ChatVisitQuestion[]};
export function visitBlocks(data:NurseVisitReady):VisitBlock[]{
 const items=(predicate:(item:NurseVisitItem)=>boolean):ChatVisitQuestion[]=>data.items.filter(predicate).map(item=>({kind:'item',item}));
 const blocks:VisitBlock[]=[
  {id:'arrival',questions:[{kind:'step',step:'confirmed'},{kind:'step',step:'started'}]},
  {id:'bp',questions:[...items(i=>i.kind==='check'&&(i.section==='safety'||i.section==='bp')),...items(i=>i.kind==='device'),...items(i=>i.kind==='measurement'&&i.field==='bp')]},
  {id:'body',questions:items(i=>i.kind==='measurement'&&i.field!=='bp')},
  {id:'samples',questions:[...items(i=>i.kind==='check'&&i.section==='sampling'),...(data.items.some(i=>i.kind==='sample')?[{kind:'collection'} as const,{kind:'step',step:'samples-collected'} as const,{kind:'step',step:'samples-at-lab'} as const]:[])]},
  {id:'finish',questions:[{kind:'finish'}]},
 ];
 return blocks.filter(block=>block.questions.length>0);
}

/** A saved answer, including an explicit negative, is finished work on reload. */
export function visitQuestionPending(data:NurseVisitReady,question:ChatVisitQuestion):boolean{
 if(question.kind==='item')return !question.item.mark;
 if(question.kind==='collection')return data.items.some(i=>i.kind==='sample'&&collectionStatus(i)==='pending');
 if(question.kind==='finish')return !data.completion;
 if(data.steps.some(s=>s.step===question.step))return false;
 const collected=data.items.some(i=>i.kind==='sample'&&collectionStatus(i)==='collected');
 if(question.step==='samples-collected')return collected;
 if(question.step==='samples-at-lab')return data.steps.some(s=>s.step==='samples-collected');
 return true;
}
