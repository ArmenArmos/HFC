import assert from 'node:assert/strict';
import {createElement,type ContextType} from 'react';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import {renderToStaticMarkup} from 'react-dom/server';
import {AppRouterContext} from 'next/dist/shared/lib/app-router-context.shared-runtime.js';
import {LabAiCheck} from '@/components/staff/lab-ai-check';
import {LabAiResults} from '@/components/staff/lab-ai-results';
import {AiPlanPrepare} from '@/components/staff/ai-plan-panel';
import {AI_READ_LABEL} from '@/lib/lab-ai/provenance';
import {labsResult} from '@/lib/staff-zoe/facts';
import {FICTIONAL_RECORDS,MEMBER_A,EVAL_NOW} from '@/lib/staff-zoe/eval/fixtures';
import {fixtureLab} from '../e2e/doctor-chat-v2/data';
import {analyteDisplayName} from '@/lib/lab-ai/analyte-names';

// Production components, synthetic records, no provider or database calls.
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
// #750: auto-confirmation must never hide a flagged result in the collapsed list.
for(const locale of ['en','hy','ru'] as const)for(const chatMode of [false,true]){
 for(const flag of ['critical','abnormal','high','low','attention'] as const){
  const data=fixtureLab(),ldl=data.values[0];
  ldl.status='auto_accepted';ldl.labFlag=flag==='attention'?null:flag;ldl.attention=flag==='attention'?'threshold':null;
  data.values[2].status='auto_accepted';data.values[2].labFlag='normal';
  // Start LDL last so the check also catches a missing priority sort.
  data.values=[data.values[1],data.values[2],ldl];
  let tree!:ReactTestRenderer;
  await act(async()=>{tree=create(createElement(AppRouterContext.Provider,{value:{refresh(){}} as ContextType<typeof AppRouterContext>},createElement(LabAiCheck,{
   data,memberId:MEMBER_A,locale,submissionIds:{},ports:{review:async()=>({status:'saved' as const}),confirmIdentity:async()=>({status:'confirmed' as const}),readAgain:async()=>({status:'queued'})},
   ruleBlocks:Object.fromEntries(data.values.map(v=>[v.valueId,null])),...(chatMode?{chat:{onOpenPdf(){},onReviewed(){}}}:{})})));});
  const name=analyteDisplayName(ldl.testName,locale,ldl.catalogueRef);
  const row=tree.root.findAllByType('li').find(r=>r.findAllByType('p').some(p=>p.children.includes(name)))!;
  assert.ok(row,`${locale}/${flag}: flagged auto-confirmed LDL stays a full card`);
  assert.ok(tree.root.findAllByType('li').find(r=>r.findAllByType('button').length>0)===row,'Flagged LDL is the first value');
  assert.ok(row.findAllByType('span').some(s=>s.children.includes(AI_READ_LABEL[locale])),'Auto-confirmed tag is retained');
  const auto=tree.root.findAllByType('details')[0];
  assert.ok(auto,'Unflagged auto-confirmed value still has its own group');
  assert.ok(!auto.props.open,'Unflagged group starts collapsed when flagged values are present');
  assert.equal(auto.findAllByType('li').length,1,'Only the unflagged auto-confirmed value is collapsed');
  assert.ok(!auto.findAllByType('li').includes(row),'Flagged LDL is outside collapsed details');
  assert.match(auto.findByType('summary').children.join(''),/\(1\)$/,'Collapsed count excludes flagged LDL');
  await act(async()=>tree.unmount());
 }
}
console.log('Flagged auto-confirmed values: first, expanded, outside collapsed rules group, provenance retained in HY/RU/EN and both views.');
// An unrelated row leaving the collapsed group must not discard an uncertain review.
for(const chatMode of [false,true]){
 const data=fixtureLab();data.values[0].status='auto_accepted';data.values[2].status='auto_accepted';
 const commands:unknown[]=[];
 const props={data,memberId:MEMBER_A,locale:'en' as const,submissionIds:{[`${data.values[0].valueId}:confirm`]:'synthetic-confirm'},
  ports:{review:async(input:unknown)=>{commands.push(input);return {status:'outcome-unknown' as const};},confirmIdentity:async()=>({status:'confirmed' as const}),readAgain:async()=>({status:'queued'})},
  ...(chatMode?{chat:{onOpenPdf(){},onReviewed(){}}}:{})};
 const element=()=>createElement(AppRouterContext.Provider,{value:{refresh(){}} as ContextType<typeof AppRouterContext>},createElement(LabAiCheck,props));
 let tree!:ReactTestRenderer;
 await act(async()=>{tree=create(element());});
 const ldl=()=>tree.root.findAllByType('li').find(r=>r.findAllByType('p').some(p=>p.children.includes('LDL')))!;
 await act(async()=>ldl().findAllByType('button').find(b=>b.children.includes('Confirm'))!.props.onClick());
 assert.ok(ldl().findAllByType('button').some(b=>b.children.includes('Check again')));
 props.data={...data,values:data.values.map(v=>v===data.values[2]?{...v,status:'verified' as const}:v)};
 await act(async()=>tree.update(element()));
 const retry=ldl().findAllByType('button').find(b=>b.children.includes('Check again'));
 assert.ok(retry,`Uncertain flagged review survives the last unflagged auto row leaving, chat=${chatMode}`);
 await act(async()=>retry.props.onClick());
 assert.equal(commands.length,2);assert.deepEqual(commands[1],commands[0],'Retry retains the original submission');
 await act(async()=>tree.unmount());
}
console.log('Flagged uncertain review retains its exact retry when the collapsed group disappears in both views.');
for(const locale of ['en','hy','ru'] as const){
 const data=fixtureLab();data.values[0].status='auto_accepted';
 const actions={en:['Confirm','Correct','Reject (does not apply)'],hy:['Հաստատել','Ուղղել','Մերժել (կիրառելի չէ)'],ru:['Подтвердить','Исправить','Отклонить (не относится)']}[locale];
 for(const chatMode of [false,true]){
  const element=createElement(AppRouterContext.Provider,{value:{refresh(){}} as ContextType<typeof AppRouterContext>},createElement(LabAiCheck,{
   data,memberId:MEMBER_A,locale,submissionIds:{},ports:{review:async()=>({status:'saved' as const}),confirmIdentity:async()=>({status:'confirmed' as const}),readAgain:async()=>({status:'queued'})},
   ...(chatMode?{chat:{onOpenPdf(){},onReviewed(){}}}:{})}));
  let mounted!:ReactTestRenderer;
  await act(async()=>{mounted=create(element);});
  assert.ok(JSON.stringify(mounted.toJSON()).includes(AI_READ_LABEL[locale]),`${locale} provenance, chat=${chatMode}`);
  const autoRow=mounted.root.findAllByType('li').find(row=>row.findAllByType('span').some(span=>span.children.includes(AI_READ_LABEL[locale])))!;
  for(const action of actions)assert.ok(autoRow.findAllByType('button').some(button=>button.children.includes(action)));
  const correct=autoRow.findAllByType('button').find(button=>button.children.includes(actions[1]))!;
  assert.ok(correct.props.className.includes('min-h-11'),'Correct is one full-height button');
  await act(async()=>correct.props.onClick());
  assert.ok(autoRow.findAllByType('input').length>=2,'one tap opens correction fields on the auto-confirmed row');
  await act(async()=>mounted.unmount());
 }
 const records=structuredClone(FICTIONAL_RECORDS[MEMBER_A]!.labs!);records.clinic[0].values[0].status='auto_accepted';
 const html=renderToStaticMarkup(createElement(LabAiResults,{data:records,locale}));
 assert.ok(html.includes(AI_READ_LABEL[locale]),'member record result label');
 const facts=labsResult(records,{memberId:MEMBER_A,role:'doctor',locale,now:EVAL_NOW}).facts;
 assert.ok(facts.some(f=>f.label.includes(AI_READ_LABEL[locale])),'doctor chat plain lab answer keeps provenance');
 const prepare=renderToStaticMarkup(createElement(AiPlanPrepare,{memberId:MEMBER_A,reviewed:0,unreviewed:0,autoConfirmed:1,prepared:false,locale}));
 assert.ok(prepare.includes(AI_READ_LABEL[locale]));
 assert.ok(prepare.includes('href="#member-documents-title"'),'auto-confirmed values remain openable');
 assert.doesNotMatch(prepare,/No lab results recorded yet/);
}
console.log('Default lab confirmation UI: HY/RU/EN provenance in clinic/check/chat/plan components, one-tap full-height Correct, Confirm/Reject retained (rendered components, synthetic IO).');

