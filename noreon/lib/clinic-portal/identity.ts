import 'server-only';
import{noteActor}from'@/lib/observability/context';
import{createHash}from'node:crypto';
import{cookies,headers}from'next/headers';
import{createServerClient}from'@supabase/ssr';
import{notFound,redirect}from'next/navigation';
import type{Database}from'@/lib/db/types';
import{validatedStaffSession}from'@/lib/staff/real-session-binding';
import{clinicHostAllowed,clinicPortalEnabled}from'./config';
import{readClinicAccess}from'./access-runtime';
import type{ClinicRpc}from'./runtime';
import{parseStaffSigninState,staffTelegramSigninEnabled,telegramStepDue}from'@/lib/telegram-auth/staff-signin-config';
export async function clinicAuthClient(){
 if(!clinicPortalEnabled()||!clinicHostAllowed((await headers()).get('host')??''))notFound();
 if(!process.env.NEXT_PUBLIC_SUPABASE_URL||!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)throw Error('Clinic access is temporarily unavailable.');
 const jar=await cookies();return createServerClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{cookieOptions:{name:'noreon-real-clinic-auth',httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',path:'/'},cookies:{getAll:()=>jar.getAll(),setAll:values=>{try{for(const{name,value,options}of values)jar.set(name,value,options);}catch{/* Server components cannot write; login/actions own cookie writes. */}}}});
}
export async function clinicAccess(clinicId:string|null=null){
 const client=await clinicAuthClient(),session=await validatedStaffSession(client.auth);
 if(session)noteActor('clinic',session.user.id);
 const access=await readClinicAccess(client as unknown as ClinicRpc,session?{userId:session.user.id,sessionId:session.sessionId,amr:session.claims.amr}:null,clinicId);
 return{client,session,access};
}
/** A denied clinic session that only lacks its Telegram code (T-auth B-2b-1) goes to the second step. */
export async function clinicTelegramStepDue(context:{client:Awaited<ReturnType<typeof clinicAuthClient>>;session:unknown}){
 if(!staffTelegramSigninEnabled()||!context.session)return false;
 const step=await context.client.rpc('staff_signin_state').then(r=>r.error?null:parseStaffSigninState(r.data),()=>null);
 return telegramStepDue(step,'clinic');
}
/** `page` is for page renders only. QA F-08: a ?clinic= this session cannot open (another clinic's id,
 * or a malformed one) is then ignored, and the user's own clinic is resolved instead of sending a
 * signed-in user to login. Commands and downloads stay strict: they never run against another clinic. */
export async function requireClinicPortal(clinicId:string|null=null,options:{page?:boolean}={}){
 let context=await clinicAccess(clinicId);
 if(options.page&&context.access.status==='denied'&&clinicId!==null&&context.session)context=await clinicAccess(null);
 if(context.access.status==='denied'){
  // A clinic session waiting for its Telegram code goes to the second step (T-auth B-2b-1).
  if(await clinicTelegramStepDue(context))redirect('/clinic/real/verify');
  redirect('/clinic/real/login');
 }
 if(context.access.status==='selection-required')redirect('/clinic/real/select');
 if(context.access.status!=='ready'||!context.session)throw Error('Clinic access is temporarily unavailable. Try again.');
 const identity=context.access.identity;
 const actorScope=createHash('sha256').update(JSON.stringify([identity.userId,context.session.sessionId,identity.membershipId,identity.membershipRevision,identity.clinicId])).digest('hex');
 return{client:context.client,rpc:context.client as unknown as ClinicRpc,identity,actorScope,execution:{actorId:context.session.user.id,sessionId:context.session.sessionId}};
}
