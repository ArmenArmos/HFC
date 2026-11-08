'use server';
import {loggedAction} from '@/lib/observability/with-logging';
import {revalidatePath} from 'next/cache';
import {z} from 'zod';
import {requirePatient} from '@/lib/patient/auth';
import {clinicalReviewEngine} from '@/lib/patient-care/clinical-review-engine';
import {snapshotSchema,requireRealStaff} from '@/lib/patient-care/clinical-case-repository';
import {clinicalWriteClient} from '@/lib/patient-care/clinical-publication-server';
import {realBookingEnabled} from './config';
import {bookingChannelConfigured,homeRequestsOnly} from './legacy-mode';
import {memberBookingContext,memberLdlRequestContext} from './repository';
import {bookingTermsSchema,bookingPreferenceSchema,providerInputSchema,type BookingFormState as BilingualBookingFormState} from './schema';
import { bookingFailure } from './form-error';
import {isLdlRetestRequest,ldlRetestEngine,ldlRetestHold} from '@/lib/ldl/retest';
type BookingFormState=BilingualBookingFormState&{messageRu?:string};
const commandSchema=z.object({id:z.uuid(),revision:z.coerce.number().int().nonnegative(),commandId:z.uuid()});
// A request the LDL re-test loop created is confirmed against its fixed requirement, not the screening engine. The form
// names the version; the database refuses a version or requirement that is not the request's own (20261029211448).
function ldlRequest(form:FormData){return isLdlRetestRequest({algorithmVersion:String(form.get('algorithmVersion')??'')});}
function terms(form:FormData){return bookingTermsSchema.parse(Object.fromEntries(['startsAt','endsAt','timezone','mode','location'].map(k=>[k,form.get(k)])));}
function preference(form:FormData){return bookingPreferenceSchema.parse(Object.fromEntries(['startsAt','timezone','mode','location'].map(key=>[key,form.get(key)])));}
function source(form:FormData){return {obtainedAt:form.get('obtainedAt'),channel:form.get('channel'),source:form.get('source')};}
function refresh(){for(const path of ['/patient/service','/patient/results','/patient/dashboard','/staff/real/members'])revalidatePath(path);revalidatePath('/staff/real/members/[id]','page');}
export const memberBookingCommand=loggedAction("memberBookingCommand",async function memberBookingCommand(_previous:BookingFormState,form:FormData):Promise<BookingFormState>{
 if(!realBookingEnabled(process.env))return {ok:false,code:'unavailable',message:'Test requests are not available yet.'};
 const identity=await requirePatient();
 try{
  const operation=String(form.get('operation')??'');const writer=clinicalWriteClient();let cancelPending=false;
  if(operation==='create'){
   // Preserve the existing preference workflow until the email pilot is configured.
   // The forward SQL compatibility boundary serializes reciprocal pilot exclusion.
   if(bookingChannelConfigured()&&!(homeRequestsOnly()&&preference(form).mode==='home'))return {ok:false,code:'unavailable',message:'Reload Your tests to see current booking choices.'};
   const current=await memberBookingContext();
   if(current.contextToken!==form.get('contextToken'))throw Error('Your questionnaire or profile changed. Reload before requesting.');
   // The browser chooses logistics only. Ignore legacy or forged testIds entirely.
   const requirements=current.engine.tests.filter(test=>test.method!=='home-log').map(test=>({id:test.id,title:test.title,method:test.method}));
   if(!requirements.length)return {ok:false,code:'invalid',message:'No new tests to arrange.'};
   const result=await writer.rpc('create_patient_test_request',{p_user_id:identity.userId,p_request_id:z.uuid().parse(form.get('requestId')),p_context_token:current.sourceToken,p_terms:preference(form),p_requirements:requirements,p_algorithm_version:current.engine.version});
   if(result.error)throw result.error;
  }else{
   const op=z.enum(['accept','cancel','request-change']).parse(operation);
   const c=commandSchema.parse({id:form.get('id'),revision:form.get('revision'),commandId:form.get('commandId')});
   // Re-run current clinical derivation before acceptance, never bypass changed urgency.
   const acceptedEngine=op!=='accept'?null:ldlRequest(form)?ldlRetestEngine((await memberLdlRequestContext()).sourceToken)
    :(c=>({sourceToken:c.sourceToken,version:c.engine.version,tests:c.engine.tests.map(t=>({id:t.id,title:t.title,method:t.method}))}))(await memberBookingContext());
   const result=await writer.rpc('command_patient_test_request',{p_user_id:identity.userId,p_actor:identity.userId,p_staff:false,p_id:c.id,p_revision:c.revision,p_command_id:c.commandId,p_operation:op,p_input:op==='request-change'?{terms:preference(form)}:acceptedEngine?{engine:acceptedEngine}:{}});
   if(result.error)throw result.error;
   cancelPending=op==='cancel'&&(result.data as {status?:string}|null)?.status==='change-pending';
  }
  refresh();
  // A confirmed or proposed arrangement is only cancelled once the provider accepts.
  if(cancelPending)return {ok:true,code:'saved',providerPending:true,message:'Your cancellation request was sent. The provider has not accepted it yet.',messageHy:'Չեղարկման հարցումն ուղարկվել է։ Ծառայություն մատուցողը դեռ չի ընդունել այն։',messageRu:'Ваш запрос на отмену отправлен. Поставщик услуг ещё не принял его.'};
  return {ok:true,code:operation==='create'?'requested':'saved',message:operation==='create'?'Your preferred arrangement was requested. A provider has not confirmed it yet.':'Your request was saved. Check its current status.'};
 }catch(error){return bookingFailure(error);}
});
export const staffBookingCommand=loggedAction("staffBookingCommand",async function staffBookingCommand(_previous:BookingFormState,form:FormData):Promise<BookingFormState>{
 if(!realBookingEnabled(process.env))return {ok:false,code:'unavailable',message:'Test requests are not available yet.'};
 const {identity}=await requireRealStaff();
 try{
  const c=commandSchema.parse({id:form.get('id'),revision:form.get('revision'),commandId:form.get('commandId')});
  const operation=z.enum(['confirm','change-outcome']).parse(form.get('operation'));
  const input=operation==='confirm'?providerInputSchema.parse({...source(form),terms:terms(form),provider:form.get('provider'),preparation:form.get('preparation'),replacesExisting:form.get('replacesExisting')==='on'}):z.object({outcome:z.enum(['accepted','declined']),obtainedAt:z.iso.datetime({offset:true}),channel:z.enum(['phone','email','portal','in-person']),source:z.string().trim().min(3).max(1000)}).parse({...source(form),outcome:form.get('outcome')});
  const writer=clinicalWriteClient();
  const contextResponse=await writer.rpc('patient_test_staff_context',{p_id:c.id,p_actor:identity.id});
  if(contextResponse.error)throw contextResponse.error;
  const context=z.object({userId:z.uuid(),contextToken:z.string(),evidence:snapshotSchema.shape.evidence}).parse(contextResponse.data);
  const engine=operation!=='confirm'?null:ldlRequest(form)?(ldlRetestHold(context.evidence),ldlRetestEngine(context.contextToken)):(e=>({sourceToken:context.contextToken,version:e.version,tests:e.tests.map(t=>({id:t.id,title:t.title,method:t.method}))}))(clinicalReviewEngine({id:context.userId,revision:0,evidenceToken:context.contextToken,evidence:context.evidence,draft:null,draftSavedAt:null,draftStale:false},'booking'));
  const response=await writer.rpc('command_patient_test_request',{p_user_id:context.userId,p_actor:identity.id,p_staff:true,p_id:c.id,p_revision:c.revision,p_command_id:c.commandId,p_operation:operation,p_input:{...input,...(engine?{engine}:{})}});
  if(response.error)throw response.error;
  refresh();return {ok:true,code:operation==='confirm'?'provider-recorded':'response-recorded',message:operation==='confirm'?'Provider terms and preparation recorded. Member acceptance is required.':'Provider response recorded.'};
 }catch(error){return bookingFailure(error);}
});
