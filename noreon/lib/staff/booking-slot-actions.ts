"use server";
import {loggedAction} from '@/lib/observability/with-logging';
import {revalidatePath} from 'next/cache';
import {z} from 'zod';
import {requireRealAdmin,getRealClinics} from './real-admin';
import {slotFormSchema,slotOffer} from './booking-slots';

export type SlotActionState={ok:boolean;message?:string};
const fields=['requestId','clinicId','mode','date','start','end','capacity','preparation','reference','followUpOwner','followUpAction'];

export const createBookingSlot=loggedAction("createBookingSlot",async function createBookingSlot(_previous:SlotActionState,form:FormData):Promise<SlotActionState>{
 const {client}=await requireRealAdmin();
 const raw:Record<string,unknown>=Object.fromEntries(fields.map(key=>[key,form.get(key)??'']));
 raw.tests=form.getAll('tests');
 const parsed=slotFormSchema.safeParse(raw);
 if(!parsed.success)return {ok:false,message:'Check the slot details. Every field except the follow-up is required, and the end must be after the start.'};
 const input=parsed.data;
 const clinic=(await getRealClinics()).find(row=>row.id===input.clinicId&&row.active);
 if(!clinic)return {ok:false,message:'Choose an active clinic.'};
 if(input.mode==='clinic'&&!clinic.address?.trim())return {ok:false,message:'This clinic has no address yet. Add it before offering clinic visits.'};
 const offer=slotOffer(input,clinic.address??null);
 if(Date.parse(offer.startsAt)<=Date.now())return {ok:false,message:'Choose a start time in the future.'};
 const result=await client.rpc('real_admin_create_booking_slot',{p_offer:offer,p_capacity:input.capacity,p_valid_until:offer.startsAt});
 if(result.error){
  const code=result.error.code;
  return {ok:false,message:code==='42501'?'Only an active administrator can add slots.':code==='22023'?'The slot was refused. Check the clinic address, time and tests.':'The slot could not be saved. Reload the page to see whether it was added.'};
 }
 revalidatePath('/staff/real/booking-slots');
 return {ok:true,message:'Slot added. Members whose tests it covers can now book it.'};
});

export const closeBookingSlot=loggedAction("closeBookingSlot",async function closeBookingSlot(_previous:SlotActionState,form:FormData):Promise<SlotActionState>{
 const {client}=await requireRealAdmin();
 const key=z.string().regex(/^[a-f0-9]{64}$/).safeParse(form.get('key'));
 if(!key.success)return {ok:false,message:'Slot unavailable.'};
 const result=await client.rpc('real_admin_close_booking_slot',{p_key:key.data});
 if(result.error)return {ok:false,message:'The slot could not be closed. Reload and try again.'};
 revalidatePath('/staff/real/booking-slots');
 return {ok:true,message:'Slot closed. Visits already booked keep their place; any booking still waiting for its clinic email will need review.'};
});