// Chat groups every original value and keeps review actions on each row.
for(const locale of ['en','hy','ru'] as const){
 const data=fixtureLab();data.openedByYou=true;data.values[2].status='auto_accepted';
 const {labReviewReason}=await import('@/lib/lab-ai/review-copy');
 for(const reason of ['mapping','checks','attention','value','date','plausibility','identity'] as const)assert.ok(labReviewReason(data.values[0],reason,locale));
 let tree!:ReactTestRenderer;
 const ruleBlocks={[data.values[0].valueId]:'mapping' as const,[data.values[1].valueId]:null,[data.values[2].valueId]:null};
 const props={data,memberId:MEMBER_A,locale,ruleBlocks,submissionIds:{},ports:{review:async()=>({status:'saved' as const}),confirmIdentity:async()=>({status:'confirmed' as const}),readAgain:async()=>({status:'queued'})},chat:{onOpenPdf(){},onReviewed(){}}};
 await act(async()=>{tree=create(createElement(AppRouterContext.Provider,{value:{refresh(){}} as ContextType<typeof AppRouterContext>},createElement(LabAiCheck,props)));});
 const first=tree.root.findAllByType('h3')[0];
 assert.ok(first.children.includes({en:'Needs attention',hy:'Ուշադրության կարիք ունի',ru:'Требует внимания'}[locale]));
 const auto=tree.root.findAllByType('details').find(d=>String(d.findByType('summary').children.join('')).includes({en:'Unflagged values confirmed by the rules',hy:'Կանոններով հաստատված չնշված արժեքներ',ru:'Показатели без отметок, подтверждённые правилами'}[locale]))!;
 assert.equal(auto.props.open,false,'Rules-confirmed group starts collapsed');
 assert.ok(JSON.stringify(tree.toJSON()).includes(labReviewReason(data.values[0],'mapping',locale)!),'Reason is shown in plain language');
 for(const value of data.values)assert.ok(JSON.stringify(tree.toJSON()).includes((await import('@/lib/lab-ai/analyte-names')).analyteDisplayName(value.testName,locale,value.catalogueRef)),'No original value hidden');
 assert.equal(tree.root.findAllByType('button').some(b=>b.children.includes({en:'This PDF belongs to this member',hy:'Այս PDF-ը պատկանում է այս անդամին',ru:'Этот PDF принадлежит этому участнику'}[locale])),false,'Matching identity needs no extra click');
 await act(async()=>tree.unmount());
}
console.log('Lab review groups: all values present, localized reasons/headings, collapsed rules group, matching identity passed (mounted synthetic IO).');

