import {jobRoute} from '@/lib/jobs/contract';
import {dispatchMessages} from '@/lib/messaging/dispatch';
export const runtime='nodejs';
export const maxDuration=60;
export const GET=jobRoute({name:'message_dispatch',maxDurationSec:maxDuration,failureCode:'message_dispatch_unavailable',
 enabled:()=>process.env.NOREON_MESSAGE_DELIVERY_ENABLED==='true'&&process.env.NOREON_MESSAGE_RECOVERY_READY==='true'},async()=>{
 const result=await dispatchMessages();
 const failed=!!result.sourceErrors||(!!result.halted&&!['budget','busy','daily-limit'].includes(result.halted));
 // Same predicate as the HTTP status: a halt other than budget, busy or daily limit is a failure.
 return {outcome:failed?'error':'ok',report:result,status:failed?503:200,errorCode:result.sourceErrors?'message_source_errors':failed?`message_halted_${String(result.halted).replace(/[^a-z0-9_]/gi,'_').slice(0,40)}`:null};
});
