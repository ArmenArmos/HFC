import 'server-only';
import {createHmac,timingSafeEqual} from 'node:crypto';
import {z} from 'zod';

export const META_PLAN_URL='https://app.noreon.health/patient/care';
export const META_MAX_WEBHOOK_BYTES=65_536;
const secret=z.string().min(16).max(4096).regex(/^\S+$/);
const templateName=z.string().regex(/^[a-z][a-z0-9_]{0,511}$/);
const enTemplate=z.object({name:templateName,language:z.enum(['en','en_US','en_GB'])}).strict();
const hyTemplate=z.object({name:templateName,language:z.literal('hy')}).strict();
const configSchema=z.object({accessToken:secret,appSecret:secret,verifyToken:secret,wabaId:z.string().regex(/^[1-9][0-9]{0,31}$/),phoneNumberId:z.string().regex(/^[1-9][0-9]{0,31}$/),graphVersion:z.string().regex(/^v[1-9][0-9]{0,2}\.0$/),otpEn:enTemplate,planEn:enTemplate,otpHy:hyTemplate.optional(),planHy:hyTemplate.optional()}).strict();
export type MetaConfig=z.infer<typeof configSchema>;
export function parseMetaConfig(value:unknown):MetaConfig{return configSchema.parse(value);}
const inputSchema=z.object({destination:z.string().regex(/^\+374[0-9]{8}$/),locale:z.enum(['en','hy'])}).strict();
const otpInputSchema=inputSchema.extend({code:z.string().regex(/^[0-9]{6}$/)}).strict();
function selectedTemplate(config:MetaConfig,kind:'otp'|'plan',locale:'en'|'hy'){
 const result=kind==='otp'?(locale==='en'?config.otpEn:config.otpHy):(locale==='en'?config.planEn:config.planHy);
 if(!result)throw new Error('Meta template locale is not configured');
 return result;
}
function messageBase(destination:string,name:string,language:string){return {messaging_product:'whatsapp' as const,recipient_type:'individual' as const,to:destination.slice(1),type:'template' as const,template:{name,language:{code:language}}};}
/** Authentication copy-code templates require the same code in body and URL-button parameter. */
export function buildMetaOtpMessage(config:MetaConfig,value:unknown){
 const checked=parseMetaConfig(config),input=otpInputSchema.parse(value),template=selectedTemplate(checked,'otp',input.locale);
 const parameter={type:'text',text:input.code};
 const base=messageBase(input.destination,template.name,template.language);
 return {...base,template:{...base.template,components:[{type:'body',parameters:[parameter]},{type:'button',sub_type:'url',index:'0',parameters:[parameter]}]}};
}
/** Approved utility template has no variables and a static authenticated META_PLAN_URL button. */
export function buildMetaPlanMessage(config:MetaConfig,value:unknown){
 const checked=parseMetaConfig(config),input=inputSchema.parse(value),template=selectedTemplate(checked,'plan',input.locale);
 return messageBase(input.destination,template.name,template.language);
}
export type MetaSubmissionResult={status:'accepted';reference:string}|{status:'failed'|'unknown'};
const wamid=z.string().regex(/^wamid\.[A-Za-z0-9_+\/=-]{1,1024}$/);
const sendResponse=z.object({messages:z.array(z.object({id:wamid})).length(1)});
async function boundedJson(response:Response):Promise<unknown>{
 if(!response.body)return null;
 const reader=response.body.getReader();let bytes=0;const chunks:Uint8Array[]=[];
 try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>16_384){await reader.cancel();return null;}chunks.push(value);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}finally{reader.releaseLock();}
}
async function submit(config:MetaConfig,payload:ReturnType<typeof buildMetaPlanMessage>|ReturnType<typeof buildMetaOtpMessage>,fetchImpl:typeof fetch,timeoutMs:number):Promise<MetaSubmissionResult>{
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>10_000)throw new Error('Invalid Meta transport timeout');
 const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
 const timeout=new Promise<MetaSubmissionResult>(resolve=>{timer=setTimeout(()=>{controller.abort();resolve({status:'unknown'});},timeoutMs);});
 const operation=(async():Promise<MetaSubmissionResult>=>{
  try{
   const response=await fetchImpl(`https://graph.facebook.com/${config.graphVersion}/${config.phoneNumberId}/messages`,{method:'POST',headers:{Authorization:`Bearer ${config.accessToken}`,'Content-Type':'application/json'},body:JSON.stringify(payload),signal:controller.signal,redirect:'error'});
   if(!response.ok){void response.body?.cancel().catch(()=>{});return {status:[400,401,403,404,405,422,429].includes(response.status)?'failed':'unknown'};}
   const decoded=sendResponse.safeParse(await boundedJson(response));
   return decoded.success?{status:'accepted',reference:decoded.data.messages[0].id}:{status:'unknown'};
  }catch{return {status:'unknown'};}
 })();
 try{return await Promise.race([operation,timeout]);}finally{if(timer)clearTimeout(timer);}
}
export async function submitMetaOtpMessage(config:MetaConfig,input:unknown,fetchImpl:typeof fetch=fetch,timeoutMs=10_000):Promise<MetaSubmissionResult>{return submit(config,buildMetaOtpMessage(config,input),fetchImpl,timeoutMs);}
export async function submitMetaPlanMessage(config:MetaConfig,input:unknown,fetchImpl:typeof fetch=fetch,timeoutMs=10_000):Promise<MetaSubmissionResult>{return submit(config,buildMetaPlanMessage(config,input),fetchImpl,timeoutMs);}
const states=['sent','delivered','read','failed'] as const;
export type MetaDeliveryStatus=typeof states[number];
export type VerifiedMetaStatus={reference:string;status:MetaDeliveryStatus;timestamp:number};
const statusSchema=z.object({id:wamid,status:z.enum(states),timestamp:z.string().regex(/^[0-9]{1,12}$/).transform(Number).refine(Number.isSafeInteger)});
const webhookSchema=z.object({object:z.literal('whatsapp_business_account'),entry:z.array(z.object({id:z.string(),changes:z.array(z.object({field:z.literal('messages'),value:z.object({messaging_product:z.literal('whatsapp'),metadata:z.object({phone_number_id:z.string()}),statuses:z.array(statusSchema).max(1000).optional()})})).max(100)})).max(100)});
/** Caller must also bound streaming input before buffering it. Never returns provider payload/PII. */
export function verifyMetaWebhook(config:MetaConfig,signature:string|null,rawBody:string|Uint8Array):VerifiedMetaStatus[]|null{
 if(!signature||!/^sha256=[a-f0-9]{64}$/.test(signature)||Buffer.byteLength(rawBody)>META_MAX_WEBHOOK_BYTES)return null;
 const expected=createHmac('sha256',config.appSecret).update(rawBody).digest();
 if(!timingSafeEqual(expected,Buffer.from(signature.slice(7),'hex')))return null;
 try{
  const parsed=webhookSchema.safeParse(JSON.parse(typeof rawBody==='string'?rawBody:Buffer.from(rawBody).toString('utf8')));if(!parsed.success)return null;
  const result:VerifiedMetaStatus[]=[];
  for(const entry of parsed.data.entry){if(entry.id!==config.wabaId)return null;for(const change of entry.changes){if(change.value.metadata.phone_number_id!==config.phoneNumberId)return null;for(const status of change.value.statuses??[])result.push({reference:status.id,status:status.status,timestamp:status.timestamp});}}
  return result;
 }catch{return null;}
}
export function verifyMetaChallenge(config:MetaConfig,params:URLSearchParams):string|null{
 for(const key of ['hub.mode','hub.verify_token','hub.challenge'])if(params.getAll(key).length!==1)return null;
 const token=params.get('hub.verify_token')??'',challenge=params.get('hub.challenge')??'';
 if(params.get('hub.mode')!=='subscribe'||!/^\d{1,128}$/.test(challenge)||Buffer.byteLength(token)!==Buffer.byteLength(config.verifyToken))return null;
 return timingSafeEqual(Buffer.from(token),Buffer.from(config.verifyToken))?challenge:null;
}
