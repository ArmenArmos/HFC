import {couldBeZoeEmergency,type ZoeEmergencyCheck} from '@/lib/zoe/member-screen';

/**
 * WP R: the member app's offline outbox. A message to Zoe or a confirmed BP reading that cannot reach the server
 * (navigator.onLine is false, or the send fails with a network error) is queued here with its existing request id, the
 * member sees "Will send when you are back online", and the queue is replayed in order when the browser is online
 * again. The server already makes both writes idempotent on that id (conversation_receive replays a request id; the
 * BP save claims the card with its op id and writes patient_measurements.submission_id once), so a replay that races a
 * send that did arrive stores nothing twice.
 *
 * Privacy: items are bound to the account the page was rendered for and are never replayed under another one; items of
 * another account, and items older than MAX_AGE_MS, are deleted when the outbox is read. Nothing here is logged.
 * Safety: queueing never hides urgent words. The send path asks offlineSendPlan first, and urgent text shows the
 * deterministic emergency instructions (call 103) on the device immediately, whether or not it is queued.
 *
 * Small hand-written IndexedDB wrapper (no dependency) and an in-memory store with the same interface for checks.
 */
export const OUTBOX_KINDS=['zoe_message','bp_reading'] as const;
export type OutboxKind=typeof OUTBOX_KINDS[number];
export type OutboxItem={id:string;account:string;kind:OutboxKind;payload:unknown;queuedAt:number;seq:number};
export interface OutboxStore{list():Promise<OutboxItem[]>;put(item:OutboxItem):Promise<void>;remove(id:string):Promise<void>}
export type ReplayOutcome='sent'|'retry'|'drop';
export const OUTBOX_MAX_AGE_MS=24*60*60_000;
export const OUTBOX_MAX_ITEMS=50;
const REQUEST_ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function memoryOutboxStore():OutboxStore{
 const items=new Map<string,OutboxItem>();
 return {
  async list(){return [...items.values()].map(item=>({...item}));},
  async put(item){items.set(item.id,{...item});},
  async remove(id){items.delete(id);},
 };
}

const DB_NAME='noreon-member-outbox',STORE='items';
/** IndexedDB, one object store keyed by request id. Every failure reads as an empty, unavailable outbox. */
export function indexedDbOutboxStore(factory:IDBFactory|undefined=typeof indexedDB==='undefined'?undefined:indexedDB):OutboxStore{
 let opened:Promise<IDBDatabase>|null=null;
 const db=()=>opened??=new Promise<IDBDatabase>((resolve,reject)=>{
  if(!factory){reject(new Error('Outbox unavailable'));return;}
  const request=factory.open(DB_NAME,1);
  request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains(STORE))request.result.createObjectStore(STORE,{keyPath:'id'});};
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>reject(new Error('Outbox unavailable'));
  request.onblocked=()=>reject(new Error('Outbox unavailable'));
 }).catch(error=>{opened=null;throw error;});
 const run=<T,>(mode:IDBTransactionMode,work:(store:IDBObjectStore)=>IDBRequest<T>)=>db().then(database=>new Promise<T>((resolve,reject)=>{
  const tx=database.transaction(STORE,mode);
  const request=work(tx.objectStore(STORE));
  tx.oncomplete=()=>resolve(request.result);
  tx.onerror=()=>reject(new Error('Outbox unavailable'));
  tx.onabort=()=>reject(new Error('Outbox unavailable'));
 }));
 return {
  list:()=>run<OutboxItem[]>('readonly',store=>store.getAll() as IDBRequest<OutboxItem[]>),
  put:item=>run('readwrite',store=>store.put(item)).then(()=>undefined),
  remove:id=>run('readwrite',store=>store.delete(id)).then(()=>undefined),
 };
}

export type Outbox={
 queue(kind:OutboxKind,id:string,payload:unknown):Promise<boolean>;
 pending(kind?:OutboxKind):Promise<OutboxItem[]>;
 has(id:string):Promise<boolean>;
 remove(id:string):Promise<void>;
 replay(send:(item:OutboxItem)=>Promise<ReplayOutcome>,kind?:OutboxKind):Promise<{sent:string[];dropped:string[];remaining:number}>;
};

/** account(): the account this page was rendered for, or null (nothing is queued or replayed without one). */
export function createOutbox(store:OutboxStore,account:()=>string|null,now:()=>number=Date.now):Outbox{
 const replaying=new Map<string,Promise<{sent:string[];dropped:string[];remaining:number}>>();
 async function mine(kind?:OutboxKind){
  const me=account(),items=await store.list().catch(()=>[] as OutboxItem[]),kept:OutboxItem[]=[];
  for(const item of items){
   // Another account's or an old item never goes out under this session: delete it.
   if(!me||item.account!==me||now()-item.queuedAt>OUTBOX_MAX_AGE_MS){if(me)await store.remove(item.id).catch(()=>undefined);continue;}
   if(!kind||item.kind===kind)kept.push(item);
  }
  return kept.sort((a,b)=>a.seq-b.seq||a.queuedAt-b.queuedAt);
 }
 return {
  async queue(kind,id,payload){
   const me=account();
   if(!me||!REQUEST_ID.test(id))return false;
   const items=await mine();
   if(items.some(item=>item.id===id))return true;
   if(items.length>=OUTBOX_MAX_ITEMS)return false;
   const seq=Math.max(now(),...items.map(item=>item.seq+1));
   try{await store.put({id,account:me,kind,payload,queuedAt:now(),seq});return true;}catch{return false;}
  },
  pending:mine,
  async has(id){return (await mine()).some(item=>item.id===id);},
  async remove(id){await store.remove(id).catch(()=>undefined);},
  replay(send,kind){
   // One replay at a time per kind: a second call (two 'online' events, a reconnect and a tap) joins the first.
   const key=kind??'*',running=replaying.get(key);
   if(running)return running;
   const run=(async()=>{
    const sent:string[]=[],dropped:string[]=[];
    const items=await mine(kind);
    let index=0;
    for(;index<items.length;index++){
     const item=items[index];
     let outcome:ReplayOutcome;
     try{outcome=await send(item);}catch{outcome='retry';}
     if(outcome==='retry')break;
     await store.remove(item.id).catch(()=>undefined);
     (outcome==='sent'?sent:dropped).push(item.id);
    }
    return {sent,dropped,remaining:items.length-index};
   })().finally(()=>{replaying.delete(key);});
   replaying.set(key,run);
   return run;
  },
 };
}

/** Whether a failure looks like no network: the browser says offline, or fetch failed before any answer. */
export function offlineFailure(error:unknown,online:boolean=typeof navigator==='undefined'?true:navigator.onLine){
 if(!online)return true;
 return error instanceof TypeError&&/fetch|network|load failed/i.test(error.message);
}

/**
 * What an offline send does: it is always queued with its request id, and urgent words (the same deterministic,
 * model-free screen the send action runs; offline, its broader intake variants count too, since no server answer can
 * narrow it) show the emergency instructions at once. Urgent text is never queued silently.
 */
export function offlineSendPlan(text:string,check:ZoeEmergencyCheck|null,voiceUrgent=false):{queue:true;emergency:boolean}{
 // Without the page's public matcher switches the default screen still runs (symptom red flags in every intake state).
 return {queue:true,emergency:voiceUrgent||couldBeZoeEmergency(text,check??{env:{},intake:null})};
}
