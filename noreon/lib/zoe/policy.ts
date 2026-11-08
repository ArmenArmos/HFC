/**
 * Zoe non-AI policy (K3, K7 decided 16 Oct 2026; design output/zoe-ai-design-2026-10-16/).
 * Pure functions: no model call, no provider, no clock or network of their own. Each returns
 * a decision shaped as a trace event so the Zoe path can journal it (recordZoeDecision).
 * Nothing here is wired to a sender yet; the Zoe runtime is not built.
 */

type Env=Record<string,string|undefined>;
export type ZoeDecision={name:`zoe.${string}`;outcome:'allow'|'block'|'escalate'|'skipped'|'recorded';reason:string;rule:string;ruleVersion:string;attributes:Record<string,string|number|boolean>};

/** Dark by default: the member consent card and any Zoe path exist only when this is exactly "true". */
export const zoeScaffoldEnabled=(env:Env=process.env)=>env.NOREON_ZOE_SCAFFOLD_ENABLED==='true';
/** The admin AI settings page (no AI calls of its own) exists only when this is exactly "true". */
export const zoeAiSettingsEnabled=(env:Env=process.env)=>env.NOREON_ZOE_AI_SETTINGS_ENABLED==='true';
/** Dark: the message pipeline runs only when both the scaffold flag and NOREON_ZOE_PIPELINE_ENABLED are exactly "true". */
export const zoePipelineEnabled=(env:Env=process.env)=>zoeScaffoldEnabled(env)&&env.NOREON_ZOE_PIPELINE_ENABLED==='true';

export const K3_RULE_VERSION='k3-a-2026-10-16';
export const K7_RULE_VERSION='k7-a-2026-10-16';
export type QuietHours={start:string;end:string;timeZone:string};
/** K3: 21:00 to 09:00 Yerevan. */
export const DEFAULT_QUIET_HOURS:QuietHours=Object.freeze({start:'21:00',end:'09:00',timeZone:'Asia/Yerevan'});
/** K3: at most 2 scheduled questions per member per day unless the doctor's plan says more. */
export const DEFAULT_SCHEDULED_DAILY_MAX=2;
// These constants are the decided defaults. zoe_settings holds the same values for the future
// runtime; before activation the runtime must read zoe_settings and pass them in here.
/** K7: US$10 per day. Configuration may lower it, never raise it. */
export const DECIDED_DAILY_SPEND_CAP_USD=10;

const hhmm=/^([01]\d|2[0-3]):([0-5]\d)$/;
const minutes=(t:string)=>{const m=hhmm.exec(t);if(!m)throw Error(`Invalid time ${t}`);return Number(m[1])*60+Number(m[2]);};

/** Wall-clock parts in a time zone, from Intl (no hand-coded offsets). */
export function zonedParts(now:Date,timeZone:string){
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(p=>[p.type,p.value]));
 return {day:`${parts.year}-${parts.month}-${parts.day}`,minute:Number(parts.hour)*60+Number(parts.minute)};
}

/** True inside quiet hours. The window may cross midnight (21:00 to 09:00). Equal start and end means no quiet hours. */
export function inQuietHours(now:Date,q:QuietHours=DEFAULT_QUIET_HOURS){
 const s=minutes(q.start),e=minutes(q.end),{minute}=zonedParts(now,q.timeZone);
 if(s===e)return false;
 return s<e?minute>=s&&minute<e:minute>=s||minute<e;
}

/**
 * Whether one more scheduled question may go to a member now. sentToday counts questions
 * already sent on the member's current Yerevan day. planDailyMax is the doctor's plan value,
 * which may only raise the default ("unless the doctor's plan says more").
 */
