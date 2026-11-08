import 'server-only';
import {z} from 'zod';
import {schedulingEmailSchema} from '@/lib/staff/clinic-scheduling-schema';
import {memberRequestedAt} from '@/lib/staff/member-queue-format';
import type {BookingProgram,TrustedOffer} from './appointment-schema';
const names=new Set(['reference','memberName','memberPhone','clinicName','visitMode','startsAt','endsAt','timezone','location','tests','coveredTests','preparation','followUp','previousStartsAt','previousLocation']);
const allowed=(value:string)=>[...value.matchAll(/\{\{([^{}]+)\}\}/g)].every(match=>names.has(match[1]));
const wording={subject:z.string().min(1).max(200).refine(value=>allowed(value)&&!/[\r\n]/.test(value)),textContent:z.string().min(1).max(32000).refine(allowed)};
// The base wording announces a new booking. A change or a cancellation is only
// sent when its own approved wording is configured; there is no fallback text.
const templateSchema=z.strictObject({version:z.string().trim().min(1).max(200),approvalReference:z.string().trim().min(1).max(1000),...wording,change:z.strictObject(wording).optional(),cancellation:z.strictObject(wording).optional()});
export type SchedulingRuntime={enabled:true;apiKey:string;sender:string;template:z.infer<typeof templateSchema>};
/** No default content, credentials or activation. A supplied approval reference
 * records trusted deployment input; it is not a clinical/privacy approval by AI.
 */
export function schedulingRuntime(env:Record<string,string|undefined>=process.env):SchedulingRuntime|null{
 if(env.NOREON_SCHEDULING_EMAIL_ENABLED!=='true')return null;
 try{
  const template=templateSchema.parse(JSON.parse(env.NOREON_SCHEDULING_APPROVED_TEMPLATE_JSON??''));
  const apiKey=z.string().min(20).max(1024).parse(env.NOREON_BREVO_EMAIL_API_KEY??env.NOREON_BREVO_API_KEY);
  const sender=schedulingEmailSchema.parse(env.NOREON_BREVO_EMAIL_SENDER);
  if(sender===null)return null;
  return {enabled:true,apiKey,sender,template};
 }catch{return null;}
}
export type NoticeWording='booking'|'change'|'cancellation';
/** Whether approved wording exists for this kind of clinic notice. */
export function hasSchedulingWording(runtime:SchedulingRuntime,purpose:NoticeWording):boolean{return purpose==='booking'||!!runtime.template[purpose];}
type Previous={startsAt:string;location:string}|null;
export function renderSchedulingNotice(runtime:SchedulingRuntime,input:{reference:string;memberName:string|null;memberPhone?:string|null;clinicName:string;program:BookingProgram;offer:TrustedOffer;homeAddress:string|null;purpose?:NoticeWording;previous?:Previous}){
 const {offer,program}=input;const purpose=input.purpose??'booking';
 const wording=purpose==='booking'?runtime.template:runtime.template[purpose];
 if(!wording)throw Error('Approved scheduling wording unavailable');
 if(purpose!=='booking'&&!input.previous)throw Error('Previous visit required');
 const location=offer.mode==='home'?input.homeAddress:offer.clinicAddress;
 if(!location?.trim())throw Error('Actual visit address required');
 const phone=input.memberPhone?.trim();
 const values:Record<string,string>={reference:input.reference,memberName:input.memberName??'',memberPhone:phone?(phone.startsWith('+')?phone:`+${phone}`):'',clinicName:input.clinicName,visitMode:offer.mode,
  startsAt:memberRequestedAt(offer.startsAt),endsAt:memberRequestedAt(offer.endsAt),timezone:offer.timezone,location:location.trim(),
  tests:program.items.map(item=>item.title).join('\n'),coveredTests:program.items.filter(item=>offer.coveredTestIds.includes(item.id)).map(item=>item.title).join('\n'),preparation:offer.preparation,
  followUp:offer.followUps.map(f=>`${program.items.find(item=>item.id===f.testId)?.title??f.testId}: ${f.owner}; ${f.action}; ${f.reference}`).join('\n'),
  previousStartsAt:input.previous?memberRequestedAt(input.previous.startsAt):'',previousLocation:input.previous?.location.trim()??'',
 };
 const render=(text:string)=>text.replace(/\{\{([^{}]+)\}\}/g,(_match,name:string)=>{if(!names.has(name))throw Error('Unsupported template field');return values[name];});
 const subject=render(wording.subject),textContent=render(wording.textContent);
 if(!subject.length||subject.length>200||/[\r\n]/.test(subject))throw Error('Invalid rendered scheduling subject');
 if(!textContent.length||textContent.length>32000)throw Error('Invalid rendered scheduling content');
 return {senderEmail:runtime.sender,templateVersion:runtime.template.version,subject,textContent};
}
