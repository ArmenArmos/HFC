import 'server-only';
import {createHmac} from 'node:crypto';
import {Webhook} from 'standardwebhooks';
import {z} from 'zod';
import {buildBrevoOtpMessage,parseBrevoConfig,submitBrevoOtpMessage,type BrevoConfig,type BrevoSubmissionResult} from './brevo';
import {buildTwilioOtpMessage,parseTwilioSmsConfig,submitTwilioOtpMessage,type TwilioSmsConfig} from './twilio-sms';
import {buildTwilioVerifyCode,cancelTwilioVerification,parseTwilioVerifyConfig,submitTwilioVerifyCode,type TwilioVerifyConfig} from './twilio-verify';
import {countSmsSegments} from './spend';
const MAX_BODY=32_768;
const TOTAL_MS=4_500; // Supabase HTTP hooks time out after five seconds.
export type AuthSmsHookConfig={hookSecret:string;digestKey:Buffer}&({provider:'brevo';brevo:BrevoConfig}|{provider:'twilio';twilio:TwilioSmsConfig}|{provider:'twilio-verify';verify:TwilioVerifyConfig});
export function parseAuthSmsHookConfig(value:unknown):AuthSmsHookConfig {
 const parsed=z.union([z.object({hookSecret:z.string().max(200),provider:z.literal('twilio-verify'),verify:z.unknown()}).strict(),z.object({hookSecret:z.string().max(200),provider:z.literal('brevo').optional(),brevo:z.unknown()}).strict(),z.object({hookSecret:z.string().max(200),provider:z.literal('twilio'),twilio:z.unknown()}).strict()]).parse(value);
 const secret=parsed.hookSecret.replace(/^v1,/, '');
 if(!/^whsec_[A-Za-z0-9+/]+={0,2}$/.test(secret))throw Error('hook configuration');
 const digestKey=Buffer.from(secret.slice(6),'base64');
 if(digestKey.length<32||digestKey.toString('base64')!==secret.slice(6))throw Error('hook configuration');
 new Webhook(secret);return parsed.provider==='twilio-verify'?{hookSecret:secret,digestKey,provider:'twilio-verify',verify:parseTwilioVerifyConfig(parsed.verify)}:parsed.provider==='twilio'?{hookSecret:secret,digestKey,provider:'twilio',twilio:parseTwilioSmsConfig(parsed.twilio)}:{hookSecret:secret,digestKey,provider:'brevo',brevo:parseBrevoConfig(parsed.brevo)};
}
export type HookClaim={status:'send';claimToken:string;previousReference?:string}|{status:'accepted'|'submitting'|'failed'|'unknown'};
export interface AuthSmsHookStore {
 claim(webhookId:string,bodyDigest:string,timeoutMs:number,verificationDigest?:string,recipientDigest?:string):Promise<HookClaim>;
 finish(webhookId:string,claimToken:string,outcome:BrevoSubmissionResult,timeoutMs:number):Promise<boolean>;
}
const payloadSchema=z.object({user:z.object({phone:z.string().regex(/^\+?374[0-9]{8}$/)}),sms:z.object({otp:z.string().regex(/^[0-9]{6}$/)})});
export function authSmsHookResponse(status:number):Response {
 return Response.json(status===200?{}:{error:{http_code:status,message:'SMS delivery is unavailable. Please try again later.'}},{status,headers:{'Cache-Control':'no-store'}});
}
async function bounded<T>(operation:Promise<T>,ms:number):Promise<T>{
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{return await Promise.race([operation,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('deadline')),Math.max(1,ms));})]);}finally{if(timer)clearTimeout(timer);}
}
/** Reads and authenticates one Standard Webhooks request within the hook deadline; a Response is a refusal. */
export async function readSignedAuthHook(request:Request,hookSecret:string,deadline:number):Promise<{id:string;body:string;value:unknown}|Response>{
 if(request.method!=='POST')return authSmsHookResponse(405);
 if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')return authSmsHookResponse(415);
 const id=request.headers.get('webhook-id')??'',timestamp=request.headers.get('webhook-timestamp')??'',signature=request.headers.get('webhook-signature')??'';
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(id)||!/^\d{10}$/.test(timestamp)||!signature||signature.length>1024)return authSmsHookResponse(403);
 const length=request.headers.get('content-length');if(length&&(!/^\d+$/.test(length)||Number(length)>MAX_BODY))return authSmsHookResponse(413);
 const reader=request.body?.getReader();if(!reader)return authSmsHookResponse(400);
 const chunks:Uint8Array[]=[];let size=0,body:string;
 try{
  for(;;){if(Date.now()>=deadline){void reader.cancel().catch(()=>{});return authSmsHookResponse(408);}const part=await bounded(reader.read(),Math.min(500,deadline-Date.now()));if(part.done)break;size+=part.value.byteLength;if(size>MAX_BODY){void reader.cancel().catch(()=>{});return authSmsHookResponse(413);}chunks.push(part.value);}
  body=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));
 }catch{void reader.cancel().catch(()=>{});return authSmsHookResponse(400);}finally{reader.releaseLock();}
 try{return {id,body,value:new Webhook(hookSecret).verify(body,{'webhook-id':id,'webhook-timestamp':timestamp,'webhook-signature':signature})};}catch{return authSmsHookResponse(403);}
}
/** The signature authenticates the exact body before any privileged client or spend reservation. */
export async function handleAuthSmsHook(request:Request,config:AuthSmsHookConfig,storeFactory:()=>AuthSmsHookStore,submit:typeof submitBrevoOtpMessage=submitBrevoOtpMessage):Promise<Response>{
 const deadline=Date.now()+TOTAL_MS;
 const signed=await readSignedAuthHook(request,config.hookSecret,deadline);
 if(signed instanceof Response)return signed;
 const {id,body,value}=signed;
 const parsed=payloadSchema.safeParse(value);if(!parsed.success)return authSmsHookResponse(400);
 const input={destination:parsed.data.user.phone.startsWith('+')?parsed.data.user.phone:'+'+parsed.data.user.phone,code:parsed.data.sms.otp};
 // Refuse any future body change that no longer fits the single-segment reservation.
 try{if(config.provider==='twilio-verify'){buildTwilioVerifyCode(input);}else if(countSmsSegments((config.provider==='twilio'?buildTwilioOtpMessage(config.twilio,input).Body:buildBrevoOtpMessage(config.brevo,input).content)).segments!==1)return authSmsHookResponse(503);}catch{return authSmsHookResponse(503);}
 // Keyed binding cannot be used as an offline six-digit OTP verifier if the DB leaks.
 const digest=createHmac('sha256',config.digestKey).update('noreon-auth-sms-body-v1\0').update(body).digest('hex');
 let store:AuthSmsHookStore,claim:HookClaim;
 try{store=storeFactory();const ms=Math.min(900,deadline-Date.now()-1800);if(ms<1)return authSmsHookResponse(503);claim=await bounded(store.claim(id,digest,ms,config.provider==='twilio-verify'?verifyAssociationDigest(config,input.destination,input.code):undefined,config.provider==='twilio-verify'?verifyRecipientDigest(config,input.destination):undefined),ms);}catch{return authSmsHookResponse(503);}
 if(claim.status!=='send')return authSmsHookResponse(claim.status==='accepted'?200:503);
 let outcome:BrevoSubmissionResult={status:'unknown'};
 let canSubmit=true;
 if(claim.previousReference){
  canSubmit=false;
  if(config.provider==='twilio-verify'){
   const cancelMs=Math.min(900,deadline-Date.now()-1800);
   if(cancelMs>0){try{const cancellation=await bounded(cancelTwilioVerification(config.verify,claim.previousReference,fetch,cancelMs),cancelMs);canSubmit=cancellation.status==='accepted';if(!canSubmit)outcome={status:cancellation.status==='failed'?'failed':'unknown'};}catch{outcome={status:'unknown'};}}
  }
 }
 const providerMs=Math.min(claim.previousReference?1100:2000,deadline-Date.now()-1000);
 if(canSubmit&&providerMs>=1){try{outcome=await bounded((config.provider==='twilio-verify'?submitTwilioVerifyCode(config.verify,input,fetch,providerMs):config.provider==='twilio'?submitTwilioOtpMessage(config.twilio,input,fetch,providerMs):submit(config.brevo,input,fetch,providerMs)),providerMs);}catch{outcome={status:'unknown'};}}
 if(outcome.status==='accepted'&&claim.previousReference===outcome.reference)outcome={status:'unknown'};
 try{
  const ms=Math.min(900,deadline-Date.now());if(ms<1)return authSmsHookResponse(503);
  if(!await bounded(store.finish(id,claim.claimToken,outcome,ms),ms))return authSmsHookResponse(503);
 }catch{return authSmsHookResponse(503);}
 return authSmsHookResponse(outcome.status==='accepted'?200:outcome.status==='failed'?502:503);
}

export function verifyAssociationDigest(config:AuthSmsHookConfig,phone:string,code:string):string {
 if(config.provider!=='twilio-verify')throw Error('Verify configuration required');
 return createHmac('sha256',config.digestKey).update(['noreon-verify-association-v1',config.verify.accountSid,config.verify.serviceSid,phone,code].join('\0')).digest('hex');
}

export function verifyRecipientDigest(config:AuthSmsHookConfig,phone:string):string {
 if(config.provider!=='twilio-verify')throw Error('Verify configuration required');
 return createHmac('sha256',config.digestKey).update(['noreon-verify-recipient-v1',config.verify.accountSid,config.verify.serviceSid,phone].join('\0')).digest('hex');
}
