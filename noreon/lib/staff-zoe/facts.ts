import {taskTitle} from '@/lib/staff/real-coordination/task-copy';
import {AI_READ_LABEL} from '@/lib/lab-ai/provenance';
import {isUnverifiedBp,unverifiedBpLabel,bpObservationCounts} from '@/lib/patient/bp-provenance';
import type {DoctorFirstNote} from '@/lib/first-note/schema';
import {alertCardFields} from '@/lib/staff/alert-card';
import {st} from '@/lib/staff/staff-locale-copy';
import {taskStatusLabel} from '@/lib/staff/real-coordination/status-copy';
import {calendarDate} from '@/lib/staff/yerevan-time';
import {classifyScope} from '@/lib/zoe/scope';
import {planItems,planSnapshotSchema} from '@/lib/zoe/reply-draft';
import {assessLdl,formatMmol,type LdlGoal,type RawLdlObservation} from '@/lib/ldl/status';
import type {DoctorLdlOn} from '@/lib/ldl/schema';
import type {DoctorLdlResponse} from '@/lib/ldl/response-schema';
import {yerevanDate as yerevanDay,type BpWeekRead} from '@/lib/bp-week/model';
import {adherence,yerevanDate,type StaffMedicinesRead} from '@/lib/member-medicines/model';
import {MEDICINE_ASK_COPY} from '@/lib/member-medicines/ask-copy';
import type {DoctorConcern,StaffReason} from '@/lib/member-medicines/asks';
import type {DoctorUploadOverride} from '@/lib/staff/doctor-upload-overrides';
import type {StaffLabResults} from '@/lib/lab-ai/staff-results';
import {itemSummary,laneTitle,type DoctorInbox} from '@/lib/doctor-inbox/contracts';
import type {PlanVersion} from '@/lib/doctor-completion/version-schema';
import type {NurseVisitRecord} from '@/lib/nurse-visit/schema';
import type {CoordinationTask} from '@/lib/staff/real-coordination/schema';
import type {ClinicalSnapshot} from '@/lib/patient-care/clinical-case-repository';
import {analyteOf} from './analyte';
import {memberOrder} from './limits';
import type {BpPoint,Fact,FactMark,L,Quote,ToolId,ToolResult,ToolState} from './contracts';

/**
 * From what the audited reads returned to facts. Pure. Every derived value (a mean, a count, a percentage) is computed
 * here by code, so it exists in the tool output before the model sees it. Draft status is metadata only; clinical plan content
 * comes only from a publication, an inbox fact is the code's own one-line summary and never a reply draft, and the
 * LDL "next step" of a response record is left out (medicine suggestions are not in this phase).
 */
const memberHref=(id:string)=>`/staff/real/members/${id}`;
export const toolHref=(tool:ToolId,memberId:string,role:'doctor'|'nurse')=>tool==='member_messages'&&role==='doctor'?`/staff/real/conversations/${memberId}`:memberHref(memberId);
const dayOf=(at:string|null|undefined)=>at?yerevanDay(new Date(at)):null;

type Add=(label:string,value:string|number,date?:string|null,mark?:FactMark|null,href?:string|null,fileId?:string)=>void;
function collector(tool:ToolId){
 const facts:Fact[]=[];
 const add:Add=(label,value,date=null,mark=null,href=null,fileId)=>{const v=String(value).trim().slice(0,500);if(v)facts.push({id:`${tool}.${facts.length+1}`,label:label.slice(0,200),value:v,date,mark,href,analyte:analyteOf(label),...(fileId?{fileId}:{})});};
 return {facts,add};
}
export const emptyResult=(tool:ToolId,state:Exclude<ToolState,'ok'>,memberId:string,role:'doctor'|'nurse'):ToolResult=>({tool,state,facts:[],quotes:[],missing:[],href:toolHref(tool,memberId,role)});
const result=(tool:ToolId,facts:Fact[],memberId:string,role:'doctor'|'nurse',extra:{quotes?:Quote[];missing?:string[]}={}):ToolResult=>{
 const urgent=facts.filter(f=>f.urgent);
 // The ordinary card cap cannot remove an unresolved urgent alert.
 const kept=[...urgent,...facts.filter(f=>!f.urgent).slice(0,Math.max(0,40-urgent.length))];
 return {tool,state:kept.length||extra.quotes?.length?'ok':'none',facts:kept,quotes:extra.quotes??[],missing:extra.missing??[],href:toolHref(tool,memberId,role)};
};

type Ctx={memberId:string;role:'doctor'|'nurse';locale:L;now:Date};
const t=(c:Ctx,en:string,hy:string,ru:string)=>st(c.locale,en,hy,ru);
const yearsBetween=(birth:string,now:Date)=>{const b=new Date(`${birth}T00:00:00Z`);let y=now.getUTCFullYear()-b.getUTCFullYear();const m=now.getUTCMonth()-b.getUTCMonth();if(m<0||(m===0&&now.getUTCDate()<b.getUTCDate()))y--;return y;};

