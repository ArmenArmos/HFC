/** Pure helpers for the job ledger (lib/jobs/contract.ts). Kept free of server imports for checks. */
export type JobOutcome='ok'|'partial'|'skipped'|'error';

/** A state word or two, optionally with a count: "on", "disabled", "queued 3". Never an id. */
const STATE=/^[a-z][a-z_ -]{0,30}( \d{1,6})?$/;
const MAX_KEYS=40;

/**
 * The numbers of a sweep report for the ledger: numbers, booleans and short state words (for example
 * "on", "queued 3", "disabled"), at most three levels deep. Anything else (ids, free text, arrays) is
 * dropped, so a report can never carry member data into the ledger.
 */
export function jobCounts(report:unknown,depth=0):Record<string,unknown>{
 if(!report||typeof report!=='object'||Array.isArray(report))return {};
 const out:Record<string,unknown>={};
 for(const [key,value] of Object.entries(report).slice(0,MAX_KEYS)){
  if(!/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(key))continue;
  if(typeof value==='number'&&Number.isFinite(value))out[key]=value;
  else if(typeof value==='boolean')out[key]=value;
  else if(typeof value==='string'&&STATE.test(value))out[key]=value;
  else if(value&&typeof value==='object'&&!Array.isArray(value)&&depth<2){
   const nested=jobCounts(value,depth+1);
   if(Object.keys(nested).length)out[key]=nested;
  }
 }
 return out;
}

/**
 * A fixed code for an error, never its message text (messages can echo input). Our own errors are
 * thrown with snake_case codes ("lab_sweep_failed"); anything else is reduced to its class name.
 */
export function jobErrorCode(error:unknown):string{
 if(error instanceof Error){
  if(/^[a-z][a-z0-9_]{2,60}$/.test(error.message))return error.message;
  const name=error.name||error.constructor?.name||'Error';
  return /^[A-Za-z][A-Za-z0-9_]{0,60}$/.test(name)?name:'Error';
 }
 return 'unknown_error';
}

/** Outcome of a sweep that returns a report with a failure count. */
export function outcomeFromFailures(failed:number,done:number):JobOutcome{
 return failed<=0?'ok':done>0?'partial':'error';
}

const sum=(r:Record<string,number>|undefined,pick:(key:string)=>boolean)=>Object.entries(r??{}).reduce((n,[k,v])=>n+(pick(k)&&Number.isFinite(v)?v:0),0);
/** Per-item states that mean the item did not go through (lib/telegram-runtime/dispatch.ts tallies). */
const BAD_STATE=/unconfirmed|unrecorded|rejected|fail|error/;

/** Lab sweep: switched off is skipped; otherwise by its failure count against finished reads. */
export function labOutcome(report:{state:string}|{claimed:number;finished:Record<string,number>;failed:number}):JobOutcome{
 if('state'in report)return 'skipped';
 return outcomeFromFailures(report.failed,sum(report.finished,()=>true));
}

type TelegramTallies={inbox?:{processed:number;retry:number};screening?:{failed:number};system?:Record<string,number>;auth?:Record<string,number>;replies?:Record<string,number>;afterZoe?:Record<string,number>};
/**
 * Telegram sweep: inbox retries, failed screening and any send whose outcome was not recorded count against
 * it. "ok" means every item was processed and its outcome recorded; it does not mean Telegram accepted every
 * message. A recorded provider failure is a per-message state (`outcome_recorded` carries no delivery
 * verdict) and shows on the backoffice Delivery problems page, not in the job ledger.
 */
export function telegramOutcome(report:TelegramTallies):JobOutcome{
 const tallies=[report.system,report.auth,report.replies,report.afterZoe];
 const bad=(report.inbox?.retry??0)+(report.screening?.failed??0)+tallies.reduce((n,t)=>n+sum(t,k=>BAD_STATE.test(k)),0);
 const good=(report.inbox?.processed??0)+tallies.reduce((n,t)=>n+sum(t,k=>!BAD_STATE.test(k)),0);
 return outcomeFromFailures(bad,good);
}

