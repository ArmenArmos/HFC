import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import * as jsx from 'react/jsx-runtime';
import * as icons from 'lucide-react';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import type {NurseVisitReady} from '@/lib/nurse-visit/schema';
import type {VisitWrite} from '@/lib/nurse-visit/shortcut';
import {visitBlockCopy,visitCopy} from '@/lib/nurse-visit/copy';
import type {useNurseVisit} from '@/components/nurse-chat-v2/use-nurse-visit';
import type {NurseVisit} from '@/components/nurse-chat-v2/visit';
type SampleCollectCommand=Extract<Extract<VisitWrite,{kind:'collect'}>['command'],{testId:string}>;
(globalThis as unknown as {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const id='aa110000-0000-4000-8000-000000000001',at='2026-11-06T08:00:00Z';
const seed=():NurseVisitReady=>({version:'nurse-visit-v1',enabled:true,today:'2026-11-06',checklistVersion:'protocol-draft-2',caseRevision:3,visit:{id,memberId:id,source:'appointment',memberName:'Narine',arrangementToken:'fixture',startsAt:at,endsAt:null,mode:'home',location:'Yerevan',bookingStatus:'confirmed',completion:null},steps:[],items:[
 {kind:'measurement',key:'measure:bp',field:'bp',mark:null},
 {kind:'measurement',key:'measure:weight',field:'weight',mark:null},
 {kind:'measurement',key:'measure:waist',field:'waist',mark:null},
 {kind:'sample',key:'sample:lipid-panel',testId:'lipid-panel',title:'Lipid panel',mark:null},
 {kind:'sample',key:'sample:hba1c-glucose',testId:'hba1c-glucose',title:'HbA1c and fasting glucose',mark:null},
 ],counts:{samplesPlanned:2,samplesTaken:0,bpTaken:false,deviceDone:null,openItems:[]},completion:null});
let data=seed(),reads=0,unknownAt=0,refuseAt=0,holdAt=0;
let releaseWrite:(()=>void)|undefined;
const writes:VisitWrite[]=[],receipts=new Set<string>();
async function write(request:VisitWrite){
 writes.push(request);const c=request.command;
 if(holdAt===writes.length)await new Promise<void>(resolve=>{releaseWrite=resolve;});
 if(refuseAt===writes.length)return {status:'stale'};
 if(!receipts.has(c.submissionId)){
  if(request.kind==='step')data.steps.push({step:request.command.step,at,by:'Nurse Ani'});
  else if(request.kind==='mark'){
   const command=request.command,item=data.items.find(i=>i.key===command.item)!;
   if(command.expectUnanswered&&item.mark)return {status:'already-marked'};
   item.mark={done:command.done,values:command.values,note:command.note,recordedAt:at,nurseName:'Nurse Ani'};
  }else {
   const command=request.command;assert.equal(command.expectedRevision,data.caseRevision,'Collection follows every preceding readback revision');assert.equal(command.arrangementToken,data.visit.arrangementToken);
   assert.ok(!('all'in command),'The exception must not become an all-collected command');
   const item=data.items.find(i=>i.kind==='sample'&&i.testId===command.testId)!;
   item.mark={done:command.status==='collected',collectionStatus:command.status,note:command.reason,values:null,recordedAt:at,nurseName:'Nurse Ani'};
  }
  data.caseRevision++;receipts.add(c.submissionId);
 }
 return {status:unknownAt===writes.length?'outcome-unknown':'saved'};
}
const browser=Object.assign(new EventTarget(),{setInterval:()=>1,clearInterval(){}}),doc=Object.assign(new EventTarget(),{hidden:false});
const modules:Record<string,unknown>={react:React,'react/jsx-runtime':jsx,'lucide-react':icons,
 '@/lib/nurse-chat/v2-actions':{readNurseChatVisit:async()=>{reads++;return structuredClone(data);}},
 '@/lib/nurse-visit/actions':{recordNurseVisitStep:(command:Extract<VisitWrite,{kind:'step'}>['command'])=>write({kind:'step',command}),recordNurseVisitMark:(command:Extract<VisitWrite,{kind:'mark'}>['command'])=>write({kind:'mark',command}),recordNurseVisitCollect:(command:Extract<VisitWrite,{kind:'collect'}>['command'])=>write({kind:'collect',command}),recordNurseVisitComplete:async()=>{throw Error('No completion expected');}},
};
for(const name of ['schema','copy','chat-order','chat-parser','shortcut','collection','protocol-copy'])modules[`@/lib/nurse-visit/${name}`]=await import(`../lib/nurse-visit/${name}.ts`);
modules['@/lib/staff/staff-locale-copy']=await import('@/lib/staff/staff-locale-copy');
modules['@/lib/staff/yerevan-time']=await import('@/lib/staff/yerevan-time');
function load(file:string){const exports:Record<string,unknown>={};vm.runInNewContext(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,crypto,window:browser,document:doc,require:(name:string)=>{assert.ok(name in modules,name);return modules[name];}});return exports;}
modules['./use-nurse-visit']=load('components/nurse-chat-v2/use-nurse-visit.ts');
modules['./sample-collection']=load('components/nurse-chat-v2/sample-collection.tsx');
modules['@/components/ui/progress']=await import('@/components/ui/progress');
modules['./visit-fields']=load('components/nurse-chat-v2/visit-fields.tsx');
const hook=(modules['./use-nurse-visit'] as {useNurseVisit:typeof useNurseVisit}).useNurseVisit;
const View=load('components/nurse-chat-v2/visit.tsx').NurseVisit as typeof NurseVisit;
let visit!:ReturnType<typeof useNurseVisit>,tree!:ReactTestRenderer,activeLocale:'en'|'hy'|'ru'='en';
function Harness(){visit=hook(()=>{},activeLocale);return React.createElement(View,{visit,locale:activeLocale,draft:'',onAction:action=>action()});}
async function mount(confirmed=false,locale:typeof activeLocale='en',saved?:NurseVisitReady){activeLocale=locale;data=saved?structuredClone(saved):seed();if(confirmed)data.steps.push({step:'confirmed',at,by:'Nurse Ani'});writes.length=0;receipts.clear();unknownAt=0;refuseAt=0;holdAt=0;releaseWrite=undefined;await act(async()=>{tree=create(React.createElement(Harness));});await act(async()=>{visit.start(data.visit,'visit');});}
const button=(label:string)=>tree.root.findAllByType('button').find(b=>b.children.filter(child=>typeof child==='string').join('')===label)!;
// A temporary Skip permits recording BP but never marks the skipped check as done.
for(const section of ['bp','safety'] as const){
 const saved=seed();saved.steps=[{step:'confirmed',at,by:'Nurse Ani'},{step:'started',at,by:'Nurse Ani'}];
 const key=`check:skipped-${section}`;
 saved.items.unshift({kind:'check',key,checkId:`skipped-${section}`,section,version:'protocol-draft-2',label:{en:'Skipped check',hy:'Բաց թողնված կետ'},source:'Existing protocol',mark:null});
 await mount(false,'en',saved);
 await act(async()=>tree.root.findByProps({'data-visit-item':key}).findAllByType('button').find(b=>b.children.join('')==='Skip for now')!.props.onClick());
 for(const [label,value] of [['Systolic','138'],['Diastolic','88']])await act(async()=>tree.root.findByProps({'aria-label':label}).props.onChange({target:{value}}));
 const bpRow=()=>tree.root.findByProps({'data-visit-item':'measure:bp'});
 const next=bpRow().findAllByType('button').find(b=>b.children.join('')==='Next')!;
 assert.equal(next.props.disabled,false,`A skipped ${section} check must not block BP recording`);
 await act(async()=>next.props.onClick());
 assert.deepEqual(writes.map(w=>w.kind==='mark'?w.command.item:w.kind),['measure:bp']);
 assert.equal(data.items.find(i=>i.key===key)!.mark,null,'Skip is not a saved answer');
 for(const item of data.items)if(item.kind==='measurement'&&item.field!=='bp')item.mark={done:true,values:{value:84},note:null,recordedAt:at,nurseName:'Nurse Ani'};
 for(const item of data.items)if(item.kind==='sample')item.mark={done:true,collectionStatus:'collected',values:null,note:null,recordedAt:at,nurseName:'Nurse Ani'};
 data.steps.push({step:'samples-collected',at,by:'Nurse Ani'},{step:'samples-at-lab',at,by:'Nurse Ani'});
 await act(async()=>{await visit.refresh();});
 assert.equal(visit.question?.kind,'finish');
 assert.equal(tree.root.findByProps({'data-visit-block-status':'bp'}).props['data-done'],false);
 await act(async()=>visit.view('complete'));
 assert.ok(JSON.stringify(tree.toJSON()).includes('Skipped check'),'Completion still lists skipped work');
 const recorded=structuredClone(data);await act(async()=>tree.unmount());
 await mount(false,'en',recorded);
 const reloadedQuestion=visit.question as {kind:string;item?:{key:string}}|null;assert.equal(reloadedQuestion?.kind==='item'&&reloadedQuestion.item?.key,key,'Reload asks the skipped check again');
 assert.equal(tree.root.findByProps({'aria-label':'Systolic'}).props.value,'138');
 const reloadedNext=bpRow().findAllByType('button').find(b=>b.children.join('')==='Next')!;
 assert.equal(reloadedNext.props.disabled,true,'Reload never re-saves the recorded BP');
 await act(async()=>reloadedNext.props.onClick());assert.equal(writes.length,0);
 await act(async()=>tree.unmount());
}
// Refreshed saved notes cannot become apparent local edits or be overwritten by stale selection data.
for(const l of ['en','hy','ru'] as const){
 for(const editTiming of ['none','before-refresh','during-refresh','cancel','unchanged-send'] as const){
  const localEdit=editTiming==='before-refresh'||editTiming==='during-refresh';
  const saved=seed();saved.steps=[{step:'confirmed',at,by:'Nurse Ani'},{step:'started',at,by:'Nurse Ani'}];
  saved.items[0].mark={done:true,values:{systolic:138,diastolic:88,pulse:72},note:'Original note',recordedAt:at,nurseName:'Nurse Ani'};
  await mount(false,l,saved);
  await act(async()=>visit.choose({kind:'item',item:visit.flow!.data!.items[0]}));
  const copy=visitCopy(l),block=visitBlockCopy(l);
  const next=()=>tree.root.findByProps({'data-visit-item':'measure:bp'}).findAllByType('button').find(b=>b.children.join('')===block.next)!;
  assert.equal(next().props.disabled,true);
  if(editTiming!=='none')await act(async()=>visit.addComment(''));
  if(editTiming==='before-refresh')await act(async()=>visit.send('Local note'));
  data.items[0].mark={...data.items[0].mark!,note:'Another nurse note',recordedAt:'2026-11-06T08:05:00Z',nurseName:'Nurse Mari'};data.caseRevision++;
  await act(async()=>{await visit.refresh();});
  if(editTiming==='during-refresh')await act(async()=>visit.send('Local note'));
  if(editTiming==='cancel')await act(async()=>visit.cancelComment());
  if(editTiming==='unchanged-send')await act(async()=>visit.send('Original note'));
  assert.equal(visit.flow!.comment,localEdit?'Local note':'Another nurse note','Only actual local edits survive refresh');
  assert.equal(visit.question?.kind==='item'&&visit.question.item.mark?.note,'Another nurse note','The selected item follows saved state');
  if(!localEdit){
   assert.equal(next().props.disabled,true,'An untouched refreshed note must not enable Next');
   await act(async()=>next().props.onClick());assert.equal(writes.length,0);
   await act(async()=>tree.root.findByProps({'aria-label':copy.systolic}).props.onChange({target:{value:'139'}}));
   await act(async()=>next().props.onClick());
   assert.equal(writes.length,1);assert.equal(writes[0].kind==='mark'&&writes[0].command.note,'Another nurse note','A reading edit uses the refreshed comment');
  }else{
   await act(async()=>next().props.onClick());
   assert.equal(writes.length,0,'A conflicting local note requires explicit confirmation');
   assert.ok(visit.flow!.preview);
   assert.equal(tree.root.findByType('textarea').props.value,'Local note');
   assert.ok(tree.root.findByProps({'data-visit-preview':true}).findAllByType('p').some(p=>p.children.join('').includes('Another nurse note')),'The confirmation shows the changed saved note beside the local edit');
   // Another change during confirmation must be inspected before any write.
   data.items[0].mark={...data.items[0].mark!,note:'Newest nurse note'};data.caseRevision++;
   await act(async()=>visit.confirmPreview());assert.equal(writes.length,0);
   assert.equal(tree.root.findByType('textarea').props.value,'Local note');
   assert.ok(JSON.stringify(tree.toJSON()).includes('Newest nurse note'));
   await act(async()=>button(block.confirm).props.onClick());
   assert.equal(writes.length,1);assert.equal(writes[0].kind==='mark'&&writes[0].command.note,'Local note');
  }
  await act(async()=>tree.unmount());
 }
}
console.log('Round 2: skipped protocol/safety recording and reload, untouched note refresh and conflicting local-note reconfirmation passed in mounted UI (mocked IO).');
// The exact e2e sentence and its translations prepare all readings and samples, then write in order.
for(const [l,text] of [
 ['en','Blood pressure 138/88, pulse 72, weight 84 kg, waist 96 cm. Samples collected.'],
 ['ru','АД 138/88, пульс 72, вес 84 кг, талия 96 см. Образцы взяты.'],
 ['hy','ճնշում 138/88, զարկերակ 72, քաշ 84 կգ, գոտկատեղ 96 սմ։ Նմուշները վերցված են։'],
] as const){
 await mount(false,l);await act(async()=>visit.send(text));
 assert.deepEqual(Array.from(visit.flow!.preview!.untouched),[]);
 assert.equal(tree.root.findByProps({'aria-label':visitCopy(l).optionalPulse}).props.value,'72');
 assert.equal(tree.root.findByProps({'aria-label':visitCopy(l).waistInput}).props.value,'96');
 assert.equal(writes.length,0);assert.equal(button(visitBlockCopy(l).confirm).props.disabled,true);
 await act(async()=>button(visitCopy(l).confirmed).props.onClick());assert.equal(writes.length,0);
 assert.equal(button(visitBlockCopy(l).confirm).props.disabled,false);
 await act(async()=>button(visitBlockCopy(l).confirm).props.onClick());
 assert.deepEqual(writes.map(w=>w.kind==='step'?w.command.step:w.kind==='mark'?w.command.item:w.kind),['confirmed','measure:bp','measure:weight','measure:waist','collect','collect']);
 await act(async()=>tree.unmount());
}
// E16: editing incomplete fields is sufficient, without blur or any early writes.
for(const [l,text] of [
 ['en','Blood pressure 138/88, pulse unclear; weight 84 kg; waist unclear. Samples collected.'],
 ['ru','АД 138/88, пульс неизвестен; вес 84 кг; талия неизвестна. Образцы взяты.'],
 ['hy','ճնշում 138/88, զարկերակ անհայտ; քաշ 84 կգ; գոտկատեղ անհայտ։ Նմուշները վերցված են։'],
] as const){
 await mount(false,l);
 // A previous weight must never be overwritten or invisibly block the new readings.
 data.items[1].mark={done:true,note:null,values:{value:83},recordedAt:at,nurseName:'Nurse Ani'};
 await act(async()=>{await visit.refresh();});await act(async()=>{await visit.send(text);});
 const confirm=visitBlockCopy(l).confirm,copy=visitCopy(l);
 assert.equal(button(confirm).props.disabled,true);
 for(const [label,value] of [[copy.systolic,'138'],[copy.diastolic,'88'],[copy.optionalPulse,'72'],[copy.waistInput,'96']])await act(async()=>tree.root.findByProps({'aria-label':label}).props.onChange({target:{value}}));
 assert.equal(writes.length,0,'Manual edits never save before Confirm');
 await act(async()=>button(copy.confirmed).props.onClick());
 await act(async()=>tree.root.findByProps({'data-preview-sample':'lipid-panel'}).findByProps({'data-collection-choice':'collected'}).props.onClick());
 assert.equal(button(confirm).props.disabled,true,'An unset sample still blocks the collection draft');
 await act(async()=>tree.root.findByProps({'data-preview-sample':'hba1c-glucose'}).findByProps({'data-collection-choice':'collected'}).props.onClick());
 assert.equal(writes.length,0);assert.equal(button(confirm).props.disabled,false,'Manual repairs enable Confirm immediately');
 await act(async()=>button(confirm).props.onClick());
 assert.deepEqual(writes.map(w=>w.kind==='mark'?w.command.item:w.kind==='step'?w.command.step:w.kind),['confirmed','measure:bp','measure:waist','collect','collect']);
 assert.equal(data.items[1].mark!.values&&'value'in data.items[1].mark!.values&&data.items[1].mark!.values.value,83,'Saved readings are retained');
 await act(async()=>tree.unmount());
}
// Saved server state alone selects the first group with work after a fresh mount.
for(const l of ['en','hy','ru'] as const){
 const saved=seed();saved.steps=[{step:'confirmed',at,by:'Nurse Ani'},{step:'started',at,by:'Nurse Ani'}];
 const mark={done:true,note:null,values:null,recordedAt:at,nurseName:'Nurse Ani'};
 for(const item of saved.items)if(item.kind==='measurement')item.mark={...mark,values:item.field==='bp'?{systolic:138,diastolic:88,pulse:72}:{value:item.field==='weight'?84:96}};
 await mount(false,l,saved);
 assert.equal(tree.root.findByProps({'data-visit-group':'samples'}).props['data-visit-group'],'samples');
 assert.equal(tree.root.findByProps({role:'progressbar'}).props['aria-valuenow'],4);
 assert.equal(tree.root.findAll(n=>n.props['data-visit-group']==='ecg').length,0);
 assert.ok(JSON.stringify(tree.toJSON()).includes(visitBlockCopy(l).baselineUnavailable));
 for(const id of ['arrival','bp','body'])assert.equal(tree.root.findByProps({'data-visit-block-status':id}).props['data-done'],true);
 await act(async()=>tree.unmount());
 for(const item of saved.items)if(item.kind==='sample')item.mark={...mark,collectionStatus:'not-collected',note:'Member declined'};
 await mount(false,l,saved);
 assert.equal(visit.question?.kind,'finish','No collected samples means no transport steps to perform');
 assert.equal(tree.root.findByProps({role:'progressbar'}).props['aria-valuenow'],5);
 await act(async()=>tree.unmount());
 // A saved negative answer is finished work, not an empty field on reload.
 saved.items[0].mark={...mark,done:false,note:'Not taken'};
 await mount(false,l,saved);assert.equal(visit.question?.kind,'finish');await act(async()=>tree.unmount());
}
// A done protocol row is inert; only its separate Undo target writes done=false.
for(const l of ['en','hy','ru'] as const){
 const saved=seed();saved.steps=[{step:'confirmed',at,by:'Nurse Ani'},{step:'started',at,by:'Nurse Ani'}];
 saved.items.unshift({kind:'check',key:'check:bp-cuff-fit',checkId:'bp-cuff-fit',section:'bp',version:'protocol-draft-2',label:{en:'Cuff fit',hy:'Բազկակապ'},source:'Existing protocol',mark:{done:true,note:null,values:null,recordedAt:at,nurseName:'Nurse Ani'}});
 await mount(false,l,saved);
 const row=tree.root.findByProps({'data-visit-item':'check:bp-cuff-fit'});
 const state=row.findByProps({'data-visit-done':true});assert.equal(state.type,'p');assert.equal(state.props.onClick,undefined);
 assert.ok(!tree.root.findByProps({'data-visit-all-done-section':'bp'}).findAllByType('button').some(b=>b.children.join('')===visitBlockCopy(l).allDone),'A fully answered section has no All done action');
 const undo=row.findByProps({'data-visit-undo':true});assert.ok(undo.props['aria-label'].startsWith(visitBlockCopy(l).undo));assert.ok(undo.props.className.includes('min-h-11'));
 assert.equal(writes.length,0);await act(async()=>undo.props.onClick());
 assert.equal(writes.length,1);assert.equal(writes[0].kind==='mark'&&writes[0].command.done,false);
 await act(async()=>tree.unmount());
}
// Polish checks render the real visit UI in each nurse language.
for(const l of ['en','hy','ru'] as const){
 await mount(false,l);
 const progress=tree.root.findByProps({role:'progressbar'});
 assert.equal(progress.props['aria-valuenow'],1);assert.equal(progress.props['aria-valuemin'],0);assert.equal(progress.props['aria-valuemax'],5);
 assert.equal(progress.findAll(n=>n.props.className==='cv2-say').length,0);
 const details=tree.root.findByProps({'data-visit-details':true});
 assert.equal(details.props.open,false);
 const toggle=details.findAllByType('summary')[0];assert.equal(toggle.props['aria-expanded'],false);
 assert.ok(JSON.stringify(toggle.children).includes(visitBlockCopy(l).details));
 await act(async()=>details.props.onToggle({currentTarget:{open:true}}));
 assert.equal(tree.root.findByProps({'data-visit-details':true}).findAllByType('summary')[0].props['aria-expanded'],true);
 await act(async()=>visit.send('BP 142/88; call me later'));
 const label=visitBlockCopy(l).untouched;
 assert.equal(tree.root.findAll(n=>n.type==='p'&&n.children.join('')===label).length,1);
 assert.equal(tree.root.findAllByType('button').filter(n=>n.children.join('')===label).length,0);
 await act(async()=>tree.unmount());
}
// Round 4: reason scope is unknowable from free text. Only a nurse choice can collect the rest.
const scopeCases=[
 ['en','all samples taken','except','lipid profile could not be collected'],
 ['en','all samples taken','except','the other sample could not be collected either'],
 ['ru','все образцы взяты','кроме','липидный профиль не взят'],
 ['ru','все образцы взяты','кроме','другой образец тоже не удалось взять'],
 ['hy','բոլոր նմուշները վերցված են','բացի','լիպիդային պրոֆիլը չի վերցվել'],
 ['hy','բոլոր նմուշները վերցված են','բացի','մյուս նմուշը նույնպես չի հաջողվել վերցնել'],
] as const;
for(const [l,all,except,reason] of scopeCases){
 await mount(true,l);await act(async()=>visit.send(`${all} ${except} HbA1c, ${reason}`));
 assert.deepEqual(visit.flow!.preview!.samples.map(s=>[s.testId,s.status,s.reason]),[['lipid-panel','pending',''],['hba1c-glucose','not-collected',reason]]);
 assert.equal(tree.root.findByType('textarea').props.value,reason,'The whole reason is editable and verbatim');
 assert.ok(JSON.stringify(tree.toJSON()).includes(visitBlockCopy(l).checkOtherSamples));
 assert.equal(button(visitBlockCopy(l).confirm).props.disabled,true);
 await act(async()=>visit.confirmPreview());assert.equal(writes.length,0,'An exception never silently collects another sample');
 await act(async()=>button(visitBlockCopy(l).markRestCollected).props.onClick());
 assert.equal(writes.length,0,'The rest-collected tap only edits the draft');
 assert.equal(button(visitBlockCopy(l).confirm).props.disabled,false);
 await act(async()=>button(visitBlockCopy(l).confirm).props.onClick());
 assert.deepEqual(writes.filter(w=>w.kind==='collect').map(w=>{const c=w.command as SampleCollectCommand;return [c.testId,c.status,c.reason];}),[['lipid-panel','collected',null],['hba1c-glucose','not-collected',reason]]);
 await act(async()=>tree.unmount());
}
for(const [l,text] of [
 ['en','weight 72 kg; HbA1c could not be collected; all samples taken'],
 ['ru','вес 72 кг; HbA1c не удалось взять; все образцы взяты'],
 ['hy','քաշ 72 կգ; HbA1c չի հաջողվել վերցնել; բոլոր նմուշները վերցված են'],
] as const){
 await mount(true,l);await act(async()=>visit.send(text));
 const untouched=Array.from(visit.flow!.preview!.untouched);
 await act(async()=>button(visitBlockCopy(l).confirm).props.onClick());
 assert.deepEqual(writes.map(w=>w.kind),['mark']);
 assert.ok(visit.flow!.preview,'Partial confirmation keeps unresolved clauses on screen');
 assert.deepEqual(Array.from(visit.flow!.preview!.untouched),untouched);
 assert.deepEqual(Object.keys(visit.flow!.preview!.measurements),[],'Saved weight is no longer offered as an unsaved entry');
 for(const words of untouched)assert.ok(JSON.stringify(tree.toJSON()).includes(words));
 assert.equal(button(visitBlockCopy(l).confirm).props.disabled,true,'Repeated Confirm cannot write the saved weight twice');
 await act(async()=>visit.confirmPreview());assert.equal(writes.length,1);
 await act(async()=>visit.discardPreview());assert.equal(visit.flow!.preview,null);
 await act(async()=>tree.unmount());
}
// Every case crosses the real send -> preview -> Confirm boundary; only persistence IO is mocked.
// The invariant catches bulk collection bypasses even when a qualifier is unfamiliar to the parser.
const exceptionCorpus:(readonly ['en'|'hy'|'ru',string,string])[]=[
 ...['everything but','except:','except for','excluding','besides','other than','apart from','without','not','but','except unknown test and'].map(word=>['en',`all samples taken; ${word} HbA1c; tube broke`,'hba1c-glucose'] as const),
 ...['кроме:','за исключением','без','но','не','исключая'].map(word=>['ru',`все образцы взяты; ${word} HbA1c; пробирка разбилась`,'hba1c-glucose'] as const),
 ...['բացի՝','բացառությամբ','առանց','բայց','չվերցվեց'].map(word=>['hy',`բոլոր նմուշները վերցված են; ${word} HbA1c; փորձանոթը կոտրվեց`,'hba1c-glucose'] as const),
 ...['except HbA1c, Lipid panel, tubes broke','except HbA1c and Lipid panel, tubes broke'].map(tail=>['en',`all samples taken ${tail}`,'lipid-panel'] as const),
 ...['except HbA1c','except: HbA1c','everything but HbA1c'].map(tail=>['en',`${tail}; all samples taken`,'hba1c-glucose'] as const),
 ...['except HbA1c, without the others','except HbA1c, excluding the remaining samples','except HbA1c, but the other tubes broke'].map(tail=>['en',`all samples taken ${tail}`,'lipid-panel'] as const),
 ...['Lipid panelը չվերցվեց','Լիպիդային վահանակը չվերցվեց','Липидная панелью не взята'].map(tail=>['hy',`բոլոր նմուշները վերցված են բացի HbA1c, ${tail}`,'lipid-panel'] as const),
 ...['Lipid panel','Լիպիդային վահանակ','Липидная панель','lipid-panel'].flatMap(name=>[
  ['en',`all samples taken; everything but ${name}; tube broke`,'lipid-panel'] as const,
  ['en',`all samples taken except HbA1c, ${name}, tubes broke`,'lipid-panel'] as const,
 ]),
 ...['HbA1c','HbA1c and fasting glucose','HbA1c և քաղցած գլյուկոզա','HbA1c и глюкоза натощак','hba1c-glucose'].flatMap(name=>[
  ['en',`all samples collected; without ${name}; tube broke`,'hba1c-glucose'] as const,
  ['en',`all samples taken except ${name}, tube broke`,'hba1c-glucose'] as const,
 ]),
];
// Preserve all 51 prior cases and add the review inputs plus cross-language reason scope.
exceptionCorpus.push(...scopeCases.map(([l,all,except,reason])=>[l,`${all} ${except} HbA1c, ${reason}`,'hba1c-glucose'] as const));
for(const [l,all,except] of [
 ['en','all samples taken','except'],['ru','все образцы взяты','кроме'],['hy','բոլոր նմուշները վերցված են','բացի'],
] as const)for(const reason of ['tube broke','could not draw the sample','Lipid panel could not be collected'])exceptionCorpus.push([l,`${all} ${except} HbA1c, ${reason}`,'hba1c-glucose']);
assert.ok(exceptionCorpus.length>=60);
assert.ok(new Set(exceptionCorpus.map(([,text])=>text)).size>=60,'The corpus must contain at least 60 distinct exception sentences');
for(const [l,text,testId] of exceptionCorpus){
 await mount(true,l);await act(async()=>visit.send(text));
 assert.equal(writes.length,0,'Preparing a typed entry never persists');
 assert.ok(!visit.flow!.preview!.samples.some(s=>s.testId===testId&&s.status==='collected'),text);
 assert.ok(visit.flow!.preview!.samples.every(s=>s.status!=='collected'),`No typed exception prefills any collected sample: ${text}`);
 const rest=visit.flow!.preview!.samples.filter(s=>s.status==='pending'&&!s.needsReason).map(s=>s.testId);
 await act(async()=>visit.confirmPreview());
 assert.ok(!writes.some(w=>w.kind==='collect'&&'testId'in w.command&&w.command.testId===testId&&'status'in w.command&&w.command.status==='collected'),`Invariant through Confirm: ${text}`);
 assert.ok(!writes.some(w=>w.kind==='collect'&&(w.command as SampleCollectCommand).status==='collected'),`No collection before a nurse choice: ${text}`);
 if(rest.length){
  assert.equal(button(visitBlockCopy(l).confirm).props.disabled,true);
  await act(async()=>button(visitBlockCopy(l).markRestCollected).props.onClick());
  await act(async()=>button(visitBlockCopy(l).confirm).props.onClick());
  assert.deepEqual(writes.filter(w=>w.kind==='collect'&&(w.command as SampleCollectCommand).status==='collected').map(w=>(w.command as SampleCollectCommand).testId),rest,`Only the nurse collects the rest: ${text}`);
 }
 await act(async()=>tree.unmount());
}
for(const [l,all,qualifier] of [
 ['en','all samples taken','everything but HbA1c; tube broke'],
 ['ru','все образцы взяты','за исключением HbA1c'],
 ['hy','բոլոր նմուշները վերցված են','բացառությամբ HbA1c'],
] as const){
 for(const tail of [qualifier,'except: HbA1c','call me later','HbA1c','without tubes','չվերցվեց','չեն վերցվել','не взяты']){
  await mount(true,l);await act(async()=>visit.send(`${all}; ${tail}`));
  assert.equal(visit.flow!.preview!.samples.length,0,'An unresolved message prefills no sample status');
  assert.equal(button(visitBlockCopy(l).confirm).props.disabled,true);
  const rows=tree.root.findAll(n=>n.props['data-preview-sample']!==undefined);
  assert.equal(rows.length,2,'The card still offers every pending sample for explicit entry');
  assert.ok(rows.every(row=>row.findAllByType('button').filter(b=>b.props['aria-pressed']!==undefined).every(b=>b.props['aria-pressed']===false)),'Status chips start unset');
  await act(async()=>visit.confirmPreview());assert.equal(writes.length,0);
  const status=(testId:string,value:string)=>tree.root.findByProps({'data-preview-sample':testId}).findByProps({'data-collection-choice':value});
  await act(async()=>status('lipid-panel','collected').props.onClick());
  assert.equal(button(visitBlockCopy(l).confirm).props.disabled,true,'One selected sample cannot imply the other');
  await act(async()=>status('hba1c-glucose','issue').props.onClick());
  assert.equal(button(visitBlockCopy(l).confirm).props.disabled,true,'An issue needs a reason');
  await act(async()=>tree.root.findByType('textarea').props.onChange({target:{value:'HbA1c'}}));
  assert.equal(button(visitBlockCopy(l).confirm).props.disabled,true,'A test name is never an issue reason');
  await act(async()=>tree.root.findByType('textarea').props.onChange({target:{value:'tube broke'}}));
  assert.equal(button(visitBlockCopy(l).confirm).props.disabled,false);
  await act(async()=>visit.confirmPreview());
  assert.deepEqual(writes.filter(w=>w.kind==='collect').map(w=>'status'in w.command?w.command.status:null),['collected','issue']);
  await act(async()=>tree.unmount());
 }
 for(const join of [', ',l==='en'?' and ':l==='ru'?' и ':' և ']){
  const except=l==='en'?'except':l==='ru'?'кроме':'բացի';
  await mount(true,l);await act(async()=>visit.send(`${all} ${except} HbA1c${join}Lipid panel, tubes broke`));
  assert.equal(button(visitBlockCopy(l).confirm).props.disabled,false);
  await act(async()=>visit.confirmPreview());
  assert.deepEqual(writes.filter(w=>w.kind==='collect').map(w=>'status'in w.command?[w.command.status,w.command.reason]:null),[['not-collected','tubes broke'],['not-collected','tubes broke']]);
  await act(async()=>tree.unmount());
 }
 await mount(true,l);await act(async()=>visit.send(`${all} ${l==='en'?'except':l==='ru'?'кроме':'բացի'} HbA1c, Lipid panel`));
 assert.equal(visit.flow!.preview!.samples.length,2);
 assert.ok(visit.flow!.preview!.samples.every(s=>s.status==='pending'&&s.reason===''));
 assert.equal(button(visitBlockCopy(l).confirm).props.disabled,true);
 await act(async()=>visit.confirmPreview());assert.equal(writes.length,0);
 assert.equal(tree.root.findAllByType('textarea').length,2);
 await act(async()=>tree.root.findAllByType('textarea')[0].props.onChange({target:{value:'tube broke'}}));
 assert.equal(button(visitBlockCopy(l).confirm).props.disabled,true,'Every excluded test needs its own reason');
 await act(async()=>tree.root.findAllByType('textarea')[1].props.onChange({target:{value:'tube broke'}}));
 assert.equal(button(visitBlockCopy(l).confirm).props.disabled,false);
 await act(async()=>visit.confirmPreview());
 assert.deepEqual(writes.filter(w=>w.kind==='collect').map(w=>'status'in w.command?w.command.status:null),['not-collected','not-collected']);
 await act(async()=>tree.unmount());
}
await mount(true);await act(async()=>visit.send('all samples taken; everything but HbA1c; tube broke'));
await act(async()=>tree.root.findByProps({'data-preview-sample':'lipid-panel'}).findByProps({'data-collection-choice':'collected'}).props.onClick());
assert.equal(button('Confirm entry').props.disabled,true);
await act(async()=>tree.root.findByProps({'data-preview-sample':'hba1c-glucose'}).findByProps({'data-collection-skip':true}).props.onClick());
assert.equal(button('Confirm entry').props.disabled,false,'The nurse can explicitly leave a sample untouched instead of choosing a status');
await act(async()=>visit.confirmPreview());
assert.deepEqual(writes.map(w=>w.kind==='collect'&&'testId'in w.command?w.command.testId:w.kind),['lipid-panel']);
await act(async()=>tree.unmount());
for(const [l,text] of [['en','weight 72 kg; weight 73 kg; BP 142/88'],['ru','вес 72 кг; вес 73 кг; АД 142/88'],['hy','քաշ 72 կգ; քաշ 73 կգ; ճնշում 142/88']] as const){
 await mount(true,l);await act(async()=>visit.send(text));
 assert.equal(visit.flow!.preview!.measurements['measure:weight'],'');
 assert.deepEqual(Array.from(visit.flow!.preview!.untouched),text.split('; ').slice(0,2));
 assert.equal(visit.flow!.preview!.measurements['measure:bp'],'142/88');
 assert.equal(button(visitBlockCopy(l).confirm).props.disabled,true);
 await act(async()=>visit.confirmPreview());assert.equal(writes.length,0);await act(async()=>tree.unmount());
}
for(const [l,all,bad] of [
 ['en','all samples taken',['weight 72 cm','waist 91 kg','BP 142/88 kg','BP 142/88 pulse 76 cm','weight 72 lb']],
 ['ru','все образцы взяты',['вес 72 см','талия 91 кг','АД 142/88 кг','АД 142/88 пульс 76 см','вес 72 lb']],
 ['hy','բոլոր նմուշները վերցված են',['քաշ 72 սմ','գոտկատեղ 91 կգ','ճնշում 142/88 կգ','ճնշում 142/88 զարկերակ 76 սմ','քաշ 72 lb']],
] as const)for(const text of bad){
 await mount(true,l);await act(async()=>visit.send(`${text}; ${all}`));
 assert.ok(Object.values(visit.flow!.preview!.measurements).every(value=>value===''));
 assert.ok(visit.flow!.preview!.untouched.includes(text));
 assert.equal(visit.flow!.preview!.samples.length,0,'Invalid units cannot be treated as an unrelated harmless clause');
 assert.equal(button(visitBlockCopy(l).confirm).props.disabled,true);
 await act(async()=>visit.confirmPreview());assert.equal(writes.length,0);await act(async()=>tree.unmount());
}
await mount(true);await act(async()=>visit.send('arrived, BP 142/88 pulse 76, all samples taken'));
assert.deepEqual(visit.flow!.preview!.samples.map(s=>s.status),['collected','collected']);
await act(async()=>visit.confirmPreview());assert.deepEqual(writes.map(w=>w.kind),['step','mark','collect','collect']);await act(async()=>tree.unmount());
console.log(`Structural fail-closed: ${exceptionCorpus.length} mixed exception sentences through Confirm, unset status chips, explicit repairs, lists, duplicate measurements and positive bulk collection passed (mocked IO).`);
// The real hook and Confirm boundary must preserve exceptions across clause separators.
for(const [l,all,except,but,reason,conflict] of [
 ['en','all samples taken','except','but','tube broke','Conflicting sample collection'],
 ['ru','все образцы взяты','кроме','но','пробирка разбилась','Противоречивые данные'],
 ['hy','բոլոր նմուշները վերցված են','բացի','բայց','փորձանոթը կոտրվեց','Նմուշառման հակասող տվյալներ'],
] as const){
 const confirm=visitBlockCopy(l).confirm;
 for(const separator of [' ', ', ', '; ', ' - ', ' – ', ' — ', ` ${but} `, `, ${but} `]){
  await mount(false,l);await act(async()=>{await visit.send(`${all}${separator}${except} HbA1c, ${reason}`);});
  assert.equal(writes.length,0);
  await act(async()=>visit.editPreview({...visit.flow!.preview!,confirmed:true}));
  assert.equal(button(confirm).props.disabled,true,'An exception requires an explicit choice for the rest');
  await act(async()=>button(visitBlockCopy(l).markRestCollected).props.onClick());
  assert.equal(button(confirm).props.disabled,false);
  await act(async()=>visit.confirmPreview());
  const collected=writes.filter((w):w is Extract<VisitWrite,{kind:'collect'}>=>w.kind==='collect');
  assert.deepEqual(collected.map(w=>{const c=w.command as {testId:string;status:string;reason:string|null};return [c.testId,c.status,c.reason];}),[['lipid-panel','collected',null],['hba1c-glucose','not-collected',reason]],`${all}${separator}${except}`);
  await act(async()=>tree.unmount());
 }
 await mount(false,l);await act(async()=>visit.send(`${all}, ${except} HbA1c`));await act(async()=>visit.editPreview({...visit.flow!.preview!,confirmed:true}));
 assert.equal(button(confirm).props.disabled,true,'An excluded sample needs a reason');
 await act(async()=>visit.confirmPreview());assert.equal(writes.length,0,'Missing reason leaves every sample untouched');
 await act(async()=>tree.root.findByType('textarea').props.onChange({target:{value:reason}}));
 assert.equal(button(confirm).props.disabled,true,'Adding a reason still leaves the other sample unset');
 await act(async()=>button(visitBlockCopy(l).markRestCollected).props.onClick());
 assert.equal(button(confirm).props.disabled,false);
 await act(async()=>visit.confirmPreview());
 assert.equal(writes.filter(w=>w.kind==='collect').length,2);
 assert.equal(data.items.find(i=>i.key==='sample:hba1c-glucose')?.mark?.note,reason);
 await act(async()=>tree.unmount());
 for(const text of [`${all}, ${except} unknown test, ${reason}`,`${except} HbA1c, ${reason}`,`${except} HbA1c; ${all}`,`${all}; BP 142/88; ${except} HbA1c`]){
  await mount(true,l);await act(async()=>visit.send(text));
  assert.equal(visit.flow!.preview!.samples.length,0,'Unresolved exceptions create no collection draft');
  assert.ok(visit.flow!.preview!.untouched.some(s=>s.includes(except)),'Unresolved exception remains visible');
  await act(async()=>visit.confirmPreview());assert.ok(!writes.some(w=>w.kind==='collect'),'Confirm cannot collect with an unresolved exception');
  assert.ok(!data.items.some(i=>i.kind==='sample'&&i.mark));
  if(!text.includes('BP'))assert.equal(button(confirm).props.disabled,true);
  await act(async()=>tree.unmount());
 }
 for(const text of [`${all}; ${all}; BP 142/88 pulse 76`,`${all}; ${all} ${except} HbA1c; ${reason}; ${all}; BP 142/88 pulse 76`]){
  await mount(false,l);await act(async()=>visit.send(text));
  assert.equal(tree.root.findByProps({'aria-label':visitCopy(l).systolic}).props.value,'142','Collection conflicts must not drop later BP');
  assert.ok(JSON.stringify(tree.toJSON()).includes(conflict));
  assert.equal(visit.flow!.preview!.samples.length,0);
  assert.ok(visit.flow!.preview!.untouched.includes(all));
  await act(async()=>visit.confirmPreview());
  assert.deepEqual(writes.map(w=>w.kind),['mark'],'Only the valid measurement is written');
  assert.ok(!data.items.some(i=>i.kind==='sample'&&i.mark));
  await act(async()=>tree.unmount());
 }
}
console.log('Exception association through Confirm: en/hy/ru separators, missing reasons, unresolved exceptions and collection conflicts passed (mocked IO).');
const sampleText='arrived, BP 142/88 pulse 76, all samples taken except HbA1c, tube broke';
async function collectRest(){await act(async()=>button(visitBlockCopy(activeLocale).markRestCollected).props.onClick());}
async function prepare(){await act(async()=>{await visit.send(sampleText);});assert.equal(writes.length,0,'Parsing and rendering preview never save');assert.equal(tree.root.findByProps({'aria-label':'Systolic'}).props.value,'142');assert.equal(tree.root.findByProps({'aria-label':'Diastolic'}).props.value,'88');assert.equal(tree.root.findByProps({'aria-label':'Pulse (optional)'}).props.value,'76');assert.equal(tree.root.findByType('textarea').props.value,'tube broke');}
await mount();
for(const label of ['Repeated blood pressure','Weight and waist','ECG and home log are not part of this visit.'])assert.ok(JSON.stringify(tree.toJSON()).includes(label),`Baseline item ${label} remains explicit`);
assert.equal(tree.root.findByProps({'data-visit-progress':true}).findByType('p').children.join(''),'1 of 5');
await prepare();
assert.equal(button('Confirm entry').props.disabled,true,'Missing visit confirmation stays explicit');
await act(async()=>{button('I confirmed the visit with the member').props.onClick();});assert.equal(writes.length,0,'The confirmation chip only edits the preview');
assert.equal(button('Confirm entry').props.disabled,true,'The original positive with an exception now needs the rest-collected tap');
await collectRest();
await act(async()=>{tree.root.findByProps({'aria-label':'Pulse (optional)'}).props.onChange({target:{value:'78'}});});
assert.equal(writes.length,0);assert.equal(button('Confirm entry').props.disabled,false);
await act(async()=>{await visit.confirmPreview();});
assert.deepEqual(writes.map(w=>w.kind==='step'?w.command.step:w.kind),['confirmed','started','mark','collect','collect']);
const mark=writes[2];assert.ok(mark.kind==='mark');assert.deepEqual(JSON.parse(JSON.stringify(mark.command.values)),{systolic:142,diastolic:88,pulse:78});
assert.equal(writes[4].kind==='collect'&&'reason'in writes[4].command&&writes[4].command.reason,'tube broke');
assert.ok(tree.root.findByProps({'data-checklist-item':'measure:bp'}).findAllByType('p').some(p=>p.children.join('').includes('Nurse Ani')),'Saved checklist attribution stays in place');
assert.match(JSON.stringify(tree.toJSON()),/12:00/,'Audit time uses Yerevan');
await act(async()=>{await visit.send("what's next?");});assert.equal(tree.root.findAll(n=>n.props['data-visit-briefing']!==undefined).length,1,'Asking next shows one real briefing');assert.equal(visit.flow?.preview,null);
await act(async()=>tree.unmount());

await mount();await prepare();await act(async()=>visit.editPreview({...visit.flow!.preview!,confirmed:true}));await collectRest();unknownAt=3;
await act(async()=>{await visit.confirmPreview();});assert.equal(writes.length,3,'Unknown measurement stops before any collection');assert.equal(visit.frozen,true);
const uncertain=writes[2].command;
await act(async()=>{await visit.retry();});assert.equal(writes[3].command,uncertain,'Retry replays the exact command');assert.equal(writes.length,6);assert.equal(receipts.size,5,'A lost answer never duplicates a mark');assert.equal(visit.flow?.preview,null);await act(async()=>tree.unmount());

await mount();await prepare();await act(async()=>visit.editPreview({...visit.flow!.preview!,confirmed:true}));await collectRest();data.caseRevision++;
await act(async()=>{await visit.confirmPreview();});assert.equal(writes.length,0,'A revision change before Confirm stops every write');assert.ok(visit.flow?.preview,'The nurse can inspect and edit the retained preview');
await act(async()=>visit.discardPreview());assert.equal(writes.length,0);await act(async()=>tree.unmount());

await mount();await prepare();await act(async()=>visit.editPreview({...visit.flow!.preview!,confirmed:true}));await collectRest();refuseAt=3;
await act(async()=>{await visit.confirmPreview();});assert.equal(writes.length,3);assert.ok(!data.items.some(i=>i.kind==='sample'&&i.mark),'A refused mark stops before collection');assert.match(visit.flow!.error,/Saving stopped/);assert.equal((visit.flow?.preview as {samples:{testId:string;reason?:string}[]}|null|undefined)?.samples.find(s=>s.testId==='hba1c-glucose')?.reason,'tube broke','A refusal retains the unsaved exception reason');await act(async()=>tree.unmount());

await mount();await act(async()=>{await visit.send('BP 142 or 144/88');});assert.equal(tree.root.findByProps({'aria-label':'Systolic'}).props.value,'');assert.equal(button('Confirm entry').props.disabled,true);assert.equal(writes.length,0);await act(async()=>tree.unmount());
assert.ok(reads>0);
console.log('Visit briefing UI: real hook/card, editable preview, zero pre-confirm writes, explicit confirmation, ordered/revisioned writes, exception note, exact unknown replay, stale/refused stop and checklist actor/Yerevan time passed (mocked IO, no database).');

await mount();await act(async()=>visit.choose({kind:'item',item:data.items[0]}));
await act(async()=>tree.root.findByProps({'aria-label':'Systolic'}).props.onChange({target:{value:'142'}}));
await act(async()=>tree.root.findByProps({'aria-label':'Pulse (optional)'}).props.onChange({target:{value:'76'}}));
assert.equal(tree.root.findByProps({'aria-label':'Diastolic'}).props.value,'','An omitted diastolic must never be filled from pulse');
assert.equal(tree.root.findByProps({'aria-label':'Pulse (optional)'}).props.value,'76');assert.equal(button('Next').props.disabled,true);
await act(async()=>tree.root.findByProps({'aria-label':'Diastolic'}).props.onChange({target:{value:'88'}}));
await act(async()=>visit.addComment(''));
await act(async()=>visit.cancelComment());assert.equal(tree.root.findByProps({'aria-label':'Pulse (optional)'}).props.value,'76','Comment toggles retain local stepper fields');
await act(async()=>{button('Next').props.onClick();});assert.equal(writes.length,1);assert.equal(writes[0].kind==='mark'&&writes[0].command.values&&'diastolic'in writes[0].command.values&&writes[0].command.values.diastolic,88);
await act(async()=>tree.unmount());

await mount();await prepare();await act(async()=>button('I confirmed the visit with the member').props.onClick());
await act(async()=>tree.root.findByProps({'aria-label':'Diastolic'}).props.onChange({target:{value:''}}));
assert.equal(tree.root.findByProps({'aria-label':'Diastolic'}).props.value,'');assert.equal(tree.root.findByProps({'aria-label':'Pulse (optional)'}).props.value,'76');
assert.equal(button('Confirm entry').props.disabled,true,'Clearing diastolic cannot reinterpret pulse as a complete BP');assert.equal(writes.length,0);await act(async()=>tree.unmount());
console.log('BP entry regressions: out-of-order pulse, missing/cleared diastolic, disabled submission and comment-toggle field retention passed.');

for(const invalid of [' ','88 76','88/76']){
 await mount();await prepare();await act(async()=>button('I confirmed the visit with the member').props.onClick());await act(async()=>tree.root.findByProps({'aria-label':'Diastolic'}).props.onChange({target:{value:invalid}}));
 assert.equal(button('Confirm entry').props.disabled,true,`Invalid diastolic ${JSON.stringify(invalid)} cannot move pulse into pressure`);assert.equal(writes.length,0);await act(async()=>tree.unmount());
}

// A bare reply to a measurement block follows the same confirmation boundary as a compound update.
await mount();await act(async()=>visit.choose({kind:'item',item:data.items[0]}));
await act(async()=>{await visit.send(' 142 / 88 76 ');});assert.equal(writes.length,0);assert.equal(tree.root.findByProps({'aria-label':'Diastolic'}).props.value,'88');
await act(async()=>{await visit.confirmPreview();});assert.equal(writes.length,1);assert.ok(writes[0].kind==='mark'&&writes[0].command.expectUnmarked);
const saved=visit.flow!.data!.items.find(i=>i.key==='measure:bp')!;
await act(async()=>visit.choose({kind:'item',item:saved}));await act(async()=>{await visit.send('144/90');});assert.equal(writes.length,1,'An explicit edit also waits for Confirm');
await act(async()=>{await visit.confirmPreview();});assert.equal(writes.length,2);assert.ok(writes[1].kind==='mark'&&!writes[1].command.expectUnmarked,'Only an explicitly selected saved item can be replaced');await act(async()=>tree.unmount());
console.log('Typed numeric replies: same preview boundary, canonical spaced BP, and explicit saved-reading edits passed.');

// Each group retains the existing actions, and both scalar drafts survive a sibling save.
for(const l of ['en','hy','ru'] as const){
 await mount(true,l);
 data.steps.push({step:'started',at,by:'Nurse Ani'});data.items[0].mark={done:true,note:null,values:{systolic:120,diastolic:80,pulse:null},recordedAt:at,nurseName:'Nurse Ani'};
 await act(async()=>{await visit.refresh();});await act(async()=>visit.choose({kind:'item',item:data.items[1]}));
 assert.equal(tree.root.findByProps({role:'progressbar'}).props['aria-valuenow'],3);
 const weight=visitCopy(l).weightInput,waist=visitCopy(l).waistInput;
 await act(async()=>tree.root.findByProps({'aria-label':weight}).props.onChange({target:{value:'72'}}));
 await act(async()=>tree.root.findByProps({'aria-label':waist}).props.onChange({target:{value:'91'}}));
 const weightRow=tree.root.findByProps({'data-visit-item':'measure:weight'});
 await act(async()=>weightRow.findAllByType('button').find(b=>b.children.join('')===visitBlockCopy(l).next)!.props.onClick());
 assert.equal(writes.length,1);assert.equal(writes[0].kind==='mark'&&writes[0].command.item,'measure:weight');
 assert.equal(tree.root.findByProps({'aria-label':waist}).props.value,'91');
 const collected={done:true,collectionStatus:'collected' as const,note:null,values:null,recordedAt:at,nurseName:'Nurse Ani'};
 data.items[3].mark=collected;await act(async()=>{await visit.refresh();});await act(async()=>visit.choose({kind:'collection'}));
 const sampleCard=tree.root.findByProps({'data-sample-collection':true});
 assert.equal(sampleCard.findAllByType('li').length,1,'Collected samples are omitted from the work card');
 assert.equal(tree.root.findAll(n=>n.props['data-checklist-item']==='sample:lipid-panel').length,0);
 data.items[4].mark=collected;await act(async()=>{await visit.refresh();});
 assert.equal(tree.root.findByProps({'data-sample-collection':true}).findAllByType('li').length,0);
 assert.ok(JSON.stringify(tree.toJSON()).includes(visitBlockCopy(l).allCollected));
 await act(async()=>visit.view('change'));
 assert.equal(tree.root.findByProps({'data-sample-collection':true}).findAllByType('li').length,2,'Explicit answer editing keeps collected-sample corrections reachable');
 await act(async()=>tree.unmount());
}
// All done writes ordinary per-item marks, never measurements/sample facts or saved answers.
for(const l of ['en','hy','ru'] as const){
 const saved=seed();saved.steps=[{step:'confirmed',at,by:'Nurse Ani'},{step:'started',at,by:'Nurse Ani'}];
 const checks=Array.from({length:8},(_,n)=>({kind:'check' as const,key:`check:bulk-${n}`,checkId:`bulk-${n}`,section:n<4?'bp' as const:n<6?'safety' as const:'sampling' as const,version:'protocol-draft-2',label:{en:`Protocol ${n}`,hy:`Կետ ${n}`},source:'Existing protocol',mark:null}));
 saved.items.unshift(...checks);
 await mount(false,l,saved);
 const block=visitBlockCopy(l),copy=visitCopy(l);
 const section=(name:string)=>tree.root.findByProps({'data-visit-all-done-section':name});
 const all=(name:string)=>section(name).findAllByType('button').find(b=>b.children.join('')===block.allDone)!;
 const clickAll=async(name:string)=>{await act(async()=>all(name).props.onClick());};
 for(const c of checks.slice(0,6))assert.ok(section(c.section).findByProps({'data-visit-item':c.key}),'Every item and its controls stay visible');
 const html=renderToStaticMarkup(React.createElement(View,{visit,locale:l,draft:'',onAction:action=>action()}));
 assert.ok(html.includes(block.allDone));
 for(const c of checks.slice(0,6)){
  const start=html.indexOf(`data-visit-item="${c.key}"`);
  assert.ok(start>=0);
  assert.ok(html.lastIndexOf('<details',start)<html.lastIndexOf('</details>',start),'Protocol and safety items stay outside collapsed details');
 }
 await act(async()=>tree.root.findByProps({'aria-label':copy.systolic}).props.onChange({target:{value:'138'}}));
 await act(async()=>tree.root.findByProps({'aria-label':copy.diastolic}).props.onChange({target:{value:'88'}}));
 // A previously skipped item remains eligible, but saved negatives and comments do not.
 await act(async()=>section('bp').findByProps({'data-visit-item':checks[0].key}).findAllByType('button').find(b=>b.children.join('')===({'en':'Skip for now','hy':'Առայժմ բաց թողնել','ru':'Пропустить пока'}[l]))!.props.onClick());
 data.items.find(i=>i.key===checks[1].key)!.mark={done:false,note:'Keep this reason',values:null,recordedAt:at,nurseName:'Nurse Ani'};
 data.items.find(i=>i.key===checks[2].key)!.mark={done:true,note:'Keep this comment',values:null,recordedAt:at,nurseName:'Nurse Ani'};
 await act(async()=>{await visit.refresh();});
 await clickAll('bp');
 assert.deepEqual(writes.map(w=>w.kind==='mark'?w.command.item:w.kind),['check:bulk-0','check:bulk-3']);
 for(const w of writes){assert.ok(w.kind==='mark');assert.equal(w.command.done,true);assert.equal(w.command.expectUnanswered,true);assert.equal(w.command.startsAt,at);assert.equal(w.command.checklistVersion,'protocol-draft-2');assert.equal(w.command.note,null);assert.equal(w.command.values,null);}
 assert.equal(data.items.find(i=>i.key===checks[1].key)!.mark!.note,'Keep this reason');
 assert.equal(data.items.find(i=>i.key===checks[2].key)!.mark!.note,'Keep this comment');
 assert.equal(all('bp'),undefined,'Nothing left to mark means no All done button');
 assert.equal(tree.root.findByProps({'aria-label':copy.systolic}).props.value,'138','Bulk marks retain the unsaved BP');
 assert.equal(tree.root.findByProps({'aria-label':copy.diastolic}).props.value,'88');
 const undo=section('bp').findByProps({'data-visit-item':checks[0].key}).findByProps({'data-visit-undo':true});
 await act(async()=>undo.props.onClick());assert.equal(data.items.find(i=>i.key===checks[0].key)!.mark!.done,false,'Undo uses the ordinary negative mark');
 await clickAll('safety');assert.deepEqual(writes.slice(-2).map(w=>w.kind==='mark'?w.command.item:w.kind),['check:bulk-4','check:bulk-5']);
 const recorded=structuredClone(data);await act(async()=>tree.unmount());await mount(false,l,recorded);
 assert.equal(all('bp'),undefined);assert.equal(all('safety'),undefined,'Reload keeps saved answers');
 await act(async()=>visit.choose({kind:'item',item:data.items.find(i=>i.key==='check:bulk-6')!}));
 await clickAll('sampling');assert.deepEqual(writes.map(w=>w.kind==='mark'?w.command.item:w.kind),['check:bulk-6','check:bulk-7']);
 assert.ok(data.items.filter(i=>i.kind==='sample'||i.kind==='measurement').every(i=>!i.mark),'Protocol buttons cannot create measurement or sample facts');
 await act(async()=>tree.unmount());
 // Partial refusal and a lost response keep the number recorded and retry safely.
 for(const failure of ['refusal','unknown','concurrent-negative'] as const){
  await mount(false,l,saved);
  if(failure==='refusal')refuseAt=2;
  if(failure==='unknown')unknownAt=2;
  if(failure==='concurrent-negative'){
   // State changes after render, before the first bulk request. The mock database enforces the precondition.
   data.items.find(i=>i.key===checks[0].key)!.mark={done:false,note:'Another nurse comment',values:null,recordedAt:at,nurseName:'Nurse Mari'};
  }
  await clickAll('bp');
  const recordedCount=failure==='concurrent-negative'?0:1;
  assert.ok(JSON.stringify(tree.toJSON()).includes(block.allDonePartial(recordedCount,4)),'Partial failure shows recorded / requested in this language');
  const failed=writes.at(-1)!;
  const partialHtml=renderToStaticMarkup(React.createElement(View,{visit,locale:l,draft:'',onAction:action=>action()}));
  assert.ok(partialHtml.includes(block.allDonePartial(recordedCount,4)));
  await act(async()=>visit.retry());
  if(failure==='unknown')assert.equal(writes[2].command,failed.command,'Lost response retries the exact submission');
  assert.equal(data.items.find(i=>i.key===checks[0].key)!.mark!.note,failure==='concurrent-negative'?'Another nurse comment':null);
  assert.ok(data.items.filter(i=>i.kind==='check'&&i.section==='bp').every(i=>i.mark),'Retry accounts for every item');
  assert.equal(receipts.size,failure==='concurrent-negative'?3:4,'Retry creates at most one receipt per unanswered item');
  assert.equal(all('bp'),undefined);
  await act(async()=>tree.unmount());
 }
}
console.log('All done: visible sections, one-press ordinary marks, skips, preserved answers/comments, Undo, reload and partial/unknown retries passed in en/hy/ru (mocked IO).');

// Closed visits cannot offer acknowledgements for hidden, unanswered checks.
for(const state of ['completed','cancelled'] as const){
 const saved=seed();saved.items.unshift({kind:'check',key:'check:terminal-sampling',checkId:'terminal-sampling',section:'sampling',version:'protocol-draft-2',label:{en:'Sampling instruction',hy:'Նմուշառման կարգ'},source:'Existing protocol',mark:null});
 if(state==='cancelled')saved.visit.bookingStatus='cancelled';
 else saved.completion={completedAt:at,nurseName:'Nurse Ani',reason:'Remaining checks were not performed',summary:saved.counts,visitId:id};
 await mount(false,'en',saved);
 assert.ok(!button(visitBlockCopy('en').allDone),`${state} visits must not offer an inert All done action`);
 assert.equal(writes.length,0);await act(async()=>tree.unmount());
}

// A slow first command must hold the queue and controls until its outcome is known.
{
 const saved=seed();saved.steps=[{step:'confirmed',at,by:'Nurse Ani'},{step:'started',at,by:'Nurse Ani'}];
 saved.items.unshift(...['first','second'].map(name=>({kind:'check' as const,key:`check:serial-${name}`,checkId:`serial-${name}`,section:'bp' as const,version:'protocol-draft-2',label:{en:name,hy:name},source:'Existing protocol',mark:null})));
 await mount(false,'en',saved);holdAt=1;
 let saving!:Promise<void>;
 await act(async()=>{saving=visit.allDone('bp');});
 assert.equal(writes.length,1,'The next mark waits for the first response');
 assert.equal(visit.frozen,true);
 assert.ok(tree.root.findByProps({'data-visit-all-done-section':'bp'}).findAllByType('button').every(b=>b.props.disabled),'All controls stay disabled during the queue');
 await act(async()=>{await visit.allDone('bp');await visit.answer(true);});
 assert.equal(writes.length,1,'A repeated press cannot start another queue or individual mark');
 await act(async()=>{releaseWrite!();await saving;});
 assert.equal(writes.length,2);assert.equal(visit.frozen,false);
 const bulk=writes[0];assert.ok(bulk.kind==='mark');
 const bulkCommand=bulk.command;
 await act(async()=>tree.unmount());await mount(false,'en',saved);
 await act(async()=>visit.choose({kind:'item',item:data.items[0]}));await act(async()=>visit.answer(true));
 const individual=writes[0];assert.ok(individual.kind==='mark');
 const {submissionId:bulkId,expectUnanswered:precondition,...bulkFields}=bulkCommand;
 const {submissionId:tapId,...tapFields}=individual.command;
 assert.notEqual(bulkId,tapId);assert.equal(precondition,true);assert.deepEqual(bulkFields,tapFields,'All done uses the same ordinary per-item command fields as a single Done tap');
 await act(async()=>tree.unmount());
}
console.log('All done sequential writes: slow response, disabled controls, double press and identical single-tap payload passed (mocked IO).');

// #752: a saved typed BP remains visible while only protocol/safety work is pending.
for(const l of ['en','hy','ru'] as const){
 const saved=seed();saved.steps=[{step:'confirmed',at,by:'Nurse Ani'},{step:'started',at,by:'Nurse Ani'}];
 saved.items=saved.items.filter(i=>i.kind!=='measurement'||i.field==='bp');
 const checks=Array.from({length:6},(_,n)=>({kind:'check' as const,key:`check:pending-${n}`,checkId:`pending-${n}`,section:n<4?'bp' as const:'safety' as const,version:'protocol-draft-2',label:{en:`Check ${n}`,hy:`Կետ ${n}`,ru:`Пункт ${n}`},source:'Existing protocol',mark:null}));
 saved.items.unshift(...checks);
 await mount(false,l,saved);
 const copy=visitCopy(l),block=visitBlockCopy(l);
 const bpRow=()=>tree.root.findByProps({'data-visit-item':'measure:bp'});
 const next=()=>bpRow().findAllByType('button').find(b=>b.children.join('')===block.next)!;
 for(const [label,value] of [[copy.systolic,'138'],[copy.diastolic,'88'],[copy.optionalPulse,'72']])await act(async()=>tree.root.findByProps({'aria-label':label}).props.onChange({target:{value}}));
 assert.equal(next().props.disabled,true,'Next must explain and wait for unmarked protocol/safety items');
 const hint=()=>tree.root.findByProps({'data-visit-bp-pending':true});
 assert.ok(hint().children.join('').includes('6'));
 assert.equal(next().props['aria-describedby'],hint().props.id);
 await act(async()=>next().props.onClick());assert.equal(writes.length,0,'Even repeated Next cannot save while blocked');
 await act(async()=>visit.send('138/88, pulse 72'));
 assert.equal(writes.length,0);await act(async()=>visit.confirmPreview());
 assert.equal(writes.length,1);assert.equal(tree.root.findByProps({'aria-label':copy.systolic}).props.value,'138');
 assert.equal(tree.root.findByProps({'aria-label':copy.diastolic}).props.value,'88');
 assert.equal(tree.root.findByProps({'aria-label':copy.optionalPulse}).props.value,'72');
 assert.equal(tree.root.findByProps({role:'progressbar'}).props['aria-valuenow'],2,'BP is correctly current until the six outstanding checks are answered');
 assert.equal(next().props.disabled,true);
 for(let n=0;n<3;n++)await act(async()=>next().props.onClick());
 assert.equal(writes.length,1,'The recorded reading must not be re-saved on Next');
 const Fields=(modules['./visit-fields'] as typeof import('@/components/nurse-chat-v2/visit-fields')).VisitMeasurementBlock;
 const recordedBp=visit.flow!.data!.items.find((i):i is Extract<typeof i,{kind:'measurement'}>=>i.kind==='measurement'&&i.field==='bp')!;
 const html=renderToStaticMarkup(React.createElement(Fields,{item:recordedBp,locale:l,disabled:false,pendingChecks:6,onNext(){throw Error('Static render cannot save');}}));
 assert.ok(html.includes('data-visit-bp-pending="true"'));assert.ok(html.includes(hint().children.join('')),'Static render keeps the translated missing count');
 // Per-item Done/Not done and comments stay available, including an explicit negative.
 for(const [index,check] of checks.entries()){
  await act(async()=>visit.choose({kind:'item',item:visit.flow!.data!.items.find(i=>i.key===check.key)!}));
  await act(async()=>visit.answer(index!==0));
  if(index===0)assert.ok(hint().children.join('').includes('5'),'A recorded Not done is accounted for, never silently marked Done');
 }
 assert.equal(tree.root.findByProps({'data-visit-group':'samples'}).props['data-visit-group'],'samples','The saved BP needs no extra save to advance');
 assert.equal(writes.filter(w=>w.kind==='mark'&&w.command.item==='measure:bp').length,1);
 await act(async()=>tree.unmount());
 // An explicitly revisited saved measurement is inert until its value changes.
 const recorded=structuredClone(data);await mount(false,l,recorded);
 await act(async()=>visit.choose({kind:'item',item:visit.flow!.data!.items.find(i=>i.key==='measure:bp')!}));
 assert.equal(next().props.disabled,true);
 await act(async()=>next().props.onClick());assert.equal(writes.length,0);
 assert.ok(button(copy.goBack),'An unchanged inspection needs an exit without changing data');
 await act(async()=>button(copy.goBack).props.onClick());assert.equal(writes.length,0);
 assert.equal(visit.flow!.editing,null);
 await act(async()=>visit.choose({kind:'item',item:visit.flow!.data!.items.find(i=>i.key==='measure:bp')!}));
 await act(async()=>tree.root.findByProps({'aria-label':copy.systolic}).props.onChange({target:{value:'139'}}));
 assert.equal(next().props.disabled,false);await act(async()=>next().props.onClick());
 assert.equal(writes.length,1);
 await act(async()=>tree.unmount());
}
console.log('#752: counted disabled Next, saved typed BP, no repeat saves, explicit edits and automatic group advance passed in en/hy/ru (mocked IO).');
