/** Zoe V3 onboarding (PR 6), pure side; the database side is check-zoe-v3-onboarding.sql. */
import assert from 'node:assert/strict';
import {readdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {PROVENANCE_TAGS} from '@/lib/zoe-chat-actions/provenance';
import {consentText} from '@/lib/zoe-chat-actions/consent-text';
import {cardSchema,CHIP_KINDS} from '@/lib/zoe-chat-actions/registry';
import {cardTurns,savedMedicines,savedProfile} from '@/lib/zoe-chat-actions/thread';
import {createPatientService} from '@/lib/patient/service';
import {mintActor} from '@/lib/zoe-chat-actions/actor';
import {bookingToken} from '@/lib/zoe-chat-actions/booking';
import {reviewInputSchema,runMedicinesReview,runProfileSave,type ProfileInput,type ReviewInput} from '@/lib/zoe-chat-actions/onboarding';
import {journeyCardsEnabled,medicinesCardEnabled,zoeAppV3Enabled} from '@/lib/patient/zoe-app-v3';

const migration=readFileSync('supabase/migrations/20261103200100_zoe_v3_onboarding.sql','utf8');
for(const tag of PROVENANCE_TAGS)assert.ok(migration.split(`'${tag}'`).length-1>=2,`${tag} is in both database lists`);
const files=(dir:string):string[]=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(join(dir,e.name)):[join(dir,e.name)]);
for(const f of files('lib/zoe'))assert.ok(!/caregiver/i.test(readFileSync(f,'utf8')),`${f} must not read the caregiver contact`);
for(const f of ['lib/zoe-chat-actions/onboarding.ts'])assert.ok(!/caregiver:v\.caregiver\b/.test(readFileSync(f,'utf8')),'the card outcome holds no caregiver details');
assert.ok(!(CHIP_KINDS as readonly string[]).includes('profile'),'the profile card is offered once, never a chip');
assert.notEqual(consentText('hy',false),consentText('en',false),'each locale hashes its own text');
assert.notEqual(consentText('en',true),consentText('en',false),'the direct answers line is part of the text shown');
assert.ok(consentText('en',false).includes('What we collect'));
assert.equal(zoeAppV3Enabled({}),false);
assert.equal(journeyCardsEnabled({}),false);
assert.equal(journeyCardsEnabled({NOREON_ZOE_APP_V3:'true'}),false);
assert.equal(journeyCardsEnabled({NOREON_ZOE_APP_V3:'true',NOREON_MEMBER_CHAT_V2:'true'}),true);
assert.equal(journeyCardsEnabled({NOREON_MEMBER_CHAT_ONLY:'true'}),true);
assert.equal(medicinesCardEnabled({}),false,'off with the switch off');
assert.equal(medicinesCardEnabled({NOREON_ZOE_APP_V3:'true'}),false,'needs the new chat');
assert.equal(medicinesCardEnabled({NOREON_ZOE_APP_V3:'true',NOREON_MEMBER_CHAT_V2:'true'}),true);
const card=(kind:string,snapshot:unknown,outcome:Record<string,unknown>)=>cardSchema.parse({id:crypto.randomUUID(),requestId:crypto.randomUUID(),source:'chip',sourceSeq:null,state:'done',kind,snapshot,outcome,claims:{},at:'2026-11-02T10:00:00Z'});
const profile=card('profile',{v:1,wake:'07:00',sleep:'22:00'},{profile:{channel:'text',wake:'07:00',sleep:'22:00',caregiver:false,doneAt:'2026-11-02T10:01:00Z'}});
assert.equal(savedProfile(profile)?.channel,'text');assert.equal(cardTurns(profile)[0].at,'2026-11-02T10:01:00Z');
const older=card('medicines',{v:1,token:'a'.repeat(64)},{medicines:{kind:'add',status:'added'}});
assert.equal(savedMedicines(older),undefined,'a change on the older card is not a list saved here');assert.deepEqual(cardTurns(older),[]);
// Two tabs, and a reply lost after the write (PR6-01), with the real commands over an in-memory card.
const actor=mintActor(crypto.randomUUID(),'app');
const harness=(kind:'profile'|'medicines',snapshot:unknown)=>{
 const db={state:'open',outcome:{} as Record<string,unknown>,claims:{} as Record<string,{op:string;payload:Record<string,unknown>}>};
 const id=crypto.randomUUID();
 const now=()=>card(kind,snapshot,{}) && cardSchema.parse({id,requestId:id,source:'chip',sourceSeq:null,state:db.state,kind,snapshot,outcome:db.outcome,claims:db.claims,at:'2026-11-02T10:00:00Z'});
 return {id,db,ports:{readCard:async()=>now(),
  claim:async(_m:string,_c:string,item:string,op:string,payload:Record<string,unknown>)=>{db.claims[item]??={op,payload};return {ok:true as const,claim:db.claims[item]};},
  record:async(_m:string,_c:string,item:string,value:Record<string,unknown>,close:boolean)=>{db.outcome[item]??=value;if(close)db.state='done';return {ok:true as const,card:now(),replayed:false};},
  unclaim:async(_c:string,item:string,op:string)=>{if(db.claims[item]?.op!==op)return false;delete db.claims[item];return true;}}};
};
{
 const h=harness('profile',{v:1,wake:'07:00',sleep:'22:00'});
 const writes:string[]=[];let landed=false;
 const ports={...h.ports,proof:(v:ProfileInput)=>JSON.stringify(v.channel+v.caregiver?.phone),landed:async()=>landed,save:async(v:ProfileInput)=>{writes.push(v.channel);return 'saved' as const;}};
 const input=(channel:'text'|'voice',opId:string):ProfileInput=>({cardId:h.id,opId,channel,wake:'07:00',sleep:'22:00',caregiver:{name:'Synthetic',phone:'+37491000000'}});
 const a=crypto.randomUUID();
 h.db.claims.profile={op:a,payload:{channel:'text',wake:'07:00',sleep:'22:00',caregiver:true,proof:JSON.stringify('text+37491000000')}};
 assert.equal((await runProfileSave(actor,ports,input('voice',crypto.randomUUID()))).status,'stale','a competing payload is refused');
 assert.deepEqual(writes,[],'and writes nothing');
 assert.equal((await runProfileSave(actor,ports,input('text',a))).status,'ok','the holder replays');
 assert.deepEqual(writes,['text']);
 assert.deepEqual(Object.keys(h.db.outcome.profile as object).sort(),['caregiver','channel','sleep','wake']);
 assert.ok(!JSON.stringify(h.db).includes('Synthetic'),'no caregiver name in the card');assert.ok(!JSON.stringify(h.db).includes('"+374'),'no phone as such');
 landed=true;
 const h2=harness('profile',{v:1,wake:'07:00',sleep:'22:00'});
 h2.db.claims.profile={op:a,payload:{channel:'text',wake:'07:00',sleep:'22:00',caregiver:false,proof:'other'}};
 const r=await runProfileSave(actor,{...h2.ports,proof:()=>'mine',landed:async()=>true,save:async()=>{throw Error('must not write');}},input('voice',crypto.randomUUID()));
 assert.equal(r.status,'stale');assert.equal(h2.db.state,'done','a landed first save gets its own receipt');assert.equal((h2.db.outcome.profile as {channel:string}).channel,'text');
}
{
 const token='a'.repeat(64),med=crypto.randomUUID();
 const h=harness('medicines',{v:1,token});
 const saves:unknown[]=[];let refuse:'limit'|null=null;
 const ports={...h.ports,current:async()=>({enabled:true,token:'moved'.padEnd(64,'x'),names:new Map([[med,'Synthetic']])}),save:async(v:unknown)=>{saves.push(v);return {status:refuse??'saved' as 'saved'|'limit'};}};
 const list=(status:'continuous'|'prn',opId:string):ReviewInput=>({cardId:h.id,opId,changes:[{id:med,status,stopReason:null,stopConfirmed:false}],added:[]});
 const a=crypto.randomUUID(),b=crypto.randomUUID();
 assert.equal((await runMedicinesReview(actor,ports,list('prn',a))).status,'stale','a moved list is refused before a claim');assert.deepEqual(saves,[]);
 const live={...ports,current:async()=>({...await ports.current(),token})};
 refuse='limit';
 const refused=await runMedicinesReview(actor,live,list('prn',a));
 assert.ok(refused.released&&refused.review==='limit'&&!h.db.claims.medicines,'a definite refusal lets go, so a corrected list can go');
 refuse=null;saves.length=0;
 // The first tab's write landed and its reply was lost: the second tab's other list replays the first and stays unwritten.
 h.db.claims.medicines={op:a,payload:{kind:'review',digest:bookingToken({changes:list('prn',a).changes,added:[]}),changes:list('prn',a).changes,added:[]}};
 const second=await runMedicinesReview(actor,live,list('continuous',b));
 assert.equal(second.status,'stale');assert.equal(saves.length,1);assert.deepEqual((saves[0] as {changes:{status:string}[]}).changes[0].status,'prn','only the first list goes');
 assert.equal(((h.db.outcome.medicines as {rows:{status:string}[]}).rows)[0].status,'prn','the receipt is the list that was written');
}
assert.equal(reviewInputSchema.safeParse({cardId:crypto.randomUUID(),opId:crypto.randomUUID(),changes:[{id:crypto.randomUUID(),status:'course_stopped',stopReason:null,stopConfirmed:false}],added:[]}).success,false,'a course needs its confirmation');
// PR6-03, a pruned answer loses its source in the same update (run in check-zoe-v3-onboarding.sql). Completion prunes too.
assert.match(migration,/jsonb_each\(answer_sources\|\|p_sources\)e where jsonb_typeof\(e\.value\)<>'null'and p_answers\?e\.key/);
const stored:unknown[][]=[];
const service=createPatientService({user:async()=>({userId:'m',phone:'p'}),answerSource:()=>'patient_reported_anamnesis',store:()=>({read:async()=>({profile:{},consentAccepted:true,assessment:{id:'a',revision:3,answers:{'q3.current':{fieldId:'q3.current',value:'never',source:'manual',answeredAt:'2026-11-02T10:00:00Z'}}}}),assessment:async(...a:unknown[])=>{stored.push(a);return 4;}}) as never});
await service.saveAnswers({expectedRevision:3,entries:[{fieldId:'q3.current',value:null}]}).catch(()=>null);
for(const call of stored)assert.equal(typeof call[5],'object','every save under V3 reconciles sources');
console.log('Zoe V3 onboarding: tags, switch, caregiver boundary and turns hold.');

