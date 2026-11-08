import 'server-only';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {TEST_CATALOGUE} from '@/lib/clinical/seed/tests';
import {requireRealAdmin} from './real-admin';

const slotSchema=z.strictObject({key:z.string(),clinicId:z.uuid(),clinicName:z.string(),startsAt:z.string(),endsAt:z.string(),capacity:z.number().int(),validUntil:z.string(),open:z.boolean(),reference:z.string(),createdAt:z.string(),held:z.number().int(),
 offers:z.array(z.strictObject({id:z.uuid(),version:z.string(),mode:z.enum(['home','clinic']),coveredTestIds:z.array(z.string()),preparation:z.string()}))});
export type BookingSlot=z.infer<typeof slotSchema>;

/** Visit tests an operator can mark as done in a slot. Home tracking is never booked. */
export const slotTests=TEST_CATALOGUE.filter(test=>test.method!=='home_log').map(test=>({id:test.id,title:test.name.en??test.name.hy}));

export async function getBookingSlots():Promise<BookingSlot[]>{
 const {client}=await requireRealAdmin();
 const result=await client.rpc('real_admin_booking_slots');
 if(result.error)throw Error('Visit slots are unavailable.');
 return z.array(slotSchema).parse(result.data);
}

const time=z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const slotFormSchema=z.strictObject({
 requestId:z.uuid(),clinicId:z.uuid(),mode:z.enum(['home','clinic']),date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),start:time,end:time,
 capacity:z.coerce.number().int().min(1).max(50),tests:z.array(z.enum(slotTests.map(test=>test.id) as [string,...string[]])).min(1),
 preparation:z.string().trim().min(1).max(8000),reference:z.string().trim().min(3).max(200),
 followUpOwner:z.string().trim().max(300),followUpAction:z.string().trim().max(2000),
}).refine(input=>input.end>input.start,{path:['end'],message:'End after start'})
 .refine(input=>!input.followUpOwner===!input.followUpAction,{path:['followUpAction'],message:'Both or neither'});
export type SlotForm=z.infer<typeof slotFormSchema>;

/** Yerevan has no daylight saving: every slot time is UTC+4. */
export const yerevanTime=(date:string,clock:string)=>`${date}T${clock}:00+04:00`;

/** The trusted offer for one admin-entered slot. The request id makes a resubmission idempotent. */
export function slotOffer(input:SlotForm,clinicAddress:string|null){
 const startsAt=yerevanTime(input.date,input.start),endsAt=yerevanTime(input.date,input.end);
 const reference=`${input.reference} · ${input.requestId}`;
 const followUps=input.followUpOwner?slotTests.filter(test=>!input.tests.includes(test.id)).map(test=>({testId:test.id,owner:input.followUpOwner,action:input.followUpAction,reference:input.reference})):[];
 return {id:input.requestId,version:'admin-slot-v1',source:'noreon-admin-slot',clinicId:input.clinicId,mode:input.mode,startsAt,endsAt,timezone:'Asia/Yerevan',
  clinicAddress:input.mode==='clinic'?clinicAddress:null,preparation:input.preparation,preparationVersion:createHash('sha256').update(input.preparation).digest('hex').slice(0,16),
  coveredTestIds:input.tests,followUps,reservationContract:{version:'admin-slot-v1',reference}};
}
