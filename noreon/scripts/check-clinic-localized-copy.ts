import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as react from 'react';
import * as jsx from 'react/jsx-runtime';
import * as lucide from 'lucide-react';
import {act,create,type ReactTestRenderer,type ReactTestInstance} from 'react-test-renderer';
import {renderToStaticMarkup} from 'react-dom/server';
import {type AppRouterInstance} from 'next/dist/shared/lib/app-router-context.shared-runtime';
import * as localeModule from '@/lib/locale';
import * as displayTime from '@/lib/clinic-portal/display-time';
import * as attachSchema from '@/lib/clinic-portal/result-attach-schema';
import type {ResultAttachPage,ResultAttachResult,ResultDetachResult} from '@/lib/clinic-portal/result-attach-schema';
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
const load=(path:string,dependencies:Record<string,unknown>)=>{
 const exports:Record<string,unknown>={};
 new vm.Script(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText).runInNewContext({exports,crypto:globalThis.crypto,require:(name:string)=>{assert.ok(name in dependencies,`${path}: missing mock ${name}`);return dependencies[name];}});
 return exports;
};
const router={refresh(){}} as AppRouterInstance;
let selectProps:Record<string,unknown>={};
const ResultAttach=load('components/clinic-portal/result-attach.tsx',{
 'react':react,'react/jsx-runtime':jsx,'next/navigation':{useRouter:()=>router},'lucide-react':lucide,
 '@/lib/clinic-portal/display-time':displayTime,'@/lib/clinic-portal/result-attach-schema':attachSchema,
 '@/components/ui/select-field':{SelectField:(props:Record<string,unknown>)=>{selectProps=props;return react.createElement('div',null);}},
}).ResultAttach as typeof import('@/components/clinic-portal/result-attach').ResultAttach;
const label=(node:ReactTestInstance):string=>node.children.map(child=>typeof child==='string'?child:label(child)).join('');
const noEnglish=(text:string)=>assert.doesNotMatch(text.replace(/\b(?:Noreon|Telegram|PDF|UTC)\b/g,''),/[A-Za-z]{2}/,text);
const data:ResultAttachPage={version:'clinic-result-attach-v1',clinic:{id:'clinic',name:'Կլինիկա'},files:[{id:'file',name:'Ֆայլ',batchName:'Փաթեթ',uploadedAt:'2026-11-06T20:05:00Z',attachment:{id:'attachment',memberId:'member',memberName:null,visitId:'visit',visitedAt:'2026-11-06T08:00:00Z',attachedAt:'2026-11-06T09:00:00Z'}}],visits:[{visitId:'visit',memberId:'member',memberName:null,visitedAt:'2026-11-06T08:00:00Z',reference:'12345678',ambiguous:true,atLab:1,collectedOnly:2}]};
for(const locale of ['hy','ru'] as const){
 let attachResult:ResultAttachResult={status:'access'},detachResult:ResultDetachResult={status:'access'},tree!:ReactTestRenderer;
 const props={locale,data,submissionIds:{file:'submission'},detachIds:{file:'detach'},attach:async()=>attachResult,detach:async()=>detachResult};
 await act(async()=>{tree=create(react.createElement(ResultAttach,props));});
 assert.ok(label(tree.root).includes(locale==='hy'?'Հանել այս ֆայլի կցումը':'Открепить этот файл'));
 noEnglish(label(tree.root));
 assert.ok(label(tree.root).includes(displayTime.clinicTimestamp(data.files[0].uploadedAt,locale)),'Upload time uses the clinic Yerevan helper');
 noEnglish(String(selectProps.searchPlaceholder));
 assert.equal(selectProps.emptyText,locale==='hy'?'Համընկնումներ չկան':'Нет совпадений');
 for(const option of selectProps.options as {label:string;description?:string}[])noEnglish(option.label+(option.description??''));
 const submit=async()=>act(async()=>tree.root.findAllByType('form')[0].props.onSubmit({preventDefault(){}}));
 await submit();assert.ok(label(tree.root).includes(locale==='hy'?'Ընտրեք անդամի այցը։':'Выберите приём участника.'));noEnglish(label(tree.root));
 await act(async()=>{(selectProps.onValueChange as (value:string)=>void)('visit');});
 // Choose a different current attachment so the submit button remains available.
 for(const status of ['invalid','stale','access','disabled','unavailable','outcome-unknown'] as const){attachResult={status};await submit();noEnglish(label(tree.root));assert.ok(tree.root.findByProps({role:'alert'}));}
 attachResult={status:'saved',attachmentId:'attachment',corrected:true,moved:2,retracted:2,waitingForLab:1,atLabAfterUpload:1,alreadyReceived:1};await submit();noEnglish(label(tree.root));assert.ok(tree.root.findByProps({role:'status'}));
 await act(async()=>tree.root.findByType('textarea').props.onChange({target:{value:'Պատճառ'}}));
 for(const status of ['invalid','stale','access','disabled','unavailable','outcome-unknown'] as const){detachResult={status};await act(async()=>tree.root.findAllByType('form')[1].props.onSubmit({preventDefault(){}}));noEnglish(label(tree.root));}
 for(const retracted of [0,2]){detachResult={status:'saved',replayed:false,retracted};await act(async()=>tree.root.findByType('textarea').props.onChange({target:{value:'Պատճառ'}}));await act(async()=>tree.root.findAllByType('form')[1].props.onSubmit({preventDefault(){}}));noEnglish(label(tree.root));assert.ok(tree.root.findByProps({role:'status'}));}
 await act(async()=>tree.update(react.createElement(ResultAttach,{...props,data:{...data,files:[]}})));noEnglish(label(tree.root));assert.ok(label(tree.root).includes(locale==='hy'?'պահված ֆայլեր չկան':'нет сохранённых файлов'));
 await act(async()=>tree.update(react.createElement(ResultAttach,{...props,data:{...data,files:[{...data.files[0],attachment:null}],visits:[]}})));noEnglish(label(tree.root));
 await act(async()=>tree.unmount());
}
console.log('Clinic localized attachment copy PASS: mounted HY/RU labels, visit options, Yerevan dates, empty states, every attach/detach outcome and counted receipts; mocked actions and select control.');

