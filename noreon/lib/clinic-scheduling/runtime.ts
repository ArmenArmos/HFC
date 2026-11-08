import 'server-only';
import{z}from'zod';
import{dispatchNow}from'@/lib/telegram-runtime/dispatch-trigger';
import type{ClinicRpc}from'@/lib/clinic-portal/runtime';
import{clinicBookingsSchema,freeSlotsSchema,followUpTestIds,scheduleCommandSchema,scheduleResultSchema,scheduleSettingsSchema,settingsInputSchema,statusFilters,teamCommandSchema,teamSchema,
 type ScheduleResult,type SettingsResult,type StatusFilter,type TeamResult}from'./schema';
/** Every call goes through the clinic user's own RPC; membership and clinic isolation are proven in SQL. */
const day=z.iso.date();
export type BookingQuery={scope:'upcoming'|'past';day:string|null;status:StatusFilter|null};
export function readBookingQuery(query:Record<string,string|string[]|undefined>):BookingQuery{
 const value=(key:string)=>typeof query[key]==='string'?query[key]:null;
 const status=value('status');
 return{scope:value('scope')==='past'?'past':'upcoming',day:day.safeParse(value('day')).success?value('day'):null,status:statusFilters.includes(status as StatusFilter)?status as StatusFilter:null};
}
export async function readClinicBookings(rpc:ClinicRpc,clinicId:string,query:BookingQuery){
 try{
  const r=await rpc.rpc('clinic_schedule_bookings',{p_clinic:clinicId,p_scope:query.scope,p_day:query.day,p_status:query.status});
  if(r.error)return{status:'unavailable' as const};
  const parsed=clinicBookingsSchema.safeParse(r.data);
  return parsed.success?{status:'loaded' as const,data:parsed.data}:{status:'unavailable' as const};
 }catch{return{status:'unavailable' as const};}
}
export async function readFreeSlots(rpc:ClinicRpc,clinicId:string,date:string){
 if(!day.safeParse(date).success)return null;
 try{const r=await rpc.rpc('clinic_schedule_free_slots',{p_clinic:clinicId,p_day:date});if(r.error)return null;const p=freeSlotsSchema.safeParse(r.data);return p.success?p.data:null;}catch{return null;}
}
export async function runScheduleCommand(rpc:ClinicRpc,clinicId:string,input:unknown):Promise<ScheduleResult>{
 const p=scheduleCommandSchema.safeParse(input);if(!p.success)return{status:'invalid'};
 const command=p.data.op==='propose'?{...p.data,note:p.data.note?.trim()||null}:p.data;
 try{
  const r=await rpc.rpc('clinic_schedule_command',{p_clinic:clinicId,p_command:command});
  if(r.error)return{status:'unknown'};
  const result=scheduleResultSchema.safeParse(r.data);
  if(!result.success)return{status:'unknown'};
  if(result.data.status==='saved'&&result.data.booking&&result.data.booking.appointmentId!==command.appointmentId)return{status:'unknown'};
  if(result.data.status==='saved'&&(command.op==='confirm'||command.op==='propose'))dispatchNow();
  return result.data;
 }catch{return{status:'unknown'};}
}
export async function readScheduleSettings(rpc:ClinicRpc,clinicId:string){
 try{const r=await rpc.rpc('clinic_schedule_settings',{p_clinic:clinicId});if(r.error)return null;const p=scheduleSettingsSchema.safeParse(r.data);return p.success?p.data:null;}catch{return null;}
}
export async function saveScheduleSettings(rpc:ClinicRpc,clinicId:string,input:unknown):Promise<SettingsResult>{
 const p=settingsInputSchema.safeParse(input);if(!p.success)return{status:'invalid'};
 try{
  const r=await rpc.rpc('clinic_schedule_settings_save',{p_clinic:clinicId,p_settings:{...p.data,followUpTestIds:followUpTestIds(p.data.coveredTestIds)}});
  if(r.error)return{status:r.error.code==='42501'?'access':'unknown'};
  const result=z.union([z.strictObject({status:z.literal('saved'),settings:scheduleSettingsSchema}),z.strictObject({status:z.enum(['invalid','stale','address-required','disabled','unavailable'])})]).safeParse(r.data);
  return result.success?result.data:{status:'unknown'};
 }catch{return{status:'unknown'};}
}
export async function readClinicTeam(rpc:ClinicRpc,clinicId:string){
 try{const r=await rpc.rpc('clinic_schedule_team',{p_clinic:clinicId});if(r.error)return null;const p=teamSchema.safeParse(r.data);return p.success?p.data:null;}catch{return null;}
}
export async function runTeamCommand(rpc:ClinicRpc,clinicId:string,input:unknown):Promise<TeamResult>{
 const p=teamCommandSchema.safeParse(input);if(!p.success)return{status:'invalid'};
 try{
  const r=await rpc.rpc('clinic_schedule_team_command',{p_clinic:clinicId,p_command:p.data});
  if(r.error)return{status:r.error.code==='42501'?'access':'unknown'};
  const result=z.strictObject({status:z.enum(['saved','invalid','self','stale','last-admin','noreon-only','unavailable'])}).safeParse(r.data);
  return result.success?result.data:{status:'unknown'};
 }catch{return{status:'unknown'};}
}
