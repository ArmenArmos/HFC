/**
 * WP V: spoken confirmation. A yes writes only through the card's own command, only for the member's most recent open
 * card, only with the nonce bound to that card, its revision and the exact pending action, only with a strict
 * whole-utterance yes, and (for a recorded turn) only with a valid server receipt. A transcript or a model alone never
 * writes. Provenance: the reading keeps the label the server put on the card. The caregiver and consents commands record
 * method 'voice' only when the server says so; the browser can only send 'tap'.
 * Run: node --no-warnings --conditions=noreon-server-test --import ./scripts/register-alias.mjs scripts/check-voice-confirm.ts
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {cardSchema,type ZoeCard,type ZoeCards} from '@/lib/zoe-chat-actions/registry';
import {mintActor} from '@/lib/zoe-chat-actions/actor';
import {matchesCancel,matchesConfirmation,confirmationAnswer} from '@/lib/voice-core/confirm';
import {consentCardInputSchema} from '@/lib/consents/schema';
import {caregiverInviteInputSchema} from '@/lib/caregivers/schema';
import type {CaregiverRpc} from '@/lib/caregivers/server';

globalThis.fetch=(()=>{throw Error('No network in this check');}) as typeof fetch;
const {confirmVoiceCard,signVoiceNonce,issueVoiceNonce,cardRevision,withReminder}=await import('@/lib/zoe-chat-actions/voice-card');
const {logBp}=await import('@/lib/zoe-chat-actions/commands');
const {runConsentDecision}=await import('@/lib/consents/server');
const {runCaregiverInvite,caregiverProof}=await import('@/lib/caregivers/server');
const {confirmStaffVoice,signStaffVoiceNonce}=await import('@/lib/staff-zoe/voice-confirm');
function scenario(name:string,fn:()=>Promise<void>|void){return Promise.resolve(fn()).then(()=>console.log(`ok   ${name}`));}

const secret='s'.repeat(48),member='11111111-1111-4111-8111-111111111111',other='99999999-9999-4999-8999-999999999999';
const cardId='22222222-2222-4222-8222-222222222222',newer='33333333-3333-4333-8333-333333333333',opId='44444444-4444-4444-8444-444444444444';
const actor=mintActor(member,'app');
const typed=(entrySource?:string)=>({systolic:145,diastolic:92,pulse:70,measuredAt:'2026-11-08T08:00:00.000Z',...(entrySource?{entrySource}:{})});
const bpCard=(over:Record<string,unknown>={}):ZoeCard=>cardSchema.parse({id:cardId,requestId:cardId,kind:'bp',source:'chip',sourceSeq:null,state:'open',outcome:{},claims:{},
 at:'2026-11-08T08:00:00.000Z',snapshot:{v:1,week:null,typed:typed('patient_voice_live_confirmed')},...over});
const reads=(cards:ZoeCard[]):ZoeCards=>({enabled:true,cards,clearedSeq:null});

// A. The lexicon: strict, whole utterance, no negation, all three languages.
await scenario('confirmation lexicon is strict and negation always refuses',()=>{
 for(const [text,l] of [['այո','hy'],['Այո՛','hy'],['հաստատում եմ','hy'],['ճիշտ է','hy'],['պահպանիր','hy'],['այո, պահպանիր','hy'],['да','ru'],['Подтверждаю.','ru'],['верно','ru'],['сохрани','ru'],['yes','en'],['Confirm','en'],['correct','en'],['save','en'],['yes please','en'],['да','hy']]as const)
  assert.equal(matchesConfirmation(text,l),true,text);
 for(const [text,l] of [['ոչ, մի պահպանիր','hy'],['ոչ','hy'],['այո, բայց ոչ','hy'],['չէ, ճիշտ չէ','hy'],['нет','ru'],['да, но не сохраняй','ru'],['не подтверждаю','ru'],['no','en'],["don't save",'en'],['yes, but do not save','en'],['yes I think so','en'],['save my blood pressure 150/90','en'],['','en'],['yes '.repeat(30),'en']]as const)
  assert.equal(matchesConfirmation(text,l),false,text);
 assert.equal(matchesCancel('ոչ, մի պահպանիր','hy'),true);assert.equal(matchesCancel('нет, не сохраняй','ru'),true);assert.equal(matchesCancel("no, don't save",'en'),true);
 assert.equal(confirmationAnswer('maybe','en'),null);
});

// B. The confirmation checks, in order, before the command.
function ports(card:ZoeCard|null,cards:ZoeCard[],receiptOk=false){
 const calls:{card:ZoeCard;action:unknown;opId:string}[]=[];
 return {calls,ports:{readCard:async(id:string)=>card&&card.id===id?card:null,readCards:async()=>reads(cards),secret,now:()=>Date.parse('2026-11-08T08:01:00Z'),
  verifyReceipt:()=>receiptOk,perform:async(c:ZoeCard,action:unknown,op:string)=>{calls.push({card:c,action,opId:op});return {status:'ok' as const,card:c};}}};
}
const now=Date.parse('2026-11-08T08:01:00Z');
const input=(card:ZoeCard,over:Record<string,unknown>={})=>({cardId:card.id,opId,nonce:signVoiceNonce(member,card,{kind:'bp'},now,secret),transcript:'այո',locale:'hy',origin:'live',action:{kind:'bp'},...over});
await scenario('a spoken yes runs the tap command once, bound to the card, its revision and the action',async()=>{
 const card=bpCard(),{calls,ports:p}=ports(card,[card]);
 assert.equal((await confirmVoiceCard(actor,p,input(card))).status,'saved');
 assert.equal(calls.length,1);assert.equal(calls[0]!.card.id,cardId);assert.deepEqual(calls[0]!.action,{kind:'bp'});assert.equal(calls[0]!.opId,opId);
});
await scenario('no, ambiguity, a wrong or stale nonce, another card, a closed card: nothing is written',async()=>{
 const card=bpCard();
 const run=async(over:Record<string,unknown>,cards=[card],c:ZoeCard|null=card,receiptOk=false)=>{const {calls,ports:p}=ports(c,cards,receiptOk);const r=await confirmVoiceCard(actor,p,{...input(card),...over});assert.equal(calls.length,0,JSON.stringify(over));return r.status;};
 assert.equal(await run({transcript:'ոչ, մի պահպանիր'}),'cancelled');
 assert.equal(await run({transcript:'այո, բայց ոչ'}),'not_confirmed');
 assert.equal(await run({transcript:'save my reading 150/90',locale:'en'}),'not_confirmed');
 assert.equal(await run({nonce:'1762588860000.'+'A'.repeat(43)}),'stale','a made-up nonce');
 assert.equal(await run({nonce:signVoiceNonce(other,card,{kind:'bp'},now,secret)}),'stale','another member');
 assert.equal(await run({nonce:signVoiceNonce(member,card,{kind:'bp'},now-11*60_000,secret)}),'stale','expired');
 assert.equal(await run({nonce:signVoiceNonce(member,bpCard({claims:{bp:{op:opId,payload:{}}}}),{kind:'bp'},now,secret)}),'stale','revision changed since the nonce');
 assert.equal(await run({nonce:signVoiceNonce(member,card,{kind:'reminders',time:'20:00',target:'bp'},now,secret)}),'stale','a nonce for another action');
 assert.equal(await run({action:{kind:'reminders',time:'20:00',target:'bp'},nonce:signVoiceNonce(member,card,{kind:'reminders',time:'20:00',target:'bp'},now,secret)}),'invalid','an action of another card kind');
 const later=bpCard({id:newer,requestId:newer,at:'2026-11-08T08:00:30.000Z'});
 assert.equal(await run({},[card,later]),'not_latest','only the most recent open card');
 const done=bpCard({state:'done'});
 assert.equal(await run({nonce:signVoiceNonce(member,done,{kind:'bp'},now,secret)},[done],done),'closed');
 assert.equal(await run({},[card],null),'invalid','not the member\'s card');
 assert.equal(await run({origin:'batch'}),'unverified','a recorded turn needs its server receipt');
 assert.equal(await run({action:{kind:'bp',extra:true}}),'invalid','strict input');
});
await scenario('an informational card does not take the place of the pending card; a receipted recorded turn confirms',async()=>{
 const card=bpCard(),review=cardSchema.parse({id:newer,requestId:newer,kind:'review',source:'chip',sourceSeq:null,state:'open',outcome:{},claims:{},at:'2026-11-08T08:00:30.000Z',snapshot:{v:1}});
 const a=ports(card,[card,review]);assert.equal((await confirmVoiceCard(actor,a.ports,input(card))).status,'saved');
 const b=ports(card,[card],true);assert.equal((await confirmVoiceCard(actor,b.ports,input(card,{origin:'batch',receipt:'1762588800000.receipt'}))).status,'saved');
 assert.equal(b.calls.length,1);
});
await scenario('a nonce is issued only for an open card of the action\'s kind, and a BP card only with its numbers',async()=>{
 const card=bpCard(),p={readCard:async()=>card,secret,now:()=>now};
 assert.match((await issueVoiceNonce(actor,p,cardId,{kind:'bp'}))??'',/^\d{13}\./);
 const blank=bpCard({snapshot:{v:1,week:null}});
 assert.equal(await issueVoiceNonce(actor,{...p,readCard:async()=>blank},cardId,{kind:'bp'}),null);
 assert.equal(await issueVoiceNonce(actor,p,cardId,{kind:'consent',consent:'research',granted:true,locale:'hy'}),null);
 assert.notEqual(cardRevision(card),cardRevision(bpCard({outcome:{bp:{saved:true}}})));
});

// C. The write is the tap's own command (logBp, as recordBpFromCard runs it), with the label the server put on the card.
await scenario('the reading keeps the provenance on the card: receipt, Live, or typed',async()=>{
 for(const [source,expected] of [['patient_voice_confirmed','patient_voice_confirmed'],['patient_voice_live_confirmed','patient_voice_live_confirmed'],[undefined,'patient_text_entry']]as const){
  const card=bpCard({snapshot:{v:1,week:null,typed:typed(source)}});let recorded:Record<string,unknown>|null=null;const saved:unknown[]=[];
  const r=await logBp(actor,{readCard:async()=>card,claim:async(_m:string,_c:string,_i:string,op:string,payload:Record<string,unknown>)=>({ok:true as const,claim:{op,payload,attempt:null} as never}),
   saveBp:async(v:unknown)=>{saved.push(v);return {status:'saved' as const};},record:async(_m:string,_c:string,_i:string,value:Record<string,unknown>)=>{recorded=value;return {ok:true as const,card,replayed:false};}} as never,
   {cardId,submissionId:opId,systolic:145,diastolic:92,pulse:70,measuredAt:'2026-11-08T08:00:00.000Z'});
  assert.equal(r.status,'ok');assert.equal(saved.length,1);assert.equal(recorded!.entrySource,expected,String(source));
 }
});

// D. Consents and caregivers: the browser can only tap; the server records a spoken confirmation as 'voice'.
await scenario('consent and caregiver commands record method voice only from the server',async()=>{
 assert.equal(consentCardInputSchema.safeParse({cardId,opId,kind:'research',granted:true,locale:'hy',method:'voice'}).success,false);
 assert.equal(caregiverInviteInputSchema.safeParse({cardId,opId,name:'X',relationship:'child',phone:'+37499000107',scopes:['view_plan'],locale:'hy',method:'voice'}).success,false);
 const calls:{name:string;args:Record<string,unknown>}[]=[];const claims:Record<string,{op:string;payload:Record<string,unknown>}>={};
 const consents=cardSchema.parse({id:cardId,requestId:cardId,kind:'consents',source:'chip',sourceSeq:null,state:'open',outcome:{},claims:{},at:'2026-11-08T08:00:00.000Z',
  snapshot:{v:1,version:(await import('@/lib/consents/copy')).MEMBER_CONSENT_VERSION,current:[],history:[]}});
 const rpc={rpc:async(name:string,args:Record<string,unknown>={})=>{calls.push({name,args});return {data:name==='member_consent_set'?{ok:true,changed:true,consents:[]}:{ok:true,replayed:false,link:{id:newer,name:'X',relationship:'child',phone:'+37499000107',scopes:['view_plan'],status:'pending',revision:1,invitedAt:'2026-11-08T08:00:00Z',acceptedAt:null,revokedAt:null,declinedAt:null,wordingVersion:'caregiver-consent-draft-1'}},error:null};}} as CaregiverRpc;
 const base={claim:async(_m:string,_c:string,item:string,op:string,payload:Record<string,unknown>)=>{claims[item]??={op,payload};return {ok:true as const,claim:claims[item]!};},
  record:async()=>({ok:true as const,card:consents,replayed:false}),unclaim:async()=>true,rpc};
 const r=await runConsentDecision(actor,{...base,readCard:async()=>consents} as never,{cardId,opId,kind:'research',granted:true,locale:'hy',method:'tap'},'voice');
 assert.equal(r.status,'ok');assert.equal(calls.at(-1)!.args.p_method,'voice');
 const tap=await runConsentDecision(actor,{...base,readCard:async()=>consents} as never,{cardId,opId:newer,kind:'data_processing',granted:true,locale:'hy',method:'tap'});
 assert.equal(tap.status,'ok');assert.equal(calls.at(-1)!.args.p_method,'tap');
 const caregiver=cardSchema.parse({id:cardId,requestId:cardId,kind:'caregiver',source:'chip',sourceSeq:null,state:'open',outcome:{},claims:{},at:'2026-11-08T08:00:00.000Z',snapshot:{v:1,limit:3,links:[]}});
 const invite=caregiverInviteInputSchema.parse({cardId,opId,name:'Fictional helper',relationship:'child',phone:'+37499000107',scopes:['view_plan'],locale:'hy',method:'tap'});
 const i=await runCaregiverInvite(actor,{...base,readCard:async()=>caregiver,record:async()=>({ok:true as const,card:caregiver,replayed:false}),proof:(v:Parameters<typeof caregiverProof>[0])=>caregiverProof(v,'test-key')} as never,invite,'voice');
 assert.equal(i.status,'ok');assert.equal(calls.at(-1)!.name,'member_caregiver_invite');assert.equal(calls.at(-1)!.args.p_method,'voice');
});

// E. Staff: a nurse acknowledges an alert by a spoken yes bound to that alert and its sequence.
await scenario('staff spoken confirmation runs the Acknowledge command only with a matching nonce and a strict yes',async()=>{
 const target={kind:'care_alert_ack' as const,alertId:cardId,seq:4},staff='55555555-5555-4555-8555-555555555555';
 const performed:unknown[]=[];
 const p=(receiptOk=true)=>({secret,now:()=>now,verifyReceipt:()=>receiptOk,perform:async(t:unknown)=>{performed.push(t);return {ok:true as const};}});
 const nonce=signStaffVoiceNonce(staff,target,now,secret);
 const ask=(over:Record<string,unknown>={},ports=p())=>confirmStaffVoice(staff,ports,{target,nonce,transcript:'yes',locale:'en',origin:'batch',receipt:'r',...over});
 assert.equal((await ask()).status,'saved');assert.deepEqual(performed,[target]);
 assert.equal((await ask({target:{...target,seq:5}})).status,'stale','the alert changed since the card was shown');
 assert.equal((await ask({nonce:signStaffVoiceNonce('66666666-6666-4666-8666-666666666666',target,now,secret)})).status,'stale');
 assert.equal((await ask({transcript:'no'})).status,'cancelled');
 assert.equal((await ask({transcript:'acknowledge the alert'})).status,'not_confirmed');
 assert.equal((await ask({},p(false))).status,'unverified');
 assert.equal(performed.length,1);
});

// F. The transcript or a model never writes: openVoiceCard only opens cards; the tap commands run only in perform.
await scenario('opening a card from voice never writes, and no model or tool is involved',()=>{
 const source=readFileSync('lib/zoe-chat-actions/voice-actions.ts','utf8');
 const open=source.slice(source.indexOf('export const openVoiceCard'),source.indexOf('const issueInput'));
 for(const write of ['recordBpFromCard','saveAccountFromCard','runConsentDecision','runCaregiver','logDose','sendZoeChatMessage'])assert.ok(!open.includes(write),`openVoiceCard must not call ${write}`);
 assert.ok(!/from 'ai'|@google\/genai|generateText|tools/.test(source),'no model and no tool declarations in the voice action path');
 const live=readFileSync('lib/zoe-chat-actions/voice-live.ts','utf8');
 assert.ok(/tools:\[\]/.test(live)&&/responseModalities:\['TEXT'\]/.test(live),'the Live session is text-only with no tools');
});

// G. The reminders card's spoken yes saves exactly what the read-back said.
await scenario('a spoken reminder adds the said time to the blood pressure times, or switches medicine reminders on',()=>{
 const prefs={medicationEnabled:false,medicationOffsetMinutes:0,bpEnabled:false,bpTimes:['08:00'],quietStart:'22:00',quietEnd:'07:00'};
 assert.deepEqual(withReminder(prefs,{kind:'reminders',time:'20:00',target:'bp'}),{...prefs,bpEnabled:true,bpTimes:['08:00','20:00']});
 assert.deepEqual(withReminder(prefs,{kind:'reminders',time:'20:00',target:'medicine'}),{...prefs,medicationEnabled:true});
 assert.equal(withReminder({...prefs,bpTimes:['06:00','08:00','12:00','18:00']},{kind:'reminders',time:'20:00',target:'bp'}),null);
});
console.log('Voice confirmation: strict lexicon, nonce/revision/most-recent-card binding, receipts, the tap command and provenance, server-only voice method, staff alert acknowledgement passed (injected ports).');
