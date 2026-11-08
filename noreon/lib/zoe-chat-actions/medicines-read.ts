import 'server-only';
import {loadMemberMedicines,readMemberMedicineAsks} from '@/lib/member-medicines/server';
import {getCareData} from '@/lib/patient-care/repository';
import {armeniaDate} from '@/lib/patient-care/model';
import {bookingToken} from './booking';
/** Read the page's records. Doctor plan rows are display-only in this task. */
export async function readMedicines(){
 const [read,care,asks]=await Promise.all([loadMemberMedicines(),getCareData(),readMemberMedicineAsks()]);
 const own=read.enabled?read.medicines.filter(m=>!m.stoppedAt):[];
 const plan=care.plan?care.plan.medications.filter(m=>m.active&&(!m.endDate||m.endDate>=armeniaDate(new Date()))&&m.planId===care.plan!.id):[];
 const ownAsks=asks.enabled?asks.asks.filter(a=>a.source==='self'&&own.some(m=>m.id===a.medicineId)&& (a.state==='open'||a.state==='answered'&&['ran_out','cost_or_availability'].includes(a.reason??''))):[];
 // Ticks do not change which schedule the member is editing.
 const data={enabled:read.enabled,own,plan,asks:ownAsks,now:new Date().toISOString()};
 return {...data,token:bookingToken({enabled:data.enabled,own:own.map(m=>Object.fromEntries(Object.entries(m).filter(([key])=>key!=='doses'))),plan,asks:ownAsks})};
}
export type MedicinesRead=Awaited<ReturnType<typeof readMedicines>>;
