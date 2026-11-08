import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
import {tx} from '@/lib/patient/copy';
import {normalizePhone,armenianNationalDigits,armenianPhoneFromNational,foreignInternationalNumber} from '@/lib/patient/validation';
import * as realLocaleModule from '@/lib/locale';
const continuePathModule=await import('@/lib/patient/continue-path');
let cookie:string|undefined;
let identity:object|null=null;
let ready=true;
let commands=0;
let captchaKey:string|undefined;
let cookieReads=0;
const runtimeProcess:{env:Record<string,string|undefined>}={env:{NEXT_PUBLIC_PATIENT_DEMO:'false',NEXT_PUBLIC_HCAPTCHA_SITE_KEY:'fixture-captcha-key'}};
const load=(path:string):Record<string,unknown>=>{
 const exports:Record<string,unknown>={};
 const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{exports,process:runtimeProcess,require:(name:string)=>{
  if(name==='react/jsx-runtime') return jsx;
  if(name==='react') return React;
  if(name==='next/navigation') return {useRouter:()=>({refresh(){},push(){}}),redirect:(path:string)=>{throw new Error(`redirect:${path}`);}};
  if(name==='next/headers') return {cookies:async()=>({get:(name:string)=>{assert.equal(name,'noreon_locale');cookieReads++;return cookie===undefined?undefined:{value:cookie};}})};
  if(name==='@hcaptcha/react-hcaptcha') return {default:({sitekey}:{sitekey:string})=>{captchaKey=sitekey;return React.createElement('div',{'data-captcha':sitekey});}};
  if(name.endsWith('/patient/actions')) return {requestPhoneCode:()=>{commands++;},verifyPhoneCode:()=>{commands++;}};
  if(name.endsWith('/patient/auth')) return {patientIdentity:async()=>identity};
  if(name.endsWith('/deployment')) return {realRegistrationReady:()=>ready};
  if(name.endsWith('/lib/captcha')) return {captchaSiteKey:()=>'fixture-captcha-key'};
  if(name.endsWith('/continue-path'))return continuePathModule;
  if(name.endsWith('/test-signin'))return {testSigninEntryEnabled:(env:Record<string,string|undefined>)=>env.NOREON_TEST_SIGNIN_ENABLED==='true'};
  if(name.endsWith('/phone-code-policy')) return {phoneCodePolicy:()=>({delivery:'sms'})};
  if(name.endsWith('/phone-entry')) return load('components/patient/phone-entry.tsx');
  if(name.endsWith('/patient-shell')) return {PatientShell:({children,locale}:{children:React.ReactNode;locale:string})=>React.createElement('main',{'data-locale':locale},children)};
  if(name.endsWith('/onboarding-steps')) return {OnboardingSteps:({step}:{step:number})=>React.createElement('div',{'data-onboarding-step':step})};
  if(name.endsWith('/validation')) return {normalizePhone,armenianNationalDigits,armenianPhoneFromNational,foreignInternationalNumber};
  if(name.endsWith('/copy')) return {tx};
  if(name.endsWith('/transport')) return {safeRequest:async(fn:()=>unknown)=>fn(),lockUnavailableMessage:()=>''};
  if(name.endsWith('/button')) return {Button:({children,variant,size,...props}:{children:React.ReactNode;variant?:string;size?:string})=>{void variant;void size;return React.createElement('button',props,children);}};
  if(name.endsWith('/input')) return {Input:(props:React.InputHTMLAttributes<HTMLInputElement>)=>React.createElement('input',props)};
  if(name.endsWith('/label')) return {Label:(props:React.LabelHTMLAttributes<HTMLLabelElement>)=>React.createElement('label',props)};
  if(name==='@/lib/locale')return realLocaleModule;throw new Error(`Unexpected boundary ${name}`);
 }});
 return exports;
};
const Page=load('app/patient/page.tsx').default as (props:{searchParams?:Promise<{locale?:string|string[]}>})=>Promise<React.ReactNode>;
const Entry=load('components/patient/phone-entry.tsx').PhoneEntry as React.ComponentType<{initialLocale?:'en'|'hy'}>;
for(cookie of ['en','hy',undefined,'invalid']) {
 const html=renderToStaticMarkup(await Page({}));
 const english=cookie==='en';
 assert.match(html,english?/Welcome to Noreon/:/Բարի գալուստ Noreon/,'Fresh signed-out render must respect saved language and default HY');
 assert.match(html,english?/data-locale="en"/:/data-locale="hy"/);
}
assert.match(renderToStaticMarkup(React.createElement(Entry,{initialLocale:'en'})),/Welcome to Noreon/);
assert.match(renderToStaticMarkup(React.createElement(Entry,{})),/Բարի գալուստ Noreon/);
assert.equal(captchaKey,undefined,'Welcome does not mount CAPTCHA before Continue');
assert.doesNotMatch(renderToStaticMarkup(React.createElement(Entry,{initialLocale:'en'})),/data-captcha/);
assert.match(renderToStaticMarkup(React.createElement(Entry,{initialLocale:'en'})),/Sign in or create your account/);
assert.equal(commands,0,'SSR never sends or verifies a code');
assert.match(renderToStaticMarkup(React.createElement(Entry,{initialLocale:'en'})),/<button[^>]*disabled[^>]*>Send the code<\/button>/,'Send the code (no CAPTCHA: no confirm screen) cannot submit a native form before hydration');
assert.equal(cookieReads,4,'Each fresh signed-out page reads its own locale preference');
for(const gate of [true,false]) {
 ready=gate;
 for(const [saved,requested,english] of [['hy','en',true],['en','hy',false],['en','invalid',true],['hy',['en','hy'],false]] as const) {
  cookie=saved;
  const html=renderToStaticMarkup(await Page({searchParams:Promise.resolve({locale:requested as string|string[]})}));
  assert.match(html,gate?(english?/Welcome to Noreon/:/Բարի գալուստ Noreon/):(english?/Registration opens soon/:/Գրանցումը՝ շուտով/),'Native fallback language must reach the actual entry screen; invalid or repeated preferences fall back to saved locale');
  if(!gate) assert.doesNotMatch(html,/<form/,'Language links cannot enable registration');
 }
}
ready=true;
identity={id:'fixture'};const beforeRedirect=cookieReads;await assert.rejects(()=>Page({searchParams:Promise.resolve({locale:'en'})}),/redirect:\/patient\/dashboard/);
assert.equal(cookieReads,beforeRedirect,'Authenticated redirect occurs before reading locale cookies');
identity=null;ready=false;
for(cookie of ['en','hy',undefined,'invalid']) {
 const closed=renderToStaticMarkup(await Page({}));
 const english=cookie==='en';
 assert.match(closed,english?/<h1[^>]*>Registration opens soon<\/h1>/:/<h1[^>]*>Գրանցումը՝ շուտով<\/h1>/);
 assert.match(closed,english?/Phone verification is being prepared\. Registration is not open yet\./:/Հեռախոսահամարի հաստատումը նախապատրաստվում է։ Գրանցումը դեռ բաց չէ։/);
 assert.match(closed,/mailto:info@noreon.health/);
 assert.match(closed,english?/Contact Noreon/:/Կապվել Noreon-ի հետ/);
 assert.doesNotMatch(closed,/Your health, in one place/);
 assert.doesNotMatch(closed,/<form/);
}
assert.equal(commands,0,'Unavailable registration never sends or verifies codes');
for(const testSwitch of [undefined,'false','TRUE','true']){
 runtimeProcess.env.NOREON_TEST_SIGNIN_ENABLED=testSwitch;
 const html=renderToStaticMarkup(await Page({}));
 assert.equal(html.includes('<form'),testSwitch==='true','Only the exact test env switch opens the form when normal delivery is unavailable');
}
assert.equal(commands,0,'Opening the test form does not itself admit a number or create a session');
console.log('Actual entry page/component SSR: cookie EN/HY/missing/invalid defaults, independent initial locale, authenticated redirect, registration gate and CAPTCHA configuration passed; auth/actions/cookies/UI shell mocked.');
