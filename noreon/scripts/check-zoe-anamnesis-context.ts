import assert from 'node:assert/strict';
import {memberRecordFrom,memberRecordRowSchema,memberRecordBlock,asksForHeldData,dropAnsweredQuestions} from '@/lib/zoe/member-record';
import {job,runPipeline} from '@/lib/zoe/eval/harness';
import {createFakeProvider,type ProviderRequest,type ZoeProvider} from '@/lib/zoe/provider';
import {UNKNOWN} from '@/lib/clinical/types';
import {questionnaireProfile,replayMemberRecord,saveAnamnesisTurn} from '@/lib/zoe/eval/conversation-questionnaire';
import {FIXED} from '@/lib/zoe/eval/conversation-scripts';
import {judge} from '@/lib/zoe/eval/conversation-rules';
import {medicineAskLine} from '@/lib/zoe/chat-record';

// Fictional assessment rows through the same adapter as zoe_run_member_record. No database or model calls.
const answer=(fieldId:string,value:unknown)=>({fieldId,value,source:'manual',answeredAt:'2026-11-02T10:00:00Z'});
const record=(values:Record<string,unknown>)=>memberRecordFrom(memberRecordRowSchema.parse({
 runId:'00000000-0000-4000-8000-000000000001',enabled:true,today:'2026-11-02',ageYears:null,medicines:null,ldl:null,
 questionnaire:{completed:false,answers:Object.fromEntries(Object.entries(values).map(([id,value])=>[id,answer(id,value)]))},
}));
const saved=record({'q1.age':42,'q2.height':165,'q2.weight':70,'q2.waist':UNKNOWN});
const block=memberRecordBlock(saved,{target:false,clean:t=>t});
assert.match(block,/Height: 165 cm, saved from the health questionnaire/);
assert.match(block,/Weight: 70 kg, saved from the health questionnaire/);
assert.match(block,/Age: 42/);
assert.doesNotMatch(block,/Waist:/,'unknown is not a measurement');
assert.doesNotMatch(memberRecordBlock(record({'q2.height':999}),{target:false,clean:t=>t}),/999/,'invalid values do not become facts');
for(const text of ['What is your height?','How tall are you?','Какой у вас рост?','Որքա՞ն է ձեր հասակը։'])
 assert.deepEqual(asksForHeldData(text,{record:saved}),['height'],text);
assert.deepEqual(asksForHeldData('What is your weight today?',{record:saved}),[],'a fresh measurement stays a question');
assert.equal(dropAnsweredQuestions('What is your height and do you have chest pain?',{record:saved}),'What is your height and do you have chest pain?','a mixed danger-sign question stays');
assert.deepEqual(asksForHeldData('What is your height?',{memberTexts:['My waist is 165 cm.']}),[],'a waist measurement is not height');
assert.deepEqual(asksForHeldData('What is your height?',{memberTexts:['My father has a height of 165 cm.']}),[],'another person is not a member fact');
assert.deepEqual(asksForHeldData('What is your height?',{memberTexts:['My height is not 165 cm.']}),[],'a denied measurement is unknown');
assert.equal(dropAnsweredQuestions('What does the number 165 refer to?',{memberTexts:['My height is 165 cm.']}),'','typed data resolves a vague number question');
assert.equal(dropAnsweredQuestions('Advice stays here.\n\nI have passed this to your doctor.',{record:saved}),'Advice stays here.\n\nI have passed this to your doctor.','unresolved history preserves newlines used by forward tracking');
assert.equal(dropAnsweredQuestions('Do you have unexplained weight loss?',{record:saved}),'Do you have unexplained weight loss?','a weight value does not answer a symptom question');
{const r={...saved,ldl:{goal:null,latest:{mmol:2.4,daysAgo:2},event:null,therapies:[],nextTestInDays:null}};
 assert.equal(dropAnsweredQuestions('Do you have a history of high cholesterol?',{record:r}),'Do you have a history of high cholesterol?','an LDL result does not answer a history question');}
assert.deepEqual(asksForHeldData('Do you have unexplained weight loss?',{record:saved}),[],'a useful symptom question needs no regenerate');

