import 'server-only';
import {z} from 'zod';
import {createClient} from '@supabase/supabase-js';
import type {Database} from '@/lib/db/types';
import {purposeRoute} from '@/lib/zoe/purpose-route';
import {parseRouteConfig} from '@/lib/zoe/route-config';
import {labAiEnabled,labProviderMode} from './config';
import {createFakeLabProvider,createLabGatewayProvider} from './provider';
import {runLabSweep,type LabRoute,type LabRpc,type LabSweepReport} from './worker';

type Env=Record<string,string|undefined>;
/**
 * The cron sweep. Off unless the app flag is on and a reader is configured (NOREON_LAB_AI_PROVIDER);
 * the database switch is checked again by the claim. The route is the lab_reading purpose's AI settings tier (medium by default).
 * Errors carry only a code: no content, name or value is ever logged.
 */
export async function runConfiguredLabSweep(env:Env=process.env,options:{maxJobs?:number;sourceId?:string;deadlineAt?:number}={}):Promise<(LabSweepReport&{queued?:boolean})|{state:'disabled'|'reading_off'|'unconfigured'}>{
 const deadline=Math.min(Date.now()+240_000,options.deadlineAt??Infinity);
 if(options.sourceId&&!z.uuid().safeParse(options.sourceId).success)return {state:'unconfigured'};
 if(!labAiEnabled(env))return {state:'disabled'};
 const mode=labProviderMode(env);
 if(mode==='off')return {state:'reading_off'};
 const url=env.NEXT_PUBLIC_SUPABASE_URL,key=env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key)return {state:'unconfigured'};
 if(options.sourceId&&deadline-Date.now()<1_000){
  console.info('Lab reading kick deadline reached',{sourceId:options.sourceId});
  console.info('Lab reading kick sweep finished',{sourceId:options.sourceId,rounds:0,claimed:0});
  return {claimed:0,finished:{},failed:0,queued:true};
 }
 // Bound reservations, claims and downloads at the moment IO starts.
 const boundedFetch:typeof fetch=async(input,init)=>{
  const remaining=deadline-Date.now();
  if(remaining<=0)throw Error('Lab reading deadline reached');
  const timeout=AbortSignal.timeout(remaining);
  const signal=init?.signal??(input instanceof Request?input.signal:null);
  return fetch(input,{...init,signal:signal?AbortSignal.any([signal,timeout]):timeout});
 };
 const client=createClient<Database>(url,key,{auth:{persistSession:false,autoRefreshToken:false},
  // SDK retry sleeps (including Retry-After) must not outlive the request.
  ...(options.sourceId?{global:{fetch:boundedFetch},db:{retry:false}}:{})});
 const rpc:LabRpc=async(name,args)=>{
  const {data,error}=await client.rpc(name as keyof Database['public']['Functions'],args as never);
  if(error)throw Error(`Lab reading database unavailable (${error.code??'rpc'})`);
  return data;
 };
 // A real reader while the database refuses real calls would only download and defer, over and over.
 if(mode==='gateway'){
  try{const st=await rpc('lab_ai_reading_state',{}) as {enabled?:boolean;modelCallsAllowed?:boolean};if(!st.enabled||!st.modelCallsAllowed)return {state:'reading_off'};}
  catch{return {state:'unconfigured'};}
 }
 // The lab_reading tier's configured model and fallback. If it cannot be read, nothing is called.
 let route:LabRoute|null=null;
 try{route=purposeRoute(parseRouteConfig(await rpc('zoe_route_config',{})),'lab_reading',env);}catch{route=null;}
 const deps={rpc,route,
  providerFor:(m:LabRoute['primary'])=>{
   const remaining=options.sourceId?deadline-Date.now():Infinity;
   if(remaining<=0)return null;
   return mode==='fake'?createFakeLabProvider():createLabGatewayProvider(m,{env,...(options.sourceId?{deadlineAt:deadline}:{})});
  },
  download:async(bucket:string,objectKey:string)=>{const d=await client.storage.from(bucket).download(objectKey);return d.error||!d.data?null:new Uint8Array(await d.data.arrayBuffer());}};
 if(!options.sourceId)return runLabSweep(deps,options);
 // Claim globally through SQL, including older due jobs. The claim/lease is
 // the only processing guard; the service client needs no queue table access.
 const report:LabSweepReport={claimed:0,finished:{},failed:0};
 let emptyClaims=0,rounds=0;
 let queued=false;
 while(rounds<16){
  const remaining=deadline-Date.now();
  if(remaining<1_000){queued=true;console.info('Lab reading kick deadline reached',{sourceId:options.sourceId});break;}
  const next=await runLabSweep(deps,{maxJobs:1,budgetMs:remaining,lateAfterMs:remaining-90_000});
  rounds++;
  report.claimed+=next.claimed;report.failed+=next.failed;
  for(const [outcome,count]of Object.entries(next.finished))report.finished[outcome]=(report.finished[outcome]??0)+count;
  // SQL can retire a stale/exhausted older job and return no claimed work.
  // Three consecutive empty claims stop polling when nothing is due.
  emptyClaims=next.claimed?0:emptyClaims+1;
  if(next.failed){console.info('Lab reading kick sweep failed',{sourceId:options.sourceId});break;}
  if(!next.claimed)console.info('Lab reading kick: no job claimed',{sourceId:options.sourceId});
  if(emptyClaims>=3){console.info('Lab reading kick empty claim limit reached',{sourceId:options.sourceId});break;}
  if(rounds===16){queued=true;console.info('Lab reading kick round limit reached',{sourceId:options.sourceId});}
 }
 console.info('Lab reading kick sweep finished',{sourceId:options.sourceId,rounds,claimed:report.claimed});
 // No recursive after()/self-call: queued retries keep their SQL backoff and
 // three-attempt limit. Staging without cron needs a later manual sweep.
 // A round/time cap means work may remain, without needing a queue table read.
 return {...report,queued};
}
