/** Offline command checks. Ports model the existing atomic card record, never a hosted database. */
import assert from 'node:assert/strict';
import {mintActor} from '@/lib/zoe-chat-actions/actor';
import {cardSchema} from '@/lib/zoe-chat-actions/registry';
import {runEverydayWrite, type EverydayWritePorts} from '@/lib/zoe-chat-actions/everyday';

globalThis.fetch=(()=>{throw Error('Network forbidden in this check.');}) as typeof fetch;
const id='00000000-0000-4000-8000-000000000001';
const actor=mintActor(id,'app');
function world(){
 let card=cardSchema.parse({id,requestId:id,kind:'menu',source:'chip',sourceSeq:null,state:'open',outcome:{},claims:{},at:'2026-11-01T00:00:00Z',snapshot:{v:1,view:'earlier',token:'a'.repeat(64)}});
 let writes=0,token='a'.repeat(64),failReceipt=false;
 const ports:EverydayWritePorts={readCard:async()=>card,currentToken:async()=>token,claim:async(_m,_c,item,op,payload)=>{
  card.claims[item]??={op,payload};return {ok:true,claim:card.claims[item]};
 },record:async(_m,_c,item,value,close)=>{
  if(failReceipt&&item==='everyday:result')return {ok:false,code:'unavailable'};
  if(card.outcome[item])return {ok:true,card,replayed:true};
  card=cardSchema.parse({...card,state:close?'done':card.state,outcome:{...card.outcome,[item]:value}});
  return {ok:true,card,replayed:false};
 },execute:async()=>{writes++;await Promise.resolve();return {status:'saved'};}};
 return {ports,card:()=>card,writes:()=>writes,stale:()=>{token='b'.repeat(64);},lose:()=>{failReceipt=true;}};
}
const input={cardId:id,opId:id,view:'earlier' as const,input:{value:123}};
{
 const w=world();const r=await Promise.all([runEverydayWrite(actor,w.ports,input),runEverydayWrite(actor,w.ports,input)]);
 assert.equal(w.writes(),1,'simultaneous double press executes the non-idempotent action once');
 assert(r.some(x=>x.result?.status==='saved'));assert.equal(w.card().state,'done');
 const again=await runEverydayWrite(actor,w.ports,input);assert.equal(again.result?.status,'saved');assert.equal(w.writes(),1);
}
{
 const w=world();w.stale();assert.equal((await runEverydayWrite(actor,w.ports,input)).status,'stale');assert.equal(w.writes(),0);
}
{
 const w=world();assert.equal((await runEverydayWrite(actor,w.ports,{...input,view:'lessons'})).status,'invalid');assert.equal(w.writes(),0);
}
{
 const w=world();w.lose();await runEverydayWrite(actor,w.ports,input);
 assert.equal((await runEverydayWrite(actor,w.ports,input)).status,'unavailable');assert.equal(w.writes(),1,'lost receipt never repeats a save');
}
{
 const w=world();w.ports.execute=async()=>({status:'refused'});
 assert.equal((await runEverydayWrite(actor,w.ports,input)).result?.status,'refused');assert.equal(w.card().state,'done');
}
{
 const w=world();await runEverydayWrite(actor,w.ports,input);
 assert.equal((await runEverydayWrite(actor,w.ports,{...input,input:{value:124}})).status,'closed');
}
console.log('Everyday cards: double press, replay, stale, wrong view, lost receipt, refused and edited retry passed (offline ports).');

