import assert from 'node:assert/strict';
import {runEverydayMark,runEverydayHandBack,runEverydayHandBackForMember,runEverydayResolve,runEverydayCare} from '@/lib/staff-zoe/everyday-runtime';
import {runDoctorCard} from '@/lib/staff-zoe/card-read';
import {readEverydayConversation} from '@/lib/staff-zoe/everyday-read';
const id='11111111-1111-4111-8111-111111111111',doctor='22222222-2222-4222-8222-222222222222';
const env={NOREON_DOCTOR_WORKSPACE:'true',NOREON_DOCTOR_CHAT_HOME:'true',NOREON_DOCTOR_DECISIONS:'true',NOREON_ZOE_SCAFFOLD_ENABLED:'true',NOREON_ZOE_PIPELINE_ENABLED:'true',NOREON_CARE_ALERTS_ENABLED:'true'};
const calls:{name:string;args?:Record<string,unknown>}[]=[];
let result:unknown={ok:true,action:'reviewed',replayed:false},denied=false,openDenied=false;
const client={async rpc(name:string,args?:Record<string,unknown>){
 calls.push({name,args});
 if(name==='staff_zoe_status')return {data:true,error:null};
 if(name==='staff_zoe_read')return openDenied?{data:null,error:{code:'42501'}}:{data:{enabled:true,id,member:{id,name:'Fictional member',birthYear:null,sex:null},messages:[]},error:null};
 return denied?{data:null,error:{code:'42501'}}:{data:result,error:null};
}};
const c={client,role:'doctor',doctorId:doctor,expectedDoctorId:doctor};
const mark={conversationId:id,version:7,action:'reviewed'};
for(const role of ['admin','nurse'])assert.equal((await runEverydayMark({...c,role},mark,env)).kind,'refused');
assert.equal((await runEverydayMark({...c,expectedDoctorId:id},mark,env)).kind,'refused');
assert.equal((await runEverydayMark(c,mark,{})).kind,'refused');
assert.equal(calls.length,0,'Wrong actor and disabled screen never read or write');
assert.equal((await runEverydayMark(c,{...mark,version:undefined},env)).kind,'invalid');
assert.equal((await runEverydayMark(c,mark,env)).kind,'saved');
assert.deepEqual(calls.at(-1),{name:'doctor_zoe_answered_mark',args:{p_member:id,p_action:'reviewed',p_version:7}});
for(const code of ['stale','not_answered_by_zoe']){result={ok:false,code};assert.equal((await runEverydayMark(c,mark,env)).kind,'changed');}
result={ok:true,replayed:false};
const hand={conversationId:id,version:7,modeRevision:'a'.repeat(32)};
assert.equal((await runEverydayHandBack(c,hand,env)).kind,'saved');
assert.deepEqual(calls.at(-1),{name:'doctor_chat_hand_back',args:{p_member:id,p_version:7,p_mode_revision:'a'.repeat(32)}});
result={ok:true,replayed:true};assert.deepEqual(await runEverydayHandBack(c,hand,env),{kind:'saved',notice:'already_zoe'});
result={ok:false,code:'stale_context'};assert.equal((await runEverydayHandBack(c,hand,env)).kind,'changed');
result={ok:false,code:'zoe_inactive'};assert.equal((await runEverydayHandBack(c,hand,env)).kind,'zoe_inactive','Inactive Zoe is explained separately from a stale card');
assert.equal((await runEverydayHandBack(c,{...hand,modeRevision:undefined},env)).kind,'invalid');
// The doctor chat knows the member, not Doctor Zoe's own conversation: the database proves the assignment (real run, 3 Nov).
const byMember={memberId:id,version:7,modeRevision:'a'.repeat(32)};
result={ok:true,replayed:false};calls.length=0;
assert.equal((await runEverydayHandBackForMember(c,byMember,env)).kind,'saved');
assert.ok(!calls.some(call=>call.name==='staff_zoe_read'),'No staff conversation read is needed');assert.equal(calls.filter(call=>call.name==='doctor_chat_hand_back').length,1);
assert.deepEqual(calls.at(-1),{name:'doctor_chat_hand_back',args:{p_member:id,p_version:7,p_mode_revision:'a'.repeat(32)}});
assert.equal((await runEverydayHandBackForMember(c,{...byMember,memberId:'not-an-id'},env)).kind,'invalid');
assert.equal((await runEverydayHandBackForMember(c,{conversationId:id,version:7,modeRevision:'a'.repeat(32)},env)).kind,'invalid','A conversation id is not a member id');
openDenied=true;
const before=calls.length;assert.equal((await runEverydayHandBack(c,hand,env)).kind,'refused');
assert.ok(!calls.slice(before).some(c=>c.name==='doctor_chat_hand_back'),'Revoked conversation access never writes');openDenied=false;
denied=true;assert.equal((await runEverydayMark(c,mark,env)).kind,'refused');assert.equal((await runEverydayHandBack(c,hand,env)).kind,'refused');
const alert={alertId:id,seq:4,resolution:'member_contacted',note:'Reason'};
assert.equal((await runEverydayResolve(c,alert,env)).kind,'refused');denied=false;
result={ok:false,code:'changed'};assert.equal((await runEverydayResolve(c,alert,env)).kind,'changed');
assert.deepEqual(calls.at(-1),{name:'care_alert_resolve',args:{p_alert:id,p_expected_seq:4,p_resolution:'member_contacted',p_note:'Reason'}});
assert.equal((await runEverydayResolve(c,{...alert,note:'  '},env)).kind,'invalid');assert.equal((await runEverydayResolve(c,{...alert,resolution:'duplicate'},env)).kind,'invalid');
const closedAlert={id,memberId:id,memberName:'Fictional member',source:'message',priority:'urgent',reason:'urgent_words_matched',redFlags:[],state:'resolved',stateSeq:5,occurrences:1,createdAt:'2026-11-01T00:00:00Z',lastSeenAt:'2026-11-01T00:00:00Z',doctorName:null,acknowledgedAt:null,acknowledgedBy:null,resolvedAt:'2026-11-01T01:00:00Z',resolvedBy:'Doctor Earlier',resolution:'no_action_needed',resolutionNote:'Earlier note',telegram:[]};
result={ok:true,changed:false,alert:closedAlert};
assert.deepEqual(await runEverydayResolve(c,alert,env),{kind:'already_resolved',resolvedBy:'Doctor Earlier',resolvedAt:'2026-11-01T01:00:00Z'},'An idempotent close did not save this doctor’s outcome or note');
result={ok:true,changed:true,alert:closedAlert};
assert.equal((await runEverydayResolve(c,alert,env)).kind,'saved');
for(const run of [runEverydayMark,runEverydayHandBack]){
 const beforeOff:number=calls.length;
 assert.equal((await run(c,run===runEverydayMark?mark:hand,{...env,NOREON_ZOE_PIPELINE_ENABLED:'false'})).kind,'off');
 assert.deepEqual(calls.slice(beforeOff).map(c=>c.name),['staff_zoe_status'],'Pipeline off performs no write');
}

