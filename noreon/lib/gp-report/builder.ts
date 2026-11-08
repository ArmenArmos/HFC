import {z} from 'zod';
import {ALGORITHM_VERSION,CONSULTATION_WINDOW,URGENCY_LABEL,consultationWindow,evaluate,needsAttention,requiredTests} from '@/lib/clinical/rules/engine';
import {THRESHOLD,firesEmergency} from '@/lib/clinical/rules/rules';
import {activityBand,bloodPressureBand,bmi,bmiBand,modifiers,packYears,score2State} from '@/lib/clinical/rules/derived';
import {fieldById} from '@/lib/clinical/seed/questions';
import {assessmentProgress,pruneAnswers} from '@/lib/patient/questionnaire';
import {ageOn} from '@/lib/patient/validation';
import type {Answers,Decision,Localized} from '@/lib/clinical/types';
import type {GpReportSource,GpReportVersionMeta} from './schema';
import {analyteByKey} from '@/lib/lab-ai/catalogue';
import {cat,day,dayRange,dayTime,join,l,time,yerevanDate,type L} from './format';
import {pastReadings} from '@/lib/patient/measured-at';
import {assessmentFromSource,resultsInputFromSource,resultsRows} from './results';
import type {ResultsAssessment} from '@/lib/clinical/rules/results-assessment';
import {categoryCopy,gateCopy,score2ReasonCopy} from './results-copy';

/**
 * The GP report for template NRN-GP-REP-001 v1.0, built only from stored rows and the
 * existing clinical engine (NRN-CLIN-ALG-001 v1.1). Rules this file keeps:
 * - every value carries its source tag and date;
 * - a missing value is "Not available" with the reason, never a negative or a normal;
 * - priority comes from care-team alerts, the questionnaire urgent rule and the engine,
 *   red first; no threshold is added here (the crisis hold reuses THRESHOLD);
 * - Phase 2 results are opt-in; stage and treatment remain unavailable.
 */
export const TEMPLATE_VERSION='NRN-GP-REP-001 v1.0';
export type Row=[L,L,L];
export type PriorityLevel='emergency'|'cannot-assess'|'orange'|'yellow'|'green';
export type GpReport={
 kind:'noreon-gp-report';templateVersion:string;algorithmVersion:string;memberId:string;sourceToken:string;builtAt:string;
 reportRef:string;nextVersion:number;previous:{version:number;approvedAt:string}|null;
 patientLine:L;/** Generated time, cut-off and trigger; the version is added when rendered. */
 reportLine:L;priorityLevel:PriorityLevel;priority:L;assessment:L;
 bp:{rows:Row[];note:L};history:L;risk:L;meds:{rows:Row[];note:L};labs:{rows:Row[];note:L};ecg:L;
 proposals:Row[];followUp:L;sources:L;gaps:{section:string;field:string;reason:L}[];
 results?:{assessment:ResultsAssessment;rows:Row[];gaps:L[]};
};
export type BuildInput={memberId:string;token:string;readAt:string;source:GpReportSource;versions:GpReportVersionMeta[];resultsAssessment?:boolean};

const POST_TEST=l('post-test decision rules (C1 to C16) are pending clinical sign-off','թեստերից հետո որոշման կանոնները (C1–C16) սպասում են կլինիկական հաստատման');
const answerSchema=z.object({fieldId:z.string(),value:z.union([z.string(),z.number().finite(),z.boolean(),z.array(z.string())]),source:z.enum(['manual','voice','presenter']),answeredAt:z.string()}).passthrough();
const loc=(x:Localized):L=>l(x.en??x.hy,x.hy);
const mean=(xs:number[])=>Math.round(xs.reduce((a,b)=>a+b,0)/xs.length);
const plural=(n:number,en:string,ens:string)=>`${n} ${n===1?en:ens}`;

type Reading={id:string;systolic:number;diastolic:number;pulse:number|null;measuredAt:string;kind:'device'|'app'|'clinic'};

