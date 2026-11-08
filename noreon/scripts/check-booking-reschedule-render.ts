import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as React from 'react';
import * as jsx from 'react/jsx-runtime';
import * as icons from 'lucide-react';
import {renderToStaticMarkup} from 'react-dom/server';
import {testTitle} from '@/lib/patient/catalogue-label';
import * as common from '@/components/patient-care/common';
import * as model from '@/lib/service-workflow/model';
import * as reconciliation from '@/lib/service-workflow/reconciliation';
import {armeniaDate} from '@/lib/patient-care/model';
import {BookingPreparation} from '@/components/service-workflow/booking-preparation';
import type {ServiceCommand,ServiceWorkflow} from '@/lib/service-workflow/types';
import * as realLocaleModule from '@/lib/locale';
let state:unknown[]=[];
let cursor=0;
const commands:ServiceCommand[]=[];
const effects:Array<()=>void>=[];
const focuses:string[]=[];
const scrolls:string[]=[];
const fakeState=(initial?:unknown)=>{
 const index=cursor++;
 if(!(index in state)) state[index]=typeof initial==='function'?(initial as ()=>unknown)():initial;
 return [state[index],(value:unknown)=>{state[index]=typeof value==='function'?(value as (prior:unknown)=>unknown)(state[index]):value;}];
};
const hooks={...React,useState:fakeState,useRef:(initial:unknown)=>fakeState({current:initial})[0],useEffect:(effect:()=>void,deps:unknown[])=>{
 const index=cursor++;
 const prior=state[index] as unknown[]|undefined;
 if(!prior||deps.some((value,i)=>value!==prior[i])) effects.push(effect);
 state[index]=[...deps];
}};
class FormValues {
 values:Map<string,string>;
 constructor(values:Map<string,string>) {this.values=values;}
 get(name:string){return this.values.get(name);}
}
const load=(path:string):Record<string,unknown>=>{
 const exports:Record<string,unknown>={};
 const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{exports,process,Date,Intl,FormData:FormValues,require:(name:string)=>{
  if(name==='react/jsx-runtime') return jsx;
  if(name==='react') return hooks;
  if(name==='lucide-react') return icons;
  if(name==='next/navigation') return {};
  if(name==='@/lib/patient/catalogue-label') return {testTitle};
  if(name.endsWith('/common')) return common;
  if(name.endsWith('/reconciliation')) return reconciliation;
  if(name==='@/lib/service-workflow/model') return model;
  if(name==='@/lib/patient-care/model') return {armeniaDate};
  if(name==='./booking-preparation') return {BookingPreparation};
  if(name==='./shared') return {...shared,useWorkflowCommand:()=>({run:(command:ServiceCommand)=>{commands.push(command);},pending:false,error:''})};
  if(name==='@/app/patient/service/actions'||name==='@/lib/patient/transport') return {};
  if(name==='@/lib/locale')return realLocaleModule;throw new Error(`Unexpected boundary ${name}`);
 }});
 return exports;
};
const shared=load('components/service-workflow/shared.tsx');
const ServiceBooking=load('components/service-workflow/client.tsx').ServiceBooking as (props:{workflow:ServiceWorkflow;locale:'en'|'hy'})=>React.ReactElement;
type ElementProps={children?:React.ReactNode;type?:string;checked?:boolean;onChange?:(event:{target:{checked:boolean}})=>void;disabled?:boolean;onClick?:(event:{currentTarget:{focus:()=>void}})=>void;ref?:{current:unknown};onSubmit?:(event:{preventDefault:()=>void;currentTarget:Map<string,string>})=>void};
function elements(node:React.ReactNode):React.ReactElement<ElementProps>[] {
 if(Array.isArray(node)) return node.flatMap(elements);
 if(!React.isValidElement<ElementProps>(node)) return [];
 return [node,...elements(node.props.children)];
}
const text=(node:React.ReactNode):string=>Array.isArray(node)?node.map(text).join(''):React.isValidElement<ElementProps>(node)?text(node.props.children):typeof node==='string'?node:'';
const now=new Date();
const day=armeniaDate(new Date(now.getTime()+7*86400000));
for(const locale of ['en','hy'] as const) for(const mode of ['home','clinic'] as const) {
 state=[];commands.length=0;effects.length=0;focuses.length=0;scrolls.length=0;
 const bookingTime=mode==='home'?'11:00':'14:00';
 const at=`${day}T${bookingTime}:00+04:00`;
 const workflow=model.applyServiceCommand(model.createWorkflow(['one','two'].map(id=>({id,title:id,method:'lab' as const,preparation:'',source:'demo'})),now),{type:'book',testIds:['one','two'],at,mode,address:mode==='home'?'Recorded home address':''},now);
 const original=structuredClone(workflow);
 const render=()=>{
  cursor=0;const tree=ServiceBooking({workflow,locale});
  for(const element of elements(tree)) if(element.props.ref) element.props.ref.current={focus:()=>focuses.push(text(element.props.children)),scrollIntoView:()=>scrolls.push(text(element.props.children))};
  for(const effect of effects.splice(0)) effect();
  return tree;
 };
 const button=(tree:React.ReactElement,label:string)=>{const result=elements(tree).find(e=>e.type==='button'&&text(e.props.children)===label);assert.ok(result,`Missing button ${label}`);return result;};
 const startLabel=locale==='en'?'Reschedule tests':'Փոխել հետազոտության ժամը';
 const initial=render();
 assert.equal(focuses.length,0,'Normal initial booking page must not move focus');
 const trigger={focus:()=>focuses.push('trigger')};
 button(initial,startLabel).props.onClick!({currentTarget:trigger});
 const editing=render();
 const heading=locale==='en'?'Reschedule your tests':'Փոխել հետազոտությունների ժամը';
 assert.deepEqual(focuses,[heading],'Opening reschedule focuses its heading');
 assert.deepEqual(scrolls,[heading],'Opening reschedule brings the form context into view');
 render();
 assert.deepEqual(focuses,[heading],'Ordinary editing rerenders must not steal focus');
 assert.match(renderToStaticMarkup(editing),/<h2[^>]*tabindex="-1"/,'Reschedule heading is programmatically focusable');
 const html=renderToStaticMarkup(editing);
 assert.match(html,new RegExp(`<input[^>]*name="day"[^>]*value="${day}"`),'Reschedule starts on the booked date, not today');
 assert.match(html,new RegExp(`<option[^>]*selected=""[^>]*>${bookingTime}</option>`),'Reschedule keeps the actual Armenia booking time');
 assert.match(html,new RegExp(`<option value="${mode}" selected=""`),'Reschedule keeps the booked location mode');
 if(mode==='home') assert.match(html,/<input[^>]*name="address"[^>]*value="Recorded home address"/,'Reschedule keeps the recorded home address');
 assert.equal((html.match(/type="checkbox"[^>]*checked=""/g)??[]).length,2,'Existing eligible tests stay selected');
 button(editing,locale==='en'?'Stop rescheduling':'Չեղարկել ժամի փոփոխությունը').props.onClick!({currentTarget:trigger});
 assert.doesNotMatch(renderToStaticMarkup(render()),/<form/,'Stop closes rescheduling when there are no unbooked tests');
 assert.deepEqual(focuses,[heading,'trigger'],'Stopping reschedule returns focus to its originating button');
 assert.equal(commands.length,0,'Opening/stopping reschedule must not issue a command');
 assert.deepEqual(workflow,original,'Stop preserves the saved booking');
 button(render(),startLabel).props.onClick!({currentTarget:trigger});
 const form=elements(render()).find(e=>e.type==='form');assert.ok(form);
 assert.equal(form.key,workflow.bookings[0].id,'Changing the edited booking remounts native uncontrolled fields');
 form.props.onSubmit!({preventDefault(){},currentTarget:new Map([['day',day],['time',bookingTime],['address',mode==='home'?'Recorded home address':'']])});
 assert.deepEqual(structuredClone(commands[0]),{type:'book',testIds:['one','two'],at,mode,address:mode==='home'?'Recorded home address':'',replacingId:workflow.bookings[0].id});
}
for(const locale of ['en','hy'] as const) for(const count of [1,2]) {
 state=[];cursor=0;effects.length=0;commands.length=0;
 const tests=['one','two'].map(id=>({id,title:id,method:'lab' as const,preparation:'',source:'demo'}));
 let workflow=model.applyServiceCommand(model.createWorkflow(tests,now),{type:'book',testIds:['one','two'],at:`${day}T09:00:00+04:00`,mode:'clinic',address:''},now);
 workflow=model.applyServiceCommand(workflow,{type:'receive',testIds:count===1?['one']:['one','two']},now);
 const tree=ServiceBooking({workflow,locale});const html=renderToStaticMarkup(tree);
 const buttons=elements(tree).filter(e=>e.type==='button').map(e=>text(e.props.children));
 assert.ok(!buttons.includes(locale==='en'?'Reschedule tests':'Փոխել հետազոտության ժամը'),'Received-result bookings must not offer a dead reschedule button');
 assert.ok(!buttons.includes(locale==='en'?'Cancel booking':'Չեղարկել պլանավորումը'),'Received-result bookings must not offer a dead cancel button');
 if(count===1) assert.match(html,locale==='en'?/Why can’t I change this booking\?/:/Ինչո՞ւ չի կարելի փոխել այս պլանավորումը/,'Partial receipt explanation remains available on demand');
 else assert.doesNotMatch(html,/Why can’t I change|Ինչո՞ւ չի կարելի փոխել/,'Completed status already explains why no action is required');
 assert.equal(commands.length,0,'Rendering a received booking must never issue commands');
 if(count===1) {
  workflow.bookings[0].review={reason:'Fictional changed recommendation',changedTestIds:['two']};
  cursor=0;
  const reviewed=ServiceBooking({workflow,locale});
  const cancel=elements(reviewed).find(e=>e.type==='button'&&text(e.props.children)===(locale==='en'?'Cancel booking':'Չեղարկել պլանավորումը'));
  assert.ok(cancel,'A changed recommendation retains its supported cancellation action');
  assert.equal(cancel.props.disabled,false,'Review cancellation must remain available');
 }
}
console.log('Actual reschedule handlers + native field SSR EN/HY: heading focus/scroll and Stop focus return; booked fields retained; received bookings have no dead controls. Hook/action/form-data boundaries simulated, no browser.');

