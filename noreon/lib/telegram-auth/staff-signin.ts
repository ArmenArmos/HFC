import 'server-only';
import {cookies} from 'next/headers';
import {z} from 'zod';
import {realStaffClient} from '@/lib/patient-care/clinical-case-repository';
import {clinicAuthClient} from '@/lib/clinic-portal/identity';
import {validatedStaffSession} from '@/lib/staff/real-session-binding';
import {parseStaffSigninState,staffTelegramSigninEnabled,type StaffSigninState} from './staff-signin-config';

/**
 * Staff Telegram sign-in second step (T-auth B-1, design v5 §5). After the password, the
 * bot sends a code to the account's own Telegram; a correct code admits this session.
 * Whether admission is required is the database policy (`staff_telegram_policy`); this
 * app flag only decides whether the second-step screen is offered. Both default off.
 */
export {staffTelegramEnrolmentEnabled,staffTelegramSigninEnabled,telegramStepDue,type StaffSigninState} from './staff-signin-config';

/** Staff workspace or clinic portal: each has its own Supabase session cookie and pending-code cookie. */
export type SigninPortal='staff'|'clinic';
const cookieFor=(portal:SigninPortal)=>portal==='clinic'?'noreon_clinic_tauth':'noreon_staff_tauth';
const portalClient=(portal:SigninPortal)=>portal==='clinic'?clinicAuthClient():realStaffClient();
export {staffCodeText} from './staff-signin-core';
import {staffCodePending,beginStaffSessionCode,verifyStaffSessionCode} from './staff-signin-core';
/** The signed-in staff session's admission state, or null without a session. */
export async function readStaffSigninState(portal:SigninPortal='staff'):Promise<StaffSigninState|null>{
 const client=await portalClient(portal);
 const r=await client.rpc('staff_signin_state');
 if(r.error)return null;
 return parseStaffSigninState(r.data);
}

async function currentSession(portal:SigninPortal){
 const client=await portalClient(portal);
 const session=await validatedStaffSession(client.auth);
 if(!session)return null;
 const sid=z.uuid().safeParse(session.sessionId);
 return sid.success?{userId:session.user.id,sessionId:sid.data}:null;
}

export type StaffCodeSendResult={ok:true}|{ok:false;reason:'not_enrolled'|'busy'|'unavailable'};
/** Sends one code to the account's bound Telegram chat. The code is never stored or returned. */
export async function sendStaffCode(portal:SigninPortal='staff'):Promise<StaffCodeSendResult>{
 if(!staffTelegramSigninEnabled())return {ok:false,reason:'unavailable'};
 const session=await currentSession(portal);if(!session)return {ok:false,reason:'unavailable'};
 const result=await beginStaffSessionCode(session);if(!result.ok)return result;
 (await cookies()).set(cookieFor(portal),JSON.stringify(result.pending),{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',path:'/',maxAge:300});
 return {ok:true};
}

export type StaffCodeVerifyResult={ok:true}|{ok:false;reason:'invalid'|'resend'|'unavailable'};
export async function verifyStaffCode(code:string,portal:SigninPortal='staff'):Promise<StaffCodeVerifyResult>{
 if(!staffTelegramSigninEnabled()||!/^\d{6}$/.test(code))return {ok:false,reason:'invalid'};
 const jar=await cookies();
 let held:z.infer<typeof staffCodePending>;
 try{held=staffCodePending.parse(JSON.parse(jar.get(cookieFor(portal))?.value??''));}catch{return {ok:false,reason:'resend'};}
 const session=await currentSession(portal);if(!session)return {ok:false,reason:'unavailable'};
 const result=await verifyStaffSessionCode(session,held,code);if(!result.ok)return result;
 jar.delete(cookieFor(portal));
 return {ok:true};
}
