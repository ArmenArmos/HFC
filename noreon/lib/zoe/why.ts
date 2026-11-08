import {alarmTriggerSchema} from './alarm-conversation';
import {z} from 'zod';
import {URGENCY_LEVELS,type Forward,type ForwardReason,type HealthData,type Urgency} from './health-answer';
import type {MemberRecord} from './member-record';
import type {HealthProfile} from './topic';

/**
 * Zoe's why record (Khikar 30 Oct: "I need zoe later to be able to answer to a doctor on the question WHY"). One structured
 * snapshot per run, written once after the run finished (zoe_run_why_record) and read by staff only (zoe_run_why): the level,
 * the signs behind it, the member data with source and date, what was unknown or doubtful, the rules and versions that applied,
 * why the doctor was or was not suggested, and the model and prompt versions.
 *
 * It is generated rationale, not the model's hidden thinking and never a doctor's reasoning. Most of it comes from the code
 * (buildZoeWhy), so a fixed rule's record has no model in it at all. On a health answer the doctor-summary call adds a short
 * rationale (modelWhy): the reply prompt, the judge and the reply's own call are untouched by it. A rationale that is late,
 * malformed or held by the guard never touches the answer; the record says so (rationale.status 'missing').
 *
 * Member text is data here too: the rationale is untrusted model output. Whoever reads it (staff Zoe later) quotes it, never follows it.
 *
 * Off with NOREON_ZOE_WHY=off: the model's rationale is not asked for (the summary prompt as before); the code's record stays.
 */
export const ZOE_WHY_VERSION='zoe-why-1';
export const zoeWhyModelOn=(env:Record<string,string|undefined>)=>(env.NOREON_ZOE_WHY??'').trim().toLowerCase()!=='off';

const code=z.string().max(120);
const phrase=(max:number)=>z.string().min(1).max(max);
const level=z.enum(URGENCY_LEVELS);
const by=z.enum(['rule','model']);
const DATA_SOURCES=['home_bp','lab_result','published_plan','health_profile','member_messages','stored_reading','member_record']as const;
/** The record as stored. Readers strip unknown keys, so a newer record still reads in an older build. */
export const zoeWhySchema=z.object({
 v:z.literal(1),version:code,at:z.string(),alarm:alarmTriggerSchema.optional(),
 /** 'rule': no model call answered in this run. */
 decidedBy:by,
 /** What Zoe decided. The run's final outcome (a hold in doctor mode, a newer message) comes with the read. */
 reply:z.object({kind:z.enum(['answer','draft','line','none']),words:z.enum(['fixed','model','none']),outcome:code,reason:code,language:z.enum(['en','hy','ru']).nullable()}),
 /** Null: this path does not grade urgency. A missing level is not "none". */
 level:z.object({final:level.nullable(),model:level.nullable()}),
 signs:z.array(z.object({text:phrase(200),from:by})).max(12),
 data:z.array(z.object({key:code,source:z.enum(DATA_SOURCES),date:z.string().nullable(),value:z.string().max(200).nullable(),reviewed:z.boolean().nullable(),relied:z.boolean().nullable()})).max(24),
 doubts:z.array(z.object({text:phrase(200),from:by})).max(12),
 rules:z.array(z.object({rule:code,version:code,outcome:code,reason:code})).max(30),
 doctor:z.object({suggested:z.boolean(),how:z.enum(['none','asked','auto','member_yes','member_request','draft','summary','care_alert']),reason:code.nullable(),why:z.string().max(300).nullable()}),
 models:z.object({provider:code,model:code,tier:code,fallbackUsed:z.boolean(),rationaleModel:code.nullable(),prompt:code.nullable(),config:z.string().max(400)}),
 rationale:z.object({status:z.enum(['written','not_asked','missing']),missing:code.nullable(),aboutHeldText:z.boolean()}),
});
export type ZoeWhy=z.infer<typeof zoeWhySchema>;
export type WhyDatum=ZoeWhy['data'][number];

// -------------------------------------------------------------------------------------------------
// The member data a run had, snapshotted with source and date