// Actual action adapters, isolated only at their IO boundaries. All network remains forbidden.
const {readFileSync}=await import('node:fs');
const vm=await import('node:vm');
const ts=await import('typescript');
const zod=await import('zod');
const contract=await import('@/lib/zoe-chat-actions/everyday-contract');
const registry=await import('@/lib/zoe-chat-actions/registry');
const commands=await import('@/lib/zoe-chat-actions/commands');
const everyday=await import('@/lib/zoe-chat-actions/everyday');
const {bookingToken}=await import('@/lib/zoe-chat-actions/booking');
const careModel=await import('@/lib/patient-care/model');
const measures=await import('@/lib/member-history/measures');
const lessons=await import('@/lib/lessons/catalogue');
const w=world();
const openedCards:ReturnType<typeof cardSchema.parse>[]=[];
let posts=0;
let enabled=true,signedIn=true,reads=0,hidden=false,journeyMode=false;
let currentPlan:import('../lib/patient-care/types').CarePlan|null=null;
let cardReadOverride:ReturnType<typeof cardSchema.parse>|null=null,completedRead=false;
let planCard:ReturnType<typeof cardSchema.parse>|null=null;
let versionsEnabled=false,regimensEnabled=false,versionReads=0,regimenReads=0,clientReads=0;
const {fixturePlan,fixturePlanVersion,fixtureMedicineChanges,fixtureId,everydayFixtures}=await import('./fixtures/chat-everyday');
const versions=[{...fixturePlanVersion,planId:fixtureId(90)},fixturePlanVersion];
const regimens=[{planId:fixtureId(90),changes:[]},{planId:fixturePlan.id,changes:fixtureMedicineChanges}];
let actualEverydayRead:((view:import('../lib/zoe-chat-actions/everyday-contract').EverydayView)=>Promise<import('../lib/zoe-chat-actions/everyday-read').EverydayRead>)|null=null;
const dispatched:string[]=[],logged:string[]=[];
const exports:Record<string,unknown>={};
vm.runInNewContext(ts.transpileModule(readFileSync('lib/zoe-chat-actions/everyday-actions.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require(name:string){
 if(name==='@/lib/supabase/server')return {createClient:async()=>{clientReads++;return {};}};
 if(name==='@/lib/doctor-completion/config')return {doctorCompletionEnabled:()=>versionsEnabled};
 if(name==='@/lib/patient-care/regimen-config')return {multiMedicineEnabled:()=>regimensEnabled};
 if(name==='@/lib/doctor-completion/document-runtime')return {readMemberPlanVersions:async()=>{versionReads++;return versions;}};
 if(name==='@/lib/patient-care/regimen-runtime')return {readMemberRegimens:async()=>{regimenReads++;return regimens;}};
 if(name==='zod')return zod;
 if(name==='@/lib/observability/with-logging')return {loggedAction:(name:string,fn:unknown)=>{logged.push(name);return fn;}};
 if(name==='@/lib/patient/zoe-app-v3')return {journeyCardsEnabled:()=>enabled||journeyMode};
 if(name==='@/lib/patient/member-chat-config')return {memberChatOnlyEnabled:()=>enabled};
 if(name==='./actor')return {sessionActor:async()=>signedIn?actor:null,noActor:async()=>({status:'signed_out'})};
 if(name==='./server')return {readZoeCard:async()=>cardReadOverride??planCard??w.card(),claimCard:(...args:Parameters<typeof w.ports.claim>)=>w.ports.claim(...args),recordCard:(...args:Parameters<typeof w.ports.record>)=>w.ports.record(...args),readZoeCards:async()=>({enabled:true,clearedSeq:null,cards:openedCards}),postCard:async(_member:string,requestId:string,kind:string,_source:string,_seq:null,snapshot:unknown)=>{
  posts++;const card=cardSchema.parse({id:crypto.randomUUID(),requestId,kind,source:'chip',sourceSeq:null,state:'open',claims:{},outcome:{},snapshot,at:new Date(Date.UTC(2026,10,1,0,0,posts)).toISOString()});openedCards.push(card);return {ok:true,card};
 }};
 if(name==='./everyday-read')return {readEveryday:async(view:string)=>{reads++;if(actualEverydayRead)return actualEverydayRead(view as import('../lib/zoe-chat-actions/everyday-contract').EverydayView);return completedRead?{...everydayFixtures[view],token:'b'.repeat(64)}:{view,token:'a'.repeat(64)};}};
 if(name==='./everyday-contract')return contract;
 if(name==='./everyday')return everyday;
 if(name==='./registry')return registry;
 if(name==='./commands')return commands;
 if(name==='./booking')return {bookingToken};
 if(name==='@/lib/member-history/measures')return measures;
 if(name==='@/lib/lessons/catalogue')return {...lessons,findLesson:()=>hidden?null:{id:'home-bp'},lessonsShowDrafts:()=>false};
 if(name==='@/lib/lessons/server')return {readLessonProgress:async()=>({done:[]})};
 if(name==='@/lib/patient-care/model')return careModel;
 if(name==='@/lib/patient-care/repository')return {getCareData:async()=>{reads++;return {plan:currentPlan,events:[]};}};
 if(name==='@/app/patient/progress/earlier/actions')return {addEarlierValue:async()=>{dispatched.push('earlier');return {status:'saved'};}};
 if(name==='@/app/patient/learn/actions')return {markLessonDone:async()=>{dispatched.push('lessons');return {ok:true};}};
 if(name==='@/app/patient/care/actions')return {acknowledgePlan:async()=>{dispatched.push('plan_ack');return {ok:true};}};
 throw Error(`Unexpected adapter boundary ${name}`);
}});
const adapters=exports as typeof import('../lib/zoe-chat-actions/everyday-actions');
const earlier={...input,input:{measure:'weight',value:75,value2:null,unit:'kg',measuredOn:'2020-01-01'}};
enabled=false;
assert.equal((await adapters.openEverydayCard({requestId:id,view:'earlier'})).status,'disabled');
assert.equal((await adapters.readEverydayFromCard(id)).status,'disabled');
assert.equal((await adapters.saveEverydayFromCard(earlier)).status,'disabled');
assert.equal((await adapters.readPlanFromCard(id)).status,'disabled');
assert.equal(reads,0);
journeyMode=true;signedIn=false;
assert.equal((await adapters.openEverydayCard({requestId:id,view:'earlier'})).status,'disabled','V3 does not enable other everyday cards');
assert.equal((await adapters.saveEverydayFromCard(earlier)).status,'disabled');
assert.equal((await adapters.readPlanFromCard(id)).status,'signed_out','V3 plan read retains session guard');
assert.equal((await adapters.saveEverydayFromCard({cardId:id,opId:id,view:'plan_ack',input:{planId:id}})).status,'signed_out','V3 acknowledgement retains session guard');
journeyMode=false;enabled=true;signedIn=false;
assert.equal((await adapters.openEverydayCard({requestId:id,view:'help'})).status,'signed_out');
assert.equal((await adapters.readEverydayFromCard(id)).status,'signed_out');
assert.equal((await adapters.saveEverydayFromCard(earlier)).status,'signed_out');
assert.equal(reads,0);
signedIn=true;
assert.equal((await adapters.openEverydayCard({requestId:id,view:'help',memberId:id})).status,'invalid');
assert.equal((await adapters.saveEverydayFromCard({...earlier,memberId:id})).status,'invalid');
assert.equal((await adapters.saveEverydayFromCard(earlier)).result?.status,'saved');
assert.deepEqual(dispatched,['earlier']);
assert(!JSON.stringify(w.card().claims).includes('2020-01-01'),'Claims contain no earlier result data');
assert.equal((await adapters.saveEverydayFromCard(earlier)).result?.status,'saved');
assert.deepEqual(dispatched,['earlier'],'Saved result replay never invokes feature action again');
for(const view of contract.EVERYDAY_VIEWS){
 const first=await adapters.openEverydayCard({requestId:crypto.randomUUID(),view});assert.equal(first.status,'ok');
 const before=posts;
 for(let i=0;i<3;i++)assert.equal((await adapters.openEverydayCard({requestId:crypto.randomUUID(),view})).card?.id,first.card?.id,`${view}: repeat open/reload with a fresh request ID reuses the current card`);
 assert.equal(posts,before,'Repeat opens do not post');
}

