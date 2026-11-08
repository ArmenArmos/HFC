import assert from 'node:assert/strict';
import {suggestResolution,type ResolutionRecord} from '@/lib/care-alerts/resolution-suggestion';
import type {CareAlert} from '@/lib/care-alerts/contracts';
const member='22222222-2222-4222-8222-222222222222',id='11111111-1111-4111-8111-111111111111',at='2026-11-07T08:00:00Z';
const alert={id,memberId:member,createdAt:at,nextAction:'Call tomorrow',acknowledgedAt:null,acknowledgedBy:null} as ResolutionRecord['alert'];
const reply={id:'reply',memberId:member,at:'2026-11-07T09:00:00Z',by:'Nurse Example',kind:'reply' as const,state:'in_app' as const};
const record:ResolutionRecord={alert,cycleStartedAt:at,contacts:[]};
const privateNotes=['PRIVATE DOCTOR HANDOVER INSTRUCTIONS','PRIVATE OTHER STAFF RESOLUTION NOTE'];
for(const l of ['en','hy','ru'] as const){
 assert.equal(suggestResolution(record,l).outcome,'','Next action never proves contact');
 assert.equal(suggestResolution({...record,alert:{...alert,nextAction:null}},l).outcome,'');
 const contact=suggestResolution({...record,contacts:[reply]},l);
 assert.equal(contact.outcome,'member_contacted');assert.ok(contact.reason.includes('Nurse Example'));assert.ok(contact.reason.includes('"Call tomorrow"'));
 assert.equal(suggestResolution({...record,contacts:[{...reply,state:'accepted_by_provider'}]},l).outcome,'member_contacted');
 assert.equal(suggestResolution({...record,alert:{...alert,nextAction:'Emergency care advised. No action needed.'}},l).outcome,'','Never infer an outcome from free text');
 for(const state of ['queued','definitely_failed','unknown','held','sending'])assert.equal(suggestResolution({...record,contacts:[{...reply,state}]},l).outcome,'');
 for(const bad of [{memberId:id},{at:'2026-11-06T09:00:00Z'},{at:'invalid'},{at},{by:''}])assert.equal(suggestResolution({...record,contacts:[{...reply,...bad}]},l).outcome,'');
 assert.equal(suggestResolution({...record,contacts:[{...reply,kind:'task',state:'reached'}]},l).outcome,'member_contacted');
 assert.equal(suggestResolution({...record,contacts:[{...reply,kind:'task',state:'contact-attempted'}]},l).outcome,'');
 const withPrivateNotes={...record,contacts:[reply],notes:privateNotes.map(text=>({by:'Doctor',at:reply.at,text,memberId:member}))};
 const privateSuggestion=suggestResolution(withPrivateNotes,l);
 for(const text of privateNotes)assert.ok(!privateSuggestion.reason.includes(text),'Private notes never enter the proposed reason');
 assert.ok(privateSuggestion.reason.length<=1000);
 // Reader output after acknowledgement, contact, then reopening: createdAt stays original.
 const reopened={...record,cycleStartedAt:'2026-11-07T10:00:00Z',alert:{...alert,acknowledgedAt:'2026-11-07T08:30:00Z',acknowledgedBy:'Nurse Example'}};
 assert.equal(suggestResolution({...reopened,contacts:[]},l).outcome,'','No contact in the reopened reader snapshot');
 for(const evidence of [reply,{...reply,state:'accepted_by_provider'},{...reply,kind:'task' as const,state:'reached'}]){
  assert.equal(suggestResolution({...reopened,contacts:[evidence]},l).outcome,'','A previous-cycle contact must not preselect member contacted');
  assert.equal(suggestResolution({...reopened,contacts:[{...evidence,at:reopened.cycleStartedAt}]},l).outcome,'','Contact at the cycle boundary is not after it');
  assert.equal(suggestResolution({...reopened,contacts:[{...evidence,at:'2026-11-07T10:01:00Z'}]},l).outcome,'member_contacted','A new-cycle contact qualifies');
 }
}
console.log('Resolve suggestions: contact, no contact, next action only, failed/old/foreign replies, reopened cycles and private-note exclusion passed in en/hy/ru.');

