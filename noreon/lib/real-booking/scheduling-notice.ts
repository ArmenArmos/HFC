import 'server-only';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {schedulingEmailSchema} from '@/lib/staff/clinic-scheduling-schema';

const mailbox=schedulingEmailSchema.refine((email):email is string=>email!==null);
const contentSchema=z.strictObject({senderEmail:mailbox,clinicEmail:mailbox,copyEmail:mailbox,templateVersion:z.string().min(1).max(200),subject:z.string().min(1).max(200).refine(s=>!/[\r\n]/.test(s)),textContent:z.string().min(1).max(32000)});
const envelopeSchema=contentSchema.extend({noticeId:z.uuid(),attemptId:z.uuid(),generation:z.number().int().positive().safe(),envelopeHash:z.string().regex(/^[a-f0-9]{64}$/)});
const configSchema=z.strictObject({enabled:z.boolean(),apiKey:z.string().min(20).max(1024),sender:mailbox});
export type SchedulingEnvelope=z.infer<typeof envelopeSchema>;
export type SchedulingSubmission={outcome:'disabled'}|{outcome:'accepted';noticeId:string;attemptId:string;generation:number;envelopeHash:string;reference:string;acceptedRoles:{clinic:string;copy:string}}|{outcome:'failed'|'unknown';noticeId:string;attemptId:string;generation:number;envelopeHash:string};

/** Same length-prefixed UTF-8 canonicalization must be used by the private SQL claim. */
export function schedulingEnvelopeHash(raw:unknown):string{
 const content=contentSchema.parse(raw);
 return createHash('sha256').update([content.senderEmail,content.clinicEmail,content.copyEmail,content.templateVersion,content.subject,content.textContent].map(value=>`${Buffer.byteLength(value,'utf8')}:${value}`).join('')).digest('hex');
}
const escapeHtml=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]!);

/** The guarded runtime requires explicit approved configuration before calling
 * this adapter. No automatic retries or fallback channels.
 * Brevo documents 201 + messageId as success for the supplied to/cc envelope:
 * https://developers.brevo.com/reference/send-transac-email . This proves API
 * submission acceptance only, never mailbox delivery/read or clinic acknowledgment.
 */
export async function sendSchedulingEmail(rawConfig:unknown,rawEnvelope:unknown,http:typeof fetch=fetch,timeoutMs=8000):Promise<SchedulingSubmission>{
 if(typeof rawConfig==='object'&&rawConfig!==null&&'enabled'in rawConfig&&rawConfig.enabled===false)return {outcome:'disabled'};
 const config=configSchema.parse(rawConfig),envelope=envelopeSchema.parse(rawEnvelope);
 const content=Object.fromEntries(['senderEmail','clinicEmail','copyEmail','templateVersion','subject','textContent'].map(key=>[key,envelope[key as keyof typeof envelope]]));
 if(config.sender!==envelope.senderEmail||schedulingEnvelopeHash(content)!==envelope.envelopeHash)throw Error('Scheduling envelope changed after claim');
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>10000)throw Error('Invalid scheduling timeout');
 const identity={noticeId:envelope.noticeId,attemptId:envelope.attemptId,generation:envelope.generation,envelopeHash:envelope.envelopeHash};
 const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
 const timedOut=new Promise<SchedulingSubmission>(resolve=>{timer=setTimeout(()=>{controller.abort();resolve({...identity,outcome:'unknown'});},timeoutMs);});
 const request=(async():Promise<SchedulingSubmission>=>{
  try{
   const response=await http('https://api.brevo.com/v3/smtp/email',{
    method:'POST',redirect:'error',signal:controller.signal,
    headers:{'api-key':config.apiKey,'Content-Type':'application/json',Accept:'application/json'},
    body:JSON.stringify({sender:{name:'Noreon',email:envelope.senderEmail},to:[{email:envelope.clinicEmail}],cc:[{email:envelope.copyEmail}],subject:envelope.subject,textContent:envelope.textContent,htmlContent:`<pre>${escapeHtml(envelope.textContent)}</pre>`,headers:{IdempotencyKey:envelope.attemptId,'X-Noreon-Notice':envelope.noticeId}}),
   });
   if(response.status!==201){
    const rejected=response.status>=400&&response.status<500&&![408,409,425].includes(response.status);
    return {...identity,outcome:rejected?'failed':'unknown'};
   }
   const receipt=z.strictObject({messageId:z.string().min(1).max(255)}).safeParse(await response.json());
   return receipt.success?{...identity,outcome:'accepted',reference:receipt.data.messageId,acceptedRoles:{clinic:envelope.clinicEmail,copy:envelope.copyEmail}}:{...identity,outcome:'unknown'};
  }catch{return {...identity,outcome:'unknown'};}
 })();
 try{return await Promise.race([request,timedOut]);}finally{clearTimeout(timer);}
}