export function scheduledQuestionDecision(input:{now:Date;sentToday:number;planDailyMax?:number|null;quietHours?:QuietHours;defaultDailyMax?:number}):ZoeDecision{
 const q=input.quietHours??DEFAULT_QUIET_HOURS,base=input.defaultDailyMax??DEFAULT_SCHEDULED_DAILY_MAX;
 // The plan may raise the default, up to the database bound of 10 a day.
 const plan=Number.isSafeInteger(input.planDailyMax)&&(input.planDailyMax as number)>base?Math.min(input.planDailyMax as number,10):base;
 const sent=Number.isSafeInteger(input.sentToday)&&input.sentToday>=0?input.sentToday:Number.POSITIVE_INFINITY;
 const attributes={'noreon.zoe.sent_today':Number.isFinite(sent)?sent:-1,'noreon.zoe.daily_max':plan,'noreon.zoe.local_day':zonedParts(input.now,q.timeZone).day,'noreon.zoe.quiet_hours':`${q.start}-${q.end} ${q.timeZone}`};
 if(inQuietHours(input.now,q))return {name:'zoe.scheduled_question',outcome:'block',reason:'quiet_hours',rule:'zoe.k3.quiet_hours',ruleVersion:K3_RULE_VERSION,attributes};
 // An unreadable count fails closed.
 if(sent>=plan)return {name:'zoe.scheduled_question',outcome:'block',reason:Number.isFinite(sent)?'daily_question_cap_reached':'sent_count_unknown',rule:'zoe.k3.daily_max',ruleVersion:K3_RULE_VERSION,attributes};
 return {name:'zoe.scheduled_question',outcome:'allow',reason:'within_schedule_limits',rule:'zoe.k3',ruleVersion:K3_RULE_VERSION,attributes};
}

/** K7 cap from configuration: unset means the decided US$10; anything invalid or above it fails closed to 0. */
export function dailySpendCapUsd(env:Env=process.env){
 const raw=env.NOREON_ZOE_DAILY_SPEND_CAP_USD;
 if(raw===undefined||raw==='')return DECIDED_DAILY_SPEND_CAP_USD;
 const v=Number(raw);
 return /^\d+(\.\d{1,2})?$/.test(raw)&&v>=0&&v<=DECIDED_DAILY_SPEND_CAP_USD?v:0;
}

/**
 * Whether a model call costing about estimateUsd may start. Model calls are not allowed at
 * all yet (K2 launch gate: DPA, Q17, residency evidence), so this blocks before any cap
 * arithmetic unless modelCallsAllowed is passed, which nothing in the app does today.
 * When blocked, urgent handling, acknowledgements and alerts continue (they never call this).
 */
export function spendCapDecision(input:{spentTodayUsd:number;estimateUsd:number;capUsd?:number;modelCallsAllowed?:boolean}):ZoeDecision{
 // A caller can lower the cap, never raise it above the decided US$10.
 const cap=Math.min(input.capUsd??DECIDED_DAILY_SPEND_CAP_USD,DECIDED_DAILY_SPEND_CAP_USD);
 const attributes={'noreon.zoe.spent_today_usd':input.spentTodayUsd,'noreon.zoe.estimate_usd':input.estimateUsd,'noreon.zoe.daily_cap_usd':cap};
 if(input.modelCallsAllowed!==true)return {name:'zoe.model_call',outcome:'block',reason:'model_calls_not_permitted',rule:'zoe.k2.launch_gate',ruleVersion:K7_RULE_VERSION,attributes};
 const valid=[input.spentTodayUsd,input.estimateUsd,cap].every(n=>Number.isFinite(n)&&n>=0);
 if(!valid)return {name:'zoe.model_call',outcome:'block',reason:'spend_unknown',rule:'zoe.k7.daily_spend_cap',ruleVersion:K7_RULE_VERSION,attributes};
 if(input.spentTodayUsd+input.estimateUsd>cap)return {name:'zoe.model_call',outcome:'block',reason:'daily_spend_cap_reached',rule:'zoe.k7.daily_spend_cap',ruleVersion:K7_RULE_VERSION,attributes};
 return {name:'zoe.model_call',outcome:'allow',reason:'within_daily_spend_cap',rule:'zoe.k7.daily_spend_cap',ruleVersion:K7_RULE_VERSION,attributes};
}