// Real form and hooks with a substituted record read, no database/browser/network.
const React=await import('react');
const {act,create}=await import('react-test-renderer');
const {renderToStaticMarkup}=await import('react-dom/server');
const {resolveTestModule}=await import('./care-alert-resolve-test-module');
const {suggestedFromRecord,noContactRecorded}=await import('@/lib/care-alerts/resolution-suggestion');
(globalThis as unknown as {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const fullAlert={...alert,resolutionNote:null,stateSeq:7,state:'open'} as CareAlert;
const fullRecord={...record,alert:fullAlert,closer:'Signed-in closer',contacts:[reply]};
let reads=0,result:ResolutionRecord|null=fullRecord;
const {CareAlertResolve,CareAlertResolutionForm}=resolveTestModule(async()=>{reads++;return result;});
for(const locale of ['en','hy','ru'] as const){
 const submitted:FormData[]=[];
 let tree!:ReturnType<typeof create>;
 await act(async()=>{tree=create(React.createElement(CareAlertResolutionForm,{alert:fullAlert,locale,closer:'Signed-in closer',initialRecord:fullRecord,onConfirm:form=>submitted.push(form)}));});
 const labels=()=>tree.root.findAll(node=>node.props['data-suggested']!==undefined).map(n=>n.props['data-suggested']);
 assert.deepEqual(labels(),['outcome','reason']);assert.equal(submitted.length,0);assert.equal(tree.root.findByType('select').props.value,'member_contacted');
 assert.ok(renderToStaticMarkup(React.createElement(CareAlertResolutionForm,{alert:fullAlert,locale,initialRecord:fullRecord})).includes(suggestedFromRecord(locale)));
 await act(async()=>tree.root.findByType('select').props.onChange({target:{value:'other'}}));assert.deepEqual(labels(),['reason']);
 await act(async()=>tree.root.findByType('textarea').props.onChange({target:{value:'My factual reason'}}));assert.deepEqual(labels(),[]);
 assert.equal(submitted.length,0,'Edits do not submit');
 const form=new FormData();form.set('alertId',id);form.set('seq','7');form.set('resolution','other');form.set('note','My factual reason');
 await act(async()=>tree.root.findByType('form').props.onSubmit({preventDefault(){},currentTarget:form}));
 assert.equal(submitted.length,1);assert.deepEqual(Object.fromEntries(submitted[0]),{alertId:id,seq:'7',resolution:'other',note:'My factual reason'});
 await act(async()=>tree.unmount());
 const accepted:FormData[]=[];
 await act(async()=>{tree=create(React.createElement(CareAlertResolutionForm,{alert:fullAlert,locale,initialRecord:fullRecord,onConfirm:form=>accepted.push(form)}));});
 const suggested=new FormData();suggested.set('alertId',id);suggested.set('seq','7');suggested.set('resolution','member_contacted');suggested.set('note',suggestResolution(fullRecord,locale).reason);
 await act(async()=>tree.root.findByType('form').props.onSubmit({preventDefault(){},currentTarget:suggested}));
 assert.equal(accepted.length,1,'An unchanged suggestion needs one explicit confirm');
 assert.equal(accepted[0].get('resolution'),'member_contacted');assert.equal(accepted[0].get('note'),suggestResolution(fullRecord,locale).reason);
 await act(async()=>tree.unmount());
 const empty=renderToStaticMarkup(React.createElement(CareAlertResolutionForm,{alert:fullAlert,locale,initialRecord:{...fullRecord,contacts:[]}}));assert.ok(empty.includes(noContactRecorded(locale)));assert.ok(!empty.includes('data-suggested="outcome"'));
}
let tree!:ReturnType<typeof create>,confirmed=0;
await act(async()=>{tree=create(React.createElement(CareAlertResolve,{alert:fullAlert,locale:'en',onConfirm:()=>{confirmed++;}}));});
assert.equal(reads,0,'Closed forms do not read');
await act(async()=>tree.root.findByType('details').props.onToggle({currentTarget:{open:true}}));
assert.equal(reads,1);assert.equal(confirmed,0,'A successful read never submits');assert.equal(tree.root.findByType('select').props.value,'member_contacted');
await act(async()=>tree.unmount());
for(const contacts of [[],[reply],[{...reply,at:'2026-11-07T10:01:00Z'}]]){
 const readerResult={...fullRecord,cycleStartedAt:'2026-11-07T10:00:00Z',contacts,notes:privateNotes.map(text=>({memberId:member,by:'Doctor',at:reply.at,text}))};
 result=readerResult;
 await act(async()=>{tree=create(React.createElement(CareAlertResolve,{alert:fullAlert,locale:'en',onConfirm:()=>{confirmed++;}}));});
 await act(async()=>tree.root.findByType('details').props.onToggle({currentTarget:{open:true}}));
 assert.equal(tree.root.findByType('select').props.value,contacts[0]?.at==='2026-11-07T10:01:00Z'?'member_contacted':'','Lazy reader uses the reopened cycle before preselecting contact');
 for(const text of privateNotes)assert.ok(!tree.root.findByType('textarea').props.value.includes(text),'Private mocked reader notes stay out of the form');
 assert.equal(confirmed,0,'Reopened-cycle reads never submit');
 await act(async()=>tree.unmount());
}
for(const kind of ['unavailable','changed','foreign'] as const){
 result=kind==='unavailable'?null:{...fullRecord,alert:{...fullAlert,...(kind==='changed'?{stateSeq:8}:{memberId:id})}};
 await act(async()=>{tree=create(React.createElement(CareAlertResolve,{alert:fullAlert,locale:'en',onConfirm:()=>{confirmed++;}}));});
 await act(async()=>tree.root.findByType('details').props.onToggle({currentTarget:{open:true}}));
 assert.equal(tree.root.findByType('select').props.value,'');assert.equal(confirmed,0);
 assert.equal(tree.root.findByType('fieldset').props.disabled,kind!=='unavailable','Only unavailable reads permit manual resolution');
 await act(async()=>tree.unmount());
}
console.log('Resolve form: three locales, lazy read, separate edit claims, explicit confirm, unchanged payload, failed/stale/foreign snapshots and no auto-submit passed.');

const {readFileSync}=await import('node:fs');const vm=await import('node:vm');const ts=await import('typescript');
const jsx=await import('react/jsx-runtime'),copy=await import('@/lib/staff/staff-locale-copy');
const cardExports:Record<string,unknown>={};
const cardModules:Record<string,unknown>={react:React,'react/jsx-runtime':jsx,'@/components/staff/chat-member-identity':{useChatMemberIdentity:()=>({id:member})},'@/lib/staff-zoe/outcome-copy':{},'@/lib/staff/staff-locale-copy':copy,'@/components/staff/care-alert-resolve':resolveTestModule(async()=>fullRecord),'./conversation':{ReplyOutcome:()=>null}};
vm.runInNewContext(ts.default.transpileModule(readFileSync('components/doctor-chat-v2/alerts.tsx','utf8'),{compilerOptions:{module:ts.default.ModuleKind.CommonJS,target:ts.default.ScriptTarget.ES2022,jsx:ts.default.JsxEmit.ReactJSX}}).outputText,{exports:cardExports,require:(name:string)=>{assert.ok(name in cardModules,name);return cardModules[name];}});
const Card=cardExports.AlertButtons as typeof import('@/components/doctor-chat-v2/alerts').AlertButtons;
const item={memberId:member,alert:fullAlert} as Parameters<typeof Card>[0]['item'];
const presses:unknown[][]=[];
await act(async()=>{tree=create(React.createElement(Card,{item,locale:'en',closer:'Signed-in closer',onAct:(...args)=>presses.push(args)}));});
await act(async()=>tree.root.findByType('details').props.onToggle({currentTarget:{open:true}}));
assert.equal(presses.length,0);
const confirm=new FormData();confirm.set('resolution','member_contacted');confirm.set('note',tree.root.findByType('textarea').props.value);
await act(async()=>tree.root.findByType('form').props.onSubmit({preventDefault(){},currentTarget:confirm}));
assert.deepEqual(presses[0],[item,'member_contacted',confirm.get('note')]);
await act(async()=>tree.unmount());
console.log('Doctor alert card forwards outcome and prefilled reason together in one confirm.');
