'use server';
import {loggedAction} from '@/lib/observability/with-logging';
import {revalidatePath} from 'next/cache';
import {readPilotForm,readNoticeRetryForm,readCancelForm,readProposalForm,runAppointmentSelection} from './appointment-commands';
import {createAppointmentPorts,cancelAppointment,answerClinicProposal,startSchedulingNotice,retrySchedulingNotice,reconcileSchedulingNotice} from './appointment-runtime';
import {memberAppointmentContext,staffAppointmentContext} from './appointment-repository';
import type {PilotActionState} from './appointment-schema';
function refresh(){
 for(const path of ['/patient/service','/patient/results','/patient/dashboard','/staff/real/members'])revalidatePath(path);
 revalidatePath('/staff/real/members/[id]','page');
}
export const selectMemberAppointment=loggedAction("selectMemberAppointment",async function selectMemberAppointment(_previous:PilotActionState,form:FormData):Promise<PilotActionState>{
 const context=await memberAppointmentContext(refresh);
 const input=readPilotForm(form,false);
 if(!input)return {ok:false,code:context.runtime?'invalid':'unavailable'};
 return runAppointmentSelection(context,input,createAppointmentPorts(context));
});
export const changeMemberAppointment=loggedAction("changeMemberAppointment",async function changeMemberAppointment(_previous:PilotActionState,form:FormData):Promise<PilotActionState>{
 const context=await memberAppointmentContext(refresh);
 const input=readPilotForm(form,true);
 if(!input)return {ok:false,code:context.runtime?'invalid':'unavailable'};
 return runAppointmentSelection(context,input,createAppointmentPorts(context));
});
export const changeStaffAppointment=loggedAction("changeStaffAppointment",async function changeStaffAppointment(memberId:string,_previous:PilotActionState,form:FormData):Promise<PilotActionState>{
 const context=await staffAppointmentContext(memberId,refresh);
 const input=readPilotForm(form,true);
 if(!input)return {ok:false,code:context.runtime?'invalid':'unavailable'};
 return runAppointmentSelection(context,input,createAppointmentPorts(context));
});
export const retryStaffAppointmentNotice=loggedAction("retryStaffAppointmentNotice",async function retryStaffAppointmentNotice(memberId:string,_previous:PilotActionState,form:FormData):Promise<PilotActionState>{
 const context=await staffAppointmentContext(memberId,refresh);
 const input=readNoticeRetryForm(form);
 if(!input)return {ok:false,code:context.runtime?'invalid':'unavailable'};
 return retrySchedulingNotice(context,input);
});
export const reconcileStaffAppointmentNotice=loggedAction("reconcileStaffAppointmentNotice",async function reconcileStaffAppointmentNotice(memberId:string,_previous:PilotActionState,form:FormData):Promise<PilotActionState>{
 const context=await staffAppointmentContext(memberId,refresh);
 const input=readNoticeRetryForm(form);
 if(!input)return {ok:false,code:context.runtime?'invalid':'unavailable'};
 return reconcileSchedulingNotice(context,input);
});

export const startStaffAppointmentNotice=loggedAction("startStaffAppointmentNotice",async function startStaffAppointmentNotice(memberId:string,_previous:PilotActionState,form:FormData):Promise<PilotActionState>{
 const context=await staffAppointmentContext(memberId,refresh);
 const input=readNoticeRetryForm(form);
 if(!input)return {ok:false,code:context.runtime?'invalid':'unavailable'};
 return startSchedulingNotice(context,input);
});

export const cancelMemberAppointment=loggedAction("cancelMemberAppointment",async function cancelMemberAppointment(_previous:PilotActionState,form:FormData):Promise<PilotActionState>{
 const context=await memberAppointmentContext(refresh);
 const input=readCancelForm(form);
 if(!input||input.agreementSource!==null)return {ok:false,code:context.runtime?'invalid':'unavailable'};
 return cancelAppointment(context,input);
});
export const cancelStaffAppointment=loggedAction("cancelStaffAppointment",async function cancelStaffAppointment(memberId:string,_previous:PilotActionState,form:FormData):Promise<PilotActionState>{
 const context=await staffAppointmentContext(memberId,refresh);
 const input=readCancelForm(form);
 if(!input)return {ok:false,code:context.runtime?'invalid':'unavailable'};
 return cancelAppointment(context,input);
});
export const answerMemberProposal=loggedAction("answerMemberProposal",async function answerMemberProposal(_previous:PilotActionState,form:FormData):Promise<PilotActionState>{
 const context=await memberAppointmentContext(refresh);
 const input=readProposalForm(form);
 if(!input)return {ok:false,code:context.portal?'invalid':'unavailable'};
 return answerClinicProposal(context,input);
});
