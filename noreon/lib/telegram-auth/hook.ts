import 'server-only';
import {createCipheriv,createDecipheriv,createHmac,randomBytes} from 'node:crypto';
import {z} from 'zod';
import {authSmsHookResponse,readSignedAuthHook} from '@/lib/messaging/auth-sms-hook';
import {log,type Logger} from '@/lib/observability/logger';
import type {AttemptOutcome} from '@/lib/conversation-core/contracts';

/**
 * Supabase Send-SMS hook, Telegram provider (T-auth v5.1 §3). The code is sent only to
 * the Telegram account bound to the phone, or freshly proven for it by this browser,
 * and only when one of our sign-in requests is waiting. No code is stored: the request
 * keeps a keyed digest over (request, phone, code) so the app accepts the code only
 * from the browser whose request delivered it.
 */
const TOTAL_MS=4_500;
export type TelegramAuthKeys={hookSecret:string;digestKey:Buffer};

/** The hook secret is a Standard Webhooks `whsec_` key; its bytes also key every digest. */
export function telegramAuthKeys(hookSecret:string|undefined):TelegramAuthKeys{
 const secret=(hookSecret??'').replace(/^v1,/,'');
 if(!/^whsec_[A-Za-z0-9+/]+={0,2}$/.test(secret))throw Error('hook configuration');
 const digestKey=Buffer.from(secret.slice(6),'base64');
 if(digestKey.length<32||digestKey.toString('base64')!==secret.slice(6))throw Error('hook configuration');
 return {hookSecret:secret,digestKey};
}
const mac=(key:Buffer,parts:string[])=>createHmac('sha256',key).update(parts.join('\0')).digest('hex');
export const nonceDigest=(keys:TelegramAuthKeys,nonce:string)=>mac(keys.digestKey,['noreon-tauth-nonce-v1',nonce]);
export const codeDigest=(keys:TelegramAuthKeys,requestId:string,phone:string,code:string)=>mac(keys.digestKey,['noreon-tauth-code-v1',requestId,phone,code]);
const bodyDigest=(keys:TelegramAuthKeys,body:string)=>mac(keys.digestKey,['noreon-tauth-body-v1',body]);
/** One-tap sign-in links: the hook seals the code for the server that opened the request (AES-256-GCM, bound to the request). */
const sealKey=(keys:TelegramAuthKeys)=>createHmac('sha256',keys.digestKey).update('noreon-signin-link-seal-v1').digest();
export function sealCode(keys:TelegramAuthKeys,requestId:string,code:string):string{
 const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',sealKey(keys),iv);c.setAAD(Buffer.from(requestId));
 const body=Buffer.concat([c.update(code,'utf8'),c.final()]);
 return [iv,c.getAuthTag(),body].map(b=>b.toString('base64url')).join('.');
}
export function unsealCode(keys:TelegramAuthKeys,requestId:string,sealed:string):string|null{
 try{const [iv,tag,body]=sealed.split('.').map(p=>Buffer.from(p,'base64url'));const d=createDecipheriv('aes-256-gcm',sealKey(keys),iv);d.setAAD(Buffer.from(requestId));d.setAuthTag(tag);
  const code=Buffer.concat([d.update(body),d.final()]).toString('utf8');return /^[0-9]{6}$/.test(code)?code:null;}catch{return null;}
}

/** Fixed sign-in code text; carries no clinical content. */
export const telegramCodeText=(code:string)=>`Ձեր Նորեոն Հելթ կոդը՝ ${code}։ Մի՛ փոխանցեք այն ոչ մեկին։\nYour Noreon code is ${code}. Do not share it with anyone.`;

const claimSchema=z.union([
 z.object({ok:z.literal(true),replay:z.literal(false),requestId:z.uuid(),address:z.string().regex(/^[1-9][0-9]{0,15}$/),route:z.enum(['binding','proof'])}),
 z.object({ok:z.literal(true),replay:z.literal(false),requestId:z.uuid(),route:z.enum(['link','test'])}),
 z.object({ok:z.literal(true),replay:z.literal(true),requestId:z.uuid(),state:z.string(),address:z.string().nullable()}),
 z.object({ok:z.literal(false),code:z.string()}),
]);
export type TelegramAuthHookStore={
 claim(phone:string,webhookId:string,bodyHmac:string,ms:number):Promise<unknown>;
 finish(requestId:string,webhookId:string,outcome:'accepted'|'failed'|'unknown',codeDigest:string|null,ms:number):Promise<unknown>;
 seal?(requestId:string,webhookId:string,sealed:string,ms:number):Promise<unknown>;
};
export type TelegramCodeSender=(address:string,text:string,ms:number)=>Promise<AttemptOutcome>;
const payloadSchema=z.object({user:z.object({phone:z.string().regex(/^\+?[1-9][0-9]{6,14}$/)}),sms:z.object({otp:z.string().regex(/^[0-9]{6}$/)})});

