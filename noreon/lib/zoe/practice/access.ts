import 'server-only';
import {notFound} from 'next/navigation';
import {requireRealStaff} from '@/lib/patient-care/clinical-case-repository';
import {headers} from 'next/headers';
import {staffHostAllowed} from '@/lib/staff/hosts';

export const practiceEnabled=(env:Record<string,string|undefined>=process.env)=>env.NOREON_ZOE_PRACTICE==='true';
/** requireRealStaff also checks the host, role-specific host, managed session and active identity. */
export async function requirePracticeAccess(){
 if(!practiceEnabled())notFound();
 if(!staffHostAllowed((await headers()).get('host')??''))notFound();
 const staff=await requireRealStaff();
 if(staff.identity.role!=='doctor'&&staff.identity.role!=='admin')notFound();
 return staff;
}
