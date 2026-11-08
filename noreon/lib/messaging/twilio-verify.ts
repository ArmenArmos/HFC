import 'server-only';
import {z} from 'zod';
import type {BrevoSubmissionResult} from './brevo';
const schema=z.object({accountSid:z.string().regex(/^AC[0-9a-fA-F]{32}$/),serviceSid:z.string().regex(/^VA[0-9a-fA-F]{32}$/),apiKeySid:z.string().regex(/^SK[0-9a-fA-F]{32}$/),apiKeySecret:z.string().min(16).max(4096).regex(/^\S+$/)}).strict();
export type TwilioVerifyConfig=z.infer<typeof schema>;
export function parseTwilioVerifyConfig(value:unknown):TwilioVerifyConfig{return schema.parse(value);}
const inputSchema=z.object({destination:z.string().regex(/^\+374[0-9]{8}$/),code:z.string().regex(/^[0-9]{6}$/)}).strict();
export function buildTwilioVerifyCode(value:unknown){const input=inputSchema.parse(value);return {To:input.destination,Channel:'sms',CustomCode:input.code,Locale:'en'};}
/** A single bounded request. Unknown outcomes retain their entire spend reservation. */
async function request(config:TwilioVerifyConfig,path:string,payload:Record<string,string>,expected:{status:'pending'|'approved'|'canceled';destination?:string;sid?:string},fetchImpl:typeof fetch,timeoutMs:number):Promise<BrevoSubmissionResult>{
 const checked=parseTwilioVerifyConfig(config);
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>2000)throw Error('Invalid Verify timeout');
 const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
 const timeout=new Promise<BrevoSubmissionResult>(resolve=>{timer=setTimeout(()=>{controller.abort();resolve({status:'unknown'});},timeoutMs);});
 const operation=(async():Promise<BrevoSubmissionResult>=>{
  try{
   const response=await fetchImpl(`https://verify.twilio.com/v2/Services/${checked.serviceSid}/Verifications${path}`,{method:'POST',headers:{Authorization:'Basic '+Buffer.from(`${checked.apiKeySid}:${checked.apiKeySecret}`).toString('base64'),'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'},body:new URLSearchParams(payload).toString(),signal:controller.signal,redirect:'error'});
   const absent=expected.status==='canceled'&&response.status===404;
   if(!absent&&response.status!==(expected.status==='pending'?201:200)){void response.body?.cancel().catch(()=>{});return {status:[400,401,403,404,405,422,429].includes(response.status)?'failed':'unknown'};}
   if(!response.body)return {status:'unknown'};
   const reader=response.body.getReader(),chunks:Uint8Array[]=[];let bytes=0;
   try{for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>16384){void reader.cancel().catch(()=>{});return {status:'unknown'};}chunks.push(part.value);}
    const parsedBody:unknown=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if(absent){const missing=z.object({code:z.literal(20404),status:z.literal(404)}).safeParse(parsedBody);return missing.success?{status:'accepted',reference:expected.sid!}:{status:'unknown'};}
    const receipt=z.object({sid:z.string().regex(/^VE[0-9a-fA-F]{32}$/),service_sid:z.literal(checked.serviceSid),account_sid:z.literal(checked.accountSid),channel:z.literal('sms'),status:z.literal(expected.status),to:z.string()}).safeParse(parsedBody);
    return receipt.success&&(!expected.destination||receipt.data.to===expected.destination)&&(!expected.sid||receipt.data.sid===expected.sid)?{status:'accepted',reference:receipt.data.sid}:{status:'unknown'};
   }finally{reader.releaseLock();}
  }catch{return {status:'unknown'};}
 })();
 try{return await Promise.race([operation,timeout]);}finally{if(timer)clearTimeout(timer);}
}
export async function submitTwilioVerifyCode(config:TwilioVerifyConfig,value:unknown,fetchImpl:typeof fetch=fetch,timeoutMs=2000):Promise<BrevoSubmissionResult>{const payload=buildTwilioVerifyCode(value);return request(config,'',payload,{status:'pending',destination:payload.To},fetchImpl,timeoutMs);}
/** The SID must come from a durable claim matched after successful Supabase verification. */
export async function approveTwilioVerification(config:TwilioVerifyConfig,sid:string,fetchImpl:typeof fetch=fetch,timeoutMs=2000):Promise<BrevoSubmissionResult>{z.string().regex(/^VE[0-9a-fA-F]{32}$/).parse(sid);return request(config,'/'+sid,{Status:'approved'},{status:'approved',sid},fetchImpl,timeoutMs);}

/** A canceled receipt or exact authenticated Twilio 20404 absence is terminal. */
export async function cancelTwilioVerification(config:TwilioVerifyConfig,sid:string,fetchImpl:typeof fetch=fetch,timeoutMs=900):Promise<BrevoSubmissionResult>{z.string().regex(/^VE[0-9a-fA-F]{32}$/).parse(sid);return request(config,'/'+sid,{Status:'canceled'},{status:'canceled',sid},fetchImpl,timeoutMs);}
