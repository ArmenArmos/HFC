import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';
import type {Database} from '@/lib/db/types';
import {readAdminMessageView} from '@/lib/messaging/admin-view';
import {runMessageOperation} from '@/lib/messaging/operations';
const url=process.env.NOREON_TEST_SUPABASE_URL,key=process.env.NOREON_TEST_SERVICE_ROLE_KEY;
assert.ok(url&&key,'Explicit local fixture URL and service key required');
assert.ok(['127.0.0.1','localhost','[::1]'].includes(new URL(url).hostname),'Local fixture DB only');
const originalFetch=globalThis.fetch;
let externalCalls=0;
globalThis.fetch=(async(input,init)=>{const target=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);if(target.origin!==new URL(url).origin){externalCalls++;throw Error('Provider call prohibited');}assert.equal(init?.method==='POST'?target.pathname.startsWith('/rest/v1/rpc/patient_message_attention'):true,true,'Only read-only attention RPC may use POST');return originalFetch(input,init);}) as typeof fetch;
try{
 const db=createClient<Database>(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const snapshot=async()=>{const results=await Promise.all((['patient_message_outbox','patient_message_attempts','patient_message_delivery_events','patient_message_dispatch_control','patient_message_spend_policy','patient_message_spend_totals','patient_message_spend_reservations','patient_message_recovery_events'] as const).map(async table=>{const r=await db.from(table).select('*').limit(1000);assert.equal(r.error,null);return [table,r.data];}));return JSON.stringify(results);};
 const before=await snapshot();
 const deps={authorize:async()=>{},open:()=>db,operation:(args:string[],client:unknown)=>runMessageOperation(args,client as typeof db)};
 const env={NOREON_MESSAGE_OPERATIONS_ENABLED:'true',NEXT_PUBLIC_PATIENT_DEMO:'false'};
 const first=await readAdminMessageView({},deps,env);assert.equal(first.state,'ready');
 if(first.state==='ready'){
  assert.ok(first.status.attention.length<=50);
  if(first.status.nextCursor){const next=await readAdminMessageView({before:first.status.nextCursor.startedAt,attempt:first.status.nextCursor.attemptId},deps,env);assert.equal(next.state,'ready');if(next.state==='ready'){const ids=new Set(first.status.attention.map(r=>r.attempt_id));assert.ok(next.status.attention.every(r=>!ids.has(r.attempt_id)),'Cursor cannot repeat first-page items');}}
 }
 assert.equal(await snapshot(),before,'Reading status must not mutate messaging tables');assert.equal(externalCalls,0);
 console.log('Actual local DB status/spend/pagination read completed with unchanged messaging tables and zero external/provider requests.');
}finally{globalThis.fetch=originalFetch;}
