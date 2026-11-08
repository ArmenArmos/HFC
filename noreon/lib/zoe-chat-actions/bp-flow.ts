import {careQueueMemberTasksSchema} from '@/lib/care-queue/contracts';
import {evaluateBp,type ZoneResult} from '@/lib/clinical/zones/evaluate';
import {ZONE_RULES_V1} from '@/lib/clinical/zones/config-v1';
import {zoeAppV3Enabled} from '@/lib/patient/zoe-app-v3';
import type {ZoeCard} from './registry';
import {SAMS_QUESTIONS,samsItem} from './dose-flow';

/**
 * The blood pressure flow's decisions, pure. The rules decide; no model and no word list is involved. A "yes" to a
 * safety question is red because evaluateBp says so, which is what opens the 103 card from the card's saved outcome.
 */
export const RED_FLAG_QUESTIONS=['chest_pain','dyspnea','neuro','headache_dizziness','faint']as const;
export type RedFlagQuestion=typeof RED_FLAG_QUESTIONS[number];
export const flagItem=(q:RedFlagQuestion)=>`a:${q}`;
/** The care alert's registry ids. Stroke signs and the sudden severe headache or dizziness question are both RF-04. */
export const FLAG_RED_FLAG:Record<RedFlagQuestion,'RF-01'|'RF-02'|'RF-04'>={chest_pain:'RF-01',dyspnea:'RF-02',neuro:'RF-04',headache_dizziness:'RF-04',faint:'RF-02'};

export type Answers=Partial<Record<RedFlagQuestion,boolean>>;
export type BpSymptoms={chestPain:boolean|null;dyspnea:boolean|null;neuro:boolean|null;syncope:boolean|null};
export const UNASKED:BpSymptoms={chestPain:null,dyspnea:null,neuro:null,syncope:null};
const either=(a:boolean|undefined,b:boolean|undefined)=>a===true||b===true?true:a===false&&b===false?false:null;
/** A question not reached stays unknown, never a no. */
export const symptomsFrom=(a:Answers):BpSymptoms=>({chestPain:a.chest_pain??null,dyspnea:a.dyspnea??null,neuro:either(a.neuro,a.headache_dizziness),syncope:a.faint??null});
export const answersOn=(card:Pick<ZoeCard,'outcome'>):Answers=>Object.fromEntries(RED_FLAG_QUESTIONS.flatMap(q=>{
 const v=card.outcome[flagItem(q)] as {answer?:unknown}|undefined;
 return typeof v?.answer==='boolean'?[[q,v.answer]]:[];
}));
/** The next question: none after any yes, and none once all are answered. */
export function nextQuestion(a:Answers):RedFlagQuestion|null{
 if(Object.values(a).includes(true))return null;
 return RED_FLAG_QUESTIONS.find(q=>a[q]===undefined)??null;
}

export type Reading={sbp:number;dbp:number};
export type FlowNext='red_flags'|'repeat'|null;
/** Safety questions before the repeat: someone with chest pain should not sit through a 60 second timer first. */
export function decide(readings:readonly Reading[],symptoms:BpSymptoms):{result:ZoneResult;next:FlowNext}{
 const result=evaluateBp({readings,symptoms});
 const next=result.requiredUi.includes('bp_red_flags')?'red_flags':result.requiredUi.includes('repeat_measure')?'repeat':null;
 return {result,next};
}

/** What the reply to a saved reading says, stored with the card so every read and device shows the same. */
export type BpFlow={zone:ZoneResult['zone'];provisional:boolean;ruleVersion:string;next:FlowNext;
 /** Only a role that really received the task or reading alert. Null never claims delivery. */
 sentTo:'nurse'|'physician'|null;slaHours:number|null;taskIds:string[];alertId?:string;alertReason?:'bp_doctor_today'|'bp_doctor_48h';nurseTask?:boolean;slaDeadline?:string|null;outOfHours:boolean;mandatoryTemplateId?:ZoneResult['mandatoryTemplateId']};
export const failedFlow=():BpFlow=>({zone:null,provisional:false,ruleVersion:ZONE_RULES_V1.version,next:null,sentTo:null,slaHours:null,taskIds:[],outOfHours:false});
/** The doctor when a doctor's task landed, else the nurse, else nobody. */
export const sentToFrom=(landed:readonly('nurse'|'physician')[])=>landed.includes('physician')?'physician' as const:landed.includes('nurse')?'nurse' as const:null;

export type RedOutcome={question:string;requestId:string;text:string;alerted:boolean;cleared:boolean;at:string};
/** A "yes" on this card, if any: from the saved outcome alone, so it survives a reload and a second device. */
export function redOutcome(card:ZoeCard):RedOutcome|null{
 if(card.kind!=='red_flags'&&card.kind!=='sams')return null;
 const items=card.kind==='sams'?SAMS_QUESTIONS.map(q=>({q,item:samsItem(q)})):RED_FLAG_QUESTIONS.map(q=>({q,item:flagItem(q)}));
 for(const {q,item} of items){
  const v=card.outcome[item] as {answer?:unknown;requestId?:unknown;text?:unknown;alerted?:unknown;doneAt?:unknown}|undefined;
  if(v?.answer===true&&typeof v.requestId==='string'&&typeof v.text==='string'&&(card.kind!=='sams'||(v as {zone?:string}).zone==='red'))return {question:q,requestId:v.requestId,text:v.text,cleared:card.outcome.emergencyCleared===true,alerted:v.alerted===true||(card.outcome.alert as {alerted?:boolean}|undefined)?.alerted===true,at:typeof v.doneAt==='string'?v.doneAt:card.at};
 }
 return null;
}
export const flowOf=(card:ZoeCard):BpFlow|null=>{
 if(card.kind==='red_flags'||card.kind==='sams'){
  const items=card.kind==='sams'?SAMS_QUESTIONS.map(samsItem):RED_FLAG_QUESTIONS.map(flagItem);
  const last=items.map(item=>card.outcome[item] as {flow?:BpFlow}|undefined).find(v=>v?.flow);
  return last?.flow??null;
 }
 return (card.kind==='bp'||card.kind==='repeat')?(card.outcome.bp as {flow?:BpFlow}|undefined)?.flow??null:null;
};