const daysBefore=(now:Date,days:number)=>new Date(now.getTime()-days*86_400_000).toISOString().slice(0,10);
const datum=(key:string,source:WhyDatum['source'],date:string|null,value:string|null,reviewed:boolean|null=null):WhyDatum=>({key,source,date,value:value?.slice(0,200)??null,reviewed,relied:null});
/** The member record as the model saw it (member-record.ts): the goal number only when it was in the model's input. */
function recordData(r:MemberRecord,target:boolean,now:Date):WhyDatum[]{
 const today=now.toISOString().slice(0,10),l=r.ldl,out:WhyDatum[]=[];
 if(r.ageYears!==null)out.push(datum('age','member_record',today,`age ${r.ageYears}`));
 if(r.doses)out.push(datum('doses','member_record',today,`${r.doses.taken} of ${r.doses.expected} doses marked taken in ${r.doses.days} days, ${r.doses.skipped} marked skipped`));
 if(l?.latest)out.push(datum('ldl_latest','member_record',daysBefore(now,l.latest.daysAgo),`LDL ${l.latest.mmol} mmol/L`,true));
 const rest=l?[...(l.event?[`heart event on record: ${l.event.type}`]:[]),...l.therapies.map(t=>`lipid therapy ${t.name} ${t.dose}`),...(l.goal?[`goal set by the doctor${target?` at below ${l.goal.thresholdMmol} mmol/L`:''}`]:[]),...(l.nextTestInDays!==null?[`next LDL test ${l.nextTestInDays>=0?`in ${l.nextTestInDays} days`:`was due ${-l.nextTestInDays} days ago`}`]:[])]:[];
 if(rest.length)out.push(datum('ldl_record','member_record',today,rest.join('; ')));
 return out;
}
/** Values, not references: the record must read the same after the data changes. No names: the plan's and the profile's text stays out. */
export function whyData(d:{messages:readonly {seq:number}[];health?:HealthData|null;profile?:HealthProfile|null;reading?:{systolic:number;diastolic:number;minutesAgo:number}|null;planPublishedAt?:string|null;record?:MemberRecord|null;recordTarget?:boolean},now:Date):WhyDatum[]{
 const out:WhyDatum[]=[];const seqs=d.messages.map(m=>m.seq);
 if(seqs.length)out.push(datum('messages','member_messages',now.toISOString().slice(0,10),`messages ${Math.min(...seqs)} to ${Math.max(...seqs)}`));
 const b=d.health?.bpWeek;
 if(b)out.push(datum('bp_week','home_bp',daysBefore(now,b.latest.daysAgo),`${b.count} home readings in 7 days, average ${b.avgSystolic}/${b.avgDiastolic} mmHg, latest ${b.latest.systolic}/${b.latest.diastolic} mmHg`,false));
 if(d.record)out.push(...recordData(d.record,!!d.recordTarget,now));
 (d.health?.labs??[]).slice(0,16).forEach((l,i)=>out.push(datum(`lab${i+1}`,'lab_result',daysBefore(now,l.daysAgo),`${l.marker} ${l.value} ${l.unit}`,l.reviewed)));
 const p=d.health?.plan;
 if(p)out.push(datum('care_plan','published_plan',daysBefore(now,p.publishedDaysAgo),p.medicationName.trim()?`published care plan, medicine ${p.medicationName.trim()}`:'published care plan',true));
 else if(d.planPublishedAt)out.push(datum('care_plan','published_plan',d.planPublishedAt.slice(0,10),'published care plan',true));
 if(d.profile)out.push(datum('health_profile','health_profile',null,`${d.profile.conditions.length} conditions and ${d.profile.medicines.length} medicines the member reported`));
 if(d.reading)out.push(datum('latest_reading','stored_reading',daysBefore(now,Math.floor(d.reading.minutesAgo/1440)),`${d.reading.systolic}/${d.reading.diastolic} mmHg`));
 return out;
}
/** What the code itself knows was missing or unreviewed. */
export function whyDataDoubts(data:readonly WhyDatum[],health:HealthData|null|undefined):string[]{
 if(health===undefined)return [];
 return [...(data.some(d=>d.source==='home_bp')?[]:['No home blood pressure readings in the last 7 days.']),
  ...(health?.labs.length?[]:['No lab results available to Zoe.']),
  ...(health?.plan?[]:['No published care plan.']),
  ...data.filter(d=>d.source==='lab_result'&&d.reviewed===false).map(d=>`Not yet reviewed by the doctor: ${d.value??d.key}.`)];
}
const esc=(t:string)=>t.replace(/[\u0000-\u001F\u007F‪-‮⁦-⁩]/gu,' ').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
/** The summary call's list of sources: a rationale cites these keys, so it can only point at data the run really had. */
export const whySourcesBlock=(data:readonly WhyDatum[])=>`<why_sources>\n${data.map(d=>`<source key="${d.key}">${esc(d.value??d.source)}</source>`).join('\n')}\n</why_sources>`;

// -------------------------------------------------------------------------------------------------
// The model's short rationale, from the doctor-summary call

