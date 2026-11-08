// WP R: the member offline outbox (lib/offline/outbox.ts) with an in-memory store and a fake IndexedDB.
// Run: node --no-warnings --conditions=noreon-server-test --import ./scripts/register-alias.mjs scripts/check-offline-outbox.ts
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createOutbox,indexedDbOutboxStore,memoryOutboxStore,offlineFailure,offlineSendPlan,OUTBOX_MAX_AGE_MS,type OutboxItem,type OutboxStore,type ReplayOutcome} from '@/lib/offline/outbox';
import {OFFLINE} from '@/lib/offline/copy';
import {LOCALES} from '@/lib/locale';

const A='5ea0f000-0000-4000-8000-0000000002a1',B='5ea0f000-0000-4000-8000-0000000002b1';
const id=(n:number)=>`5ea0f000-0000-4000-8000-${String(n).padStart(12,'0')}`;

// A minimal fake IndexedDB: one database, one object store keyed by `id`, callbacks fired asynchronously like a browser.
function fakeIndexedDb(){
 const rows=new Map<string,OutboxItem>();let created=false;
 const later=(f:()=>void)=>setTimeout(f,0);
 const request=<T,>(result:()=>T)=>{const r:{result?:T;onsuccess?:()=>void;onerror?:()=>void}={};later(()=>{r.result=result();r.onsuccess?.();});return r;};
 const database={
  objectStoreNames:{contains:(name:string)=>created&&name==='items'},
  createObjectStore:(name:string)=>{assert.equal(name,'items');created=true;},
  transaction:(name:string)=>{
   assert.equal(name,'items');
   const tx:{oncomplete?:()=>void;onerror?:()=>void;onabort?:()=>void;objectStore:()=>unknown}={objectStore:()=>({
    getAll:()=>{const r={result:[...rows.values()].map(x=>structuredClone(x))};later(()=>tx.oncomplete?.());return r;},
    put:(item:OutboxItem)=>{rows.set(item.id,structuredClone(item));later(()=>tx.oncomplete?.());return {result:item.id};},
    delete:(key:string)=>{rows.delete(key);later(()=>tx.oncomplete?.());return {result:undefined};},
   })};
   return tx;
  },
 };
 const factory={open:(name:string,version:number)=>{
  assert.equal(name,'noreon-member-outbox');assert.equal(version,1);
  const r=request(()=>database) as {result?:typeof database;onupgradeneeded?:()=>void;onsuccess?:()=>void};
  later(()=>{if(!created){r.result=database;r.onupgradeneeded?.();}});
  return r;
 }};
 return {factory:factory as unknown as IDBFactory,rows};
}

