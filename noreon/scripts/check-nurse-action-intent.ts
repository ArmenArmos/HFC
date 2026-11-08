// Plain words for button actions (lib/nurse-chat/action-intent.ts): the phrases open the same flow as the button; anything else is not a command.
import assert from 'node:assert/strict';
import {actionIntent,memberActionIntent} from '@/lib/nurse-chat/action-intent';

const same=(text:string,expected:ReturnType<typeof actionIntent>)=>assert.deepEqual(actionIntent(text),expected,text);
same('start visit',{kind:'start-visit',name:null});
same('Start the visit',{kind:'start-visit',name:null});
same('start visit for nare',{kind:'start-visit',name:'nare'});
same('open the visit for Hayk Test Three',{kind:'start-visit',name:'Hayk Test Three'});
same('начни визит для Хайка',{kind:'start-visit',name:'Хайка'});
same('открыть визит',{kind:'start-visit',name:null});
same('սկսել այցը',{kind:'start-visit',name:null});
same('mark the task done',{kind:'complete-task',which:null,note:null});
same('mark the first task done, note: called, no answer',{kind:'complete-task',which:'first',note:'called, no answer'});
same('Close task with note Called her, will retry tomorrow',{kind:'complete-task',which:null,note:'Called her, will retry tomorrow'});
same('отметь первую задачу выполненной, заметка: дозвонилась',{kind:'complete-task',which:'first',note:'дозвонилась'});
same('закрой задачу',{kind:'complete-task',which:null,note:null});
same('փակիր առաջադրանքը',{kind:'complete-task',which:null,note:null});
for(const text of [
 'start visit and then call the doctor','what is the visit time','visit','mark it done','mark the task done and cancel it','close the door','start a new task for Ani','mark the first task done, then delete the reading',
 'remind her about the visit','today','начни','задачу','','x'.repeat(400),'mark task done note','start visit for',
])assert.equal(actionIntent(text),null,text);
assert.equal(actionIntent(null),null);
const mem=(text:string,expected:ReturnType<typeof memberActionIntent>)=>assert.deepEqual(memberActionIntent(text),expected,text);
mem('add a care note: prefers evening calls',{kind:'care-note',text:'prefers evening calls'});
mem('Add note - she works nights',{kind:'care-note',text:'she works nights'});
mem('add a care note for her: daughter calls on Sundays',{kind:'care-note',text:'daughter calls on Sundays'});
mem('добавь заметку: предпочитает вечерние звонки',{kind:'care-note',text:'предпочитает вечерние звонки'});
mem('ավելացրու նշում: երեկոյան զանգեր',{kind:'care-note',text:'երեկոյան զանգեր'});
mem('hand over to the doctor',{kind:'hand-over',note:null});
mem('hand this over to the doctor: BP 150/95 two days, headache',{kind:'hand-over',note:'BP 150/95 two days, headache'});
mem('передай врачу: давление 150/95 два дня',{kind:'hand-over',note:'давление 150/95 два дня'});
mem('փոխանցիր բժշկին',{kind:'hand-over',note:null});
for(const text of ['add a note','add a care note','note: prefers evening calls','tell the doctor hello','hand over the keys','send to doctor strange','please add a care note and call her','remind her to hand over to the doctor','','x'.repeat(2200)])assert.equal(memberActionIntent(text),null,text);
assert.equal(memberActionIntent(null),null);
console.log('Nurse action words: start visit and mark task done (with an optional note) in en/ru/hy; anything else is not a command.');