const cut=(max:number,items:number)=>z.preprocess(v=>Array.isArray(v)?v.slice(0,items):v,z.array(z.string().min(1).transform(x=>x.slice(0,max))));
const modelWhySchema=z.object({signs:cut(200,5),data_used:cut(40,12).default([]),doubts:cut(200,4).default([]),doctor:z.string().min(1).transform(x=>x.slice(0,300))});
export type ModelWhy=z.infer<typeof modelWhySchema>;
/** The balanced {...} that opens at `from`. The summary model sometimes closes its object early and goes on, so the outermost braces do not parse. */
export function balancedObject(raw:string,from:number){
 let depth=0,str=false,esc=false;
 for(let i=from;i<raw.length;i++){const c=raw[i];
  if(str){if(esc)esc=false;else if(c==='\\')esc=true;else if(c==='"')str=false;continue;}
  if(c==='"')str=true;else if(c==='{')depth++;else if(c==='}'&&--depth===0)return raw.slice(from,i+1);}
 return null;
}
/** The rationale in the summary call's text, null when there is none or it does not parse; the doctor's summary is read apart from it. */
export function readModelWhy(raw:string):ModelWhy|null{
 const read=(t:string|null)=>{if(t===null)return null;try{const j=JSON.parse(t) as {why?:unknown;summary?:{why?:unknown}};const p=modelWhySchema.safeParse(j?.why??j?.summary?.why);return p.success?p.data:null;}catch{return null;}};
 const i=raw.indexOf('{'),j=raw.lastIndexOf('}'),k=raw.search(/"why"\s*:\s*\{/u);
 return read(raw)??(i>=0&&j>i?read(raw.slice(i,j+1)):null)??(k>=0?read(`{"why":${balancedObject(raw,raw.indexOf('{',k))}}`):null);
}

// -------------------------------------------------------------------------------------------------
// The record

type WhyEvent={name:string;outcome:string;reason:string;rule:string;ruleVersion:string;attributes:Record<string,string|number|boolean>};
export type WhyInput={at:Date;outcome:string;reason:string;answer:string|null;draft:string|null;receipt:{text:string}|null;language:'en'|'hy'|'ru'|null;
 /** Who wrote the member text, on the paths that know. */modelWords:boolean;
 health:{urgency:Urgency;modelUrgency:Urgency;forward:Forward;forwardReason:ForwardReason}|null;toDoctor:boolean;events:readonly WhyEvent[];
 provider:string;model:string;tier:string;fallbackUsed:boolean;config:string;prompt:string|null;data:readonly WhyDatum[];doubts:readonly string[];
 /** The rationale: asked for on this run or not, and what came back. */rationale:{asked:boolean;why:ModelWhy|null;model:string|null;missing:string|null}};

const URGENT_REASON=/^urgent|red_flag/u;
const ruleSigns=(events:readonly WhyEvent[])=>[...new Set(events.filter(e=>e.outcome==='escalate').flatMap(e=>{
 const codes=[e.attributes['noreon.zoe.urgent.red_flags'],e.attributes['noreon.zoe.red_flags.hits']].flatMap(x=>typeof x==='string'&&x!=='none'?x.split(',').filter(Boolean):[]);
 return codes.length?codes.map(c=>`${c} (${e.rule})`):[`${e.reason.replaceAll('_',' ')} (${e.rule})`];}))];
const STAGING_REASONS=new Set(['urgent_words_matched_staging_list','no_staging_list_words']);
const listDoubts=(events:readonly WhyEvent[])=>events.some(e=>STAGING_REASONS.has(e.reason))?['The urgent word check used the staging list, not the signed clinical list.']:[];

/** Everything here comes from the run itself, so it needs no model and cannot fail on a model's output. */
export function buildZoeWhy(i:WhyInput):ZoeWhy{
 const urgentRoute=URGENT_REASON.test(i.reason)||i.outcome==='intake_escalated';
 const final:Urgency|null=i.health?.urgency??(urgentRoute?'emergency':null);
 const wording=i.answer||i.receipt||i.draft?(i.modelWords||!!i.draft?'model':'fixed'):'none';
 const how=i.health&&i.health.forward!=='none'?i.health.forward:i.draft?'draft':urgentRoute&&final==='emergency'?'care_alert':i.toDoctor?'summary':'none';
 const used=new Set(i.rationale.why?.data_used??[]);
 const rationaleOn=!!i.rationale.why;
 return {v:1,version:ZOE_WHY_VERSION,at:i.at.toISOString(),
  decidedBy:i.events.some(e=>e.name==='zoe.provider.call'&&e.outcome==='allow')?'model':'rule',
  reply:{kind:i.answer?'answer':i.draft?'draft':i.receipt?'line':'none',words:wording,outcome:i.outcome,reason:i.reason,language:i.language},
  level:{final,model:i.health&&i.health.modelUrgency!=='none'?i.health.modelUrgency:null},
  signs:[...ruleSigns(i.events).slice(0,7).map(text=>({text:text.slice(0,200),from:'rule'as const})),...(i.rationale.why?.signs??[]).map(text=>({text,from:'model'as const}))],
  data:i.data.map(d=>({...d,relied:rationaleOn?used.has(d.key):null})).slice(0,24),
  doubts:[...[...i.doubts,...listDoubts(i.events)].slice(0,8).map(text=>({text:text.slice(0,200),from:'rule'as const})),...(i.rationale.why?.doubts??[]).map(text=>({text,from:'model'as const}))],
  rules:[...new Map(i.events.map(e=>[`${e.rule}|${e.reason}`,{rule:e.rule.slice(0,120),version:e.ruleVersion.slice(0,120),outcome:e.outcome,reason:e.reason.slice(0,120)}])).values()].slice(0,30),
  doctor:{suggested:how!=='none',how,reason:i.health&&i.health.forwardReason!=='none'?i.health.forwardReason:how==='none'?null:i.reason.slice(0,120),why:i.rationale.why?.doctor??null},
  models:{provider:i.provider,model:i.model,tier:i.tier,fallbackUsed:i.fallbackUsed,rationaleModel:i.rationale.why?i.rationale.model:null,prompt:i.prompt,config:i.config.slice(0,400)},
  rationale:{status:i.rationale.why?'written':i.rationale.asked?'missing':'not_asked',missing:i.rationale.why?null:i.rationale.missing,aboutHeldText:!!i.rationale.why&&!i.modelWords}};
}

// -------------------------------------------------------------------------------------------------
// Reading it: one wording for the trace screen and, later, for staff Zoe's answer to "why did you say this?"

const words=(c:string|null)=>c?c.replaceAll('_',' '):'not known';
const fromText=(from:'rule'|'model')=>from==='rule'?'fixed rule':'AI';
const dataLine=(d:WhyDatum)=>`${d.value??d.key}${d.date?`, ${d.date}`:''}${d.reviewed===false&&d.source==='lab_result'?', not reviewed':''}${d.relied?' (Zoe relied on this)':''}`;
const DOCTOR_HOW:Record<ZoeWhy['doctor']['how'],string>={none:'Not suggested.',asked:'Zoe asked the member whether to send it.',auto:'Sent automatically.',member_yes:'Sent, the member said yes.',member_request:'Sent, the member asked.',
 draft:'Zoe prepared a draft for the doctor to approve.',summary:'Zoe sent the doctor a summary.',care_alert:'Care alert raised for the care team.'};
/** The saved record as labelled lines. Nothing is computed from current data, so the answer stays what was saved. */
export function zoeWhySections(w:ZoeWhy):{title:string;lines:string[]}[]{
 const none='Nothing recorded.';
 return [
  {title:'Decided by',lines:[w.decidedBy==='rule'?'Fixed rules, no AI model answered.':'AI model within the fixed rules.',`Outcome decided: ${words(w.reply.reason)}. Member text: ${w.reply.words==='model'?'AI wording':w.reply.words==='fixed'?'fixed wording':'none'}.`]},
  {title:'Level',lines:[w.level.final?`${words(w.level.final)}${w.level.model&&w.level.model!==w.level.final?` (the AI model chose ${words(w.level.model)})`:''}`:'Not graded on this path.']},
  {title:'Signs that led to it',lines:w.signs.length?w.signs.map(s=>`${s.text} (${fromText(s.from)})`):[none]},
  {title:'Member data, as it was then',lines:w.data.length?w.data.map(dataLine):[none]},
  {title:'Unknown or doubtful',lines:w.doubts.length?w.doubts.map(s=>`${s.text} (${fromText(s.from)})`):[none]},
  {title:'The doctor',lines:[DOCTOR_HOW[w.doctor.how]+(w.doctor.reason?` Reason: ${words(w.doctor.reason)}.`:''),...(w.doctor.why?[`${w.doctor.why} (AI)`]:[])]},
  {title:'Rules and versions',lines:w.rules.length?w.rules.map(r=>`${r.rule} ${r.version}: ${words(r.reason)}`):[none]},
  {title:'Model and prompt',lines:[`${w.models.provider} ${w.models.model}, tier ${w.models.tier}${w.models.fallbackUsed?', fallback used':''}`,...(w.models.prompt?[`Prompt ${w.models.prompt}`]:[]),...(w.models.rationaleModel?[`Rationale by ${w.models.rationaleModel}`]:[]),`Record ${w.version}`]},
  {title:'AI rationale',lines:[w.rationale.status==='written'?(w.rationale.aboutHeldText?'Written for a text that was held and not sent.':'Written after the reply, not the model\'s hidden thinking.'):w.rationale.status==='missing'?`Missing: ${words(w.rationale.missing)}.`:'Not asked for on this path.']},
 ];
}