export function buildGpReport(input:BuildInput):GpReport{
 const {source:s,memberId,readAt}=input;
 const postTest=input.resultsAssessment?l('not assessed in this report','այս հաշվետվությունում չի գնահատվում'):POST_TEST;
 const gaps:GpReport['gaps']=[];
 const na=(section:string,field:string,reason:L):L=>{gaps.push({section,field,reason});return cat(l('Not available: ','Հասանելի չէ՝ '),reason);};
 const sources:L[]=[];
 const reportRef=`NRN-${memberId.slice(0,8).toUpperCase()}`;
 const nextVersion=(input.versions[0]?.version??0)+1;
 const previous=input.versions[0]?{version:input.versions[0].version,approvedAt:input.versions[0].approvedAt}:null;

 // Questionnaire and engine. Answers that fail validation are not used at all.
 const a=s.assessment;
 // Each stored answer is checked on its own; an unreadable one is reported, never read as unanswered.
 const entries=Object.entries(a?.answers??{});
 const valid=entries.filter(([,v])=>answerSchema.safeParse(v).success);
 const unreadable=entries.length-valid.length;
 const answers:Answers=pruneAnswers(Object.fromEntries(valid) as Answers);
 const complete=Boolean(a?.completedAt&&!unreadable&&assessmentProgress(answers).complete);
 const resultsInput=input.resultsAssessment?resultsInputFromSource(s,readAt,answers,complete):null;
 const result=resultsInput?assessmentFromSource(s,readAt,answers,complete):null;
 const resultsSection=result&&resultsInput?{assessment:result,...resultsRows(result,resultsInput)}:undefined;
 if(result)for(const code of result.gates)gaps.push({section:'results',field:code,reason:gateCopy[code]});
 const decision:Decision|null=complete?evaluate({answers,observations:[]}):null;
 const Q=a?'[Q1]':'';
 if(a)sources.push(cat('Q1 ',a.completedAt?cat(l('questionnaire completed','հարցաթերթը լրացվել է '),' ',dayTime(a.completedAt)):cat(l('questionnaire not completed, last saved','հարցաթերթը լրացված չէ, վերջին պահպանում '),' ',a.updatedAt?dayTime(a.updatedAt):l('unknown','անհայտ')),' (',l('member entry','անդամի մուտք'),')',unreadable?l(`; ${unreadable} stored answers unreadable and not used`,`. ${unreadable} պահպանված պատասխան անընթեռնելի է և չի օգտագործվել`):''));
 if(unreadable)na('history','Questionnaire answers',l(`${unreadable} stored answers could not be read`,`${unreadable} պահպանված պատասխան հնարավոր չէ կարդալ`));
 const answer=(id:string):L|null=>{
  const v=answers[id]?.value;if(v===undefined)return null;
  if(v==='unknown')return l('not known','անհայտ');
  const field=fieldById(id);
  const one=(x:unknown):L=>{const o=field?.options?.find(opt=>opt.value===x);return o?loc(o.label):l(String(x),String(x));};
  const text=Array.isArray(v)?join(v.map(one),l(', ',', ')):one(v);
  // The member's own answer wording, quoted rather than paraphrased.
  return l(`“${text.en}”`,`«${text.hy}»`);
 };
 // In a complete questionnaire every shown question is answered, so a missing answer was not asked.
 const said=(id:string)=>answer(id)??(complete?l('not asked for these answers','այս պատասխանների դեպքում չի հարցվել'):l('not answered','պատասխան չկա'));

 // Readings. Device and app entries are home readings; nurse visit pairs are office readings.
 // Readings dated after the report's read time are ignored (a future-dated row would pose as the latest).
 const readMs=Date.parse(readAt);
 const device:Reading[]=pastReadings(s.deviceReadings,readMs).map(r=>({...r,kind:'device'}));
 const app:Reading[]=pastReadings(s.homeReadings,readMs).map(r=>({...r,kind:'app'}));
 const visits=new Map<string,{readings:Reading[];clinic:string|null;actor:string|null}>();
 const obs=s.visitObservations.filter(o=>o.state==='known'&&o.observedAt&&typeof o.value==='number'&&Date.parse(o.observedAt)<=readMs);
 for(const sys of obs.filter(o=>o.field==='systolic')){
  const dia=obs.find(o=>o.field==='diastolic'&&o.visitId===sys.visitId&&o.observedAt===sys.observedAt);
  if(!dia)continue;
  const pulse=obs.find(o=>o.field==='pulse'&&o.visitId===sys.visitId&&o.observedAt===sys.observedAt);
  const v=visits.get(sys.visitId)??{readings:[],clinic:sys.clinic,actor:sys.actorName};
  v.readings.push({id:sys.id,systolic:sys.value as number,diastolic:dia.value as number,pulse:typeof pulse?.value==='number'?pulse.value:null,measuredAt:sys.observedAt!,kind:'clinic'});
  visits.set(sys.visitId,v);
 }
 const visitList=[...visits.values()].sort((x,y)=>x.readings[0].measuredAt.localeCompare(y.readings[0].measuredAt));
 visitList.forEach((v,i)=>sources.push(cat(`C${i+1} `,l('clinic visit','կլինիկական այց '),' ',day(v.readings[0].measuredAt),v.clinic?`, ${v.clinic}`:'',' (',l('nurse entry','բուժքրոջ մուտք'),')')));
 const home=[...device,...app].sort((x,y)=>x.measuredAt.localeCompare(y.measuredAt));
 const all=[...home,...visitList.flatMap(v=>v.readings)].sort((x,y)=>x.measuredAt.localeCompare(y.measuredAt));

 // Home windows: the 7 Yerevan calendar days ending at the latest reading, and the 7
 // days ending at the latest reading before that window. Plain means of every reading.
 const window=(endIso:string|undefined)=>{
  if(!endIso)return null;
  const end=yerevanDate(endIso);const start=new Date(Date.parse(`${end}T00:00:00Z`)-6*864e5).toISOString().slice(0,10);
  const rs=home.filter(r=>{const d=yerevanDate(r.measuredAt);return d>=start&&d<=end;});
  return {start,end,rs,days:new Set(rs.map(r=>yerevanDate(r.measuredAt))).size};
 };
 const current=window(home.at(-1)?.measuredAt);
 const previousWindow=current?window(home.filter(r=>yerevanDate(r.measuredAt)<current.start).at(-1)?.measuredAt):null;
 const homeTags:string[]=[];
 const describeWindow=(w:NonNullable<ReturnType<typeof window>>,tag:string)=>{
  const nd=w.rs.filter(r=>r.kind==='device').length,nm=w.rs.length-nd;
  sources.push(cat(`${tag} `,l('home readings','տնային չափումներ '),' ',dayRange(w.start,w.end),': ',join([nd?l(`${nd} from a connected monitor`,`${nd}՝ միացված սարքից`):null,nm?l(`${nm} entered in the app`,`${nm}՝ հավելվածում մուտքագրված`):null].filter((x):x is L=>x!==null),l(', ',', '))));
  return cat(`${mean(w.rs.map(r=>r.systolic))}/${mean(w.rs.map(r=>r.diastolic))}; `,dayRange(w.start,w.end),'; ',l(`mean of ${plural(w.rs.length,'reading','readings')} over ${plural(w.days,'day','days')}`,`${w.rs.length} չափման միջին, ${w.days} օր`),` [${tag}]`);
 };
 let hbpmNow:L,hbpmBefore:L;
 if(previousWindow){homeTags.push('B1','B2');hbpmBefore=describeWindow(previousWindow,'B1');hbpmNow=describeWindow(current!,'B2');}
 else if(current){homeTags.push('B1');hbpmNow=describeWindow(current,'B1');hbpmBefore=na('bp','HBPM previous period',l('no earlier home readings','ավելի վաղ տնային չափումներ չկան'));}
 else{hbpmNow=na('bp','HBPM',l('no home readings recorded','տնային չափումներ չեն գրանցվել'));hbpmBefore=na('bp','HBPM previous period',l('no home readings recorded','տնային չափումներ չեն գրանցվել'));}
 const visitCell=(i:number)=>{const v=visitList[i];const rs=v.readings;
  return cat(`${mean(rs.map(r=>r.systolic))}/${mean(rs.map(r=>r.diastolic))}; `,day(rs[0].measuredAt),'; ',rs.length===1?l('1 reading','1 չափում'):l(`mean of ${rs.length} readings`,`${rs.length} չափման միջին`),` [C${i+1}]`);};
 const officeNow=visitList.length?visitCell(visitList.length-1):na('bp','Office BP',l('no clinic reading recorded by a Noreon nurse','Noreon-ի բուժքույրը կլինիկական չափում չի գրանցել'));
 const officeBefore=visitList.length>1?visitCell(visitList.length-2):na('bp','Office BP previous',l('no earlier clinic reading','ավելի վաղ կլինիկական չափում չկա'));
 const abpm=na('bp','ABPM',l('ABPM is not captured in Noreon','ABPM-ը Noreon-ում չի գրանցվում'));
 const tagOf=(r:Reading)=>{
  const t=r.kind==='clinic'?`C${visitList.findIndex(v=>v.readings.includes(r))+1}`:current?.rs.includes(r)?homeTags.at(-1):previousWindow?.rs.includes(r)?'B1':null;
  return t?` [${t}]`:'';
 };
 const latest=all.at(-1);
 const kindLabel=(r:Reading)=>r.kind==='device'?l('connected monitor','միացված սարք'):r.kind==='app'?l('app entry','հավելվածի մուտք'):l('clinic visit','կլինիկական այց');
 const latestText=latest?cat(`${latest.systolic}/${latest.diastolic}, `,l('pulse ','պուլս '),latest.pulse==null?l('not recorded','չի գրանցվել'):String(latest.pulse),', ',dayTime(latest.measuredAt),' (',kindLabel(latest),')',tagOf(latest)):na('bp','Latest single reading',l('no measured reading','չափված արժեք չկա'));
 const qBand=bloodPressureBand(answers);
 const classification=qBand&&Q?cat(l('questionnaire last reading ','հարցաթերթի վերջին արժեք '),qBand.unit?.en??'',l(' (self-reported) is in the engine category ',' (պացիենտի նշած), շարժիչի դասակարգ՝ '),loc(qBand.label),` (${ALGORITHM_VERSION}) ${Q}. `,l('Confirmed or suspected hypertension: ','Հաստատված կամ կասկածվող ԱՀ՝ '),na('bp','Classification status',postTest)):na('bp','Classification',l('no questionnaire blood pressure','հարցաթերթում ճնշման արժեք չկա'));
 const bpNote=cat(
  l('Quality: ','Որակ՝ '),na('bp','Device validation, cuff and technique',l('device validation, cuff size and technique are not recorded','սարքի վավերացումը, թևկապը և տեխնիկան չեն գրանցվում')),
  l('. Home means: plain average of all readings in the window, none excluded','. Տնային միջին՝ պատուհանի բոլոր չափումների պարզ միջին, առանց բացառումների'),
  l('. Latest single reading: ','։ Վերջին առանձին չափում՝ '),latestText,
  l('. Target: ','։ Թիրախ՝ '),na('bp','GP-set BP target',l('no GP-set office or home target is recorded','բժշկի սահմանած կլինիկական կամ տնային թիրախ գրանցված չէ')),
  l('. Classification: ','։ Դասակարգում՝ '),classification,'.');

 // Priority: red first. Open alerts, the urgent rule and an engine red open the urgent route.
 const openAlerts=s.alerts.filter(x=>x.state!=='resolved');
 // A red answer opens the urgent route even in an incomplete questionnaire.
 const redAnswer=firesEmergency({answers,observations:[]});
 s.alerts.forEach((x,i)=>sources.push(cat(`A${i+1} `,l('urgent care-team alert','շտապ ահազանգ խնամքի թիմին '),' ',dayTime(x.createdAt),` (${x.source}, ${x.ruleId}${x.redFlags?.length?`, ${x.redFlags.join(', ')}`:''}), `,x.state==='open'?l('open','բաց'):x.state==='acknowledged'?l('acknowledged ','ընդունված '):l('resolved ','լուծված '),x.state==='acknowledged'&&x.acknowledgedAt?dayTime(x.acknowledgedAt):x.state==='resolved'&&x.resolvedAt?dayTime(x.resolvedAt):'')));
 const crisis=all.find(r=>r.systolic>=THRESHOLD.crisisSystolic||r.diastolic>=THRESHOLD.crisisDiastolic);
 const gpAlert=l('GP alert: not sent; sending to an external GP is not available in Noreon.','Բժշկին ահազանգ՝ չի ուղարկվել. արտաքին բժշկին ուղարկելը Noreon-ում հասանելի չէ։');
 let priorityLevel:PriorityLevel;let priority:L;
 if(openAlerts.length){
  const x=openAlerts[0];const i=s.alerts.indexOf(x)+1;
  priorityLevel='emergency';
  priority=cat(l('EMERGENCY ROUTE. Reason: urgent care-team alert ','ՇՏԱՊ ՈՒՂԻ։ Հիմք՝ խնամքի թիմի շտապ ահազանգ, '),x.state==='open'?l('open since ','բաց է '):l('acknowledged, not resolved, since ','ընդունված, չլուծված, '),dayTime(x.createdAt),` (${x.ruleId}${x.redFlags?.length?`, ${x.redFlags.join(', ')}`:''}) [A${i}]`,openAlerts.length>1?l(`, plus ${openAlerts.length-1} more open`,`, ևս ${openAlerts.length-1} բաց`):'',l('. Engine guidance for the member: ','։ Շարժիչի ցուցումը անդամին՝ '),loc(CONSULTATION_WINDOW.red),'. ',gpAlert);
 }else if(a?.urgentRule||decision?.urgency==='red'||redAnswer){
  const rule=a?.urgentRule??redAnswer?.id??decision!.findings.find(f=>f.urgency==='red')!.ruleId;
  priorityLevel='emergency';
  priority=cat(l('EMERGENCY ROUTE. Reason: urgent questionnaire rule ','ՇՏԱՊ ՈՒՂԻ։ Հիմք՝ հարցաթերթի շտապ կանոն '),rule,a?.updatedAt?cat(', ',dayTime(a.updatedAt)):'',` ${Q}`,l('. Engine guidance for the member: ','։ Շարժիչի ցուցումը անդամին՝ '),loc(CONSULTATION_WINDOW.red),'. ',gpAlert);
 }else if(crisis){
  priorityLevel='cannot-assess';
  priority=cat(l('CANNOT ASSESS ROUTINELY. Reason: a crisis-range reading ','ՊԼԱՆԱՅԻՆ ԳՆԱՀԱՏՈՒՄ ՀՆԱՐԱՎՈՐ ՉԷ։ Հիմք՝ ճգնաժամային միջակայքի չափում '),`${crisis.systolic}/${crisis.diastolic}, `,dayTime(crisis.measuredAt),' (',kindLabel(crisis),')',tagOf(crisis),l(' has no linked symptom triage or resolution in Noreon. Arrange clinical assessment; later normal readings do not clear this hold. ',', որը Noreon-ում չունի կապված ախտանիշային գնահատում կամ լուծում։ Կազմակերպել կլինիկական գնահատում. հետագա նորմալ չափումները չեն հանում այս կասեցումը։ '),gpAlert);
 }else if(!decision){
  priorityLevel='cannot-assess';
  priority=cat(l('CANNOT ASSESS. Reason: ','ԳՆԱՀԱՏԵԼ ՀՆԱՐԱՎՈՐ ՉԷ։ Հիմք՝ '),na('priority','Engine result',a?.completedAt?l('the stored questionnaire is incomplete or unreadable','պահպանված հարցաթերթը թերի է կամ անընթեռնելի'):l('the questionnaire is not completed','հարցաթերթը լրացված չէ')),'. ',gpAlert);
 }else{
  priorityLevel=decision.urgency as PriorityLevel;
  const attention=needsAttention(decision);
  const u=loc(URGENCY_LABEL[decision.urgency]);
  priority=cat(l(u.en.toUpperCase(),u.hy.toUpperCase()),': ',loc(consultationWindow(decision)),
   l(`. Reason: screening engine ${ALGORITHM_VERSION} on the questionnaire of `,`։ Հիմք՝ սքրինինգի շարժիչ ${ALGORITHM_VERSION}, հարցաթերթ՝ `),day(a!.completedAt!),', ',attention.length?l(`${plural(attention.length,'finding','findings')} needing attention, listed under proposals`,`${attention.length} ուշադրության կարիք ունեցող արդյունք՝ առաջարկների բաժնում`):l('no finding needing attention','ուշադրության կարիք ունեցող արդյունք չկա'),` ${Q}`,
   l('. No emergency (red) rule fired; the member sees the same consultation window. ','։ Շտապ (կարմիր) կանոն չի գործարկվել. անդամը տեսնում է նույն ժամկետը։ '),gpAlert);
 }
 const c=s.consultation;
 if(c?.decision==='required'&&!c.completedAt)priority=cat(priority,l(' Noreon doctor consultation required','  Պահանջվում է Noreon-ի բժշկի խորհրդատվություն'),c.arrangement?.holdSince?cat(l(' (hold since ',' (կասեցված է '),dayTime(c.arrangement.holdSince),')'):'',c.arrangement?.scheduledAt?cat(l('; scheduled ','. նշանակված է '),dayTime(c.arrangement.scheduledAt)):l('; not yet scheduled','. դեռ նշանակված չէ'),'.');

 // History and risk, from the member's own answers and the engine's derived values.
 const conditions=answer('q6.conditions');
 const b=bmi(answers);const bBand=bmiBand(answers);
 const packs=packYears(answers);
 const history=complete?cat(
  l('Patient-reported conditions: ','Պացիենտի նշած հիվանդություններ՝ '),conditions??l('not answered','պատասխան չկա'),
  l('; high blood pressure: ','. բարձր ճնշում՝ '),said('q5.diagnosed'),
  typeof answers['q6.diabetes_years']?.value==='number'?cat(l('; diabetes diagnosed ','. դիաբետը ախտորոշվել է '),String(answers['q6.diabetes_years']!.value),l(' years ago',' տարի առաջ')):'',
  ' ',Q,l('. Symptoms answered ','։ Ախտանիշներ՝ պատասխանված '),dayTime(a!.completedAt!),l(': chest pain or pressure on exertion or stress: ','․ կրծքային ցավ ծանրաբեռնվածության ժամանակ՝ '),said('q9.present'),
  l('; dizziness or breathlessness with a racing heart: ','. գլխապտույտ կամ շնչահեղձություն արագ սրտխփոցով՝ '),said('q10.symptoms'),l('; loss of consciousness: ','. գիտակցության կորուստ՝ '),said('q10.syncope'),' ',Q,
  l('. Smoking: ','։ Ծխել՝ '),said('q3.status'),packs!==null?l(`, ${packs} pack-years`,`, ${packs} տուփ-տարի`):'',
  l('; alcohol: ','. ալկոհոլ՝ '),said('q4.frequency'),
  l('; BMI ','. BMI '),b!==null?cat(String(Math.round(b*10)/10),bBand?cat(' (',loc(bBand.label),')'):''):l('not available','հասանելի չէ'),
  l('; activity: ','. ակտիվություն՝ '),activityBand(answers)?loc(activityBand(answers)!.label):said('q2.activity'),
  l('; diet: ','. սնունդ՝ '),said('q2.diet'),
  l('; family history: ','. ընտանեկան պատմություն՝ '),said('q7.relatives'),answers['q7.relative_age']?cat(' (',said('q7.relative_age'),')'):'',' ',Q,
  l('. Orthostatic symptoms or BP: ','։ Օրթոստատիկ ախտանիշներ կամ ԱՃ՝ '),na('history','Orthostatic assessment',l('not assessed in Noreon','Noreon-ում չի գնահատվում')),
  l('. Access barriers: ','։ Հասանելիության խոչընդոտներ՝ '),na('history','Access barriers',l('not asked','չի հարցվում')),'.'
 ):na('history','History',l('the questionnaire is not completed','հարցաթերթը լրացված չէ'));
 const score=score2State(answers);
 const scoreText:Record<string,L>={
  NOT_APPLICABLE:l('SCORE2 is not applicable because established disease is reported; risk is by classification','SCORE2 կիրառելի չէ, քանի որ նշված է հաստատված հիվանդություն. ռիսկը որոշվում է դասակարգմամբ'),
  DIABETES_MODEL:l('the diabetes model (SCORE2-Diabetes) applies','կիրառելի է դիաբետի մոդելը (SCORE2-Diabetes)'),
  LIFETIME_ONLY:l('under 40: lifetime risk only, no ten-year percentage','40 տարեկանից ցածր. միայն ամբողջ կյանքի ռիսկ, առանց 10-ամյա տոկոսի'),
  SCORE2_OP:l('the older-persons model (SCORE2-OP) applies','կիրառելի է տարեցների մոդելը (SCORE2-OP)'),
  SCORE2:l('the ten-year model (SCORE2) applies','կիրառելի է 10-ամյա մոդելը (SCORE2)'),
  UNKNOWN:l('the model is not decided because conditions or age are not recorded','մոդելը որոշված չէ, քանի որ հիվանդությունները կամ տարիքը գրանցված չեն'),
 };
 const mods=modifiers(answers);
 const kidney=Array.isArray(answers['q6.conditions']?.value)&&(answers['q6.conditions']!.value as string[]).includes('kidney');
 const risk=result?cat(l('Risk category: ','Ռիսկային կատեգորիա՝ '),result.category?categoryCopy[result.category.level]:l('Not available','Հասանելի չէ'),l('. SCORE2: ','։ SCORE2՝ '),result.score2.state==='applicable'?(result.score2.percent===null?l('percentage not entered','տոկոսը մուտքագրված չէ'):`${result.score2.percent}%`):result.score2.state==='off'?join(result.score2.reasons.map(code=>score2ReasonCopy[code])):l('undecided','որոշված չէ'),l('. The percentage is entered from the ESC calculator. Noreon does not calculate it.','։ Տոկոսը մուտքագրվում է ESC-ի հաշվիչից։ Noreon-ը այն չի հաշվարկում։')):complete?cat(l(`Risk (engine ${ALGORITHM_VERSION}): `,`Ռիսկ (շարժիչ ${ALGORITHM_VERSION})՝ `),scoreText[score.code],` ${Q}. `,l('Risk percentage: ','Ռիսկի տոկոս՝ '),na('history','Risk score',l('the engine calculates no percentage without lipid observations','շարժիչը տոկոս չի հաշվարկում առանց լիպիդային տվյալների')),
  l('. Modifiers recorded: ','։ Գրանցված փոփոխիչներ՝ '),mods.length?join(mods.map(loc),l(', ',', ')):l('none','չկան'),
  l('. Kidney or organ damage: ','։ Երիկամային կամ օրգանային վնասում՝ '),kidney?l('kidney disease reported by the patient, not confirmed in Noreon','երիկամային հիվանդություն՝ պացիենտի նշմամբ, Noreon-ում չհաստատված'):na('history','Organ damage',l('not assessed; no rule derives organ damage','չի գնահատվել. օրգանային վնասում որոշող կանոն չկա')),'.'
 ):na('history','Risk',l('the questionnaire is not completed','հարցաթերթը լրացված չէ'));

 // Medicines: only what a Noreon care plan records, plus the questionnaire answer.
 const plans=[...s.plans].sort((x,y)=>x.publishedAt.localeCompare(y.publishedAt));
 plans.forEach((p,i)=>sources.push(cat(`P${i+1} `,l('Noreon care plan','Noreon-ի խնամքի պլան'),p.version?` v${p.version}`:'',', ',day(p.publishedAt),p.clinician?`, ${p.clinician}`:'',p.active?l(' (current)',' (ընթացիկ)'):'')));
 const planTag=(id:string|null)=>{const i=plans.findIndex(p=>p.planId===id);return i<0?'':` [P${i+1}]`;};
 const activeMeds=s.medications.filter(m=>m.active);
 const medRows:Row[]=activeMeds.map(m=>[l(m.name,m.name),cat([m.dose,m.instructions].filter(Boolean).join('; ')||'',m.times?.length?`; ${m.times.map(t=>t.slice(0,5)).join(', ')}`:'',m.startDate?cat(l('; since ','. սկսած '),day(m.startDate)):''),cat(l('Noreon care plan','Noreon-ի խնամքի պլան'),planTag(m.planId),l('; adherence: ','. ընդունում՝ '),na('meds',`Adherence (${m.name})`,l('not summarised in this report','այս հաշվետվությունում ամփոփված չէ')))]);
 if(!medRows.length)medRows.push([l('Care plan medicines','Խնամքի պլանի դեղեր'),na('meds','Recorded medicines',l('no medicine is recorded in a Noreon care plan','Noreon-ի խնամքի պլանում դեղ գրանցված չէ')),l('Noreon records','Noreon-ի գրառումներ')]);
 const treated=answers['q5.diagnosed']?.value;
 if(Q&&treated!==undefined)medRows.push([l('Blood pressure medicine','Ճնշման դեղ'),treated==='treated'?na('meds','BP medicine names and doses',l('name, dose and schedule are not captured','անունը, դեղաչափը և ռեժիմը չեն գրանցվում')):treated==='unknown'?na('meds','BP medicine use',l('the member does not know','անդամը չգիտի')):l('Not applicable','Կիրառելի չէ'),cat(l('Patient answer: ','Պացիենտի պատասխան՝ '),said('q5.diagnosed'),` ${Q}`)]);
 medRows.push([l('Other relevant medicines','Այլ կարևոր դեղեր'),na('meds','Other medicines',l('OTC, NSAID and supplement use is not asked','OTC, NSAID և հավելումների օգտագործումը չի հարցվում')),na('meds','Interactions',l('interactions are not assessed','փոխազդեցությունները չեն գնահատվում'))]);
 const medNote=cat(l('Allergies: ','Ալերգիաներ՝ '),na('meds','Allergies',l('not asked in Noreon','Noreon-ում չի հարցվում')),l('. Reconciliation: not done. Missing for decisions: ','։ Համադրում՝ չի կատարվել։ Որոշման համար բացակայում են՝ '),
  l('current medicines and doses, allergies, BP target','ընթացիկ դեղերն ու դեղաչափերը, ալերգիաները, ԱՃ թիրախը'),'.');

 // Laboratory values exactly as received, grouped by the template's rows.
 const groups:{key:string;label:L;match:(m:string)=>boolean}[]=[
  {key:'uacr',label:l('uACR','uACR'),match:m=>/albumin.*creat|\bu?acr\b|альбумин.*креат|микроальбумин|microalbumin/.test(m)},
  {key:'renal',label:l('Creatinine / eGFR','Կրեատինին / eGFR'),match:m=>/creatin|креатинин|կրեատինին|\begfr\b|\bgfr\b|скф/.test(m)},
  {key:'electrolytes',label:l('Potassium / sodium','Կալիում / նատրիում'),match:m=>/^k\+?$|potassium|калий|կալիում|^na\+?$|sodium|натрий|նատրիում/.test(m)},
  {key:'glycaemia',label:l('HbA1c / glucose','HbA1c / գլյուկոզա'),match:m=>/hba1c|a1c|гликир|գլիկ|glucose|глюкоза|գլյուկոզ/.test(m)},
  {key:'lipids',label:l('Lipids','Լիպիդներ'),match:m=>/cholesterol|холестерин|խոլեստեր|\bldl\b|\bhdl\b|лпнп|лпвп|triglycer|триглицер|տրիգլից/.test(m)},
 ];
 // Clinic lab PDF values (#225) count only once the assigned doctor confirmed or corrected them;
 // the rest are named as awaiting the doctor's check, never with a value.
 const groupByRef:Record<string,string>={creatinine:'renal',egfr:'renal',uacr:'uacr',hba1c:'glycaemia',fasting_glucose:'glycaemia',total_cholesterol:'lipids',hdl_c:'lipids',ldl_c:'lipids',non_hdl_c:'lipids',triglycerides:'lipids',apob:'lipids',lpa:'lipids'};
 const groupOf=(marker:string,ref:string|null=null)=>(ref?groupByRef[ref]:undefined)??groups.find(x=>x.match(marker.trim().toLowerCase()))?.key??'other';
 const pdfValues=s.clinicLabValues;
 type Lab={marker:string;value:number|string;unit:string;referenceLow:number|null;referenceHigh:number|null;referenceText:string|null;collectedAt:string;group:string;key:string;corrected:boolean};
 const results:Lab[]=[
  ...s.labResults.map(r=>({...r,group:groupOf(r.marker),key:r.sourceReportId??`${r.source}:${yerevanDate(r.collectedAt)}`,corrected:false})),
  ...pdfValues.filter(v=>v.status!=='unverified').map(v=>({marker:v.testName,value:v.value??v.valueText??'',unit:v.unit??'',referenceLow:v.referenceLow,referenceHigh:v.referenceHigh,referenceText:v.referenceText,
   collectedAt:v.collectedOn??v.attachedAt,group:groupOf(v.testName,v.catalogueRef),key:`pdf:${v.fileId}`,corrected:v.status==='corrected'})),
 ].sort((x,y)=>x.collectedAt.localeCompare(y.collectedAt));
 const labKeys:string[]=[];
 for(const r of results)if(!labKeys.includes(r.key))labKeys.push(r.key);
 const labTag=(r:Lab)=>`L${labKeys.indexOf(r.key)+1}`;
 labKeys.forEach((k,i)=>{
  if(k.startsWith('pdf:')){
   const vs=pdfValues.filter(v=>`pdf:${v.fileId}`===k&&v.status!=='unverified');const v=vs[0];
   const reviewers=[...new Set(vs.map(x=>x.reviewedBy).filter((x):x is string=>!!x))];
   const checked=vs.map(x=>x.reviewedAt!).sort().at(-1)!;
   sources.push(cat(`L${i+1} `,v.collectedOn?cat(l('lab results dated ','լաբորատոր արդյունքներ '),day(v.collectedOn)):cat(l('lab results, collection date not on the sheet, attached ','լաբորատոր արդյունքներ, նմուշառման ամսաթիվը թերթիկում նշված չէ, կցվել է '),day(v.attachedAt)),
    v.clinic?`, ${v.clinic}`:'',', ',l('clinic PDF read by AI; values confirmed by ','կլինիկայի PDF՝ կարդացված AI-ով. արժեքները հաստատել է '),reviewers.join(', ')||l('the assigned doctor','նշանակված բժիշկը'),' ',day(checked)));
   return;
  }
  const r=s.labResults.find(x=>(x.sourceReportId??`${x.source}:${yerevanDate(x.collectedAt)}`)===k)!;
  const how=r.source==='laboratory'&&r.sourceReportId?l('AI-read upload','AI-ով կարդացված վերբեռնում'):r.source==='clinic'?l('entered by the clinic','մուտքագրվել է կլինիկայի կողմից'):r.source==='member'?l('entered by the member','մուտքագրվել է անդամի կողմից'):l('received from the laboratory','ստացվել է լաբորատորիայից');
  sources.push(cat(`L${i+1} `,l('lab results dated ','լաբորատոր արդյունքներ '),day(r.collectedAt),r.sourceLabel?`, ${r.sourceLabel}`:'',', ',how,r.reviewedAt?cat(l('; confirmed by ','. հաստատել է '),r.reviewedBy??'',' ',day(r.reviewedAt)):''));
 });
 const fmtValue=(r:Lab)=>{
  const ref=r.referenceText??(r.referenceLow!=null&&r.referenceHigh!=null?`${r.referenceLow}–${r.referenceHigh}`:null);
  return cat(`${r.marker} ${r.value}${r.unit?` ${r.unit}`:''}${ref?` (ref ${ref})`:''}`,r.corrected?l(' (corrected by the doctor)',' (ուղղել է բժիշկը)'):'');
 };
 const cellFor=(rs:Lab[])=>{const date=yerevanDate(rs[0].collectedAt);const tags=[...new Set(rs.map(labTag))];return cat(join(rs.map(fmtValue)),'; ',day(date),` [${tags.join(', ')}]`);};
 const grouped=new Map<string,Lab[]>();
 for(const r of results)grouped.set(r.group,[...(grouped.get(r.group)??[]),r]);
 // Unchecked PDF values by row: named, dated by upload, never valued.
 const awaiting=new Map<string,typeof pdfValues>();
 for(const v of pdfValues.filter(x=>x.status==='unverified')){const g=groupOf(v.testName,v.catalogueRef);awaiting.set(g,[...(awaiting.get(g)??[]),v]);}
 // The AI's test name is free text and could carry a number, so an unchecked value is named by its
 // catalogue label, or by the AI name only when that holds no digit (Fable F1).
 const pendingName=(v:(typeof pdfValues)[number])=>(v.catalogueRef?analyteByKey(v.catalogueRef)?.label:undefined)??(/\d/.test(v.testName)?null:v.testName);
 const awaitingText=(key:string)=>{const vs=awaiting.get(key)??[];if(!vs.length)return null;const names=[...new Set(vs.map(pendingName).filter((x):x is string=>!!x))];const unnamed=vs.filter(v=>!pendingName(v)).length;
  return cat(join([...names.map(n=>l(n,n)),...(unnamed?[l(`${unnamed} unnamed ${unnamed===1?'test':'tests'}`,`${unnamed} անանուն թեստ`)]:[])],l(', ',', ')),l(' from the clinic PDF attached ',' կլինիկայի PDF-ից, կցված '),day(vs.map(v=>v.attachedAt).sort().at(-1)!));};
 const AWAITING=l('awaiting doctor check: ','սպասում է բժշկի ստուգմանը՝ ');
 const labRow=(key:string,label:L):Row=>{
  const rs=grouped.get(key)??[];
  const pending=awaitingText(key);
  if(!rs.length)return [label,pending?na('labs',label.en,cat(AWAITING,pending)):na('labs',label.en,l('no result received','արդյունք չի ստացվել')),na('labs',`${label.en} previous`,pending?l('no checked result','ստուգված արդյունք չկա'):l('no result received','արդյունք չի ստացվել'))];
  const dates=[...new Set(rs.map(r=>yerevanDate(r.collectedAt)))].sort();
  const latestDate=dates.at(-1)!,prevDate=dates.at(-2);
  const latestCell=cellFor(rs.filter(r=>yerevanDate(r.collectedAt)===latestDate));
  return [label,pending?cat(latestCell,'. ',l('Also ','Նաև '),AWAITING,pending):latestCell,prevDate?cellFor(rs.filter(r=>yerevanDate(r.collectedAt)===prevDate)):na('labs',`${label.en} previous`,l('no earlier result','ավելի վաղ արդյունք չկա'))];
 };
 const labRows:Row[]=[labRow('renal',l('Creatinine / eGFR','Կրեատինին / eGFR')),labRow('uacr',l('uACR','uACR')),labRow('electrolytes',l('Potassium / sodium','Կալիում / նատրիում')),labRow('glycaemia',l('HbA1c / glucose','HbA1c / գլյուկոզա')),labRow('lipids',l('Lipids','Լիպիդներ')),labRow('other',l('Other results','Այլ արդյունքներ'))];
 const open=s.tests.filter(t=>t.status==='ordered');
 const labNote=cat(l('Interpretation: ','Մեկնաբանություն՝ '),result?l('See results assessment for risk category and LDL-C target. CKD stage, G/A category and persistence are not assessed','Ռիսկային կատեգորիան և LDL-C-ի թիրախը՝ արդյունքների գնահատման բաժնում։ ՔԵՀ փուլը, G/A դասը և կայունությունը չեն գնահատվում'):na('labs','Interpretation, G/A category, persistence',cat(POST_TEST,l('; no CKD stage, G/A category, critical-value flag or target is derived','. ՔԵՀ փուլ, G/A դաս, կրիտիկական նշան կամ թիրախ չի որոշվում'))),
  l('. Values, units and any reference ranges (ref) are as recorded by the source. Outstanding: ','։ Արժեքները, միավորները և նորմաները (ref) ըստ աղբյուրի։ Սպասվող՝ '),open.length?join(open.map(t=>cat(t.title,t.dueAt?cat(l(' due ',' մինչև '),day(t.dueAt)):l(' (no due date)',' (առանց ժամկետի)')))):l('none recorded','գրանցված չէ'),
  l('. Clinic lab documents attached: ','։ Կլինիկայի կցած լաբորատոր փաստաթղթեր՝ '),s.clinicDocuments.length?cat(String(s.clinicDocuments.length),pdfValues.length
   ?l(' (values read by AI are listed only after the assigned doctor confirmed them; values awaiting that check are named without a value; open the PDFs in Noreon)',' (AI-ով կարդացված արժեքները ներառվում են միայն նշանակված բժշկի հաստատումից հետո. ստուգման սպասող արժեքները նշված են առանց արժեքի. բացել PDF-ները Noreon-ում)')
   :l(' (values not extracted; open them in Noreon)',' (արժեքները չեն արտահանվել. բացել Noreon-ում)')):l('none','չկան'),'.');

 const ecg=result?l('Automated ECG interpretation unavailable. Doctor-entered findings and dates are in results assessment. Any ECG document needs visual review.','Ավտոմատ ԷՍԳ մեկնաբանությունը հասանելի չէ։ Բժշկի մուտքագրած տվյալներն ու օրերը՝ արդյունքների գնահատման բաժնում։ ԷՍԳ փաստաթուղթը պահանջում է զննում։'):cat(l('Automated ECG interpretation unavailable. ','Ավտոմատ ԷՍԳ մեկնաբանությունը հասանելի չէ։ '),na('ecg','12-lead ECG',l('no ECG method is selected or validated and Noreon stores no ECG measurements; any ECG document attached by a clinic needs GP visual review','ԷՍԳ մեթոդ ընտրված կամ վավերացված չէ, Noreon-ը ԷՍԳ չափումներ չի պահում. կլինիկայի կցած ԷՍԳ փաստաթուղթը պահանջում է բժշկի զննում')),'.');

 // Proposals: only the engine's own next steps, its test plan and the doctor's published plan.
 const proposals:Row[]=[];
 const doctorLabel=l('Noreon doctor','Noreon-ի բժիշկ');
 if(decision){
  const window=loc(consultationWindow(decision));
  const steps=needsAttention(decision).filter(f=>f.nextStep);
  if(steps.length)proposals.push([cat(window,'; ',doctorLabel),cat(l('Engine next steps (engine text): ','Շարժիչի հաջորդ քայլերը (շարժիչի տեքստ)՝ '),join(steps.slice(0,3).map(f=>{const x=loc(f.nextStep!);return cat(`${f.ruleId}: `,l(x.en.replace(/[.։]$/,''),x.hy.replace(/[.։]$/,'')));})),
   steps.length>3?cat(l('; also ','. նաև '),steps.slice(3).map(f=>f.ruleId).join(', '),l(' (listed in Noreon)',' (Noreon-ում)')):'',` ${Q}`),na('proposals','Completion of engine next steps',l('completion is not recorded','կատարումը չի գրանցվում'))]);
  // Tests only for discussion are the doctor's judgement in the plan draft; this template's two pages list what is required.
  const plan=requiredTests(decision);
  if(plan.length)proposals.push([cat(steps.length?l('Same window','Նույն ժամկետ'):window,'; ',doctorLabel),cat(l('Engine test plan: ','Շարժիչի թեստային պլան՝ '),join(plan.map(t=>loc(t.name)),l(', ',', ')),` ${Q}`),open.length||s.tests.length?cat(l('Recorded tests: ','Գրանցված թեստեր՝ '),String(s.tests.filter(t=>t.status==='collected').length),l(' collected, ',' հավաքված, '),String(open.length),l(' ordered',' նշանակված')):na('proposals','Test completion',l('no test is recorded','թեստ գրանցված չէ'))]);
 }
 const currentPlan=plans.filter(p=>p.active).at(-1);
 if(currentPlan)proposals.push([cat(day(currentPlan.publishedAt),'; ',doctorLabel),cat(l('Published care plan: ','Հրապարակված խնամքի պլան՝ '),(currentPlan.instructions??'').slice(0,280),(currentPlan.instructions??'').length>280?'…':'',planTag(currentPlan.planId)),currentPlan.version?l(`Version ${currentPlan.version}`,`Տարբերակ ${currentPlan.version}`):l('Current','Ընթացիկ')]);
 proposals.push([l('GP','Բժիշկ'),cat((result?l('Treatment, drug classes and referrals: ','Բուժում, դեղադասեր և ուղեգրումներ՝ '):l('Treatment, drug classes, targets and referrals: ','Բուժում, դեղադասեր, թիրախներ և ուղեգրումներ՝ ')),na('proposals','Treatment proposals',cat(postTest,l('; Noreon proposes none','. Noreon-ը չի առաջարկում')))),l('GP decision','Բժշկի որոշում')]);

 const arrangement=c?.arrangement?.scheduledAt;
 const followUp=cat(l('Next review: ','Հաջորդ այց՝ '),arrangement?cat(dayTime(arrangement),l(', Noreon doctor',', Noreon-ի բժիշկ')):decision?cat(l('not booked; engine window: ','նշանակված չէ. շարժիչի ժամկետ՝ '),loc(consultationWindow(decision))):na('followup','Next review',l('not booked','նշանակված չէ')),
  l('. BP target: ','։ ԱՃ թիրախ՝ '),l('GP to confirm','բժիշկը պետք է հաստատի'),l('. Repeat tests: ','։ Կրկնվող թեստեր՝ '),open.length?join(open.map(t=>cat(t.title,t.dueAt?cat(' ',day(t.dueAt)):''))):l('none recorded','գրանցված չեն'),
  l('. Unacknowledged alert: ','։ Չհաստատված ահազանգ՝ '),openAlerts.filter(x=>x.state==='open').length?l(`${openAlerts.filter(x=>x.state==='open').length} open; the member is directed to call 103 when urgent`,`${openAlerts.filter(x=>x.state==='open').length} բաց. շտապ դեպքում անդամին ուղղորդում ենք զանգահարել 103`):l('none','չկա'),
  l('. New chest pain, severe breathlessness or neurological symptoms: urgent emergency assessment without waiting for a GP reply.','։ Նոր կրծքային ցավի, ծանր շնչահեղձության կամ նյարդաբանական նշանների դեպքում՝ շտապ գնահատում՝ առանց բժշկի պատասխանին սպասելու։'));

 // Clinical assessment: facts only, in the template's order.
 const bpFact=current?cat(l('Home BP mean ','Տնային ԱՃ միջին '),`${mean(current.rs.map(r=>r.systolic))}/${mean(current.rs.map(r=>r.diastolic))}`,l(' mmHg over ',' մմ ս.ս., '),l(plural(current.rs.length,'reading','readings'),`${current.rs.length} չափում`),' (',dayRange(current.start,current.end),`) [${homeTags.at(-1)}]`,previousWindow?cat(l(', previously ',', նախկինում '),`${mean(previousWindow.rs.map(r=>r.systolic))}/${mean(previousWindow.rs.map(r=>r.diastolic))} [B1]`):'','.')
  :visitList.length?cat(l('Office BP ','Կլինիկական ԱՃ '),visitCell(visitList.length-1),'.')
  :qBand&&Q?cat(l('No measured BP in Noreon; the questionnaire reading is ','Noreon-ում չափված ԱՃ չկա. հարցաթերթի արժեքը՝ '),qBand.unit?.en??'',l(' (self-reported) ',' (պացիենտի նշած) '),Q,'.'):l('No blood pressure is recorded.','Ճնշում գրանցված չէ։');
 const gapFact=cat((result?l('Hypertension confirmation, kidney stage and treatment: ','ԱՀ հաստատում, երիկամային փուլ և բուժում՝ '):l('Hypertension confirmation, kidney status and treatment: ','ԱՀ հաստատում, երիկամային վիճակ և բուժում՝ ')),na('assessment','Clinical interpretation',postTest),'.',
  previous?cat(l(' Previous approved report: ',' Նախորդ հաստատված հաշվետվություն՝ '),`v${previous.version}, `,day(previous.approvedAt),l('; change summary not available.','. փոփոխությունների ամփոփում հասանելի չէ։')):l(' First report.',' Առաջին հաշվետվություն։'));
 const assessment=cat(bpFact,' ',gapFact);

 // Header lines.
 const p=s.profile;
 const age=p?.birthDate?ageOn(p.birthDate,yerevanDate(readAt)):NaN;
 const sexField=fieldById('q1.sex')?.options?.find(o=>o.value===p?.biologicalSex);
 const patientLine=cat(l('Patient ','Պացիենտ '),p?.name?`${p.name} `:'',`(${reportRef})`,' | ',l('DOB ','Ծննդյան ամսաթիվ '),p?.birthDate?day(p.birthDate):l('not recorded','չի գրանցվել'),' | ',l('Age ','Տարիք '),Number.isFinite(age)?String(age):l('not recorded','չի գրանցվել'),' | ',l('Sex ','Սեռ '),sexField?loc(sexField.label):l('not recorded','չի գրանցվել'),' | ',l('GP ','Բժիշկ '),na('header','GP name and practice',l('not captured','չի գրանցվում')));
 const reportLine=cat(l('Generated ','Ստեղծվել է '),dayTime(readAt),' AMT UTC+4 | ',l('Data cut-off ','Տվյալների վերջնաժամկետ '),time(readAt),' | ',l('Trigger: Noreon doctor request','Առիթ՝ Noreon-ի բժշկի հարցում'));

 return {kind:'noreon-gp-report',templateVersion:TEMPLATE_VERSION,algorithmVersion:ALGORITHM_VERSION,memberId,sourceToken:input.token,builtAt:readAt,reportRef,nextVersion,previous,
  patientLine,reportLine,priorityLevel,priority,assessment,
  bp:{rows:[[l('Office BP mmHg','Կլինիկական ԱՃ մմ ս.ս.'),officeNow,officeBefore],[l('HBPM mmHg','HBPM մմ ս.ս.'),hbpmNow,hbpmBefore],[l('ABPM','ABPM'),abpm,abpm]],note:bpNote},
  history,risk,meds:{rows:medRows,note:medNote},labs:{rows:labRows,note:labNote},ecg,proposals,followUp,
  sources:sources.length?cat(l('Sources: ','Աղբյուրներ՝ '),join(sources),'.'):cat(l('Sources: ','Աղբյուրներ՝ '),na('sources','Sources',l('no source records','աղբյուր գրառումներ չկան')),'.'),
  gaps,...(resultsSection?{results:resultsSection}:{})};
}
