import {addDays, yerevanDate} from '../../bp-week/model';
import {THRESHOLD as T} from './thresholds';
import type {BpNumbers} from './bp-check';

export type BpTrendReading = BpNumbers & {measured_at: string};
export type BpWeeklyTrend = {
  weekStart: string;
  thisMean: BpNumbers;
  previousMean: BpNumbers | null;
  change: BpNumbers | null;
  morning: BpNumbers | null;
  evening: BpNumbers | null;
  readingsThis: number;
  readingsPrevious: number;
  daysMeasured: number;
  trend: 'worsening' | 'stable' | 'improving';
  nextStep: 'mornings' | 'twice_daily' | 'keep';
};
const mean = (rows: readonly BpNumbers[]): BpNumbers => ({
  systolic: rows.reduce((sum,r)=>sum+r.systolic,0)/rows.length,
  diastolic: rows.reduce((sum,r)=>sum+r.diastolic,0)/rows.length,
});
const rounded = (r: BpNumbers): BpNumbers => ({systolic:Math.round(r.systolic),diastolic:Math.round(r.diastolic)});

/** Draft for Armen. Raw means decide the trend; only displayed averages are rounded.
 * Today is included, future instants are excluded, and every source of home readings counts.
 * A flag is stored for part B; it does not notify the doctor or change the save-time BP check.
 */
export function bpWeeklyTrend(readings: readonly BpTrendReading[], now: Date): BpWeeklyTrend | null {
  const today=yerevanDate(now), start=addDays(today,1-T.bpTrendWindowDays), previousStart=addDays(start,-T.bpTrendWindowDays);
  const current: BpTrendReading[]=[], previous: BpTrendReading[]=[], morning: BpTrendReading[]=[], evening: BpTrendReading[]=[];
  const days=new Set<string>();
  for(const r of readings) {
    const at=new Date(r.measured_at);
    // Database rows are validated on save. Unknown/malformed inputs must never turn into zeroes.
    if(!Number.isFinite(at.getTime()) || at>now || !Number.isFinite(r.systolic) || !Number.isFinite(r.diastolic) || r.systolic<=0 || r.diastolic<=0) continue;
    const day=yerevanDate(at);
    if(day<previousStart || day>today) continue;
    if(day<start) {previous.push(r);continue;}
    current.push(r);days.add(day);
    const hour=new Date(at.getTime()+4*3600000).getUTCHours();
    if(hour<T.bpTrendMorningEndHour) morning.push(r);
    else if(hour>=T.bpTrendEveningStartHour) evening.push(r);
  }
  if(current.length<T.bpTrendSummaryReadings || days.size<T.bpTrendSummaryDays) return null;
  const a=mean(current), b=previous.length?mean(previous):null;
  let trend: BpWeeklyTrend['trend']='stable';
  if(b && current.length>=T.bpTrendMinReadings && previous.length>=T.bpTrendMinReadings) {
    // Compare integer sums across denominators: 135.2 - 125.2 is slightly below 10 in JS.
    const change=current.reduce((sum,r)=>sum+r.systolic,0)*previous.length-previous.reduce((sum,r)=>sum+r.systolic,0)*current.length;
    const cut=T.bpTrendChangeSystolic*current.length*previous.length;
    if(change>=cut && (a.systolic>=T.elevatedSystolic || a.diastolic>=T.elevatedDiastolic)) trend='worsening';
    else if(change<=-cut) trend='improving';
  }
  const thisMean=rounded(a), previousMean=b?rounded(b):null;
  const compare=morning.length>=T.bpTrendPeriodReadings && evening.length>=T.bpTrendPeriodReadings;
  const weekday=new Date(`${today}T00:00:00Z`).getUTCDay();
  return {weekStart:addDays(today,-((weekday+6)%7)),thisMean,previousMean,
    change:previousMean && previous.length>=T.bpTrendComparisonReadings?{systolic:thisMean.systolic-previousMean.systolic,diastolic:thisMean.diastolic-previousMean.diastolic}:null,
    morning:compare?rounded(mean(morning)):null,evening:compare?rounded(mean(evening)):null,
    readingsThis:current.length,readingsPrevious:previous.length,daysMeasured:days.size,trend,
    nextStep:days.size<T.bpTrendRegularDays?'mornings':trend==='worsening'?'twice_daily':'keep'};
}

export const bpWeeklyTrendsEnabled = (env: Record<string,string|undefined> = process.env) => env.NOREON_ZOE_BP_TRENDS === 'true';
