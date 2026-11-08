import assert from 'node:assert/strict';
import {FIXED,OLD_SECTIONS} from '@/lib/zoe/eval/conversation-scripts';
import {job,runPipeline} from '@/lib/zoe/eval/harness';
import {APP_FACTS,APP_FACTS_CHAT_V2,APP_FACTS_CHAT_V3,appFacts,zoeAppV3On,chatV2On,createFakeProvider,systemPrompt,SYSTEM_PROMPT,type ProviderRequest,type ReplyLanguage,type ZoeProvider} from '@/lib/zoe/provider';
import {APP_QUESTION_RULE,CHAT_LOG_RULE,asksForDoctor,healthReplyPrompt} from '@/lib/zoe/health-answer';
import {ASK_AGAIN_LINE,missingSections,plainAppQuestion,smallTalk} from '@/lib/zoe/app-question';
import {LOGGING_LINE,LOGGING_LINE_CHAT_V2} from '@/lib/zoe/logging-request';
import {CAPABILITY_PHRASES_CHAT_V2,chatFallback,chatSystemPrompt,CHAT_CLASSES,FALLBACK,MEMBER_SPEND_CAP_LINE,MEMBER_SPEND_CAP_LINE_CHAT_V2} from '@/lib/zoe/conversation';
import {CHAT_TASKS,TASK_REPLY} from '@/lib/chat/tasks';

// A question about the new chat stays in the chat, and no section it does not have is named. Fictional data, stand-in models; no database.
const V2={NOREON_MEMBER_CHAT_V2:'true'};
const LANGS=['en','hy','ru'] as const;
const convo={enabled:true,doctorName:'STAGING Test Doctor',answeredThroughSeq:0,memberSpentTodayUsd:0,injectionsLast24h:0,locale:'en' as const};
const free=(texts:string|string[],extra={})=>job(texts,{directAnswers:true,healthAnswers:true,conversation:convo,intake:{enabled:true,registered:[],active:null,doctorName:'STAGING Test Doctor',latestReading:null,redFlagsAfterSeq:0},...extra});
const reply=(text:string,o:Record<string,unknown>={})=>JSON.stringify({reply:text,urgency:'none',forward:'none',forward_reason:'none',summary:'The member asked about the app.',language:'en',...o});
const sequence=(raws:string[]):ZoeProvider=>{let i=0;const base=createFakeProvider();
 return {...base,complete:async(r:ProviderRequest)=>{if(r.purpose!=='health_answer')return base.complete(r);const raw=raws[Math.min(i++,raws.length-1)]!;return {kind:'ok',raw,finishReason:'stop',usage:{inputTokens:1,outputTokens:1},responseModel:'fake',responseId:'x'};}};};
const health=(r:{providerCalls:ProviderRequest[]})=>r.providerCalls.filter(c=>c.purpose==='health_answer');

