import {withRouteLogging} from '@/lib/observability/with-logging';
import {createClient} from '@supabase/supabase-js';
import {createNativeVerifyPhoneHandler} from '@/lib/patient/native-verify-phone';
import {nativeJourneyEnabled} from '@/lib/patient/native-journey-server';
import {phoneCodePolicy} from '@/lib/patient/phone-code-policy';
import {authSmsHookEnabled} from '@/lib/messaging/auth-sms-hook-runtime';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=15;
export const POST=withRouteLogging(createNativeVerifyPhoneHandler({
 enabled:()=>nativeJourneyEnabled(process.env)&&Boolean(phoneCodePolicy(process.env))&&phoneCodePolicy(process.env)?.provider!=='telegram-hook'&&(phoneCodePolicy(process.env)?.provider!=='twilio-verify-hook'||authSmsHookEnabled(process.env)),
 async verify(phone,code,signal){
  // The anon credential retains Supabase OTP brute-force/rate limiting. Never forward caller IP/auth headers.
  const client=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:(input,init)=>fetch(input,{...init,signal,redirect:'error'})}});
  const result=await client.auth.verifyOtp({phone,token:code,type:'sms'});
  return {error:result.error,data:{user:result.data.user,session:result.data.session?{...result.data.session}:null}};
 }
}));