// Saved cards remain readable after their own save changes the content token.
completedRead=true;
const savedEarlier=await adapters.readEverydayFromCard(id);
assert.equal(savedEarlier.status,'ok','Saved earlier value reads current member content after reload');
cardReadOverride=cardSchema.parse({...w.card(),snapshot:{v:1,view:'lessons',token:'a'.repeat(64)},claims:{everyday:{op:id,payload:{view:'lessons',digest:bookingToken({lessonId:'bp-why-treat',done:true})}}}});
const completedLesson=await adapters.readEverydayFromCard(id);
assert.equal(completedLesson.status,'ok');
assert(completedLesson.status==='ok');assert.equal(completedLesson.completedLessonId,'bp-why-treat','Reload recovers the selected visible lesson from the private digest');
cardReadOverride=cardSchema.parse({...cardReadOverride,outcome:{everyday:{attempted:true},'everyday:result':{status:'refused'}}});
assert.equal((await adapters.readEverydayFromCard(id)).status,'closed','A refused write cannot reopen completed controls');
cardReadOverride=cardSchema.parse({...cardReadOverride,state:'open',outcome:{},claims:{}});
assert.equal((await adapters.readEverydayFromCard(id)).status,'stale','Uncompleted cards keep revision checks');
completedRead=false;cardReadOverride=null;