const note={id,revision:4,op:'note',kind:'contact-attempted',note:'Fictional contact note'};
result=5;assert.deepEqual(await runEverydayCare(c,note,env),{ok:true,revision:5});
assert.equal((await runEverydayCare({...c,role:'nurse'},note,env)).ok,false);
denied=true;assert.equal((await runEverydayCare(c,note,env)).ok,false);denied=false;
result={ok:false,code:'stale'};assert.equal((await runEverydayCare(c,note,env)).ok,false,'Ambiguous and stale command never claims success');
const initial={ok:true,conversationId:id,version:7,clinicalRevision:0,draftEpoch:0,sourceToken:'fixture',messages:[],replies:[],drafts:[],deliveries:[]};
const mode={ok:true,doctorMode:true,zoeActive:true,since:'2026-11-01T00:00:00Z',byName:'Fictional doctor',intakePaused:false};
const cursor={conversationId:id,memberId:id,version:7,reviewed:false};
let cursorVersion=7,cursorReviewed=false,denyRead=false;
const conversationReads:string[]=[];
const reads={async rpc(name:string){
 conversationReads.push(name);
 if(denyRead)return {data:null,error:{code:'42501'}};
 const data=name==='doctor_chat_retry_conversation'?{workspace:initial,mode,modeRevision:'a'.repeat(32),zoeReview:{...cursor,version:cursorVersion,reviewed:cursorReviewed}}:name==='doctor_conversation_topic_breaks'?{ok:true,breaks:[]}:name==='zoe_reply_drafts_for_doctor'?{ok:true,drafts:[]}:initial;
 return {data,error:null};
}};
let view=await readEverydayConversation(reads,id,env);
assert.equal(view.kind,'ready');if(view.kind==='ready'){assert.equal(view.zoeReview?.version,7);assert.equal(view.modeRevision,'a'.repeat(32));}
cursorReviewed=true;view=await readEverydayConversation(reads,id,env);
if(view.kind==='ready')assert.equal(view.zoeReview?.reviewed,true,'Reviewed status remains available for reopen after reload');
assert.ok(!conversationReads.includes('conversation_zoe_answered'),'Conversation card does not read the broad inbox');
cursorVersion=8;view=await readEverydayConversation(reads,id,env);if(view.kind==='ready')assert.equal(view.zoeReview,null,'Never attach a cursor for a different snapshot');
denyRead=true;assert.equal((await readEverydayConversation(reads,id,env)).kind,'refused');
console.log('Everyday backend: doctor/actor/screen gates, permission loss, exact version/seq forwarding, stale refusal, replay and snapshot cursor checks passed (mocked RPCs).');

