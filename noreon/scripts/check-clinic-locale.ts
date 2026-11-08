import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {isLocale,parseLocale,pick,type Locale} from '@/lib/locale';
import * as react from 'react';
import {createElement,type ComponentType} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import * as jsx from 'react/jsx-runtime';
import * as icons from 'lucide-react';

let cookie:string|undefined;
let saved:unknown[]=[];
let revalidated='';
let redirected='';
function load<T>(path:string,deps:Record<string,unknown>):T{
 const out={} as T;
 new vm.Script(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText).runInNewContext({exports:out,URL,encodeURIComponent,process:{env:{NODE_ENV:'production'}},require:(name:string)=>{assert.ok(name in deps,name);return deps[name];}});
 return out;
}
const headers={cookies:async()=>({get:()=>cookie===undefined?undefined:{value:cookie},set:(...args:unknown[])=>{saved=args;cookie=String(args[1]);}})};
const locale=load<{clinicLocale:(value?:unknown)=>Promise<Locale>}>('lib/clinic-portal/locale.ts',{'server-only':{},'next/headers':headers,'@/lib/locale':{isLocale,parseLocale}});
for(const value of [undefined,'invalid',['hy']]){
 cookie=undefined;assert.equal(await locale.clinicLocale(value),'hy','Armenian when nothing is chosen');
 cookie='ru';assert.equal(await locale.clinicLocale(value),'ru');
}
cookie='ru';assert.equal(await locale.clinicLocale('hy'),'hy');
cookie='hy';assert.equal(await locale.clinicLocale('en'),'en');
cookie='invalid';assert.equal(await locale.clinicLocale(),'hy');
const actions=load<{setClinicLocale:(form:FormData)=>Promise<void>}>('lib/clinic-portal/locale-actions.ts',{
 'next/headers':headers,'next/cache':{revalidatePath:(path:string)=>{revalidated=path;}},
 'next/navigation':{redirect:(path:string)=>{redirected=path;}},
 '@/lib/observability/with-logging':{loggedAction:(_name:string,action:unknown)=>action},
 '@/lib/locale':{parseLocale},'./locale':locale,
});
const form=new FormData();form.set('locale','hy');await actions.setClinicLocale(form);
assert.equal(saved[0],'noreon-clinic-locale');assert.equal(saved[1],'hy');
const options=saved[2] as Record<string,unknown>;
assert.equal(options.path,'/clinic');assert.equal(options.sameSite,'lax');assert.equal(options.httpOnly,true);assert.equal(options.secure,true);assert.equal(options.maxAge,60*60*24*365);
assert.equal(revalidated,'/clinic/real');
form.set('returnTo','/clinic/real/bookings?clinic=example&locale=en');await actions.setClinicLocale(form);
assert.equal(redirected,'/clinic/real/bookings?clinic=example&locale=hy');
redirected='';form.set('returnTo','https://elsewhere.invalid/');await actions.setClinicLocale(form);assert.equal(redirected,'');
const navigation=load<{ClinicLocaleSwitch:ComponentType<{clinicId:string;locale:Locale}>}>('components/clinic-portal/navigation.tsx',{
 'react/jsx-runtime':jsx,'next/navigation':{usePathname:()=>'/clinic/real/bookings'},'lucide-react':icons,
 '@/lib/locale':{pick},'@/components/app-shell/sidebar-nav':{SidebarNav:()=>null},
 '@/lib/clinic-portal/locale-actions':actions,
});
for(const value of ['en','hy','ru'] as const){
 const element=navigation.ClinicLocaleSwitch as (props:{clinicId:string;locale:Locale})=>import('react').ReactElement;
 const tree=element({clinicId:'synthetic',locale:value});
 const forms=(tree.props as {children:import('react').ReactElement[]}).children.filter(child=>child.type==='form');
 assert.equal(forms.length,3,'three native forms work without client event handlers');
 for(const entry of forms)assert.equal((entry.props as {action:unknown}).action,actions.setClinicLocale);
 const markup=renderToStaticMarkup(createElement(navigation.ClinicLocaleSwitch,{clinicId:'synthetic',locale:value}));
 assert.equal((markup.match(/aria-current="true"/g)??[]).length,1);
 assert.ok(markup.includes(`value="${value}" lang="${value}" aria-current="true"`));
 assert.ok(markup.includes('min-h-11'));
 assert.ok(markup.includes(`/clinic/real/bookings?clinic=synthetic&amp;locale=${value}`),'explicit locale URL survives native submission');
}
console.log('Clinic locale: query > cookie > en; scoped cookie action passed.');