async function bounded<T>(operation:Promise<T>,ms:number):Promise<T>{
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{return await Promise.race([operation,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('deadline')),Math.max(1,ms));})]);}finally{if(timer)clearTimeout(timer);}
}

/**
 * Signature first, then claim → at most one send → finish. Anything but a confirmed
 * Telegram acceptance answers non-200, which makes Supabase reject the generated code.
 */
export async function handleTelegramAuthHook(request:Request,keys:TelegramAuthKeys,storeFactory:()=>TelegramAuthHookStore,send:TelegramCodeSender,logger:Pick<Logger,'info'|'warn'>=log):Promise<Response>{
 const started=Date.now(),deadline=started+TOTAL_MS;
 const reply=(status:number,error_code:string,response?:Response)=>{
  logger[status===200?'info':'warn']('telegram_auth_hook',{status,error_code,duration_ms:Date.now()-started});
  return response??authSmsHookResponse(status);
 };
 const signed=await readSignedAuthHook(request,keys.hookSecret,deadline);
 if(signed instanceof Response)return reply(signed.status,signed.status===408?'deadline':signed.status===401||signed.status===403?'bad_signature':'bad_payload',signed);
 const parsed=payloadSchema.safeParse(signed.value);if(!parsed.success)return reply(400,'bad_payload');
 const phone=parsed.data.user.phone.startsWith('+')?parsed.data.user.phone:`+${parsed.data.user.phone}`,code=parsed.data.sms.otp;
 let store:TelegramAuthHookStore,claim:z.infer<typeof claimSchema>;
 try{
  store=storeFactory();const ms=Math.min(900,deadline-Date.now()-3000);if(ms<1)return reply(503,'deadline');
  claim=claimSchema.parse(await bounded(store.claim(phone,signed.id,bodyDigest(keys,signed.body),ms),ms));
 }catch{return reply(503,'claim_failed');}
 // A retried webhook never sends again; it answers with the first outcome.
 if(!claim.ok)return reply(503,['no_request','no_destination','reproof_required','link_unavailable','invalid','conflict'].includes(claim.code)?claim.code:'claim_failed');
 if(claim.replay)return reply(claim.state==='sent'||claim.state==='verified'?200:503,`replay_${['issuing','sending','sent','failed','unknown','verified','cancelled','refused','exhausted'].includes(claim.state)?claim.state:'unknown'}`);
 let outcome:AttemptOutcome={kind:'unknown',reason:'not sent'};
 if(claim.route==='link'||claim.route==='test'){
  // One-tap sign-in: nothing is sent; the code is sealed for the server that opened this request.
  try{const ms=Math.min(900,deadline-Date.now()-1500);if(ms>=1&&store.seal){const sealed=z.object({ok:z.literal(true),updated:z.literal(true)}).safeParse(await bounded(store.seal(claim.requestId,signed.id,sealCode(keys,claim.requestId,code),ms),ms));
   if(sealed.success)outcome={kind:'accepted',providerRef:'sealed'} as AttemptOutcome;}}catch{outcome={kind:'unknown',reason:'seal not confirmed'};}
 }else if(claim.route==='binding'||claim.route==='proof'){
 const sendMs=Math.min(2000,deadline-Date.now()-1000);
 if(sendMs>=1){try{outcome=await bounded(send(claim.address,telegramCodeText(code),sendMs),sendMs);}catch{outcome={kind:'unknown',reason:'no conclusive acknowledgement'};}}
 }
 const result=outcome.kind==='accepted'?'accepted':outcome.kind==='definitely_failed'||outcome.kind==='unsupported'?'failed':'unknown';
 try{
  const ms=Math.min(900,deadline-Date.now());if(ms<1)return reply(503,'deadline');
  const finished=z.object({ok:z.literal(true),updated:z.boolean()}).parse(await bounded(store.finish(claim.requestId,signed.id,result,result==='accepted'?codeDigest(keys,claim.requestId,phone,code):null,ms),ms));
  if(!finished.updated)return reply(503,'finish_not_updated');
 }catch{return reply(503,'finish_failed');}
 return reply(result==='accepted'?200:503,(claim.route==='link'||claim.route==='test')&&result!=='accepted'?'seal_unconfirmed':`send_${outcome.kind}`);
}
