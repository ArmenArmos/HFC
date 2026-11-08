import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {cardSchema} from '@/lib/zoe-chat-actions/registry';
import {cardTurns,dialogThread,mergeCards,upsertCard} from '@/lib/zoe-chat-actions/thread';
import {LivingVisitCard} from '@/components/chat-v2/living-visit-card';
import {LIVING_VISIT,findLivingVisit,VISIT_STEPS} from '@/lib/zoe-chat-actions/living-visit';
import {telegramCardView} from '@/lib/zoe-chat-actions/telegram';
import {openCard} from '@/lib/zoe-chat-actions/commands';
import {mintActor} from '@/lib/zoe-chat-actions/actor';
import {syncLivingVisit} from '@/lib/zoe-chat-actions/living-visit-read';
import {handleCardPress} from '@/lib/telegram-runtime/cards';
const id='00000000-0000-4000-8000-000000000001';
const invalidPublished={id,requestId:id,source:'chip',sourceSeq:null,kind:'visit',state:'open',outcome:{},at:'2026-11-07T09:00:00Z',snapshot:{v:1,available:true,next:null,proposal:null,attention:false,living:{visitId:id,source:'appointment',revision:1,status:'plan_published',startsAt:'2026-11-08T10:00:00Z',location:null,preparation:null,planId:null}}};
assert.equal(cardSchema.parse(invalidPublished).valid,false,'Publication without a plan identity must fail closed');
for(const locale of ['hy','ru','en']as const)for(const status of VISIT_STEPS){
 const card=cardSchema.parse({id,requestId:id,source:'chip',sourceSeq:null,kind:'visit',state:'done',claims:{},outcome:{[`visit:${id}:${status}`]:{status,doneAt:'2026-11-07T10:00:00Z'}},at:'2026-11-07T09:00:00Z',snapshot:{v:1,available:true,next:null,proposal:null,attention:false,living:{visitId:id,source:'appointment',revision:2,status,startsAt:status==='awaiting'?null:'2026-11-08T10:00:00Z',location:status==='awaiting'?null:'Clinic',preparation:null,planId:status==='plan_published'?id:null}}});
 assert.ok(card.valid&&card.kind==='visit');
 if(!card.valid||card.kind!=='visit')throw Error('Invalid visit');
 const html=renderToStaticMarkup(createElement(LivingVisitCard,{card,locale}));
 assert.ok(html.includes(LIVING_VISIT[status][locale]));
 assert.equal((html.match(/aria-current="step"/g)??[]).length,1);
 assert.equal((html.match(/data-step-state=/g)??[]).length,5);
 assert.ok(html.includes(`data-chat-card-id="${id}"`));
 const unavailable=renderToStaticMarkup(createElement(LivingVisitCard,{card:{...card,snapshot:{...card.snapshot,available:false}},locale}));
 assert.ok(unavailable.includes(LIVING_VISIT.unavailable[locale]));
 assert.equal(unavailable.includes('aria-current="step"'),false,'Unavailable visits claim no current progression step');
 assert.equal(cardTurns(card,true).length,0,'The current status is already on the living card');
 assert.equal(dialogThread([], [card],true).filter(e=>e.type==='card').length,1,'A completed booking keeps its living card');
 assert.equal(findLivingVisit([card])?.id,id,'Second menu tap finds the existing card');
 const older={...card,snapshot:{...card.snapshot,living:{...card.snapshot.living!,revision:1,location:'Old clinic'}}};
 const shown={enabled:true,cards:[card],clearedSeq:null};
 assert.deepEqual(mergeCards(shown,{...shown,cards:[older]}).cards[0],card,'An older poll cannot undo a reschedule');
 assert.deepEqual(upsertCard(shown,older).cards[0],card,'A late action cannot undo a reschedule');
 const malformed=cardSchema.parse({...card,outcome:{},snapshot:{v:99}});
 assert.equal(mergeCards(shown,{...shown,cards:[malformed]}).cards[0].valid,false,'A malformed refresh must render unavailable');
 assert.ok(telegramCardView(card,locale)?.text.includes(LIVING_VISIT[status][locale]));
 assert.equal(cardSchema.parse({...card,snapshot:{...card.snapshot,living:{...card.snapshot.living,status:'invented'}}}).valid,false);
 assert.equal(cardSchema.parse({...card,snapshot:{...card.snapshot,living:{...card.snapshot.living,extra:'unsafe'}}}).valid,false);
 const ports={snapshot:async()=>card.snapshot,readCards:async()=>shown,post:async()=>{throw Error('Menu attempted to post a duplicate');}};
 for(let tap=0;tap<2;tap++){
  const opened=await openCard(mintActor(id,'app'),ports,{kind:'visit',sourceSeq:null,requestId:crypto.randomUUID(),reuseCurrent:true});
  assert.ok(opened.status==='ok'&&opened.card.id===card.id,'Second menu tap returns the same persisted card');
 }
 assert.equal((await syncLivingVisit(async()=>({ok:true,card}),id))?.id,card.id);
 await assert.rejects(()=>syncLivingVisit(async()=>({ok:true,card:{...card,snapshot:{v:99}}}),id));
}
console.log('Living visit: 15 status/language renders, persistent card, menu reuse, Telegram, strict snapshots.');

