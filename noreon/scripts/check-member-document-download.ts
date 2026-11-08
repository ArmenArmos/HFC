import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
// Member and staff opening a member's uploaded document (quality review 18 Oct, aA-1): the member path must not
// call a staff RPC (it refuses non-staff, so every member download was 503 after #240). The staff path reads the
// row through staff_member_history_document, which records the open (20261020195207), before the bytes, and
// serves nothing if that fails; staff never read the row through RLS.
process.env.NEXT_PUBLIC_SUPABASE_URL='http://storage.check.test';process.env.SUPABASE_SERVICE_ROLE_KEY='check-only';
const {documentBytesResponse}=await import('@/lib/member-history/server');
const bytes=Buffer.from('%PDF-1.7\n% check document\n%%EOF');
const row={object_path:'m/doc.pdf',mime:'application/pdf',size_bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),file_name:'result.pdf'};
const memberId='11111111-1111-4111-8111-111111111111',docId='22222222-2222-4222-8222-222222222222';
const log:string[]=[];
const client=(rpcError:boolean)=>({
 from:()=>{const q={select:()=>q,eq:()=>q,maybeSingle:async()=>{log.push('row');return {data:row,error:null};}};return q;},
 rpc:async(name:string)=>{log.push(`rpc:${name}`);return rpcError?{data:null,error:{message:'Member history access required'}}:{data:row,error:null};},
});
const realFetch=globalThis.fetch;
globalThis.fetch=(async(input:RequestInfo|URL)=>{const url=String(input instanceof Request?input.url:input);
 if(url.startsWith('http://storage.check.test/storage/v1/object/')){log.push('download');return new Response(bytes,{headers:{'content-type':'application/pdf'}});}
 return realFetch(input as RequestInfo);}) as typeof fetch;
try{
 // A member reading their own upload: the RPC would refuse them, and it is never called.
 log.length=0;let r=await documentBytesResponse(client(true),memberId,docId,'member');
 assert.equal(r.status,200,'member download is served');assert.deepEqual(Buffer.from(await r.arrayBuffer()),bytes);
 assert.deepEqual(log,['row','download'],'member path: row, then bytes, no access-recording RPC');
 // Staff: recorded between the row read and the download.
 log.length=0;r=await documentBytesResponse(client(false),memberId,docId,'staff');
 assert.equal(r.status,200);assert.deepEqual(log,['rpc:staff_member_history_document','download'],'staff open recorded by the RPC before the bytes, no RLS row read');
 // Staff whose open cannot be recorded get nothing.
 log.length=0;r=await documentBytesResponse(client(true),memberId,docId,'staff');
 assert.equal(r.status,503);assert.deepEqual(log,['rpc:staff_member_history_document'],'no bytes when recording fails');
 // Tampered bytes are refused on both paths.
 const good=row.sha256;row.sha256='0'.repeat(64);
 assert.equal((await documentBytesResponse(client(true),memberId,docId,'member')).status,503,'hash mismatch refused');row.sha256=good;
}finally{globalThis.fetch=realFetch;}
console.log('Member document download: ok');