export function overviewResult(s:ClinicalSnapshot,c:Ctx):ToolResult{
 const {facts,add}=collector('overview');const e=s.evidence;
 if(e.profile.birthDate)add(t(c,'Age','Տարիք','Возраст'),yearsBetween(e.profile.birthDate,c.now));
 if(e.profile.biologicalSex)add(t(c,'Sex recorded','Գրանցված սեռ','Указанный пол'),e.profile.biologicalSex==='female'?t(c,'female','իգական','женский'):e.profile.biologicalSex==='male'?t(c,'male','արական','мужской'):e.profile.biologicalSex);
 const done=e.assessment?.completed_at??null;
 add(t(c,'Health questionnaire','Առողջության հարցաշար','Анкета здоровья'),done?t(c,'completed','լրացված է','заполнена'):t(c,'not completed','լրացված չէ','не заполнена'),dayOf(done));
 const missing=[...(e.profile.birthDate?[]:[t(c,'Date of birth not recorded','Ծննդյան ամսաթիվը գրանցված չէ','Дата рождения не указана')])];
 return result('overview',facts,c.memberId,c.role,{missing});
}

const mean=(xs:number[])=>Math.round(xs.reduce((a,b)=>a+b,0)/xs.length);
/** Two most recent BP weeks, including an empty week. No imputation or averaging. */
export function buildBpSeries(read:BpWeekRead|null):BpPoint[]{
 if(!read?.enabled)return [];
 return [...read.weeks].sort((a,b)=>b.startsOn.localeCompare(a.startsOn)).slice(0,2)
  .flatMap(w=>w.readings).filter(r=>!isUnverifiedBp(r)).filter(r=>Number.isFinite(Date.parse(r.measuredAt)))
  .map(r=>({measuredAt:new Date(r.measuredAt).toISOString(),systolic:r.systolic,diastolic:r.diastolic,...(r.slot?{slot:r.slot}:{})}))
  .sort((a,b)=>a.measuredAt.localeCompare(b.measuredAt));
}
export function bpResult(week:BpWeekRead|null,s:ClinicalSnapshot|null,c:Ctx):ToolResult{
 const {facts,add}=collector('bp');const missing:string[]=[];
 if(week?.enabled){
  const withReadings=week.weeks.map(w=>({...w,readings:w.readings.filter(r=>!isUnverifiedBp(r))})).filter(w=>w.readings.length).sort((a,b)=>b.startsOn.localeCompare(a.startsOn));
  const [cur,prev]=withReadings;
  if(cur){
   const last=[...cur.readings].sort((a,b)=>b.measuredAt.localeCompare(a.measuredAt))[0]!;
   const expected=cur.days*2*cur.readingsPerSlot;
   add(t(c,'Home BP week average','Տնային ճնշման շաբաթվա միջին','Среднее домашнее АД за неделю'),`${mean(cur.readings.map(r=>r.systolic))}/${mean(cur.readings.map(r=>r.diastolic))} mmHg`,dayOf(last.measuredAt),'member_reported');
   add(t(c,'Readings in that week, verified','Չափումներ այդ շաբաթում, ստուգված','Измерений за эту неделю, проверенных'),`${cur.readings.length} / ${expected}`,cur.startsOn);
   add(t(c,'Latest home reading','Վերջին տնային չափում','Последнее домашнее измерение'),`${last.systolic}/${last.diastolic} mmHg`,dayOf(last.measuredAt),'member_reported');
   if(cur.stoppedAt)add(t(c,'Week stopped early','Շաբաթը դադարեցվել է','Неделя прервана'),cur.stopReason??t(c,'no reason given','պատճառը նշված չէ','причина не указана'),dayOf(cur.stoppedAt));
   if(prev)add(t(c,'Previous week average','Նախորդ շաբաթվա միջին','Среднее за предыдущую неделю'),`${mean(prev.readings.map(r=>r.systolic))}/${mean(prev.readings.map(r=>r.diastolic))} mmHg`,prev.startsOn,'member_reported');
  }else if(week.weeks.some(w=>w.readings.some(isUnverifiedBp)))missing.push(t(c,'No verified home BP week readings; member reports are listed separately','Տնային ճնշման շաբաթվա ստուգված չափումներ չկան. անդամի հաղորդածը ներկայացված է առանձին','Нет проверенных измерений домашней недели АД; сообщения участника показаны отдельно'));
  else missing.push(t(c,'No structured home BP week recorded; individual readings are listed separately','Կառուցվածքային տնային ճնշման շաբաթ գրանցված չէ. առանձին չափումները ներկայացված են առանձին','Структурированная домашняя неделя АД не записана; отдельные измерения показаны отдельно'));
 }else missing.push(week?t(c,'Home BP weeks are switched off','Տնային ճնշման շաբաթները անջատված են','Домашние недели АД отключены'):t(c,'Home BP weeks could not be read','Տնային ճնշման շաբաթները չհաջողվեց կարդալ','Не удалось прочитать домашние недели АД'));
 const m=[...(s?.evidence.measurements??[])].sort((a,b)=>b.measured_at.localeCompare(a.measured_at));
 const verified=m.filter(r=>!isUnverifiedBp(r));
 const latest=verified[0];
 if(latest){
  add(t(c,'Latest verified BP','Վերջին ստուգված ճնշում','Последнее проверенное АД'),`${latest.systolic}/${latest.diastolic} mmHg`,dayOf(latest.measured_at));
  if(latest.pulse!==null)add(t(c,'Pulse with that reading','Զարկերակ այդ չափման ժամանակ','Пульс при этом измерении'),`${latest.pulse} bpm`,dayOf(latest.measured_at));
  add(t(c,'Verified BP readings','Ստուգված ճնշման չափումներ','Проверенных измерений АД'),verified.length,dayOf(latest.measured_at));
 }
 // Keep typed observations visible as safety evidence, separately from verified counts and trends.
 const typed=m.filter(isUnverifiedBp);
 const seen=new Set(m.map(r=>r.id));
 const weekExtra=week?.enabled?week.weeks.flatMap(w=>w.readings).filter(r=>{if(seen.has(r.id))return false;seen.add(r.id);return true;}):[];
 const weekTyped=weekExtra.filter(isUnverifiedBp);
 for(const r of typed.slice(0,6))add(unverifiedBpLabel(c.locale),`${r.systolic}/${r.diastolic} mmHg`,dayOf(r.measured_at),'member_reported');
 for(const r of weekTyped.slice(0,Math.max(0,6-typed.length)))add(unverifiedBpLabel(c.locale),`${r.systolic}/${r.diastolic} mmHg`,dayOf(r.measuredAt),'member_reported');
 if(typed.length||weekTyped.length)add(t(c,'BP observation counts','Ճնշման դիտարկումների քանակ','Количество наблюдений АД'),bpObservationCounts([...m,...weekExtra],c.locale));
 return {...result('bp',facts,c.memberId,c.role,{missing:facts.length?missing:[]}),bpSeries:buildBpSeries(week)};
}

