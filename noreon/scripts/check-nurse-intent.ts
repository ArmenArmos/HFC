// Plain words that open the nurse's own work or a member search (lib/nurse-chat/intent.ts): the phrases the nurse scenarios use,
// in English, Russian and Armenian, and the questions that must stay ordinary Zoe questions.
import assert from 'node:assert/strict';
import {nurseIntent} from '@/lib/nurse-chat/intent';

const same=(input:string,expected:ReturnType<typeof nurseIntent>)=>assert.deepEqual(nurseIntent(input),expected,input);
for(const text of ['What do I have today?','whats urgent','What’s urgent today?','Zoe, what do i have','my day','today','Today','urgent first','что срочное с утра?','Что у меня сегодня','сегодня','Բարի լույս։ Այսօր ի՞նչ ունեմ','Zoe ինչ ունեմ էսօր առաջինը շտապները ցույց տուր','այսօր'])same(text,{kind:'today'});
for(const text of ['какие визиты сегодня и кто опаздывает','show visits','my visits','visits today','appointments'])same(text,{kind:'visits'});
// Overdue work has no list of its own; Today counts and marks it.
for(const text of ['who needs me first','Who needs me first?','who needs me now','who should I see first','who is waiting for me today','Who do I see first?','к кому мне идти сначала','кто меня ждёт','кому я нужна сегодня'])same(text,{kind:'priority'});
for(const text of ['who needs a call','who needs me to call her','who needs a statin','who should I see about the statin'])assert.equal(nurseIntent(text),null,text);
for(const text of ['any overdue tasks?','overdue','просроченные задачи','ժամկետանց առաջադրանքներ'])same(text,{kind:'today'});
for(const text of ['tasks','show my tasks','все задачи','առաջադրանքները'])same(text,{kind:'tasks',filter:'active'});
same('find lilit',{kind:'find',query:'lilit'});
same('Open Nare Test Four',{kind:'find',query:'nare test four'});
same('найди Нару',{kind:'find',query:'нару'});
same('открой пациента с телефоном на 0104',{kind:'find',query:'0104'});
same('find member with phone ending 0104',{kind:'find',query:'0104'});
same('հեռախոսի վերջը 0104 բացիր',{kind:'find',query:'0104'});
for(const text of ['any answers from the doctor?','What did the doctor say about my handoff for Nare','did the doctor actually see it or did we just send it?','handoffs','По моему утреннему случаю что врач решил и что теперь мне делать','есть ответ от врача','Բժշկի պատասխանը'])same(text,{kind:'handoffs'});
for(const text of ['who hasnt logged bp this week','Who hasn’t logged blood pressure this week?','which members have no bp readings','members without blood pressure this week','Кто не записал давление на этой неделе?','у кого нет давления за неделю','Ով չի գրանցել ճնշումն այս շաբաթ'])same(text,{kind:'missing-bp'});
// Anything else is a question or a reply, never a command.
for(const text of ['what is Ani Example’s blood pressure today','she says headache and dizzy since morning, what do i ask','is 138/88 ok for a 62 year old?','what was her last pressure','tell Gor his bp is fine','','x'.repeat(200),'find the latest ESC guideline on LDL targets for very high risk patients','Lilit','show me everything about the visit with Nare yesterday afternoon please'])assert.equal(nurseIntent(text),null,text);
assert.equal(nurseIntent('what did the doctor say about the visit on 21.01.1959'),null);
assert.equal(nurseIntent('who hasnt logged bp this week and call them'),null,'More than the question is not a cohort command');
assert.equal(nurseIntent('did Ani log bp this week'),null,'A question about one member is a Zoe question');
assert.equal(nurseIntent(null),null);assert.equal(nurseIntent('today\u0000'),null);
// Date of birth (member search by a written date): only as the identification of a member, with the number nearest the phone word winning.
for(const [text,query] of [['Та что родилась 21.01.1959 фамилию забыла','21.01.1959'],['born 1959-01-21','1959-01-21'],['find the member with date of birth 21/01/1959','21/01/1959'],['find phone +374 91-01-1959','37491011959'],['ծնված 21.01.1959 հիվանդին բացիր','21.01.1959'],['find member born 21.01.1959 phone 0104','0104'],['Zoe, find the patient born 21.01.1959','21.01.1959']] as const)assert.deepEqual(nurseIntent(text),{kind:'find',query},text);
for(const text of ['the visit on 21.01.1959 was moved','what is the risk for someone born 21.01.1959','find the visit on 04/11/2026','open the lab result from 2026-10-01','what was her pressure on 21.01.2026'])assert.equal(nurseIntent(text),null,text);
// Adherence facts: a whole-message request about medicines taken or reported; a question about one member stays with Zoe.
for(const text of ['adherence','show my adherence this week','who didn’t take their medicines this week','Who hasnt logged their meds','Кто не принимал лекарства, а кто просто ничего не отметил? Не смешивай','кто не принимал таблетки','приверженность лечению','Ով չի ընդունել դեղերը'])assert.deepEqual(nurseIntent(text),{kind:'adherence'},text);
for(const text of ['did Ani take her statin','is her adherence good','what medicines is Ani on','who needs a call'])assert.equal(nurseIntent(text),null,text);
console.log('Nurse plain-word intents: today, visits, overdue, tasks and find in en/ru/hy; questions and replies stay with Zoe.');
