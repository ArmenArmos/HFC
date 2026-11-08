import {withRouteLogging} from '@/lib/observability/with-logging';
import {after} from 'next/server';
import {runConfiguredTelegramSweep,telegramWebhook} from '@/lib/telegram-runtime/server';
export const runtime='nodejs';
export const maxDuration=60;
export const POST=withRouteLogging(async function POST(request:Request){
 // Zoe's deadline in the sweep after the response counts from here (the function's 60 s run from the request).
 const startedAt=Date.now();
 const response=await telegramWebhook()(request);
 // Acknowledged means durably stored; processing and the acknowledgement message
 // happen after the response. The cron sweep retries anything left behind.
 if(response.status===200)after(async()=>{await runConfiguredTelegramSweep({startedAt}).catch(()=>null);});
 return response;
});
