/** Actual shared urgent views with request IO isolated. Never contacts a database or provider. */
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {tx} from '@/lib/patient/copy';
import * as hydration from '@/components/patient/use-hydrated';
import type {CareAlertZoeStatus} from '@/lib/care-alerts/member';
export function loadUrgentViews(read:()=>Promise<CareAlertZoeStatus|null>=async()=>null,navigate:(url:string)=>void=()=>{}){
 const load=(path:string,extra:(name:string)=>unknown)=>{
  const exports:Record<string,unknown>={};
  const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
  new vm.Script(code).runInNewContext({exports,setTimeout,clearTimeout,window:{location:{assign:navigate}},require(name:string){
   if(name==='react')return React;
   if(name==='react/jsx-runtime')return jsx;
   if(name==='next/link')return {default:({children,...props}:{children:React.ReactNode})=>React.createElement('a',props,children)};
   if(name==='@/lib/patient/copy')return {tx};
   if(name==='@/components/patient/use-hydrated')return hydration;
   const value=extra(name);if(value)return value;
   throw Error(`Unexpected urgent-view boundary: ${name}`);
  }});
  return exports;
 };
 const notice=load('app/patient/zoe/urgent/notice.tsx',name=>name==='./actions'?{readZoeUrgentStatus:read}:null);
 const content=load('app/patient/zoe/urgent/content.tsx',name=>name==='./notice'?notice:null);
 const card=load('components/patient/zoe-emergency-card.tsx',name=>name==='@/app/patient/zoe/urgent/content'?content:null);
 return {notice,content,card};
}