// Pre-sign-in choices use native preference actions, including explicit English.
const signin=load<{SigninLanguageLinks:ComponentType<{path:string;locale:Locale;extra?:string}>}>('components/real-review/signin-language.tsx',{
 'react/jsx-runtime':jsx,'next/link':{default:'a'},'lucide-react':icons,
 '@/lib/staff/staff-locale-copy':{st:(value:Locale,en:string,hy:string,ru:string)=>pick(value,{en,hy,ru})},
 '@/lib/clinic-portal/locale-actions':actions,
});
for(const path of ['login','verify','recover','invite','select']){
 for(const remembered of ['ru','hy'] as const){
  const tree=(signin.SigninLanguageLinks as (props:{path:string;locale:Locale;extra?:string})=>react.ReactElement<{children:react.ReactElement[]}>)({path:`/clinic/real/${path}`,locale:remembered,extra:'invited=1&next=%2Fstaff%2Freal%2Fchat'});
  const forms=(tree.props.children as react.ReactElement[]).filter(child=>child.type==='form');
  assert.equal(forms.length,3,`${path}: native locale choices work without JavaScript`);
  for(const entry of forms){
   const props=entry.props as {action:typeof actions.setClinicLocale;children:react.ReactElement[]};
   assert.equal(props.action,actions.setClinicLocale);
   const fields=props.children.map(child=>child.props as Record<string,string>);
   const submitted=new FormData();
   for(const field of fields)submitted.set(field.name,field.value);
   cookie=remembered;await props.action(submitted);
   const chosen=String(submitted.get('locale'));
   assert.equal(cookie,chosen,`${remembered} cookie is replaced by ${chosen}`);
   const target:URL=new URL(String(redirected),'https://clinic.invalid');
   assert.equal(target.pathname,`/clinic/real/${path}`);
   assert.equal(target.searchParams.get('locale'),chosen);
   assert.equal(target.searchParams.get('invited'),'1');
   assert.equal(await locale.clinicLocale(target.searchParams.get('locale')),chosen);
   assert.equal(await locale.clinicLocale(),chosen,'query-free follow-up remembers the selection');
  }
 }
}
console.log('Clinic pre-sign-in native language selections replace hy/ru cookies, including English.');

const provider=load<typeof import('@/components/clinic-portal/locale-provider')>('components/clinic-portal/locale-provider.tsx',{
 'react':react,'react/jsx-runtime':jsx,
});
const layout=load<{default:typeof import('@/app/clinic/real/layout').default}>('app/clinic/real/layout.tsx',{
 'react/jsx-runtime':jsx,'@/lib/clinic-portal/locale':locale,
 '@/components/clinic-portal/locale-provider':provider,
});
let query=new URLSearchParams();
const boundary=load<{default:ComponentType<{reset:()=>void}>}>('app/clinic/real/error.tsx',{
 'react/jsx-runtime':jsx,'@/lib/locale':{parseLocale,pick},
 'next/navigation':{useSearchParams:()=>query},
 '@/components/clinic-portal/locale-provider':provider,
 '@/components/report-error':{ReportError:()=>null},
});
for(const remembered of ['hy','ru','en'] as const){
 for(const explicit of [undefined,'en','hy','ru','invalid']){
  cookie=remembered;query=new URLSearchParams(explicit?{locale:explicit}:{});
  const tree=await layout.default({children:createElement(boundary.default,{reset:()=>{}})});
  const markup=renderToStaticMarkup(tree),expected=parseLocale(explicit,remembered);
  assert.ok(markup.includes(`lang="${expected}"`),'layout cookie reaches the error boundary; valid query wins');
  assert.ok(markup.includes(pick(expected,{en:'Try again',hy:'Փորձել կրկին',ru:'Попробовать снова'})));
 }
}
const pageDependencies={
 'react/jsx-runtime':jsx,'@/lib/locale':{pick},'@/lib/clinic-portal/locale':locale,
 '@/components/real-review/signin-language':signin,'next/link':{default:'a'},
 'next/headers':{headers:async()=>new Headers({host:'localhost'})},
 'next/navigation':{notFound:()=>{throw Error('Unexpected not found');},redirect:()=>{throw Error('Unexpected redirect');}},
 '@/lib/clinic-portal/config':{clinicPortalEnabled:()=>true,clinicHostAllowed:()=>true},
 '@/lib/telegram-auth/staff-signin':{staffTelegramSigninEnabled:()=>true,readStaffSigninState:async()=>({clinicEligible:true,required:true,admitted:false})},
 '@/components/real-review/staff-telegram-verify':{StaffTelegramVerifyForm:()=>null},
 './actions':{sendClinicTelegramCode:()=>{},verifyClinicTelegramCode:()=>{}},
 '@/lib/telegram-auth/staff-recovery':{staffTelegramRecoveryReady:()=>true},
 '@/components/real-review/telegram-recovery-steps':{TelegramRecoverySteps:()=>null},
 '@/lib/telegram-auth/clinic-invite-config':{clinicTelegramInvitesReady:()=>true},
 '@/lib/telegram-runtime/config':{telegramBotUsername:()=>null},
 '@/components/clinic-portal/invitation-steps':{ClinicInvitationSteps:()=>null},
 '@/lib/clinic-chat/config':{clinicChatEnabled:()=>true},
 '@/lib/clinic-scheduling/schema':{clinicSchedulingEnabled:()=>true},
 '@/lib/clinic-portal/identity':{clinicAccess:async()=>({access:{status:'unavailable'}})},
};
for(const path of ['verify','recover','invite','select']){
 const page=load<{default:(props:{searchParams:Promise<Record<string,string>>})=>Promise<react.ReactElement>}>(`app/clinic/real/${path}/page.tsx`,pageDependencies);
 cookie='ru';
 const markup=renderToStaticMarkup(await page.default({searchParams:Promise.resolve({})}));
 assert.equal((markup.match(/name="locale"/g)??[]).length,3,`${path}: three native language choices are rendered`);
 assert.ok(markup.includes(`value="/clinic/real/${path}?locale=en"`));
 assert.ok(markup.includes('lang="ru"'),'page resolves the remembered preference');
}
// Staff sign-in retains its link behavior and does not write clinic preferences.
const staff=renderToStaticMarkup(createElement(signin.SigninLanguageLinks,{path:'/staff/real/login',locale:'hy'}));
assert.equal((staff.match(/<a /g)??[]).length,3);assert.ok(!staff.includes('<form'));
console.log('Clinic layout → locale context → error screen: remembered hy/ru/en and explicit overrides PASS (synthetic cookies).');