/** Reviewed values first. A value the doctor has not reviewed is shown only marked as such. */
export function labsResult(r:StaffLabResults,c:Ctx,identityChecks:DoctorUploadOverride[]=[]):ToolResult{
 const {facts,add}=collector('labs');
 const docHref=(id:string)=>`${memberHref(c.memberId)}/documents/${id}/check`;
 const clinic=r.clinic.filter(f=>!identityChecks.some(check=>check.fileId===f.fileId)).flatMap(f=>f.values.filter(v=>v.status!=='rejected').map(v=>({v,f})));
 const reviewed=clinic.filter(x=>x.v.status==='verified'||x.v.status==='corrected'),open=clinic.filter(x=>!(x.v.status==='verified'||x.v.status==='corrected'));
 const on=(x:{collectedOn:string|null})=>x.collectedOn;
 const newest=<T extends {v:{testName:string;collectedOn:string|null}}>(rows:T[])=>{const seen=new Set<string>();return [...rows].sort((a,b)=>(b.v.collectedOn??'').localeCompare(a.v.collectedOn??'')).filter(x=>{const k=x.v.testName.toLowerCase();if(seen.has(k))return false;seen.add(k);return true;});};
 const flags:Record<string,[string,string,string]>={high:['high','բարձր','выше нормы'],low:['low','ցածր','ниже нормы'],abnormal:['abnormal','նորմայից դուրս','отклонение от нормы'],critical:['critical','կրիտիկական','критическое значение']};
 const flag=(f:string|null)=>f&&f!=='normal'?` (${flags[f]?three(c,flags[f]!):f})`:'';
 const text=(v:{valueText:string;value:number|null;unit:string|null;correctedValue?:number|null;correctedUnit?:string|null})=>v.correctedValue!=null?`${v.correctedValue} ${v.correctedUnit??v.unit??''}`.trim():v.value!==null?`${v.value} ${v.unit??''}`.trim():v.valueText;
 for(const {v,f} of newest(reviewed).slice(0,14))add(v.testName,`${text(v)}${v.refText?`, ${t(c,'range','միջակայք','норма')} ${v.refText}`:''}${flag(v.labFlag)}`,on(v),'reviewed',docHref(f.fileId),f.fileId);
 for(const {v,f} of newest(open).slice(0,8))add(v.status==='auto_accepted'?`${v.testName}, ${AI_READ_LABEL[c.locale]}`:unreviewed(c,v.testName),`${text(v)}${v.refText?`, ${t(c,'range','միջակայք','норма')} ${v.refText}`:''}${flag(v.labFlag)}`,on(v),'not_reviewed',docHref(f.fileId),f.fileId);
 const members=r.memberUploads.flatMap(d=>d.values.filter(v=>v.memberStatus==='confirmed'||v.memberStatus==='corrected').map(v=>({v:{...v,value:v.memberValue??v.value},d})));
 for(const {v} of newest(members).slice(0,6))add(v.testName,text(v),on(v),'member_reported');
 const missing=reviewed.length?[]:[t(c,'No doctor-reviewed lab values','Բժշկի կողմից վերանայված լաբորատոր արժեքներ չկան','Нет лабораторных значений, проверенных врачом')];
 return {...result('labs',facts,c.memberId,c.role,{missing:facts.length?missing:[]}),...(identityChecks.length?{state:'ok' as const,identityChecks}:{})};
}