const episodeMs=ZONE_RULES_V1.repeatEpisodeMinutes*60_000;
/** A safety question is showing while its card is open and its episode is current; an abandoned one never locks the chat. */
export const openFlags=(cards:readonly ZoeCard[],now=Date.now())=>cards.find(c=>c.kind==='red_flags'&&c.valid&&c.state==='open'&&now-Date.parse(c.at)<episodeMs)??null;
/** The answers of this episode's newest safety card, whichever card saves the next reading. */
export function episodeSymptoms(cards:readonly ZoeCard[],now=Date.now()):BpSymptoms{
 const newest=cards.filter(c=>c.kind==='red_flags'&&c.outcome.emergencyCleared!==true&&now-Date.parse(c.at)<episodeMs).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at))[0];
 return newest?symptomsFrom(answersOn(newest)):UNASKED;
}

export type ContextStrip={zone:'green'|'yellow'|'orange'|'red'|null;pending:{kind:'red_flags';left:number}|{kind:'repeat'}|{kind:'call103'}|null};
/** Above the composer. Hidden when nothing is pending and the last zone is green. Only a reading from the last 24 hours counts. */
export function contextStrip(cards:readonly ZoeCard[],now=Date.now()):ContextStrip|null{
 const activeRed=(card:ZoeCard)=>{const r=redOutcome(card);return r&&!r.cleared;};
 const fresh=(at:string)=>now-Date.parse(at)<ZONE_RULES_V1.readingFreshHours*3_600_000;
 // Newest first, and red first at the same moment.
 const flow=[...cards].sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)||Number(!!activeRed(b))-Number(!!activeRed(a))).find(c=>fresh(c.at)&&(activeRed(c)||flowOf(c)));
 const zone=flow?activeRed(flow)?'red':flowOf(flow)?.zone??null:null;
 const flags=openFlags(cards,now);
 const repeat=cards.find(c=>c.kind==='repeat'&&c.state==='open'&&now-Date.parse(c.at)<episodeMs);
 const pending=flags?{kind:'red_flags' as const,left:RED_FLAG_QUESTIONS.filter(q=>answersOn(flags)[q]===undefined).length}
  :zone==='red'?{kind:'call103' as const}:repeat?{kind:'repeat' as const}:null;
 if(!pending&&(zone===null||zone==='green'))return null;
 return {zone,pending};
}

export type ChipState='sent'|'seen_nurse'|'seen_doctor'|'answered';
type MemberTask={id:string;queue:'nurse'|'physician';status:'sent'|'seen'|'answered'|'closed';mergedIntoAlertId?:string};
/** Where the member's tasks stand. A task that could not be read yet still counts as sent: the flow saw it land. */
export function chipState(taskIds:readonly string[],tasks:readonly MemberTask[]):ChipState|null{
 if(!taskIds.length)return null;
 const mine=tasks.filter(t=>taskIds.includes(t.id));
 if(mine.some(t=>t.status==='answered'||(t.status==='closed'&&!t.mergedIntoAlertId)))return 'answered';
 const seen=mine.find(t=>t.status==='seen');
 return seen?seen.queue==='nurse'?'seen_nurse':'seen_doctor':'sent';
}

/** The tasks for the chip, beside the cards read. Switched off it makes no call at all. */
export async function memberTasks(rpc:()=>Promise<unknown>,env:Record<string,string|undefined>=process.env){
 if(!zoeAppV3Enabled(env))return undefined;
 try{
  const parsed=careQueueMemberTasksSchema.safeParse(await rpc());
  return parsed.success?parsed.data.tasks:undefined;
 }catch{return undefined;}
}


/** Preserve PostgreSQL microseconds when comparing an answer and a clear in the same millisecond. */
const micros=(at:string)=>Date.parse(at)*1000+Number((/\.(\d+)/.exec(at)?.[1]??'').padEnd(6,'0').slice(3,6));
export const emergencyWasCleared=(red:Pick<RedOutcome,'at'>,clearedAt:string|null|undefined)=>!!clearedAt&&micros(red.at)<=micros(clearedAt);

/** Paging and active emergencies are separate reads. Only an explicit clear after the answer can close it. */
export function withOpenEmergencies(cards:readonly ZoeCard[],open:readonly ZoeCard[],clearedAt?:string|null):ZoeCard[]{
 const byId=new Map([...cards,...open].map(c=>[c.id,c]));
 return [...byId.values()].map(c=>{
  const red=redOutcome(c);
  return red&&emergencyWasCleared(red,clearedAt)?{...c,outcome:{...c.outcome,emergencyCleared:true}}:c;
 });
}
