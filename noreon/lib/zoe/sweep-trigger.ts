import 'server-only';

/**
 * Asks for one Zoe pass right after a member writes in the app, so Zoe's reply or next symptom question
 * arrives in seconds rather than at the next cron run (the zoe/run cron every five minutes is the backstop).
 * It calls /api/internal/zoe/run with CRON_SECRET on the CONFIGURED app origin (NOREON_APP_ORIGIN,
 * e.g. https://app.noreon.health), never on a host taken from the request (Fable F6). Outside
 * production a local http origin is accepted for development. Without a valid origin nothing is sent
 * and the cron backstop answers. The member's request itself never imports or runs the Zoe pipeline
 * (scripts/check-zoe-member-screen.ts); the claim keeps one run per message. Never throws.
 */
export function zoeRunUrl(env:Record<string,string|undefined>=process.env):string|null{
 const raw=env.NOREON_APP_ORIGIN?.trim();
 if(!raw)return null;
 let u:URL;try{u=new URL(raw);}catch{return null;}
 if(u.pathname!=='/'||u.search||u.hash||u.username||u.password)return null;
 const local=/^(localhost|127\.0\.0\.1)$/.test(u.hostname);
 if(u.protocol==='https:'&&!local)return `${u.origin}/api/internal/zoe/run`;
 if(u.protocol==='http:'&&local&&env.NODE_ENV!=='production')return `${u.origin}/api/internal/zoe/run`;
 return null;
}
export async function requestZoeSweep(env:Record<string,string|undefined>=process.env,fetcher:typeof fetch=fetch){
 const secret=env.CRON_SECRET,url=zoeRunUrl(env);
 if(!secret||!url)return false;
 try{
  // A protected host (the staging site sits behind Vercel Authentication) lets this call through only with the project's automation bypass secret; unset elsewhere.
  const bypass=env.VERCEL_AUTOMATION_BYPASS_SECRET;
  const r=await fetcher(url,{headers:{authorization:`Bearer ${secret}`,...(bypass?{'x-vercel-protection-bypass':bypass}:{})},cache:'no-store',signal:AbortSignal.timeout(55_000)});
  return r.ok;
 }catch{return false;}
}
