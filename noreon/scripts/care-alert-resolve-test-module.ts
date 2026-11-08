// Controlled-IO loader shared by the existing VM surface checks.
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {Button} from '@/components/ui/button';
import * as copy from '@/lib/staff/staff-locale-copy';
import * as contracts from '@/lib/care-alerts/contracts';
import * as suggestions from '@/lib/care-alerts/resolution-suggestion';
export function resolveTestModule(read: (id:string)=>Promise<suggestions.ResolutionRecord|null>=async()=>null){
 const exports:Record<string,unknown>={};
 class TestFormData extends FormData{constructor(form?:FormData){super();form?.forEach((v,k)=>this.set(k,v));}}
 const modules:Record<string,unknown>={'@/components/ui/button':{Button},react:React,'react/jsx-runtime':jsx,'@/lib/staff/staff-locale-copy':copy,'@/lib/care-alerts/contracts':contracts,'@/lib/care-alerts/resolution-suggestion':suggestions,'@/lib/care-alerts/actions':{readCareAlertResolutionRecord:read}};
 vm.runInNewContext(ts.transpileModule(readFileSync('components/staff/care-alert-resolve.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,FormData:TestFormData,require:(name:string)=>{if(!(name in modules))throw Error(`Missing test module ${name}`);return modules[name];}});
 return exports as typeof import('@/components/staff/care-alert-resolve');
}