// Held/superseded plans never reach acknowledgement, and drafts/rejected lessons never reach completion.
assert.equal((await adapters.saveEverydayFromCard({cardId:id,opId:id,view:'plan_ack',input:{planId:id}})).status,'stale');
hidden=true;
assert.equal((await adapters.saveEverydayFromCard({cardId:id,opId:id,view:'lessons',input:{lessonId:'home-bp',done:true}})).status,'unavailable');
assert.deepEqual(dispatched,['earlier']);
assert.deepEqual(logged,['openEverydayCard','readEverydayFromCard','readPlanFromCard','saveEverydayFromCard']);
// Revised plan: each feature gate is independent, and details belong to this exact publication.
planCard=cardSchema.parse({id,requestId:id,kind:'plan',source:'chip',sourceSeq:null,state:'open',claims:{},outcome:{},at:'2026-11-01T00:00:00Z',snapshot:{v:1,available:true,plan:{id:fixturePlan.id,clinician:fixturePlan.clinician,publishedAt:fixturePlan.publishedAt,instructions:fixturePlan.instructions,version:2,medicines:[],acknowledged:false}}});
assert.equal((await adapters.readPlanFromCard(id)).status,'stale','Held plan exposes no change details');
currentPlan={...fixturePlan,id:fixtureId(99)};
assert.equal((await adapters.readPlanFromCard(id)).status,'stale','Superseded card exposes no change details');
assert.equal(clientReads,0);
currentPlan=fixturePlan;
for(const versionGate of [false,true])for(const regimenGate of [false,true]){
 versionsEnabled=versionGate;regimensEnabled=regimenGate;
 const beforeVersions=versionReads,beforeRegimens=regimenReads;
 const result=await adapters.readPlanFromCard(id);assert.equal(result.status,'ok');assert(result.status==='ok');
 assert(result.doses.some(d=>d.medication.id===fixturePlan.medications[0].id),'Current plan includes today’s scheduled doses');
 assert.equal(result.version,versionGate?fixturePlanVersion:null);
 assert.equal(result.medicineChanges,regimenGate?fixtureMedicineChanges:undefined);
 assert.equal(versionReads-beforeVersions,Number(versionGate),'Disabled version gate makes no read');
 assert.equal(regimenReads-beforeRegimens,Number(regimenGate),'Disabled regimen gate makes no read');
}
planCard=null;currentPlan=null;
console.log('Everyday adapters: logged actions, all view opens, flags/auth, strict input, existing action dispatch, private claims, held/superseded plans, version/regimen gates and invisible lesson refusals; repeated opens/reloads in eight views passed (offline IO).');

assert.equal(contract.memberCardTarget('/patient/bp-week'),'bp_week');
assert.equal(contract.memberCardTarget('/patient/progress/earlier'),'earlier');
assert.equal(contract.memberCardTarget('/patient/results/history'),'result_history');
assert.equal(contract.memberCardTarget('/patient/review'),'previous_plans');
assert.equal(contract.memberCardTarget('/patient/help#about-zoe'),'help');
assert.equal(contract.memberCardTarget('/patient/team?section=contact'),'team');
assert.equal(contract.memberCardTarget('/patient/zoe?card=plan'),'plan');
assert.equal(contract.memberCardTarget('/patient/help?view=classic'),null,'Classic route remains an explicit exit');
assert.equal(contract.memberCardTarget('/patient/results/history?view=trends'),null,'Do not silently replace trends with numeric history');
assert.equal(contract.memberCardTarget('/patient/progress/earlier?edit=file'),null,'Do not silently discard a particular upload edit');
assert.equal(contract.memberCardTarget('https://example.com/patient/help'),null);
assert.equal(contract.memberCardTarget('tel:103'),null,'Emergency calling remains an explicit external handoff');
console.log('Everyday routing: page and chat links open corresponding cards; classic, trends, particular upload edits and external handoffs retain their routes.');

// Result-history data uses the member repository without converting it to a clinic result.
const readExports:Record<string,unknown>={};
let bpFailure=false;
let bpRead=(everydayFixtures.bp_week as Extract<import('../lib/zoe-chat-actions/everyday-read').EverydayRead,{view:'bp_week'}>).read;
let ownHistory:unknown=(everydayFixtures.earlier as Extract<import('../lib/zoe-chat-actions/everyday-read').EverydayRead,{view:'earlier'}>).history;
vm.runInNewContext(ts.transpileModule(readFileSync('lib/zoe-chat-actions/everyday-read.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:readExports,process:{env:{}},require(name:string){
 if(name==='server-only')return {};
 if(name==='@/lib/patient/repository')return {requireRegistered:async()=>({assessment:{}})};
 if(name==='@/lib/bp-week/server')return {readMemberBpWeekOrThrow:async()=>{if(bpFailure)throw Error('BP week read failed.');return bpRead;},readMemberBpWeek:async()=>bpRead};
 if(name==='@/lib/bp-device/config')return {bpDevicesEnabled:()=>false};
 if(name==='@/lib/member-history/server')return {readOwnHistory:async()=>ownHistory};
 if(name==='@/lib/patient-care/repository')return {getCareData:async()=>({results:[],tests:[]})};
 if(name==='./booking')return {bookingToken};
 return {};
}});
const readHistory=readExports as typeof import('../lib/zoe-chat-actions/everyday-read');
const historyRead=await readHistory.readEveryday('result_history');assert(historyRead.view==='result_history');
assert.equal(historyRead.reportedValues?.length,2,'Earlier results are included even without clinic history');
assert.equal(historyRead.reportedValues?.[0].source,'member-reported','Source stays member-reported');
ownHistory=null;
const unavailableHistory=await readHistory.readEveryday('result_history');assert(unavailableHistory.view==='result_history');
assert.equal(unavailableHistory.reportedValues,null,'Unreadable member history is not an empty list');
console.log('Completed-card reads, selected lesson recovery, current plan doses and result-history member provenance passed (offline IO).');

