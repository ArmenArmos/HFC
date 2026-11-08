import assert from 'node:assert/strict';
import {job,runPipeline} from '@/lib/zoe/eval/harness';
import type {ZoeJob} from '@/lib/zoe/pipeline';
import {URGENT_TEXT} from '@/lib/zoe/symptoms/intake';
import {isUrgentAnswer} from '@/lib/zoe/urgent-window';

// Synthetic pipeline regressions. In-memory ports and fake providers only.
const env={NOREON_ZOE_URGENT_PLACEHOLDER:'true',NOREON_ZOE_TEST_LEXICON:'false',NOREON_ZOE_MEMBER_CLEAR:'true'};
const context={startedAt:'2026-10-31T12:00:00Z',sinceMinutes:3,readingId:'00000000-0000-4000-8000-000000000101',
 readingVersion:'123',readingSavedAt:'2026-10-31T12:01:00Z',clearThroughSeq:null,clearSinceMinutes:null,
 readingClearReason:null,suppressStoredReading:false};
const memberJob=(texts:string[],extra:Partial<ZoeJob>={})=>job(texts,{
 urgentSinceMinutes:3,urgentOpenedBy:'rule',answers:[{body:URGENT_TEXT.en,minutesAgo:3}],memberClear:context,
 conversation:{enabled:true,doctorName:null,answeredThroughSeq:0,memberSpentTodayUsd:0,injectionsLast24h:0,locale:null},
 intake:{enabled:true,registered:[],active:null,doctorName:null,latestReading:{systolic:117,diastolic:91,minutesAgo:0},redFlagsAfterSeq:0},...extra});
async function requires103(j:ZoeJob,label:string,reason?:string){
 const r=await runPipeline(j,{env});
 assert.equal(r.finish?.memberClear,undefined,`${label}: no clear`);
 assert.ok(isUrgentAnswer(r.finish?.answer??''),`${label}: full urgent text`);
 assert.equal(r.providerCalls.length,0,`${label}: no model call`);
 if(reason)assert.equal(r.reason,reason,label);
}

// MC-01: a final well/dispute/request phrase cannot hide a fresh crisis reading
// from the headache in the same unanswered batch.
for(const phrase of ['I feel fine','the reading was wrong','clear the alarm']){
 const j=memberJob(['I have a headache',phrase]);
 j.intake!.latestReading={systolic:198,diastolic:106,minutesAgo:0};
 await requires103(j,`fresh crisis plus ${phrase}`,'symptom_red_flag_no_model_call');
}

// MC-03: a pending calm reading is not permission to treat conditional,
// quoted or negative statements as confirmation that the member is well.
const vetoes=[
 ['if I feel fine','He said "I feel fine"','I am not feeling better','I do not feel any better'],
 ['Եթե ինձ լավ եմ զգում','Նա ասաց «Ինձ լավ եմ զգում»','Ինձ ավելի լավ չեմ զգում'],
 ['ete indz lav em zgum','Na asac "lav em"','aveli lav chem zgum'],
 ['Если мне хорошо','Он сказал «Мне хорошо»','Мне не стало лучше','Мне не лучше'],
];
for(const opened of ['rule','model'] as const)for(const reason of ['new_reading','corrected_reading'] as const){
 for(const texts of vetoes)for(const text of texts){
  const r=await runPipeline(memberJob([text],{urgentOpenedBy:opened,memberClear:{...context,readingClearReason:reason}}),{env});
  assert.equal(r.finish?.memberClear,undefined,`${opened}/${reason}: ${text} cannot clear`);
  assert.ok(r.events.some(e=>e.name==='zoe.guard.urgent_match'),'new message still screened');
 }
}
console.log('Zoe member clear: fresh crisis batch and 56 reading-clear veto paths passed.');

