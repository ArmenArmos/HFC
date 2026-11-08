import {resultsAssessment,type DatedResult,type ResultsAssessmentInput} from '@/lib/clinical/rules/results-assessment';
import type {Answers} from '@/lib/clinical/types';
import {analyteByKey,matchAnalyte,toCanonical} from '@/lib/lab-ai/catalogue';
import {ageOn} from '@/lib/patient/validation';
import {yerevanDate} from './format';
import type {GpReportSource} from './schema';
import {cat,day,join,l,type L} from './format';
import type {Row} from './builder';
import {categoryCopy,gateCopy,ruleCopy,score2ReasonCopy} from './results-copy';
import type {ResultsAssessment} from '@/lib/clinical/rules/results-assessment';

const analytes={total_cholesterol:'totalCholesterol',hdl_c:'hdl',ldl_c:'ldl',egfr:'egfr',uacr:'uacr',hba1c:'hba1c'} as const;
type LabKey=keyof ResultsAssessmentInput['labs'];
const keys=Object.keys(analytes);
const date=(raw:string):string|null=>{
 const on=/^\d{4}-\d{2}-\d{2}$/.test(raw)?raw:yerevanDate(raw);
 return Number.isFinite(Date.parse(on))&&new Date(`${on}T00:00:00Z`).toISOString().slice(0,10)===on?on:null;
};

/** Only reviewed numeric values with a known sample date enter Phase 2. No upload-date fallback. */
export function resultsInputFromSource(source:GpReportSource,readAt:string,answers:Answers|null,complete:boolean):ResultsAssessmentInput{
 const today=yerevanDate(readAt);
 type Candidate=DatedResult<number>&{reviewedAt:string;id:string};
 const lists:Record<LabKey,Candidate[]>={totalCholesterol:[],hdl:[],ldl:[],egfr:[],uacr:[],hba1c:[]};
 const add=(key:string|null,value:number|null,unit:string|null,onRaw:string|null,reviewedAt:string|null,id:string)=>{
  if(!key||!keys.includes(key)||value===null||!Number.isFinite(value)||!unit||!onRaw||!reviewedAt||Date.parse(reviewedAt)>Date.parse(readAt))return;
  const on=date(onRaw),analyte=analyteByKey(key);
  if(!on||on>today||!analyte)return;
  const canonical=toCanonical(analyte,value,unit);
  if(canonical===null||!Number.isFinite(canonical))return;
  lists[analytes[key as keyof typeof analytes]].push({value:canonical,on,reviewedAt,id});
 };
 for(const v of source.clinicLabValues)if(v.status==='verified'||v.status==='corrected')add(v.catalogueRef,v.value,v.unit,v.collectedOn,v.reviewedAt,v.id);
 for(const v of source.labResults)if(v.source!=='member'&&v.reviewedAt)add(matchAnalyte(v.marker),v.value,v.unit,v.collectedAt,v.reviewedAt,v.id);
 // Same-day ties are deterministic, using the most recent review then the row id.
 for(const list of Object.values(lists))list.sort((a,b)=>a.on.localeCompare(b.on)||a.reviewedAt.localeCompare(b.reviewedAt)||a.id.localeCompare(b.id));
 const latest=(key:LabKey,on?:string):DatedResult<number>|null=>{
  const v=(on?lists[key].filter(v=>v.on===on):lists[key]).at(-1);
  return v?{value:v.value,on:v.on}:null;
 };
 const sharedDay=lists.totalCholesterol.map(v=>v.on).filter(on=>lists.hdl.some(v=>v.on===on)).sort().at(-1);
 const entries:ResultsAssessmentInput['entries']={score2Percent:null,potassium:null,ecgLvh:null,ecgIschaemia:null,echoDone:null,ahi:null};
 const fields={score2_percent:'score2Percent',potassium:'potassium',ecg_lvh:'ecgLvh',ecg_ischaemia:'ecgIschaemia',echo_done:'echoDone',ahi:'ahi'} as const;
 for(const v of [...(source.resultEntries??[])].sort((a,b)=>a.enteredAt.localeCompare(b.enteredAt))){
  if(v.observedOn>today||Date.parse(v.enteredAt)>Date.parse(readAt))continue;
  const key=fields[v.field];
  if(key==='score2Percent'||key==='potassium'||key==='ahi')entries[key]=v.number===null?null:{value:v.number,on:v.observedOn};
  else entries[key]=v.finding===null?null:{value:v.finding,on:v.observedOn};
 }
 const birthAge=source.profile?.birthDate?ageOn(source.profile.birthDate,today):NaN;
 const answerAge=answers?.['q1.age']?.value;
 const age=Number.isFinite(birthAge)?birthAge:typeof answerAge==='number'&&Number.isFinite(answerAge)?answerAge:null;
 return {answers,questionnaireComplete:complete,age,
  labs:{totalCholesterol:sharedDay?latest('totalCholesterol',sharedDay):null,hdl:sharedDay?latest('hdl',sharedDay):null,ldl:latest('ldl'),egfr:latest('egfr'),uacr:latest('uacr'),hba1c:latest('hba1c')},
  latestTotalCholesterol:latest('totalCholesterol'),entries,
  awaitingReview:source.clinicLabValues.filter(v=>v.status==='unverified'&&(v.catalogueRef===null||keys.includes(v.catalogueRef))).length};
}

