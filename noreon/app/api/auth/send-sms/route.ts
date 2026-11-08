import {withRouteLogging} from '@/lib/observability/with-logging';
import {log} from '@/lib/observability/logger';
import {authSmsHookResponse,handleAuthSmsHook} from '@/lib/messaging/auth-sms-hook';
import {authSmsHookRuntime} from '@/lib/messaging/auth-sms-hook-runtime';
import {handleTelegramAuthHook} from '@/lib/telegram-auth/hook';
import {telegramAuthHookRuntime} from '@/lib/telegram-auth/runtime';
export const runtime='nodejs';
export const maxDuration=10;
export const POST=withRouteLogging(async function POST(request:Request){
 try{
  const telegram=telegramAuthHookRuntime();
  if(telegram)return await handleTelegramAuthHook(request,telegram.keys,telegram.store,telegram.send);
  const runtime=authSmsHookRuntime();if(!runtime)return authSmsHookResponse(404);return await handleAuthSmsHook(request,runtime.config,runtime.store);
 }catch{
  // Configuration or an unexpected throw: the one 503 the handlers cannot log themselves.
  log.warn('send_sms_hook',{status:503,error_code:'hook_failed'});
  return authSmsHookResponse(503);
 }
});
