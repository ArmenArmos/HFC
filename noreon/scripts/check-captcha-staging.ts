import * as noticeLinks from '@/lib/staff-zoe/notice-link';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as nodeModule from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import * as React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {normalizePhone,armenianNationalDigits,armenianPhoneFromNational,foreignInternationalNumber} from '@/lib/patient/validation';
import * as realLocaleModule from '@/lib/locale';
const continuePathModule=await import('@/lib/patient/continue-path');
// The CAPTCHA setting (NOREON_CAPTCHA_ENABLED, 19 Oct; replaced the 17 Oct staging switch): for every
// combination, with and without the pre-launch staging marker, exercise the
// actual helper, deployment guard, sign-in actions, pages and widgets. Auth,
// navigation and the hCaptcha widget are replaced; nothing reaches Supabase.
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
type Resolution={url:string;shortCircuit?:boolean};
type Resolver=(s:string,c:unknown,next:(s:string,c:unknown)=>Resolution)=>Resolution;
const {registerHooks}=nodeModule as unknown as {registerHooks:(h:{resolve:Resolver})=>{deregister:()=>void}};
const auth={otp:[] as Array<{captchaToken?:string}>,password:[] as Array<{captchaToken?:string}>};
Object.assign(globalThis,{__captchaStaging:auth});
const prefix='const f=globalThis.__captchaStaging;';
const client=`{auth:{signInWithOtp:async(v)=>{f.otp.push(v.options);return {error:null}},signInWithPassword:async(v)=>{f.password.push(v.options);return {error:{message:'stop here'}}},signOut:async()=>({error:null})},rpc:async()=>({data:null,error:null})}`;
const mocks:Record<string,string>={
 '@/lib/security/rate-limit':`export async function rateLimit(){return {ok:true};}export async function recordRateLimit(){}`,
 '@/lib/supabase/server':prefix+`export const createClient=async()=>(${client});`,
 '@/lib/patient/demo':`export const demoEnabled=()=>false;export const DEMO_PHONE='+37499000000';export const demoSignIn=async()=>true;export const demoSignOut=async()=>{};export const readDemo=async()=>null;export const restartDemoQuestions=async()=>({ok:false});`,
 '@/lib/patient/auth':`export const patientIdentity=async()=>null;`,
 '@/lib/patient/repository':`export const patientStore=()=>{throw Error('unexpected store use')};`,
 '@/lib/patient/service':`export const createPatientService=()=>({});`,
 'next/cache':`export const revalidatePath=()=>{};`,
 'next/navigation':`export function redirect(url){throw Error('redirect:'+url);}export function notFound(){throw Error('notFound');}`,
 './probe':prefix+`export function probeAuthClient(){return ${client};}`,
 './signin':`export async function backofficePortals(){return {staff:true,clinic:true};}export const clinicHomePath=()=>'/clinic/real/batches';`,
 '@/lib/clinic-portal/identity':`export async function clinicAuthClient(){throw Error('Unused');}`,
 '@/lib/patient-care/clinical-case-repository':`export async function realStaffClient(){throw Error('Unused');}export async function requireRealStaff(){throw Error('Unused');}`,
};
const hook=registerHooks({resolve(s,c,next){const source=mocks[s];return source?{url:'data:text/javascript,'+encodeURIComponent(source),shortCircuit:true}:next(s,c);}});
const keys=['NOREON_DEPLOYMENT_TARGET','NOREON_REGISTRATION_ENABLED','NOREON_PHONE_OTP_PROVIDER','NOREON_REGISTRATION_ALLOWED_PREFIXES','NEXT_PUBLIC_HCAPTCHA_SITE_KEY','NOREON_CAPTCHA_ENABLED','NOREON_CAPTCHA_DISABLED_FOR_STAGING','NOREON_PRELAUNCH_STAGING'];
const before=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
try{
 const captcha=await import('@/lib/captcha');
 const {deploymentErrors}=await import('@/lib/deployment');
 const {requestPhoneCode}=await import('@/app/patient/actions');
 const {backofficeSignIn}=await import('@/lib/backoffice/actions');

 // Fake widget: records the key it was given. Client modules see a decoy public
 // key in their own process.env, which must never be what reaches the widget.
 const widgetKeys:string[]=[];
 const FakeCaptcha=React.forwardRef(function Captcha(props:{sitekey:string},ref:React.ForwardedRef<unknown>){
  React.useImperativeHandle(ref,()=>({resetCaptcha(){},execute:async()=>({response:'fixture-token'})}));
  widgetKeys.push(props.sitekey);
  return React.createElement('div',{'data-captcha':props.sitekey});
 });
 const sends:Array<string|undefined>=[];
 const load=(path:string):Record<string,unknown>=>{
  const exports:Record<string,unknown>={};
  const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(code,{exports,process:{env:{NEXT_PUBLIC_PATIENT_DEMO:'false',NEXT_PUBLIC_HCAPTCHA_SITE_KEY:'client-env-decoy'}},setTimeout:()=>1,clearTimeout(){},require:(name:string)=>{
  if(name==='@/lib/staff-zoe/notice-link')return noticeLinks;
   if(name==='react')return React;
   if(name==='react/jsx-runtime')return jsx;
   if(name==='@hcaptcha/react-hcaptcha')return {default:FakeCaptcha};
   if(name==='@/lib/captcha')return captcha;
   if(name==='next/navigation')return {useRouter:()=>({replace(){},push(){},refresh(){}}),unstable_rethrow(){},notFound:()=>{throw Error('notFound');},redirect:(p:string)=>{throw Error('redirect:'+p);}};
   if(name==='next/headers')return {headers:async()=>({get:()=>'localhost:3000'}),cookies:async()=>({get:()=>undefined})};
   if(name.endsWith('/patient/auth'))return {patientIdentity:async()=>null};
   if(name.endsWith('/deployment'))return {realRegistrationReady:()=>true};
   if(name.endsWith('/continue-path'))return continuePathModule;
   if(name.endsWith('/test-signin'))return {testSigninEntryEnabled:(env:Record<string,string|undefined>)=>env.NOREON_TEST_SIGNIN_ENABLED==='true'};
  if(name.endsWith('/phone-code-policy'))return {phoneCodePolicy:()=>({delivery:'sms'})};
   if(name.endsWith('/real-review-config'))return {realReviewEnabled:()=>true};
   if(name.endsWith('/clinic-portal/config'))return {clinicPortalEnabled:()=>true,clinicHostAllowed:()=>true};
   if(name.endsWith('/signin-link-config'))return {signinLinkOrigin:()=>'https://app.example.invalid'};
   if(name.endsWith('/phone-entry'))return load('components/patient/phone-entry.tsx');
   if(name.endsWith('/telegram-link-continue'))return load('components/patient/telegram-link-continue.tsx');
   if(name.endsWith('/backoffice/sign-in-page'))return load('components/backoffice/sign-in-page.tsx');
   if(name.endsWith('/backoffice/sign-in'))return load('components/backoffice/sign-in.tsx');
   if(name.endsWith('/real-review/signin-language'))return {SigninLanguageLinks:()=>null};
   if(name.endsWith('/backoffice/signin'))return {backofficePortals:async()=>({staff:true,clinic:true}),signedInDestination:async()=>null};
   if(name.endsWith('/patient/actions'))return {requestPhoneCode:async(_phone:string,token?:string)=>{sends.push(token);return {ok:true};},verifyPhoneCode:async()=>({ok:true}),switchTelegramAccount:async()=>({ok:false})};
   if(name.endsWith('/telegram-link/actions'))return {continueTelegramLink:async()=>({ok:false,reason:'expired'})};
   if(name.endsWith('/backoffice/actions'))return {backofficeSignIn:async()=>({ok:false,message:''})};
   if(name.endsWith('/clinical-review-actions'))return {checkRealClinicalCaseAvailability:async()=>({})};
   if(name.endsWith('/patient-shell'))return {PatientShell:({children}:{children:React.ReactNode})=>React.createElement('main',{},children)};
   if(name.endsWith('/onboarding-steps'))return {OnboardingSteps:({step}:{step:number})=>React.createElement('div',{'data-onboarding-step':step})};
   if(name.endsWith('/validation'))return {normalizePhone,armenianNationalDigits,armenianPhoneFromNational,foreignInternationalNumber};
   if(name.endsWith('/copy'))return {tx:(_l:string,_hy:string,en:string)=>en};
   if(name.endsWith('/transport'))return {safeRequest:async(fn:()=>unknown)=>fn(),lockUnavailableMessage:()=>''};
   if(name.endsWith('/button'))return {Button:({children,variant,size,...props}:{children:React.ReactNode;variant?:string;size?:string})=>{void variant;void size;return React.createElement('button',props,children);}};
   if(name.endsWith('/input'))return {Input:(props:object)=>React.createElement('input',props)};
   if(name.endsWith('/label'))return {Label:(props:object)=>React.createElement('label',props)};
   if(name==='@/lib/clinic-portal/locale')return {clinicLocale:async(value:unknown)=>realLocaleModule.parseLocale(value,'en')};
   if(name==='@/lib/locale')return realLocaleModule;throw Error(`Unexpected boundary ${name} in ${path}`);
  }});
  return exports;
 };
 const pages={
  member:load('app/patient/page.tsx').default as (p:object)=>Promise<React.ReactNode>,
  telegram:load('app/patient/telegram-link/page.tsx').default as ()=>React.ReactNode,
  staff:load('app/staff/real/login/page.tsx').default as (p:object)=>Promise<React.ReactNode>,
  clinic:load('app/clinic/real/login/page.tsx').default as (p:object)=>Promise<React.ReactNode>,
 };
 const PhoneEntry=load('components/patient/phone-entry.tsx').PhoneEntry as React.ComponentType<{initialLocale:string;siteKey?:string}>;
 // The login pages wrap one async server component (the shared sign-in page); resolve it.
 const serverRender=async(node:React.ReactNode)=>{const el=node as React.ReactElement<object>;return (typeof el?.type==='function'?await (el.type as (p:object)=>unknown)(el.props):el) as React.ReactElement;};
 const findProps=(node:React.ReactNode,prop:string):Record<string,unknown>|undefined=>{
  if(!React.isValidElement(node))return Array.isArray(node)?node.map(n=>findProps(n,prop)).find(Boolean):undefined;
  const props=node.props as Record<string,unknown>;
  return prop in props?props:findProps(props.children as React.ReactNode,prop);
 };
 const form=()=>{const f=new FormData();f.set('email','synthetic@example.invalid');f.set('password','synthetic-unused');return f;};

 const SITE='fixture-site-key';
 const base={NOREON_DEPLOYMENT_TARGET:'app',NOREON_REGISTRATION_ENABLED:'true',NOREON_PHONE_OTP_PROVIDER:'twilio-whatsapp',NOREON_REGISTRATION_ALLOWED_PREFIXES:'+374',NEXT_PUBLIC_PATIENT_DEMO:'false',NEXT_PUBLIC_SUPABASE_URL:'https://example.invalid',NEXT_PUBLIC_SUPABASE_ANON_KEY:'anon',SUPABASE_SERVICE_ROLE_KEY:'service'};
 const cases:Array<{name:string;env:Record<string,string>;required:boolean;deployOk:boolean}>=[
  // Off by default (Khikar, 19 Oct 01:28), whether or not the staging marker is set.
  {name:'unset',env:{NEXT_PUBLIC_HCAPTCHA_SITE_KEY:SITE},required:false,deployOk:true},
  {name:'unset, staging marker',env:{NEXT_PUBLIC_HCAPTCHA_SITE_KEY:SITE,NOREON_PRELAUNCH_STAGING:'true'},required:false,deployOk:true},
  {name:'false',env:{NEXT_PUBLIC_HCAPTCHA_SITE_KEY:SITE,NOREON_CAPTCHA_ENABLED:'false'},required:false,deployOk:true},
  {name:'false, staging marker',env:{NEXT_PUBLIC_HCAPTCHA_SITE_KEY:SITE,NOREON_CAPTCHA_ENABLED:'false',NOREON_PRELAUNCH_STAGING:'true'},required:false,deployOk:true},
  // On is honoured with or without the marker.
  {name:'true',env:{NEXT_PUBLIC_HCAPTCHA_SITE_KEY:SITE,NOREON_CAPTCHA_ENABLED:'true'},required:true,deployOk:true},
  {name:'true, staging marker',env:{NEXT_PUBLIC_HCAPTCHA_SITE_KEY:SITE,NOREON_CAPTCHA_ENABLED:'true',NOREON_PRELAUNCH_STAGING:'true'},required:true,deployOk:true},
  // The retired staging switch no longer decides anything.
  {name:'true, retired switch and marker',env:{NEXT_PUBLIC_HCAPTCHA_SITE_KEY:SITE,NOREON_CAPTCHA_ENABLED:'true',NOREON_CAPTCHA_DISABLED_FOR_STAGING:'true',NOREON_PRELAUNCH_STAGING:'true'},required:true,deployOk:true},
  {name:'unset, retired switch alone',env:{NEXT_PUBLIC_HCAPTCHA_SITE_KEY:SITE,NOREON_CAPTCHA_DISABLED_FOR_STAGING:'true'},required:false,deployOk:true},
  // A malformed value fails the build and reads as off.
  {name:'TRUE (not exactly true)',env:{NEXT_PUBLIC_HCAPTCHA_SITE_KEY:SITE,NOREON_CAPTCHA_ENABLED:'TRUE'},required:false,deployOk:false},
  {name:'1',env:{NEXT_PUBLIC_HCAPTCHA_SITE_KEY:SITE,NOREON_CAPTCHA_ENABLED:'1',NOREON_PRELAUNCH_STAGING:'true'},required:false,deployOk:false},
 ];
 for(const c of cases){
  for(const key of keys)delete process.env[key];
  Object.assign(process.env,base,c.env);
  const label=(what:string)=>`${c.name}: ${what}`;
  assert.equal(captcha.captchaRequired(),c.required,label('helper'));
  assert.equal(captcha.captchaSiteKey(),c.required?SITE:'',label('site key handed to pages'));
  assert.equal(deploymentErrors(process.env).length===0,c.deployOk,label(`deployment guard ${deploymentErrors(process.env).join('; ')}`));

  // Server actions, called without a token.
  auth.otp.length=0;auth.password.length=0;
  const phone=await requestPhoneCode('+37499000001');
  assert.equal(phone.ok,!c.required,label('member code request without token'));
  assert.equal(auth.otp.length,c.required?0:1,label('member request reaches Auth only when CAPTCHA is off'));
  assert.equal((await backofficeSignIn({ok:false,message:''},form())).message,c.required?'Complete the sign-in verification.':'Sign-in was unsuccessful. Check your details or contact your administrator.',label('staff and clinic sign-in without token'));
  assert.equal(auth.password.length,c.required?0:1,label('password sign-in reaches Auth only when CAPTCHA is off'));
  if(c.required){
   // With a token, behaviour is unchanged: it is forwarded to Auth.
   assert.equal((await requestPhoneCode('+37499000001','fixture-token')).ok,true,label('member request with token'));
   await backofficeSignIn({ok:false,message:''},(()=>{const f=form();f.set('captchaToken','fixture-token');return f;})());
   assert.equal(auth.otp.at(-1)?.captchaToken,'fixture-token');assert.equal(auth.password.at(-1)?.captchaToken,'fixture-token');
  }

  // Pages and widgets.
  // The Telegram link widget mounts only after reading the #fragment, so check the key the page hands it.
  const telegram=findProps(pages.telegram(),'siteKey');
  assert.equal(telegram?.siteKey,c.required?SITE:'',label('telegram link page passes the decided key'));
  for(const [page,html] of [
   ['staff login',renderToStaticMarkup(await serverRender(await pages.staff({searchParams:Promise.resolve({})})))],
   ['clinic login',renderToStaticMarkup(await serverRender(await pages.clinic({searchParams:Promise.resolve({})})))],
  ] as const){
   assert.doesNotMatch(html,/client-env-decoy/,label(`${page} never reads the public key in the client`));
   if(c.required)assert.match(html,new RegExp(`data-captcha="${SITE}"`),label(`${page} renders the widget`));
   else assert.doesNotMatch(html,/data-captcha/,label(`${page} renders no widget`));
   assert.equal(/<button[^>]*disabled=""[^>]*>Sign in/.test(html),c.required,label(`${page} Sign in waits for a token only when required`));
  }
  const member=await pages.member({}) as React.ReactElement<{siteKey:string}>;
  assert.equal(member.props.siteKey,c.required?SITE:'',label('member page passes the decided key'));
  // Member journey: with CAPTCHA required, Continue then Send after the token; without it, the code goes at
  // once (Khikar, 19 Oct: no extra tap), never with a token.
  sends.length=0;widgetKeys.length=0;
  let view:ReactTestRenderer;
  await act(async()=>{view=create(React.createElement(PhoneEntry,{initialLocale:'en',siteKey:member.props.siteKey}),{createNodeMock:()=>({focus(){}})});});
  const root=()=>view!.root;
  await act(async()=>root().findByType('input').props.onChange({target:{value:'+37499000001'}}));
  await act(async()=>root().findByType('form').props.onSubmit({preventDefault(){}}));
  assert.equal(root().findAllByType(FakeCaptcha).length,c.required?1:0,label('member security step widget'));
  assert.ok(!widgetKeys.includes('client-env-decoy'),label('member widget never uses the client env key'));
  if(c.required){
   const sendButton=root().findAllByType('button').find(b=>b.props.type==='submit')!;
   assert.equal(Boolean(sendButton.props.disabled),true,label('member Send waits for a token when required'));
   assert.deepEqual(sends,[],label('nothing sent before the token'));
  }else assert.deepEqual(sends,[undefined],label('member code goes at once, without a token or a confirm screen'));
  await act(async()=>view!.unmount());
 }
 // No site key at all (local development): nothing required.
 for(const key of keys)delete process.env[key];
 assert.equal(captcha.captchaRequired(),false);
 assert.equal(captcha.captchaRequired({NOREON_CAPTCHA_ENABLED:'true'}),false,'No site key, no widget to solve');
 // Live registration no longer needs CAPTCHA (owner decision); switching it on needs a site key.
 assert.deepEqual(deploymentErrors({...base}),[]);
 assert.deepEqual(deploymentErrors({...base,NOREON_PRELAUNCH_STAGING:'true'}),[]);
 assert.ok(deploymentErrors({...base,NOREON_CAPTCHA_ENABLED:'true'}).includes('NOREON_CAPTCHA_ENABLED=true requires NEXT_PUBLIC_HCAPTCHA_SITE_KEY'));
 assert.ok(deploymentErrors({NOREON_CAPTCHA_ENABLED:'yes'}).length>0,'A malformed value fails even without a deployment target');
 assert.deepEqual(deploymentErrors({NOREON_CAPTCHA_DISABLED_FOR_STAGING:'true'}),[],'The retired switch is a warning, not a build error');
 // Warnings: an app deployment without CAPTCHA, and the retired switch; never local runs.
 assert.deepEqual(captcha.captchaWarnings({}),[]);
 assert.deepEqual(captcha.captchaWarnings({NOREON_CAPTCHA_ENABLED:'true',NEXT_PUBLIC_HCAPTCHA_SITE_KEY:SITE}),[]);
 for(const env of [{NOREON_DEPLOYMENT_TARGET:'app'},{NEXT_PUBLIC_HCAPTCHA_SITE_KEY:SITE},{NOREON_DEPLOYMENT_TARGET:'app',NOREON_PRELAUNCH_STAGING:'true'},{NOREON_DEPLOYMENT_TARGET:'app',NOREON_CAPTCHA_ENABLED:'false'}]){
  const w=captcha.captchaWarnings(env);assert.equal(w.length,1);assert.match(w[0]!,/hCaptcha is OFF/);
 }
 assert.match(captcha.captchaWarnings({NOREON_CAPTCHA_DISABLED_FOR_STAGING:'true'}).join('\n'),/retired and ignored/);
 const warnings:string[]=[];const warn=console.warn;console.warn=(m:string)=>{warnings.push(m);};
 try{captcha.warnIfCaptchaDisabled({});assert.equal(warnings.length,0);
  captcha.warnIfCaptchaDisabled({NOREON_DEPLOYMENT_TARGET:'app'});captcha.warnIfCaptchaDisabled({NOREON_DEPLOYMENT_TARGET:'app'});
  assert.equal(warnings.length,1,'Logged once per process');assert.match(warnings[0]??'',/hCaptcha is OFF/);}
 finally{console.warn=warn;}
 console.log('CAPTCHA setting: unset, false, true and malformed values, each with and without the staging marker, checked across helper, deployment guard, member/staff/clinic actions, sign-in pages and widgets (Auth and widget mocked).');
}finally{
 hook.deregister();Reflect.deleteProperty(globalThis,'__captchaStaging');
 for(const key of keys){if(before[key]===undefined)delete process.env[key];else process.env[key]=before[key];}
}