// Actual content reader + card adapter, only IO stubbed. Counts cannot change availability.
actualEverydayRead=readHistory.readEveryday;
const bpTemplate=bpRead.enabled?bpRead.weeks[0]:null;
for(const count of [0,7]){
 assert(bpRead.enabled);
 bpRead={...bpRead,weeks:count===0?[]:[{...bpTemplate!,readings:Array.from({length:count},(_,i)=>({id:fixtureId(100+i),day:i+1,slot:'morning' as const,systolic:120,diastolic:80,pulse:70,measuredAt:`2026-11-0${i+1}T04:00:00Z`}))}]};
 const snapshot=await readHistory.readEveryday('bp_week');
 cardReadOverride=cardSchema.parse({...makeEverydayCard(),snapshot:{v:1,view:'bp_week',token:snapshot.token}});
 const result=await adapters.readEverydayFromCard(id);assert.equal(result.status,'ok',`${count} readings: real reader/adapter stays available`);assert(result.status==='ok'&&result.data.view==='bp_week'&&result.data.read.enabled);
}
function makeEverydayCard(){return {id,requestId:id,kind:'menu',source:'chip',sourceSeq:null,state:'open',claims:{},outcome:{},at:'2026-11-01T00:00:00Z'};}
console.log('BP week: real everyday reader and card adapter preserve enabled empty and seven-reading data (offline RPC stand-in).');

// Switch-off is valid content, independent of how many ordinary readings exist.
bpRead={version:'bp-week-v1',enabled:false};
const offSnapshot=await readHistory.readEveryday('bp_week');
cardReadOverride=cardSchema.parse({...makeEverydayCard(),snapshot:{v:1,view:'bp_week',token:offSnapshot.token}});
const offResult=await adapters.readEverydayFromCard(id);
assert(offResult.status==='ok'&&offResult.data.view==='bp_week'&&!offResult.data.read.enabled);
bpFailure=true;
assert.equal((await adapters.openEverydayCard({requestId:crypto.randomUUID(),view:'bp_week'})).status,'unavailable','A failed RPC does not open a turned-off snapshot');
await assert.rejects(()=>adapters.readEverydayFromCard(id),/BP week read failed/,'A failed read reaches the UI load-error path, not the turned-off panel');
bpFailure=false;

// The real RPC reader distinguishes the gate from failures without leaking provider text.
const bpServerExports:Record<string,unknown>={};
const bpModel=await import('@/lib/bp-week/model');
let rpcError=false,rpcThrows=false,rpcData:unknown={version:'bp-week-v1',enabled:false};
vm.runInNewContext(ts.transpileModule(readFileSync('lib/bp-week/server.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:bpServerExports,require(name:string){
 if(name==='server-only')return {};
 if(name==='./model')return bpModel;
 if(name==='@/lib/supabase/server')return {createClient:async()=>({rpc:async()=>{if(rpcThrows)throw Error('Synthetic provider detail');return {data:rpcData,error:rpcError?{message:'Synthetic provider detail'}:null};}})};
 throw Error(`Unexpected BP server import ${name}`);
}});
const bpServer=bpServerExports as typeof import('../lib/bp-week/server');
assert.equal((await bpServer.readMemberBpWeekOrThrow()).enabled,false,'Gate-off is a valid RPC result');
for(const failure of ['rpc','schema','throw']){
 rpcError=failure==='rpc';rpcThrows=failure==='throw';rpcData=failure==='schema'?{}:{version:'bp-week-v1',enabled:false};
 await assert.rejects(()=>bpServer.readMemberBpWeekOrThrow(),/^Error: The BP week could not be loaded\.$/);
 assert.equal((await bpServer.readMemberBpWeek()).enabled,false,'Home retains its quiet outage fallback');
}
console.log('BP week: gate-off stays readable; RPC, thrown and schema failures are distinct from disabled tracking.');