const CATEGORY:Record<string,[string,string,string]>={very_high:['very high risk','շատ բարձր ռիսկ','очень высокий риск'],high:['high risk','բարձր ռիսկ','высокий риск'],moderate:['moderate risk','միջին ռիսկ','умеренный риск'],low:['low risk','ցածր ռիսկ','низкий риск']};
const EVENT:Record<string,[string,string,string]>={acs_mi:['Heart attack or acute coronary syndrome','Սրտի կաթված կամ սուր կորոնար համախտանիշ','Инфаркт или острый коронарный синдром'],haemorrhagic_stroke:['Haemorrhagic stroke','Հեմոռագիկ ինսուլտ','Геморрагический инсульт'],ischaemic_stroke:['Ischaemic stroke','Իշեմիկ ինսուլտ','Ишемический инсульт'],tia:['TIA','ԱԻՆ','ТИА'],other:['Other event','Այլ դեպք','Другое событие']};
const three=(c:Ctx,v:[string,string,string])=>t(c,v[0],v[1],v[2]);
/** The word itself in the line, so an unreviewed value is never read as a settled one, on screen or in the history. */
const unreviewed=(c:Ctx,label:string)=>`${label}, ${t(c,'unreviewed','չվերանայված','не проверено')}`;
export function ldlResult(d:DoctorLdlOn,responses:readonly DoctorLdlResponse[]|null,c:Ctx):ToolResult{
 const {facts,add}=collector('ldl');const missing:string[]=[];
 const goal=d.goals[0]??null;
 const assessed=assessLdl({goal:goal as LdlGoal|null,observations:d.observations as RawLdlObservation[]});
 const mmol=(v:number)=>`${formatMmol(v,goal?.thresholdMmol)} mmol/L`;
 for(const e of d.events.slice(0,3))add(t(c,'Index event','Ցուցիչ դեպք','Индексное событие'),e.type==='other'&&e.other?e.other:three(c,EVENT[e.type]!),e.on,null);
 if(!d.events.length)missing.push(t(c,'No index event recorded','Ցուցիչ դեպք գրանցված չէ','Индексное событие не записано'));
 const BASELINE:Record<string,[string,string,string]>={pre_treatment:['before treatment','մինչև բուժումը','до лечения'],on_treatment:['already on treatment','արդեն բուժման ընթացքում','уже на лечении']};
 const FROM:Record<string,[string,string,string]>={document:['from a document','փաստաթղթից','из документа'],lab_result:['from a lab result','լաբորատոր արդյունքից','из результата анализа'],doctor_entered:['entered by the doctor','մուտքագրել է բժիշկը','внесено врачом']};
 if(goal){
  add(t(c,'LDL goal','ՑԽԼ նպատակ','Цель по ЛПНП'),`< ${goal.thresholdMmol} mmol/L, ${three(c,CATEGORY[goal.category]!)}${goal.reductionRule&&goal.reductionPct!==null?`, ${t(c,'at least','առնվազն','не менее')} ${goal.reductionPct}% ${t(c,'reduction','նվազում','снижения')}`:''}`,dayOf(goal.setAt),'doctor_set');
  const b=goal.baseline;
  if(b.mmol!==null)add(t(c,'LDL baseline','ՑԽԼ ելակետ','Исходный ЛПНП'),[mmol(b.mmol),...(BASELINE[b.kind]?[three(c,BASELINE[b.kind]!)]:[]),...(b.source?[three(c,FROM[b.source]!)]:[])].join(', '),b.on);
  else add(t(c,'LDL baseline','ՑԽԼ ելակետ','Исходный ЛПНП'),t(c,'not known','հայտնի չէ','неизвестно'));
  if(goal.nextTestOn)add(t(c,'Next LDL test set for','Հաջորդ ՑԽԼ թեստը','Следующий анализ ЛПНП'),goal.nextTestOn,goal.nextTestOn);
 }else missing.push(t(c,'No LDL goal set','ՑԽԼ նպատակ սահմանված չէ','Цель по ЛПНП не задана'));
 if(assessed.latest)add(t(c,'Latest reviewed LDL','Վերջին վերանայված ՑԽԼ','Последний проверенный ЛПНП'),mmol(assessed.latest.mmol),assessed.latest.on,'reviewed');
 else missing.push(t(c,'No reviewed LDL value yet','Դեռ վերանայված ՑԽԼ արժեք չկա','Пока нет проверенного значения ЛПНП'));
 const counted=assessed.observations.filter(o=>o.counts),newer=(o:{on:string;mmol:number;counts:boolean})=>!o.counts&&(!assessed.latest||o.on>assessed.latest.on||(o.on===assessed.latest.on&&o.mmol!==assessed.latest.mmol));
 for(const o of counted.slice(0,-1).slice(-4).reverse())add(t(c,'Earlier reviewed LDL','Ավելի վաղ վերանայված ՑԽԼ','Ранее проверенный ЛПНП'),mmol(o.mmol),o.on,'reviewed');
 // Status is against reviewed values only. A newer value is its own line, by who it comes from, and never a status.
 const unseen=assessed.observations.filter(o=>newer(o)&&o.source!=='member').at(-1),typed=assessed.observations.filter(o=>newer(o)&&o.source==='member').at(-1);
 if(unseen)add(unreviewed(c,t(c,'Newest LDL','Ամենանոր ՑԽԼ','Новейший ЛПНП')),mmol(unseen.mmol),unseen.on,'not_reviewed');
 if(typed)add(t(c,'Newest LDL, not counted','Ամենանոր ՑԽԼ, չի հաշվարկվում','Новейший ЛПНП, не учитывается'),mmol(typed.mmol),typed.on,'member_reported');
 // Both parts of the goal, each on its own. No fact says "at goal": the clinicians have not approved that wording, and a
 // value under the threshold is not a met goal while a recorded reduction part is unmet or unknown (LDL errata, 30 Oct).
 if(goal&&assessed.latest)add(t(c,'Threshold part of the LDL goal','ՑԽԼ նպատակի շեմի մասը','Пороговая часть цели по ЛПНП'),`${mmol(assessed.latest.mmol)} ${assessed.latest.mmol<goal.thresholdMmol?t(c,'is below','ցածր է','ниже'):t(c,'is not below','ցածր չէ','не ниже')} ${goal.thresholdMmol} mmol/L`,assessed.latest.on);
 const r=assessed.reduction;
 if(r.state==='met'||r.state==='not_met')add(t(c,'Reduction part of the LDL goal','ՑԽԼ նպատակի նվազման մասը','Часть цели по снижению ЛПНП'),`${Math.floor(r.percent)}% ${t(c,'from baseline, at least','ելակետից, առնվազն','от исходного, не менее')} ${r.requiredPct}% ${t(c,'recorded','գրանցված','записано')}: ${r.state==='met'?t(c,'met','կատարված է','выполнено'):t(c,'not met','կատարված չէ','не выполнено')}`,assessed.latest?.on??null);
 // An unknown part is a line of its own, so the card and the answer can both show it plainly.
 if(r.state==='not_assessable')add(t(c,'Reduction part of the LDL goal','ՑԽԼ նպատակի նվազման մասը','Часть цели по снижению ЛПНП'),({baseline_unknown:t(c,'not known: no documented baseline before treatment','հայտնի չէ. մինչև բուժումը փաստաթղթավորված ելակետ չկա','неизвестно: нет документированного исходного значения до лечения'),on_treatment:t(c,'not known: the baseline was already on treatment','հայտնի չէ. ելակետն արդեն բուժման ընթացքում է','неизвестно: исходное значение уже на лечении'),no_later_value:t(c,'not known: no counted value after the baseline','հայտնի չէ. ելակետից հետո հաշվարկվող արժեք չկա','неизвестно: нет учитываемого значения после исходного')})[r.why]);
 for(const th of d.therapies.filter(x=>!x.endedAt).slice(0,4))add(t(c,'Lipid therapy','Լիպիդային բուժում','Липидная терапия'),`${th.drug==='other'?th.other??'':th.drug.replace('_',' ')} ${th.dose}`.trim(),th.startedOn,'doctor_set');
 for(const x of (d.loop?.retests??[]).filter(x=>x.state==='scheduled'||x.state==='requested').slice(0,2))add(t(c,'LDL re-test window','ՑԽԼ կրկնակի թեստի պատուհան','Окно повторного анализа ЛПНП'),`${calendarDate(x.dueFrom,c.locale)} – ${calendarDate(x.dueTo,c.locale)}${x.overdue?`, ${t(c,'overdue','ժամկետանց','просрочено')}`:''}`,x.dueTo);
 for(const x of (responses??[]).filter(x=>x.memberId===c.memberId).slice(0,2)){
  add(t(c,'Open LDL result','Բաց ՑԽԼ արդյունք','Открытый результат ЛПНП'),t(c,'waiting for review','սպասում է վերանայման','ожидает проверки'),x.observedOn);
  if(x.facts.adherence?.percent!=null)add(t(c,'Lipid medicine doses taken','Ընդունված լիպիդային դեղաչափեր','Принятые дозы липидных препаратов'),`${x.facts.adherence.percent}% (${x.facts.adherence.windowDays} ${t(c,'days','օր','дн.')})`,x.observedOn);
 }
 // Every line of the LDL record is about LDL, whatever its label says in any language.
 return result('ldl',facts.map(f=>({...f,analyte:'ldl_c'})),c.memberId,c.role,{missing});
}