export function assessmentFromSource(source:GpReportSource,readAt:string,answers:Answers|null,complete:boolean){
 return resultsAssessment(resultsInputFromSource(source,readAt,answers,complete));
}

/** Presentation only: arithmetic and cut points stay in resultsAssessment. */
export function resultsRows(a:ResultsAssessment,input:ResultsAssessmentInput):{rows:Row[];gaps:L[]}{
 const na=l('Not available','Հասանելի չէ');
 const yesNo=(value:boolean|null)=>value===null?na:value?l('yes','այո'):l('no','ոչ');
 const dated=(v:DatedResult<number>|null,unit:string):L=>v?cat(`${v.value} ${unit}; `,day(v.on)):na;
 const target=a.ldlTarget;
 const gaps=a.gates.map(code=>gateCopy[code]);
 const rows:Row[]=[
  [l('non-HDL-C','non-HDL-C'),a.nonHdl?cat(`${a.nonHdl.value} mmol/L; `,day(input.labs.totalCholesterol!.on)):na,l('TC minus HDL-C from the same sample day.','TC − HDL-C՝ նույն նմուշառման օրվա տվյալներից։')],
  [l('LDL-C','LDL-C'),dated(input.labs.ldl,'mmol/L'),target?cat(l('Below ','Ցածր է '),`${target.mmol} mmol/L: `,yesNo(target.below)):l('No category, no target.','Կատեգորիա չկա, թիրախ չկա։')],
  [l('LDL-C reduction','LDL-C-ի նվազում'),target?.reductionPct?l(`At least ${target.reductionPct}%`,`Առնվազն ${target.reductionPct}%`):l('No reduction target assigned','Նվազման թիրախ նշանակված չէ'),target?.reductionPct?l('Cannot be assessed, no baseline.','Հնարավոր չէ գնահատել, ելակետ չկա։'):l('Not applicable','Կիրառելի չէ')],
  [l('Risk category','Ռիսկային կատեգորիա'),a.category?categoryCopy[a.category.level]:l('No category','Կատեգորիա չկա'),a.category?ruleCopy[a.category.rule]:join(gaps)],
  [l('SCORE2','SCORE2'),a.score2.state==='applicable'?(a.score2.percent===null?na:cat(`${a.score2.percent}%`,input.entries.score2Percent?cat('; ',day(input.entries.score2Percent.on)):'')):a.score2.state==='off'?l('Off','Անջատված'):l('Undecided','Որոշված չէ'),a.score2.state==='off'?join(a.score2.reasons.map(code=>score2ReasonCopy[code])):l('Entered from the ESC calculator. Noreon does not calculate this percentage.','Մուտքագրվում է ESC-ի հաշվիչից։ Նորեոն Հելթը այս տոկոսը չի հաշվարկում։')],
  [l('HMOD','HMOD'),a.hmod.status==='present'?l('Present','Առկա է'):a.hmod.status==='absent'?l('Absent','Չկա'):l('Unknown','Անհայտ'),l('Separate from diabetic target-organ damage.','Առանձին է ՇԴ-ի թիրախ-օրգանի վնասումից։')],
 ];
 const factLabels={potassium:l('Potassium','Կալիում'),ecgLvh:l('ECG LVH','ԷՍԳ-ով LVH'),ecgIschaemia:l('ECG ischaemic changes','ԷՍԳ-ով իշեմիկ փոփոխություններ'),echoDone:l('Echo done','ԷխոԿԳ կատարված է'),ahi:l('AHI','AHI')};
 for(const key of Object.keys(factLabels) as (keyof typeof factLabels)[]){
  const fact=a.facts[key];
  rows.push([factLabels[key],fact?cat(typeof fact.value==='number'?`${fact.value}${key==='potassium'?' mmol/L':''}`:fact.value==='yes'?l('yes','այո'):l('no','ոչ'),'; ',day(fact.on)):na,l('Doctor entry','Բժշկի մուտք')]);
 }
 return {rows,gaps};
}
