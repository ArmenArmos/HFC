'use server';
import {z} from 'zod';
import {loggedAction} from '@/lib/observability/with-logging';
import {requireRealAdmin} from '@/lib/staff/real-admin';
import {directorySchema} from '@/lib/patient-care/clinical-case-repository';
import {assignRealMember} from '@/lib/patient-care/clinical-actions';
import {assignRealNurse} from '@/lib/staff/nurse-actions';
import {searchRealMembers} from '@/lib/staff/real-member-search-actions';
import {coordinationCommand,refreshCoordinationTask,readCoordinationPage,searchCoordinationMembers} from '@/lib/staff/real-coordination/actions';
import {adminChatEnabled} from './config';
import type {AdminActionCard} from './card-contracts';
import type {AdminMemberBookings} from './card-contracts';
import {staffAppointmentContext} from '@/lib/real-booking/appointment-repository';
import {readAppointmentData} from '@/lib/real-booking/appointment-runtime';
import {getStaffBookingRequests} from '@/lib/real-booking/repository';
import {readMemberContacts} from '@/lib/staff/member-contact';
import {realBookingEnabled} from '@/lib/real-booking/config';
import {changeStaffAppointment,cancelStaffAppointment,startStaffAppointmentNotice,retryStaffAppointmentNotice,reconcileStaffAppointmentNotice} from '@/lib/real-booking/appointment-actions';
import {staffBookingCommand} from '@/lib/real-booking/actions';

async function withAdminChat<T>(run:(staff:Awaited<ReturnType<typeof requireRealAdmin>>)=>Promise<T>):Promise<{access:'allowed';result:T}|{access:'off'|'denied'}>{
 if(!adminChatEnabled())return {access:'off'};
 let staff;
 try{staff=await requireRealAdmin();}catch{return {access:'denied'};}
 return {access:'allowed',result:await run(staff)};
}

/** Only the entry-point guard is chat-specific. Validation, audit and writes remain shared. */
export const readAdminActionCard=loggedAction('readAdminActionCard',async function readAdminActionCard(input:unknown){
 return withAdminChat(async({client,identity}):Promise<AdminActionCard>=>{
 const kind=z.enum(['care-team','tasks','bookings']).parse(input);
 if(kind==='bookings'){
  return {kind,page:{rows:[],hasMore:false,nextCursor:null}};
 }
 if(kind==='tasks'){
  const [tasks,members]=await Promise.all([readCoordinationPage({filter:'active'}),searchCoordinationMembers({search:''})]);
  if(!tasks.ok||!members.ok)throw Error('Admin chat records unavailable.');
  return {kind,actor:{id:identity.id,role:'admin'},page:tasks.page,memberPage:members.page};
 }
 const [members,doctors,nurses]=await Promise.all([searchRealMembers({query:'',cursor:null}),client.rpc('patient_clinical_doctor_directory'),client.rpc('patient_clinical_nurse_directory')]);
 if(!members.ok||doctors.error||nurses.error)throw Error('Admin chat records unavailable.');
 return {kind,page:members.page,doctors:directorySchema.parse(doctors.data),nurses:directorySchema.parse(nurses.data)};
 });
});
export const searchAdminCareMembers=loggedAction('searchAdminCareMembers',async function searchAdminCareMembers(input:unknown){
 return withAdminChat(()=>searchRealMembers(input));
});
export const assignAdminChatDoctor=loggedAction('assignAdminChatDoctor',async function assignAdminChatDoctor(...args:Parameters<typeof assignRealMember>){
 return withAdminChat(()=>assignRealMember(...args));
});
export const assignAdminChatNurse=loggedAction('assignAdminChatNurse',async function assignAdminChatNurse(...args:Parameters<typeof assignRealNurse>){
 return withAdminChat(()=>assignRealNurse(...args));
});
export const adminCoordinationCommand=loggedAction('adminCoordinationCommand',async function adminCoordinationCommand(input:unknown){
 return withAdminChat(()=>coordinationCommand(input));
});
export const refreshAdminCoordinationTask=loggedAction('refreshAdminCoordinationTask',async function refreshAdminCoordinationTask(input:unknown){
 return withAdminChat(()=>refreshCoordinationTask(input));
});
export const readAdminCoordinationPage=loggedAction('readAdminCoordinationPage',async function readAdminCoordinationPage(input:unknown){
 return withAdminChat(()=>readCoordinationPage(input));
});
export const searchAdminCoordinationMembers=loggedAction('searchAdminCoordinationMembers',async function searchAdminCoordinationMembers(input:unknown){
 return withAdminChat(()=>searchCoordinationMembers(input));
});

/** Same readers as the member page, with the fresh admin identity passed through.
 * Each unavailable source stays unknown rather than becoming an empty record. */
export const readAdminMemberBookings=loggedAction('readAdminMemberBookings',async function readAdminMemberBookings(input:unknown){
 return withAdminChat(async(staff):Promise<AdminMemberBookings>=>{
  const memberId=z.uuid().parse(input);
  // Prove exact-member access before reading contact or provider arrangements.
  const context=await staffAppointmentContext(memberId,()=>{},staff);
  const [pilot,requests,contacts]=await Promise.allSettled([
   readAppointmentData(context),getStaffBookingRequests(memberId,staff),readMemberContacts(staff.client as never,[memberId]),
  ]);
  return {memberId,name:pilot.status==='fulfilled'?pilot.value.workspace.member.name:null,enabled:realBookingEnabled(process.env),
   pilot:pilot.status==='fulfilled'?pilot.value.data:null,requests:requests.status==='fulfilled'?requests.value:null,
   contact:contacts.status==='fulfilled'?contacts.value?.[memberId]??null:null};
 });
});
export const changeAdminAppointment=loggedAction('changeAdminAppointment',async function changeAdminAppointment(...args:Parameters<typeof changeStaffAppointment>){
 return withAdminChat(()=>changeStaffAppointment(...args));
});
export const cancelAdminAppointment=loggedAction('cancelAdminAppointment',async function cancelAdminAppointment(...args:Parameters<typeof cancelStaffAppointment>){
 return withAdminChat(()=>cancelStaffAppointment(...args));
});
export const startAdminAppointmentNotice=loggedAction('startAdminAppointmentNotice',async function startAdminAppointmentNotice(...args:Parameters<typeof startStaffAppointmentNotice>){
 return withAdminChat(()=>startStaffAppointmentNotice(...args));
});
export const retryAdminAppointmentNotice=loggedAction('retryAdminAppointmentNotice',async function retryAdminAppointmentNotice(...args:Parameters<typeof retryStaffAppointmentNotice>){
 return withAdminChat(()=>retryStaffAppointmentNotice(...args));
});
export const reconcileAdminAppointmentNotice=loggedAction('reconcileAdminAppointmentNotice',async function reconcileAdminAppointmentNotice(...args:Parameters<typeof reconcileStaffAppointmentNotice>){
 return withAdminChat(()=>reconcileStaffAppointmentNotice(...args));
});
export const adminProviderBookingCommand=loggedAction('adminProviderBookingCommand',async function adminProviderBookingCommand(...args:Parameters<typeof staffBookingCommand>){
 return withAdminChat(()=>staffBookingCommand(...args));
});
