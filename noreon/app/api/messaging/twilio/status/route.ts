import {withRouteLogging} from '@/lib/observability/with-logging';
import {handleTwilioCallback} from '@/lib/messaging/callback';
import {messageRuntime} from '@/lib/messaging/runtime';
export const runtime='nodejs';
export const maxDuration=20;
export const POST=withRouteLogging(async function POST(request:Request){
 try{
  const runtime=messageRuntime();
  if(!runtime)return new Response(null,{status:404,headers:{'Cache-Control':'no-store'}});
  return await handleTwilioCallback(request,runtime.config,async event=>{
   const db=runtime.db();
   const result=await db.rpc('record_patient_message_delivery',{p_attempt_id:event.attemptId,p_reference:event.reference,p_status:event.status,p_error_code:event.errorCode??undefined}).abortSignal(AbortSignal.timeout(5000));
   if(result.error)throw Error('storage');return result.data===true;
  });
 }catch{return new Response(null,{status:503,headers:{'Cache-Control':'no-store'}});}
});
