import * as textLanguage from '@/lib/text-language';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import * as displayTime from '@/lib/real-booking/display-time';
import * as catalogueLabel from '@/lib/patient/catalogue-label';
import * as jsx from 'react/jsx-runtime';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import {renderToStaticMarkup} from 'react-dom/server';
import * as realLocaleModule from '@/lib/locale';
import * as recoveryContext from '@/components/real-booking/recovery-context';
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
let submit: (state:unknown, form:FormData)=>Promise<{ok:boolean;message:string}>;
const exports:Record<string,unknown>={};
const code=ts.transpileModule(readFileSync('components/real-booking/common.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
vm.runInNewContext(code,{exports,crypto,require:(name:string)=>{if(name==='@/lib/text-language')return textLanguage;
 if(name==='react/jsx-runtime')return jsx;
 if(name==='lucide-react')return {ChevronDown:()=>React.createElement('svg')};
 if(name==='react')return {...React,useActionState:(callback:typeof submit)=>{submit=callback;return [{ok:false,message:''},()=>{},false];}};
 if(name==='next/navigation')return {useRouter:()=>({refresh(){}})};
 if(name==='./recovery-context')return recoveryContext;
 if(name.endsWith('/button'))return {Button:'button'};
 if(name==='@/lib/patient/catalogue-label')return catalogueLabel;
 if(name.endsWith('/display-time'))return displayTime;
 if(name==='@/lib/locale')return realLocaleModule;throw Error(`Unexpected dependency ${name}`);
}});
const TermsFields=exports.TermsFields as React.ComponentType<Record<string,unknown>>;
const clinics=[{id:'fictional-clinic',name:'Fictional testing clinic',address:'Synthetic clinic address'}];
for(const locale of ['en','hy']){
 const html=renderToStaticMarkup(React.createElement(TermsFields,{locale,clinics}));
 assert.ok(!html.includes('<textarea'),'Clinic preferences must not ask for a Home address');
 assert.match(html,/Fictional testing clinic/,'Selected clinic is displayed');
 assert.match(html,/Synthetic clinic address/,'Clinic address is shown without manual entry');
}
let renderer!:ReactTestRenderer;
await act(async()=>{renderer=create(React.createElement(TermsFields,{locale:'en',clinics}));});
await act(async()=>renderer.root.findByProps({name:'mode'}).props.onChange({target:{value:'home'}}));
assert.equal(renderer.root.findByProps({name:'location'}).type,'textarea','Home mode asks for a Home address');
assert.equal(renderer.root.findAllByProps({name:'clinic'}).length,0,'Home mode removes clinic selection');
await act(async()=>renderer.root.findByProps({name:'location'}).props.onChange?.({target:{value:'Synthetic Home draft'}}));
await act(async()=>renderer.root.findByProps({name:'mode'}).props.onChange({target:{value:'clinic'}}));
await act(async()=>renderer.root.findByProps({name:'mode'}).props.onChange({target:{value:'home'}}));
assert.equal(renderer.root.findByProps({name:'location'}).props.value,'Synthetic Home draft','Switching preference must preserve the entered Home address');
await act(async()=>renderer.root.findByProps({name:'mode'}).props.onChange({target:{value:'office'}}));
assert.equal(renderer.root.findByProps({name:'location'}).props.value,'','Office must not reuse the Home address');
await act(async()=>renderer.root.findByProps({name:'location'}).props.onChange?.({target:{value:'Synthetic Office draft'}}));
await act(async()=>renderer.root.findByProps({name:'mode'}).props.onChange({target:{value:'home'}}));
assert.equal(renderer.root.findByProps({name:'location'}).props.value,'Synthetic Home draft');
await act(async()=>renderer.root.findByProps({name:'mode'}).props.onChange({target:{value:'clinic'}}));
await act(async()=>renderer.root.findByProps({name:'mode'}).props.onChange({target:{value:'office'}}));
assert.equal(renderer.root.findByProps({name:'location'}).props.value,'Synthetic Office draft','Clinic/Home/Office toggles preserve separate entered addresses');
await act(async()=>renderer.unmount());
console.log('Booking member location inputs passed: selected clinic and conditional Home address, EN/HY.');

const BookingForm=exports.BookingForm as React.ComponentType<Record<string,unknown>>;
let writes=0;
renderToStaticMarkup(React.createElement(BookingForm,{operation:'create',label:'Request',action:async()=>{writes++;return {ok:true,message:'Saved'};}}));
const valid=()=>{const form=new FormData();form.set('operation','create');form.set('startsAt','2099-11-02T09:00');form.set('mode','clinic');form.set('location','Fictional clinic');return form;};
const invalid=valid();invalid.set('startsAt','invalid');
const error=await submit!({},invalid);
assert.equal(writes,0,'Invalid preferred start must identify the field without calling the action');
assert.match(error.message,/valid preferred arrival start/i);
const clinicForm=valid();assert.equal((await submit!({},clinicForm)).ok,true);
assert.equal(clinicForm.get('startsAt'),'2099-11-02T05:00:00.000Z','Clinic preferences use Yerevan wall time');assert.equal(clinicForm.has('endsAt'),false,'Member submit invents no end time');
const home=valid();home.set('mode','home');home.set('location','Synthetic Home address');assert.equal((await submit!({},home)).ok,true);
assert.equal(writes,2,'Valid clinic and Home terms both reach the request action');
const office=valid();office.set('mode','office');office.set('location','Synthetic Office address');assert.equal((await submit!({},office)).ok,true);
assert.equal(office.get('mode'),'office');assert.equal(office.has('endsAt'),false);
const noOffice=valid();noOffice.set('mode','office');noOffice.set('location','');assert.match((await submit!({},noOffice)).message,/office address/i);
const noAddress=valid();noAddress.set('mode','home');noAddress.set('location','');
assert.match((await submit!({},noAddress)).message,/home address/i);
console.log('Actual BookingForm submission passed valid clinic/Home and specific invalid-start/address feedback; external action mocked.');

const seconds=valid();seconds.set('startsAt','2099-11-02T09:00:30');assert.equal((await submit!({},seconds)).ok,true);assert.equal(seconds.get('startsAt'),'2099-11-02T05:00:30.000Z','Native datetime values with seconds remain valid');

const recorded=renderToStaticMarkup(React.createElement(TermsFields,{locale:'en',clinics,terms:{mode:'clinic',location:'Recorded preference outside this directory',startsAt:'2099-11-02T05:00:00Z',endsAt:'2099-11-02T06:00:00Z'}}));assert.match(recorded,/value="Recorded preference outside this directory"/,'Editing must preserve an existing clinic preference outside today’s directory');

for(const locale of ['en','hy']){const member=renderToStaticMarkup(React.createElement(TermsFields,{locale,clinics}));assert.ok(!member.includes('name="endsAt"'));const provider=renderToStaticMarkup(React.createElement(TermsFields,{locale,actual:true}));assert.ok(provider.includes('name="endsAt"'));}

// Missing dates must reach the explicit field message instead of native focus-only validation.
for(const locale of ['en','hy','ru']){
 const html=renderToStaticMarkup(React.createElement(BookingForm,{locale,operation:'create',label:'Request',action:async()=>{writes++;return {ok:true,message:'Saved'};}}));
 assert.match(html,/noValidate=""/i);
 const before:number=writes;
 const missing=valid();missing.delete('startsAt');
 assert.match((await submit!({},missing)).message,/valid preferred arrival start/i);
 const past=valid();past.set('startsAt','2020-01-01T10:00');
 assert.match((await submit!({},past)).message,/future preferred/i);
 assert.equal(writes,before,'Missing and past preferences never call the server action');
}
renderToStaticMarkup(React.createElement(BookingForm,{operation:'cancel',label:'Cancel request',action:async()=>{writes++;return {ok:true,message:'Saved'};}}));
const cancellation=new FormData();cancellation.set('operation','cancel');
const beforeCancel=writes;assert.equal((await submit!({},cancellation)).ok,false);assert.equal(writes,beforeCancel,'Missing cancellation agreement remains refused');
cancellation.set('confirmCancel','on');assert.equal((await submit!({},cancellation)).ok,true);
console.log('Member booking forms: explicit missing/past-time errors in EN/HY/RU and retained cancellation agreement checks. Rendered components with mocked IO.');
