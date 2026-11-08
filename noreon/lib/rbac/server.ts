import 'server-only';
import {headers} from 'next/headers';
import {createClient} from '@/lib/supabase/server';
import {patientIdentity} from '@/lib/patient/auth';
import {realReviewEnabled} from '@/lib/patient-care/real-review-config';
import {realStaffClient} from '@/lib/patient-care/clinical-case-repository';
import {staffAccessIdentity,staffAccessSession} from '@/lib/staff/real-staff-access';
import {staffHostAllowed} from '@/lib/staff/hosts';
import {clinicHostAllowed,clinicPortalEnabled} from '@/lib/clinic-portal/config';
import {clinicAccess} from '@/lib/clinic-portal/identity';
import {caregiversEnabled} from '@/lib/caregivers/schema';
import {can,canAny,rolesFromIdentities,type AppRole,type IdentityInput,type Permission} from './roles';

/**
 * The request's principals across the three session planes (member, staff, clinic portal) plus the caregiver links
 * (WP F). A plane that is absent, switched off, on the wrong host or failing reads as no identity: this never throws for
 * a missing plane and never redirects. It mirrors the database for the UI and for card commands; every write is still
 * authorised by its definer function.
 */
export type Principals=IdentityInput&{memberId:string|null;staffId:string|null;clinicUserId:string|null};
export type PlaneReaders={
 member():Promise<{userId:string}|null>;
 caregiverLinks(userId:string):Promise<readonly unknown[]>;
 staff():Promise<{id:string;role:'admin'|'doctor'|'nurse'|'coordinator';specialty?:'family_physician'|'cardiologist'|null}|null>;
 clinic():Promise<{userId:string;capability:'clinic_admin'|'clinic_staff'}|null>;
};

const quiet=async<T>(read:()=>Promise<T|null>):Promise<T|null>=>{try{return await read();}catch{return null;}};

/** Own active links only, through the owner policies on member_caregivers: no member data, so nothing to audit. */
async function ownActiveLinks(userId:string):Promise<readonly unknown[]>{
 if(!caregiversEnabled())return [];
 const client=await createClient() as unknown as {from(table:string):{select(cols:string):{eq(col:string,v:string):{eq(col:string,v:string):{limit(n:number):PromiseLike<{data:unknown[]|null;error:unknown}>}}}}};
 const {data,error}=await client.from('member_caregivers').select('id').eq('caregiver_user_id',userId).eq('status','active').limit(3);
 return error||!data?[]:data;
}

export const defaultReaders:PlaneReaders={
 async member(){const who=await patientIdentity();return who?{userId:who.userId}:null;},
 caregiverLinks:ownActiveLinks,
 async staff(){
  if(!realReviewEnabled(process.env)||!staffHostAllowed((await headers()).get('host')??''))return null;
  const client=await realStaffClient();
  if(!await staffAccessSession(client))return null;
  const {parsed}=await staffAccessIdentity(client);
  return parsed.success?parsed.data:null;
 },
 async clinic(){
  if(!clinicPortalEnabled()||!clinicHostAllowed((await headers()).get('host')??''))return null;
  const {access}=await clinicAccess(null);
  return access.status==='ready'?{userId:access.identity.userId,capability:access.identity.capability}:null;
 },
};

export async function currentPrincipals(readers:PlaneReaders=defaultReaders):Promise<Principals>{
 const [member,staff,clinic]=await Promise.all([quiet(readers.member),quiet(readers.staff),quiet(readers.clinic)]);
 const caregiverLinks=member?(await quiet(()=>readers.caregiverLinks(member.userId)))??[]:[];
 return {member,caregiverLinks,staff:staff?{role:staff.role,specialty:staff.specialty??null}:null,clinic:clinic?{capability:clinic.capability}:null,
  memberId:member?.userId??null,staffId:staff?.id??null,clinicUserId:clinic?.userId??null};
}

/** Every application role this request holds, in APP_ROLES order. */
export async function currentAppRoles(readers:PlaneReaders=defaultReaders):Promise<AppRole[]>{
 return rolesFromIdentities(await currentPrincipals(readers));
}

export class PermissionDenied extends Error{
 readonly permission:Permission;
 constructor(permission:Permission){super(`Permission ${permission} required`);this.name='PermissionDenied';this.permission=permission;}
}
/** Throws PermissionDenied unless one of this request's roles holds the permission; returns the roles that hold it. */
export async function assertCan(permission:Permission,readers:PlaneReaders=defaultReaders):Promise<AppRole[]>{
 const roles=await currentAppRoles(readers);
 if(!canAny(roles,permission))throw new PermissionDenied(permission);
 return roles.filter(role=>can(role,permission));
}
