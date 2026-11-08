/**
 * Caregiver and consents card commands (WP F) with injected ports: the claim, the feature RPC, the record; the consent
 * hash is the hash of the shown text; a definite refusal releases the claim; names and phone numbers never enter a card.
 * Run: node --no-warnings --conditions=noreon-server-test --import ./scripts/register-alias.mjs scripts/check-caregiver-cards.ts
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {CAREGIVER_CONSENT_VERSION,MEMBER_CONSENT_VERSION,caregiverConsentText,consentText,consentTextHash} from '../lib/consents/copy';
import {caregiverInviteInputSchema,caregiverLandingPath,caregiverLinkSchema,caregiverScopesInputSchema} from '../lib/caregivers/schema';
import {consentCardInputSchema} from '../lib/consents/schema';
import {cardIntent} from '../lib/zoe-chat-actions/intent';
import {cardOffer} from '../lib/zoe-chat-actions/thread';
import {cardSchema,type ZoeCard} from '../lib/zoe-chat-actions/registry';
import {mintActor} from '../lib/zoe-chat-actions/actor';
import type {CaregiverRpc} from '../lib/caregivers/server';

globalThis.fetch=(()=>{throw Error('No network in this check');}) as typeof fetch;
const {runCaregiverInvite,runCaregiverRevoke,runCaregiverScopes,caregiverProof,caregiverLanding}=await import('../lib/caregivers/server');
const {runConsentDecision}=await import('../lib/consents/server');
function scenario(name:string,fn:()=>Promise<void>|void){return Promise.resolve(fn()).then(()=>console.log(`ok   ${name}`));}

const member='11111111-1111-4111-8111-111111111111',cardId='22222222-2222-4222-8222-222222222222',linkId='33333333-3333-4333-8333-333333333333';
const actor=mintActor(member,'app');
function fakeCard(kind:'caregiver'|'consents',snapshot:unknown){
 const db={claims:{} as Record<string,{op:string;payload:Record<string,unknown>}>,outcome:{} as Record<string,unknown>,released:[] as string[],calls:[] as {name:string;args:Record<string,unknown>}[]};
 const card=():ZoeCard=>cardSchema.parse({id:cardId,requestId:cardId,source:'chip',sourceSeq:null,state:'open',kind,snapshot,outcome:{...db.outcome},claims:{...db.claims},at:'2026-11-08T08:00:00Z'});
 const ports=(answer:(name:string,args:Record<string,unknown>)=>unknown)=>({
  readCard:async(id:string)=>id===cardId?card():null,
  claim:async(_m:string,_c:string,item:string,op:string,payload:Record<string,unknown>)=>{db.claims[item]??={op,payload};return {ok:true as const,claim:db.claims[item]!};},
  record:async(_m:string,_c:string,item:string,value:Record<string,unknown>)=>{db.outcome[item]??=value;return {ok:true as const,card:card(),replayed:false};},
  unclaim:async(_c:string,item:string)=>{delete db.claims[item];db.released.push(item);return true;},
  proof:(v:Parameters<typeof caregiverProof>[0])=>caregiverProof(v,'test-key'),
  rpc:{rpc:async(name:string,args:Record<string,unknown>={})=>{db.calls.push({name,args});return {data:answer(name,args),error:null};}} as CaregiverRpc,
 });
 return {db,ports};
}
const link=(over:Record<string,unknown>={})=>({id:linkId,name:'Fictional helper',relationship:'child',phone:'+37499000107',scopes:['view_plan','view_readings'],status:'pending',revision:1,
 invitedAt:'2026-11-08T08:00:00Z',acceptedAt:null,revokedAt:null,declinedAt:null,wordingVersion:CAREGIVER_CONSENT_VERSION,...over});
const input=caregiverInviteInputSchema.parse({cardId,opId:'44444444-4444-4444-8444-444444444444',name:'Fictional helper',relationship:'child',phone:'+374 99 000 107',
 scopes:['view_readings','view_plan'],locale:'hy',method:'tap'});

await scenario('invite: the RPC gets the hash of the exact statement shown, the card keeps no name or number',async()=>{
 const {db,ports}=fakeCard('caregiver',{v:1,limit:3,links:[]});
 const r=await runCaregiverInvite(actor,ports(()=>({ok:true,replayed:false,link:link()})),input);
 assert.equal(r.status,'ok');
 const call=db.calls[0]!;
 assert.equal(call.name,'member_caregiver_invite');
 assert.equal(call.args.p_phone,'+37499000107');
 assert.equal(call.args.p_request_id,input.opId);
 assert.equal(call.args.p_wording_version,CAREGIVER_CONSENT_VERSION);
 assert.equal(call.args.p_text_hash,await consentTextHash(caregiverConsentText('hy','Fictional helper',['view_plan','view_readings'])));
 assert.equal(call.args.p_text_hash,createHash('sha256').update(caregiverConsentText('hy','Fictional helper',['view_plan','view_readings'])).digest('hex'),'Web Crypto and node agree');
 assert.ok(caregiverConsentText('hy','X',['view_plan']).includes('Նորեոն Հելթի'));
 const stored=JSON.stringify({claims:db.claims,outcome:db.outcome});
 assert.ok(!stored.includes('Fictional helper')&&!stored.includes('000107'),'no name or phone in the card');
});
await scenario('invite: a definite refusal releases the claim so the member can correct the form',async()=>{
 const {db,ports}=fakeCard('caregiver',{v:1,limit:3,links:[]});
 const r=await runCaregiverInvite(actor,ports(()=>({ok:false,code:'limit'})),input);
 assert.equal(r.status,'invalid');assert.equal(r.reason,'limit');
 assert.deepEqual(db.released,['invite']);assert.equal(db.outcome.invite,undefined);
});
await scenario('invite: a refused session is signed out, never a write',async()=>{
 const {ports}=fakeCard('caregiver',{v:1,limit:3,links:[]});
 const p=ports(()=>null);p.rpc={rpc:async()=>({data:null,error:{code:'42501'}})};
 assert.equal((await runCaregiverInvite(actor,p,input)).status,'signed_out');
 assert.equal((await runCaregiverInvite(mintActor(member,'telegram'),p,input)).status,'disabled','app channel only');
});
await scenario('revoke: only a link shown on the card, with its revision',async()=>{
 const {db,ports}=fakeCard('caregiver',{v:1,limit:3,links:[{id:linkId,name:'Fictional helper',relationship:'child',phoneTail:'107',scopes:['view_plan'],status:'active',revision:2,invitedAt:'2026-11-08T08:00:00Z'}]});
 const p=ports(()=>({ok:true,changed:true,link:link({status:'revoked',revokedAt:'2026-11-08T09:00:00Z',revision:3})}));
 assert.equal((await runCaregiverRevoke(actor,p,{cardId,opId:'55555555-5555-4555-8555-555555555555',linkId:'66666666-6666-4666-8666-666666666666',revision:2})).status,'invalid');
 assert.equal((await runCaregiverRevoke(actor,p,{cardId,opId:'55555555-5555-4555-8555-555555555555',linkId,revision:2})).status,'ok');
 assert.deepEqual(db.calls.map(c=>[c.name,c.args.p_revision]),[['member_caregiver_revoke',2]]);
});
await scenario('consent: the server hashes the shown statement and records the decision once',async()=>{
 const {db,ports}=fakeCard('consents',{v:1,version:MEMBER_CONSENT_VERSION,current:[],history:[]});
 const p=ports(()=>({ok:true,changed:true,consents:[]}));
 const r=await runConsentDecision(actor,p,{cardId,opId:'77777777-7777-4777-8777-777777777777',kind:'voice_processing',granted:true,locale:'ru',method:'tap'});
 assert.equal(r.status,'ok');
 assert.deepEqual(db.calls[0]!.args,{p_kind:'voice_processing',p_granted:true,p_wording_version:MEMBER_CONSENT_VERSION,p_text_hash:await consentTextHash(consentText('voice_processing','ru')),p_method:'tap',p_source:'chat_card'});
 assert.ok(consentText('voice_processing','hy').includes('Զոյա'));
 const stale=await runConsentDecision(actor,p,{cardId,opId:'88888888-8888-4888-8888-888888888888',kind:'voice_processing',granted:false,locale:'ru',method:'tap'});
 assert.equal(stale.status,'stale','a different decision on the same statement and card is refused');
 const old=fakeCard('consents',{v:1,version:'member-consent-draft-0',current:[],history:[]});
 assert.equal((await runConsentDecision(actor,old.ports(()=>null),{cardId,opId:'99999999-9999-4999-8999-999999999999',kind:'research',granted:true,locale:'en',method:'tap'})).status,'stale','older wording needs a fresh card');
});
await scenario('scopes: the new statement is hashed on the server and sent with the change, as on invite',async()=>{
 const {db,ports}=fakeCard('caregiver',{v:1,limit:3,links:[{id:linkId,name:'Fictional helper',relationship:'child',phoneTail:'107',scopes:['view_plan'],status:'active',revision:2,invitedAt:'2026-11-08T08:00:00Z'}]});
 const p=ports(()=>({ok:true,changed:true,link:link({status:'active',acceptedAt:'2026-11-08T08:30:00Z',scopes:['view_plan','view_readings','log_readings'],revision:3})}));
 const v=caregiverScopesInputSchema.parse({cardId,opId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',linkId,revision:2,scopes:['log_readings','view_plan','view_readings'],locale:'ru'});
 assert.equal((await runCaregiverScopes(actor,p,v)).status,'ok');
 const call=db.calls[0]!;
 assert.equal(call.name,'member_caregiver_update_scopes');
 assert.equal(call.args.p_wording_version,CAREGIVER_CONSENT_VERSION);
 assert.equal(call.args.p_method,'tap');
 assert.equal(call.args.p_text_hash,await consentTextHash(caregiverConsentText('ru','Fictional helper',['view_plan','view_readings','log_readings'])),'the statement the card showed, with the name on the card');
 assert.equal(caregiverScopesInputSchema.safeParse({...v,locale:undefined}).success,false,'the language of the statement is required');
});
await scenario('the browser can only tap: a voice method from input is refused',()=>{
 assert.equal(caregiverInviteInputSchema.safeParse({...input,phone:'+37499000107',method:'voice'}).success,false);
 assert.equal(consentCardInputSchema.safeParse({cardId,opId:cardId,kind:'research',granted:true,locale:'en',method:'voice'}).success,false);
 assert.equal(consentCardInputSchema.safeParse({cardId,opId:cardId,kind:'research',granted:true,locale:'en',method:'tap'}).success,true);
});
await scenario('an expired invitation reads as expired',()=>{
 assert.equal(caregiverLinkSchema.parse(link({status:'expired'})).status,'expired');
});
await scenario('intents: a task that mentions a carer or a consent stays that task; settings cards only where switched on',()=>{
 for(const [text,kind] of [['Please record my BP reading, my caregiver typed it','bp'],['log my BP, my carer is here','bp'],['I took my pills, my carer reminded me','dose'],
  ['message my doctor about the research consent','message'],['I want to add a caregiver','caregiver'],['show my consents','consents'],['Ուզում եմ ավելացնել խնամող','caregiver']] as const)
  assert.equal(cardIntent(text),kind,text);
 const thread={messages:[{seq:7,text:'I want to add a caregiver'}]} as unknown as Parameters<typeof cardOffer>[0];
 const cards={enabled:true,clearedSeq:7,readingSeq:null};
 assert.equal(cardOffer(thread,cards),null,'off by default (classic chat, flags off)');
 assert.equal(cardOffer(thread,cards,['consents']),null,'only the kinds switched on');
 assert.deepEqual(cardOffer(thread,cards,['caregiver']),{kind:'caregiver',seq:7});
});
await scenario('landing: a non-member caregiver goes to /patient/caring after sign-in, members stay on their journey',async()=>{
 assert.equal(caregiverLandingPath({enabled:true,member:false,invitations:1,activeLinks:0}),'/patient/caring');
 assert.equal(caregiverLandingPath({enabled:true,member:false,invitations:0,activeLinks:1}),'/patient/caring');
 assert.equal(caregiverLandingPath({enabled:true,member:false,invitations:0,activeLinks:0}),null);
 assert.equal(caregiverLandingPath({enabled:true,member:true,invitations:2,activeLinks:1}),null);
 assert.equal(caregiverLandingPath({enabled:false,member:false,invitations:2,activeLinks:1}),null);
 const reads=(member:boolean,fail=false)=>({member:async()=>member,invitations:async()=>{if(fail)throw Error('down');return 1;},activeLinks:async()=>0});
 assert.equal(await caregiverLanding(reads(false),{NOREON_CAREGIVERS:'true'}),'/patient/caring');
 assert.equal(await caregiverLanding(reads(false),{}),null,'dark by default');
 assert.equal(await caregiverLanding(reads(true),{NOREON_CAREGIVERS:'true'}),null);
 assert.equal(await caregiverLanding(reads(false,true),{NOREON_CAREGIVERS:'true'}),null,'a failed read keeps the member journey');
 const {continuePath}=await import('../lib/patient/continue-path');
 assert.equal(continuePath('/patient/caring'),'/patient/caring','sign-in continues to the caregiver page');
});