const snapshot={id,revision:4,evidenceToken:'fictional',draft:null,draftSavedAt:null,draftStale:false,evidence:{profile:{name:null,birthDate:null,biologicalSex:null},consent:null,assessment:null,measurements:[],reports:[]}};
let snapshotDenied=false;
const cards={async rpc(name:string,args?:Record<string,unknown>){
 if(name==='patient_clinical_case_snapshot')return snapshotDenied?{data:null,error:{code:'42501'}}:{data:snapshot,error:null};
 if(name==='staff_zoe_status'||name==='staff_zoe_read')return client.rpc(name,args);
 return reads.rpc(name);
}};
const observations=await runDoctorCard(cards,{card:'observations',conversationId:id},env);
assert.equal(observations.kind,'ready');if(observations.kind==='ready'&&observations.card==='observations')assert.equal(observations.snapshot.revision,4);
snapshotDenied=true;assert.equal((await runDoctorCard(cards,{card:'observations',conversationId:id},env)).kind,'refused','Observation snapshot loses access closed');
snapshotDenied=false;denyRead=false;
assert.equal((await runDoctorCard(cards,{card:'conversation',conversationId:id},{...env,NOREON_DOCTOR_DECISIONS:'false'})).kind,'off');
assert.equal((await runEverydayHandBack(c,hand,{...env,NOREON_DOCTOR_DECISIONS:'false'})).kind,'off','Write shares the conversation capability flag');
console.log('Everyday cards: authorized observation snapshot, revoked snapshot and disabled conversation capability passed (mocked RPCs).');

const pipelineOffCalls:string[]=[];
const pipelineOffRead=await readEverydayConversation({async rpc(name:string){pipelineOffCalls.push(name);return reads.rpc(name);}},id,{...env,NOREON_ZOE_PIPELINE_ENABLED:'false'});
assert.deepEqual(pipelineOffCalls,['doctor_chat_retry_conversation'],'Pipeline off keeps the atomic read and skips only optional Zoe context');
assert.equal(pipelineOffRead.kind,'ready');
if(pipelineOffRead.kind==='ready'){
 assert.equal(pipelineOffRead.modeRevision,'a'.repeat(32),'Pipeline off retains the exact approval guard');
 assert.equal(pipelineOffRead.mode.doctorMode,true,'Pipeline off retains the displayed takeover state');
 assert.equal(pipelineOffRead.zoeReview,null);assert.equal(pipelineOffRead.replyDrafts,null);
}
console.log('Pipeline off: atomic conversation/mode read and approval revision retained; optional Zoe reads skipped (mocked RPCs).');
