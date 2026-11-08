import type {Locale} from '@/lib/locale';
import {AI_READ_LABEL} from '@/lib/lab-ai/provenance';
import {isUnverifiedBp,unverifiedBpLabel} from '@/lib/patient/bp-provenance';
import {createHash} from 'node:crypto';
import {buildPlan,consultationWindow,consultationWindowDays,evaluate,requiredTests,unknownFields} from '@/lib/clinical/rules/engine';
import {THRESHOLD} from '@/lib/clinical/rules/rules';
import type {Answers,Decision} from '@/lib/clinical/types';
import {LAB_ANALYTES,analyteByKey,toCanonical} from '@/lib/lab-ai/catalogue';
import type {CareVisit} from '@/lib/staff/visit-evidence-schema';
import {BUILDER_VERSION,PROMPT_VERSION,type PlanItem,type PlanLabValue} from './contracts';

/**
 * The deterministic half of the draft: minimised facts for the model and every clinical item, each
 * with its source and rationale. Sources: NRN-CLIN-ALG-001 v1.1 through the rules engine, and the
 * hypertension laboratory protocol v2 (NRN-LAB-CAT-001 v2.0) applied to doctor-reviewed or safeguard-confirmed values.
 * Anything no rule decides is "needs_doctor_judgement" and never member-facing (QUESTIONS Q1–Q4).
 */
export type PlanInput={
 now:Date;language:'hy'|'en';
 /** Member locale and staff summary locale are distinct. Omitted only for legacy internal callers. */
 memberLanguage?:Locale|null;summaryLanguage?:Locale;
 profile:{birthDate:string|null;biologicalSex:string|null};
 assessment:{answers:Record<string,unknown>;completed_at:string|null;urgent_rule:string|null}|null;
 measurements:{entry_source?:string|null;systolic:number;diastolic:number;pulse:number|null;measured_at:string}[];
 visits:CareVisit[];
 labValues:PlanLabValue[];
 publications:{publishedAt:string}[];
};
export type Refusal='questionnaire_incomplete'|'urgent';

const DAY=86_400_000;
const daysAgo=(iso:string|null,now:Date)=>{if(!iso)return null;const t=Date.parse(iso);return Number.isFinite(t)?Math.max(0,Math.floor((now.getTime()-t)/DAY)):null;};
const answerValue=(a:unknown)=>a&&typeof a==='object'&&'value'in a?(a as {value:unknown}).value:a;
const round=(n:number,d=1)=>Math.round(n*10**d)/10**d;
const reviewed=(v:PlanLabValue)=>v.status==='verified'||v.status==='corrected';

function ageYears(input:PlanInput):number|null{
 const b=input.profile.birthDate?Date.parse(input.profile.birthDate):NaN;
 if(Number.isFinite(b)){const d=new Date(b),n=input.now;let y=n.getUTCFullYear()-d.getUTCFullYear();if(n.getUTCMonth()<d.getUTCMonth()||(n.getUTCMonth()===d.getUTCMonth()&&n.getUTCDate()<d.getUTCDate()))y--;return y>=0&&y<130?y:null;}
 const a=Number(answerValue(input.assessment?.answers['q1.age']));
 return Number.isInteger(a)&&a>0&&a<130?a:null;
}
function sex(input:PlanInput):'male'|'female'|null{
 const s=input.profile.biologicalSex??answerValue(input.assessment?.answers['q1.sex']);
 return s==='male'||s==='female'?s:null;
}

/** A confirmed value in its canonical unit (the reader's catalogue), or null. */
function canonical(v:PlanLabValue):{key:string;label:string;value:number;unit:string}|null{
 if((!reviewed(v)&&v.status!=='auto_accepted')||v.value==null||!v.catalogueRef)return null;
 const a=analyteByKey(v.catalogueRef);if(!a)return null;
 const c=toCanonical(a,v.value,v.unit??a.canonical);
 return c==null?null:{key:a.key,label:a.label,value:round(c,2),unit:a.canonical};
}

export function decisionFor(input:PlanInput):Decision|Refusal{
 const a=input.assessment;
 if(!a?.completed_at)return 'questionnaire_incomplete';
 if(a.urgent_rule)return 'urgent';
 const decision=evaluate({answers:a.answers as Answers,observations:[]});
 return decision.urgency==='red'?'urgent':decision;
}

export type Skeleton={facts:Record<string,unknown>;items:PlanItem[];decision:Decision;fingerprint:string};