export function planResult(s:ClinicalSnapshot,versions:readonly PlanVersion[]|null,c:Ctx):ToolResult{
 const publications=s.publications??[];
 // Missing nurse metadata still supports draft/none facts in an empty snapshot.
 if(versions===null&&(c.role==='doctor'||publications.length))return emptyResult('plan','unavailable',c.memberId,c.role);
 const knownVersions=versions??[];
 // These independent reads must describe the same plans before any clinical content is shown.
 if(knownVersions.length!==publications.length||new Set(publications.map(p=>p.planId)).size!==publications.length||publications.some(p=>{
  const rows=knownVersions.filter(v=>v.planId===p.planId);
  return rows.length!==1||Date.parse(rows[0]!.publishedAt)!==Date.parse(p.publishedAt);
 }))return emptyResult('plan','unavailable',c.memberId,c.role);
 const active=knownVersions.filter(v=>v.current);
 if(active.length>1)return emptyResult('plan','unavailable',c.memberId,c.role);
 const current=active[0]??null;
 const pub=current?publications.find(p=>p.planId===current.planId):undefined;
 if(current&&!pub)return emptyResult('plan','unavailable',c.memberId,c.role);
 const {facts,add}=collector('plan');
 const publishedAt=pub?.publishedAt??[...publications].sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt))[0]?.publishedAt;
 const hasPublished=!!pub;
 const hasDraft=!!s.draft&&(!publishedAt||!!s.draftSavedAt&&Date.parse(s.draftSavedAt)>Date.parse(publishedAt));
 if(hasPublished){
  add(t(c,'Published plan','Հրապարակված պլան','Опубликованный план'),current?`${t(c,'version','տարբերակ','версия')} ${current.version}`:t(c,'published','հրապարակված է','опубликован'),dayOf(publishedAt),'doctor_set');
  if(current?.changeSummary)add(t(c,'What changed in that version','Ինչ է փոխվել այդ տարբերակում','Что изменилось в этой версии'),current.changeSummary,dayOf(publishedAt),'doctor_set');
 }
 if(hasDraft){
  add(t(c,'Plan draft','Պլանի սևագիր','Черновик плана'),`${t(c,'Saved, not published','Պահպանված է, չի հրապարակվել','Сохранён, не опубликован')} · ${t(c,'record revision','գրառման տարբերակ','версия записи')} ${s.revision}`,dayOf(s.draftSavedAt),'doctor_set');
 }
 if(!hasPublished&&knownVersions.length)add(t(c,'Care plan','Խնամքի պլան','План ухода'),t(c,'No current published plan','Ընթացիկ հրապարակված պլան չկա','Нет действующего опубликованного плана'));
 else if(!hasPublished&&!hasDraft)add(t(c,'Care plan','Խնամքի պլան','План ухода'),t(c,'No care plan yet','Խնամքի պլան դեռ չկա','Плана ухода пока нет'));
 if(!pub)return result('plan',facts,c.memberId,c.role);
 const on=dayOf(pub.publishedAt);
 // A regimen keeps its medicines in a list and the one-medicine fields blank: each medicine is one fact, as the doctor wrote it.
 const {medicines,...draft}=pub.draft;
 const items=planItems(planSnapshotSchema.parse({planId:pub.planId,publishedAt:pub.publishedAt,...draft}));
 const kind:Record<string,[string,string,string]>={instruction:['Plan instruction','Պլանի հրահանգ','Указание плана'],explanation:['Plan explanation','Պլանի բացատրություն','Пояснение плана'],next_step:['Plan next step','Պլանի հաջորդ քայլ','Следующий шаг плана'],medicine:['Plan medicine','Պլանի դեղ','Препарат плана']};
 for(const m of medicines??[])add(three(c,kind.medicine!),[`${m.name} ${m.dose}`,m.times.join(', '),m.instructions].filter(Boolean).join(', '),on,'doctor_set');
 for(const i of [...items].sort((a,b)=>Number(b.kind==='medicine')-Number(a.kind==='medicine')).slice(0,12))add(three(c,kind[i.kind]!),i.text,on,'doctor_set');
 return result('plan',facts,c.memberId,c.role);
}

