import 'server-only';
import {after} from 'next/server';
import {labAiEnabled} from './feature-config';
import {runConfiguredLabSweep} from './server';

/** Best effort after a successful upload/attach. Callers pass an internal id only.
 * Bounded one-claim rounds drain toward this source and its automatic attachment.
 * The existing DB claim/lease is the only guard, shared with cron. A killed function
 * leaves a ten-minute lease, then cron can retry (up to the existing three attempts).
 * Entry routes/pages reserve 300 s. Stop by request start + 270 s, with a
 * separate 240 s kick limit and at most 16 claims.
 * Work left queued needs cron or a manual sweep on staging; no recursive kick.
 */
export function scheduleLabRead(sourceId:string,requestStartedAt=Date.now()):void{
 const enabled=labAiEnabled();
 console.info('Lab reading kick scheduled',{sourceId,enabled});
 if(!enabled){console.info('Lab reading kick skipped',{sourceId,state:'disabled'});return;}
 const deadlineAt=requestStartedAt+270_000;
 const failed=()=>console.warn('Lab reading kick failed',{sourceId});
 try{
  after(async()=>{
   console.info('Lab reading kick started',{sourceId});
   try{
    const report=await runConfiguredLabSweep(process.env,{sourceId,deadlineAt});
    if('state'in report){
     console.info('Lab reading kick skipped',{sourceId,state:report.state});
    }else{
     if(report.failed)failed();
     if(report.queued)console.warn('Lab reading kick left queued work for a later sweep',{sourceId});
    }
   }catch{failed();}
  });
 }catch{failed();}
}