for (const locale of ['en','hy'] as const) for (const reschedule of [false,true]) {
 state=[];cursor=0;effects.length=0;commands.length=0;
 const tests=[{id:'lab-one',title:'Blood count',method:'lab' as const,preparation:'',source:'demo'},{id:'lab-two',title:'Lipids',method:'lab' as const,preparation:'',source:'demo'},{id:'bp',title:'Blood pressure',method:'clinic' as const,preparation:'',source:'demo'},{id:'ecg',title:'ECG',method:'clinic' as const,preparation:'',source:'demo'}];
 let workflow=model.createWorkflow(tests,now);
 if(reschedule) workflow=model.applyServiceCommand(workflow,{type:'book',testIds:['lab-one','lab-two'],at:`${day}T09:00:00+04:00`,mode:'clinic',address:''},now);
 const original=structuredClone(workflow);
 const render=()=>{cursor=0;return ServiceBooking({workflow,locale});};
 const button=(tree:React.ReactElement,label:string)=>{const found=elements(tree).find(e=>e.type==='button'&&text(e.props.children)===label);assert.ok(found,`Missing button ${label}`);return found;};
 const checkbox=(tree:React.ReactElement,title:string)=>{const label=elements(tree).find(e=>e.type==='label'&&text(e.props.children).includes(title));assert.ok(label);const found=elements(label).find(e=>e.type==='input'&&e.props.type==='checkbox');assert.ok(found);return found;};
 const event={currentTarget:{focus(){}}};
 if(reschedule) button(render(),locale==='en'?'Reschedule tests':'Փոխել հետազոտության ժամը').props.onClick!(event);
 checkbox(render(),'Blood pressure').props.onChange!({target:{checked:true}});
 let tree=render();
 assert.equal(checkbox(tree,'Blood count').props.checked,true,'A proposed group switch retains selected labs until confirmed');
 assert.equal(checkbox(tree,'Blood pressure').props.checked,false,'New group remains unselected before confirmation');
 const dialog=elements(tree).find(e=>(e.props as {role?:string}).role==='alertdialog');assert.ok(dialog,'Exclusive selection offers visible confirmation');
 assert.ok(text(dialog).includes('Blood count')&&text(dialog).includes('Lipids'),'Confirmation names every excluded test');
 button(tree,locale==='en'?'Keep current selection':'Պահպանել ընթացիկ ընտրությունը').props.onClick!(event);
 tree=render();assert.equal(checkbox(tree,'Blood count').props.checked,true,'Cancelling retains selection');
 checkbox(tree,'Blood pressure').props.onChange!({target:{checked:true}});
 button(render(),locale==='en'?'Switch tests':'Փոխել հետազոտությունների ընտրությունը').props.onClick!(event);
 tree=render();assert.equal(checkbox(tree,'Blood count').props.checked,false);assert.equal(checkbox(tree,'Blood pressure').props.checked,true);

 checkbox(tree,'ECG').props.onChange!({target:{checked:true}});
 let other=render();
 assert.equal(checkbox(other,'Blood pressure').props.checked,true,'Changing between clinic measurements also waits for confirmation');
 assert.ok(text(elements(other).find(e=>(e.props as {role?:string}).role==='alertdialog')).includes('Blood pressure'));
 button(other,locale==='en'?'Keep current selection':'Պահպանել ընթացիկ ընտրությունը').props.onClick!(event);
 checkbox(render(),'Blood count').props.onChange!({target:{checked:true}});
 other=render();assert.equal(checkbox(other,'Blood pressure').props.checked,true,'Reverse clinic to lab switch retains the current test');
 button(other,locale==='en'?'Keep current selection':'Պահպանել ընթացիկ ընտրությունը').props.onClick!(event);
 tree=render();
 assert.equal(commands.length,0,'Group switch confirmation does not write a booking');
 assert.deepEqual(workflow,original,'Selection cannot mutate saved bookings');
 const summary=elements(tree).find(e=>(e.props as {'data-still-to-schedule'?:boolean})['data-still-to-schedule']);assert.ok(summary,'Outstanding tests remain visible while switching');
 assert.ok(text(summary).includes('Blood count')&&text(summary).includes('ECG'),'Unselected tests remain in Still to schedule');
 const form=elements(tree).find(e=>e.type==='form');assert.ok(form);
 form.props.onSubmit!({preventDefault(){},currentTarget:new Map([['day',day],['time','09:00'],['address','']])});
 assert.equal(commands[0].type,'book');
 if(commands[0].type !== 'book') throw new Error('Expected explicit booking submit');
 assert.deepEqual(structuredClone(commands[0]).testIds,['bp'],'Only explicit submit sends the confirmed selection');
 workflow=model.applyServiceCommand(workflow,commands[0],now);
 const after=elements(render()).find(e=>(e.props as {'data-still-to-schedule'?:boolean})['data-still-to-schedule']);assert.ok(after);
 assert.ok(text(after).includes('Blood count')&&text(after).includes('Lipids')&&text(after).includes('ECG'),'New and replacement bookings leave unscheduled tests visible');
 assert.ok(!text(after).includes('Blood pressure'),'Saved selected test leaves Still to schedule');
}
console.log('Group switches require named confirmation, Cancel preserves selection, and new/reschedule submit retains Still to schedule, EN/HY.');
