import assert from 'node:assert/strict';
import {runAccountSave} from '@/lib/zoe-chat-actions/account';
import {bookingToken} from '@/lib/zoe-chat-actions/booking';
import {mintActor} from '@/lib/zoe-chat-actions/actor';
import {cardSchema,type ZoeCard} from '@/lib/zoe-chat-actions/registry';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const token=bookingToken({revision:1});
const base=()=>cardSchema.parse({id:id(2),requestId:id(3),source:'chip',sourceSeq:null,state:'open',outcome:{},claims:{},at:'2026-11-01T10:00:00Z',kind:'account',snapshot:{v:1,token}});
let card:ZoeCard=base(),current=token,writes=0;
const ports={readCard:async()=>card,currentToken:async()=>current,
 claim:async(_m:string,_c:string,item:string,op:string,payload:Record<string,unknown>)=>{const claim=card.claims[item]??{op,payload};card={...card,claims:{...card.claims,[item]:claim}};return {ok:true as const,claim};},
 record:async(_m:string,_c:string,item:string,value:Record<string,unknown>)=>{card={...card,state:'done',outcome:{...card.outcome,[item]:value}};return {ok:true as const,card,replayed:false};},
 execute:async()=>{writes++;return {ok:true as const,revision:2};},
};
const actor=mintActor(id(1),'app');
const input={cardId:id(2),opId:id(4),kind:'profile' as const,input:{name:'Synthetic member'},consent:true,expectedRevision:1};
assert.equal((await runAccountSave(actor,ports,input)).status,'ok');
assert.equal(writes,1);
assert.equal((await runAccountSave(actor,ports,input)).status,'closed');
assert.equal(JSON.stringify(card.claims).includes('Synthetic member'),false,'Claims retain only the payload digest');
assert.deepEqual(card.outcome.account,{kind:'profile',ok:true});
card=base();current='changed';
assert.equal((await runAccountSave(actor,ports,input)).status,'stale');
assert.equal(writes,1);
current=token;card=base();card.claims.account={op:id(7),payload:{kind:'language',digest:bookingToken({})}};
assert.equal((await runAccountSave(actor,ports,input)).status,'stale','Competing payloads cannot replace the claimed choice');
assert.equal(writes,1);
card=base();
const lost=await runAccountSave(actor,{...ports,execute:async()=>{throw Error('Synthetic failure');}},input);
assert.equal(lost.result?.ok,false);
assert.equal(card.state,'done','Unknown saves seal the card');
assert.equal((await runAccountSave(mintActor(id(1),'telegram'),ports,input)).status,'disabled');
console.log('Chat account: stale/closed/competing choices, status-only outcomes, private claims, unknown-save sealing and app-only boundary. Mocked IO.');

// Exercise actual server adapters with isolated IO. No feature read before flag/auth/card checks.
const {readFileSync}=await import('node:fs');
const vm=await import('node:vm');
const ts=await import('typescript');
const zod=await import('zod');
let enabled=true,signedIn=true,reads=0;
const dispatched:string[]=[],logged:string[]=[];
const exports:Record<string,unknown>={};
const code=ts.transpileModule(readFileSync('lib/zoe-chat-actions/account-actions.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const feature=(kind:string)=>async()=>{dispatched.push(kind);return {ok:true,revision:2};};
vm.runInNewContext(code,{exports,require(name:string){
 if(name==='zod')return zod;
 if(name==='@/lib/observability/with-logging')return {loggedAction:(name:string,fn:unknown)=>{logged.push(name);return fn;}};
 if(name==='@/lib/patient/member-chat-config')return {memberChatOnlyEnabled:()=>enabled};
 if(name==='./actor')return {sessionActor:async()=>signedIn?actor:null,noActor:async()=>({status:'signed_out'})};
 if(name==='./server')return {readZoeCard:ports.readCard,claimCard:ports.claim,recordCard:ports.record};
 if(name==='./account-read')return {readAccountSettings:async()=>{reads++;return {token:current};}};
 if(name==='./account')return {runAccountSave};
 if(name==='@/app/patient/actions')return {saveProfile:feature('profile')};
 if(name==='@/app/patient/account/locale-actions')return {saveLanguagePreference:feature('language')};
 if(name==='@/app/patient/care/actions')return {saveReminderPreferences:feature('reminders')};
 throw Error(`Unexpected adapter boundary ${name}`);
}});
const adapters=exports as typeof import('../lib/zoe-chat-actions/account-actions');
card=base();enabled=false;
assert.equal((await adapters.saveAccountFromCard(input)).status,'disabled');
assert.equal((await adapters.readAccountSettingsFromCard(card.id)).status,'disabled');
assert.equal(reads,0);
enabled=true;signedIn=false;
assert.equal((await adapters.saveAccountFromCard(input)).status,'signed_out');
assert.equal((await adapters.readAccountSettingsFromCard(card.id)).status,'signed_out');
assert.equal(reads,0);
signedIn=true;
assert.equal((await adapters.saveAccountFromCard({...input,memberId:id(99)})).status,'invalid');
assert.equal((await adapters.readAccountSettingsFromCard(card.id)).status,'ok');
current='changed';assert.equal((await adapters.readAccountSettingsFromCard(card.id)).status,'stale');current=token;
for(const kind of ['profile','language','reminders'] as const){
 card=base();
 const value=kind==='language'?{locale:'ru',expectedLocale:'en'}:input.input;
 assert.equal((await adapters.saveAccountFromCard({...input,kind,input:value})).status,'ok');
 assert.equal(dispatched.at(-1),kind);
}
assert.deepEqual(logged,['readAccountSettingsFromCard','saveAccountFromCard']);
console.log('Chat account adapters: flag/auth/strict input/stale reads and existing feature action dispatch. Mocked IO.');

// Additional settings participate in the account snapshot token, through existing gated readers.
const readExports:Record<string,unknown>={};
let size='normal',consent:{readsMessages:boolean;canGrant:boolean}|null={readsMessages:true,canGrant:false};
const readCode=ts.transpileModule(readFileSync('lib/zoe-chat-actions/account-read.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
vm.runInNewContext(readCode,{exports:readExports,require(name:string){
 if(name==='server-only')return {};
 if(name==='@/lib/patient/validation')return {dateInArmenia:()=> '2026-11-01'};
 if(name==='@/lib/patient/repository')return {requireRegistered:async()=>({profile:{locale:'en'},assessment:{id:id(8),revision:1}})};
 if(name==='@/lib/patient-care/reminder-repository')return {getReminderPreferences:async()=>({revision:1})};
 if(name==='@/lib/telegram-runtime/member')return {readTelegramLink:async()=>null};
 if(name==='@/lib/patient/member-preferences')return {readMemberTextSize:async()=>size};
 if(name==='@/lib/zoe/member')return {readZoeConsents:async()=>consent};
 if(name==='./booking')return {bookingToken};
 throw Error(`Unexpected account read boundary ${name}`);
}});
const readSettings=readExports.readAccountSettings as ()=>Promise<{token:string;textSize:string;zoe:unknown}>;
const initial=await readSettings();
assert.equal(initial.textSize,'normal');
size='large';const changedSize=await readSettings();assert.notEqual(changedSize.token,initial.token,'Text-size changes invalidate old account snapshots');
consent=null;const changedConsent=await readSettings();assert.equal(changedConsent.zoe,null);assert.notEqual(changedConsent.token,changedSize.token,'Consent visibility changes invalidate old account snapshots');
console.log('Account settings snapshot includes current text size and consent visibility in its stale-save token (mocked existing readers).');
