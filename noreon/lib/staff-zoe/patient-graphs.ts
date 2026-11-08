import type {ClinicalSnapshot} from '@/lib/patient-care/clinical-case-repository';
import type {BpWeekRead} from '@/lib/bp-week/model';
import {addDays,yerevanDate} from '@/lib/bp-week/model';
import {isUnverifiedBp} from '@/lib/patient/bp-provenance';
import type {ReportedValue} from '@/lib/member-history/measures';
import type {PatientLabValue} from './patient-labs';
import type {DoctorLdl} from '@/lib/ldl/schema';
import {ldlObservations} from '@/lib/ldl/status';
import {THRESHOLD} from '@/lib/clinical/rules/rules';
import {LAB_ANALYTES,toCanonical} from '@/lib/lab-ai/catalogue';
import {analyteOf} from './analyte';
import type {PlanLabEvidenceValue} from '@/lib/ai-plan/lab-evidence';
import type {TrendData,TrendPoint} from '@/components/charts/types';
export const GRAPH_IDS=['bp','ldl','hba1c','egfr','pulse','weight','streak'] as const;
export type GraphId=typeof GRAPH_IDS[number];
export type PatientGraphs={memberId:string;asOf:string;series:Record<GraphId,TrendData>;unavailable:GraphId[]};
const dayAt=(day:string)=>`${day}T12:00:00+04:00`;
const point=(id:string,at:string,values:number[],source:TrendPoint['source'],dateOnly=false):TrendPoint=>({id,at,values,source,...(dateOnly?{dateOnly:true}:{})});
/** Only numeric values with an explicit, supported unit belong on an axis. Never parse inequalities as values. */
export function labPoint(v:Pick<PatientLabValue,'id'|'testName'|'catalogueRef'|'value'|'unit'|'on'|'mark'>):{key:'ldl'|'hba1c'|'egfr';point:TrendPoint}|null{
 const key=analyteOf(v.testName),id=key==='ldl_c'?'ldl':key;
 if(id!=='ldl'&&id!=='hba1c'&&id!=='egfr')return null;
 if(!v.on||!/^\d{4}-\d{2}-\d{2}$/.test(v.on)||!v.unit||!/^\s*\d+(?:[.,]\d+)?\s*$/.test(v.value))return null;
 const analyte=LAB_ANALYTES.find(a=>a.key===key);if(!analyte)return null;
 const raw=Number(v.value.replace(',','.')),converted=toCanonical(analyte,raw,v.unit);
 if(converted===null||!Number.isFinite(converted))return null;
 const value=Number(converted.toPrecision(12));
 return {key:id,point:point(v.id,dayAt(v.on),[value],v.mark==='reviewed'?'reviewed':v.mark==='not-reviewed'?'unreviewed':'member',true)};
}
/** Display only. A personal LDL threshold must both exist in the read and belong to the clinical registry. */
export function registryLdlTarget(ldl:DoctorLdl|null):TrendData['target']{
 const goal=ldl?.enabled?[...ldl.goals].sort((a,b)=>b.version-a.version)[0]:null;
 const registry:Record<string,number>={very_high:THRESHOLD.ldlGoalVeryHigh,high:THRESHOLD.ldlGoalHigh,moderate:THRESHOLD.ldlGoalModerate,low:THRESHOLD.ldlGoalLow};
 return goal&&goal.thresholdMmol===registry[goal.category]?{below:registry[goal.category]!}:undefined;
}
export function snapshotBp(snapshot:ClinicalSnapshot):{bp:TrendPoint[];pulse:TrendPoint[];weight:TrendPoint[]}{
 const bp:TrendPoint[]=[],pulse:TrendPoint[]=[],weight:TrendPoint[]=[];
 const entries=(snapshot.evidence.visits??[]).flatMap(v=>v.entries);
 const clinicIds=new Set(entries.flatMap(e=>e.measurementId?[e.measurementId]:[]));
 for(const r of snapshot.evidence.measurements){
  const source=isUnverifiedBp(r)?'member':clinicIds.has(r.id)?'clinic':'home';
  bp.push(point(r.id,r.measured_at,[r.systolic,r.diastolic],source));
  if(r.pulse!==null)pulse.push(point(r.id,r.measured_at,[r.pulse],source));
 }
 for(const e of entries){const p=e.payload;if(p.kind!=='observation'||p.state!=='known')continue;
  if(p.field==='weight'&&p.unit==='kg')weight.push(point(e.id,p.observedAt,[p.value],'clinic'));
  if(p.field==='pulse'&&(!e.measurementId||!pulse.some(r=>r.id===e.measurementId)))pulse.push(point(e.id,p.observedAt,[p.value],'clinic'));
 }
 return {bp,pulse,weight};
}
export function buildPatientGraphs(memberId:string,snapshot:ClinicalSnapshot,week:BpWeekRead|null,labs:PatientLabValue[]|null,history:ReportedValue[]|null,ldl:DoctorLdl|null,now:Date):PatientGraphs|null{
 if(snapshot.id!==memberId)return null;
 const from=snapshotBp(snapshot),series=Object.fromEntries(GRAPH_IDS.map(id=>[id,{points:[]}])) as unknown as PatientGraphs['series'];
 series.bp.points=from.bp;series.pulse.points=from.pulse;series.weight.points=from.weight;
 const seen=new Set(from.bp.map(p=>p.id));
 if(week?.enabled)for(const w of week.weeks)for(const r of w.readings){
  const existing=from.bp.find(p=>p.id===r.id);if(existing){existing.slot=r.slot;continue;}
  if(seen.has(r.id))continue;seen.add(r.id);
  const source=isUnverifiedBp(r)?'member':'home';
  series.bp.points.push({...point(r.id,r.measuredAt,[r.systolic,r.diastolic],source),slot:r.slot});
  if(r.pulse!==null)series.pulse.points.push(point(r.id,r.measuredAt,[r.pulse],source));
 }
 for(const v of labs??[]){const p=labPoint(v);if(p)series[p.key].points.push(p.point);}
 // Only hand-entered history is used here. Upload values go through patientLabs' identity and approval gates.
 const labIds=new Set((labs??[]).map(v=>v.id));
 for(const v of history??[]){
  if(labIds.has(v.id)||v.source&&v.source!=='member-reported')continue;
  const source='member' as const;
  if(v.measure==='bp'&&v.unit==='mmHg'&&v.value2!==null)series.bp.points.push(point(v.id,dayAt(v.measuredOn),[v.value,v.value2],source,true));
  if(v.measure==='weight'&&v.unit==='kg')series.weight.points.push(point(v.id,dayAt(v.measuredOn),[v.value],source,true));
  const p=labPoint({id:v.id,testName:v.measure==='ldl_c'?'LDL-C':v.measure,catalogueRef:null,value:String(v.value),unit:v.unit,on:v.measuredOn,mark:'member-reported'});if(p)series[p.key].points.push(p.point);
 }
 if(ldl?.enabled)for(const r of ldlObservations(ldl.observations.filter(o=>o.source==='clinic_result'))){
  // File and history values already passed the identity gates above. Only add structured clinic results here.
  const id=r.id;
  if(series.ldl.points.some(p=>p.id===id))continue;
  series.ldl.points.push(point(id,dayAt(r.on),[r.mmol],r.counts?'reviewed':'unreviewed',true));
 }
 series.ldl.target=registryLdlTarget(ldl);
 // BP cut points classify readings, but the authorized read has no per-member BP target. Do not invent one.
 const today=yerevanDate(now),start=addDays(today,-27);
 const verified=series.bp.points.filter(p=>p.source!=='member'&&p.source!=='unreviewed');
 if(verified.length)for(let i=0;i<4;i++){
  const on=addDays(start,i*7),end=addDays(on,6),days=new Set(verified.map(p=>yerevanDate(new Date(p.at))).filter(d=>d>=on&&d<=end&&d<=today));
  series.streak.points.push(point(`week:${on}`,dayAt(on),[days.size],'verified',true));
 }
 const cutoff=now.getTime()-14*86400000;
 for(const id of GRAPH_IDS){series[id].points=series[id].points.filter(p=>Number.isFinite(Date.parse(p.at))&&(p.dateOnly?p.at.slice(0,10)<=today:Date.parse(p.at)<=now.getTime())&&p.values.every(Number.isFinite)&&(id!=='bp'&&id!=='pulse'||Date.parse(p.at)>=cutoff)).sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));}
 const unavailable:GraphId[]=[];
 if(!week)unavailable.push('bp','pulse','streak');
 if(labs===null)unavailable.push('ldl','hba1c','egfr');
 if(history===null)unavailable.push('bp','ldl','hba1c','weight');
 if(ldl===null)unavailable.push('ldl');
 return {memberId,asOf:now.toISOString(),series,unavailable};
}
/** The plan previews use exactly the token-matched evidence read for this draft, never fresh unrelated labs. */
export function planGraphEvidence(snapshot:ClinicalSnapshot,values:PlanLabEvidenceValue[]):{bp:TrendData;ldl:TrendData}{
 const ldl=values.flatMap(v=>{const p=labPoint({id:v.valueId,testName:v.testName,catalogueRef:v.catalogueRef,value:String(v.value),unit:v.unit,on:v.collectedOn,mark:v.status==='verified'||v.status==='corrected'?'reviewed':v.status==='member-reported'?'member-reported':'not-reviewed'});return p?.key==='ldl'?[p.point]:[];});
 return {bp:{points:snapshotBp(snapshot).bp},ldl:{points:ldl}};
}
