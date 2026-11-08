import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import * as icons from 'lucide-react';
import {act,create,type ReactTestRenderer,type ReactTestInstance} from 'react-test-renderer';
import {tx as localeText} from '@/lib/patient/copy';
// These checks render Armenian and English only; Russian is covered by the type checker and check:ru.
const tx=(l:'en'|'hy',hy:string,en:string)=>localeText(l,hy,en,'');
import * as values from '@/components/patient/bp-entry-values';
import * as measuredAt from '@/lib/patient/measured-at';
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;

// 1. Value state, with no rendering.
const {readBp,stepBp,thumbBp,typedBp,clampBp,checkBp,bpSummary,bpValueText,BP_FIELDS}=values;
assert.deepEqual(readBp('systolic',''),{state:'unset'},'Empty is not set, never zero or the middle');
assert.deepEqual(readBp('systolic','128'),{state:'set',value:128});
for(const [field,low,high] of [['systolic',60,260],['diastolic',30,160],['pulse',30,220]] as const){
 assert.equal(BP_FIELDS[field].min,low);assert.equal(BP_FIELDS[field].max,high);
 assert.equal(readBp(field,String(low)).state,'set');assert.equal(readBp(field,String(high)).state,'set');
 assert.equal(readBp(field,String(low-1)).state,'invalid',`${field} below range is invalid, not clamped`);
 assert.equal(readBp(field,String(high+1)).state,'invalid',`${field} above range is invalid, not clamped`);
 assert.equal(stepBp(field,String(low),-1),String(low),`${field} − clamps at the bottom`);
 assert.equal(stepBp(field,String(high),1),String(high),`${field} + clamps at the top`);
 assert.equal(clampBp(field,-5),low);assert.equal(clampBp(field,9999),high);
 const mid=BP_FIELDS[field].mid;assert.ok(mid>low&&mid<high);
 assert.equal(thumbBp(field,''),mid,'An unset thumb rests in the middle');
 assert.equal(stepBp(field,'',1),String(mid+1),'The first + from unset is visible and starts from the resting thumb');
 assert.equal(stepBp(field,'',-1),String(mid-1));
}
assert.equal(stepBp('systolic','300',-1),'260','− from an out-of-range typed value comes back into range');
assert.equal(stepBp('diastolic','12',1),'30');
for(const [raw,clean] of [['12a8','128'],['1288','128'],['12.5','125'],[' 82 ','82'],['','']]) assert.equal(typedBp(raw),clean,`keypad text ${raw}`);
// F3: a filled box whose text was not selected on focus still takes a new reading.
assert.equal(typedBp('1291','129',true),'1','The first key after focusing a full box starts a new number (caret at the end)');
assert.equal(typedBp('5129','129',true),'5','… or at the start');assert.equal(typedBp('1729','129',true),'7','… or in the middle');
assert.equal(typedBp('1285','128'),'128','A double tap on the last key while typing does not wipe the number');
// F2: digits on the way to a valid number are not errors.
for(const [field,raw] of [['systolic','1'],['systolic','12'],['systolic','2'],['systolic','26'],['diastolic','8'],['diastolic','1'],['pulse','7'],['pulse','2']] as const) assert.equal(readBp(field,raw).state,'partial',`${field} ${raw} is still being typed`);
for(const [field,raw] of [['systolic','30'],['systolic','27'],['systolic','500'],['systolic','0'],['diastolic','17'],['diastolic','2'],['pulse','23'],['pulse','300']] as const) assert.equal(readBp(field,raw).state,'invalid',`${field} ${raw} can no longer fit`);
assert.deepEqual(checkBp({systolic:'12',diastolic:'82',pulse:''}),{ok:false,problem:'typing-systolic'},'A half-typed number blocks Save');
assert.deepEqual(checkBp({systolic:'128',diastolic:'82',pulse:'7'}),{ok:false,problem:'typing-pulse'},'A half-typed optional pulse blocks Save rather than being dropped');
assert.equal(thumbBp('systolic','12'),BP_FIELDS.systolic.mid,'A half-typed number leaves the thumb resting');
assert.deepEqual(checkBp({systolic:'',diastolic:'',pulse:''}),{ok:false,problem:'need-both'},'Nothing set: Save stays off');
assert.deepEqual(checkBp({systolic:'128',diastolic:'',pulse:'71'}),{ok:false,problem:'need-both'});
assert.deepEqual(checkBp({systolic:'80',diastolic:'80',pulse:''}),{ok:false,problem:'order'},'Upper must be greater than lower');
assert.deepEqual(checkBp({systolic:'80',diastolic:'90',pulse:''}),{ok:false,problem:'order'});
assert.deepEqual(checkBp({systolic:'128',diastolic:'82',pulse:''}),{ok:true,systolic:128,diastolic:82},'Pulse is optional and absent when unset');
assert.deepEqual(checkBp({systolic:'128',diastolic:'82',pulse:'71'}),{ok:true,systolic:128,diastolic:82,pulse:71});
assert.deepEqual(checkBp({systolic:'128',diastolic:'82',pulse:'300'}),{ok:false,problem:'range-pulse'},'A typed pulse out of range blocks Save');
assert.deepEqual(checkBp({systolic:'280',diastolic:'82',pulse:''}),{ok:false,problem:'range-systolic'});
assert.equal(bpSummary('en',{systolic:'128',diastolic:'82',pulse:'71'}),'128 / 82 mmHg · pulse 71');
assert.equal(bpSummary('en',{systolic:'128',diastolic:'82',pulse:''}),'128 / 82 mmHg');
assert.equal(bpSummary('hy',{systolic:'128',diastolic:'82',pulse:'71'}),'128 / 82 mmHg · զարկերակ 71');
assert.equal(bpValueText('en','systolic','128'),'128 millimetres of mercury');
assert.equal(bpValueText('en','pulse','71'),'71 beats per minute');
assert.equal(bpValueText('en','diastolic',''),'Not set');
for(const locale of ['en','hy'] as const) for(const v of [{systolic:'',diastolic:'',pulse:''},{systolic:'80',diastolic:'90',pulse:''},{systolic:'500',diastolic:'',pulse:''}])
 assert.doesNotMatch(bpSummary(locale,v),/—/,'Summary copy has no em dash (voice guide)');

