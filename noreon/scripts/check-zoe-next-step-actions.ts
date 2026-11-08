/** Real adapters with isolated session/store IO. No database, providers or network. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {z} from 'zod';
import {cardSchema,type ZoeCard,type ZoeCards} from '@/lib/zoe-chat-actions/registry';
import {redactEvent} from '@/lib/observability/redact';
import {chatNextStep} from '@/lib/zoe-chat-actions/next-step';
import * as ids from '@/lib/zoe-chat-actions/next-step-id';
import type * as Actions from '@/lib/zoe-chat-actions/next-step-actions';

const memberId=crypto.randomUUID();
const step=chatNextStep({questionnaireComplete:true,review:null,appointments:[],clinics:{},canBook:true,hasOpenRequest:false,lab:null,planPublished:false,now:new Date()},{episode:'current'});
const make=(kind:string,snapshot:unknown):ZoeCard=>cardSchema.parse({id:crypto.randomUUID(),requestId:crypto.randomUUID(),kind,snapshot,source:'chip',sourceSeq:null,state:'open',outcome:{},at:new Date().toISOString()});
let root=make('next_step',step);root={...root,requestId:ids.stepRequestId(memberId,step)};
const tests=make('tests_needed',{v:1,available:true,rows:[]});
const next=make('visit',{v:1,available:true,next:null,proposal:null,attention:false});
let card=tests,v3=true,v2='true',signedIn=true,available=true,current=true,queue=true;
let currentStep=step;
let reads=0,posts=0,enrollments=0,claims=0,queueCalls=0;
let postFailure=false,queueThrows=false;
const built:string[]=[],warnings:ReturnType<typeof redactEvent>[]=[],posted:Record<string,unknown>[]=[];
let cards:ZoeCards={enabled:true,cards:[root,tests],clearedSeq:null};
const out:Record<string,unknown>={};
const boundaries:Record<string,unknown>={
 'zod':{z},'@/lib/observability/with-logging':{loggedAction:(_name:string,fn:unknown)=>fn},
 '@/lib/observability/logger':{log:{warn:(msg:string,fields:Record<string,unknown>)=>warnings.push(redactEvent('warn',msg,fields))}},
 '@/lib/patient/zoe-app-v3':{zoeAppV3Enabled:()=>v3},
 './actor':{sessionActor:async()=>signedIn?{memberId,channel:'app'}:null,noActor:()=>({status:'signed_out'})},
 './next-step-id':ids,
 './server':{
  readZoeCard:async()=>{reads++;return card;},readZoeCards:async()=>({...cards,...(!available?{nextStepStatus:'unavailable'}:{})}),
  parseStoredCard:(c:unknown)=>c?cardSchema.parse(c):null,
  buildSnapshot:async(kind:string)=>{built.push(kind);return next.snapshot;},
  serviceRpc:()=>async(_name:string,args:Record<string,unknown>)=>{posts++;posted.push(args);return postFailure?{ok:false,code:'invalid'}:{ok:true,card:{...card,state:'done',outcome:{[card.kind]:{target:args.p_target,requestId:args.p_request}}},next};},
  claimCard:async()=>{claims++;return {ok:true};},recordCard:async()=>({ok:true,card:{...card,state:'done',outcome:{review:{saved:true}}}}),
 },
 './next-step-read':{readChatNextStep:async()=>current?{memberId,step:currentStep}:null,readTestsNeeded:async()=>tests.snapshot,queueMissingTests:async()=>{queueCalls++;if(queueThrows)throw Error('Sensitive provider detail');return queue;}},
 '@/lib/patient-care/clinical-actions':{enrollRealMember:async()=>{enrollments++;return {ok:true};}},
};
vm.runInNewContext(ts.transpileModule(readFileSync('lib/zoe-chat-actions/next-step-actions.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:out,process:{env:{get NOREON_MEMBER_CHAT_V2(){return v2;}}},require(name:string){assert.ok(name in boundaries,`Unexpected action boundary: ${name}`);return boundaries[name];}});
const {followNextStep,requestReviewFromCard}=out as typeof Actions;
for(const action of [followNextStep,requestReviewFromCard]){
 v3=false;assert.equal((await action({cardId:card.id})).status,'disabled');v3=true;
 v2='false';assert.equal((await action({cardId:card.id})).status,'disabled');v2='true';
 assert.equal((await action({cardId:card.id,memberId,target:'visit',snapshot:{}})).status,'invalid','Browser cannot supply identity, target or tests');
}
assert.equal(reads,0,'Disabled and invalid requests stop before reads');
signedIn=false;assert.equal((await followNextStep({cardId:card.id})).status,'signed_out');signedIn=true;
assert.equal((await followNextStep({cardId:tests.id})).status,'stale','Tests from another stage cannot open a visit just because the current target also needs tests');
root={...root,state:'done',outcome:{next_step:{target:'tests_needed',requestId:tests.requestId}}};cards={...cards,cards:[root,tests]};
available=false;assert.equal((await followNextStep({cardId:tests.id})).status,'unavailable');available=true;
current=false;assert.equal((await followNextStep({cardId:tests.id})).status,'stale');current=true;
assert.equal(posts,0,'Failed or stale reads do not post a target');
assert.equal((await followNextStep({cardId:tests.id})).status,'ok');assert.equal(posts,1);
card={...root,state:'open',outcome:{}};
for(const throws of [false,true]){
 queue=false;queueThrows=throws;
 const opened=await followNextStep({cardId:root.id});
 assert.equal(opened.status,'ok','Coordinator failure cannot block the lab-order card');
 assert.equal(opened.next?.kind,'visit');assert.equal(built.at(-1),'visit','Same snapshot path as the menu visit');
 assert.equal(posted.at(-1)?.p_target,'visit');
 assert.equal(posted.at(-1)?.p_request,ids.stableRequestId(`zoe-next-open:${root.id}:tests_needed`),'Keep the original stable source ref');
 assert.equal(warnings.at(-1)?.msg,'zoe.next_step_admin_task_unavailable','Real log redaction preserves the fixed event');
 assert.equal(warnings.at(-1)?.member_id,memberId);assert.equal(warnings.at(-1)?.request_id,posted.at(-1)?.p_request);assert.equal(warnings.at(-1)?.redacted_fields,undefined,'Correlation ids survive the real allow-list');assert.ok(!JSON.stringify(warnings).includes('Sensitive provider detail'));
}
queue=true;queueThrows=false;
postFailure=true;const failed=await followNextStep({cardId:root.id});postFailure=false;
assert.equal(failed.status,'unavailable');assert.equal(failed.card?.state,'open');assert.equal('next' in failed?failed.next:undefined,undefined,'Failed follow has no saved turn or target');
// A recorded press replays its target, even after the stage changes.
const priorQueues=queueCalls,priorBuilds=built.length;
for(const target of ['visit','tests_needed']){
 card={...root,outcome:{next_step:{target,requestId:next.requestId}}};current=false;
 assert.equal((await followNextStep({cardId:root.id})).status,'ok');
 assert.equal(posted.at(-1)?.p_request,next.requestId,'Replay uses the recorded request after refresh');
 assert.equal(posted.at(-1)?.p_target,target,'Legacy targets still replay');
}
assert.equal(queueCalls,priorQueues,'Recorded presses do not raise another task');assert.equal(built.length,priorBuilds,'Recorded presses do not build another snapshot');current=true;
card=make('review',{v:1});available=false;
assert.equal((await requestReviewFromCard({cardId:card.id})).status,'unavailable','Unknown safety/journey state cannot enrol a review');
assert.equal(claims,0);assert.equal(enrollments,0);
available=true;current=false;assert.equal((await requestReviewFromCard({cardId:card.id})).status,'stale');current=true;
assert.equal((await requestReviewFromCard({cardId:card.id})).status,'stale','An unrelated stage cannot enrol a review');
currentStep={...step,target:'review'};
assert.equal((await requestReviewFromCard({cardId:card.id})).status,'ok');assert.equal(enrollments,1);
card={...card,state:'done',outcome:{review:{saved:true}}};
assert.equal((await requestReviewFromCard({cardId:card.id})).status,'ok');assert.equal(enrollments,1,'Recorded review is idempotent');
console.log('Next-step actions: flags, strict browser input, session, stage-bound tests, fail-closed review, queue failure and recorded retries passed. Isolated IO.');