const V2={NOREON_MEMBER_CHAT_V2:'true'};
const convo={enabled:true,doctorName:'Test Doctor',answeredThroughSeq:1,memberSpentTodayUsd:0,injectionsLast24h:0,locale:'en' as const};
const input=(question:string,recordValue:typeof saved|null=saved,earlier='165',latest="what's next?")=>job(latest,{
 healthAnswers:true,directAnswers:true,conversation:convo,memberRecord:recordValue,
 messages:[{seq:1,text:earlier,minutesAgo:10},{seq:2,text:latest,minutesAgo:0}],messageSeq:2,
 answers:[{body:question,minutesAgo:9}],intake:{enabled:true,registered:[],active:null,doctorName:null,latestReading:null,redFlagsAfterSeq:0},
});
const calls=(r:Awaited<ReturnType<typeof runPipeline>>)=>r.providerCalls.filter(c=>c.purpose==='health_answer');
const sequence=(texts:string[],language:'en'|'hy'|'ru'='en'):ZoeProvider=>{const base=createFakeProvider();let i=0;return {...base,complete:async(r:ProviderRequest)=>r.purpose!=='health_answer'?base.complete(r):{
 kind:'ok',raw:JSON.stringify({reply:texts[Math.min(i++,texts.length-1)],urgency:'none',forward:'none',forward_reason:'none',summary:'App question.',language}),finishReason:'stop',usage:{inputTokens:1,outputTokens:1},responseModel:'fake',responseId:'x',
}};};
for(const question of ['What is your height?','What does the number 165 refer to?']){
 const r=await runPipeline(input(question),{directAnswers:true,env:V2,provider:sequence(['You can continue your questionnaire here.'])});
 assert.equal(r.finish!.health!.forward,'none');
 for(const c of calls(r))assert.ok(!c.memberBlock.includes(question),'a resolved clarification is absent from both topic history and memory');
 assert.match(calls(r)[0]!.memberBlock,/Height: 165 cm/);
}
{const r=await runPipeline(input('What is your height?',null),{directAnswers:true,env:V2});
 assert.ok(calls(r)[0]!.memberBlock.includes('What is your height?'),'an unknown height does not close the question');}
{const r=await runPipeline(input('What is your height?',null,'hello','My height is 165 cm. What is next?'),{directAnswers:true,env:V2});
 assert.ok(!calls(r)[0]!.memberBlock.includes('What is your height?'),'an explicit typed answer also closes it');
 assert.doesNotMatch(calls(r)[0]!.memberBlock,/165 cm, saved/,'typing in chat does not claim a questionnaire save');}
{const r=await runPipeline(input('Do you have chest pain right now?'),{directAnswers:true,env:V2});
 assert.ok(calls(r)[0]!.memberBlock.includes('Do you have chest pain right now?'),'saved basics never close a danger-sign question');}
{const r=await runPipeline({...input('What is your height?',saved,'165','yes'),answers:[{body:'Shall I send this to your doctor?',minutesAgo:20},{body:'What is your height?',minutesAgo:9}]},{directAnswers:true,env:V2});
 assert.equal(r.finish!.health!.forward,'none','removing the newest clarification must not reactivate an older handoff question');}
{const r=await runPipeline(input('Shall I send this to your doctor?\nWhat is your height?',saved,'165','yes'),{directAnswers:true,env:V2});
 assert.equal(r.finish!.health!.forward,'none','removing a trailing clarification must not reinterpret a yes as handoff consent in the same bubble');}
{const medicines:{name:string;dose:string|null}[]=[];
 const r=await runPipeline(input(`${medicineAskLine('en',[{name:'amlodipine',dose:'5 mg'}])}\nWhat is your height?`,{...saved,medicineList:true},'165','yes'),{directAnswers:true,env:V2,chatRecord:{medicines,statements:[]}});
 assert.notEqual(r.reason,'member_medicine_added','a trailing measurement question is not consent to save a medicine');assert.deepEqual(medicines,[]);}
{const r=await runPipeline(input('What is your height?'),{directAnswers:true,env:V2,provider:sequence(['How tall are you?','Continue your questionnaire here.'])});
 assert.equal(calls(r).length,2,'held basics receive one regenerate');assert.match(calls(r)[1]!.memberBlock,/known_data.height/);}
console.log('Zoe anamnesis context: saved basics, unknowns, resolved questions, typed answers and the held-data regenerate passed (stand-in model).');

