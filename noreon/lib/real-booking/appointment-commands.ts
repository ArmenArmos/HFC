import 'server-only';
import {proposalAnswerSchema,appointmentSelectionSchema,appointmentChangeSchema,appointmentCancelSchema,appointmentRetrySchema,appointmentSchema,type AppointmentSelection,type BookingProgram,type TrustedOffer,type PilotActionState,type SchedulingOutcome} from './appointment-schema';
import {checkOfferCoverage} from './program-authority';
type Change=ReturnType<typeof appointmentChangeSchema.parse>;
type Selection=AppointmentSelection|Change;
type Response={data:unknown;error:{code?:string}|null;status?:number};
/** Email fields are null for a clinic-hours slot: that booking is announced in the clinic portal. */
export type NoticeContent={senderEmail:string|null;templateVersion:string|null;subject:string|null;textContent:string|null};
export type AppointmentAdmission=Selection&{memberId:string;actorId:string;programId:string}&NoticeContent;
export type AppointmentPorts={
 available:boolean;
 recover:(input:Selection)=>Promise<Response>;
 prepare:(suggestedSetFingerprint?:string)=>Promise<{sealId:string;program:BookingProgram}>;
 offer:(input:Selection,prepared:{sealId:string;program:BookingProgram})=>Promise<TrustedOffer|null>;
 render:(input:Selection,offer:TrustedOffer,program:BookingProgram)=>NoticeContent;
 select:(input:AppointmentAdmission)=>Promise<Response>;
 dispatch:(noticeId:string)=>Promise<SchedulingOutcome>;
 invalidate:()=>void;
};
export function readPilotForm(form:FormData,change:boolean):Selection|null{
 const fields=['commandId','offerId','offerVersion','homeAddress','suggestedSetFingerprint',...(change?['appointmentId','revision','agreementSource']:[])];
 if([...form.keys()].some(key=>!fields.includes(key)&&!key.startsWith('$ACTION_')))return null;
 const raw:Record<string,unknown>=Object.fromEntries(fields.map(key=>[key,form.get(key)]));
 if(raw.suggestedSetFingerprint===null)delete raw.suggestedSetFingerprint;
 raw.homeAddress=typeof raw.homeAddress==='string'?raw.homeAddress.trim()||null:raw.homeAddress;
 if(change){
  raw.agreementSource=typeof raw.agreementSource==='string'?raw.agreementSource.trim()||null:raw.agreementSource;
  raw.revision=typeof raw.revision==='string'&&/^(0|[1-9]\d*)$/.test(raw.revision)?Number(raw.revision):NaN;
 }
 const parsed=(change?appointmentChangeSchema:appointmentSelectionSchema).safeParse(raw);
 return parsed.success?parsed.data:null;
}
export function readCancelForm(form:FormData){
 const fields=['commandId','appointmentId','revision','agreementSource'];
 if([...form.keys()].some(key=>!fields.includes(key)&&!key.startsWith('$ACTION_')))return null;
 const raw:Record<string,unknown>=Object.fromEntries(fields.map(key=>[key,form.get(key)]));
 raw.agreementSource=typeof raw.agreementSource==='string'?raw.agreementSource.trim()||null:null;
 raw.revision=typeof raw.revision==='string'&&/^(0|[1-9]\d*)$/.test(raw.revision)?Number(raw.revision):NaN;
 const parsed=appointmentCancelSchema.safeParse(raw);return parsed.success?parsed.data:null;
}
export function readProposalForm(form:FormData){
 const fields=['commandId','proposalId','accept'];
 if([...form.keys()].some(key=>!fields.includes(key)&&!key.startsWith('$ACTION_')))return null;
 const accept=form.get('accept');
 const parsed=proposalAnswerSchema.safeParse({commandId:form.get('commandId'),proposalId:form.get('proposalId'),accept:accept==='true'?true:accept==='false'?false:null});
 return parsed.success?parsed.data:null;
}
export function readNoticeRetryForm(form:FormData){
 const fields=['commandId','appointmentId','revision','noticeId'];
 if([...form.keys()].some(key=>!fields.includes(key)&&!key.startsWith('$ACTION_')))return null;
 const raw:Record<string,unknown>=Object.fromEntries(fields.map(key=>[key,form.get(key)]));
 raw.revision=typeof raw.revision==='string'&&/^(0|[1-9]\d*)$/.test(raw.revision)?Number(raw.revision):NaN;
 const parsed=appointmentRetrySchema.safeParse(raw);return parsed.success?parsed.data:null;
}
const unknown=():PilotActionState=>({ok:false,code:'unknown',commandRecorded:true,outcomeUnknown:true});
function knownError(code?:string):PilotActionState|null{
 if(code==='40001'||code==='55P03')return {ok:false,code:'conflict'};
 if(code==='22023'||code==='23514'||code==='22P02')return {ok:false,code:'invalid'};
 if(code==='42501')return {ok:false,code:'unavailable'};
 return null;
}
/** Context is derived by public Auth guards; it is never read from a form. */
export async function runAppointmentSelection(context:{memberId:string;actorId:string},raw:unknown,ports:AppointmentPorts):Promise<PilotActionState>{
 const change=typeof raw==='object'&&raw!==null&&'appointmentId'in raw;
 const parsed=(change?appointmentChangeSchema:appointmentSelectionSchema).safeParse(raw);
 if(!parsed.success)return {ok:false,code:ports.available?'invalid':'unavailable'};
 const input=parsed.data;let admissionAttempted=false,recorded=false;
 try{
  // Browser retries must recover their original private program/envelope before
  // a normal reading or deployment produces a different derivation/rendering.
  const recovered=await ports.recover(input);
  if(recovered.error)return knownError(recovered.error.code)??{ok:false,code:'unavailable'};
  let data=recovered.data;
  if(data===null){
   if(!ports.available)return {ok:false,code:'unavailable'};
   if(!input.suggestedSetFingerprint)return {ok:false,code:'tests-changed'};
   const prepared=await ports.prepare(input.suggestedSetFingerprint);
   if(prepared.program.memberId!==context.memberId)throw Error('Wrong program owner');
   if(input.suggestedSetFingerprint!==JSON.stringify(prepared.program.items.map(t=>t.id)))return {ok:false,code:'tests-changed'};
   const offer=await ports.offer(input,prepared);
   if(!offer||offer.id!==input.offerId||offer.version!==input.offerVersion)return {ok:false,code:'unavailable'};
   checkOfferCoverage(prepared.program,offer);
   if(offer.mode==='home'?!input.homeAddress:input.homeAddress!==null)return {ok:false,code:'invalid'};
   const envelope=ports.render(input,offer,prepared.program);
   admissionAttempted=true;
   const result=await ports.select({...input,...context,programId:prepared.sealId,...envelope});
   if(result.error)return result.status&&result.status>=500&&result.status!==500?unknown():knownError(result.error.code)??unknown();
   data=result.data;
  }
  const appointment=appointmentSchema.safeParse(data);
  if(!appointment.success||appointment.data.memberId!==context.memberId||appointment.data.id!==('appointmentId'in input?input.appointmentId:input.commandId)
   ||appointment.data.noticeId!==input.commandId||appointment.data.proposed.offerId!==input.offerId||appointment.data.proposed.offerVersion!==input.offerVersion)return unknown();
  recorded=true;
  if(!ports.available){ports.invalidate();return {ok:true,code:appointment.data.status==='confirmed'?'saved':'pending',commandRecorded:true};}
  const outcome=await ports.dispatch(appointment.data.noticeId);
  ports.invalidate();
  if(outcome==='arrangement-review')return {ok:false,code:'arrangement-review',commandRecorded:true};
  if(outcome==='unknown')return unknown();
  if(outcome==='failed')return {ok:false,code:'failed',commandRecorded:true};
  return {ok:true,code:outcome==='confirmed'?'saved':'pending',commandRecorded:true};
 }catch(error){
  if(!admissionAttempted&&!recorded&&typeof error==='object'&&error!==null&&'code'in error&&error.code==='tests-changed')return {ok:false,code:'tests-changed'};
  return admissionAttempted||recorded?unknown():{ok:false,code:'unavailable'};
 }
}