// 2. The real form and row components, with Base UI's slider, the server action and the router isolated.
const writes:Array<Record<string,unknown>>=[];const routes:string[]=[];let result:unknown={ok:false};
const sliders:Record<string,{onValueChange:(v:number)=>void;onValueCommitted:(v:number)=>void;onPointerDown:(e:unknown)=>void;value:number}>={};
let sliderField='';
const sliderMock={
 Slider:(props:Record<string,unknown>&{children?:React.ReactNode})=>{sliders[sliderField]=props as never;return React.createElement('div',{'data-slider':sliderField},props.children);},
 SliderControl:({children}:{children?:React.ReactNode})=>React.createElement(React.Fragment,null,children),
 SliderTrack:({children}:{children?:React.ReactNode})=>React.createElement(React.Fragment,null,children),
 SliderIndicator:()=>React.createElement('i',{'data-indicator':true}),
 SliderThumb:(props:{getAriaValueText:()=>string;'data-bp-thumb':string;'aria-label':string})=>React.createElement('input',{type:'range','data-thumb':props['data-bp-thumb'],'aria-label':props['aria-label'],'aria-valuetext':props.getAriaValueText()}),
};
const load=(file:string,extra:Record<string,unknown>)=>{
 const exports:Record<string,unknown>={};
 const code=ts.transpileModule(readFileSync(`components/patient/${file}.tsx`,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{exports,crypto:globalThis.crypto,Date,setTimeout,clearTimeout,document:{getElementById:()=>({focus(){}})},require:(name:string)=>{
  if(name in extra)return extra[name];
  if(name==='react')return React;if(name==='react/jsx-runtime')return jsx;if(name==='lucide-react')return icons;
  if(name==='./bp-entry-values')return values;
  if(name.endsWith('/copy'))return {tx};
  if(name.endsWith('/measured-at'))return measuredAt;
  if(name.endsWith('/utils'))return {cn:(...c:unknown[])=>c.filter(Boolean).join(' ')};
  throw Error(`Unexpected measurement boundary ${name}`);
 }});
 return exports;
};
const row=load('bp-value-row',{'@/components/ui/slider':sliderMock});
const RealRow=row.BpValueRow as React.ComponentType<{field:string}>;
const Row=(props:{field:string})=>{sliderField=props.field;return React.createElement(RealRow,props);};
const form=load('measurement-form',{
 './bp-value-row':{BpValueRow:Row},
 './bp-safety-notice':{BpSafetyNotice:()=>null},
 '@/lib/clinical/rules/bp-check':{bpNeedsAction:(s?:string)=>!!s&&s!=='routine'},
 '@/lib/clinical/rules/bp-words':{bpSavedLine:()=>'rest and repeat'},
 './sign-in-ended':{SignInEnded:()=>null},
 './tab-draft':{readDraft:()=>null,keepDraft:()=>{}},
 'next/navigation':{useRouter:()=>({replace:(route:string)=>routes.push(route),refresh(){}})},
 '@/app/patient/actions':{recordMeasurement:async(input:Record<string,unknown>)=>{writes.push(input);return result;}},
 '@/lib/patient/transport':{safeRequest:async(fn:()=>Promise<unknown>)=>fn(),lockUnavailableMessage:()=> 'Locks unavailable'},
 '@/components/ui/button':{Button:({children,...props}:React.ComponentProps<'button'>)=>React.createElement('button',props,children)},
 '@/components/ui/label':{Label:({children,...props}:React.ComponentProps<'label'>)=>React.createElement('label',props,children)},
 '@/components/ui/input':{Input:({onValueChange,...props}:React.ComponentProps<'input'>&{onValueChange?:(value:string)=>void})=>React.createElement('input',{...props,...(onValueChange?{onChange:(event:{target:{value:string}})=>onValueChange(event.target.value)}:{})})},
});
const Form=form.MeasurementForm as React.ComponentType<Record<string,unknown>>;
// BP-04: an unedited time is the moment of saving, so a repeat six minutes later is six minutes later; a retry keeps its time; a chosen time stays.
{
 const realNow=Date.now,start=Date.parse('2026-11-02T06:00:00Z');let clock=start;Date.now=()=>clock;
 const saved:{measuredAt:string;submissionId:string}[]=[];let answer:{ok:boolean;bp?:string}={ok:true,bp:'remeasure'};
 const save=async(i:{measuredAt:string;submissionId:string})=>{saved.push(i);return answer;};
 let r!:ReactTestRenderer;
 await act(async()=>{r=create(React.createElement(Form,{locale:'en',save}));await new Promise(resolve=>setTimeout(resolve,5));});
 const set=async(id:string,value:string)=>act(async()=>r.root.findAll(n=>n.type==='input'&&n.props.id===id)[0].props.onChange({target:{value}}));
 const send=async()=>act(async()=>r.root.findByType('form').props.onSubmit({preventDefault(){}}));
 await set('systolic','185');await set('diastolic','115');await send();
 clock=start+6*60000;await set('systolic','184');await set('diastolic','114');await send();
 assert.equal(saved.length,2);assert.equal(Date.parse(saved[1].measuredAt)-Date.parse(saved[0].measuredAt),6*60000,'Two readings six minutes apart keep six minutes');
 answer={ok:false};clock=start+12*60000;await set('systolic','183');await set('diastolic','113');await send();clock=start+13*60000;await send();
 assert.equal(saved[3].measuredAt,saved[2].measuredAt,'A retry of one submission keeps its time');assert.equal(saved[3].submissionId,saved[2].submissionId);
 Date.now=realNow;
}
for(const locale of ['en','hy'] as const){
 let renderer!:ReactTestRenderer;let ready:{canSave:boolean;summary:string;problem:boolean}|undefined;let dirty=false;
 await act(async()=>{renderer=create(React.createElement(Form,{locale,onReadyChange:(r:typeof ready)=>{ready=r;},onDraftChange:(d:boolean)=>{dirty=d;}}));await new Promise(resolve=>setTimeout(resolve,10));});
 const input=(id:string)=>renderer.root.findAll(node=>node.type==='input'&&node.props.id===id)[0];
 const thumb=(f:string)=>renderer.root.findAll(node=>node.type==='input'&&node.props['data-thumb']===f)[0];
 const row=(f:string)=>renderer.root.findAll(node=>node.props['data-bp-row']===f)[0];
 const type=async(id:string,value:string)=>act(async()=>input(id).props.onChange({target:{value}}));
 const press=async(node:ReactTestInstance)=>act(async()=>node.props.onClick());
 const step=(f:'systolic'|'diastolic'|'pulse',dir:'Increase'|'Decrease')=>renderer.root.findAll(node=>node.type==='button'&&String(node.props['aria-label']??'').startsWith(locale==='en'?dir:dir==='Increase'?'Ավելացնել':'Նվազեցնել')&&row(f).findAll(n=>n===node).length>0)[0];
 const sys='systolic' as const,dia='diastolic' as const,pul='pulse' as const;
 for(const f of [sys,dia,pul]){
  assert.equal(input(f).props.value,'',`${locale} ${f}: no reading is invented on opening`);
  assert.equal(row(f).props['data-bp-state'],'unset');
  assert.equal(thumb(f).props['aria-valuetext'],tx(locale,'Նշված չէ','Not set'),'An unset slider says so to a screen reader');
  assert.equal(sliders[f].value,values.BP_FIELDS[f].mid,'The unset thumb rests mid-track');
  assert.equal(step(f,'Increase').props.disabled,false,'± works from unset (the old wheel disabled it)');
  assert.equal(input(f).props.inputMode,'numeric','Tapping the number opens the numeric keypad');
 }
 assert.equal(ready?.canSave,false,'Save is off until both pressures are set');assert.equal(dirty,false);
 const submit=async()=>act(async()=>renderer.root.findByType('form').props.onSubmit({preventDefault(){}}));
 await submit();assert.equal(writes.length,0,'An untouched form never saves the resting slider values');
 // Slider drag → number, stepper and slider agree.
 await act(async()=>sliders[sys].onValueChange(131));
 assert.equal(input(sys).props.value,'131','Dragging the slider sets the number');assert.equal(row(sys).props['data-bp-state'],'set');assert.equal(dirty,true);
 await press(step(sys,'Decrease'));await press(step(sys,'Decrease'));await press(step(sys,'Decrease'));
 assert.equal(input(sys).props.value,'128','− fine-tunes the dragged value');assert.equal(sliders[sys].value,128,'The slider follows ±');
 assert.equal(thumb(sys).props['aria-valuetext'],tx(locale,'128 միլիմետր սնդիկի սյուն','128 millimetres of mercury'));
 // Pressing the resting thumb sets it; committing an unchanged drag on an unset slider sets it too.
 await act(async()=>(sliders[dia] as unknown as {onPointerDownCapture:(e:unknown)=>void}).onPointerDownCapture({target:{closest:()=>({})}}));
 assert.equal(input(dia).props.value,String(values.BP_FIELDS.diastolic.mid),'Pressing the unset thumb chooses its value visibly');
 await type(dia,'');assert.equal(row(dia).props['data-bp-state'],'unset','Clearing the number makes it unset again');
 await act(async()=>(sliders[dia] as unknown as {onPointerDownCapture:(e:unknown)=>void}).onPointerDownCapture({target:{closest:()=>null}}));assert.equal(input(dia).props.value,'','A press on the track waits for Base UI to report the position');
 await act(async()=>sliders[dia].onValueCommitted(95));assert.equal(input(dia).props.value,'95');
 // Keypad → slider.
 await type(dia,'8a2');assert.equal(input(dia).props.value,'82','The keypad keeps digits only');assert.equal(sliders[dia].value,82,'The slider follows typing');
 assert.equal(ready?.canSave,true);assert.equal(ready?.summary,tx(locale,'128 / 82 mmHg','128 / 82 mmHg'));
 // F2 in the form: "1" then "12" is neutral guidance; leaving it half-typed flags the box.
 await type(dia,'1');assert.equal(input(dia).props['aria-invalid'],undefined,'No error while typing');assert.equal(ready?.problem,false);assert.equal(ready?.canSave,false);
 await act(async()=>input(dia).props.onBlur());assert.equal(input(dia).props['aria-invalid'],true,'A half-typed number is flagged after leaving the box');
 await type(dia,'82');assert.equal(input(dia).props['aria-invalid'],undefined);
 // F1: a finger is a slide only once it moves sideways; a vertical start never changes the reading.
 const sl=sliders[sys];const target={closest:()=>null};const tick=()=>new Promise(r=>setTimeout(r,5));
 const gesture=async(dx:number,dy:number,values:number[])=>act(async()=>{
  (sl as unknown as {onPointerDownCapture:(e:unknown)=>void}).onPointerDownCapture({pointerType:'touch',clientX:100,clientY:300,target});
  sl.onValueChange(values[0]);
  (sl as unknown as {onPointerMoveCapture:(e:unknown)=>void}).onPointerMoveCapture({clientX:100+dx,clientY:300+dy});
  for(const v of values.slice(1))sl.onValueChange(v);
  (sl as unknown as {onPointerCancel:()=>void}).onPointerCancel();
  for(const v of values.slice(1))sl.onValueChange(v); // Base UI keeps reporting while the browser scrolls
  sl.onValueCommitted(values.at(-1)!);(sl as unknown as {onTouchEnd:()=>void}).onTouchEnd();await tick();});
 await gesture(6,120,[200,203,210]);assert.equal(input(sys).props.value,'128','A vertical pan that starts on the slider leaves the reading alone');
 await gesture(-10,140,[121,119]);assert.equal(input(sys).props.value,'128','… even with sideways drift');
 const slide=async(dx:number,values:number[])=>act(async()=>{
  (sl as unknown as {onPointerDownCapture:(e:unknown)=>void}).onPointerDownCapture({pointerType:'touch',clientX:100,clientY:300,target});sl.onValueChange(values[0]);
  (sl as unknown as {onPointerMoveCapture:(e:unknown)=>void}).onPointerMoveCapture({clientX:100+dx,clientY:302});for(const v of values.slice(1))sl.onValueChange(v);
  (sl as unknown as {onPointerUp:()=>void}).onPointerUp();sl.onValueCommitted(values.at(-1)!);(sl as unknown as {onTouchEnd:()=>void}).onTouchEnd();await tick();});
 await slide(-30,[125,122,120]);assert.equal(input(sys).props.value,'120','A sideways drag still sets the reading');
 await act(async()=>{(sl as unknown as {onPointerDownCapture:(e:unknown)=>void}).onPointerDownCapture({pointerType:'touch',clientX:100,clientY:300,target});sl.onValueChange(131);(sl as unknown as {onPointerUp:()=>void}).onPointerUp();(sl as unknown as {onTouchEnd:()=>void}).onTouchEnd();await tick();});
 assert.equal(input(sys).props.value,'131','A still finger on the track is a tap and sets the value there');
 await act(async()=>{(sl as unknown as {onPointerDownCapture:(e:unknown)=>void}).onPointerDownCapture({pointerType:'touch',clientX:100,clientY:300,target:{closest:()=>({})}});sl.onValueChange(130);(sl as unknown as {onPointerUp:()=>void}).onPointerUp();(sl as unknown as {onTouchEnd:()=>void}).onTouchEnd();await tick();});
 assert.equal(input(sys).props.value,'131','A wobbly tap on a set thumb keeps its value');
 await act(async()=>sl.onValueChange(129));assert.equal(input(sys).props.value,'129','Keyboard and mouse changes pass straight through once the touch is over');
 await type(sys,'128');
 // Order and range keep Save off and explain why.
 await type(dia,'130');assert.equal(ready?.canSave,false);assert.equal(ready?.problem,true);
 assert.equal(ready?.summary,tx(locale,'Վերին թիվը պետք է մեծ լինի ստորինից։','The upper number must be higher than the lower one.'));
 assert.equal(input(sys).props['aria-invalid'],true,'The order problem marks both pressures');
 await submit();assert.equal(writes.length,0,'Invalid order does not issue a write');
 await type(dia,'82');await type(pul,'300');assert.equal(ready?.canSave,false);assert.equal(input(pul).props['aria-invalid'],true);
 assert.equal(sliders[pul].value,values.BP_FIELDS.pulse.mid,'An out-of-range typed value leaves the thumb resting, not clamped to a fake value');
 await type(pul,'');assert.equal(ready?.canSave,true,'Pulse is optional');
 // Keyboard on the number: arrows step.
 await act(async()=>input(pul).props.onKeyDown({key:'ArrowUp',preventDefault(){}}));assert.equal(input(pul).props.value,String(values.BP_FIELDS.pulse.mid+1));
 await type(pul,'71');
 // Edited time is read as Armenia time.
 const change=renderer.root.findAll(node=>node.type==='button'&&node.props.children===tx(locale,'Փոխել ժամը','Change time'))[0];await press(change);
 await act(async()=>input('measured-time').props.onInput?.({currentTarget:{value:'2026-10-14T20:17'}}));
 result={ok:false};await submit();const first=writes.at(-1)!;
 assert.deepEqual([first.systolic,first.diastolic,first.pulse],[128,82,71]);
 assert.equal(first.measuredAt,'2026-10-14T16:17:00.000Z','Edited time is read as Armenia time (UTC+4)');
 await submit();assert.equal(writes.at(-1)!.submissionId,first.submissionId,'Failed retries preserve submission identity');
 result={ok:false,reason:'conflict'};await submit();
 const recovery=renderer.root.findAll(node=>node.type==='button'&&node.props.children===tx(locale,'Պահել որպես նոր չափում','Save as a new measurement'))[0];
 assert.ok(recovery,'Conflict recovery keeps the explicit new-submission action');await press(recovery);
 await type(pul,'');result={ok:true};await submit();
 assert.notEqual(writes.at(-1)!.submissionId,first.submissionId);assert.equal(writes.at(-1)!.pulse,undefined,'A cleared pulse saves as absent');
 assert.equal(routes.at(-1),'/patient/measurements','Successful save keeps the history route');
 writes.length=0;await act(async()=>renderer.unmount());
}

// Prototype entry uses the same form, validation, identity and failure recovery with three numeric boxes.
for (const locale of ['en', 'hy'] as const) {
 let r!: ReactTestRenderer;
 routes.length = 0; writes.length = 0;
 await act(async () => { r = create(React.createElement(Form, { locale, prototype: true })); await new Promise(resolve => setTimeout(resolve, 10)); });
 assert.equal(r.root.findAll(n => n.props['data-bp-grid']).length, 1, 'Prototype groups the three values together');
 assert.equal(r.root.findAll(n => n.props['data-slider']).length, 0, 'Prototype shows numeric boxes');
 const input = (id: string) => r.root.findAll(n => n.type === 'input' && n.props.id === id)[0];
 const type = async (id: string, value: string) => act(async () => input(id).props.onChange({ target: { value } }));
 const submit = async () => act(async () => r.root.findByType('form').props.onSubmit({ preventDefault() {} }));
 assert.equal(input('systolic').props.value, '');
 await submit(); assert.equal(writes.length, 0);
 await type('systolic', '128'); await type('diastolic', '130'); await submit(); assert.equal(writes.length, 0, 'Invalid order stays blocked');
 await type('diastolic', '82'); await type('pulse', '7'); await submit(); assert.equal(writes.length, 0, 'Partial optional pulse stays blocked');
 await type('pulse', '');
 result = null; await submit();
 assert.match(JSON.stringify(r.toJSON()), /confirm|հաստատել/, 'Unknown save retains its notice');
 const first = writes.at(-1)!;
 result = { ok: false, reason: 'conflict' }; await submit();
 assert.equal(writes.at(-1)!.submissionId, first.submissionId, 'Retry retains immutable submission ID');
 assert.equal(input('systolic').props.value, '128'); assert.equal(routes.length, 0);
 result = { ok: true }; await submit();
 assert.deepEqual([writes.at(-1)!.systolic, writes.at(-1)!.diastolic, writes.at(-1)!.pulse], [128, 82, undefined]);
 assert.equal(routes.at(-1), '/patient/measurements');
 await act(async () => r.unmount());
}
writes.length = 0;

// 3. Closing: tap, Escape and backdrop all arrive as onOpenChange(false) or the Close button; the sheet hides at once.
let dialogProps:{open:boolean;onOpenChange:(o:boolean)=>void}|undefined;const prefetched:string[]=[];let draft:((d:boolean)=>void)|undefined; let formBusy:((b:boolean)=>void)|undefined;
const dialog=load('measurement-entry-dialog',{
 'next/link':{__esModule:true,default:'a'},
 './tab-draft':{keepDraft:()=>{}},
 'next/navigation':{useRouter:()=>({replace:(route:string)=>routes.push(route),prefetch:(route:string)=>prefetched.push(route),refresh(){}})},
 '@/components/ui/dialog':{Dialog:(props:{open:boolean;onOpenChange:(o:boolean)=>void;children?:React.ReactNode})=>{dialogProps=props;return props.open?React.createElement('div',{'data-dialog':true},props.children):null;},
  DialogContent:({children}:{children?:React.ReactNode})=>React.createElement('section',null,children),
  DialogTitle:({children}:{children?:React.ReactNode})=>React.createElement('h2',null,children),
  DialogDescription:({children}:{children?:React.ReactNode})=>React.createElement('p',null,children)},
 '@/components/ui/button':{Button:({children,...props}:React.ComponentProps<'button'>)=>React.createElement('button',props,children)},
 '@/components/patient-care/common':{IconTile:()=>null},
 './measurement-form':{MeasurementForm:(props:{onDraftChange:(d:boolean)=>void;onBusyChange:(b:boolean)=>void})=>{draft=props.onDraftChange;formBusy=props.onBusyChange;return null;}},
});
const Dialog=dialog.MeasurementEntryDialog as React.ComponentType<{locale:'en'|'hy'}>;
for(const locale of ['en','hy'] as const) for(const how of ['button','dismiss'] as const){
 let r!:ReactTestRenderer;routes.length=0;
 await act(async()=>{r=create(React.createElement(Dialog,{locale}));});
 assert.ok(prefetched.includes('/patient/health'),'The close destination is prefetched');
 const closeButton=()=>r.root.findAll(n=>n.type==='button'&&Array.isArray(n.props.children)&&n.props.children[0]===tx(locale,'Փակել','Close'))[0];
 const dismiss=async()=>act(async()=>{if(how==='button')closeButton().props.onClick();else dialogProps!.onOpenChange(false);});
 await dismiss();
 assert.equal(dialogProps!.open,false,`${locale} ${how}: a clean sheet hides immediately, without waiting for the next page`);
 assert.deepEqual(routes,['/patient/health']);
 await act(async()=>r.unmount());
 await act(async()=>{r=create(React.createElement(Dialog,{locale}));});routes.length=0;
 await act(async()=>draft!(true));await dismiss();
 assert.equal(dialogProps!.open,true,`${locale} ${how}: a set value asks before discarding`);assert.equal(routes.length,0);
 const byText=(en:string,hy:string)=>r.root.findAll(n=>n.type==='button'&&n.props.children===tx(locale,hy,en))[0];
 await act(async()=>byText('Keep editing','Շարունակել խմբագրումը').props.onClick());
 assert.equal(r.root.findAll(n=>n.props.role==='alert').length,0,'Keep editing returns to the sheet');assert.equal(dialogProps!.open,true);
 await dismiss();await act(async()=>byText('Discard and close','Հրաժարվել և փակել').props.onClick());
 assert.equal(dialogProps!.open,false);assert.deepEqual(routes,['/patient/health'],'Discard and close leaves at once');
 await act(async()=>r.unmount());
}
let busyDialog!: ReactTestRenderer;
await act(async () => { busyDialog = create(React.createElement(dialog.MeasurementEntryDialog as React.ComponentType<Record<string, unknown>>, { locale: "en", prototype: true, classicHref: "/patient/measurements/new?view=classic" })); });
await act(async () => formBusy!(true));
const fallbackLink = busyDialog.root.findByType("a");
assert.equal(fallbackLink.props["aria-disabled"], true, "Classic-view navigation waits for the current save");
let prevented = false;
await act(async () => fallbackLink.props.onClick({ preventDefault() { prevented = true; } }));
assert.equal(prevented, true);
await act(async () => busyDialog.unmount());
console.log('BP entry EN/HY: unset → set by slider, thumb press, ± and keypad, all in sync; range clamps and invalid typing; systolic > diastolic; Save gating and summary; edited Armenia time, stable retry ID, conflict recovery and success route; Close/Escape/backdrop hide at once and ask first when a value is set; pass. Real form and row; slider, action and router isolated.');
