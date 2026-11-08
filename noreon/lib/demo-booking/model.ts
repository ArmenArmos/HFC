import { bookingPreferenceSchema, providerInputSchema, type BookingRequest, type BookingPreference } from '@/lib/real-booking/schema';
import { ALGORITHM_VERSION } from '@/lib/clinical/rules/rules';
import { bookingApplies, bookingHasReceipt, ensureRecommendationRecords } from '@/lib/service-workflow/reconciliation';
import type { ServiceWorkflow, ServiceBooking } from '@/lib/service-workflow/types';
export type DemoBookingRequest = BookingRequest & { requirementIds: string[]; commandIds: string[]; bookingId?: string };
export class DemoBookingError extends Error {
  code: 'invalid'|'past-time'|'conflict'|'clinical-hold'|'provider-action'|'unavailable';
  constructor(code: DemoBookingError['code'], message: string) { super(message); this.code=code; }
}
function check(value: unknown, message: string, code: DemoBookingError['code']='provider-action'): asserts value { if (!value) throw new DemoBookingError(code,message); }
export function demoBookingContext(workflow: ServiceWorkflow) {
  const normalized=structuredClone(workflow);ensureRecommendationRecords(normalized);
  return JSON.stringify([normalized.clinicalContext, normalized.questionnaireRevision, normalized.requirements!.filter(r=>r.retiredAtRevision===null).map(r=>[r.requirementId,r.test]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])))]);
}
export function getDemoStaffBookingRequests(workflow: ServiceWorkflow): DemoBookingRequest[] {
  const token=demoBookingContext(workflow);
  return (workflow.bookingRequests ?? []).map(r=>({...structuredClone(r),contextStale:!!workflow.recommendationsPending || r.contextToken!==token}));
}
export type DemoBookingOperation =
 | { operation:'create'; id:string; contextToken:string; testIds:string[]; terms:BookingPreference }
 | { operation:'accept'|'cancel'; id:string; revision:number; commandId:string }
 | { operation:'request-change'; id:string; revision:number; commandId:string; terms:BookingPreference }
 | { operation:'confirm'; id:string; revision:number; commandId:string; input:unknown }
 | { operation:'change-outcome'; id:string; revision:number; commandId:string; outcome:'accepted'|'declined'; source:unknown };
