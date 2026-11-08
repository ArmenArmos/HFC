import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {suggestionsFor,type SuggestionState} from '@/lib/chat/suggestions';
import {CHAT_TASKS,chatTask,TASK_REPLY,type ChatTask} from '@/lib/chat/tasks';
import {cardIntent} from '@/lib/zoe-chat-actions/intent';
import {job,runPipeline} from '@/lib/zoe/eval/harness';

const empty:SuggestionState={locale:'en',consent:true,emergency:false,safetyHold:false,medicineDue:false,bpDue:false,
 visitProposal:false,visitToBook:false,planToRead:false,resultsToRead:false,doctorReply:false};
const all={...empty,medicineDue:true,bpDue:true,visitProposal:true,visitToBook:true,planToRead:true,resultsToRead:true,doctorReply:true};
assert.deepEqual(suggestionsFor(empty),[]);
assert.deepEqual(suggestionsFor(null),[]);
assert.deepEqual(suggestionsFor(undefined),[]);
assert.deepEqual(suggestionsFor(all).map(s=>s.id),['dose','bp','proposal']);
for(const guard of [{emergency:true},{safetyHold:true},{consent:false}])assert.deepEqual(suggestionsFor({...all,...guard}),[]);
assert.equal(suggestionsFor({...all,medicineDue:false,bpDue:false}).filter(s=>s.id==='visit').length,0,'Proposal replaces booking');
// Every combination stays bounded and deterministic.
const facts=['medicineDue','bpDue','visitProposal','visitToBook','planToRead','resultsToRead','doctorReply'] as const;
for(let mask=0;mask<128;mask++){
 const state={...empty,...Object.fromEntries(facts.map((f,i)=>[f,!!(mask&(1<<i))]))};
 assert.ok(suggestionsFor(state).length<=3);
 assert.deepEqual(suggestionsFor(state),suggestionsFor(state));
}
const conversation={enabled:true,doctorName:'Synthetic doctor',answeredThroughSeq:0,memberSpentTodayUsd:0,injectionsLast24h:0,locale:'en' as const};
const record={chatCards:true,ageYears:null,doses:null,ldl:null};
for(const locale of ['en','hy','ru'] as const)for(const key of Object.keys(CHAT_TASKS) as ChatTask[]){
 const text=CHAT_TASKS[key].text[locale];
 assert.equal(chatTask(text),key);
 assert.equal(cardIntent(text),CHAT_TASKS[key].kind);
 assert.equal(chatTask(`  ${text.toUpperCase()}։  `),key);
 assert.equal(chatTask(text+' and I feel dizzy'),null,'Extra symptoms cannot enter the fixed task route');
 assert.equal(chatTask(text+' 🤮'),null);
 const result=await runPipeline(job(text,{directAnswers:true,healthAnswers:true,conversation,memberRecord:record}),{directAnswers:true});
 assert.equal(result.providerCalls.length,0,`${locale}/${key}: no model`);
 assert.equal(result.judgeCalls.length,0,`${locale}/${key}: no judge model`);
 assert.equal(result.reserved,null,'No model reservation');
 assert.equal(result.reason,'task_request_no_model',`${locale}/${key}`);
 assert.equal(result.finish?.answer,TASK_REPLY[locale]);
}
for(const text of ['Help me book my visit. I have crushing chest pain right now and cannot breathe','Ուզում եմ կարդալ իմ պլանը։ Հիմա կրծքավանդակում ուժեղ ցավ ունեմ, չեմ կարողանում շնչել','Я хочу прочитать мой план. Сейчас сильная боль в груди и не могу дышать']){
 const r=await runPipeline(job(text,{directAnswers:true,healthAnswers:true,conversation,memberRecord:record}),{directAnswers:true,env:{NOREON_ZOE_TEST_LEXICON:'false',NOREON_ZOE_URGENT_PLACEHOLDER:'true'}});
 assert.notEqual(r.reason,'task_request_no_model');
 assert.match(r.reason,/urgent/);
 assert.equal(r.providerCalls.length,0);
}
const due=suggestionsFor({...all,locale:'hy'});
assert.ok(due.every(s=>s.text===CHAT_TASKS[s.id].text.hy));
console.log('Suggestion prediction: all combinations, safety gates, three languages; exact tasks use the real pipeline with zero model calls.');
for(const doctorScope of ['conversation','topic'] as const){
 const r=await runPipeline(job(CHAT_TASKS.message.text.en,{directAnswers:true,healthAnswers:true,conversation,memberRecord:record,doctorMode:true,doctorScope}),{directAnswers:true});
 assert.equal(r.reason,'task_request_no_model','A request to open the reply card stays a task during a doctor conversation');
 assert.equal(r.providerCalls.length,0);
}

for(const key of Object.keys(CHAT_TASKS) as ChatTask[]){
 const r=await runPipeline(job(CHAT_TASKS[key].text.en,{directAnswers:true,healthAnswers:true,conversation,memberRecord:record,
  answers:[{body:'Is there anything else I can help with?',minutesAgo:2}]}),{directAnswers:true});
 assert.equal(r.reason,'task_request_no_model','An ordinary question does not send an exact task to a model');
 assert.equal(r.providerCalls.length,0);
}

for (const body of ['Your appointment is today at 3 pm', 'Your doctor appointment is today at 3 pm', 'Ձեր այցն այսօր ժամը 15։00-ին է', 'Ваш приём сегодня в 15:00']) {
 for (const doctorMode of [false, true]) {
  for (const minutesAgo of [2,48*60]) {
   for (const replies of [[], [{body:'Your doctor reply',minutesAgo:60}]]) {
    const r=await runPipeline(job(CHAT_TASKS.plan.text.en,{directAnswers:true,healthAnswers:true,conversation,memberRecord:record,doctorMode,
     answers:[{body,minutesAgo}],replies}),{directAnswers:true});
    assert.equal(r.reason,'task_request_no_model',`Routine historical timing must allow the task route: ${body}`);
    assert.equal(r.providerCalls.length,0);
    assert.equal(r.judgeCalls.length,0);
    assert.equal(r.reserved,null);
   }
  }
 }
}
for (const body of ['Call 103 for emergency help','You need to see a doctor today','Պետք է դիմեք բժշկի այսօր','Обратитесь к врачу сегодня']) {
 for (const minutesAgo of [2,48*60]) {
  const r=await runPipeline(job(CHAT_TASKS.plan.text.en,{directAnswers:true,healthAnswers:true,conversation,memberRecord:record,doctorMode:true,
   answers:[{body,minutesAgo}]}),{directAnswers:true});
  assert.notEqual(r.reason,'task_request_no_model',`An unresolved warning must block the task route: ${body}`);
 }
}

// The database authorizes only these exact fixed lines during doctor takeover.
const migration=readFileSync('supabase/migrations/20261101131050_chat_suggestion_tasks.sql','utf8');
for(const line of Object.values(TASK_REPLY))assert.ok(migration.includes(line),'Worker/DB fixed acknowledgement contract must agree');
