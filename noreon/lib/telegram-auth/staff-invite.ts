import 'server-only';
import {createHash,createHmac,randomBytes,randomInt} from 'node:crypto';
import {cookies} from 'next/headers';
import {createServerClient} from '@supabase/ssr';
import {z} from 'zod';
import type {Database} from '@/lib/db/types';
import {getInvitationContext,invitationWriteClient} from '@/lib/staff/real-invitations';
import type {InvitationContext} from '@/lib/staff/real-invitation-dispatch';
import {validatedStaffSession} from '@/lib/staff/real-session-binding';
import {createTelegramAdapter} from '@/lib/telegram-channel/outbound';
import {telegramHttpsPort} from '@/lib/telegram-channel/link';
import {outboundConfig} from '@/lib/telegram-runtime/config';
import {telegramAuthKeys} from './hook';
import {telegramStaffInvitationReady} from './staff-invite-config';

/**
 * Invitee side of Telegram invitations (T-auth B-2a, design v5 §5 steps 3–5). The code goes only
 * to the Telegram account this invitation's proof created. A correct code claims an admission;
 * the server then opens the Supabase invitation session in a buffered client (nothing reaches
 * the browser), records that exact session, and only an admitted session's cookies are released.
 */
const COOKIE='noreon_staff_invite';
const pending=z.strictObject({nonce:z.string().regex(/^[A-Za-z0-9_-]{43}$/),challengeId:z.uuid(),invitationId:z.uuid(),generation:z.number().int().positive()});
const mac=(key:Buffer,parts:string[])=>createHmac('sha256',key).update(parts.join('\0')).digest('hex');
const keys=()=>telegramAuthKeys(process.env.NOREON_SUPABASE_SMS_HOOK_SECRET);
/** Fixed invitation code text; no clinical content. */
export const staffInviteCodeText=(code:string)=>`Noreon հրավերի կոդ՝ ${code}։ Մի՛ փոխանցեք այն ոչ մեկին։\nNoreon invitation code: ${code}. Do not share it with anyone.`;