// Framework fallback screens: exercise the actual exports with explicit language input.
for(const locale of ['hy','ru'] as const){
 const ErrorPage=load('app/clinic/real/error.tsx',{'react/jsx-runtime':jsx,'next/navigation':{useSearchParams:()=>new URLSearchParams({locale})},'@/lib/locale':localeModule,'@/components/report-error':{ReportError:()=>null},'@/components/clinic-portal/locale-provider':{useClinicLocale:()=>'en'}}).default as typeof import('@/app/clinic/real/error').default;
 let resets=0,tree!:ReactTestRenderer;
 await act(async()=>{tree=create(react.createElement(ErrorPage,{reset:()=>{resets++;}}));});
 noEnglish(label(tree.root));assert.ok(label(tree.root).includes(locale==='hy'?'Կլինիկայի հասանելիությունն անհասանելի է':'Клиника временно недоступна'));
 await act(async()=>tree.root.findByType('button').props.onClick());assert.equal(resets,1);await act(async()=>tree.unmount());
 const SelectPage=load('app/clinic/real/select/page.tsx',{'react/jsx-runtime':jsx,'@/lib/locale':localeModule,'@/lib/clinic-portal/locale':{clinicLocale:async()=>locale},'next/link':{default:({children,...props}:react.ComponentProps<'a'>)=>react.createElement('a',props,children)},'next/navigation':{redirect:()=>{throw Error('Unexpected redirect');}},'@/components/real-review/signin-language':{SigninLanguageLinks:()=>null},'@/lib/clinic-chat/config':{clinicChatEnabled:()=>true},'@/lib/clinic-scheduling/schema':{clinicSchedulingEnabled:()=>true},'@/lib/clinic-portal/identity':{clinicAccess:async()=>({access:{status:'unavailable'}}),clinicTelegramStepDue:async()=>false}}).default as typeof import('@/app/clinic/real/select/page').default;
 const html=renderToStaticMarkup(await SelectPage({searchParams:Promise.resolve({locale})}));
 noEnglish(html.replace(/<script[\s\S]*?<\/script>/g,'').replace(/<[^>]*>/g,''));assert.ok(html.includes(locale==='hy'?'Ընտրեք կլինիկան':'Выберите вашу клинику'));
}

for(const locale of ['hy','ru'] as const){
 const Controls=load('components/real-review/staff-telegram-forms.tsx',{'react':react,'react/jsx-runtime':jsx,'@/lib/locale':localeModule,'@/lib/staff/real-telegram-actions':{issueStaffTelegramLink:async()=>({ok:false,message:''}),revokeStaffTelegram:async()=>({ok:false,message:''}),sendStaffTelegramRecovery:async()=>({ok:false,message:''})}}).StaffTelegramControls as typeof import('@/components/real-review/staff-telegram-forms').StaffTelegramControls;
 const html=renderToStaticMarkup(react.createElement(Controls,{staffId:'id',name:'Անուն',recovery:'clinic',locale}));
 noEnglish(html.replace(/<script[\s\S]*?<\/script>/g,'').replace(/<[^>]*>/g,''));
 for(const match of html.matchAll(/aria-label="([^"]*)"/g))noEnglish(match[1]);
 assert.equal((html.match(/name="locale"/g)??[]).length,3,'Each action receives the parent language');
}