// Bulk confirmation is one atomic press, never a client loop over eligible values.
for(const locale of ['en','hy','ru'] as const)for(const chatMode of [true,false]){
 const data=fixtureLab();data.openedByYou=true;data.values[2].status='auto_accepted';
 const passing={...data.values[1],valueId:'e2a00000-0000-4000-8000-000000000004'};
 const blocked={...passing,valueId:'e2a00000-0000-4000-8000-000000000005'};
 const flagged={...passing,valueId:'e2a00000-0000-4000-8000-000000000006',labFlag:'high' as const};
 const attention={...passing,valueId:'e2a00000-0000-4000-8000-000000000007',attention:'threshold' as const};
 data.values.push(passing,blocked,flagged,attention);
 const ruleBlocks=Object.fromEntries(data.values.map(v=>[v.valueId,v===blocked?'checks' as const:null]));
 const commands:unknown[]=[],reviews:unknown[]=[];let refreshes=0;
 type Result=import('@/lib/lab-ai/doctor-schema').ConfirmPassingResult;
 let result:Result={status:'outcome-unknown'},release:((r:Result)=>void)|null=null,delay=true;
 const props={data,memberId:MEMBER_A,locale,ruleBlocks,submissionIds:Object.fromEntries(data.values.flatMap(v=>['confirm','reject','correct'].map(a=>[`${v.valueId}:${a}`,crypto.randomUUID()]))),
  ports:{review:async(input:unknown)=>{reviews.push(input);return {status:'saved' as const,valueStatus:'verified'};},confirmPassing:async(input:unknown):Promise<Result>=>{commands.push(input);if(delay)return new Promise(resolve=>{release=resolve;});return result;},confirmIdentity:async()=>({status:'confirmed' as const}),readAgain:async()=>({status:'queued'})},
  ...(chatMode?{chat:{onOpenPdf(){},onReviewed(){}}}:{})};
 const {RecordRefreshProvider}=await import('@/components/staff/record-refresh');
 const element=()=>createElement(AppRouterContext.Provider,{value:{refresh(){}} as ContextType<typeof AppRouterContext>},createElement(RecordRefreshProvider,{value:()=>{refreshes++;}},createElement(LabAiCheck,props)));
 let tree!:ReactTestRenderer;await act(async()=>{tree=create(element());});
 const label={en:'Confirm all 2 that pass the rules',hy:'Հաստատել կանոններին համապատասխանող բոլոր 2 արժեքները',ru:'Подтвердить все 2 показателя, прошедшие правила'}[locale];
 const button=(label:string)=>tree.root.findAllByType('button').find(b=>b.children.join('')===label)!;
 const statuses=()=>tree.root.findAll(n=>n.props.role==='status'||n.props.role==='alert').map(n=>n.children.join('')).join(' ');
 assert.ok(button(label),`${locale} counts only unchecked, unflagged passing values, chat=${chatMode}`);
 const details=tree.root.findByType('details');
 await act(async()=>details.props.onToggle({currentTarget:{open:true}}));
 assert.equal(details.props.open,true);
 const firstPress=button(label).props.onClick;
 await act(async()=>{void firstPress();void firstPress();});
 assert.equal(commands.length,1,'A double event while pending sends one atomic command');
 assert.ok(tree.root.findAllByType('button').some(b=>b.props.disabled&&b.children.includes({en:'Saving…',hy:'Պահպանվում է…',ru:'Сохраняется…'}[locale])),'Pending bulk button is disabled');
 await act(async()=>release!({status:'outcome-unknown'}));delay=false;
 assert.equal(refreshes,0,'An uncertain result does not pretend the record is saved');
 const retry={en:'Check again',hy:'Կրկին ստուգել',ru:'Проверить ещё раз'}[locale];
 assert.ok(button(retry));
 // Another value changes while this press is uncertain. The original request survives regrouping.
 props.data={...data,values:data.values.map(v=>v.valueId===passing.valueId?{...v,status:'verified' as const}:v)};
 await act(async()=>tree.update(element()));
 result={status:'saved',replayed:true,confirmed:2,remaining:3};
 await act(async()=>button(retry).props.onClick());
 assert.equal(commands.length,2);assert.deepEqual(commands[1],commands[0],'Uncertain retry uses exactly the same submissionId');
 const input=commands[0] as {submissionId:string;memberId:string;fileId:string};
 assert.match(input.submissionId,/^[a-f0-9-]{36}$/);assert.equal(input.memberId,MEMBER_A);assert.equal(input.fileId,data.fileId);assert.equal(reviews.length,0);
 assert.equal(refreshes,1);assert.ok(statuses().includes({en:'Already saved. 2 confirmed. 3 still need you.',hy:'Արդեն պահպանված է։ 2 արժեք հաստատված է։ 3 արժեքի համար դեռ ձեր ստուգումն է պետք։',ru:'Уже сохранено. Подтверждено: 2. Ещё требуют вашей проверки: 3.'}[locale]));
 // The refreshed read is authoritative; every group and the saved result remain visible.
 props.data={...data,values:data.values.map(v=>[passing.valueId,data.values[1].valueId].includes(v.valueId)?{...v,status:'verified' as const}:v)};
 await act(async()=>tree.update(element()));assert.equal(tree.root.findByType('details').props.open,true);assert.equal(button(label),undefined);assert.ok(statuses().includes('2'));
 // A per-value confirm, reject or correction cannot close the rules-confirmed group.
 for(const action of ['confirm','reject','correct'] as const){
  const row=tree.root.findAllByType('li').find(n=>n.findAllByType('p').some(p=>p.children.includes(analyteDisplayName(data.values[0].testName,locale,data.values[0].catalogueRef))))!;
  const name={confirm:{en:'Confirm',hy:'Հաստատել',ru:'Подтвердить'},reject:{en:'Reject (does not apply)',hy:'Մերժել (կիրառելի չէ)',ru:'Отклонить (не относится)'},correct:{en:'Correct',hy:'Ուղղել',ru:'Исправить'}}[action][locale];
  await act(async()=>row.findAllByType('button').find(b=>b.children.join('')===name)!.props.onClick());
  if(action==='correct'){
   await act(async()=>row.findAllByType('input')[0].props.onChange({target:{value:'2.4'}}));
   await act(async()=>button({en:'Save correction',hy:'Պահպանել ուղղումը',ru:'Сохранить исправление'}[locale]).props.onClick());
  }
  props.data={...props.data,values:props.data.values.map(v=>v.valueId===data.values[0].valueId?{...v,status:action==='reject'?'rejected' as const:action==='correct'?'corrected' as const:'verified' as const}:v)};
  await act(async()=>tree.update(element()));assert.equal(tree.root.findByType('details').props.open,true,`${action} keeps the other group expanded`);
 }
 assert.equal((reviews[1] as {action:string;note?:string}).action,'reject');assert.equal((reviews[1] as {note?:string}).note,undefined,'Reject sends immediately without a note');
 await act(async()=>tree.unmount());
}
console.log('Bulk confirm EN/HY/RU in both views: safe count, one atomic command, pending guard, stable uncertain retry, replay receipt, refresh and expanded groups retained.');

