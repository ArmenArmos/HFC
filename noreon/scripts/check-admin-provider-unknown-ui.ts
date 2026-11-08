/** Exercise the shared provider form, not a substitute for its copy/lock behavior. */
import * as textLanguage from '@/lib/text-language';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {act,create} from 'react-test-renderer';
import * as locale from '@/lib/locale';
import * as display from '@/lib/real-booking/display-time';
import * as recovery from '@/components/real-booking/recovery-context';
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
let reloads=0;
const require=createRequire(import.meta.url),out:Record<string,unknown>={};
const deps:Record<string,unknown>={react:React,'react/jsx-runtime':jsx,'lucide-react':require('lucide-react'),'next/navigation':{useRouter:()=>({refresh(){throw Error('Unexpected page navigation');}})},'@/components/ui/button':{Button:(props:React.ComponentProps<'button'>)=>React.createElement('button',props)},'./recovery-context':recovery,'@/lib/real-booking/display-time':display,'@/lib/patient/catalogue-label':{},'@/lib/locale':locale,'@/lib/text-language':textLanguage};
new vm.Script(ts.transpileModule(readFileSync('components/real-booking/common.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText).runInNewContext({exports:out,crypto,window:{location:{reload(){reloads++;}}},require:(name:string)=>{assert.ok(name in deps,name);return deps[name];}});
const Form=out.BookingForm as typeof import('../components/real-booking/common').BookingForm;
for(const l of ['en','hy','ru'] as const){
 let writes=0,refreshes=0;
 let tree!:ReturnType<typeof create>;
 await act(async()=>{tree=create(React.createElement(recovery.BookingRefreshContext,{value:()=>{refreshes++;}},React.createElement(Form,{locale:l,operation:'confirm',label:'Record terms',action:async()=>{writes++;return {ok:false,code:'failed' as const,outcomeUnknown:true,message:'The result is unknown. Check current details before another action.'};}})));});
 await act(async()=>{React.startTransition(()=>tree.root.findByType('form').props.action(new FormData()));});
 const text=JSON.stringify(tree.toJSON());
 assert.ok(text.includes(l==='en'?'The result is unknown':l==='hy'?'Արդյունքն անհայտ է':'Результат неизвестен'),'A lost provider response remains unknown in every locale');
 assert.equal(tree.root.findByType('fieldset').props.disabled,true,'Unknown form is locked');
 await act(async()=>tree.root.findAllByType('button').at(-1)!.props.onClick());
 assert.equal(refreshes,1,'Recovery reads in chat');assert.equal(writes,1,'Recovery does not resend');
 await act(async()=>tree.unmount());
}
// An ordinary page must remount even when its saved request revision is unchanged.
let ordinary!:ReturnType<typeof create>;
let ordinaryWrites=0;
await act(async()=>{ordinary=create(React.createElement(Form,{locale:'en',operation:'confirm',label:'Record terms',action:async()=>{ordinaryWrites++;return {ok:false,code:'failed' as const,outcomeUnknown:true,message:'Unknown'};}}));});
await act(async()=>{React.startTransition(()=>ordinary.root.findByType('form').props.action(new FormData()));});
assert.equal(reloads,0,'Unknown recovery waits for an explicit request');
await act(async()=>ordinary.root.findAllByType('button').at(-1)!.props.onClick());
assert.equal(reloads,1,'Ordinary unknown recovery reloads the document so unchanged record keys cannot retain a locked action state');
assert.equal(ordinaryWrites,1,'Ordinary recovery never resends the operation');
await act(async()=>ordinary.unmount());
console.log('Shared provider form: EN/HY/RU unknown result, locked controls and read-only chat recovery passed (mocked action).');