/** Fictional lifecycle only. No network or provider dispatch. */
export function applyDemoBookingOperation(workflow: ServiceWorkflow, command:DemoBookingOperation, actor:{id:string;role:'member'|'admin'}, now=new Date()):ServiceWorkflow {
  const w=structuredClone(workflow); ensureRecommendationRecords(w); w.bookingRequests ??= [];
  const stamp=now.toISOString();
  const future=(terms:BookingPreference)=>{bookingPreferenceSchema.parse(terms);check(Date.parse(terms.startsAt)>now.getTime(),'Choose a future arrival window.','past-time');};
  const current=(r:DemoBookingRequest)=>check(!w.recommendationsPending && r.contextToken===demoBookingContext(w),'The test requirements changed. Reload and review the current request.','conflict');
  if(command.operation==='create') {
    check(actor.role==='member','Only the member can request arrangements.');
    const existing=w.bookingRequests.find(r=>r.id===command.id);
    if(existing){check(existing.contextToken===command.contextToken && JSON.stringify(existing.requestedTerms)===JSON.stringify(command.terms) && JSON.stringify(existing.requirements.map(r=>r.id))===JSON.stringify(command.testIds),'The request identity was already used.','conflict');return w;}
    check(!w.recommendationsPending && command.contextToken===demoBookingContext(w),'The questionnaire or requirements changed. Reload before requesting.','conflict');
    check(command.testIds.length>0 && command.testIds.length<=40 && new Set(command.testIds).size===command.testIds.length,'Choose each recommended test once.','invalid');
    const requirements=command.testIds.map(id=>{const test=w.tests.find(t=>t.id===id && t.method!=='home-log');check(test,'Choose tests from the current recommendations.','conflict');check(!w.receivedTestIds.includes(id),'Results for this test are already received.');check(!w.bookings.some(b=>bookingApplies(w,b,id)) && !w.bookingRequests!.some(r=>r.status!=='cancelled'&&r.contextToken===command.contextToken&&r.requirements.some(t=>t.id===id)),'This test already has an active request or booking.');return {id:test.id,title:test.title,method:test.method as 'lab'|'clinic'};});
    future(command.terms);
    w.bookingRequests.push({id:command.id,revision:0,status:'requested',requestedTerms:command.terms,requirements,algorithmVersion:ALGORITHM_VERSION,contextToken:command.contextToken,contextStale:false,proposal:null,currentArrangement:null,pendingChange:null,createdAt:stamp,requirementIds:w.requirements!.filter(r=>r.retiredAtRevision===null&&command.testIds.includes(r.test.id)).map(r=>r.requirementId),commandIds:[]});
  } else {
    const r=w.bookingRequests.find(r=>r.id===command.id);check(r,'This request is unavailable.','conflict');
    if(r.commandIds.includes(command.commandId))return w;
    check(r.revision===command.revision,'This request changed. Reload before trying again.','conflict');
    check(r.status!=='cancelled','This request was cancelled.');
    const booking=()=>w.bookings.find(b=>b.id===r.bookingId && b.status==='scheduled');
    const editable=()=>{const b=booking();check(!b||!bookingHasReceipt(w,b),'Received results prevent changing this arrangement.');};
    const project=()=>{
      const arrangement=r.currentArrangement;check(arrangement,'No effective provider arrangement.');
      const old=booking();editable();const id=`demo-request-${r.id}-${r.revision+1}`;
      if(old){old.status='cancelled';old.replacedBy=id;}
      const tests=r.requirements.map(test=>w.tests.find(t=>t.id===test.id)!);
      const projected:ServiceBooking={id,testIds:tests.map(t=>t.id),testSnapshots:structuredClone(tests),requirementIds:[...r.requirementIds],at:arrangement.terms.startsAt,mode:arrangement.terms.mode,address:arrangement.terms.location,status:'scheduled',providerPreparation:{provider:arrangement.provider,instructions:arrangement.preparation,recordedAt:arrangement.recordedAt,recordedBy:arrangement.recordedBy}};
      w.bookings.push(projected);r.bookingId=id;
    };
    if(command.operation==='confirm') {
      check(actor.role==='admin','Only authenticated operations can record fictional provider terms.');current(r);editable();
      check(r.pendingChange?.kind!=='cancel','Resolve the pending cancellation first.');
      const input=providerInputSchema.parse(command.input);future(input.terms);check(Date.parse(input.obtainedAt)<=now.getTime(),'The simulated provider response cannot be obtained in the future.','invalid');
      if(r.currentArrangement||r.proposal){check(input.replacesExisting,'Acknowledge replacement terms.');check(input.provider===(r.currentArrangement?.provider??r.proposal?.provider),'Record replacement terms from the same fictional provider.');}
      r.proposal={...input,source:`Fictional demo provider response: ${input.source}`,recordedAt:stamp,recordedBy:actor.id};r.status='provider-proposed';
      if(r.currentArrangement)r.pendingChange={kind:'reschedule',terms:input.terms,memberAccepted:false};
    } else if(command.operation==='accept') {
      check(actor.role==='member','Only the member can accept terms.');current(r);editable();check(r.proposal && (r.status==='provider-proposed'||r.pendingChange?.kind==='reschedule'),'There are no provider terms to accept.');future(r.proposal.terms);
      if(r.currentArrangement){r.pendingChange={kind:'reschedule',terms:r.proposal.terms,memberAccepted:true};r.status='change-pending';}
      else {r.currentArrangement=r.proposal;r.proposal=null;r.pendingChange=null;r.status='confirmed';project();}
    } else if(command.operation==='request-change') {
      check(actor.role==='member','Only the member can request changes.');current(r);editable();check(r.currentArrangement && r.status==='confirmed','Review the current arrangement before requesting a change.');future(command.terms);r.pendingChange={kind:'reschedule',terms:command.terms,memberAccepted:false};r.status='change-pending';
    } else if(command.operation==='cancel') {
      check(actor.role==='member','Only the member can request cancellation.');editable();check(r.pendingChange?.kind!=='cancel','Resolve the pending cancellation first.');
      // Cancel replaces a pending time change and withdraws its replacement terms.
      if(r.currentArrangement||r.proposal){const replaced=!!r.currentArrangement&&(r.pendingChange?.kind==='reschedule'||!!r.proposal);r.pendingChange=replaced?{kind:'cancel',replacedReschedule:true}:{kind:'cancel'};if(r.currentArrangement)r.proposal=null;r.status='change-pending';}else r.status='cancelled';
    } else if(command.operation==='change-outcome') {
      check(actor.role==='admin','Only authenticated operations can record fictional provider outcomes.');editable();check(r.status==='change-pending'&&r.pendingChange,'There is no pending change.');
      // Validate provenance even for declined responses.
      const source=command.source as {obtainedAt?:string;channel?:string;source?:string};
      check(source && typeof source.source==='string'&&source.source.trim().length>=3&&source.source.length<=1000&&['phone','email','portal','in-person'].includes(source.channel??'')&&typeof source.obtainedAt==='string'&&Number.isFinite(Date.parse(source.obtainedAt))&&Date.parse(source.obtainedAt)<=now.getTime(),'Record the simulated provider response source.','invalid');
      if(command.outcome==='accepted') {
        if(r.pendingChange.kind==='cancel'){const b=booking();if(b)b.status='cancelled';r.status='cancelled';r.proposal=null;}
        else {current(r);check(r.pendingChange.memberAccepted&&r.proposal,'The member must accept replacement terms first.');future(r.proposal.terms);r.currentArrangement=r.proposal;r.proposal=null;r.status='confirmed';project();}
      } else {r.status=r.currentArrangement?'confirmed':r.proposal?'provider-proposed':'requested';if(r.currentArrangement)r.proposal=null;}
      r.pendingChange=null;
      w.events.push({at:stamp,text:`Fictional provider ${command.outcome} ${command.operation} (${source.channel}, obtained ${source.obtainedAt}): ${source.source}`});
    }
    r.revision++;r.commandIds.push(command.commandId);r.contextStale=r.contextToken!==demoBookingContext(w);
  }
  w.revision++;w.events.push({at:stamp,text:`Fictional booking request: ${command.operation}`});return w;
}
