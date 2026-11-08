import assert from 'node:assert/strict';
import {createCleanupHandler} from '@/lib/cleanup/handler';
const env={CRON_SECRET:'test-secret',NOREON_DEPLOYMENT_TARGET:'app'};
let opened=0;let writes:unknown[]=[];let removed=0;const boundaries:unknown[]=[];
// WP-11 item 32: retired clinic uploads waiting for cleanup, and what the run did with them.
const clinicFile={fileId:'b1100000-0000-4000-8000-000000000001',bucket:'clinic-originals',objectKey:'b1100000-0000-4000-8000-0000000000aa/b1100000-0000-4000-8000-000000000001/b1100000-0000-4000-8000-0000000000ab.pdf'};
// Removed earlier-result files (member-history) waiting for a retried purge.
let historyPending:unknown[]=[];let historyRemoveFail=false;const historyCalls:unknown[]=[];
let clinicPending:unknown[]=[];let clinicListFail=false;let clinicCleanupFail=false;let clinicRemoveFail=false;const clinicCalls:unknown[]=[];
function db(options:{storageFail?:boolean;ledgerFail?:boolean;queryFail?:boolean;empty?:boolean;hangingLedger?:boolean;saveFail?:boolean}={}){
 const chain={select(){return this},eq(){return this},is(){return this},lt(column:string,value:string){boundaries.push([column,value]);return this},order(){return this},limit(count:number){boundaries.push(count);return Promise.resolve({error:options.queryFail?{}:null,data: options.queryFail?null:options.empty?[]:[{id:'sensitive-id',object_path:'sensitive-path'}]})},update(){return {eq:async()=>({error:options.saveFail?{}:null})}}};
 const history={select(){return this},not(){return this},is(){return this},order(){return this},limit(){return Promise.resolve({error:null,data:historyPending})},update(v:unknown){return {eq:async(_c:string,id:string)=>{historyCalls.push(['purged',id,typeof (v as {storage_purged_at?:unknown}).storage_purged_at]);return {error:null}}}}};
 return {from:(table:string)=>table==='member_reported_documents'?history:chain,storage:{from:(bucket:string)=>({remove:async(paths:string[])=>{if(bucket==='member-history'){historyCalls.push(['remove',paths]);return {error:historyRemoveFail?{message:'sensitive-error'}:null};}if(bucket==='clinic-originals'){clinicCalls.push(['remove',paths]);return {error:clinicRemoveFail?{message:'sensitive-error'}:null};}removed++;return {error:options.storageFail?{message:'sensitive-error'}:null}}})},rpc:async(name:string,args:unknown)=>{
  if(name==='clinic_upload_cleanup_pending'){clinicCalls.push(['list',args]);return clinicListFail?{data:null,error:{}}:{data:clinicPending,error:null};}
  if(name==='clinic_upload_cleanup'){clinicCalls.push(['cleanup',args]);return clinicCleanupFail?{data:null,error:{code:'55000'}}:{data:{status:'complete'},error:null};}
  writes.push({name,args});if(options.hangingLedger)return new Promise<{error:null}>(()=>{});return {error:options.ledgerFail?{}:null}}};
}
let client=db();
const get=createCleanupHandler({env,demoEnabled:()=>false,real:()=>{opened++;return client},demo:()=>{throw Error('demo disabled')}} as unknown as Parameters<typeof createCleanupHandler>[0]);
assert.equal((await get(new Request('http://test'))).status,404);assert.equal(opened,0);assert.equal(writes.length,0);
const req=()=>new Request('http://test',{headers:{authorization:'Bearer test-secret'}});
let res=await get(req());assert.equal(res.status,200);assert.equal(removed,1);assert.equal(writes.length,2);assert.equal(boundaries[1],200);assert.ok(Math.abs(Date.now()-Date.parse((boundaries[0] as string[])[1])-3*3600000)<2000);assert.ok(!JSON.stringify(writes).includes('sensitive'));
writes=[];client=db({storageFail:true});res=await get(req());assert.equal(res.status,500);assert.match(JSON.stringify(writes),/storage/);assert.ok(!JSON.stringify(writes).includes('sensitive'));
writes=[];client=db({ledgerFail:true});res=await get(req());assert.equal(res.status,200);assert.equal((await res.json()).observability,'unavailable');
client=db({queryFail:true,ledgerFail:true});res=await get(req());assert.equal(res.status,500);assert.equal((await res.json()).error,'cleanup_failed');
writes=[];client=db({empty:true});res=await get(req());assert.equal(res.status,200);assert.match(JSON.stringify(writes),/"p_attempted":0/);
client=db({saveFail:true});res=await get(req());assert.equal(res.status,500);assert.equal((await res.json()).failed,1);
client=db({hangingLedger:true});const start=Date.now();res=await get(req());assert.equal(res.status,200);assert.equal((await res.json()).observability,'unavailable');assert.ok(Date.now()-start<3000,'Telemetry hang must be bounded');
// Retired clinic uploads: the original is removed first, then the database records the cleanup.
clinicCalls.length=0;writes=[];clinicPending=[clinicFile];client=db({empty:true});res=await get(req());assert.equal(res.status,200);
assert.deepEqual(clinicCalls,[['list',{p_limit:100}],['remove',[clinicFile.objectKey]],['cleanup',{p_file:clinicFile.fileId}]],'Remove the original, then record the cleanup');
assert.equal((await res.json()).cleaned,1);assert.match(JSON.stringify(writes),/"p_attempted":1/);
clinicCalls.length=0;clinicRemoveFail=true;client=db({empty:true});res=await get(req());assert.equal(res.status,500);
assert.deepEqual(clinicCalls.map(c=>(c as unknown[])[0]),['list','remove'],'A failed removal never records the cleanup');clinicRemoveFail=false;
clinicCalls.length=0;writes=[];clinicCleanupFail=true;client=db({empty:true});res=await get(req());assert.equal(res.status,500);assert.match(JSON.stringify(writes),/database/);clinicCleanupFail=false;
clinicCalls.length=0;clinicListFail=true;client=db({empty:true});res=await get(req());assert.equal(res.status,500);assert.deepEqual(clinicCalls.map(c=>(c as unknown[])[0]),['list']);clinicListFail=false;
clinicCalls.length=0;clinicPending=[{...clinicFile,objectKey:'../escape.pdf'}];client=db({empty:true});res=await get(req());assert.equal(res.status,500);assert.deepEqual(clinicCalls.map(c=>(c as unknown[])[0]),['list'],'An unsafe key is never removed');clinicPending=[];
// A removed earlier-result file is removed from Storage, then marked purged; a failed removal stays pending.
historyCalls.length=0;historyPending=[{id:'h1',object_path:'u/h1.pdf'}];client=db({empty:true});res=await get(req());assert.equal(res.status,200);
assert.deepEqual(historyCalls,[['remove',['u/h1.pdf']],['purged','h1','string']]);
historyCalls.length=0;historyRemoveFail=true;client=db({empty:true});res=await get(req());assert.equal(res.status,500);assert.deepEqual(historyCalls,[['remove',['u/h1.pdf']]],'A failed removal is never marked purged');historyRemoveFail=false;historyPending=[];
console.log('Cleanup authentication, existing storage boundary, sanitized failure, and ledger-outage isolation passed.');
