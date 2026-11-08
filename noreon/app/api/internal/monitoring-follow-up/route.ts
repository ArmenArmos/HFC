import {logSweep,withRouteLogging} from '@/lib/observability/with-logging';
import {timingSafeEqual} from 'node:crypto';
import {dispatchMonitoring} from '@/lib/staff/monitoring-dispatch';
import {sharedDemoEnabled} from '@/lib/staff/cases';
export const runtime='nodejs';
export const maxDuration=60;
export const GET=withRouteLogging(async function GET(request:Request) {
 const started=performance.now();
 const expected=process.env.CRON_SECRET,supplied=request.headers.get('authorization')??'';
 if(!sharedDemoEnabled()||!expected||Buffer.byteLength(supplied)!==Buffer.byteLength(`Bearer ${expected}`)||!timingSafeEqual(Buffer.from(supplied),Buffer.from(`Bearer ${expected}`)))return new Response(null,{status:404});
 try {
  const result=await dispatchMonitoring();
  logSweep('monitoring_follow_up',result,started,result.failed?'error':'ok');
  return Response.json(result,{status:result.failed?503:200,headers:{'Cache-Control':'no-store'}});
 }catch(error){logSweep('monitoring_follow_up',null,started,'error',error);return Response.json({error:'monitoring_dispatch_failed'},{status:503,headers:{'Cache-Control':'no-store'}});}
},{actor:'system'});
