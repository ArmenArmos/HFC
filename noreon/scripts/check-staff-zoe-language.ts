import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {renderToStaticMarkup} from 'react-dom/server';
import {createElement} from 'react';
import {ZoeAnswer} from '@/components/staff/zoe/answer';
import {askRequestSchema,TOOLS,type AskRequest,type L,type StreamEvent} from '@/lib/staff-zoe/contracts';
import {checkRendered} from '@/lib/staff-zoe/check';
import {fixtureRead} from '@/lib/staff-zoe/fixture-tools';
import type {ContextReads} from '@/lib/staff-zoe/fixture-tools';
import {EVAL_NOW,FICTIONAL_RECORDS,MEMBER_A,MEMBER_B} from '@/lib/staff-zoe/eval/fixtures';
import {runStaffTurn,type FinishInput,type TurnPorts} from '@/lib/staff-zoe/turn';
import {notices} from '@/lib/staff-zoe/prompt';

const req={conversationId:'f0000000-0000-4000-8000-000000000002',submissionId:'f0000000-0000-4000-8000-000000000003',text:'Summarise the record',intent:'summary'} as const;
const englishFixed=/No index event recorded|No LDL goal set|Member messages read|Home BP week average|Readings in that week|What you asked is not in what I read|Today's limit for Zoe|\b(?:female|male|awaiting-member|awaiting-doctor|side_effect|decided_to_stop)\b|\(open\)| · open ·/i;
for(const locale of ['en','hy','ru'] as const){
 // Use the same record in all three languages. Authored plan text, quotes and drug names remain verbatim.
 const source=FICTIONAL_RECORDS[MEMBER_A]!;
 const record={...source,ldl:FICTIONAL_RECORDS[MEMBER_B]!.ldl,
  tasks:source.tasks!.map(x=>({...x,kind:'evidence-collection' as const,title:'Collect blood pressure log'}))};
 const read=(tool:typeof TOOLS[number])=>fixtureRead(record,tool,'doctor',locale,EVAL_NOW);
 const cards=await Promise.all(TOOLS.map(read));
 const finished:FinishInput[]=[];
 const ports:TurnPorts={
  begin:async()=>({ok:true,runId:req.submissionId,memberId:MEMBER_A,memberName:'Fictional',role:'doctor',tier:'low',lastTools:[],history:[]}),
  read,models:async()=>({primary:{providerName:'test',requestModel:'test',region:'local',local:true,pricing:{inputUsdPerMTok:0,outputUsdPerMTok:0,label:'test'},
   complete:async input=>{assert.equal(input.replyLanguage,locale);return {kind:'ok',raw:JSON.stringify({need:[],facts:['bp.1','bp.2','plan.1','member_messages.1','open_items.3'],quotes:[],not_known:true,declined:false}),finishReason:'stop',usage:{inputTokens:100,outputTokens:100},responseModel:'test',responseId:'test'};}},fallback:null,fast:false,effort:null}),
  reserve:async()=>({ok:true}),finish:async(_id,value)=>{finished.push(value);},seal:()=>null,now:()=>EVAL_NOW.getTime(),
 };
 const events:StreamEvent[]=[];for await(const event of runStaffTurn(req,locale,ports))events.push(event);
 const answer=events.find(e=>e.type==='answer');assert.ok(answer?.type==='answer');assert.equal(answer.content.state,'answered');
 assert.ok(checkRendered(answer.content.say,answer.content.cards).ok,'Localized lines still match their verified facts');
 assert.deepEqual(finished[0]!.content,answer.content,'Saved content uses the same language as the streamed answer');
 assert.ok(answer.content.say.some(x=>x.facts[0]?.id==='bp.1'));
 assert.ok(answer.content.notKnown.includes(notices.not_known[locale]));
 const fixed=JSON.stringify({cards:cards.map(c=>({facts:c.facts,missing:c.missing})),say:answer.content.say,notKnown:answer.content.notKnown,notice:answer.content.notice});
 assert.ok(JSON.stringify(cards.find(card=>card.tool==='open_items')).includes('Collect blood pressure log'),'An unmarked task title stays as stored in every locale');
 if(locale!=='en')assert.doesNotMatch(fixed,englishFixed,`${locale}: no English fixed copy in cards or saved lines`);
 assert.ok(JSON.stringify(cards).includes('Atorvastatin 40 mg'),'Drug names and recorded doses stay as written');
 assert.ok(cards.find(x=>x.tool==='member_messages')!.quotes.some(q=>q.text===source.messages[0]!.text),'Member quotes stay verbatim');
 assert.ok(cards.find(x=>x.tool==='plan')!.facts.some(f=>f.value==='Walk 30 minutes on 5 days a week.'),'Published instructions stay verbatim');
 // Limit and unavailable paths use the same locale, even without a model call.
 ports.reserve=async()=>({ok:false,code:'cap_reached'});
 const capped:StreamEvent[]=[];for await(const e of runStaffTurn(req,locale,ports))capped.push(e);
 const cap=capped.find(e=>e.type==='answer');assert.ok(cap?.type==='answer');assert.equal(cap.content.notice,notices.cap[locale]);
 const unavailable=cards.find(c=>c.tool==='zoe_why')!;
 const html=renderToStaticMarkup(createElement(ZoeAnswer,{locale,memberRef:'F',content:{...answer.content,cards:[{...unavailable,state:'unavailable'}]}}));
 assert.ok(html.includes({en:'Not known: this could not be read.',hy:'Հայտնի չէ. չհաջողվեց կարդալ։',ru:'Неизвестно: не удалось прочитать.'}[locale]));
}