export function buildSkeleton(input:PlanInput):Skeleton|Refusal{
 const decision=decisionFor(input);
 if(typeof decision==='string')return decision;
 const now=input.now,items:PlanItem[]=[];
 const add=(i:PlanItem)=>{if(!items.some(x=>x.id===i.id))items.push(i);};
 const en=(f:{en?:string;hy:string}|undefined)=>f?.en??f?.hy??'';
 const windowDays=consultationWindowDays(decision);

 // Red and orange first: orange findings with their consultation window (red never reaches here).
 for(const f of decision.findings.filter(f=>f.urgency==='orange'))add({id:`flag:${f.ruleId}`.toLowerCase(),section:'red_flag',status:'protocol',
  text:`${f.ruleId}: ${en(f.reason)}`,rationale:`Rules engine finding, urgency orange. ${en(f.nextStep)}`.trim(),source:{kind:'rule',ref:f.ruleId,label:f.source??'NRN-CLIN-ALG-001'},
  timing:en(consultationWindow(decision)),
  member:{en:[en(f.reason),f.nextStep?.en].filter(Boolean).join(' '),hy:[f.reason.hy,f.nextStep?.hy].filter(Boolean).join(' ')}});

 // Verified home readings: typed observations remain separate safety evidence.
 const recent=input.measurements.filter(m=>{const d=daysAgo(m.measured_at,now);return !isUnverifiedBp(m)&&d!=null&&d<=30;});
 const avg=recent.length?{sys:Math.round(recent.reduce((s,m)=>s+m.systolic,0)/recent.length),dia:Math.round(recent.reduce((s,m)=>s+m.diastolic,0)/recent.length)}:null;
 if(avg)add({id:'bp:home-average',section:'assessment',status:'protocol',text:`Home readings, last 30 days: average ${avg.sys}/${avg.dia} mmHg over ${recent.length} readings.`,
  rationale:'Average computed in code from the readings the member recorded. Protocol v2 section 1: home average at or above 135/85 meets the diagnostic threshold; a valid home series is 7 days, morning and evening.',
  source:{kind:'measurement',ref:'home-readings-30d',label:'Member-recorded readings'},timing:null,
  member:{en:`Your recorded blood pressure averaged ${avg.sys}/${avg.dia} mmHg over ${recent.length} readings in the last 30 days.`,
   hy:`Վերջին 30 օրում ձեր գրանցած ճնշման միջինը ${avg.sys}/${avg.dia} մմ ս.ս. է՝ ${recent.length} չափումից։`}});
 else add({id:'gap:no-home-readings',section:'data_gap',status:'needs_doctor_judgement',text:input.measurements.some(isUnverifiedBp)?'No verified home blood pressure readings in the last 30 days. Member-reported, not verified observations are listed separately.':'No home blood pressure readings in the last 30 days.',
  rationale:'Protocol v2 section 1: the questionnaire does not confirm the diagnosis; confirm with valid measurements.',source:{kind:'protocol',ref:'NRN-LAB-CAT-001 v2 §1',label:'Lab protocol v2'},timing:null,member:null});

 // Nurse visit observations: the latest value of each field.
 const obs=new Map<string,{value:number;unit:string;at:string}>();
 for(const v of input.visits)for(const e of v.entries){const p=e.payload;if(p.kind==='observation'&&p.state==='known'){const o=obs.get(p.field);if(!o||o.at<p.observedAt)obs.set(p.field,{value:p.value,unit:p.unit,at:p.observedAt});}}
 // Nurse visit reading: the latest complete pair, systolic and diastolic from the same visit at the same
 // instant. Fields are never mixed across observations (audit B2-4).
 let vs:{value:number;at:string}|undefined,vd:{value:number}|undefined;
 for(const v of input.visits){
  const known=v.entries.flatMap(e=>{const p=e.payload;return p.kind==='observation'&&p.state==='known'?[p]:[];});
  for(const s of known){
   if(s.field!=='systolic'||(vs&&vs.at>=s.observedAt))continue;
   const d=known.find(p=>p.field==='diastolic'&&p.observedAt===s.observedAt);
   if(d){vs={value:s.value,at:s.observedAt};vd={value:d.value};}
  }
 }
 if(vs&&vd)add({id:'bp:visit',section:'assessment',status:'protocol',text:`Nurse visit reading ${vs.value}/${vd.value} mmHg, ${daysAgo(vs.at,now)} days ago.`,
  rationale:'Recorded by the nurse at the visit. Protocol v2 section 1: office reading at or above 140/90 meets the diagnostic threshold.',source:{kind:'visit',ref:'visit:bp',label:'Nurse visit'},timing:null,
  member:{en:`At your visit the nurse measured ${vs.value}/${vd.value} mmHg.`,hy:`Այցի ժամանակ բուժքույրը չափել է ${vs.value}/${vd.value} մմ ս.ս.։`}});

 // Engine findings that need attention (not lifestyle, which becomes goals; not orange, already listed).
 for(const f of decision.findings.filter(f=>f.urgency!=='orange'&&!['lifestyle','reassuring','missing-data'].includes(f.category)))add({id:`finding:${f.ruleId}`.toLowerCase(),section:'assessment',status:'protocol',
  text:`${f.ruleId}: ${en(f.reason)}`,rationale:`Rules engine finding (${f.category}), urgency ${f.urgency}, from the questionnaire.`,source:{kind:'rule',ref:f.ruleId,label:f.source??'NRN-CLIN-ALG-001'},timing:null,
  member:{en:`From your health questions: ${en(f.reason)}`,hy:`Ձեր առողջական հարցերից՝ ${f.reason.hy}`}});

 // Reviewed lab values outside the lab's range or matching a THRESHOLD rule.
 const values=input.labValues.map(v=>({v,c:canonical(v)}));
 // Item ids are request-local (lab:1, lab:2...); the database id stays in source.ref, which never reaches the model.
 let labNo=0;
 for(const {v,c} of values){
  if(!c||!(v.attention||(v.labFlag&&v.labFlag!=='normal')))continue;
  add({id:`lab:${++labNo}`,section:'assessment',status:'protocol',text:`${c.label} ${c.value} ${c.unit}${v.labFlag&&v.labFlag!=='normal'?` (lab flag ${v.labFlag})`:''}, ${v.status==='auto_accepted'?AI_READ_LABEL.en:v.status}.`,
   rationale:v.status==='auto_accepted'?AI_READ_LABEL.en:v.attention==='threshold'?'Reviewed value at a THRESHOLD rule (NRN-CLIN-ALG-001).':'Reviewed value outside the lab reference range.',source:{kind:'lab',ref:v.valueId,label:c.label},timing:null,
   member:v.status==='auto_accepted'?null:{en:`${c.label}: ${c.value} ${c.unit}, outside the lab's reference range.`,hy:`${c.label}՝ ${c.value} ${c.unit}, լաբորատորիայի նորմայից դուրս։`}});
 }
 // Unverified values remain excluded. System confirmations inform the doctor without becoming a review task.
 const unreviewed=input.labValues.filter(v=>v.status==='unverified');
 if(unreviewed.length)add({id:'gap:unreviewed-values',section:'data_gap',status:'needs_doctor_judgement',
  text:`${unreviewed.length} AI-read lab values are not reviewed yet${unreviewed.some(v=>v.attention)?', including values marked for attention':''}: ${[...new Set(unreviewed.map(v=>v.catalogueRef?analyteByKey(v.catalogueRef)?.label??v.catalogueRef:'unmapped test'))].slice(0,12).join(', ')}.`,
  rationale:'Protocol v2: an unchecked value read from a document cannot trigger a decision. They are not used in this draft.',source:{kind:'protocol',ref:'NRN-LAB-CAT-001 v2 data and AI',label:'Lab protocol v2'},timing:null,member:null});
 const autoConfirmed=input.labValues.filter(v=>v.status==='auto_accepted');
 if(autoConfirmed.length)add({id:'info:ai-read:values',section:'assessment',status:'protocol',text:`${autoConfirmed.length} · ${AI_READ_LABEL.en}`,
  rationale:AI_READ_LABEL.en,source:{kind:'protocol',ref:'lab-auto-accept-v2',label:AI_READ_LABEL.en},timing:null,member:null});
 const unknown=unknownFields(input.assessment!.answers as Answers);
 if(unknown.length)add({id:'gap:unknown-answers',section:'data_gap',status:'needs_doctor_judgement',text:`${unknown.length} questionnaire items are unknown.`,
  rationale:'NRN-CLIN-ALG-001 rule 3: a missing answer is not a normal one.',source:{kind:'questionnaire',ref:'unknown-fields',label:'Questionnaire'},timing:null,member:null});

 // BP target: no rule sets it (Q1).
 add({id:'bp:target',section:'bp_target',status:'needs_doctor_judgement',text:'Set the blood pressure target for this member.',
  rationale:'NRN-CLIN-ALG-001 v1.1 and protocol v2 give diagnostic thresholds (home 135/85, office 140/90), not a treatment target. Open question Q1 for Armen.',
  source:{kind:'protocol',ref:'NRN-LAB-CAT-001 v2 §1',label:'Lab protocol v2'},timing:null,member:null});

 // Lifestyle goals: the engine's lifestyle findings and their next steps.
 for(const f of decision.findings.filter(f=>f.category==='lifestyle'))add({id:`lifestyle:${f.ruleId}`.toLowerCase(),section:'lifestyle',status:'protocol',
  text:`${f.ruleId}: ${en(f.nextStep)||en(f.reason)}`,rationale:`Rules engine lifestyle finding: ${en(f.reason)}`,source:{kind:'rule',ref:f.ruleId,label:f.source??'NRN-CLIN-ALG-001'},timing:null,
  // A next step addressed to the clinician (for example the heavy-smoking note) stays with the doctor.
  member:/\bclinician\b/i.test(en(f.nextStep))?null:{en:en(f.nextStep)||en(f.reason),hy:f.nextStep?.hy??f.reason.hy}});

 // Tests: planned tests with no value yet, then protocol v2 notes on reviewed values.
 const found=new Set(input.labValues.map(v=>v.catalogueRef?analyteByKey(v.catalogueRef)?.row:null).filter(Boolean));
 const required=new Set(requiredTests(decision).map(t=>t.id));
 for(const t of buildPlan(decision)){
  const refs=t.catalogueRef==null?[]:Array.isArray(t.catalogueRef)?t.catalogueRef:[t.catalogueRef];
  if(!refs.length||t.category!=='laboratory')continue;
  if(refs.some(r=>found.has(r)))continue;
  // Only for discussion: nothing books it, so the member is never told to complete it.
  if(!required.has(t.id)){add({id:`test:${t.id}`,section:'tests',status:'needs_doctor_judgement',text:`${en(t.name)}: for discussion, no result yet.`,
   rationale:`Suggested by the rules engine (${t.sourceRuleIds.join(', ')}). Not a requirement to publish or book.`,source:{kind:'rule',ref:t.sourceRuleIds[0]??t.id,label:'NRN-CLIN-ALG-001 test plan'},timing:null,member:null});continue;}
  if(!refs.some(r=>LAB_ANALYTES.some(a=>a.row===r))){
   add({id:`test:${t.id}`,section:'tests',status:'needs_doctor_judgement',text:`${en(t.name)}: planned; the lab reader cannot map this result. Check the lab documents.`,
    rationale:`Suggested by the rules engine (${t.sourceRuleIds.join(', ')}).`,source:{kind:'rule',ref:t.sourceRuleIds[0]??t.id,label:'NRN-CLIN-ALG-001 test plan'},timing:null,member:null});
   continue;
  }
  add({id:`test:${t.id}`,section:'tests',status:'protocol',text:`${en(t.name)}: planned, no result yet.`,rationale:`Suggested by the rules engine (${t.sourceRuleIds.join(', ')}).`,
   source:{kind:'rule',ref:t.sourceRuleIds[0]??t.id,label:'NRN-CLIN-ALG-001 test plan'},timing:null,
   member:{en:`Complete the planned test: ${en(t.name)}.`,hy:`Կատարեք պլանավորված հետազոտությունը՝ ${t.name.hy}։`}});
 }
 const best=(key:string)=>values.filter(x=>x.c?.key===key).sort((a,b)=>(b.v.collectedOn??'').localeCompare(a.v.collectedOn??''))[0];
 const ldl=best('ldl_c');
 if(ldl?.c&&ldl.c.value>=THRESHOLD.phase2LdlHigh)add({id:'protocol:ldl-assessment',section:'tests',status:'needs_doctor_judgement',
  text:`LDL-C ${ldl.c.value} mmol/L: open a lipid assessment. Not a familial hypercholesterolaemia label.`,rationale:'Protocol v2 section 8 and decision tree phase 2: untreated LDL-C at or above 4.9 mmol/L opens a clinician lipid assessment.',
  source:{kind:'lab',ref:ldl.v.valueId,label:'LDL-C'},timing:null,member:null});
 const uacr=best('uacr');
 if(uacr?.c&&uacr.c.value>=THRESHOLD.labProtocolUacrA2)add({id:'protocol:uacr-confirm',section:'tests',status:'needs_doctor_judgement',
  text:`uACR ${uacr.c.value} mg/mmol: confirm with a repeat sample. One raised value is not chronic kidney disease.`,rationale:'Protocol v2 section 3: confirm a positive uACR by repetition; CKD needs at least 3 months. Timing is not stated (Q3).',
  source:{kind:'lab',ref:uacr.v.valueId,label:'uACR'},timing:null,member:null});
 const egfr=best('egfr');
 if(egfr?.c&&egfr.c.value<THRESHOLD.labProtocolEgfrG3)add({id:'protocol:egfr-chronicity',section:'tests',status:'needs_doctor_judgement',
  text:`eGFR ${egfr.c.value}: a single low value is not chronic kidney disease; check persistence over at least 3 months.`,rationale:'Protocol v2 section 3: CKD needs an abnormality persisting at least 3 months. Repeat timing is the doctor\'s (Q3).',
  source:{kind:'lab',ref:egfr.v.valueId,label:'eGFR'},timing:null,member:null});
 const a1c=best('hba1c');
 if(a1c?.c&&a1c.c.value>=THRESHOLD.phase2NewDiabetesHba1c)add({id:'protocol:hba1c',section:'tests',status:'needs_doctor_judgement',
  text:`HbA1c ${a1c.c.value} %: at or above the decision tree's new-diabetes level; confirm and decide the next step.`,rationale:'Decision tree v1.1 phase 2: HbA1c at or above 6.5 % needs doctor review. No diagnosis from one value.',
  source:{kind:'lab',ref:a1c.v.valueId,label:'HbA1c'},timing:null,member:null});
 add({id:'protocol:annual-labs',section:'tests',status:'protocol',text:'Review the core laboratory tests at least once a year, earlier with risk or a treatment change.',
  rationale:'Protocol v2 section 4, stable hypertension.',source:{kind:'protocol',ref:'NRN-LAB-CAT-001 v2 §4',label:'Lab protocol v2'},timing:'At least yearly',
  member:{en:'Your core blood and urine tests are repeated at least once a year, or sooner if your treatment changes.',hy:'Արյան և մեզի հիմնական հետազոտությունները կրկնվում են առնվազն տարին մեկ անգամ, կամ ավելի շուտ՝ բուժման փոփոխության դեպքում։'}});

 // Follow-up.
 const outstanding=items.some(i=>i.id.startsWith('test:'))||unreviewed.length>0;
 if(outstanding)add({id:'follow:results-outstanding',section:'follow_up',status:'protocol',text:'Some results are outstanding or not reviewed; confirm the review date once they are in.',
  rationale:`Engine consultation window: ${en(consultationWindow(decision))}${windowDays!=null?` (${windowDays} days)`:''}.`,source:{kind:'rule',ref:'consultation-window',label:'NRN-CLIN-ALG-001'},timing:en(consultationWindow(decision)),
  member:{en:'Your doctor will confirm your next review once the remaining results are in.',hy:'Ձեր բժիշկը կհաստատի հաջորդ վերանայման օրը՝ մնացած արդյունքները ստանալուց հետո։'}});
 // The protocol rhythm assumes treatment; whether it applies is Armen's Q4, so it stays with the doctor.
 add({id:'follow:rhythm',section:'follow_up',status:'needs_doctor_judgement',text:'Protocol rhythm for treated hypertension: visits about monthly until the target is reached, then every 3 to 6 months. For untreated members, set the follow-up yourself.',
  rationale:'Protocol v2 section 4, stable hypertension.',source:{kind:'protocol',ref:'NRN-LAB-CAT-001 v2 §4',label:'Lab protocol v2'},timing:'Monthly, then every 3 to 6 months (if treated)',member:null});
 if(!outstanding)add({id:'follow:confirm-date',section:'follow_up',status:'protocol',text:'The doctor confirms the next review date.',rationale:'No timing is stated.',
  source:{kind:'protocol',ref:'noreon-product',label:'Noreon'},timing:null,
  member:{en:'Your doctor confirms the date of your next review.',hy:'Հաջորդ վերանայման օրը հաստատում է ձեր բժիշկը։'}});

 // Medicines: doctor-only notes from protocol v2 section 4. No drug choice, no dose (Q2).
 add({id:'med:decision',section:'medication_consideration',status:'needs_doctor_judgement',text:'Treatment decision is yours. No rule in this product selects a medicine or a dose.',
  rationale:'Protocol v2: AI may explain and summarise but does not prescribe, change or stop treatment. The post-test decision rules are under clinical review.',
  source:{kind:'protocol',ref:'NRN-LAB-CAT-001 v2 data and AI',label:'Lab protocol v2'},timing:null,member:null});
 const has=(key:string)=>values.some(x=>x.c?.key===key);
 add({id:'med:safety-baseline',section:'medication_consideration',status:'needs_doctor_judgement',
  text:`Before an ACE inhibitor, ARB, diuretic or MRA: creatinine/eGFR, potassium and sodium. Available here: creatinine ${has('creatinine')?'yes':'no'}, eGFR ${has('egfr')?'yes':'no'}. Potassium and sodium are not read by the lab reader; check the lab PDF. Repeat 7 to 14 days after a start or dose increase.`,
  rationale:'Protocol v2 section 4 (medication safety monitoring).',source:{kind:'protocol',ref:'NRN-LAB-CAT-001 v2 §4',label:'Lab protocol v2'},timing:'7 to 14 days after a start or dose increase',member:null});
 if(egfr?.c&&egfr.c.value<THRESHOLD.labProtocolEgfrG3)add({id:'med:kidney',section:'medication_consideration',status:'needs_doctor_judgement',
  text:'Reduced eGFR: protocol v2 asks for an individual decision before a RAS blocker or MRA when eGFR is very low.',rationale:'Protocol v2 section 4, safety interpretation. "Very low" is not defined yet.',
  source:{kind:'lab',ref:egfr.v.valueId,label:'eGFR'},timing:null,member:null});
 add({id:'med:no-delay',section:'medication_consideration',status:'needs_doctor_judgement',text:'Do not delay a needed treatment start waiting for the full test list or Lp(a).',
  rationale:'Protocol v2 section 1.',source:{kind:'protocol',ref:'NRN-LAB-CAT-001 v2 §1',label:'Lab protocol v2'},timing:null,member:null});

 const age=ageYears(input),last=input.publications.map(p=>daysAgo(p.publishedAt,now)).filter((d):d is number=>d!=null).sort((a,b)=>a-b)[0]??null;
 // Facts: no name, phone, birth date, ids of people, clinic or PDF text. Relative days only.
 const facts={version:BUILDER_VERSION,language:input.summaryLanguage??input.language,memberLanguage:input.memberLanguage===undefined?input.language:input.memberLanguage,
  member:{ageYears:age,sex:sex(input)},
  triage:{urgency:decision.urgency,consultationWindowDays:windowDays},
  findings:decision.findings.filter(f=>f.category!=='reassuring').map(f=>({rule:f.ruleId,category:f.category,urgency:f.urgency,reason:en(f.reason)})),
  bp:{last30Days:avg?{count:recent.length,averageSystolic:avg.sys,averageDiastolic:avg.dia}:null,
   readings:[...input.measurements].sort((a,b)=>b.measured_at.localeCompare(a.measured_at)).slice(0,20).map(m=>({daysAgo:daysAgo(m.measured_at,now),systolic:m.systolic,diastolic:m.diastolic,pulse:m.pulse,...(isUnverifiedBp(m)?{entrySource:m.entry_source,provenance:unverifiedBpLabel(input.language)}:{})}))},
  visit:[...obs.entries()].map(([field,o])=>({field,value:o.value,unit:o.unit,daysAgo:daysAgo(o.at,now)})),
  labs:{reviewed:values.filter(x=>x.c&&reviewed(x.v)).map(({v,c})=>({test:c!.label,value:c!.value,unit:c!.unit,labFlag:v.labFlag,daysAgo:daysAgo(v.collectedOn,now)})),
   autoConfirmed:values.filter(x=>x.c&&x.v.status==='auto_accepted').map(({v,c})=>({test:c!.label,value:c!.value,unit:c!.unit,labFlag:v.labFlag,daysAgo:daysAgo(v.collectedOn,now),provenance:AI_READ_LABEL[input.language]})),
   notReviewed:[...new Set(unreviewed.map(v=>v.catalogueRef?analyteByKey(v.catalogueRef)?.label??'unmapped test':'unmapped test'))]},
  plans:{published:input.publications.length,lastDaysAgo:last},
  items:items.map(i=>({id:i.id,section:i.section,status:i.status,memberFacing:i.member!==null,text:i.text,timing:i.timing,default:i.member?i.member[input.language]:null})),
 };
 const fingerprint=createHash('sha256').update(JSON.stringify({facts,builder:BUILDER_VERSION,prompt:PROMPT_VERSION})).digest('hex');
 return {facts,items,decision,fingerprint};
}