async function scenario(store:OutboxStore,label:string){
 let now=Date.UTC(2026,10,8,12,0,0),account:string|null=A;
 const outbox=createOutbox(store,()=>account,()=>now);
 // Queue in order, with the existing request ids.
 assert.equal(await outbox.queue('zoe_message',id(1),{text:'first',toDoctor:false}),true,`${label}: queue`);
 now+=1;assert.equal(await outbox.queue('bp_reading',id(2),{cardId:id(9),submissionId:id(2)}),true);
 now+=1;assert.equal(await outbox.queue('zoe_message',id(3),{text:'second',toDoctor:true}),true);
 assert.equal(await outbox.queue('zoe_message',id(1),{text:'first',toDoctor:false}),true,'The same request id queued again is the same item');
 assert.equal((await outbox.pending()).length,3,`${label}: no duplicate item`);
 assert.equal(await outbox.queue('zoe_message','not-a-uuid',{}),false,'Only a request id can key an item');
 assert.deepEqual((await outbox.pending('zoe_message')).map(i=>i.id),[id(1),id(3)],'Pending by kind, in queue order');

 // Replay in order with the same request id; a retry keeps the rest waiting in order.
 const sentIds:string[]=[];
 let failSecond=true;
 const send=async(item:OutboxItem):Promise<ReplayOutcome>=>{
  if(item.id===id(3)&&failSecond){failSecond=false;return 'retry';}
  sentIds.push(item.id);await new Promise(r=>setTimeout(r,5));return 'sent';
 };
 const first=await outbox.replay(send,'zoe_message');
 assert.deepEqual(first,{sent:[id(1)],dropped:[],remaining:1},`${label}: a retry stops the replay and keeps order`);
 // Two replays at once (two 'online' events): one runs, the other joins it; nothing is sent twice.
 const [x,y]=await Promise.all([outbox.replay(send,'zoe_message'),outbox.replay(send,'zoe_message')]);
 assert.deepEqual(x,y,'A second replay joins the first');
 assert.deepEqual(sentIds,[id(1),id(3)],`${label}: each item sent once, in order, with its own request id`);
 const again=await outbox.replay(send,'zoe_message');
 assert.deepEqual(again,{sent:[],dropped:[],remaining:0},'A replay after success sends nothing again');
 assert.deepEqual((await outbox.pending()).map(i=>i.id),[id(2)],'The other kind is untouched');
 // A refused item (drop) leaves the queue; a throwing sender is a retry.
 assert.deepEqual(await outbox.replay(async()=>{throw new Error('network');},'bp_reading'),{sent:[],dropped:[],remaining:1});
 assert.deepEqual(await outbox.replay(async()=>'drop','bp_reading'),{sent:[],dropped:[id(2)],remaining:0});

 // Account binding: another account's items never go out under this session, and are removed.
 await outbox.queue('zoe_message',id(4),{text:'A only',toDoctor:false});
 account=B;
 const asB:string[]=[];
 assert.deepEqual(await outbox.replay(async item=>{asB.push(item.id);return 'sent';}),{sent:[],dropped:[],remaining:0},`${label}: nothing of A replays for B`);
 assert.deepEqual(asB,[]);
 account=A;assert.equal((await outbox.pending()).length,0,'A\'s item was deleted once B opened the outbox (shared device)');
 account=null;assert.equal(await outbox.queue('zoe_message',id(5),{text:'x',toDoctor:false}),false,'No account, no queue');
 // Age: an item older than a day is deleted, never sent.
 account=A;await outbox.queue('zoe_message',id(6),{text:'old',toDoctor:false});
 now+=OUTBOX_MAX_AGE_MS+1;
 assert.deepEqual(await outbox.replay(async()=>'sent'),{sent:[],dropped:[],remaining:0},`${label}: old items expire`);
 console.log(`PASS ${label}`);
}
await scenario(memoryOutboxStore(),'memory store');
const fake=fakeIndexedDb();
await scenario(indexedDbOutboxStore(fake.factory),'indexeddb store');
assert.equal(fake.rows.size,0,'The IndexedDB store is empty at the end');
{
 const broken=createOutbox(indexedDbOutboxStore(undefined),()=>A);
 assert.equal(await broken.queue('zoe_message',id(7),{text:'x',toDoctor:false}),false,'No IndexedDB: nothing is queued (the send shows Not sent)');
 assert.deepEqual(await broken.pending(),[]);
}

// Offline detection.
assert.equal(offlineFailure(new Error('x'),false),true,'navigator.onLine false is offline');
assert.equal(offlineFailure(new TypeError('Failed to fetch'),true),true,'A failed fetch is offline');
assert.equal(offlineFailure(new TypeError('Load failed'),true),true,'Safari wording');
assert.equal(offlineFailure(new Error('Server error'),true),false,'A server error is not offline');
console.log('PASS offline detection');

// Urgent text offline: the emergency instructions show at once (deterministic screen, no model, no server).
{
 const check={env:{NOREON_ZOE_TEST_LEXICON:'true',NOREON_ZOE_URGENT_PLACEHOLDER:'false'},intake:null};
 assert.deepEqual(offlineSendPlan('I have chest pain right now',check),{queue:true,emergency:true},'Urgent words show 103 immediately and are still queued (never silently)');
 assert.deepEqual(offlineSendPlan('When is my next visit?',check),{queue:true,emergency:false},'Ordinary text is only queued');
 assert.equal(offlineSendPlan('anything',null,true).emergency,true,'A voice turn screened urgent shows 103');
 assert.equal(offlineSendPlan('When is my next visit?',null).emergency,false,'Without the page\'s switches the default screen runs');
 const thread=readFileSync('components/patient/use-zoe-thread.ts','utf8');
 assert.match(thread,/if \(offlineSendPlan\(p\.text, check, !!p\.voiceUrgent\)\.emergency\) showEmergency\(\);/,'The chat shows the emergency card from the offline plan');
 assert.match(thread,/outbox!\.queue\("zoe_message", p\.requestId,/,'and queues with the existing request id');
 const card=readFileSync('components/patient/use-bp-card.ts','utf8');
 assert.match(card,/outbox\.queue\("bp_reading", submission, payload\)/,'The BP card queues with its submission id');
 assert.match(card,/bpVeryHigh\(entry\)/,'A very high reading queued offline says so at once (rules, not the component)');
 console.log('PASS urgent offline');
}

// Copy: hy/en/ru for every line, no exclamation marks.
for(const [key,copy] of Object.entries(OFFLINE))for(const l of LOCALES){
 assert.ok(copy[l]?.trim(),`${key} ${l}`);assert.doesNotMatch(copy[l],/!|—/,`${key} ${l} voice guide`);
}
console.log('PASS copy');
console.log('check-offline-outbox: ok');
