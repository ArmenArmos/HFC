import 'server-only';
import {z} from 'zod';

const configSchema=z.object({apiKey:z.string().min(16).max(4096).regex(/^\S+$/),sender:z.string().regex(/^[A-Za-z0-9]{1,11}$/)}).strict();
export type BrevoConfig=z.infer<typeof configSchema>;
export function parseBrevoConfig(value:unknown):BrevoConfig{return configSchema.parse(value);}
const inputSchema=z.object({destination:z.string().regex(/^\+374[0-9]{8}$/),code:z.string().regex(/^[0-9]{6}$/)}).strict();
/** Fixed ASCII content is one GSM-7 segment; the sender must be registered for Armenia. */
export function buildBrevoOtpMessage(config:BrevoConfig,value:unknown){
 const checked=parseBrevoConfig(config),input=inputSchema.parse(value);
 return {sender:checked.sender,recipient:input.destination.slice(1),content:`Noreon code: ${input.code}. Do not share this code.`,type:'transactional' as const};
}
export type BrevoSubmissionResult={status:'accepted';reference:string}|{status:'failed'|'unknown'};
const responseSchema=z.object({messageId:z.number().int().positive().max(Number.MAX_SAFE_INTEGER)});
async function boundedJson(response:Response):Promise<unknown>{
 if(!response.body)return null;
 const reader=response.body.getReader();let bytes=0;const chunks:Uint8Array[]=[];
 try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>16_384){await reader.cancel();return null;}chunks.push(value);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}finally{reader.releaseLock();}
}
/** No automatic retries. Unknown outcomes require reconciliation before another send. */
export async function submitBrevoOtpMessage(config:BrevoConfig,value:unknown,fetchImpl:typeof fetch=fetch,timeoutMs=10_000):Promise<BrevoSubmissionResult>{
 const checked=parseBrevoConfig(config),payload=buildBrevoOtpMessage(checked,value);
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>10_000)throw new Error('Invalid Brevo transport timeout');
 const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
 const timeout=new Promise<BrevoSubmissionResult>(resolve=>{timer=setTimeout(()=>{controller.abort();resolve({status:'unknown'});},timeoutMs);});
 const operation=(async():Promise<BrevoSubmissionResult>=>{
  try{
   const response=await fetchImpl('https://api.brevo.com/v3/transactionalSMS/send',{method:'POST',headers:{'api-key':checked.apiKey,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(payload),signal:controller.signal,redirect:'error'});
   if(response.status!==201){void response.body?.cancel().catch(()=>{});return {status:[400,401,403,404,405,422,429].includes(response.status)?'failed':'unknown'};}
   const parsed=responseSchema.safeParse(await boundedJson(response));
   return parsed.success?{status:'accepted',reference:String(parsed.data.messageId)}:{status:'unknown'};
  }catch{return {status:'unknown'};}
 })();
 try{return await Promise.race([operation,timeout]);}finally{if(timer)clearTimeout(timer);}
}
