'use server';
import {parseLocale,pick} from '@/lib/locale';
import {loggedAction} from '@/lib/observability/with-logging';
import {z} from 'zod';
import {notFound,redirect} from 'next/navigation';
import {cookies} from 'next/headers';
import {staffLocaleCookie} from '@/lib/staff/staff-locale';
import type {Route} from 'next';
import {captchaRequired} from '@/lib/captcha';
import {rateLimit,recordRateLimit} from '@/lib/security/rate-limit';
import {validatedStaffSession} from '@/lib/staff/real-session-binding';
import {readClinicAccess} from '@/lib/clinic-portal/access-runtime';
import type {ClinicRpc} from '@/lib/clinic-portal/runtime';
import {clinicAuthClient} from '@/lib/clinic-portal/identity';
import {realStaffClient,requireRealStaff} from '@/lib/patient-care/clinical-case-repository';
import {parseStaffSigninState,staffTelegramSigninEnabled,telegramStepDue} from '@/lib/telegram-auth/staff-signin-config';
import {probeAuthClient} from './probe';
import {doctorHomePath} from '@/lib/staff-zoe/workspace-config';
import {backofficePortals,clinicHomePath} from './signin';
import {staffNoticeReturnPath,staffNoticeSignInPath} from '@/lib/staff-zoe/notice-link';

export type BackofficeSignInState={ok:boolean;message:string};
/**
 * The one staff and clinic sign-in. The password is checked once (one CAPTCHA token), on a
 * client that writes no cookie. Staff identity wins; otherwise an active clinic membership;
 * otherwise a pending Telegram second step for either portal. Only then is the session stored
 * under that portal's cookie, and the portal's own guards run again on the next page.
 */