// Telegram's limit counts UTF-16 code units, including both halves of supplementary characters.
const confirmed=cardSchema.parse({...invalidPublished,snapshot:{...invalidPublished.snapshot,living:{...invalidPublished.snapshot.living,status:'confirmed',planId:null}}});
assert.ok(confirmed.valid&&confirmed.kind==='visit');
const previousFlags={NOREON_ZOE_APP_V3:process.env.NOREON_ZOE_APP_V3,NOREON_MEMBER_CHAT_V2:process.env.NOREON_MEMBER_CHAT_V2};
try{
process.env.NOREON_ZOE_APP_V3='true';process.env.NOREON_MEMBER_CHAT_V2='true';
{
 const english='STAGING. Come fasting. Bring your ID.';
 for(const locale of ['hy','ru']as const){
  const guarded=cardSchema.parse({...confirmed,snapshot:{...confirmed.snapshot,living:{...confirmed.snapshot.living!,preparation:english}}});
  assert.ok(!telegramCardView(guarded,locale)!.text.includes('Come fasting'),`${locale}: English clinic preparation never reaches the Telegram living card`);
  assert.ok(!renderToStaticMarkup(createElement(LivingVisitCard,{card:guarded as never,locale})).includes('Come fasting'),`${locale}: nor the web living card`);
 }
}
const LETTER={hy:'ա',ru:'а',en:'x'}as const;
for(const locale of ['hy','ru','en']as const)for(const preparation of [LETTER[locale].repeat(4000),'😀'.repeat(2000)+LETTER[locale],LETTER[locale]+'😀'.repeat(1999)]){
 const long=cardSchema.parse({...confirmed,snapshot:{...confirmed.snapshot,living:{...confirmed.snapshot.living!,location:'𐐀'.repeat(500),preparation}}});
 assert.ok(long.valid,'Maximum-length text is a valid snapshot');
 const text=telegramCardView(long,locale)!.text;
 assert.ok(text.length<=4096,`${locale}: the entire Telegram message must fit max_utf16 (got ${text.length})`);
 assert.equal(text.isWellFormed(),true,'Truncation must not leave an unpaired surrogate');
 assert.ok(text.includes(LIVING_VISIT.confirmed[locale]));
 assert.ok(text.includes(LIVING_VISIT.title[locale]));
 assert.ok(text.includes((await import('@/lib/zoe-chat-actions/copy')).LDL.prepInApp[locale]),'Shortened preparation points to the existing in-app details');
 const enqueued=new Map<unknown,string>();
 const rpc=async(name:string,args:Record<string,unknown>)=>{
  if(name==='zoe_living_visit_sync')return {ok:true,card:long};
  if(name==='zoe_chat_card_send'){
   const body=args.p_body as string;
   if(body.length>4096||!body.isWellFormed())return {ok:false,code:'invalid'};
   enqueued.set(args.p_inbox,body);return {ok:true};
  }
  if(name==='channel_inbox_press_done')return {};
  throw Error(`Unexpected Telegram queue call ${name}`);
 };
 // The direct handler tests all renderer locales; the current inbound locale parser is separate.
 const press={inboxId:id,callbackId:'synthetic',chatId:1,messageId:1,memberId:id,endpointId:id,generation:1,cardId:id,action:'open_card',item:{kind:'visit'},locale} as Parameters<typeof handleCardPress>[2];
 for(let attempt=0;attempt<2;attempt++)assert.equal((await handleCardPress(rpc,{acknowledgeCallback:async()=> 'acknowledged' as const,editText:async()=> 'edited' as const},press)).status,'ok','The actual Telegram queue path accepts the bounded view');
 assert.equal(enqueued.size,1);assert.equal(enqueued.get(id),text);
}
}finally{
 for(const [key,value]of Object.entries(previousFlags)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
}
console.log('Living visit Telegram: maximum UTF-16 lengths, supplementary Unicode and actual queue adapter in hy/ru/en (supplied enqueue IO).');

// Actual snapshot builder, booking adapter and rendered Confirm handler, with session/store IO supplied.
const {readFileSync}=await import('node:fs');
const {default:vm}=await import('node:vm');
const {default:ts}=await import('typescript');
const React=await import('react'),jsx=await import('react/jsx-runtime');
const {act,create}=await import('react-test-renderer');
const copy=await import('@/lib/zoe-chat-actions/copy');
const labCopy=await import('@/lib/zoe-chat-actions/lab-visit-copy');
const registry=await import('@/lib/zoe-chat-actions/registry');
const commands=await import('@/lib/zoe-chat-actions/commands');
function load(file:string,boundaries:Record<string,unknown>,env:Record<string,string>={}){
 const exports:Record<string,unknown>={};
 const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 vm.runInNewContext(code,{exports,process:{env},FormData,console,require(name:string){assert.ok(name in boundaries,`Unexpected ${file} dependency ${name}`);return boundaries[name];}});
 return exports;
}
const proposal={appointmentId:id,proposalId:'00000000-0000-4000-8000-000000000002',startsAt:'2026-11-08T10:00:00Z',endsAt:'2026-11-08T11:00:00Z',clinicName:'Synthetic clinic',clinicAddress:'Synthetic address'};
const pending=cardSchema.parse({...confirmed,snapshot:{v:1,available:true,next:null,proposal,attention:false,living:{...confirmed.snapshot.living!,status:'awaiting',startsAt:null}}});
assert.ok(pending.valid&&pending.kind==='visit');
let stored= pending,executes=0,submitted:Promise<unknown>|null=null;
const bookings={token:'a'.repeat(64),hold:null,crisis:false,booking:{data:{clinicalHold:false},pilot:{unavailableReason:null,appointments:[{id,revision:0,status:'notification-pending',current:null,portal:{proposal:{id:proposal.proposalId,...proposal}}}]}}};
const serverSource=readFileSync('lib/zoe-chat-actions/server.ts','utf8');
const unused=Object.fromEntries([...serverSource.matchAll(/from ['"]([^'"]+)['"]/g)].map(m=>[m[1],{}]));
const server=load('lib/zoe-chat-actions/server.ts',{
 ...unused,'server-only':{},zod:await import('zod'),'./registry':registry,
 '@/lib/patient/zoe-app-v3':{zoeAppV3Enabled:()=>true},'@/lib/patient/member-chat-config':{memberChatOnlyEnabled:()=>true},
 './booking-read':{readVisitBooking:async()=>bookings},'./living-visit-read':{syncLivingVisit:async()=>stored},
 '@/lib/supabase/server':{createClient:async()=>({auth:{getUser:async()=>({data:{user:{id}}})}})},
},{NOREON_MEMBER_CHAT_V2:'true'}) as typeof import('../lib/zoe-chat-actions/server');
const summary=await server.buildSnapshot('visit',new Date('2026-11-07T10:00:00Z')) as typeof pending.snapshot;
assert.equal(summary.proposal?.proposalId,proposal.proposalId,'Living snapshot retains visitSnapshotFrom proposal');
assert.equal(summary.bookingToken,bookings.token,'Snapshot construction still reads the booking summary');
const actionSource=readFileSync('lib/zoe-chat-actions/actions.ts','utf8');
const actionUnused=Object.fromEntries([...actionSource.matchAll(/from ['"]([^'"]+)['"]/g)].map(m=>[m[1],{}]));
let acceptOk=true,loseBookingReply=false,failReceipt=false;
const committedBookings=new Set<FormDataEntryValue|null>();
let expectedProposal=proposal;
const bookingCalls:{proposalId:FormDataEntryValue|null;commandId:FormDataEntryValue|null}[]=[];
let claims=0,records=0,claimsEnabled=true;
const adapter=load('lib/zoe-chat-actions/actions.ts',{
 ...actionUnused,'node:crypto':await import('node:crypto'),'next/server':{},'./registry':registry,'./copy':copy,'./commands':commands,'./bp-flow':await import('@/lib/zoe-chat-actions/bp-flow'),'@/lib/member-medicines/ask-copy':await import('@/lib/member-medicines/ask-copy'),
 zod:await import('zod'),'@/lib/observability/with-logging':{loggedAction:(_name:string,fn:unknown)=>fn},
 '@/lib/patient/zoe-app-v3':{zoeAppV3Enabled:()=>true},'@/lib/patient/member-chat-config':{memberChatOnlyEnabled:()=>true},
 '@/lib/real-booking/appointment-actions':{answerMemberProposal:async(_prev:unknown,form:FormData)=>{
  executes++;bookingCalls.push({proposalId:form.get('proposalId'),commandId:form.get('commandId')});assert.equal(form.get('proposalId'),expectedProposal.proposalId);assert.equal(form.get('accept'),'true');
  if(acceptOk)committedBookings.add(form.get('commandId'));
  if(loseBookingReply){loseBookingReply=false;throw Error('Synthetic lost booking reply');}
  return {ok:acceptOk,code:acceptOk?undefined:'unavailable'};
 }},'@/lib/real-booking/actions':{},
 './actor':{sessionActor:async()=>mintActor(id,'app'),noActor:()=>({status:'signed_out'})},
 './server':{readZoeCard:async()=>stored,visitSnapshotFrom:server.visitSnapshotFrom,serviceRpc:()=>null,
  claimCard:async(_member:string,_card:string,item:string,op:string,payload:Record<string,unknown>)=>{
   claims++;if(!claimsEnabled)return {ok:false,code:'disabled',card:stored};const claim=stored.claims[item]??{op,payload};stored={...stored,claims:{...stored.claims,[item]:claim}};return {ok:true,claim};
  },
  recordCard:async(_member:string,_card:string,item:string,value:unknown)=>{records++;if(failReceipt){failReceipt=false;return {ok:false,code:'closed',card:stored};}stored={...stored,state:'done',outcome:{...stored.outcome,[item]:value}};return {ok:true,card:stored};}},
 './living-visit-read':{syncLivingVisit:async()=>{stored={...stored,snapshot:{...stored.snapshot,proposal:null,living:{...stored.snapshot.living!,status:'confirmed',startsAt:expectedProposal.startsAt,revision:stored.snapshot.living!.revision+1}}};return stored;}},
}) as typeof import('../lib/zoe-chat-actions/actions');
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const view=load('components/chat-v2/visit-card.tsx',{
 'react/jsx-runtime':jsx,'@/lib/zoe-chat-actions/registry':registry,'@/components/patient/zoe-card-controls':{},'@/lib/zoe-chat-actions/copy':copy,
 '@/components/patient/sign-in-ended':{SignInEnded:()=>null},'@/lib/zoe-chat-actions/labs-actions':{},
 '@/lib/zoe-chat-actions/booking-actions':{},'@/lib/zoe-chat-actions/actions':adapter,'@/lib/zoe-chat-actions/lab-visit-copy':labCopy,
 './use-card-save':{useCardSave:(_id:string,_l:string,onCard:(c:unknown)=>void)=>({busy:false,problem:null,opId:id,save:(run:()=>Promise<{card?:unknown}>)=>{submitted=run().then(r=>{if(r.card)onCard(r.card);return r;});}})},
 '@/components/patient/zoe-booking':{ZoeBooking:()=>null},'./dialog-turn':{},'./living-visit-card':{LivingVisitCard},'@/lib/brand':await import('@/lib/brand'),
}) as typeof import('../components/chat-v2/visit-card');
// Reproduced bug: a done card with A's receipt must still offer the different current proposal.
const legacyAccepted= {...pending,state:'done' as const,outcome:{accepted:{proposalId:id,commandId:id}}};
let regressionTree!:import('react-test-renderer').ReactTestRenderer;
await act(async()=>{regressionTree=create(React.createElement(view.VisitCard,{card:legacyAccepted,locale:'en',onCard:()=>{},onAct:()=>{}}));});
assert.ok(regressionTree.root.findAllByType('button').some(b=>b.children.join('')===labCopy.LAB_VISIT.confirm.en),'A different current proposal on an accepted card must remain actionable');
await act(async()=>regressionTree.unmount());
let regressionBookings=0;
const laterAction=await commands.acceptVisit(mintActor(id,'app'),{
 readCard:async()=>legacyAccepted,
 claim:async(_m:string,_c:string,_item:string,op:string,payload:Record<string,unknown>)=>({ok:true,claim:{op,payload}}),
 acceptProposal:async()=>{regressionBookings++;return {ok:true};},
 record:async()=>({ok:true,card:legacyAccepted}),
} as never,{cardId:id,commandId:id,proposalId:proposal.proposalId});
assert.equal(laterAction.status,'ok');
assert.equal(regressionBookings,1,'A receipt for A must not silently skip the booking command for B');
for(const locale of ['hy','ru','en']as const){
 stored=pending;
 let tree!:import('react-test-renderer').ReactTestRenderer;
 const props={card:stored,locale,onCard:(card:unknown)=>{tree.update(React.createElement(view.VisitCard,{...props,card:card as typeof stored}));},onAct:()=>{}};
 await act(async()=>{tree=create(React.createElement(view.VisitCard,props));});
 const rendered=JSON.stringify(tree.toJSON());
 assert.ok(rendered.includes(proposal.clinicName),'The proposed clinic is visible');
 assert.ok(!rendered.includes(LIVING_VISIT.awaiting[locale]),'A pending member action is not waiting for the clinic');
 assert.equal(tree.root.findAllByProps({'data-state':'confirmed'}).length,0,'Proposal is unconfirmed');
 const confirm=tree.root.findAllByType('button').find(b=>b.children.join('')===labCopy.LAB_VISIT.confirm[locale]);
 assert.ok(confirm,'The living card keeps the existing in-chat Confirm action');
 await act(async()=>{confirm.props.onClick();await submitted;});
 assert.equal(tree.root.findAllByProps({'data-chat-card-id':id}).length,1,'Acceptance updates the same card');
 assert.equal(tree.root.findAllByProps({'data-state':'confirmed'}).length,1);
 assert.equal(tree.root.findAllByType('button').length,0);
 await act(async()=>tree.unmount());
}
assert.equal(executes,3,'Each locale exercised the actual booking adapter once');
stored=pending;acceptOk=false;
assert.equal((await adapter.acceptVisitFromCard({cardId:id,commandId:id,proposalId:proposal.proposalId})).status,'unavailable');
assert.equal(stored.state,'open','A refused acceptance keeps the proposal actionable');
acceptOk=true;
assert.equal((await adapter.acceptVisitFromCard({cardId:id,commandId:crypto.randomUUID(),proposalId:proposal.proposalId})).status,'ok','Retry accepts the original proposal');
assert.equal(bookingCalls.at(-1)!.commandId,bookingCalls.at(-2)!.commandId,'A failed booking retry keeps its command identity even after a new browser operation id');
const acceptedExecutes=executes;
assert.equal((await adapter.acceptVisitFromCard({cardId:id,commandId:id,proposalId:proposal.proposalId})).status,'ok','A lost acceptance reply replays after reconciliation cleared the proposal');
assert.equal(executes,acceptedExecutes,'Acceptance replay does not execute a second booking command');
assert.equal((await adapter.acceptVisitFromCard({cardId:id,commandId:id,proposalId:id})).status,'stale','A different proposal cannot be accepted');
// The same mounted card keeps its operation id when the clinic later proposes another time.
const proposalB={...proposal,proposalId:'00000000-0000-4000-8000-000000000005',startsAt:'2026-11-09T10:00:00Z',endsAt:'2026-11-09T11:00:00Z'};
const firstReceipt=stored.outcome;
expectedProposal=proposalB;
stored={...stored,snapshot:{...pending.snapshot,proposal:proposalB,living:{...pending.snapshot.living!,revision:3}}};
assert.equal(stored.state,'done');
let laterTree!:import('react-test-renderer').ReactTestRenderer;
const laterProps={card:stored,locale:'en' as const,onCard:(card:unknown)=>{laterTree.update(React.createElement(view.VisitCard,{...laterProps,card:card as typeof stored}));},onAct:()=>{}};
await act(async()=>{laterTree=create(React.createElement(view.VisitCard,laterProps));});
const laterConfirm=laterTree.root.findAllByType('button').find(b=>b.children.join('')===labCopy.LAB_VISIT.confirm.en);
assert.ok(laterConfirm,'An accepted living card must offer Confirm for a different current proposal');
const beforeStale={executes,claims,records,stored:structuredClone(stored)};
assert.equal((await adapter.acceptVisitFromCard({cardId:id,commandId:id,proposalId:proposal.proposalId})).status,'stale','An old A press cannot accept B');
assert.deepEqual({executes,claims,records,stored},beforeStale,'Stale A makes no booking, claim or receipt write');
await act(async()=>{laterConfirm.props.onClick();await submitted;});
assert.equal(executes,beforeStale.executes+1,'B executes one booking command despite the earlier acceptance');
assert.equal(stored.id,id,'Both proposals use the same card');
assert.equal(stored.state,'done','Acceptance never reopens or rewrites a completed card');
for(const [item,value]of Object.entries(firstReceipt))assert.deepEqual(stored.outcome[item],value,'A receipt remains immutable');
const callA=bookingCalls.filter(c=>c.proposalId===proposal.proposalId).at(-1)!;
const callB=bookingCalls.at(-1)!;
assert.equal(callB.proposalId,proposalB.proposalId);
assert.notEqual(callA.commandId,callB.commandId,'Proposal B must not reuse A booking command identity');
const afterB={executes,claims,records};
assert.equal((await adapter.acceptVisitFromCard({cardId:id,commandId:crypto.randomUUID(),proposalId:proposalB.proposalId})).status,'ok','B replays after its proposal was cleared');
assert.equal((await adapter.acceptVisitFromCard({cardId:id,commandId:crypto.randomUUID(),proposalId:proposal.proposalId})).status,'ok','A still replays its own receipt after B');
assert.deepEqual({executes,claims,records},afterB,'Receipt replays do not write or execute another booking');
assert.equal(laterTree.root.findAllByType('button').length,0,'Accepted B offers no further Confirm');
await act(async()=>laterTree.unmount());
// Booking may commit before either its reply or its card receipt reaches the browser.
for(const failure of ['booking-reply','receipt-write','legacy-receipt-write']as const){
 stored=failure==='legacy-receipt-write'?{...pending,claims:{accepted:{op:crypto.randomUUID(),payload:{proposalId:proposal.proposalId}}}}:pending;
 expectedProposal=proposal;
 const committedBefore=committedBookings.size;
 // Each isolated scenario uses a fresh stored card identity, like a fresh database fixture.
 stored={...stored,id:crypto.randomUUID()};
 const cardId=stored.id;
 loseBookingReply=failure==='booking-reply';failReceipt=failure!=='booking-reply';
 const first=()=>adapter.acceptVisitFromCard({cardId,commandId:crypto.randomUUID(),proposalId:proposal.proposalId});
 if(loseBookingReply)await assert.rejects(first,/Synthetic lost booking reply/);
 else assert.equal((await first()).status,'closed','A receipt write can fail after booking has committed');
 assert.equal(committedBookings.size,committedBefore+1);
 assert.equal(Object.keys(stored.outcome).length,0,'No receipt was committed');
 const originalCommand=bookingCalls.at(-1)!.commandId;
 stored={...stored,snapshot:{...stored.snapshot,proposal:null,living:{...stored.snapshot.living!,status:'confirmed',startsAt:proposal.startsAt,revision:2}}};
 assert.equal((await first()).status,'ok','A matching persisted claim recovers after a poll cleared the proposal');
 assert.equal(bookingCalls.at(-1)!.commandId,originalCommand,'Recovery replays the original booking command');
 assert.equal(committedBookings.size,committedBefore+1,'Recovery commits no second booking command');
 assert.equal(stored.state,'done');
 const recoveredCalls:number=executes;
 assert.equal((await first()).status,'ok','The recovered receipt then replays without another booking call');
 assert.equal(executes,recoveredCalls);
}
// A claim left by a failed booking does not bypass the chat switch on retry.
stored={...pending,id:crypto.randomUUID()};expectedProposal=proposal;acceptOk=false;
const gatedInput={cardId:stored.id,commandId:crypto.randomUUID(),proposalId:proposal.proposalId};
assert.equal((await adapter.acceptVisitFromCard(gatedInput)).status,'unavailable');
acceptOk=true;claimsEnabled=false;
const beforeDisabled={executes,records,stored:structuredClone(stored)};
assert.equal((await adapter.acceptVisitFromCard(gatedInput)).status,'disabled','An existing claim must still pass the chat action switch');
assert.deepEqual({executes,records,stored},beforeDisabled,'A disabled retry makes no booking or receipt write');
claimsEnabled=true;
// Receipts written before this fix use the original, unkeyed acceptance item.
stored={...pending,state:'done',outcome:{accepted:{proposalId:proposal.proposalId,commandId:id}},snapshot:{...pending.snapshot,proposal:proposalB}};
assert.equal((await commands.acceptVisit(mintActor(id,'app'),{readCard:async()=>stored} as never,{cardId:id,commandId:id,proposalId:proposal.proposalId})).status,'stale','A legacy receipt cannot make stale A accept B');
console.log('Living proposal: real render/action, A then B on one done card, immutable receipts, distinct commands, receipt replay and stale presses (isolated IO).');

// Frozen base adapter versus the new adapter. Real SQL execution is covered by the
// companion rolled-back script; these supplied RPC responses test parsing and retry routing.
const nextIds=await import('@/lib/zoe-chat-actions/next-step-id');
const {chatNextStep}=await import('@/lib/zoe-chat-actions/next-step');
const nextStep=chatNextStep({questionnaireComplete:true,review:null,appointments:[],clinics:{},canBook:true,hasOpenRequest:false,lab:null,planPublished:false,now:new Date()},{episode:'rollout'});
const oldSnapshot={v:1,available:true,next:null,proposal:null,attention:false};
const oldVisit=registry.visitSnapshot.omit({living:true});
const rolloutChild={...confirmed,id:'00000000-0000-4000-8000-000000000003',requestId:'00000000-0000-4000-8000-000000000004'};
assert.equal(oldVisit.safeParse(confirmed.snapshot).success,false,'The frozen old snapshot contract rejects living');
for(const legacy of [true,false]){
 let parent=cardSchema.parse({id,requestId:nextIds.stepRequestId(id,nextStep),kind:'next_step',source:'chip',sourceSeq:null,state:'open',outcome:{},at:confirmed.at,snapshot:nextStep});
 let child:unknown=null,posts=0,builds=0;
 const calls:string[]=[],requests:unknown[]=[];
 const parse=(raw:unknown)=>{const parsed=cardSchema.parse(raw);return legacy&&parsed.valid&&parsed.kind==='visit'&&!oldVisit.safeParse(parsed.snapshot).success?cardSchema.parse({...parsed,snapshot:{v:99}}):parsed;};
 const adapter=load(legacy?'scripts/fixtures/next-step-actions-before-living.ts.fixture':'lib/zoe-chat-actions/next-step-actions.ts',{
  zod:await import('zod'),'@/lib/observability/with-logging':{loggedAction:(_n:string,fn:unknown)=>fn},'@/lib/observability/logger':{log:{warn(){}}},
  '@/lib/patient/zoe-app-v3':{zoeAppV3Enabled:()=>true},'./actor':{sessionActor:async()=>mintActor(id,'app'),noActor:()=>({status:'signed_out'})},
  './next-step-id':nextIds,'@/lib/patient-care/clinical-actions':{},
  './server':{readZoeCard:async()=>parent,readZoeCards:async()=>({enabled:true,cards:[parent]}),parseStoredCard:parse,
   buildSnapshot:async()=>{builds++;return legacy?oldSnapshot:confirmed.snapshot;},
   serviceRpc:()=>async(name:string,args:Record<string,unknown>)=>{
    calls.push(name);requests.push(args.p_request);
    if(child===null){
     posts++;child=name==='zoe_v3_next_step_follow_living'?rolloutChild:cardSchema.parse({...rolloutChild,requestId:args.p_request,snapshot:args.p_snapshot});
     parent={...parent,state:'done',outcome:{next_step:{target:'visit',requestId:(child as typeof rolloutChild).requestId}}};
    }
    return {ok:true,card:parent,next:child};
   }},
  './next-step-read':{readChatNextStep:async()=>({memberId:id,step:nextStep}),readTestsNeeded:async()=>({}),queueMissingTests:async()=>true},
 },{NOREON_MEMBER_CHAT_V2:'true'}) as typeof import('../lib/zoe-chat-actions/next-step-actions');
 const first=await adapter.followNextStep({cardId:id});
 assert.ok(first.status==='ok',`${legacy?'old':'new'} adapter can read its child`);
 assert.equal(first.next?.valid,true);
 const replay=await adapter.followNextStep({cardId:id});
 assert.ok(replay.status==='ok','Lost-response retry still reads the same child');
 assert.equal(replay.next?.id,first.next?.id);assert.equal(posts,1);assert.equal(builds,1);
 assert.deepEqual(calls,Array(2).fill(legacy?'zoe_v3_next_step_follow':'zoe_v3_next_step_follow_living'),'Only the new adapter opts into reconciliation');
 assert.equal(requests[1],first.next?.requestId,'Retry uses the saved child identity');
}
console.log('Living visit rollout: frozen old adapter and new adapter read children and replay with one post (isolated RPC IO).');
