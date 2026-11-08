import * as bpUnits from '@/lib/bp-unit';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import * as contract from '@/lib/staff/visit-evidence-schema';
import type {VisitEvidenceProps,VisitCommand,VisitCommandResult,VisitRefreshResult,VisitRefreshInput,VisitRead} from '@/lib/staff/visit-evidence-schema';
import * as measuredAt from '@/lib/patient/measured-at';
import * as realLocaleModule from '@/lib/locale';
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const exports:Record<string,unknown>={},require=createRequire(import.meta.url);
const code=ts.transpileModule(readFileSync('components/staff/visit-evidence.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
vm.runInNewContext(code,{exports,structuredClone,require(name:string){if(name==='@/lib/bp-unit')return bpUnits;if(name==='react')return React;if(name==='react/jsx-runtime')return jsx;if(name==='lucide-react')return require(name);if(name==='./bp-high-warning')return {BpHighWarning:()=>null};if(name==='./shell')return {fieldClass:'field',buttonClass:'button'};if(name==='@/lib/staff/visit-evidence-schema')return contract;if(name==='@/lib/patient/measured-at')return measuredAt;if(name==='@/lib/locale')return realLocaleModule;throw Error(name);}});
const {VisitEvidence}=exports as typeof import('../components/staff/visit-evidence');
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const booking={version:'booking-visit-context-v1' as const,appointmentId:id(5),acceptedRevision:2,tests:[{id:'cbc',title:'Complete blood count',method:'lab' as const},{id:'ecg',title:'ECG',method:'clinic' as const}]};
const data:VisitRead={version:'visit-evidence-v1',memberId:id(1),revision:4,bookingContext:booking,collectionAvailability:'available',visits:[{id:id(3),createdAt:'2026-10-16T06:00:00Z',bookingContext:booking,entries:[]}]};
const commands:VisitCommand[]=[],refreshInputs:VisitRefreshInput[]=[];let result:VisitCommandResult={status:'outcome-unknown'},refreshResult:VisitRefreshResult={status:'unavailable'},deferred:((value:VisitCommandResult)=>void)|null=null;
const command=async(input:VisitCommand)=>{commands.push(input);if(deferred)return new Promise<VisitCommandResult>(resolve=>{deferred=resolve;});return result;};
const props=():VisitEvidenceProps=>({data,locale:'en',actorScope:'synthetic-session-A',canRecord:true,visitId:id(3),openSubmissionId:id(10),appendSubmissionId:id(11),command,refresh:async input=>{refreshInputs.push(input);return refreshResult;}});
const trees:ReactTestRenderer[]=[];
async function mount(p=props()){let tree!:ReactTestRenderer;await act(async()=>{tree=create(React.createElement(VisitEvidence,p));});trees.push(tree);return tree;}
async function change(tree:ReactTestRenderer,label:string,value:string){await act(async()=>tree.root.findByProps({'aria-label':label}).props.onChange({target:{value}}));}
async function fill(tree:ReactTestRenderer){await change(tree,'Observed at','2026-10-16T10:00');await change(tree,'Height','172.5');}
async function submit(tree:ReactTestRenderer){await act(async()=>tree.root.findByType('form').props.onSubmit({preventDefault(){}}));}
const button=(tree:ReactTestRenderer,text:string)=>tree.root.findAllByType('button').find(node=>node.children.filter(child=>typeof child==='string').join('').includes(text))!;
try{
 // Scalar plausibility uses nurse validation bounds as advice only in this permissive form.
 for(const locale of ['en','hy','ru'] as const){
  const labels={en:['Weight','Waist','Observed at'],hy:['Քաշ','Գոտկատեղ','Դիտարկման ժամանակը'],ru:['Вес','Окружность талии','Время наблюдения']}[locale];
  const warning=await mount({...props(),locale});
  const notices=()=>warning.root.findAll(node=>node.type==='p'&&node.props['data-measurement-recheck']);
  assert.equal(notices().length,0,'Empty fields have no warning');
  await change(warning,labels[2],'2026-10-16T10:00');
  await change(warning,labels[0],'150');await change(warning,labels[1],'170');
  assert.equal(notices().length,0,'150 kg and 170 cm are within existing nurse bounds; no new threshold is invented');
  await change(warning,labels[0],'401');await change(warning,labels[1],'251');
  assert.equal(notices().length,2,`${locale}: out-of-range scalars ask for a recheck`);
  assert.match(JSON.stringify(notices()[0].props.children),locale==='en'?/Recheck/:locale==='hy'?/ստուգեք/:/Перепроверьте/);
  assert.equal(warning.root.findByProps({'aria-label':labels[0]}).props['aria-invalid'],false,'Advice is not a validation error');
  assert.ok(warning.root.findByProps({'aria-label':labels[0]}).props['aria-describedby'].includes(notices()[0].props.id),'Advice is associated with the field');
  const before=commands.length;await submit(warning);assert.equal(commands.length,before+1,'Recheck advice does not block saving');
  const saved=commands.at(-1)!;assert.equal(saved.op,'append-evidence');if(saved.op==='append-evidence')assert.deepEqual(saved.entries.filter(e=>e.kind==='observation'&&e.state==='known').map(e=>e.state==='known'?e.value:null),[401,251],'Entered values are retained without clamping');
  const corrected=await mount({...props(),locale});
  for(const [field,lo,hi] of [[labels[0],20,400],[labels[1],30,250]] as const){
   for(const value of [String(lo),String(hi)]){await change(corrected,field,value);assert.equal(corrected.root.findAllByProps({'data-measurement-recheck':true}).length,0,'Inclusive bounds do not warn');}
   await change(corrected,field,String(lo-1));assert.equal(corrected.root.findAllByProps({'data-measurement-recheck':true}).length,1,'Below lower bound warns');
   for(const value of ['', '-', '1.']){await change(corrected,field,value);assert.equal(corrected.root.findAllByProps({'data-measurement-recheck':true}).length,0,'Empty or incomplete input does not show plausibility advice');}
  }
 }
 commands.length=0;
 const tree=await mount();assert.equal(tree.root.findByProps({'aria-label':'Height'}).props.value,'');assert.equal(tree.root.findByProps({'aria-label':'Complete blood count'}).props.value,'');await fill(tree);await submit(tree);assert.equal(commands.length,1);assert.equal(commands[0].submissionId,id(11));assert.equal(commands[0].op,'append-evidence');if(commands[0].op==='append-evidence'){assert.equal(commands[0].entries.length,1);assert.equal(commands[0].entries[0].kind,'observation');assert.equal(commands[0].entries[0].observedAt,'2026-10-16T10:00:00+04:00');}
 await submit(tree);assert.equal(commands.length,1,'Unknown blocks repeated rendered submit invocation');assert.equal(tree.root.findByProps({'aria-label':'Height'}).props.value,'172.5');
 // Ordinary RSC regeneration cannot replace frozen payload or IDs after unknown.
 await act(async()=>tree.update(React.createElement(VisitEvidence,{...props(),appendSubmissionId:id(12),data:{...data,revision:5}})));await submit(tree);assert.equal(commands.length,1);assert.equal(tree.root.findByProps({'aria-label':'Height'}).props.value,'172.5');
 refreshResult={status:'loaded',data:{...data,revision:5},receipt:null};await act(async()=>button(tree,'Check saved evidence').props.onClick());assert.equal(tree.root.findAllByProps({type:'submit'}).length,0,'Generic read without serialized receipt cannot unlock unknown');assert.deepEqual(JSON.parse(JSON.stringify(refreshInputs.at(-1))),{id:id(1),visitId:id(3),command:JSON.parse(JSON.stringify(commands[0]))},'Recovery receives exact frozen op/revision/payload despite new RSC IDs');assert.equal(commands.length,1,'Refresh never executes the supplied command');assert.equal(button(tree,'Use current context'),undefined);
 refreshResult={status:'loaded',data:{...data,revision:5},receipt:{status:'unknown',submissionId:id(11)}};await act(async()=>button(tree,'Check saved evidence').props.onClick());assert.equal(button(tree,'Use current context'),undefined);
 refreshResult={status:'loaded',data:{...data,revision:5},receipt:{status:'not-recorded',submissionId:id(11),serialized:true}};await act(async()=>button(tree,'Check saved evidence').props.onClick());assert.equal(button(tree,'Continue with my entries').props.disabled,false);assert.equal(commands.length,1,'Recovery never auto-retries');await act(async()=>button(tree,'Continue with my entries').props.onClick());assert.equal(tree.root.findByProps({'aria-label':'Height'}).props.value,'172.5','Explicit not-recorded recovery retains the existing draft');await fill(tree);result={status:'invalid',issues:[{path:'entries',message:'Synthetic invalid'}]};await submit(tree);assert.equal(commands.at(-1)!.submissionId,id(12),'New ID used only after explicit resolved context');assert.equal(tree.root.findByProps({type:'submit'}).props.disabled,false,'Known invalid is editable');
 // Pending duplicate event calls and late response after actor/member change.
 const race=await mount();await fill(race);deferred=()=>{};let pending!:Promise<void>;const before=commands.length;await act(async()=>{pending=race.root.findByType('form').props.onSubmit({preventDefault(){}});race.root.findByType('form').props.onSubmit({preventDefault(){}});});assert.equal(commands.length,before+1);await act(async()=>race.update(React.createElement(VisitEvidence,{...props(),actorScope:'synthetic-session-B',data:{...data,memberId:id(20)}})));await act(async()=>{deferred!({status:'saved',submissionId:id(11),visitId:id(3),revision:5,entryIds:[id(22)],replayed:false});await pending;});deferred=null;assert.equal(race.root.findByProps({'aria-label':'Height'}).props.value,'');assert.equal(race.root.findAllByProps({role:'alert'}).length,0,'Old identity cannot receive late status or draft');
 // A revision refresh during an in-flight command cannot apply a late response.
 const refreshed=await mount();await fill(refreshed);deferred=()=>{};await act(async()=>{refreshed.root.findByType('form').props.onSubmit({preventDefault(){}});});await act(async()=>refreshed.update(React.createElement(VisitEvidence,{...props(),data:{...data,revision:6},appendSubmissionId:id(44)})));await act(async()=>deferred!({status:'saved',submissionId:id(11),visitId:id(3),revision:5,entryIds:[id(24)],replayed:false}));deferred=null;assert.equal(refreshed.root.findAllByProps({type:'submit'}).length,0);assert.equal(refreshed.root.findByProps({'aria-label':'Height'}).props.value,'172.5');assert.ok(!JSON.stringify(refreshed.toJSON()).includes('Evidence recorded.'),'Late response does not announce stale save after refresh');
 // Old visit context cannot collect against a new accepted version, but pulse remains useful.
 const stale=await mount({...props(),data:{...data,bookingContext:{...booking,acceptedRevision:3}}});assert.equal(stale.root.findAllByProps({'aria-label':'Complete blood count'}).length,0);await change(stale,'Observed at','2026-10-16T10:00');await change(stale,'Pulse','72');await submit(stale);const last=commands.at(-1)!;assert.equal(last.op,'append-evidence');if(last.op==='append-evidence')assert.equal(last.entries.length,1);
 const collection=await mount();await change(collection,'Observed at','2026-10-16T10:00');await change(collection,'Complete blood count','not-collected');await change(collection,'Complete blood count Reason','No sample obtained');await submit(collection);const collected=commands.at(-1)!;if(collected.op==='append-evidence')assert.deepEqual(JSON.parse(JSON.stringify(collected.entries)),[{kind:'collection',observedAt:'2026-10-16T10:00:00+04:00',appointmentId:id(5),acceptedRevision:2,testId:'cbc',outcome:'not-collected',reason:'No sample obtained'}]);
 const unlinkedExisting=await mount({...props(),data:{...data,visits:[{...data.visits[0],bookingContext:null}]}});assert.equal(unlinkedExisting.root.findAllByProps({'aria-label':'Complete blood count'}).length,0,'Explicitly unlinked existing visit cannot inherit current booking');
 // Direct input preserves exact invalid text and never invokes the action or silently omits it.
 const raw=await mount();await change(raw,'Observed at','2026-10-16T10:00');for(const value of ['1.','0x10',' ','-','1e3']){await change(raw,'Height',value);const count:number=commands.length;await submit(raw);assert.equal(commands.length,count);assert.equal(raw.root.findByProps({'aria-label':'Height'}).props.value,value);assert.equal(raw.root.findByProps({'aria-label':'Height'}).props['aria-invalid'],true);}
 await change(raw,'Height','');await submit(raw);assert.ok(JSON.stringify(raw.toJSON()).includes('Enter a measurement, a collection outcome or a note.'));
 await act(async()=>button(raw,'Mark a measurement unknown').props.onClick());await change(raw,'Choose a measurement','neck');await change(raw,'Reason','Not measured');assert.equal(raw.root.findAllByProps({'aria-label':'Neck'}).length,1,'Choosing a field does not mark unknown before Add');await act(async()=>button(raw,'Add').props.onClick());assert.equal(raw.root.findAllByProps({'aria-label':'Neck'}).length,0);await act(async()=>button(raw,'Clear Neck').props.onClick());assert.equal(raw.root.findByProps({'aria-label':'Neck'}).props.value,'');await change(raw,'Choose a measurement','neck');assert.equal(raw.root.findByProps({'aria-label':'Reason'}).props.value,'Not measured','Clear keeps reason draft but returns field to omitted');
 await act(async()=>button(raw,'Change time zone').props.onClick());await change(raw,'Time zone offset','bad');await change(raw,'Height','172');await submit(raw);assert.equal(raw.root.findByProps({'aria-label':'Time zone offset'}).props['aria-invalid'],true);
 const missing=await mount();await change(missing,'Height','170');await submit(missing);assert.equal(missing.root.findByProps({'aria-label':'Observed at'}).props['aria-invalid'],true);
 const correction=await mount();await change(correction,'Height','-');await submit(correction);await change(correction,'Observed at','2026-10-16T10:00');assert.equal(correction.root.findByProps({'aria-label':'Observed at'}).props['aria-invalid'],false,'Corrected time clears only its stale error');assert.equal(correction.root.findByProps({'aria-label':'Height'}).props['aria-invalid'],true);assert.equal(correction.root.findByProps({'aria-label':'Height'}).props.value,'-');
 const historical={id:id(50),submissionId:id(51),observedAt:'2026-10-16T11:00:00+05:00',observedInstant:'2026-10-16T06:00:00Z',recordedAt:'2026-10-17T01:05:00+04:00',actor:{id:id(52),name:'Distinct actor',role:'nurse' as const,clinicId:id(53)},source:'staff-entered' as const,payload:{kind:'observation' as const,field:'height' as const,state:'known' as const,value:170,unit:'cm' as const,observedAt:'2026-10-16T11:00:00+05:00'},measurementId:null};
 for(const locale of ['en','hy','ru'] as const)for(const linked of [true,false]){
  const entries=(['systolic','diastolic'] as const).map((field,index)=>({...historical,id:id(60+index),measurementId:linked?id(62):null,payload:{...historical.payload,field,value:index===0?148:93,unit:'mmHg' as const}}));
  const bp=await mount({...props(),locale,canRecord:false,data:{...data,visits:[{...data.visits[0],entries}]}});
  const text=JSON.stringify(bp.toJSON()),unit={en:'mmHg',hy:'մմ ս.ս.',ru:'мм рт. ст.'}[locale];
  assert.ok(text.includes(unit),`Visit history BP unit in ${locale}, linked=${linked}`);
  if(locale!=='en')assert.ok(!text.includes('mmHg'),'No English BP unit in localized visit history');
 }
 const history=await mount({...props(),canRecord:false,data:{...data,visits:[{...data.visits[0],entries:[historical,{...historical,id:id(54),observedAt:'2026-10-16T10:00:00+04:00',payload:{...historical.payload,observedAt:'2026-10-16T10:00:00+04:00'},actor:{...historical.actor,id:id(55),name:'Other actor'}}]}]}});const historyText=JSON.stringify(history.toJSON());assert.ok(historyText.includes('11:00 UTC+05:00'));assert.ok(historyText.includes('10:00 UTC+04:00'));assert.ok(historyText.includes('17 Oct 2026'));assert.ok(historyText.includes('Distinct actor'));assert.ok(historyText.includes('Other actor'));assert.equal(history.root.findAllByType('li').length,2,'Same submission does not collapse distinct attribution/instants');await act(async()=>button(history,'Exact times').props.onClick());assert.ok(JSON.stringify(history.toJSON()).includes('2026-10-16T11:00:00+05:00'));
 const opening=await mount({...props(),data:{...data,visits:[]},command:async input=>{commands.push(input);return {status:'saved',submissionId:input.submissionId,visitId:input.visitId,revision:input.revision+1,entryIds:[],replayed:false};}});await act(async()=>button(opening,'Start new visit').props.onClick());assert.equal(opening.root.findByProps({type:'submit'}).props.disabled,false,'Confirmed open receipt permits append under its new revision');await fill(opening);await submit(opening);assert.equal(commands.at(-1)!.revision,5);assert.equal(commands.at(-1)!.submissionId,id(11),'Open and append use distinct pinned server IDs');
 const unsupported=await mount({...props(),data:{...data,version:'old'} as unknown as VisitRead});assert.equal(unsupported.root.findAllByType('form').length,0);assert.equal(unsupported.root.findAllByProps({role:'alert'}).length,1,'Unsupported read model fails visibly');
 const doctor=await mount({...props(),canRecord:false});assert.equal(doctor.root.findAllByType('form').length,0);
 const access=await mount();await fill(access);await act(async()=>access.update(React.createElement(VisitEvidence,{...props(),canRecord:false})));assert.equal(access.root.findAllByType('form').length,0,'Role guard change clears old entry UI');
 console.log('Visit UI injected-port checks PASS: no defaults, exact partial payload/offset, unknown repeated-submit guard, frozen RSC IDs/draft, serialized receipt recovery, explicit new context, invalid edit, pending duplicate, late identity fencing, accepted-version mismatch, collection evidence, doctor read-only. Component fixture only.');
}finally{for(const tree of trees)await act(async()=>tree.unmount());}