// All questionnaire turns use assessment persistence. They never enter the Zoe message/answer window.
const scriptedReplies={
 en:['Your questionnaire is complete. No care plan is published yet. No visit is booked yet. Tests can be arranged after the questionnaire.','Your saved questionnaire answers appear here in this chat.'],
 hy:['Ձեր հարցաշարն ավարտված է։ Բուժման պլանը դեռ հրապարակված չէ։ Այց դեռ ամրագրված չէ։','Ձեր հարցաշարի պահված պատասխանները տեսանելի են այստեղ՝ այս զրույցում։'],
 ru:['Ваша анкета завершена. План лечения ещё не опубликован. Визит ещё не назначен.','Сохранённые ответы анкеты видны здесь, в этом чате.'],
};
for(const lang of ['en','hy','ru']as const){
 const scenario=FIXED.find(s=>s.id===`${lang}-anamnesis-next`)!;
 const assessment=questionnaireProfile();let chatTurns=0;
 const messages:{seq:number;text:string;minutesAgo:number}[]=[],answers:{body:string;minutesAgo:number}[]=[];
 const transcript:{n:number;seq:number;member:string;flags:Record<string,unknown>;visible:string|null;urgency:string;forward:string}[]=[];
 for(const turn of scenario.turns){
  if(turn.anamnesis){saveAnamnesisTurn(assessment,turn.anamnesis);continue;}
  chatTurns++;
  messages.forEach(m=>{m.minutesAgo+=3;});answers.forEach(a=>{a.minutesAgo+=3;});
  messages.push({seq:chatTurns,text:turn.text,minutesAgo:0});
  const r=await runPipeline(job(turn.text,{messageSeq:chatTurns,messages:[...messages],answers:[...answers],directAnswers:true,healthAnswers:true,memberRecord:replayMemberRecord(assessment),
   intake:{enabled:true,registered:[],active:null,doctorName:null,latestReading:null,redFlagsAfterSeq:0},
   conversation:{...convo,answeredThroughSeq:chatTurns-1,locale:scenario.locale},health:scenario.health}),{directAnswers:true,env:V2,provider:sequence([scriptedReplies[lang][chatTurns-1]!],lang)});
  const visible=r.finish!.answer??r.finish!.receipt?.text??null;
  assert.ok(visible);assert.equal(r.finish!.health!.forward,'none');
  transcript.push({n:chatTurns,seq:chatTurns,member:turn.text,flags:turn,visible,urgency:r.finish!.health!.urgency,forward:r.finish!.health!.forward});
  answers.push({body:visible,minutesAgo:0});
  const prompt=calls(r)[0]!.memberBlock;
  assert.match(prompt,/Health questionnaire: finished\./,`${lang}: completion uses the app's own rules`);
  assert.match(prompt,/Height: 165 cm, saved/);
  assert.doesNotMatch(prompt,/<message[^>]*>165<\/message>/,'assessment input is not a chat message');
  assert.doesNotMatch(prompt,/<zoe_answer[^>]*>Your height/,'app question is not a Zoe answer');
 }
 assert.equal(chatTurns,2,'only the two follow-up questions run Zoe');
 assert.deepEqual(judge(scenario,transcript),[],`${lang}: sequential replay passes its expectations with a stand-in speaker`);
}
assert.ok(judge({rules:{},lang:'en'},[{n:1,seq:1,member:"what's next?",flags:{nextStatus:true},visible:'Your questionnaire is complete.',urgency:'none',forward:'none'}]).some(f=>f.rule.includes('unpublished plan')),'the replay fails when the real next status is omitted');
for(const [lang,visible] of [['en','Your questionnaire is complete. No care plan is published yet. No visit is booked yet.'],['hy','Ձեր հարցաշարն ավարտված է։ Բուժման պլանը դեռ հրապարակված չէ։ Այց դեռ ամրագրված չէ։'],['ru','Ваша анкета завершена. План лечения ещё не опубликован. Визит ещё не назначен.']]){
 assert.equal(judge({rules:{},lang},[{n:1,seq:1,member:'x',flags:{nextStatus:true},visible,urgency:'none',forward:'none'}]).length,0,lang);
}
console.log('EN/HY/RU questionnaire replay: real assessment adapter and completion, two chat turns only (stand-in model).');