export function adherenceResult(m:StaffMedicinesRead&{enabled:true},reasons:readonly StaffReason[],concerns:readonly DoctorConcern[]|null,c:Ctx):ToolResult{
 const {facts,add}=collector('adherence');const days=m.days;
 const now=new Date(m.now);
 const row=(name:string,dose:string|null,a:{expected:number;taken:number;skipped:number;noReport:number},kind:string)=>
  add(`${name}${dose?` ${dose}`:''} (${kind})`,a.expected?`${a.taken} ${t(c,'taken','ընդունված','принято')}, ${a.skipped} ${t(c,'skipped','բաց թողնված','пропущено')}, ${a.noReport} ${t(c,'not reported','չի հաղորդվել','без отметки')} · ${t(c,'Expected doses','Սպասվող դեղաչափեր','Ожидаемые дозы')}: ${a.expected} ${t(c,'over','ընթացքում','за')} ${days} ${t(c,'days','օր','дн.')}`:t(c,'no dose due in the window','պատուհանում դեղաչափ չկար','в этот период доз не было'),yerevanDate(now),'member_reported');
 for(const p of m.plan.slice(0,6))row(p.name,p.dose,adherence(p,days,now),t(c,'plan','պլան','план'));
 for(const s of m.self.filter(x=>!x.stoppedAt).slice(0,6))row(s.name,s.dose,adherence(s,days,now),t(c,'self-reported','ինքնուրույն գրանցված','указано участником'));
 const reasonName=(r:StaffReason['reason'])=>MEDICINE_ASK_COPY[c.locale].reasons[r];
 const counts=new Map<string,number>();for(const r of reasons)counts.set(r.reason,(counts.get(r.reason)??0)+1);
 for(const [r,n] of counts)add(t(c,'Reason given for missed doses','Բաց թողնված դեղաչափերի պատճառ','Причина пропуска доз'),`${reasonName(r as StaffReason['reason'])}: ${n}`,reasons.find(x=>x.reason===r)?.answeredAt.slice(0,10)??null,'member_reported');
 const concernsCopy:Record<DoctorConcern['kind'],[string,string,string]>={side_effect:['side effect','կողմնակի ազդեցություն','побочный эффект'],decided_to_stop:['decided to stop','որոշել է դադարեցնել','решение прекратить приём'],refill:['refill','դեղի պաշարի լրացում','пополнение запаса препарата']};
 for(const x of (concerns??[]).filter(x=>x.memberId===c.memberId).slice(0,3))add(t(c,'Open medicine concern','Բաց դեղի մտահոգություն','Открытая проблема с препаратом'),`${x.ask.medicine.name}: ${three(c,concernsCopy[x.kind])}`,dayOf(x.createdAt),'member_reported');
 return result('adherence',facts,c.memberId,c.role);
}

