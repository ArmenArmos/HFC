import 'server-only';
import type {PatientLocale} from '@/lib/patient/copy';
import type {AppRole} from '@/lib/rbac/roles';
import {sameWorkspaceOrigin} from '@/lib/staff/request';
import {readClinicUploadBody} from '@/lib/clinic-portal/upload-server';
import type {LiveToken} from './live-contract';

/**
 * The Live token routes (member and caregiver; every staff role), with injected ports so the checks run without a
 * session, a database or the network. Same order as the voice routes: origin (403), actor (401), availability (503),
 * the fail-closed limiter (429 with Retry-After), and only then the small body. The answer is exactly
 * {token, model, expiresAt}: never the API key, the instruction or the configuration, and always private, no-store.
 */
export type LiveActor={id:string;role:AppRole};
export interface LiveTokenPorts{
 actor:()=>Promise<LiveActor|null>;
 available:(actor:LiveActor)=>Promise<boolean>;
 limit:(request:Request,actor:LiveActor)=>Promise<{ok:true}|{ok:false;retryAfter:number}>;
 mint:(actor:LiveActor,locale:PatientLocale,signal:AbortSignal)=>Promise<LiveToken|null>;
}
const headers={'Cache-Control':'private, no-store'};
const reply=(status:string,code:number)=>Response.json({status},{status:code,headers});
const LOCALES=['hy','en','ru'];

export function createLiveTokenHandler(ports:LiveTokenPorts){
 return async function POST(request:Request):Promise<Response>{
  if(!sameWorkspaceOrigin(request))return reply('unavailable',403);
  let actor:LiveActor|null;
  try{actor=await ports.actor();}catch{return reply('unavailable',401);}
  if(!actor)return reply('unavailable',401);
  try{
   if(!await ports.available(actor))return reply('unavailable',503);
   const admitted=await ports.limit(request,actor);
   if(!admitted.ok)return Response.json({status:'rate_limited'},{status:429,headers:{...headers,'Retry-After':String(admitted.retryAfter)}});
  }catch{return reply('unavailable',503);}
  let locale:PatientLocale;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5_000);
  try{
   const declared=request.headers.get('content-length');
   if(declared&&(!/^\d+$/.test(declared)||Number(declared)>256))return reply('invalid',413);
   const body=JSON.parse((await readClinicUploadBody(request.body?.pipeThrough(new TransformStream(),{signal:controller.signal})??null,256)).toString('utf8'));
   if(!body||typeof body!=='object'||Object.keys(body).some(key=>key!=='locale')||!LOCALES.includes(body.locale))return reply('invalid',400);
   locale=body.locale;
  }catch{return reply('invalid',400);}
  finally{clearTimeout(timer);controller.abort();}
  try{
   const token=await ports.mint(actor,locale,request.signal);
   if(!token)return reply('unavailable',503);
   return Response.json({token:token.token,model:token.model,expiresAt:token.expiresAt},{status:200,headers});
  }catch{return reply('unavailable',503);}
 };
}

/** Member and caregiver: the phone session. A member is the patient; an account with active caregiver links is a caregiver. */
export const memberLivePorts:LiveTokenPorts={
 actor:async()=>{
  const {currentPrincipals}=await import('@/lib/rbac/server');
  const {rolesFromIdentities}=await import('@/lib/rbac/roles');
  const p=await currentPrincipals();
  if(!p.memberId||p.staff)return null;
  const roles=rolesFromIdentities(p);
  // A caregiver account is a member account too (the same phone sign-in); a member with an assessment speaks as patient.
  const {sessionActor}=await import('./actor');
  if(roles.includes('patient')&&await sessionActor())return {id:p.memberId,role:'patient'};
  return roles.includes('caregiver')?{id:p.memberId,role:'caregiver'}:null;
 },
 available:async()=>(await import('./voice-live')).liveAvailable(),
 limit:async(request,actor)=>(await import('@/lib/security/rate-limit')).rateLimit('member_live',[{kind:'source'},{kind:'user',value:actor.id}],request.headers,{failClosed:true}),
 mint:async(actor,locale,signal)=>(await import('./voice-live')).mintLiveToken(actor.role,locale,{signal}),
};

/** Every staff role: the workspace staff plane (nurse, physicians, coordinator, Noreon administrator) or the clinic administrator. */
export const staffLivePorts:LiveTokenPorts={
 actor:async()=>{
  const {currentPrincipals}=await import('@/lib/rbac/server');
  const {rolesFromIdentities}=await import('@/lib/rbac/roles');
  const p=await currentPrincipals();
  const id=p.staffId??(p.clinic?.capability==='clinic_admin'?p.clinicUserId:null);
  const role=rolesFromIdentities({staff:p.staff,clinic:p.staff?null:p.clinic}).find(r=>r!=='patient'&&r!=='caregiver');
  return id&&role?{id,role}:null;
 },
 available:async actor=>{
  const {staffVoiceAvailable,staffVoiceRole}=await import('@/lib/staff-zoe/voice');
  const role=staffVoiceRole(actor.role);
  if(!role)return false;
  return (await import('./voice-live')).liveAvailable(process.env,undefined,{kind:'staff',available:()=>staffVoiceAvailable(role)});
 },
 limit:async(request,actor)=>(await import('@/lib/security/rate-limit')).rateLimit('staff_live',[{kind:'source'},{kind:'user',value:actor.id}],request.headers,{failClosed:true}),
 mint:async(actor,locale,signal)=>(await import('./voice-live')).mintLiveToken(actor.role,locale,{signal}),
};
