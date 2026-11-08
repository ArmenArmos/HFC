import assert from "node:assert/strict";
import { QuestionnaireMemory } from "@/lib/patient/questionnaire-session";
import type { AssessmentDraft } from "@/lib/patient/types";
import { UNKNOWN } from "@/lib/clinical/types";
const initial: AssessmentDraft = {id:"assessment-one",revision:3,assessmentDate:"2026-10-13",answers:{},completedAt:null,urgentRule:null};
// Memory semantics only: quiet save retries (QA M-09) are off here and covered by check-urgent-screen.ts.
const memory = new QuestionnaireMemory();
const calls: Array<{resolve:(result:{ok:true;revision:number}|null)=>void}> = [];
const save = () => new Promise<{ok:true;revision:number}|null>(resolve=>calls.push({resolve}));
const first = memory.open(initial,save,[]);
first.accept([{fieldId:"q6.conditions",value:UNKNOWN}]);
first.accept([{fieldId:"q7.relatives",value:UNKNOWN}]);
first.go("q8.sleep_quality");
first.edit([{fieldId:"q8.sleep_quality",value:4}]);
await Promise.resolve();
const restored = memory.open(initial,save,[]);
assert.equal(restored,first,"A route remount owns the same queue while unsaved");
assert.equal(restored.answers["q6.conditions"].value,UNKNOWN);
assert.equal(restored.answers["q7.relatives"].value,UNKNOWN);
assert.equal(restored.fieldId,"q8.sleep_quality");
assert.equal(restored.entries[0].value,4);
assert.equal(restored.dirty,true);
const flush = restored.queue.flush();
calls[0].resolve(null);
assert.equal(await flush,false);
assert.equal(memory.open(initial,save,[]),first,"Failed saves keep the draft for remount retry");
const retry = restored.queue.retry();
await Promise.resolve();
calls[1].resolve({ok:true,revision:4});
await new Promise(resolve=>setTimeout(resolve,0));
calls[2].resolve({ok:true,revision:5});
assert.equal(await retry,true);
restored.go("q8.sleep_quality");
assert.equal(memory.open(initial,save,[]),restored,"A stale cached server snapshot cannot discard a newer acknowledged client revision");
const fresh = memory.open({...initial,revision:6,answers:restored.answers},save,[]);
assert.notEqual(fresh,first,"A fresh server snapshot wins after all local changes settle");
fresh.accept([{fieldId:"q6.conditions",value:UNKNOWN}]);
fresh.accept([{fieldId:"q7.relatives",value:UNKNOWN}]);
await Promise.resolve();
const obsoleteFlush = fresh.queue.flush();
const next = memory.open({...initial,id:"assessment-two"},save,[]);
calls[3].resolve({ok:true,revision:7});
assert.equal(await obsoleteFlush,false,"An assessment change cancels the old queue");
assert.equal(calls.length,4,"No remaining old batches start after the assessment changes");
assert.equal(next.queue.revision,3);
assert.deepEqual(next.answers,{});
next.edit([{fieldId:"q2.height",value:170}]);
memory.clear(first.id);
assert.equal(memory.open({...initial,id:next.id},save,[]),next,"A late completion from the old assessment cannot clear the new draft");
memory.clear(next.id);
assert.notEqual(memory.open({...initial,id:next.id},save,[]),next,"Completion clears retained browser memory");
console.log("Questionnaire memory survives route unmount/failure, restores draft and field, adopts clean server snapshots, and cancels obsolete assessment queues.");
const strictMemory = new QuestionnaireMemory();
let strictWrites = 0;
const strictSave = async () => { strictWrites++; return {ok:true as const,revision:4}; };
const strictFirst = strictMemory.open(initial,strictSave,[]);
strictMemory.open(initial,strictSave,[]);
strictFirst.accept([{fieldId:"q6.conditions",value:UNKNOWN}]);
assert.equal(await strictFirst.queue.flush(),true,"StrictMode's repeated initializer cannot cancel the session React retains");
assert.equal(strictWrites,1);

// Reopening after conflict must not trigger the generic unsaved-answer leave guard.
const {openQuestionnaireSession,reopenSavedQuestionnaire} = await import("@/lib/patient/questionnaire-session");
let beforeUnload: ((event: {preventDefault():void;returnValue?:string})=>void) | undefined;
let reloaded = 0, blocked = 0;
Object.defineProperty(globalThis,"window",{configurable:true,value:{
 addEventListener(name:string,handler:typeof beforeUnload){if(name === "beforeunload") beforeUnload=handler;},
 location:{reload(){reloaded++;beforeUnload?.({preventDefault(){blocked++;}});}},
}});
try {
 let rejectPending!: (value:{ok:false;reason:string})=>void;
 const conflicted = openQuestionnaireSession(initial,()=>new Promise<{ok:false;reason:string}>(resolve=>{rejectPending=resolve;}));
 conflicted.accept([{fieldId:"q2.weight_perception",value:"unknown"}]);
 const pendingSave = conflicted.queue.flush();
 await Promise.resolve();
 conflicted.edit([{fieldId:"q2.height",value:177}]);
 rejectPending({ok:false,reason:"conflict"});
 assert.equal(await pendingSave,false);
 beforeUnload?.({preventDefault(){blocked++;}});
 assert.equal(blocked,1,"Ordinary navigation still protects the rejected local edit");
 reopenSavedQuestionnaire(initial.id);
 assert.equal(reloaded,1);
 assert.equal(blocked,1,"Explicit Reopen saved version does not ask to retain the rejected edit");
 const recovered = openQuestionnaireSession({...initial,revision:4,answers:{"q2.weight_perception":{fieldId:"q2.weight_perception",value:"ok",source:"manual",answeredAt:"2026-10-13T00:00:00Z"}}},async()=>({ok:true as const,revision:5}));
 assert.notEqual(recovered,conflicted);
 assert.equal(recovered.answers["q2.weight_perception"].value,"ok");
 assert.equal(recovered.queue.pending,false);
 assert.equal(recovered.queue.failure,undefined);
} finally {delete (globalThis as {window?:unknown}).window;}