const ACTIVE=new Set(['open','awaiting-member','awaiting-doctor']);
const INCOMPLETE_LABELS=new Set(['Alert list incomplete','Ահազանգերի ցանկն ամբողջական չէ','Список оповещений неполный']);
/** The urgent warning that the doctor's alert list was cut short. It is not an open alert of this member. */
export const isIncompleteAlertFact=(f:{label:string})=>INCOMPLETE_LABELS.has(f.label);
/** Only this member's items, even though the inbox read returns the doctor's whole list. Never a draft's text. */
export function openItemsResult(input:{inbox:DoctorInbox|null;tasks:readonly CoordinationTask[]|null;firstNote?:DoctorFirstNote|null},c:Ctx):ToolResult{
 const {facts,add}=collector('open_items');const missing:string[]=[];
 if(c.role==='doctor'){
  if(input.inbox){
   if(input.inbox.p0Total>input.inbox.p0.length){
    add(t(c,'Alert list incomplete','Ահազանգերի ցանկն ամբողջական չէ','Список оповещений неполный'),
     t(c,"Only part of the doctor's open alert list was read. Check Who needs me for this member.",'Կարդացվել է բժշկի բաց ահազանգերի ցանկի միայն մի մասը։ Այս անդամի համար ստուգեք «Ո՞ւմ է պետք իմ օգնությունը»։','Прочитана только часть списка открытых оповещений врача. Проверьте «Кому нужна моя помощь» для этого участника.'),null,null,'/staff/real/today');
    facts.at(-1)!.urgent=true;
   }
   // Preserve the full timestamp order before transcribing dates and Yerevan clock times.
   for(const a of input.inbox.p0.filter(x=>x.memberId===c.memberId&&x.alert.state!=='resolved').sort((a,b)=>Date.parse(b.at)-Date.parse(a.at))){
    const fields=alertCardFields(a.alert,c.locale);
    add(t(c,'Open urgent alert','Բաց շտապ ահազանգ','Открытое срочное оповещение'),fields.symptom,dayOf(a.at),null,'/staff/real/today');
    facts.at(-1)!.urgent=true;
    facts.at(-1)!.alertCard=fields;
   }
   for(const i of input.inbox.items.filter(x=>x.memberId===c.memberId))add(laneTitle(i.lane,c.locale),itemSummary(i,c.locale),dayOf(i.at),null,'/staff/real/today');
  }else missing.push(t(c,'The doctor inbox could not be read','Բժշկի մուտքայինը չհաջողվեց կարդալ','Не удалось прочитать входящие врача'));
  // The first note to the member waits for the doctor's approval until a plan is published. A failed read is never "nothing waiting".
  if(input.firstNote===null)missing.push(t(c,'The first note could not be read','Առաջին գրառումը չհաջողվեց կարդալ','Не удалось прочитать первое сообщение'));
  else if(input.firstNote?.enabled&&input.firstNote.completedAt&&!input.firstNote.planActive&&!input.firstNote.note&&input.firstNote.dueAt){
   const when=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Yerevan',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(input.firstNote.dueAt));
   add(t(c,'First note to the member','Առաջին գրառումն անդամին','Первое сообщение участнику'),t(c,`Waiting for your approval, approve by ${when}`,`Սպասում է ձեր հաստատմանը, հաստատել մինչև ${when}`,`Ждёт вашего утверждения, утвердить до ${when}`),dayOf(input.firstNote.dueAt),null,`/staff/real/members/${c.memberId}#first-note`);
  }
 }
 if(input.tasks){
  for(const x of input.tasks.filter(x=>x.caseId===c.memberId&&ACTIVE.has(x.status)).slice(0,8)){
   const title=taskTitle(x,c.locale);
   add(t(c,'Open task','Բաց առաջադրանք','Открытая задача'),`${title} (${c.locale==='en'?x.status:taskStatusLabel(c.locale,x.status)})`,dayOf(x.dueAt),null,'/staff/real/tasks');
  }
 }else missing.push(t(c,'Tasks could not be read','Առաջադրանքները չհաջողվեց կարդալ','Не удалось прочитать задачи'));
 const r=result('open_items',facts,c.memberId,c.role,{missing});
 return missing.length&&!facts.length?{...r,state:'unavailable'}:r;
}

