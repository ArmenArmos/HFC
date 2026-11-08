import 'server-only';
import {clinicalLocale,pick} from '@/lib/locale';
import twilio from 'twilio';
import {z} from 'zod';
import {smsSender} from './channels';
import type {MessageListInstanceCreateOptions} from 'twilio/lib/rest/api/v2010/account/message';

const phone=z.string().regex(/^\+[1-9][0-9]{7,14}$/);
const fixedHttpsUrl=z.string().url().refine(value=>{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&!url.search&&!url.hash;});
const configSchema=z.object({
 accountSid:z.string().regex(/^AC[0-9a-fA-F]{32}$/),authToken:z.string().min(16).optional(),apiKeySid:z.string().regex(/^SK[0-9a-fA-F]{32}$/).optional(),apiKeySecret:z.string().min(16).optional(),
 smsFrom:smsSender,whatsappFrom:z.string().regex(/^whatsapp:\+[1-9][0-9]{7,14}$/).optional(),
 whatsappHyContentSid:z.string().regex(/^HX[0-9a-fA-F]{32}$/).optional(),whatsappEnContentSid:z.string().regex(/^HX[0-9a-fA-F]{32}$/).optional(),
 appUrl:fixedHttpsUrl,callbackUrl:fixedHttpsUrl,
}).strict().refine(value=>(!value.apiKeySid&&!value.apiKeySecret||Boolean(value.apiKeySid&&value.apiKeySecret))&&(Boolean(value.authToken)||Boolean(value.apiKeySid&&value.apiKeySecret)),'Twilio credentials required');
export type TwilioConfig=z.infer<typeof configSchema>;
export function parseTwilioConfig(value:unknown):TwilioConfig{return configSchema.parse(value);}
const inputSchema=z.object({attemptId:z.uuid(),destination:phone,channel:z.enum(['sms','whatsapp']),locale:z.enum(['hy','en','ru'])}).strict();
export type PlanMessageInput=z.infer<typeof inputSchema>;
const deliveryStates=['queued','sending','sent','delivered','read','undelivered','failed','accepted','scheduled','canceled'] as const;
export type ProviderDeliveryStatus=typeof deliveryStates[number];
function deliveryStatus(value:unknown):ProviderDeliveryStatus|null{return typeof value==='string'&&(deliveryStates as readonly string[]).includes(value)?value as ProviderDeliveryStatus:null;}
function errorCode(value:unknown):string|null{return typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?String(value):typeof value==='string'&&/^\d{1,10}$/.test(value)?value:null;}
function callbackUrl(config:TwilioConfig,attemptId:string){const url=new URL(config.callbackUrl);url.searchParams.set('attempt',attemptId);return url.toString();}
export function buildPlanMessage(config:TwilioConfig,value:unknown):MessageListInstanceCreateOptions{
 const input=inputSchema.parse(value);
 const common={statusCallback:callbackUrl(config,input.attemptId),validityPeriod:300};
 if(input.channel==='whatsapp'){if(!config.whatsappFrom||!config.whatsappHyContentSid||!config.whatsappEnContentSid)throw Error('WhatsApp unavailable');return {...common,from:config.whatsappFrom,to:`whatsapp:${input.destination}`,contentSid:clinicalLocale(input.locale)==='hy'?config.whatsappHyContentSid:config.whatsappEnContentSid};}
 return {...common,from:config.smsFrom,to:input.destination,body:pick(input.locale,{hy:`Ձեր նոր խնամքի պլանը հասանելի է։ Բացեք Noreon՝ ${config.appUrl}`,en:`Your new care plan is available. Open Noreon: ${config.appUrl}`,ru:`Ваш новый план лечения доступен. Откройте Noreon: ${config.appUrl}`})};
}
export type SubmissionResult={status:'accepted';reference:string;deliveryStatus:ProviderDeliveryStatus|null;errorCode:string|null}|{status:'failed'|'unknown'};
type MessageTransport={messages:{create:(options:MessageListInstanceCreateOptions)=>Promise<{sid:string;status:string;errorCode?:number|null}>}};
export function createTwilioTransport(config:TwilioConfig){return twilio(config.apiKeySid??config.accountSid,config.apiKeySid?config.apiKeySecret:config.authToken,{accountSid:config.accountSid,autoRetry:false,maxRetries:0,timeout:10_000,logLevel:'error'});}
export async function submitPlanMessage(config:TwilioConfig,input:unknown,transport:MessageTransport=createTwilioTransport(config)):Promise<SubmissionResult>{
 const message=buildPlanMessage(config,input);
 try{
  const result=await transport.messages.create(message);
  if(!/^(SM|MM)[0-9a-fA-F]{32}$/.test(result.sid))return {status:'unknown'};
  return {status:'accepted',reference:result.sid,deliveryStatus:deliveryStatus(result.status),errorCode:errorCode(result.errorCode)};
 }catch(error){
  // Only recognized request rejections are definitive. Other responses may be ambiguous.
  const status=error&&typeof error==='object'&&'status' in error?error.status:null;
  return {status:typeof status==='number'&&[400,401,403,404,405,422,429].includes(status)?'failed':'unknown'};
 }
}
export type VerifiedDeliveryCallback={attemptId:string;reference:string;status:ProviderDeliveryStatus;errorCode:string|null};
/** Form text must be read with a streaming size limit by the eventual route. */
export function verifyTwilioCallback(config:TwilioConfig,attemptId:string,signature:string|null,body:string):VerifiedDeliveryCallback|null{
 if(!config.authToken||!z.uuid().safeParse(attemptId).success||!signature||signature.length>256||Buffer.byteLength(body,'utf8')>16_384)return null;
 const fields=new URLSearchParams(body),params:Record<string,string>=Object.create(null);
 for(const [key,value] of fields){if(Object.hasOwn(params,key))return null;params[key]=value;}
 if(!twilio.validateRequest(config.authToken,signature,callbackUrl(config,attemptId),params))return null;
 const status=deliveryStatus(params.MessageStatus);
 if(params.AccountSid!==config.accountSid||!status||!/^(SM|MM)[0-9a-fA-F]{32}$/.test(params.MessageSid??''))return null;
 return {attemptId,reference:params.MessageSid,status,errorCode:errorCode(params.ErrorCode)};
}

/** Project all observed facts, not arrival order; contradictions remain visible. */
export function projectDeliveryStatus(events:ReadonlyArray<{status:ProviderDeliveryStatus}>):{status:ProviderDeliveryStatus|null;conflict:boolean}{
 const rank:Record<ProviderDeliveryStatus,number>={accepted:1,scheduled:2,queued:3,sending:4,sent:5,canceled:6,failed:7,undelivered:8,delivered:9,read:10};
 let status:ProviderDeliveryStatus|null=null,success=false,failure=false;
 for(const event of events){if(!status||rank[event.status]>rank[status])status=event.status;if(event.status==='read'||event.status==='delivered')success=true;if(['failed','undelivered','canceled'].includes(event.status))failure=true;}
 return {status,conflict:success&&failure};
}

/** Readiness represents approved senders/templates, not merely syntactically valid credentials. */
export function twilioAvailableChannels(config:TwilioConfig,env:Record<string,string|undefined>=process.env):Array<'sms'|'whatsapp'>{const channels:Array<'sms'|'whatsapp'>=[];if(env.NOREON_TWILIO_SMS_READY==='true')channels.push('sms');if(env.NOREON_TWILIO_WHATSAPP_READY==='true'&&config.whatsappFrom&&config.whatsappHyContentSid&&config.whatsappEnContentSid)channels.push('whatsapp');return channels;}
