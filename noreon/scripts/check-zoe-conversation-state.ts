import assert from 'node:assert/strict';
import {FOUNDER} from '@/lib/zoe/eval/conversation-founder';

import {ConversationState} from '@/lib/zoe/eval/conversation-state';
import {job,runPipeline} from '@/lib/zoe/eval/harness';
import {registeredSheets} from '@/lib/zoe/symptoms/intake';
import type {FinishInput} from '@/lib/zoe/pipeline';

// The selected suite style must apply to the entire founder replay.
assert.ok(FOUNDER[0]!.turns.every(turn=>!('style' in turn)), 'founder replay overrides selected suite style');

// Real pipeline, synthetic sequential persistence, no model/network/database calls.
const env={NOREON_ZOE_MEMBER_CLEAR:'true',NOREON_ZOE_URGENT_PLACEHOLDER:'true',NOREON_ZOE_TEST_LEXICON:'false'};
const state=new ConversationState({systolic:198,diastolic:106,minutesAgo:8},0);
const firstReading=state.context(0).memberClear!;
assert.equal(state.latestReading(25)?.minutesAgo,33);
assert.equal(state.context(25).memberClear?.readingMeasuredAt,firstReading.readingMeasuredAt);
assert.equal(state.context(25).memberClear?.readingVersion,'1');
const messages:{seq:number;text:string;minutesAgo:number}[]=[];
const answers:{body:string;minutesAgo:number}[]=[];
async function turn(seq:number,text:string,at:number){
 messages.push({seq,text,minutesAgo:0});
 const result=await runPipeline(job(text,{messageSeq:seq,messages:[...messages],answers:[...answers],directAnswers:true,healthAnswers:true,...state.context(at),
  conversation:{enabled:true,doctorName:null,answeredThroughSeq:seq-1,memberSpentTodayUsd:0,injectionsLast24h:0,locale:'en'},
  intake:{enabled:true,registered:registeredSheets(),active:null,doctorName:null,latestReading:state.latestReading(at),redFlagsAfterSeq:seq-1,resumable:null}}),
  {provider:null,directAnswers:true,env});
 assert.ok(result.finish);
 state.finish(seq,at,at+0.1,result.finish);
 const visible=result.finish.answer??result.finish.receipt?.text;
 if(visible)answers.push({body:visible,minutesAgo:0});
 return result.finish;
}
const first=await turn(1,'I feel weak',0);
assert.equal(first.outcome,'intake_escalated');
const open=state.context(1).memberClear!;
assert.equal(open.trigger?.reading?.id,firstReading.readingId);
assert.equal(open.trigger?.reading?.measuredAt,firstReading.readingMeasuredAt);
assert.equal(open.openedBy,'rule');
assert.equal(open.throughSeq,1);
const why=await turn(2,'why',2);
assert.equal(why.reason,'urgent_alarm_explained','why uses the saved trigger without a provider');
assert.ok(why.receipt?.text.includes('198/106'));assert.doesNotMatch(why.receipt!.text,/103/u);
assert.ok(why.events.some(e=>e.name==='zoe.urgent.conversation'),'fixed explanation retains the alarm anchor');
assert.equal(state.context(3).urgentSinceMinutes,null,'ordinary receipt closes legacy window');
assert.equal(state.context(3).memberClear?.startedAt,open.startedAt,'warning receipt retains original member alarm anchor');
assert.deepEqual(state.context(3).memberClear?.trigger,open.trigger);
assert.equal(state.context(3).memberClear?.throughSeq,1);
assert.equal(state.context(122).memberClear?.sinceMinutes,121,'warning receipt does not extend the original alarm window');
const clear=await turn(3,'I feel fine now',4);
assert.equal(clear.reason,'member_cleared_urgent_window');
assert.equal(state.context(5).memberClear?.startedAt,null);
assert.equal(state.context(5).memberClear?.clearThroughSeq,3);
assert.equal(state.context(5).memberClear?.suppressStoredReading,true);
const fresh=await turn(4,'I have chest pain',6);
assert.equal(fresh.reason,'urgent_route_no_model_call');
assert.ok(fresh.answer);
assert.equal(state.context(7).memberClear?.throughSeq,4);
assert.notEqual(state.context(7).memberClear?.startedAt,open.startedAt);
assert.equal(state.context(7).memberClear?.trigger?.reading,null,'cleared saved reading stays suppressed');

// A held clear still bounds the alarm; ordinary publications without the continuation close it.
const held=new ConversationState(null,0);
held.finish(1,0,.1,first);
held.finish(2,1,1.1,{...clear,receipt:null,memberClear:{...clear.memberClear!,startedAt:held.context(1).memberClear!.startedAt!,readingId:null,readingVersion:null}});
assert.equal(held.context(2).memberClear?.startedAt,null);
const ordinary=new ConversationState(null,0);
ordinary.finish(1,0,.1,first);
ordinary.finish(2,1,1.1,{...why,events:[]} as FinishInput);
assert.equal(ordinary.context(2).memberClear?.startedAt,null);
// Additional urgent publications advance the sequence, preserving the first anchor.
const repeated=new ConversationState(null,0);
const model={...first,outcome:'discarded',reason:'urgent_health_answer_model'} as FinishInput;
repeated.finish(1,0,.1,model);
repeated.finish(2,1,1.1,{...model,reason:'urgent_in_window_no_model_call',alarmTrigger:undefined});
assert.equal(repeated.context(2).memberClear?.throughSeq,2);
assert.equal(repeated.context(2).memberClear?.startedAt,repeated.context(1).memberClear?.startedAt);
assert.equal(repeated.context(2).memberClear?.openedBy,'model');
assert.deepEqual(repeated.context(2).memberClear?.trigger,first.alarmTrigger);
repeated.finish(3,2,2.1,{...why,answer:null,receipt:null,events:[]});
assert.equal(repeated.context(3).memberClear?.throughSeq,2,'no output does not close alarm');
repeated.finish(4,3,3.1,{...first,alarmTrigger:fresh.alarmTrigger});
assert.equal(repeated.context(4).memberClear?.openedBy,'rule');
assert.equal(repeated.context(4).memberClear?.throughSeq,4);
assert.deepEqual(repeated.context(4).memberClear?.trigger,fresh.alarmTrigger);
console.log('Zoe conversation state checks passed (real pipeline, no model calls)');