export function visitsResult(r:Extract<NurseVisitRecord,{enabled:boolean}>,c:Ctx):ToolResult{
 if(!r.enabled)return emptyResult('visits','off',c.memberId,c.role);
 const {facts,add}=collector('visits');
 const modes:Record<string,[string,string,string]>={home:['home','տանը','на дому'],clinic:['clinic','կլինիկայում','в клинике'],office:['office','գրասենյակում','в офисе']};
 const statuses:Record<string,[string,string,string]>={confirmed:['confirmed','հաստատված','подтверждён'],completed:['completed','ավարտված','завершён'],attended:['attended','ներկայացել է','состоялся']};
 for(const v of r.visits.slice(0,4)){
  add(t(c,'Nurse visit','Բուժքրոջ այց','Визит медсестры'),`${three(c,modes[v.visit.mode]!)}, ${three(c,statuses[v.visit.bookingStatus]!)}`,dayOf(v.visit.startsAt));
  if(v.completion)add(t(c,'Visit completed by','Այցն ավարտել է','Визит завершила'),v.completion.nurseName,dayOf(v.completion.completedAt));
 }
 return result('visits',facts,c.memberId,c.role);
}

/** Member, nurse and Zoe words stay attributed quotes, never facts or a source for a number. */
export function messagesResult(messages:readonly {seq:number;text:string;at:string}[],c:Ctx,nurseReplies:readonly {text:string;at:string;senderName:string}[]=[],zoeReplies:readonly {id:string;answer:string|null;finishedAt:string}[]=[]):ToolResult{
 const flaggedCount=messages.filter(m=>classifyScope(m.text).injection||memberOrder(m.text)).length;
 const quotes:Quote[]=[...messages].sort((a,b)=>a.seq-b.seq).slice(-8).map((m,i)=>({id:`member_messages.${i+1}`,text:m.text.slice(0,1200),at:new Date(m.at).toISOString(),date:dayOf(m.at),flagged:classifyScope(m.text).injection||memberOrder(m.text)}));
 const {facts,add}=collector('member_messages');
 if(quotes.length)add(t(c,'Member messages read','Կարդացված հաղորդագրություններ','Прочитано сообщений участника'),quotes.length,quotes.at(-1)!.date);
 quotes.push(...[...nurseReplies].sort((a,b)=>a.at.localeCompare(b.at)).slice(-4).map((r,i)=>({id:`nurse_messages.${i+1}`,text:r.text.slice(0,1200),date:dayOf(r.at),flagged:classifyScope(r.text).injection,nurseName:r.senderName})));
 quotes.push(...[...zoeReplies].filter(r=>r.answer?.trim()).sort((a,b)=>Date.parse(b.finishedAt)-Date.parse(a.finishedAt)).slice(0,4).map((r,i)=>({id:`zoe_messages.${i+1}`,text:r.answer!.slice(0,1200),at:new Date(r.finishedAt).toISOString(),date:dayOf(r.finishedAt),flagged:classifyScope(r.answer!).injection,zoe:true as const})));
 return {...result('member_messages',facts,c.memberId,c.role,{quotes}),messageCount:messages.length,flaggedCount};
}
