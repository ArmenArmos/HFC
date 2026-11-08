import type {Locale} from '@/lib/locale';
import {nurseVisitVersion,type NurseVisitItem,type NurseVisitList,type NurseVisitMarkCommand,type NurseVisitMarkResult,type NurseVisitReady,type NurseVisitSource} from '@/lib/nurse-visit/schema';
import {parseVisitMeasurement} from '@/lib/nurse-visit/chat-parser';
import {visitCopy} from '@/lib/nurse-visit/copy';
import type {MeasureEntry,MeasureField} from './measurement-intent';

/** A reading the nurse typed is prepared as a card, and only a press on Save writes it, into the member's open nurse visit as a
 * measurement mark: the same command, provenance and finish rules as in the visit flow. No visit means no save. */
type Values=NonNullable<NurseVisitMarkCommand['values']>;
export type MeasureCard={
 member:{id:string;name:string};
 /** The conversation the card was prepared in (null when no conversation was open); a card is inert once that changes. */
 scope:string|null;
 visit:{source:NurseVisitSource;id:string;startsAt:string}|null;
 entries:{field:MeasureField;key:`measure:${MeasureField}`;values:Values;submissionId:string;saved:boolean;attempted:boolean}[];
 /** confirm: waiting for Save. no-visit, not-today, no-item, recorded, unavailable: nothing can be saved. unsure: the answer was lost,
  * the same press can be repeated. error: refused with a reason. cancelled and saved are final. */
 state:'confirm'|'saving'|'saved'|'cancelled'|'expired'|'no-visit'|'not-today'|'no-item'|'recorded'|'unavailable'|'unsure'|'error';
 error?:string;nextDay?:string;
};
export type MeasureIo={
 readVisits:()=>Promise<{status:'ready';data:Extract<NurseVisitList,{enabled:true}>}|{status:string}>;
 readVisit:(memberId:string,source:string,id:string)=>Promise<NurseVisitReady|'unavailable'|null>;
 mark:(command:NurseVisitMarkCommand)=>Promise<NurseVisitMarkResult>;
 newId:()=>string;
};
export const measureCardNeedsConfirmation=(card:MeasureCard)=>card.state==='confirm'||card.state==='unsure'||card.state==='error';
const keyOf=(field:MeasureField):`measure:${MeasureField}`=>`measure:${field}`;
const dayOf=(iso:string,hours=0)=>new Date(Date.parse(iso)+hours*3600_000+4*3600_000).toISOString().slice(0,10); // Yerevan is UTC+4
export const measureValueLabel=(field:MeasureField,values:Values,l:Locale)=>{
 const t=visitCopy(l);
 if('systolic' in values)return `${values.systolic}/${values.diastolic} ${t.mmHg}${values.pulse!=null?` · ${t.pulse} ${values.pulse}`:''}`;
 return `${values.value} ${field==='weight'?t.kg:t.cm}`;
};

/** Returns the card, or an error line when a typed value is out of range. Nothing is saved here. */
export async function prepareMeasureCard(io:MeasureIo,member:{id:string;name:string},entries:MeasureEntry[],l:Locale,scope:string|null=null):Promise<MeasureCard|{error:string}>{
 const parsed:MeasureCard['entries']=[];
 for(const entry of entries){
  const item={key:keyOf(entry.field),kind:'measurement',field:entry.field,mark:null} as unknown as NurseVisitItem;
  const result=parseVisitMeasurement(item,entry.text,l);
  if(result.error||!result.values)return {error:result.error??''};
  parsed.push({field:entry.field,key:keyOf(entry.field),values:result.values,submissionId:io.newId(),saved:false,attempted:false});
 }
 const base:MeasureCard={member,scope,visit:null,entries:parsed,state:'confirm'};
 let list;try{list=await io.readVisits();}catch{return {...base,state:'unavailable'};}
 if(list.status!=='ready'||!('data' in list))return {...base,state:'unavailable'};
 const today=list.data.today;
 const own=list.data.visits.filter(visit=>visit.memberId===member.id&&!visit.completion).sort((a,b)=>Date.parse(a.startsAt)-Date.parse(b.startsAt));
 if(!own.length)return {...base,state:'no-visit'};
 // The visit flow takes readings from the day of the visit on; the latest visit that has started is the one in progress.
 const open=[...own].reverse().find(visit=>dayOf(visit.startsAt)<=today);
 if(!open)return {...base,state:'not-today',nextDay:dayOf(own[0]!.startsAt)};
 let detail;try{detail=await io.readVisit(member.id,open.source,open.id);}catch{return {...base,state:'unavailable'};}
 if(!detail||detail==='unavailable'||!('enabled' in detail)||!detail.enabled)return {...base,visit:{source:open.source,id:open.id,startsAt:open.startsAt},state:'unavailable'};
 const withVisit={...base,visit:{source:open.source,id:open.id,startsAt:open.startsAt}};
 for(const entry of parsed){
  const item=detail.items.find(row=>row.key===entry.key);
  if(!item)return {...withVisit,state:'no-item'};
  if(item.mark?.done)return {...withVisit,state:'recorded'};
 }
 return withVisit;
}

/** Writes each reading as a measurement mark with its own submission id; a press repeated after a lost answer replays safely.
 * Every write carries expectUnmarked, so the database itself refuses (already-marked) to replace a measurement marked since the card
 * was prepared; a repeat after a lost answer replays its own submission. The visit is also read again before the first write so the card
 * can say why without a write. */
export async function saveMeasureCard(io:MeasureIo,card:MeasureCard,l:Locale):Promise<MeasureCard>{
 if(!card.visit||!measureCardNeedsConfirmation(card))return card;
 const entries=card.entries.map(entry=>({...entry}));
 if(!entries.some(entry=>entry.attempted)){
  let detail;try{detail=await io.readVisit(card.member.id,card.visit.source,card.visit.id);}catch{return {...card,state:'unavailable'};}
  if(!detail||detail==='unavailable'||!('enabled' in detail)||!detail.enabled)return {...card,state:'unavailable'};
  if(detail.visit.completion)return {...card,state:'no-visit'};
  for(const entry of entries){
   const item=detail.items.find(row=>row.key===entry.key);
   if(!item)return {...card,state:'no-item'};
   if(item.mark?.done)return {...card,state:'recorded'};
  }
 }
 for(const entry of entries){
  if(entry.saved)continue;
  entry.attempted=true;
  const command:NurseVisitMarkCommand={version:nurseVisitVersion,memberId:card.member.id,source:card.visit.source,sourceId:card.visit.id,submissionId:entry.submissionId,startsAt:card.visit.startsAt,item:entry.key,done:true,note:null,values:entry.values,expectUnmarked:true};
  let result:NurseVisitMarkResult;
  try{result=await io.mark(command);}catch{return {...card,entries,state:'unsure',error:visitCopy(l).notConfirmed};}
  if(result.status==='saved'){entry.saved=true;continue;}
  if(result.status==='outcome-unknown'||result.status==='unavailable')return {...card,entries,state:'unsure',error:visitCopy(l).notConfirmed};
  // The database found the item marked since the card was prepared (another card, tab or the visit form) and wrote nothing.
  if(result.status==='already-marked')return {...card,entries,state:'recorded'};
  return {...card,entries,state:'error',error:visitCopy(l).markError(result.status)};
 }
 return {...card,entries,state:'saved',error:undefined};
}