for(const locale of ['en','hy','ru'] as const){
 const data=fixtureLab();data.openedByYou=true;
 const ruleBlocks=Object.fromEntries(data.values.map(v=>[v.valueId,null]));
 type Result=import('@/lib/lab-ai/doctor-schema').ConfirmPassingResult;
 let refreshes=0;
 let next:Result={status:'saved',replayed:false,confirmed:1,remaining:2},throws=false;
 const commands:unknown[]=[];
 const props={data,memberId:MEMBER_A,locale,ruleBlocks,submissionIds:{},identityRequired:false,ports:{review:async()=>({status:'saved' as const}),confirmIdentity:async()=>({status:'confirmed' as const}),readAgain:async()=>({status:'queued'}),confirmPassing:async(input:unknown)=>{commands.push(input);if(throws)throw Error('Synthetic transport failure');return next;}}};
 const element=()=>createElement(AppRouterContext.Provider,{value:{refresh(){refreshes++;}} as ContextType<typeof AppRouterContext>},createElement(LabAiCheck,props));
 let tree!:ReactTestRenderer;await act(async()=>{tree=create(element());});
 const bulk=()=>tree.root.findAllByType('button').find(b=>/Confirm all|Հաստատել կանոններին|Подтвердить все/.test(b.children.join('')));
 const text=()=>tree.root.findAll(n=>n.props.role==='status'||n.props.role==='alert').map(n=>n.children.join('')).join(' ');
 assert.ok(bulk());
 data.openedByYou=false;await act(async()=>tree.update(element()));assert.equal(bulk(),undefined,'Bulk requires audited PDF opening');
 await act(async()=>tree.root.findByType('iframe').props.onLoad());
 assert.equal(refreshes,1,'The full-page PDF load refreshes its audited opened state before offering bulk');
 data.openedByYou=true;await act(async()=>tree.update(element()));assert.ok(bulk(),'The reread after full-page PDF load exposes the bulk button');
 props.identityRequired=true;await act(async()=>tree.update(element()));assert.equal(bulk(),undefined,'Clinic identity override blocks bulk');
 props.identityRequired=false;data.job!.identityStatus='unknown';await act(async()=>tree.update(element()));assert.equal(bulk(),undefined,'Unknown identity blocks bulk');
 data.job!.identityConfirmedAt='2026-11-07T10:00:00Z';await act(async()=>tree.update(element()));assert.ok(bulk(),'Doctor-confirmed identity permits bulk');
 await act(async()=>bulk()!.props.onClick());
 assert.ok(text().includes({en:'1 confirmed. 2 still need you.',hy:'1 արժեք հաստատված է։ 2 արժեքի համար դեռ ձեր ստուգումն է պետք։',ru:'Подтверждено: 1. Ещё требуют вашей проверки: 2.'}[locale]));
 for(const [status,expected] of [
  ['stale',{en:'Something changed, reload and check',hy:'Տվյալները փոխվել են, թարմացրեք և ստուգեք',ru:'Данные изменились, обновите и проверьте'}],
  ['open-first',{en:'Open the PDF first',hy:'Նախ բացեք PDF-ը',ru:'Сначала откройте PDF'}],
  ['unavailable',{en:'Couldn’t save right now. Try again.',hy:'Այս պահին չհաջողվեց պահպանել։ Փորձեք կրկին։',ru:'Сейчас не удалось сохранить. Попробуйте снова.'}],
 ] as const){
  next={status};await act(async()=>bulk()!.props.onClick());assert.ok(text().includes(expected[locale]),`${locale} ${status}: ${text()}`);
 }
 assert.equal(new Set(commands.map(c=>(c as {submissionId:string}).submissionId)).size,commands.length,'Completed presses get new submission IDs');
 throws=true;await act(async()=>bulk()!.props.onClick());
 const retry=()=>tree.root.findAllByType('button').find(b=>b.children.join('')==={en:'Check again',hy:'Կրկին ստուգել',ru:'Проверить ещё раз'}[locale])!;
 assert.ok(retry());throws=false;next={status:'saved',replayed:true,confirmed:0,remaining:3};
 await act(async()=>retry().props.onClick());assert.deepEqual(commands.at(-1),commands.at(-2),'Thrown transport failures retain the same request too');
 await act(async()=>tree.unmount());
}
console.log('Bulk confirm localized saved/stale/open-first/unavailable lines, identity/PDF gates and transport-failure retry passed.');