for(const locale of ['hy','ru'] as const){
 let loaded=true;
 const Page=load('app/staff/real/(review)/clinics/[id]/results/page.tsx',{
  'react/jsx-runtime':jsx,'@/lib/locale':localeModule,'zod':await import('zod'),
  'next/navigation':{notFound(){throw Error('Unexpected missing page');}},
  '@/lib/staff/real-admin':{requireRealAdmin:async()=>({client:{}})},
  '@/lib/clinic-portal/result-attach-runtime':{readResultAttachPage:async()=>loaded?{status:'loaded',data}:{status:'unavailable'}},
  '@/lib/clinic-portal/result-attach-actions':{attachClinicResult:async()=>({status:'access'}),detachClinicResult:async()=>({status:'access'})},
  '@/lib/clinic-portal/result-attach-schema':{resultAttachEnabled:()=>true},
  '@/components/clinic-portal/result-attach':{ResultAttach:(props:Record<string,unknown>)=>{assert.equal(props.locale,locale);return null;}},
 }).default as typeof import('@/app/staff/real/(review)/clinics/[id]/results/page').default;
 for(const value of [true,false]){loaded=value;const html=renderToStaticMarkup(await Page({params:Promise.resolve({id:'00000000-0000-4000-8000-000000000001'}),searchParams:Promise.resolve({locale})}));noEnglish(html.replace(/<[^>]*>/g,''));}
}

{
 const layout=load('app/clinic/real/layout.tsx',{'react/jsx-runtime':jsx,'@/lib/clinic-portal/locale':{clinicLocale:async()=>'hy'},'@/components/clinic-portal/locale-provider':{ClinicLocaleProvider:({children}:{children:react.ReactNode})=>children}}) as {metadata:import('next').Metadata;default:(props:{children:react.ReactNode})=>Promise<react.ReactNode>};
 assert.equal((layout.metadata.title as {absolute:string}).absolute,'Noreon');assert.equal(layout.metadata.description,null,'Do not inherit English marketing copy');
 assert.equal(renderToStaticMarkup(await layout.default({children:react.createElement('p',null,'Բովանդակություն')})),'<p>Բովանդակություն</p>');
}

// Run real Telegram action branches against synthetic ports, including unknown outcomes.
{
 const zod=await import('zod'),time=await import('@/lib/staff/yerevan-time');
 let response:unknown={ok:false,code:'has_binding',since:'2026-11-06T22:00:00Z',connectedBy:'Ադմին'},rpcError:unknown=null,recovery:{ok:boolean;reason?:string}={ok:false,reason:'unavailable'};
 const actions=load('lib/staff/real-telegram-actions.ts',{
  '@/lib/locale':localeModule,'@/lib/staff/yerevan-time':time,'zod':zod,
  '@/lib/observability/with-logging':{loggedAction:(_name:string,action:unknown)=>action},
  './real-admin':{requireRealAdmin:async()=>({identity:{id:'00000000-0000-4000-8000-000000000001'},client:{rpc:async()=>({data:response,error:rpcError})}})},
  '@/lib/telegram-runtime/config':{telegramBotUsername:()=>'synthetic_bot'},
  '@/lib/telegram-auth/staff-signin':{staffTelegramEnrolmentEnabled:()=>true},
  '@/lib/telegram-auth/staff-recovery':{staffTelegramRecoveryReady:()=>true,issueStaffRecovery:async()=>recovery},
  '@/lib/telegram-auth/clinic-invite-config':{clinicInviteOrigin:()=> 'https://synthetic.invalid'},
  '@/lib/messaging/brevo-email':{doctorInvitationOrigin:()=> 'https://synthetic.invalid'},
  'next/headers':{headers:async()=>new Headers()},
 }) as typeof import('@/lib/staff/real-telegram-actions');
 for(const locale of ['hy','ru'] as const){
  const form=new FormData();form.set('locale',locale);form.set('staffId','00000000-0000-4000-8000-000000000002');form.set('phone','+37499123456');form.set('portal','clinic');form.set('confirmed','true');
  const idle={ok:false,message:''};
  for(const code of ['has_binding','rate_limited','self','admin_target','unavailable']){
   response={ok:false,code,since:'2026-11-06T22:00:00Z',connectedBy:'Ադմին'};
   const result=await actions.issueStaffTelegramLink(idle,form);noEnglish(result.message);assert.ok(result.message);
   if(code==='has_binding'){assert.equal(result.needsReplace,true);assert.ok(result.message.includes(time.calendarDate('2026-11-07',locale)),'Connection date is in Yerevan');}
  }
  response={ok:true,token:'a'.repeat(32),expiresAt:'2026-11-10T00:00:00Z'};const issued=await actions.issueStaffTelegramLink(idle,form);assert.equal(issued.ok,true);assert.ok(issued.url);noEnglish(issued.message);
  for(const fail of [true,false]){rpcError=fail?{code:'synthetic'}:null;response={ok:true};const revoked=await actions.revokeStaffTelegram(idle,form);assert.equal(revoked.ok,!fail);noEnglish(revoked.message);}rpcError=null;
  for(const reason of ['not_enrolled','self','admin_target','recent_binding','rate_limited','not_found','unavailable']){recovery={ok:false,reason};const result=await actions.sendStaffTelegramRecovery(idle,form);assert.equal(result.ok,false);noEnglish(result.message);}
  recovery={ok:true};assert.equal((await actions.sendStaffTelegramRecovery(idle,form)).ok,true);noEnglish((await actions.sendStaffTelegramRecovery(idle,form)).message);
 }
}
console.log('Clinic localized fallback, Telegram controls/actions, attachment parent and metadata PASS: real renders/exports with synthetic IO.');