// Facts by switch: exactly true, and off changes nothing.
assert.equal(chatV2On({}),false);assert.equal(chatV2On({NOREON_MEMBER_CHAT_V2:'TRUE'}),false);assert.equal(chatV2On({NOREON_MEMBER_CHAT_V2:'1'}),false);assert.equal(chatV2On(V2),true);
assert.equal(appFacts(false),APP_FACTS);assert.equal(appFacts(true),APP_FACTS_CHAT_V2);assert.equal(systemPrompt(false),SYSTEM_PROMPT);assert.match(APP_FACTS,/five parts/);
assert.match(APP_FACTS_CHAT_V2,/Everything happens here in this chat/);assert.match(APP_FACTS_CHAT_V2,/Language \(Armenian, English, Russian\) and Log out, nothing else/);assert.doesNotMatch(APP_FACTS_CHAT_V2,/five parts|open Progress/iu);
for(const split of [true,false]){const on=healthReplyPrompt('coach-first',split,true,false,true),off=healthReplyPrompt('coach-first',split,true,false,false);assert.ok(on.includes(APP_FACTS_CHAT_V2)&&!on.includes(APP_FACTS));assert.ok(off.includes(APP_FACTS)&&!off.includes(APP_FACTS_CHAT_V2));for(const p of [on,off])assert.ok(p.includes(APP_QUESTION_RULE));}
// Zoe app V3 changes the chat, so the facts follow it: the menu, booking, files and the reading card are in the chat, and a missing way to book is never a dead end.
{const V3={NOREON_ZOE_APP_V3:'true'};
 assert.equal(zoeAppV3On({}),false);assert.equal(zoeAppV3On({NOREON_ZOE_APP_V3:'TRUE'}),false);assert.equal(zoeAppV3On(V3),true);
 assert.equal(appFacts(true,V3),APP_FACTS_CHAT_V3);assert.equal(appFacts(true,{}),APP_FACTS_CHAT_V2);assert.equal(appFacts(false,V3),APP_FACTS,'the old app is unchanged by V3');
 for(const label of ['Իմ այցը','Мой визит','Իմ պլանը','Мой план','Ձեր լաբորատոր այցը','Ваш визит на анализы'])assert.ok(APP_FACTS_CHAT_V3.includes(label),`V3 facts name ${label} in its own language`);
 assert.match(APP_FACTS_CHAT_V3,/"My visit"/);assert.match(APP_FACTS_CHAT_V3,/"Request a consultation"/);assert.match(APP_FACTS_CHAT_V3,/camera and paperclip/);assert.match(APP_FACTS_CHAT_V3,/only after the member confirms that card/);
 for(const stale of [/cannot be done in this chat yet/,/nothing else/,/Files cannot be sent/,/cannot save it to the member's record/,/There is no Home, Progress, Care plan or Me section\.[^]*nothing else/])assert.doesNotMatch(APP_FACTS_CHAT_V3,stale,`V3 facts do not repeat the old limits: ${stale}`);
 assert.doesNotMatch(APP_FACTS_CHAT_V2,/cannot be done in this chat yet/,'the old chat no longer ends in a dead end');assert.match(APP_FACTS_CHAT_V2,/send this to my doctor[^]*arranges it/,'the old chat tells the member how to ask the care team to book');
 assert.match(APP_FACTS_CHAT_V2,/nothing else/);assert.match(APP_FACTS_CHAT_V2,/Files cannot be sent/);
 for(const line of APP_FACTS_CHAT_V3.split('\n'))assert.ok(line.length>0&&line.length<900,'every V3 fact stays short');
}
assert.ok(systemPrompt(true).includes(APP_FACTS_CHAT_V2)&&!systemPrompt(true).includes('right place in the app'));assert.ok(chatSystemPrompt('en',true).includes(APP_FACTS_CHAT_V2));assert.ok(!chatSystemPrompt('en',false).includes('App facts'));
// The run itself: the facts by the switch, and no card rule in the new chat whatever the card switch says.
{const record={chatCards:true,ageYears:null,doses:null,ldl:null};
 const on=await runPipeline(free('how does this chat work?',{memberRecord:record}),{directAnswers:true,env:V2,provider:sequence([reply('It all happens here.')])});
 const off=await runPipeline(free('how does this chat work?',{memberRecord:record}),{directAnswers:true,provider:sequence([reply('It all happens here.')])});
 assert.ok(health(on)[0]!.system.includes(APP_FACTS_CHAT_V2)&&!health(on)[0]!.system.includes(CHAT_LOG_RULE));assert.ok(health(off)[0]!.system.includes(APP_FACTS)&&health(off)[0]!.system.includes(CHAT_LOG_RULE));}

// No section, card or button of the old app in a fixed line of the new chat.
const OLD=/\bcard\b|քարտ|карточк|Message your care team|Գրել խնամքի թիմին|Написать медицинской команде|Care plan|Progress|Բուժման պլան|Իմ էջ|Առաջընթաց|Գլխավոր|план лечения»|разделе|բաժն|around the app|հավելվածում|в приложении|where your visits/u;
for(const l of LANGS){
 for(const line of [LOGGING_LINE_CHAT_V2[l],MEMBER_SPEND_CAP_LINE_CHAT_V2[l],ASK_AGAIN_LINE[l],...CAPABILITY_PHRASES_CHAT_V2[l].slice(0,1),...CHAT_CLASSES.map(c=>chatFallback(c,l,true))])assert.doesNotMatch(line,OLD,line);
 assert.notEqual(chatFallback('capabilities',l,true),FALLBACK.capabilities[l]);assert.equal(chatFallback('capabilities',l,false),FALLBACK.capabilities[l]);assert.equal(chatFallback('greeting',l,true),FALLBACK.greeting[l]);
 assert.ok(chatFallback('capabilities',l,true).includes(CAPABILITY_PHRASES_CHAT_V2[l][1]!),'the new line is really in the text');
 assert.doesNotMatch(ASK_AGAIN_LINE[l],/103|doctor|բժիշկ|բժշկ|врач/u);
 for(const line of [LOGGING_LINE[l],MEMBER_SPEND_CAP_LINE[l]])assert.ok(OLD.test(line),'the old lines stay for the old app');
}
for(const words of ['send this to my doctor','ուղարկեք սա բժշկին','отправьте это врачу'])assert.ok(asksForDoctor(words),`The line and the facts tell the member to write: ${words}`);
{const on=(texts:string,extra={})=>runPipeline(free(texts,{memberRecord:{chatCards:true,ageYears:null,doses:null,ldl:null},...extra}),{directAnswers:true,env:V2,provider:sequence([reply('Here is an answer.')])});
 const logged=await on('I took my pill, can you log it');assert.equal(logged.reason,'logging_request_no_model');assert.equal(logged.finish!.answer,LOGGING_LINE_CHAT_V2.en);assert.equal(logged.providerCalls.length,0);
 assert.doesNotMatch(logged.finish!.summary!,/card/);
 for(const key of Object.keys(CHAT_TASKS) as (keyof typeof CHAT_TASKS)[]){const r=await on(CHAT_TASKS[key].text.en);assert.notEqual(r.reason,'task_request_no_model',key);assert.notEqual(r.finish!.answer,TASK_REPLY.en,`No card behind: ${key}`);}
 const capped=await runPipeline(free('what can this chat do for me please',{conversation:{...convo,memberSpentTodayUsd:9}}),{directAnswers:true,env:V2});assert.equal(capped.finish!.receipt!.text,MEMBER_SPEND_CAP_LINE_CHAT_V2.en);
 const old=await runPipeline(free('what can this chat do for me please',{conversation:{...convo,memberSpentTodayUsd:9}}),{directAnswers:true});assert.equal(old.finish!.receipt!.text,MEMBER_SPEND_CAP_LINE.en);}

// Fable AQ-02: a message that came by Telegram is not the new chat, whatever the switch says. Its cards stay.
{const record={chatCards:true,ageYears:null,doses:null,ldl:null},tg=(t:string)=>free(t,{memberRecord:record,viaTelegram:true});
 const task=await runPipeline(tg(CHAT_TASKS.plan.text.en),{directAnswers:true,env:V2});assert.equal(task.reason,'task_request_no_model');assert.equal(task.finish!.answer,TASK_REPLY.en);
 const logged=await runPipeline(tg('I took my pill, can you log it'),{directAnswers:true,env:V2});assert.equal(logged.reason,'logging_request_no_model');assert.equal(logged.finish!.answer,LOGGING_LINE.en);
 const facts=await runPipeline(tg('how does this work?'),{directAnswers:true,env:V2,provider:sequence([reply('Open Me.')])});assert.ok(health(facts)[0]!.system.includes(APP_FACTS)&&health(facts)[0]!.system.includes(CHAT_LOG_RULE));assert.equal(health(facts).length,1,'no section net');
 const app=await runPipeline(free('how does this work?',{memberRecord:record,viaTelegram:false}),{directAnswers:true,env:V2,provider:sequence([reply('It all happens here.')])});assert.ok(health(app)[0]!.system.includes(APP_FACTS_CHAT_V2));}

// The safety net: the old sections as a place to go, in three languages, and not the ordinary words.
for(const t of ['Your height is stored in your profile.','Your answers are saved under Me.','It is in your profile.','You can find it in your profile.','Տվյալները պահված են ձեր պրոֆիլում։','Տվյալները «Իմ էջում» են։','Данные сохранены в профиле.','Ответы хранятся в вашем профиле.'])assert.deepEqual(missingSections(t),['section.named'],t);
for(const t of ['Your answers are saved in this chat.','Your questionnaire is saved.','Your data is not stored in your profile.','Данные не хранятся в профиле.','Ձեր պրոֆիլում դրանք պահված չեն։'])assert.deepEqual(missingSections(t),[],t);
{const fixed=await runPipeline(free('where is my data stored?'),{directAnswers:true,env:V2,provider:sequence([reply('Your height is stored in your profile under Me.'),reply('Your saved questionnaire answers appear here in this chat.')])});
 assert.equal(health(fixed).length,2);assert.equal(fixed.finish!.health!.forward,'none');assert.match(fixed.finish!.answer!,/here in this chat/);}
for(const t of ['Open Care plan to see it.','Go to the Me section and check.','You can find it under Progress.','Tap Home at the bottom.','Check the "Me" page.','Բացեք «Իմ էջը» բաժինը։','Պլանը կտեսնեք «Բուժման պլան» բաժնում։','Իմ էջում ստուգեք։','Անցեք Առաջընթաց բաժին։','Откройте раздел «План лечения».','Посмотрите в разделе "Care plan".','Зайдите в раздел Прогресс.','Open your profile to change it.','Բացեք Պրոֆիլ բաժինը։','Откройте профиль.','Don\'t worry, open the Me section.','Не волнуйтесь, откройте раздел «План лечения».','Չկա խնդիր, բացեք «Իմ էջը»։','Go to the Me section, it is not far.'])assert.deepEqual(missingSections(t),['section.named'],t);
for(const t of ['Your care plan says to walk daily.','Measure at home twice a day.','Your home readings look steady.','There is no Me page here; everything is in this chat.','Your progress this week is good.','Your profile says you are 58.','Don\'t open the Me section.','Ask me anything here.','Tell me more.','Go home and rest.','Ձեր բուժման պլանում գրված է քայլել։','Իմ էջ բաժին չկա, ամեն ինչ այստեղ է։','Ваш план лечения опубликован.','Раздела «Обо мне» нет, всё здесь.'])assert.deepEqual(missingSections(t),[],t);
{const bad=reply('Open the Me section to see it.'),good=reply('It all happens here in this chat.');
 const fixed=await runPipeline(free('where do I see my questionnaire?'),{directAnswers:true,env:V2,provider:sequence([bad,good])});
 assert.equal(fixed.reason,'health_answer_passed_guards');assert.equal(fixed.finish!.answer,'It all happens here in this chat.');assert.equal(health(fixed).length,2);assert.match(health(fixed)[1]!.memberBlock,/section that does not exist/);assert.ok(fixed.finish!.events.some(e=>e.name==='zoe.guard.section'));
 const stuck=await runPipeline(free('where do I see my questionnaire?'),{directAnswers:true,env:V2,provider:sequence([bad,bad])});
 assert.equal(stuck.reason,'health_answer_passed_guards','One regenerate, then the text goes on, never a careful line');assert.equal(health(stuck).length,2);assert.equal(stuck.finish!.answer,'Open the Me section to see it.');
 const off=await runPipeline(free('where do I see my questionnaire?'),{directAnswers:true,provider:sequence([bad])});assert.equal(health(off).length,1,'Switch off: the old app has that section');}

// The fallback: only with no health content, and every safety exit first.
const APP_QUESTIONS=["There's no Me page here, what do I do?",'can I ask here?','how do I arrange a lab test?','Where is my care plan?','When is my next appointment?','I have a question about the app','how do I change the language?','Այստեղ Իմ էջ չկա, ի՞նչ անեմ','կարո՞ղ եմ այստեղ հարցնել','կարելի՞ է այստեղ հարցնել','ինչպե՞ս կազմակերպեմ լաբորատոր հետազոտություն','Որտե՞ղ է իմ բուժման պլանը','ե՞րբ է իմ այցը','Тут нет раздела Обо мне, что мне делать?','можно спросить здесь?','можно ли спросить здесь?','как записаться на анализы?','где мой план лечения?','когда мой визит?'];
APP_QUESTIONS.push("what's next?",'where is my data stored?','Հիմա ի՞նչ է հաջորդ քայլը։','Որտե՞ղ են պահվում իմ տվյալները։','Что дальше?','Где хранятся мои данные?');
for(const t of APP_QUESTIONS)assert.ok(plainAppQuestion(t),t);
// Fable AQ-01: what a word list misses. No match on the app, or a health sign beside it: the doctor keeps it.
const NOT_APP=['I fell','he is not waking up','I stopped it','I need a doctor','something is wrong','is it serious?','can I take Xyzal?','can I fly?','ուշագնաց եղա','հիվանդ եմ','рвота','я беременна','упала','how do i stop it','how can i lower it','ինչպե՞ս քնեմ','язык опух','լեզուս ուռել է','the page is gone and my head is spinning','where is the chat, I fell','how do i book, is it serious?','what is this page','can i take this, the app says so',
 'my head hurts','I feel dizzy','where is the Me page, I have chest pain','130/80','my sugar is 7','I am tired','գլուխս ցավում է','հաբս մոռացա','ճնշումս բարձր է','ոտքս ուռել է','болит голова','мне плохо','забыла таблетку','можно ли мне кофе','krtqs cavum a','is salt bad for me',"I'm worried about it",'my mother is sick','what should i eat','Միզամուղից մի հատ ավել խմեմ, հա՞','x'.repeat(241)];
for(const t of NOT_APP)assert.ok(!plainAppQuestion(t),t);
const failing=sequence(['not json at all','still not json','no']);
const FAIL={directAnswers:true,env:V2,provider:failing};
for(const l of LANGS){const text={en:"There's no Me page here, what do I do?",hy:'Այստեղ Իմ էջ չկա, ի՞նչ անեմ',ru:'Тут нет раздела Обо мне, что мне делать?'}[l];
 const r=await runPipeline(free(text,{conversation:{...convo,locale:l==='en'?'en':'hy'}}),{...FAIL,provider:sequence(['no','no','no'])});
 assert.equal(r.finish!.receipt!.text,ASK_AGAIN_LINE[l as ReplyLanguage],l);assert.deepEqual(r.finish!.health,{urgency:'none',modelUrgency:'none',forward:'none',forwardReason:'none'},'no forward');assert.equal(r.finish!.summary,null,'Nothing for the doctor');}
for(const t of NOT_APP){const r=await runPipeline(free(t),{directAnswers:true,env:V2,provider:sequence(['no','no','no'])});if(/^discarded|intake/u.test(r.outcome)||r.finish!.receipt===null)continue;
 assert.notEqual(r.finish!.receipt?.text,ASK_AGAIN_LINE.en,t);assert.ok(r.finish!.receipt===undefined||/careful|doctor|today|Dr|զգույշ|осторожн/iu.test(r.finish!.receipt.text),t);if(r.finish!.receipt)assert.notEqual(r.finish!.health?.forward,'none',t);}
for(const t of APP_QUESTIONS){const r=await runPipeline(free(t),{directAnswers:true,env:V2,provider:sequence(['no','no','no'])});assert.ok(Object.values(ASK_AGAIN_LINE).includes(r.finish!.receipt!.text),t);assert.equal(r.finish!.health!.forward,'none',t);}
{const r=await runPipeline(free('my head hurts'),FAIL);assert.ok(r.finish!.receipt!.text.includes('careful'),'A health message keeps the careful line');assert.equal(r.finish!.health!.forward,'auto');}
{const r=await runPipeline(free(['I fell yesterday','where is the page?']),{...FAIL,provider:sequence(['no','no','no'])});assert.ok(r.finish!.receipt!.text.includes('careful'),'An earlier message in the topic that is not about the app');}
assert.ok(smallTalk('hello')&&smallTalk('thanks')&&!smallTalk('I fell'));
{const r=await runPipeline(free(['hello','where is the page?']),{...FAIL,provider:sequence(['no','no','no'])});assert.equal(r.finish!.receipt!.text,ASK_AGAIN_LINE.en,'A greeting says nothing about the topic');}
// Fable AQ-03: a second failure in a row stays the same line, never the doctor line; another of Zoe's questions still keeps the careful line.
for(const l of LANGS){const r=await runPipeline(free({en:'can I ask here?',hy:'կարո՞ղ եմ այստեղ հարցնել',ru:'можно спросить здесь?'}[l],{answers:[{body:ASK_AGAIN_LINE[l],minutesAgo:1}]}),{...FAIL,provider:sequence(['no','no','no'])});assert.equal(r.finish!.receipt!.text,ASK_AGAIN_LINE[l],l);assert.equal(r.finish!.health!.forward,'none');}
{const r=await runPipeline(free('where is the page?',{answers:[{body:'Which page do you mean?',minutesAgo:1}]}),{...FAIL,provider:sequence(['no','no','no'])});assert.ok(r.finish!.receipt!.text.includes('careful'));}
{const r=await runPipeline(free(['my head hurts','what now?']),{...FAIL,provider:sequence(['no','no','no'])});assert.ok(r.finish!.receipt!.text.includes('careful'),'A follow-up to a health message in the window');}
{const r=await runPipeline(free('yesterday',{answers:[{body:'When did it start?',minutesAgo:2}]}),{...FAIL,provider:sequence(['no','no','no'])});assert.ok(r.finish!.receipt!.text.includes('careful'),'An answer to Zoe\'s own question');}
{const held=await runPipeline(free('where is the page?'),{...FAIL,provider:sequence([reply('Text',{urgency:'doctor_soon'})]),judge:null});assert.ok(held.finish!.receipt!.text.includes('careful'),'The model said doctor_soon: not an app question');}
{const r=await runPipeline(free('where is the page?',{urgentSinceMinutes:30}),{...FAIL,provider:sequence(['no','no','no'])});assert.notEqual(r.finish!.receipt?.text,ASK_AGAIN_LINE.en,'An open 103 window keeps its own route');}
// Off too: this rule is about the message, not the app.
{const r=await runPipeline(free('can I ask here?'),{directAnswers:true,provider:sequence(['no','no','no'])});assert.equal(r.finish!.receipt!.text,ASK_AGAIN_LINE.en);}
// Doctor mode keeps the message with the doctor.
{const r=await runPipeline(free('can I ask here?',{doctorMode:true}),{directAnswers:true,env:V2,provider:sequence(['no','no','no'])});assert.equal(r.outcome,'discarded');assert.equal(r.finish!.receipt,null);}

// An urgent message with a page question in it still escalates, no model first.
const URGENT={NOREON_ZOE_TEST_LEXICON:undefined,NOREON_ZOE_URGENT_PLACEHOLDER:'true',...V2};
for(const text of ['where is the Me page, I have crushing chest pain for 20 minutes','Որտե՞ղ է Իմ էջը, կրծքիս ուժեղ ցավ ունեմ և չեմ կարողանում շնչել','где раздел Обо мне, у меня сильная боль в груди, трудно дышать']){
 const r=await runPipeline(free(text),{directAnswers:true,env:URGENT,provider:sequence([reply('Open the Me section.')])});
 assert.match(r.reason,/urgent|red_flag/u,text);assert.equal(health(r).length,0,'no model');assert.match(r.finish!.answer??'',/103/u);}

// The replay conversations may explain the doctor's role (batch fix 1), with no forward or 103.
for(const id of ['en-no-me-page','hy-no-me-page','ru-app-question']){const s=FIXED.find(x=>x.id===id) as {env?:Record<string,string>;rules:Record<string,unknown>;turns:{notMention?:string}[];lang:string}|undefined;
 assert.ok(s,id);assert.equal(s.env?.NOREON_MEMBER_CHAT_V2,'true');assert.equal(s.rules.no103,true);assert.equal(s.rules.maxUrgency,'planned');assert.equal(s.rules.noForward,true);assert.equal(s.turns.length,4);assert.ok(s.turns.every(t=>t.notMention===OLD_SECTIONS));}
const seen=new RegExp(OLD_SECTIONS,'iu');
for(const t of ['Open Care plan to see it.','Go to the Me section.','Посмотрите в разделе «План лечения».','Պլանը «Բուժման պլան» բաժնում է։'])assert.ok(seen.test(t),t);
for(const t of ['Everything happens here in this chat.','Your care plan is not published yet.','Ձեր բուժման պլանը դեռ հրապարակված չէ։','Ваш план лечения ещё не опубликован.'])assert.ok(!seen.test(t),t);
console.log('Zoe app questions: facts by switch, fixed lines of the new chat, the section net, the no-handoff line and urgent first.');
// Fable AQ-01 and AQ-04, last round.
{const {plainAppQuestion:q,missingSections:m}=await import('@/lib/zoe/app-question');
 for(const t of ['немеет язык','пропустила приём','пропустил приём утром','the page is blurry, I see double'])assert.ok(!q(t),`health keeps the doctor: ${t}`);
 assert.ok(q('как сменить язык?'),'changing the language is an app question');
 for(const t of ['The Me section does not exist here.',"The Me page doesn't exist in this chat.",'Իմ էջ բաժինն այստեղ չկա, ամեն ինչ այստեղ է։','«Բուժման պլան» բաժին այստեղ չկա։','Раздел «Обо мне» здесь не существует.','Раздела «Обо мне» в этом чате нет.','Вкладки «Прогресс» тут нет, всё здесь.'])assert.deepEqual(m(t),[],`a correct reply is not a hit: ${t}`);
 assert.deepEqual(m('Go to the Me section, it is not far.'),['section.named']);assert.deepEqual(m("Don't open the Me section."),[]);}