// SQL-shaped rows enter through the actual sweep parser, never on the claimed job.
// This catches missing memberClear context, timestamp/null mismatches, and language drift.
const {runZoeSweep}=await import('@/lib/zoe/server');
const {memberClearPhrase}=await import('@/lib/zoe/member-clear');
const {createFakeProvider}=await import('@/lib/zoe/provider');
type Finish=NonNullable<Awaited<ReturnType<typeof runPipeline>>['finish']>;
const sqlContext={startedAt:'2026-10-31T12:00:00.123456+00:00',sinceMinutes:3,
 clearThroughSeq:null,clearSinceMinutes:null,readingId:null,readingVersion:null,readingSavedAt:null,
 readingClearReason:null,suppressStoredReading:false,openedBy:'rule' as const,throughSeq:1,trigger:null};
let sweepChecks=0;
async function sweep(text:string,opts:{context?:unknown;previous?:string;locale?:'en'|'hy'|null;enabled?:boolean;messages?:string[];answers?:ZoeJob['answers'];answered?:number;seq?:number}={}){
 const enabled=opts.enabled??true;
 const seq=opts.seq??2;
 const claimed=job(text,{messageSeq:seq,messages:(opts.messages??[text]).map((text,i,all)=>({seq:i+seq+1-all.length,text,minutesAgo:0})),
  answers:opts.answers??[{body:opts.previous??URGENT_TEXT.en,minutesAgo:3}],intake:{enabled:true,registered:[],active:null,doctorName:null,latestReading:null,redFlagsAfterSeq:opts.answered??1}});
 const finished:Finish[]=[];let calls=0;
 const fake=createFakeProvider();
 const report=await runZoeSweep(async(name,args)=>{
  if(name==='zoe_run_claim')return [claimed];
  if(name==='zoe_run_context')return [{runId:claimed.runId,enabled:true,doctorName:null,answeredThroughSeq:opts.answered??1,memberSpentTodayUsd:0,injectionsLast24h:0,locale:opts.locale??null}];
  if(name===(enabled?'zoe_run_alarm_window':'zoe_run_urgent_window'))return [{runId:claimed.runId,urgentSinceMinutes:3,urgentOpenedBy:'rule',urgentThroughSeq:1,memberClear:opts.context??sqlContext}];
  if(name==='zoe_run_finish'){const f=args.p_result as Finish;finished.push(f);return {ok:true,outcome:f.outcome};}
  if(name==='zoe_run_why_record')return {ok:true};
  if(name==='zoe_run_reserve')return {ok:true};
  return [];
 },{routing:null,provider:{...fake,complete:async r=>{calls++;return fake.complete(r);}},env:{...env,NOREON_ZOE_MEMBER_CLEAR:String(enabled)}});
 assert.equal(report.failed,0,text);assert.equal(finished.length,1,text);sweepChecks++;
 return {f:finished[0]!,calls};
}
const clearForms=[
 ["I'm feeling good","I'm feeling better","I'm feeling fine","I’m feeling better","I am feeling good.","I was kidding","I was joking","false alarm","by mistake","cancel"],
 ['Ես ինձ լավ եմ զգում','Ես ինձ ավելի լավ եմ զգում','Կատակ էի անում','Սխալ ահազանգ','Սխալմամբ','Չեղարկել'],
 ['es indz lav em zgum','es indz aveli lav em zgum','es katak ei anum','sxal ahazang','sxalmamb','chegharkel'],
 ['Я чувствую себя хорошо','Я чувствую себя лучше','Я шутил','Я шутила','Ложная тревога','По ошибке','Отмена'],
];
for(const [index,phrases] of clearForms.entries())for(const text of phrases){
 const lang=(['en','hy','hy','ru'] as const)[index]!;
 assert.ok(memberClearPhrase(text),`explicit clear: ${text}`);
 const {f,calls}=await sweep(text,{previous:URGENT_TEXT[lang]});
 assert.equal(f.receipt?.language,lang,text);
 assert.equal(f.reason,'member_cleared_urgent_window',text);
 assert.equal(f.memberClear?.startedAt,sqlContext.startedAt,'the exact SQL anchor survives parsing');
 assert.equal(calls,0,text);
 // Questions, quotes, conditions, negations, and extra symptom clauses never match.
 for(const invalid of [`${text}?`,`"${text}"`,`if ${text}`,`not ${text}`,`${text}, but I cannot breathe`])assert.equal(memberClearPhrase(invalid),null,invalid);
 const veto=await sweep(text,{messages:['I cannot breathe',text],answered:0});
 assert.equal(veto.f.memberClear,undefined,text);assert.ok(isUrgentAnswer(veto.f.answer??''),text);
}
for(const lang of ['en','hy','ru'] as const)for(const text of ['cancel','ok','?','...','qwerty asdfgh']){
 const {f}=await sweep(text,{previous:URGENT_TEXT[lang],locale:lang==='en'?'hy':'en',enabled:false});
 assert.equal(f.language,lang,`short follow-up keeps ${lang}: ${text}`);
}
for(const [text,lang] of [["I cannot breathe",'en'],['Не могу дышать','ru'],['Задыхаюсь','ru'],['Չեմ կարողանում շնչել','hy']] as const){
 const {f}=await sweep(text,{previous:URGENT_TEXT.en,locale:'hy'});assert.equal(f.language,lang,text);
}
for(const [text,lang] of [['ինչու','hy'],['почему','ru']] as const){
 const {f}=await sweep(text,{previous:URGENT_TEXT.en});assert.notEqual(f.reason,'urgent_in_window_no_model_call');assert.equal(f.language??f.receipt?.language,lang,text);
}
const why=await sweep('why');assert.equal(why.f.reason,'urgent_alarm_explained');assert.equal(why.calls,0,'why explains the recorded trigger without a provider');assert.doesNotMatch(why.f.receipt!.text,/103/u);
const legacyShape={...sqlContext};delete (legacyShape as Partial<typeof sqlContext>).trigger;delete (legacyShape as Partial<typeof sqlContext>).openedBy;delete (legacyShape as Partial<typeof sqlContext>).throughSeq;
assert.equal((await sweep('I feel fine',{context:legacyShape})).f.reason,'member_cleared_urgent_window','original member-clear SQL shape');
for(const invalid of [{...sqlContext,startedAt:null,sinceMinutes:null},{...sqlContext,startedAt:'invalid'}]){
 assert.equal((await sweep('cancel',{context:invalid})).f.memberClear,undefined,'no clear with absent or invalid SQL anchor');
}
// Exact staging order, with only RPC persistence simulated. Every turn enters the
// production sweep -> context schemas -> job schema -> pipeline -> finish port.
const sequence=["I've feeling chest pain","why","I was kidding","I'm feeling better","I am feeling good.","cancel","Hello"];
let persisted:Record<string,unknown>={...sqlContext,startedAt:null,sinceMinutes:null,openedBy:null,throughSeq:null};
const answers:ZoeJob['answers']=[];
const reasons:string[]=[];
for(const [i,text] of sequence.entries()){
 const {f,calls}=await sweep(text,{context:persisted,answers,answered:i,seq:i+1,locale:'hy'});
 reasons.push(f.reason);
 if(i===0){
  assert.equal(f.reason,'urgent_route_no_model_call');assert.equal(f.language,'en');assert.equal(calls,0);
  persisted={...sqlContext,throughSeq:1};
 }else if(i===1){
  assert.equal(f.reason,'urgent_alarm_explained');assert.equal(calls,0,'why explains the recorded trigger without a provider');assert.doesNotMatch(f.receipt!.text,/103/u);
 }else if(i===2){
  assert.equal(f.reason,'member_cleared_urgent_window');assert.equal(f.receipt?.language,'en');assert.equal(calls,0);
  persisted={...sqlContext,startedAt:null,sinceMinutes:null,openedBy:null,throughSeq:null,clearThroughSeq:3,clearSinceMinutes:0};
 }else{
  assert.notEqual(f.reason,'urgent_in_window_no_model_call',text);
  assert.ok(!isUrgentAnswer(f.answer??''),text);
 }
 const body=f.answer??f.receipt?.text;if(body)answers.push({body,minutesAgo:0});
}
console.log(`Staging sequence (synthetic SQL RPC): ${reasons.join(' -> ')}`);
console.log(`Zoe member clear: ${sweepChecks} real sweep/parser cases passed.`);
