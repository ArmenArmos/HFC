import {z} from 'zod';
import {zoeJobSchema,type ZoeJob,type FinishInput,type ZoeEvent,type RouteConfig} from '../pipeline';
import {runPipeline} from '../eval/harness';
import {ConversationState} from '../eval/conversation-state';
import {registeredSheets} from '../symptoms/intake';
import {memberRecordSchema} from '../member-record';
import {healthDataSchema} from '../health-answer';
import {healthProfileSchema} from '../topic';
import {zoeWhySchema,type ZoeWhy} from '../why';
import {practicePatient,PRACTICE_PATIENTS,type PracticeRecord} from './patients';
export const PRACTICE_VERSION=1;
export const MAX_PRACTICE_TURNS=40,MAX_PRACTICE_TEXT=4000,MAX_PRACTICE_BYTES=2_000_000;
export const practiceEditSchema=z.discriminatedUnion('kind',[
 z.strictObject({kind:z.literal('reading'),systolic:z.number().int().min(40).max(300),diastolic:z.number().int().min(20).max(200)}),
 z.strictObject({kind:z.literal('ldl'),mmol:z.number().min(0.1).max(30)}),
 z.strictObject({kind:z.literal('medicine'),name:z.string().trim().min(1).max(120),dose:z.string().trim().min(1).max(60)}),
 z.strictObject({kind:z.literal('sideEffect'),text:z.string().trim().min(1).max(1000).nullable()}),
]);
export type PracticeEdit=z.infer<typeof practiceEditSchema>;
export type PracticeTurn={id:string;seq:number;at:number;text:string;job:ZoeJob;record:PracticeRecord;finish:FinishInput;why:ZoeWhy|null;events:ZoeEvent[];config:{env:Record<string,string>;routing:RouteConfig|null}};
export type PracticeState={version:1;patientId:string;minute:number;record:PracticeRecord;turns:PracticeTurn[];edits:{at:number;edit:PracticeEdit}[]};
type HarnessOptions=NonNullable<Parameters<typeof runPipeline>[1]>;
export type PracticeDependencies=Pick<HarnessOptions,'routing'|'env'|'urgencyCheck'|'topicCheck'>&{provider:NonNullable<HarnessOptions['provider']>|null;judge:NonNullable<HarnessOptions['judge']>|null};
const recordSchema=z.strictObject({memberRecord:memberRecordSchema,health:healthDataSchema,profile:healthProfileSchema,reading:z.strictObject({systolic:z.number().int().min(40).max(300),diastolic:z.number().int().min(20).max(200),at:z.number().int().min(0)}).nullable(),sideEffect:z.string().max(1000).nullable()});
// Finish has no exported runtime schema. Limit JSON size and check fields consumed on replay;
// it never becomes a port, callback, database identifier or executable code.
const finishSchema=z.object({outcome:z.enum(['draft_proposed','draft_blocked','summary_only','discarded','no_output','answered','intake_asked','intake_completed','intake_escalated','chatted']),reason:z.string().max(200),answer:z.string().max(10000).nullable(),receipt:z.object({text:z.string().max(10000)}).nullable().optional(),events:z.array(z.object({name:z.string(),reason:z.string()}).passthrough()).max(300)}).passthrough();
const stateSchema=z.strictObject({version:z.literal(1),patientId:z.string(),minute:z.number().int().min(0).max(10000),record:recordSchema,turns:z.array(z.strictObject({id:z.uuid(),seq:z.number().int().min(1),at:z.number().int().min(0),text:z.string().min(1).max(MAX_PRACTICE_TEXT),job:zoeJobSchema,record:recordSchema,finish:finishSchema,why:zoeWhySchema.nullable(),events:z.array(z.unknown()).max(300),config:z.strictObject({env:z.record(z.string(),z.string().max(100)),routing:z.unknown().nullable()})})).max(MAX_PRACTICE_TURNS),edits:z.array(z.strictObject({at:z.number().int().min(0),edit:practiceEditSchema})).max(100)});
const identity=(patientId:string)=>{const i=PRACTICE_PATIENTS.findIndex(p=>p.id===patientId);if(i<0)throw new Error('Unknown fictional practice patient');return `00000000-0000-4000-9000-${String(i+1).padStart(12,'0')}`;};
const runId=(patientId:string,seq:number)=>`00000000-0000-4000-a000-${String((PRACTICE_PATIENTS.findIndex(p=>p.id===patientId)+1)*1000+seq).padStart(12,'0')}`;
export function validatePracticeState(input:unknown):PracticeState{
 const json=JSON.stringify(input);if(!json||json.length>MAX_PRACTICE_BYTES)throw new Error('Practice snapshot exceeds its limit');
 const s=stateSchema.parse(JSON.parse(json));const memberId=identity(s.patientId);
 for(const [i,t] of s.turns.entries()){
  if(t.seq!==i+1||t.at!==i+1||t.id!==runId(s.patientId,t.seq)||t.job.runId!==t.id||t.job.memberId!==memberId||t.job.messageSeq!==t.seq||!(t.job.messages.at(-1)?.text===t.text||t.job.messages.at(-1)?.text.endsWith(']\n'+t.text)))throw new Error('Invalid practice history identity');
 }
 if(s.minute!==s.turns.length||s.edits.some(e=>e.at>s.minute))throw new Error('Invalid practice chronology');
 return s as PracticeState;
}
export function startPractice(patientId:string):PracticeState{return {version:1,patientId:practicePatient(patientId).id,minute:0,record:practicePatient(patientId).record,turns:[],edits:[]};}
export function editPracticeRecord(input:PracticeState,change:PracticeEdit):PracticeState{
 const s=validatePracticeState(input),edit=practiceEditSchema.parse(change),r=s.record;
 if(s.edits.length>=100)throw new Error('Practice edit limit reached');
 if(edit.kind==='reading'){
  r.reading={systolic:edit.systolic,diastolic:edit.diastolic,at:s.minute};
  r.health.bpWeek={count:1,avgSystolic:edit.systolic,avgDiastolic:edit.diastolic,latest:{systolic:edit.systolic,diastolic:edit.diastolic,daysAgo:0}};
 }else if(edit.kind==='ldl'){
  r.memberRecord.ldl??={goal:null,latest:null,event:null,therapies:[],nextTestInDays:null};
  r.memberRecord.ldl.latest={mmol:edit.mmol,daysAgo:0};
  r.health.labs=[...r.health.labs.filter(l=>!/ldl/i.test(l.marker)),{marker:'LDL cholesterol',value:edit.mmol,unit:'mmol/L',low:null,high:null,daysAgo:0,reviewed:true}];
 }else if(edit.kind==='medicine'){
  r.memberRecord.ldl??={goal:null,latest:null,event:null,therapies:[],nextTestInDays:null};
  r.memberRecord.ldl.therapies=[{name:edit.name,dose:edit.dose,startedDaysAgo:0},...r.memberRecord.ldl.therapies.slice(1)];
  r.profile.medicines=[{name:edit.name,dose:edit.dose,times:['21:00'],sinceDays:0},...r.profile.medicines.slice(1)];
  if(r.health.plan){r.health.plan.medicationName=edit.name;r.health.plan.medicationDose=edit.dose;}
 }else r.sideEffect=edit.text;
 s.edits.push({at:s.minute,edit});return s;
}
export function practiceJob(input:PracticeState,text:string):ZoeJob{
 const s=validatePracticeState(input);text=z.string().trim().min(1).max(MAX_PRACTICE_TEXT).parse(text);
 if(s.turns.length>=MAX_PRACTICE_TURNS)throw new Error('Practice turn limit reached. Start a new conversation.');
 const at=s.minute+1,seq=s.turns.length+1,p=practicePatient(s.patientId),reading=s.record.reading;
 const conversation=new ConversationState(reading?{...reading,minutesAgo:at-reading.at}:null,at);
 const stored=conversation.reading;
 if(stored)stored.version=String(1+s.edits.filter(e=>e.edit.kind==='reading').length);
 const current=stored?{...stored}:null;
 const epoch=Date.parse('2026-10-30T12:00:00Z');
 for(const t of s.turns){
  // Replay with the reading identity seen by that run; a later reading is a new version.
  const old=t.job.memberClear;
  if(stored&&old?.readingVersion){stored.version=old.readingVersion;stored.id=old.readingId??stored.id;stored.savedAt=old.readingSavedAt?(Date.parse(old.readingSavedAt)-epoch)/60000:t.at;stored.measuredAt=old.readingMeasuredAt?(Date.parse(old.readingMeasuredAt)-epoch)/60000:t.at;}
  conversation.finish(t.seq,t.at,t.at,t.finish);
 }
 if(stored&&current)Object.assign(stored,current);
 const last=s.turns.at(-1),active=last?.finish.intake?.state==='active'?last.finish.intake:null;
 const job:ZoeJob={runId:runId(s.patientId,seq),memberId:identity(s.patientId),messageSeq:seq,displayName:p.name,
  messages:[...(p.earlierConversation??[]).flatMap((t,i)=>t.role==='member'?[{seq:i-(p.earlierConversation?.length??0),text:t.text,minutesAgo:at+30-i}]:[]),...s.turns.map(t=>({seq:t.seq,text:t.text,minutesAgo:at-t.at})),{seq,text,minutesAgo:0}],
  answers:[...(p.earlierConversation??[]).flatMap((t,i)=>t.role==='zoe'?[{body:t.text,minutesAgo:at+30-i}]:[]),...s.turns.flatMap(t=>{const body=t.finish.answer??t.finish.receipt?.text;return body?[{body,minutesAgo:at-t.at}]:[];})],replies:[],directAnswers:true,healthAnswers:true,doctorMode:false,...conversation.context(at),
  conversation:{enabled:true,doctorName:null,answeredThroughSeq:seq-1,memberSpentTodayUsd:s.turns.reduce((n,t)=>n+(t.finish.costUsd??0),0),injectionsLast24h:0,locale:p.locale},
  intake:{enabled:true,registered:registeredSheets(),active:active?{id:active.id??runId(s.patientId,active.startedSeq),sheetId:active.sheetId,sheetVersion:active.sheetVersion,startedSeq:active.startedSeq,language:active.language,record:active.record}:null,doctorName:null,latestReading:conversation.latestReading(at),redFlagsAfterSeq:seq-1,resumable:null},
  health:s.record.health,memberRecord:s.record.memberRecord,topic:{breakAfterSeq:null,startSeq:last?.finish.topic?.startSeq??null,zoeOwns:true,profile:s.record.profile}};
 // A record edit is explicitly labelled member-reported context, never a hidden instruction.
 if(s.record.sideEffect)job.messages[0]={...job.messages[0]!,text:`[Fictional practice record: reported side effect: ${s.record.sideEffect}]\n${job.messages[0]!.text}`};
 return zoeJobSchema.parse(job);
}
export async function runPracticeTurn(input:PracticeState,text:string,deps:PracticeDependencies):Promise<PracticeState>{
 if(!Object.hasOwn(deps,'provider')||!Object.hasOwn(deps,'judge'))throw new Error('Practice provider and judge must be explicit');
 const state=validatePracticeState(input),job=practiceJob(state,text),why={records:[] as ZoeWhy[]};
 // All storage ports belong to runPipeline's in-memory harness. Callers cannot inject ports.
 const result=await runPipeline(job,{provider:deps.provider,judge:deps.judge,routing:deps.routing,urgencyCheck:deps.urgencyCheck,topicCheck:deps.topicCheck,env:{NOREON_ZOE_TEST_LEXICON:'false',...deps.env},directAnswers:true,allowRemote:true,why});
 if(!result.finish)throw new Error('Practice pipeline did not finish');
 state.minute++;state.turns.push({id:job.runId,seq:job.messageSeq,at:state.minute,text:text.trim(),job,record:structuredClone(state.record),finish:result.finish,why:why.records.at(-1)??null,events:result.events,config:{env:safePracticeEnv({NOREON_ZOE_TEST_LEXICON:'false',...deps.env}),routing:deps.routing?.config??null}});
 return validatePracticeState(state);
}

const ENV_KEYS=['NOREON_ZOE_MEMBER_CLEAR','NOREON_ZOE_URGENT_PLACEHOLDER','NOREON_ZOE_TEST_LEXICON','NOREON_ZOE_EMERGENCY_CARD','NOREON_ZOE_FREE_FAST','NOREON_ZOE_FREE_REPLY_EFFORT','NOREON_ZOE_FREE_SPLIT','NOREON_ZOE_FREE_STYLE','NOREON_ZOE_JUDGE_EFFORT','NOREON_ZOE_JUDGE_TIER','NOREON_ZOE_LDL_TARGET','NOREON_ZOE_SUMMARY_EFFORT','NOREON_ZOE_SUMMARY_TIER','NOREON_ZOE_TOPIC_SCOPE','NOREON_ZOE_WHY'] as const;
export function safePracticeEnv(env:Record<string,string|undefined>):Record<string,string>{return Object.fromEntries(ENV_KEYS.flatMap(k=>env[k]===undefined?[]:[[k,env[k]!] ]));}