// Queue failure after a persisted statin stop must leave the mandatory reply resumable.
{
 const token='a'.repeat(64),med=crypto.randomUUID(),h=harness('medicines',{v:1,token});
 const input:ReviewInput={cardId:h.id,opId:crypto.randomUUID(),changes:[{id:med,status:'course_stopped',stopReason:'decided_to_stop',stopConfirmed:true}],added:[]};
 let recovered=false;
 const rows=[{name:'Atorvastatin',status:'course_stopped',stopReason:'decided_to_stop',added:false}];
 const stops=[{id:med,name:'Atorvastatin',episode:'stop:original'}],savedAt='2026-11-02T10:00:00Z';
 const ports={...h.ports,current:async()=>({enabled:true,token,names:new Map([[med,recovered?'A newer edited name':'Atorvastatin']])}),save:async()=>({status:'saved' as const,rows,stops,savedAt}),afterSave:async(savedRows:unknown,savedStops:unknown)=>{assert.deepEqual(savedRows,rows);assert.deepEqual(savedStops,stops);return recovered?'sent' as const:'pending' as const;}};
 assert.equal((await runMedicinesReview(actor,ports,input)).status,'unavailable');
 assert.equal(h.db.state,'open','The pending follow-up must not close or lose its claim');
 assert.equal(h.db.outcome.medicines,undefined,'No claim that nurse and doctor received it before both tasks land');
 recovered=true;
 assert.equal((await runMedicinesReview(actor,ports,input)).status,'ok');
 assert.equal(h.db.state,'done');
 assert.equal(cardTurns(await h.ports.readCard())[0].at,savedAt,'Recovery preserves the original action time, before a later edit');
 assert.equal((h.db.outcome.medicines as {noTitration?:boolean}|undefined)?.noTitration,true,'A reload/retry after worker recovery preserves the mandatory reply');
}