// Fixed statuses and values across the rest of the cards; only stored free text/drug names may stay English.
const source=FICTIONAL_RECORDS[MEMBER_A]!;
const concern={id:req.submissionId,memberId:MEMBER_A,memberName:'Fictional',kind:'side_effect' as const,createdAt:EVAL_NOW.toISOString(),
 ask:{id:req.submissionId,source:'plan' as const,medicineId:req.submissionId,dueAt:EVAL_NOW.toISOString(),trigger:'skipped' as const,state:'open' as const,reason:null,createdAt:EVAL_NOW.toISOString(),answeredAt:null,medicine:{name:'Atorvastatin',dose:'40 mg'},careTeamAsked:true},ticks14:{taken:1,skipped:1}};
const record:ContextReads={...source,concerns:[concern,{...concern,kind:'decided_to_stop'},{...concern,kind:'refill'}],
 tasks:['open','awaiting-member','awaiting-doctor'].map(status=>({...source.tasks![0]!,title:'Keep this authored title',status:status as NonNullable<ContextReads['tasks']>[number]['status']})),
 visits:{version:'nurse-visit-v1',enabled:true,visits:([['home','confirmed'],['clinic','completed'],['office','attended']] as const).map(([mode,bookingStatus])=>({
  visit:{source:'appointment',id:req.submissionId,memberId:MEMBER_A,memberName:'Fictional',arrangementToken:req.submissionId,startsAt:EVAL_NOW.toISOString(),endsAt:null,mode,location:null,bookingStatus,completion:null},steps:[],items:[],completion:null,
 }))}};
for(const tool of ['overview','bp','labs','ldl','plan','adherence','open_items','visits','member_messages'] as const){
 const en=await fixtureRead(record,tool,'doctor','en',EVAL_NOW);
 for(const locale of ['hy','ru'] as const){
  const localized=await fixtureRead(record,tool,'doctor',locale,EVAL_NOW);
  assert.deepEqual(localized.facts.map(f=>[f.id,f.date,f.mark,f.analyte]),en.facts.map(f=>[f.id,f.date,f.mark,f.analyte]),'Locale cannot change fact selection, provenance or identity');
  assert.deepEqual(localized.quotes,en.quotes,'All attributed source text stays verbatim');
  const text=JSON.stringify(localized.facts.map(f=>[f.label,f.value]));
  assert.doesNotMatch(text,/\b(?:female|male|side effect|decided to stop|refill|awaiting-member|awaiting-doctor)\b|\((?:high|open)\)|home, confirmed|clinic, completed|office, attended/);
  if(tool==='open_items')assert.ok(text.includes('Keep this authored title'),'Authored task titles are preserved');
  if(tool==='adherence')assert.ok(text.includes('Atorvastatin'),'Drug names are preserved in concerns');
 }
}

// Exercise the real ask handler with controlled auth/ports, without reading account data or calling a provider.
let accountReads=0,readLocale:L|null=null,turnLocale:L|null=null;
const modules:Record<string,unknown>={
 'next/navigation':{notFound:()=>{throw Error('404');}},
 '@/lib/observability/with-logging':{withRouteLogging:(fn:unknown)=>fn},
 '@/lib/observability/logger':{log:{info:()=>{}}},
 '@/lib/patient-care/clinical-case-repository':{requireRealStaff:async()=>({client:{},identity:{role:'doctor'}})},
 '@/lib/staff/staff-locale':{staffLocale:async()=>{accountReads++;return 'en';}},
 '@/lib/staff-zoe/contracts':{askRequestSchema},
 '@/lib/staff-zoe/server':{staffTurnPorts:(_client:unknown,l:L)=>{readLocale=l;return {};}},
 '@/lib/staff-zoe/turn':{runStaffTurn:async function*(_req:AskRequest,l:L){turnLocale=l;yield {type:'refused',code:'off'};}},
};
const exports:Record<string,unknown>={};
vm.runInNewContext(ts.transpileModule(readFileSync('app/staff/real/(review)/zoe/ask/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
 {exports,Request,Response,ReadableStream,TextEncoder,URL,require:(name:string)=>{assert.ok(name in modules,name);return modules[name];}});
const handler=exports.POST as (request:Request,context:{params:Promise<{memberId:string}>})=>Promise<Response>;
const post=(request:Request)=>handler(request,{params:Promise.resolve({memberId:'d0000000-0000-4000-8000-000000000001'})});
const request=(body:unknown)=>new Request('https://local.test/staff/real/zoe/ask',{method:'POST',headers:{origin:'https://local.test','Content-Type':'application/json'},body:JSON.stringify(body)});
for(const locale of ['hy','ru','en'] as const){
 const response=await post(request({...req,locale}));assert.equal(response.status,200);await response.text();
 assert.equal(readLocale,locale);assert.equal(turnLocale,locale);
}
assert.equal(accountReads,0,'Explicit chat language takes precedence over account language');
assert.equal((await post(request({...req,locale:'de'}))).status,400,'Unsupported locales fail validation');
assert.equal((await post(request(req))).status,200,'Existing callers without locale still work');
assert.equal(accountReads,1);assert.equal(turnLocale,'en');
console.log('Staff Zoe language: localized reads, checked/saved lines, quotes/drugs, cap/unavailable copy and ask-route locale precedence passed (controlled IO, no network).');