export const backofficeSignIn=loggedAction("backofficeSignIn",async function backofficeSignIn(_previous:BackofficeSignInState,form:FormData):Promise<BackofficeSignInState>{
 const locale=parseLocale(form.get('locale'),'en'),hy=locale==='hy',fail=(en:string,hyText:string,ru:string)=>({ok:false,message:pick(locale,{en,hy:hyText,ru})});
 const portals=await backofficePortals();
 if(!portals.staff&&!portals.clinic)notFound();
 const parsed=z.object({email:z.email().max(320),password:z.string().min(1).max(1024)}).safeParse({email:form.get('email'),password:form.get('password')});
 if(!parsed.success)return fail('Check your sign-in details.','Ստուգեք մուտքի տվյալները։',"Проверьте данные для входа.");
 const captchaToken=String(form.get('captchaToken')??'');
 if(captchaRequired()&&!captchaToken)return fail('Complete the sign-in verification.','Անցեք մուտքի ստուգումը։',"Пройдите проверку для входа.");
 // Every attempt counts against this network; the account's own quota counts only wrong
 // passwords that got past CAPTCHA, so a stranger cannot lock a staff member out for free.
 const limited=fail('Too many sign-in attempts. Wait 15 minutes and try again.','Չափազանց շատ մուտքի փորձեր։ Սպասեք 15 րոպե և նորից փորձեք։',"Слишком много попыток входа. Подождите 15 минут и попробуйте снова.");
 try{if(!(await rateLimit('staff_signin',[{kind:'source'},{kind:'email',value:parsed.data.email,mode:'peek'}])).ok)return limited;}
 catch{return fail('Sign-in could not be completed. Try again later.','Մուտքը չավարտվեց։ Փորձեք ավելի ուշ։',"Не удалось завершить вход. Попробуйте позже.");}
 const probe=probeAuthClient();
 const signedIn=await probe.auth.signInWithPassword({...parsed.data,options:{captchaToken:captchaToken||undefined}});
 const tokens=signedIn.data?.session;
 // Only a wrong password counts: CAPTCHA failures, Auth's own rate limit and outages never do.
 if(signedIn.error?.code==='invalid_credentials')await recordRateLimit('staff_signin',[{kind:'email',value:parsed.data.email}]);
 if(signedIn.error||!tokens)return fail('Sign-in was unsuccessful. Check your details or contact your administrator.','Մուտքը չհաջողվեց։ Ստուգեք տվյալները կամ կապվեք ադմինիստրատորի հետ։',"Не удалось войти. Проверьте данные или обратитесь к администратору.");
 const unavailable=async()=>{await probe.auth.signOut({scope:'local'}).catch(()=>null);return fail('Sign-in could not be completed. Try again later.','Մուտքը չավարտվեց։ Փորձեք ավելի ուշ։',"Не удалось завершить вход. Попробуйте позже.");};
 const keep={access_token:tokens.access_token,refresh_token:tokens.refresh_token};

 let portal:'staff'|'clinic'|null=null;let clinicPath='';
 if(portals.staff){
  const staff=await probe.rpc('real_clinical_staff_identity');
  if(staff.error)return unavailable();
  if(staff.data)portal='staff';
  // A qa tester has no clinical identity; requireRealStaff then sends them to the test account list.
  if(!portal){const qa=await probe.rpc('test_account_operator_identity');if(qa.error)return unavailable();if(qa.data)portal='staff';}
 }
 if(!portal&&portals.clinic){
  let session:Awaited<ReturnType<typeof validatedStaffSession>>;
  try{session=await validatedStaffSession(probe.auth,tokens.access_token);}catch{return unavailable();}
  const access=await readClinicAccess(probe as unknown as ClinicRpc,session?{userId:session.user.id,sessionId:session.sessionId,amr:session.claims.amr}:null,null);
  if(access.status==='unavailable')return unavailable();
  if(access.status==='ready'){portal='clinic';clinicPath=clinicHomePath(access.identity.clinicId,hy).replace(/locale=(?:hy|en)/,`locale=${locale}`);}
  if(access.status==='selection-required'){portal='clinic';clinicPath='/clinic/real/select';}
 }
 let step:ReturnType<typeof parseStaffSigninState>=null,staffStep=false;
 if(!portal){
  // Telegram second step (T-auth B-1/B-2b): an enrolled account continues to its portal's code screen.
  try{const r=await probe.rpc('staff_signin_state');step=r.error?null:parseStaffSigninState(r.data);}catch{return unavailable();}
  if(staffTelegramSigninEnabled()&&portals.staff&&telegramStepDue(step,'staff')){portal='staff';staffStep=true;}
  else if(staffTelegramSigninEnabled()&&portals.clinic&&telegramStepDue(step,'clinic')){portal='clinic';clinicPath=`/clinic/real/verify${locale!=='en'?`?locale=${locale}`:''}`;}
 }
 if(!portal){
  await probe.auth.signOut({scope:'local'}).catch(()=>null);
  const telegramMissing=step?.required&&!step.admitted&&!step.enrolled&&((portals.staff&&step.staffEligible)||(portals.clinic&&step.clinicEligible));
  return telegramMissing?fail('Telegram is not set up for your account yet. Contact your administrator.','Ձեր հաշվի համար Telegram-ը դեռ միացված չէ։ Դիմեք ադմինիստրատորին։',"Telegram ещё не настроен для вашей учётной записи. Обратитесь к администратору.")
   :fail('An active staff or clinic account is required.','Անհրաժեշտ է աշխատակցի կամ կլինիկայի ակտիվ հաշիվ։',"Требуется активная учётная запись сотрудника или клиники.");
 }
 if(portal==='staff'){
  const client=await realStaffClient();
  if((await client.auth.setSession(keep)).error)return unavailable();
  // A plain display preference, read only for nurse and doctor screens: set before the Telegram step too, so the language chosen here survives it.
  const keepLanguage=async()=>{(await cookies()).set(staffLocaleCookie,locale,{path:'/',httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',maxAge:60*60*24*365});};
  if(staffStep){await keepLanguage();redirect(staffNoticeSignInPath('/staff/real/verify',form.get('next')) as Route);}
  const {identity}=await requireRealStaff();
  if(identity.role==='doctor'||identity.role==='nurse')await keepLanguage();
  redirect((staffNoticeReturnPath(form.get('next'))??doctorHomePath(identity.role)) as Route);
 }
 const client=await clinicAuthClient();
 if((await client.auth.setSession(keep)).error)return unavailable();
 redirect(clinicPath as Route);
});
