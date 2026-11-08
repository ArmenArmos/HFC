import 'server-only';
import {after} from 'next/server';
import {zoeRunUrl} from '@/lib/zoe/sweep-trigger';

/**
 * Starts the Telegram dispatch job right after a clinic confirms or proposes, or a member accepts a proposal, so the
 * notice goes in seconds rather than at the next cron run (the 5-minute cron is the backstop). As with Zoe's trigger
 * (lib/zoe/sweep-trigger.ts) it calls the job over HTTP on the configured app origin, so a member's request never
 * imports the sweep or the Zoe pipeline (scripts/check-zoe-member-screen.ts), and the send has the job's own time.
 * The claim rules keep one send per message, so a replay only runs one more harmless job. Never throws.
 */
export function telegramDispatchUrl(env:Record<string,string|undefined>=process.env):string|null{
 const url=zoeRunUrl(env);
 return url&&`${new URL(url).origin}/api/internal/telegram/dispatch`;
}
export async function requestTelegramDispatch(env:Record<string,string|undefined>=process.env,fetcher:typeof fetch=fetch){
 const secret=env.CRON_SECRET,url=telegramDispatchUrl(env);
 if(!secret||!url)return false;
 try{
  const r=await fetcher(url,{headers:{authorization:`Bearer ${secret}`},cache:'no-store',signal:AbortSignal.timeout(55_000)});
  return r.ok;
 }catch{return false;}
}
export function dispatchNow(){
 try{after(requestTelegramDispatch);}catch{/* No request lifetime: the cron sends it. */}
}
