import 'server-only';
import {z} from 'zod';
import {smsSender} from './channels';
import type {BrevoSubmissionResult} from './brevo';
const schema=z.object({accountSid:z.string().regex(/^AC[0-9a-fA-F]{32}$/),authToken:z.string().min(16).max(4096).regex(/^\S+$/).optional(),apiKeySid:z.string().regex(/^SK[0-9a-fA-F]{32}$/).optional(),apiKeySecret:z.string().min(16).max(4096).regex(/^\S+$/).optional(),smsFrom:smsSender}).strict().refine(value=>(!value.apiKeySid&&!value.apiKeySecret||Boolean(value.apiKeySid&&value.apiKeySecret))&&(Boolean(value.authToken)||Boolean(value.apiKeySid&&value.apiKeySecret)),'Twilio credentials required');
export type TwilioSmsConfig=z.infer<typeof schema>;
export function parseTwilioSmsConfig(value:unknown):TwilioSmsConfig{return schema.parse(value);}
export function buildTwilioOtpMessage(config:TwilioSmsConfig,value:unknown){
 const checked=parseTwilioSmsConfig(config),input=z.object({destination:z.string().regex(/^\+374[0-9]{8}$/),code:z.string().regex(/^[0-9]{6}$/)}).strict().parse(value);
 return {From:checked.smsFrom,To:input.destination,Body:`Noreon code: ${input.code}. Do not share this code.`};
}
/** One request only. A deadline, malformed receipt or uncertain response holds the reservation. */
export async function submitTwilioOtpMessage(config:TwilioSmsConfig,value:unknown,fetchImpl:typeof fetch=fetch,timeoutMs=2000):Promise<BrevoSubmissionResult>{
 const checked=parseTwilioSmsConfig(config),payload=buildTwilioOtpMessage(checked,value);
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>2000)throw Error('Invalid Twilio hook timeout');
 const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
 const timeout=new Promise<BrevoSubmissionResult>(resolve=>{timer=setTimeout(()=>{controller.abort();resolve({status:'unknown'});},timeoutMs);});
 const operation=(async():Promise<BrevoSubmissionResult>=>{
  try{
   const response=await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${checked.accountSid}/Messages.json`,{method:'POST',headers:{Authorization:'Basic '+Buffer.from(`${checked.apiKeySid??checked.accountSid}:${checked.apiKeySid?checked.apiKeySecret:checked.authToken}`).toString('base64'),'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'},body:new URLSearchParams(payload).toString(),signal:controller.signal,redirect:'error'});
   if(response.status!==201){void response.body?.cancel().catch(()=>{});return {status:[400,401,403,404,405,422,429].includes(response.status)?'failed':'unknown'};}
   if(!response.body)return {status:'unknown'};
   const reader=response.body.getReader(),chunks:Uint8Array[]=[];let bytes=0;
   try{for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>16384){void reader.cancel().catch(()=>{});return {status:'unknown'};}chunks.push(part.value);}const receipt=z.object({sid:z.string().regex(/^(SM|MM)[0-9a-fA-F]{32}$/)}).safeParse(JSON.parse(Buffer.concat(chunks).toString('utf8')));return receipt.success?{status:'accepted',reference:receipt.data.sid}:{status:'unknown'};}finally{reader.releaseLock();}
  }catch{return {status:'unknown'};}
 })();
 try{return await Promise.race([operation,timeout]);}finally{if(timer)clearTimeout(timer);}
}
