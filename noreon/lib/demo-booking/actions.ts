'use server';
import {loggedAction} from '@/lib/observability/with-logging';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { demoEnabled, readDemoSnapshot, saveDemo } from '@/lib/patient/demo';
import { getStaff } from '@/lib/staff/auth';
import { getWorkspaceCase, persistWorkspaceCase, sharedDemoEnabled } from '@/lib/staff/cases';
import { bookingTermsSchema, bookingPreferenceSchema, providerInputSchema, type BookingFormState } from '@/lib/real-booking/schema';
import { applyDemoBookingOperation, DemoBookingError, type DemoBookingOperation } from './model';
import { requireDemoBookingWorkflow, requireStoredDemoBookingWorkflow, demoBookingNeedsClinicalEligibility } from './repository';
const commandSchema=z.object({id:z.uuid(),revision:z.coerce.number().int().nonnegative(),commandId:z.uuid()});
function terms(form:FormData){return bookingTermsSchema.parse(Object.fromEntries(['startsAt','endsAt','timezone','mode','location'].map(key=>[key,form.get(key)])));}
function preference(form:FormData){return bookingPreferenceSchema.parse(Object.fromEntries(['startsAt','timezone','mode','location'].map(key=>[key,form.get(key)])));}
function source(form:FormData){return {obtainedAt:form.get('obtainedAt'),channel:form.get('channel'),source:form.get('source')};}
function command(form:FormData,staff:boolean):DemoBookingOperation {
 const operation=String(form.get('operation')??'');
 if(!staff && operation==='create')return {operation,id:z.uuid().parse(form.get('requestId')),contextToken:z.string().parse(form.get('contextToken')),testIds:z.array(z.string()).min(1).max(40).parse(JSON.parse(String(form.get('testIds')??'[]'))),terms:preference(form)};
 const c=commandSchema.parse({id:form.get('id'),revision:form.get('revision'),commandId:form.get('commandId')});
 if(staff){
  if(operation==='confirm')return {...c,operation,input:providerInputSchema.parse({...source(form),terms:terms(form),provider:form.get('provider'),preparation:form.get('preparation'),replacesExisting:form.get('replacesExisting')==='on'})};
  if(operation==='change-outcome')return {...c,operation,outcome:z.enum(['accepted','declined']).parse(form.get('outcome')),source:z.object({obtainedAt:z.iso.datetime({offset:true}),channel:z.enum(['phone','email','portal','in-person']),source:z.string().trim().min(3).max(1000)}).parse(source(form))};
 } else {
  if(operation==='accept'||operation==='cancel')return {...c,operation};
  if(operation==='request-change')return {...c,operation,terms:preference(form)};
 }
 throw new DemoBookingError('invalid','This fictional booking action is unavailable.');
}
function failure(error:unknown):BookingFormState {
 if(error instanceof DemoBookingError)return {ok:false,code:error.code,message:error.message};
 if(error instanceof z.ZodError||error instanceof SyntaxError)return {ok:false,code:'invalid',message:'Check the time, location and required fields.'};
 if(error instanceof Error && /changed|conflict|Refresh/i.test(error.message))return {ok:false,code:'conflict',message:'The demo case changed. Reload before trying again.'};
 return {ok:false,code:'failed',message:'The fictional request could not be saved. Reload and try again.'};
}
function refresh(){revalidatePath('/patient','layout');revalidatePath('/staff','layout');}
export const demoMemberBookingCommand=loggedAction("demoMemberBookingCommand",async function demoMemberBookingCommand(_previous:BookingFormState,form:FormData):Promise<BookingFormState> {
 try {
  if(!demoEnabled()||!sharedDemoEnabled())throw new DemoBookingError('unavailable','Shared demo booking is unavailable.');
  const operation=command(form,false);
  const snapshot=await readDemoSnapshot();const data=snapshot?.state??null;const workflow=requireStoredDemoBookingWorkflow(data);
  if(demoBookingNeedsClinicalEligibility(workflow,operation))requireDemoBookingWorkflow(data);
  const next=applyDemoBookingOperation(workflow,operation,{id:data!.userId,role:'member'});
  if(next.revision!==workflow.revision){data!.workflow=next;await saveDemo(data!);refresh();}
  return {ok:true,code:'saved',message:'Your fictional request was saved. Check its current status. This demo does not contact providers or send messages.'};
 }catch(error){return failure(error);}
});
export const demoStaffBookingCommand=loggedAction("demoStaffBookingCommand",async function demoStaffBookingCommand(caseId:string,_previous:BookingFormState,form:FormData):Promise<BookingFormState> {
 try {
  if(!demoEnabled()||!sharedDemoEnabled())throw new DemoBookingError('unavailable','Shared demo booking is unavailable.');
  const staff=await getStaff();if(staff?.role!=='admin')throw new DemoBookingError('unavailable','Sign in to the authenticated operations workspace.');
  const operation=command(form,true);
  const item=await getWorkspaceCase(z.uuid().parse(caseId),staff);const workflow=requireStoredDemoBookingWorkflow(item.state);
  if(demoBookingNeedsClinicalEligibility(workflow,operation))requireDemoBookingWorkflow(item.state);
  const next=applyDemoBookingOperation(workflow,operation,{id:staff.id,role:'admin'});
  if(next.revision!==workflow.revision){item.state.workflow=next;await persistWorkspaceCase(item.state,null,staff.id);refresh();}
  return {ok:true,code:'provider-recorded',message:'Fictional provider response recorded. No provider was contacted and no message was sent.'};
 }catch(error){return failure(error);}
});
