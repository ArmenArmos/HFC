import 'server-only';
import type {MedicinesRpc} from '@/lib/member-medicines/server';
import {urgentWindowsSchema} from './urgent-windows';

/** Signed-in, scoped and audited by the database. A failed read is never an empty queue. */
export async function readDoctorUrgentWindows(client:MedicinesRpc){
 const result=await client.rpc('doctor_urgent_windows');
 const parsed=urgentWindowsSchema.safeParse(result.data);
 if(result.error||!parsed.success)throw Error('Urgent conversations unavailable');
 return parsed.data;
}