export type InviteCodeResult={ok:true}|{ok:false;reason:'not_proven'|'busy'|'unavailable'};
export async function sendInviteCode(invitationId:string,generation:number,startToken:string):Promise<InviteCodeResult>{
 if(!telegramStaffInvitationReady())return {ok:false,reason:'unavailable'};
 const k=keys(),code=String(randomInt(0,1_000_000)).padStart(6,'0'),nonce=randomBytes(32).toString('base64url');
 const r=await invitationWriteClient().rpc('staff_invite_code_begin',{p_invitation_id:invitationId,p_generation:generation,p_start_token_hash:createHash('sha256').update(startToken,'utf8').digest('hex'),
  p_nonce_hmac:mac(k.digestKey,['noreon-invite-nonce-v1',nonce]),p_code_hmac:mac(k.digestKey,['noreon-invite-code-v1',invitationId,String(generation),code])});
 const begun=z.union([z.object({ok:z.literal(true),challengeId:z.uuid(),address:z.string().regex(/^[1-9][0-9]{0,15}$/)}),z.object({ok:z.literal(false),code:z.string()})]).safeParse(r.data);
 if(r.error||!begun.success)return {ok:false,reason:'unavailable'};
 if(!begun.data.ok)return {ok:false,reason:begun.data.code==='not_proven'?'not_proven':begun.data.code==='rate_limited'?'busy':'unavailable'};
 const sent=await createTelegramAdapter({config:outboundConfig()!,http:telegramHttpsPort}).deliverText(Object.freeze({address:begun.data.address,text:staffInviteCodeText(code)})).catch(()=>null);
 if(sent?.kind!=='accepted')return {ok:false,reason:'unavailable'};
 (await cookies()).set(COOKIE,JSON.stringify({nonce,challengeId:begun.data.challengeId,invitationId,generation}),{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',path:'/',maxAge:300});
 return {ok:true};
}

type Buffered={name:string;value:string;options:Record<string,unknown>};
/** Same cookie name and options as the staff client, but cookies are only collected in memory. */
function bufferedStaffClient(){
 const jar=new Map<string,Buffered>();
 const client=createServerClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{
  cookieOptions:{name:'noreon-real-staff-auth',httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',path:'/'},
  cookies:{getAll:()=>[...jar.values()].map(({name,value})=>({name,value})),setAll:values=>{for(const v of values)jar.set(v.name,{name:v.name,value:v.value,options:v.options as Record<string,unknown>});}},
 });
 return {client,jar};
}

export type InviteAcceptResult={ok:true;context:InvitationContext;userId:string;sessionId:string}|{ok:false;reason:'invalid_code'|'resend'|'unavailable'|'rejected'};
/**
 * Code → claimed admission → invitation session opened in the buffered client → admit → release
 * cookies. A rejected session is ended (the decision commits first). The caller then continues with
 * the existing stage proof and password steps.
 */
export async function acceptTelegramInvitation(input:{invitationId:string;generation:number;code:string}):Promise<InviteAcceptResult>{
 if(!telegramStaffInvitationReady())return {ok:false,reason:'unavailable'};
 const jar=await cookies();
 let held:z.infer<typeof pending>;
 try{held=pending.parse(JSON.parse(jar.get(COOKIE)?.value??''));}catch{return {ok:false,reason:'resend'};}
 if(held.invitationId!==input.invitationId||held.generation!==input.generation)return {ok:false,reason:'resend'};
 const db=invitationWriteClient();
 const context=await getInvitationContext(input.invitationId,input.generation,db);
 if(!context.authUserId||!['pending','verified'].includes(context.status)||Date.parse(context.expiresAt)<=Date.now())return {ok:false,reason:'unavailable'};
 const k=keys(),nonceHmac=mac(k.digestKey,['noreon-invite-nonce-v1',held.nonce]);
 const v=await db.rpc('staff_invite_code_verify',{p_challenge:held.challengeId,p_invitation_id:input.invitationId,p_generation:input.generation,p_nonce_hmac:nonceHmac,
  p_code_hmac:mac(k.digestKey,['noreon-invite-code-v1',input.invitationId,String(input.generation),input.code])});
 const verified=z.union([z.object({ok:z.literal(true),claimId:z.uuid()}),z.object({ok:z.literal(false),code:z.string()})]).safeParse(v.data);
 if(v.error||!verified.success)return {ok:false,reason:'unavailable'};
 if(!verified.data.ok)return {ok:false,reason:verified.data.code==='wrong_code'?'invalid_code':'resend'};
 jar.delete(COOKIE);
 // The Supabase invite token never left the server: a fresh one is generated now, after the code
 // (review B-2a #2), and the session is opened where the browser cannot see it yet.
 const account=await db.auth.admin.getUserById(context.authUserId);
 if(account.error||!account.data.user?.email)return {ok:false,reason:'unavailable'};
 const type=account.data.user.email_confirmed_at?'recovery':'invite';
 const link=await db.auth.admin.generateLink({type,email:account.data.user.email});
 if(link.error||link.data.user?.id!==context.authUserId||!link.data.properties?.hashed_token)return {ok:false,reason:'unavailable'};
 const buffered=bufferedStaffClient();
 const opened=await buffered.client.auth.verifyOtp({token_hash:link.data.properties.hashed_token,type});
 if(opened.error||!opened.data.session||opened.data.user?.id!==context.authUserId||opened.data.user.email?.toLowerCase()!==context.email)return {ok:false,reason:'unavailable'};
 const session=await validatedStaffSession(buffered.client.auth,opened.data.session.access_token);
 if(!session||session.user.id!==context.authUserId)return {ok:false,reason:'unavailable'};
 let decision:{ok:boolean;result?:string}|null=null;
 for(let i=0;i<3&&!decision;i++){
  const a=await db.rpc('staff_invite_admit',{p_claim:verified.data.claimId,p_nonce_hmac:nonceHmac,p_user:session.user.id,p_session:session.sessionId});
  const parsed=z.object({ok:z.boolean(),result:z.string().optional()}).safeParse(a.data);
  if(!a.error&&parsed.success)decision=parsed.data;
 }
 if(!decision||decision.result!=='admitted'){
  if(decision?.result==='rejected')await db.rpc('staff_invite_reject_session',{p_claim:verified.data.claimId,p_session:session.sessionId});
  return {ok:false,reason:'rejected'};
 }
 // Old chunks of a previous staff session in this browser would corrupt the new one (review B-2a #6).
 for(const old of jar.getAll())if(old.name.startsWith('noreon-real-staff-auth')&&!buffered.jar.has(old.name))jar.delete(old.name);
 for(const c of buffered.jar.values())jar.set(c.name,c.value,c.options);
 return {ok:true,context,userId:session.user.id,sessionId:session.sessionId};
}
