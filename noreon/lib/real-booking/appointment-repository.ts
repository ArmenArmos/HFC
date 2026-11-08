import 'server-only';
import {readMemberSuggestedTests} from './fresh-tests-read';
import {z} from 'zod';
import {createClient} from '@/lib/supabase/server';
import {requirePatient} from '@/lib/patient/auth';
import {requireRealStaff,type RealStaff} from '@/lib/patient-care/clinical-case-repository';
import {requireRealStaffForRender} from '@/lib/staff/real-staff-render';
import {clinicalWriteClient} from '@/lib/patient-care/clinical-publication-server';
import {readAppointmentData,readAppointmentWorkspace,readAppointmentSummary,type BookingRpc} from './appointment-runtime';
import {schedulingRuntime} from './scheduling-template';
import {realBookingEnabled} from './config';
import {notFound} from 'next/navigation';
import {createMemberBookingContext} from './member-runtime-context';
import {clinicSchedulingEnabled} from '@/lib/clinic-scheduling/schema';
const writer=():BookingRpc=>({rpc:(name,args)=>(clinicalWriteClient()as unknown as BookingRpc).rpc(name,args)});

/** The narrow runtime checks all JSON at its RPC boundaries. Never expose this
 * service writer to a form or an unguarded route. */
export async function memberAppointmentContext(invalidate:()=>void=()=>{}){
 const identity=await requirePatient();
 const context=await createMemberBookingContext({memberId:identity.userId,enabled:realBookingEnabled(process.env),createRead:async()=>await createClient()as unknown as BookingRpc,createWrite:writer,createRuntime:schedulingRuntime,portal:clinicSchedulingEnabled(),invalidate});
 return {...context,suggestTests:readMemberSuggestedTests};
}
export async function staffAppointmentContext(memberId:string,invalidate:()=>void=()=>{},staff?:RealStaff){
 const {identity,client}=staff??await requireRealStaff();
 const context={memberId:z.uuid().parse(memberId),actorId:identity.id,read:client as unknown as BookingRpc};
 // Authenticate the exact member scope before creating the service writer.
 try{await readAppointmentWorkspace(context);}catch(error){
  if(typeof error==='object'&&error!==null&&'code'in error&&error.code==='42501')notFound();
  throw error;
 }
 const enabled=realBookingEnabled(process.env);
 return {...context,write:writer(),runtime:enabled?schedulingRuntime():null,portal:enabled&&clinicSchedulingEnabled(),invalidate};
}
export async function getMemberAppointmentData(){return (await readAppointmentData(await memberAppointmentContext())).data;}
/** Server-component render only; actions build their context with a fresh staff check. */
export async function getStaffAppointmentData(memberId:string){return readAppointmentData(await staffAppointmentContext(memberId,()=>{},await requireRealStaffForRender()));}

/** Read-only Home/Tests projection: no program sealing or offer admission. */
export async function getMemberAppointmentSummary(){
 const identity=await requirePatient();
 const read=await createClient();
 // Clinic-portal state (a proposed time, check-in) feeds the Home next step; read only while clinic scheduling is on.
 return readAppointmentSummary({memberId:identity.userId,read:read as unknown as BookingRpc,portal:realBookingEnabled(process.env)&&clinicSchedulingEnabled()});
}
