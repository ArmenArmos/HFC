import type {ZoeJob,FinishInput} from '../pipeline';
import type {AlarmTrigger} from '../alarm-conversation';
import {MONITORED_MIN} from '../urgent-window';

// Fictional wall time shared by the suite's minute-based messages and saved readings.
const EPOCH=Date.parse('2026-10-30T12:00:00Z');
const iso=(minute:number)=>new Date(EPOCH+minute*60_000).toISOString();
const age=(now:number,at:number)=>Math.max(0,Math.floor(now-at));
type SavedReading={id:string;version:string;systolic:number;diastolic:number;measuredAt:number;savedAt:number};
type Publication={seq:number;at:number;startedAt:number;reason:string;urgent:boolean;continues:boolean;trigger:AlarmTrigger|null};

/** In-memory transcription of zoe_run_alarm_window for sequential conversation evals.
 * Assumes permitted publication, as the suite already does; no consent/doctor-mode races.
 * Ordinary publications close the legacy window. Flagged continuations retain the member alarm.
 */
export class ConversationState {
 private publications:Publication[]=[];
 private clear:{at:number;seq:number;readingId:string|null;readingVersion:string|null}|null=null;
 readonly reading:SavedReading|null;
 constructor(reading:{systolic:number;diastolic:number;minutesAgo:number}|null,firstTurnAt:number){
  this.reading=reading?{id:'00000000-0000-4000-8000-000000000901',version:'1',systolic:reading.systolic,diastolic:reading.diastolic,measuredAt:firstTurnAt-reading.minutesAgo,savedAt:firstTurnAt-reading.minutesAgo}:null;
 }
 latestReading(now:number){
  const r=this.reading;
  return r?{systolic:r.systolic,diastolic:r.diastolic,minutesAgo:age(now,r.measuredAt)}:null;
 }
 context(now:number):Pick<ZoeJob,'urgentSinceMinutes'|'urgentOpenedBy'|'urgentThroughSeq'|'memberClear'>{
  const rows=this.publications.filter(p=>p.at<=now);
  const window=(talking:boolean)=>{
   const boundary=Math.max(-Infinity,...rows.filter(p=>!p.urgent&&!(talking&&p.continues)).map(p=>p.at));
   return rows.filter(p=>p.urgent&&p.at>boundary&&!(p.reason==='urgent_in_window_no_model_call'&&p.startedAt<=boundary));
  };
  const legacy=window(false),talking=window(true);
  const effective=talking.filter(p=>!this.clear||p.at>this.clear.at&&!(p.reason==='urgent_in_window_no_model_call'&&p.startedAt<=this.clear.at));
  const opener=(ps:Publication[])=>ps.length?ps.every(p=>['urgent_health_answer_model','urgent_in_window_no_model_call'].includes(p.reason))&&ps.some(p=>p.reason==='urgent_health_answer_model')?'model' as const:'rule' as const:null;
  const anchor=effective[0]?.at,r=this.reading;
  // The latest non-repeat urgent answer is the SQL trigger source, even if it has no snapshot.
  const trigger=effective.filter(p=>p.reason!=='urgent_in_window_no_model_call').at(-1)?.trigger??null;
  return {urgentSinceMinutes:legacy[0]?age(now,legacy[0].at):null,urgentOpenedBy:opener(legacy),urgentThroughSeq:legacy.length?Math.max(...legacy.map(p=>p.seq)):null,
   memberClear:{startedAt:anchor===undefined?null:iso(anchor),sinceMinutes:anchor===undefined?null:age(now,anchor),openedBy:opener(effective),throughSeq:effective.length?Math.max(...effective.map(p=>p.seq)):null,trigger,
    clearThroughSeq:this.clear?.seq??null,clearSinceMinutes:this.clear?age(now,this.clear.at):null,
    readingId:r?.id??null,readingVersion:r?.version??null,readingSavedAt:r?iso(r.savedAt):null,readingMeasuredAt:r?iso(r.measuredAt):null,
    readingClearReason:null,suppressStoredReading:!!r&&r.id===this.clear?.readingId&&r.version===this.clear?.readingVersion}};
 }
 finish(seq:number,startedAt:number,at:number,f:FinishInput){
  const ctx=this.context(startedAt).memberClear!;
  if(f.memberClearEnabled&&f.outcome==='summary_only'&&f.reason==='member_cleared_urgent_window'&&f.memberClear
   &&ctx.startedAt&&ctx.sinceMinutes!<=MONITORED_MIN&&f.memberClear.startedAt===ctx.startedAt&&f.memberClear.readingId===ctx.readingId&&f.memberClear.readingVersion===ctx.readingVersion){
   this.clear={at,seq,readingId:f.memberClear.readingId,readingVersion:f.memberClear.readingVersion};
  }
  if(!f.answer&&!f.receipt)return;
  const urgent=!!f.answer&&(f.outcome==='intake_escalated'||f.outcome==='discarded'&&['urgent_route_no_model_call','urgent_in_window_no_model_call','urgent_health_answer_model','urgent_health_answer_red_flag_yes'].includes(f.reason));
  this.publications.push({seq,at,startedAt,reason:f.reason,urgent,continues:f.events.some(e=>e.name==='zoe.urgent.conversation'&&e.reason==='alarm_conversation_continues'),trigger:urgent&&f.reason!=='urgent_in_window_no_model_call'?f.alarmTrigger??null:null});
 }
}
