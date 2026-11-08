import 'server-only';
import {sameWorkspaceOrigin} from '@/lib/staff/request';
import {isRealtimePlane,type RealtimePlane,type RealtimeToken} from './contracts';

/**
 * WP R: POST /api/realtime/token?plane=member|staff|clinic. The three planes use different session cookies, so the
 * browser asks for the token of the plane its screen runs on, and gets {accessToken, userId, expiresAt} of that plane's
 * active session: the same JWT its cookie already holds, so Realtime applies RLS on realtime_signals
 * (recipient_user_id = auth.uid()) with exactly the caller's identity. Order: switch (404), same origin (403), plane
 * (400), session (401), the fail-closed limiter (429 with Retry-After). Always private, no-store; the token is never
 * logged (withRouteLogging records route, status and ids only).
 */
export const realtimeEnabled=(env:Record<string,string|undefined>=process.env)=>env.NOREON_REALTIME==='true'&&!!env.NEXT_PUBLIC_SUPABASE_URL&&!!env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export interface RealtimeTokenPorts{
 enabled():boolean;
 session(plane:RealtimePlane):Promise<RealtimeToken|null>;
 limit(request:Request,userId:string):Promise<{ok:true}|{ok:false;retryAfter:number}>;
}
const headers={'Cache-Control':'private, no-store'};
const reply=(status:string,code:number)=>Response.json({status},{status:code,headers});

export function createRealtimeTokenHandler(ports:RealtimeTokenPorts){
 return async function POST(request:Request):Promise<Response>{
  if(!ports.enabled())return reply('off',404);
  if(!sameWorkspaceOrigin(request))return reply('unavailable',403);
  const plane=new URL(request.url).searchParams.get('plane');
  if(!isRealtimePlane(plane))return reply('invalid',400);
  let token:RealtimeToken|null;
  try{token=await ports.session(plane);}catch{return reply('unavailable',503);}
  if(!token)return reply('signed_out',401);
  try{
   const admitted=await ports.limit(request,token.userId);
   if(!admitted.ok)return Response.json({status:'rate_limited'},{status:429,headers:{...headers,'Retry-After':String(admitted.retryAfter)}});
  }catch{return reply('unavailable',503);}
  return Response.json({accessToken:token.accessToken,userId:token.userId,expiresAt:token.expiresAt},{status:200,headers});
 };
}

type SessionSource={auth:{getSession():Promise<{data:{session:{access_token:string;expires_at?:number;user:{id:string}}|null};error:unknown}>}};
/** The cookie session's own token, only when it belongs to the identity the plane just verified. */
export async function tokenFor(client:SessionSource,userId:string,now=Date.now()):Promise<RealtimeToken|null>{
 const {data,error}=await client.auth.getSession();
 const session=data.session;
 if(error||!session?.access_token||session.user.id!==userId)return null;
 const expiresAt=session.expires_at??Math.floor(now/1000)+300;
 if(expiresAt*1000<=now)return null;
 return {accessToken:session.access_token,userId,expiresAt};
}

export const realtimeTokenPorts:RealtimeTokenPorts={
 enabled:()=>realtimeEnabled(),
 async session(plane){
  const {headers:requestHeaders}=await import('next/headers');
  const host=(await requestHeaders()).get('host')??'';
  if(plane==='member'){
   const {patientIdentity}=await import('@/lib/patient/auth');
   const who=await patientIdentity();
   if(!who)return null;
   const {createClient}=await import('@/lib/supabase/server');
   return tokenFor(await createClient() as unknown as SessionSource,who.userId);
  }
  if(plane==='staff'){
   const {realReviewEnabled}=await import('@/lib/patient-care/real-review-config');
   const {staffHostAllowed}=await import('@/lib/staff/hosts');
   if(!realReviewEnabled(process.env)||!staffHostAllowed(host))return null;
   const {realStaffClient}=await import('@/lib/patient-care/clinical-case-repository');
   const {staffAccessSession,staffAccessIdentity}=await import('@/lib/staff/real-staff-access');
   const client=await realStaffClient();
   const session=await staffAccessSession(client);
   if(!session)return null;
   const {parsed}=await staffAccessIdentity(client);
   if(!parsed.success||parsed.data.id!==session.user.id)return null;
   return tokenFor(client as unknown as SessionSource,session.user.id);
  }
  const {clinicHostAllowed,clinicPortalEnabled}=await import('@/lib/clinic-portal/config');
  if(!clinicPortalEnabled()||!clinicHostAllowed(host))return null;
  const {clinicAccess}=await import('@/lib/clinic-portal/identity');
  const {client,session,access}=await clinicAccess(null);
  if(!session||(access.status!=='ready'&&access.status!=='selection-required'))return null;
  return tokenFor(client as unknown as SessionSource,session.user.id);
 },
 limit:async(request,userId)=>(await import('@/lib/security/rate-limit')).rateLimit('realtime_token',[{kind:'source'},{kind:'user',value:userId}],request.headers,{failClosed:true}),
};
