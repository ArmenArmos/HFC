import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import {NextRequest,NextResponse} from 'next/server';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {st} from '@/lib/staff/staff-locale-copy';
import * as locale from '@/lib/locale';
import * as requestId from '@/lib/observability/request-id';

// Exercise the actual proxy and server locale reader without auth, providers or data access.
const require=createRequire(import.meta.url);
let forwarded=new Headers(),cookie='en';
function load(path:string):Record<string,unknown>{
 const exports:Record<string,unknown>={};
 const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 vm.runInNewContext(code,{exports,URL,performance,process:{env:{}},require(name:string){
  if(name==='server-only')return {};
  if(name==='next/navigation')return {usePathname:()=>'/staff/real/doctor-workspace'};
  if(name==='next/link')return {default:(props:React.AnchorHTMLAttributes<HTMLAnchorElement>)=>React.createElement('a',props)};
  if(name==='@/lib/staff/staff-locale-copy')return {st};
  if(name==='next/headers')return {headers:async()=>forwarded,cookies:async()=>({get:()=>({value:cookie})})};
  if(name==='@/lib/locale')return locale;
  if(name==='@/lib/staff/hosts')return load('lib/staff/hosts.ts');
  if(name==='@/lib/observability/request-id')return requestId;
  if(name==='@/lib/observability/request-meta')return {clientIpPrefix:()=>null,cookieActor:()=>null,country:()=>null,uaFamily:()=>null};
  if(name==='@/lib/observability/logger')return {log:{info(){}}};
  if(name==='@/lib/staff/session')return {updateStaffSession:(request:NextRequest)=>{forwarded=request.headers;return NextResponse.next({request});}};
  if(name==='@/lib/clinic-portal/session')return {};
  if(name==='@/lib/supabase/session')return {};
  if(name==='@/lib/patient-care/real-review-config')return {realReviewEnabled:()=>true};
  if(name==='@/lib/clinic-portal/config')return {clinicPortalEnabled:()=>false};
  if(name==='@/lib/backoffice/session')return {};
  if(name==='@/components/staff/chat-menu-items')return {ChatShellMenu:({children}:{children:React.ReactNode})=>React.createElement('details',null,children)};
  if(name.startsWith('@/'))return {};
  return require(name);
 }});
 return exports;
}
const proxy=load('proxy.ts').proxy as (request:NextRequest)=>Promise<Response>;
const staffLocale=load('lib/staff/staff-locale.ts').staffLocale as (role:string)=>Promise<string>;
const Shell=load('components/staff/doctor-workspace/chat-shell.tsx').DoctorChatShell as React.ComponentType<{locale:locale.Locale;children?:React.ReactNode;fallback:React.ReactNode;nav:React.ReactNode;actions:React.ReactNode}>;
for(const value of ['en','hy','ru'] as const){
 cookie=value==='en'?'hy':'en';
 const response=await proxy(new NextRequest(`https://doctors.noreon.health/staff/real/doctor-workspace?locale=${value}`));
 assert.equal(await staffLocale('doctor'),value,'The URL language overrides a different cookie for the whole render');
 assert.equal(await staffLocale('nurse'),value);
 const html=renderToStaticMarkup(React.createElement(Shell,{locale:await staffLocale('doctor') as locale.Locale,fallback:null,nav:null,actions:null},null));
 assert.ok(html.includes(({en:'Menu',hy:'Ընտրացանկ',ru:'Меню'})[value]),'The actual doctor Menu uses the URL language');
 assert.equal(await staffLocale('admin'),'en','Admin language behavior is unchanged');
 assert.equal(response.headers.get('x-middleware-request-x-noreon-staff-locale'),value,'The locale reaches server layouts and pages');
}
for(const suffix of ['', '?locale=invalid']){
 cookie='ru';
 await proxy(new NextRequest(`https://doctors.noreon.health/staff/real/doctor-workspace${suffix}`,{headers:{'x-noreon-staff-locale':'hy'}}));
 assert.equal(await staffLocale('doctor'),'ru','Missing/invalid URL language uses the cookie and ignores a supplied header');
}
console.log('Staff URL locale: en/hy/ru overrides cookies for pages and layouts; invalid/absent query falls back; admin stays English (controlled session).');
