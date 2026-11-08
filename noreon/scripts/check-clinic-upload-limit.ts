/** Final review R2: clinic PDFs travel as one raw body through a Vercel Function (4.5 MB request cap).
 * Every application gate must stay at the 4 MiB product limit: selection, reservation, transport, storage. */
import assert from'node:assert/strict';import*as nodeModule from'node:module';import{createElement}from'react';import{create,act}from'react-test-renderer';
import{actor,batch,clinic,clinicIdentity,clinicSnapshot}from'./fixtures/clinic-portal';
import{CLINIC_UPLOAD_MAX_BYTES}from'@/lib/clinic-portal/upload-limits';
import{runClinicCommand}from'@/lib/clinic-portal/runtime';
import{storeClinicOriginal}from'@/lib/clinic-portal/upload-runtime';
import{readClinicUploadBody}from'@/lib/clinic-portal/upload-server';
type Resolution={url:string;shortCircuit?:boolean};type Resolver=(s:string,c:unknown,next:(s:string,c:unknown)=>Resolution)=>Resolution;const{registerHooks}=nodeModule as unknown as{registerHooks:(h:{resolve:Resolver})=>{deregister:()=>void}};
assert.equal(CLINIC_UPLOAD_MAX_BYTES,4*1024*1024);assert.ok(CLINIC_UPLOAD_MAX_BYTES<4.5*1024*1024,'Below the Vercel Function request body cap');
const id=(n:number)=>`c3100000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const command=(size:number)=>({version:'clinic-command-v1',op:'reserve-upload',submissionId:id(60),clinicId:clinic,batchId:batch,revision:1,logicalKey:id(61),fileId:id(62),attemptId:id(63),name:'Synthetic.pdf',mime:'application/pdf',declaredSizeBytes:size,fingerprint:'a'.repeat(64)});
const rpcCalls:string[]=[];const rpc={rpc:async(name:string)=>{rpcCalls.push(name);return{data:null,error:{code:'synthetic'}};}};
assert.deepEqual(await runClinicCommand(rpc as never,clinicIdentity,command(CLINIC_UPLOAD_MAX_BYTES+1)),{status:'invalid'});assert.equal(rpcCalls.length,0,'Oversized file is rejected before any reservation');
await runClinicCommand(rpc as never,clinicIdentity,command(CLINIC_UPLOAD_MAX_BYTES));assert.deepEqual(rpcCalls,['clinic_batch_command'],'At-limit file may be reserved');
const context={rpc:rpc as never,identity:clinicIdentity,execution:{actorId:actor,sessionId:actor},service:()=>null};
const pdf=(size:number)=>Buffer.concat([Buffer.from('%PDF-'),Buffer.alloc(size-5)]);
rpcCalls.length=0;assert.deepEqual(await storeClinicOriginal(context,{batchId:batch,fileId:id(62),attemptId:id(63),bytes:pdf(CLINIC_UPLOAD_MAX_BYTES+1)}),{status:'invalid'});assert.equal(rpcCalls.length,0,'Storage step rejects oversized bytes before reads');
const stream=(size:number)=>new Blob([new Uint8Array(size)]).stream();
await assert.rejects(readClinicUploadBody(stream(CLINIC_UPLOAD_MAX_BYTES+1)),'Default body reader limit is the product limit');assert.equal((await readClinicUploadBody(stream(CLINIC_UPLOAD_MAX_BYTES))).length,CLINIC_UPLOAD_MAX_BYTES);
// Actual selection UI: the database still advertises 8 MiB, the browser must apply the stricter product limit.
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
const hook=registerHooks({resolve(s,c,next){const source=s==='@/lib/clinic-portal/actions'?'export const clinicRead=async()=>({status:"unavailable"});export const clinicCommand=async()=>({status:"unknown"});export const clinicRecover=async()=>({status:"unavailable"});':s==='next/navigation'?'export function unstable_rethrow(){}':null;return source?{url:'data:text/javascript,'+encodeURIComponent(source),shortCircuit:true}:next(s,c);}});
try{
 assert.equal(clinicSnapshot.limits.maxFileBytes,8388608);
 const{ClinicUpload}=await import('@/components/clinic-portal/upload');let tree!:ReturnType<typeof create>;
 for(const locale of['en','hy'] as const){
  await act(async()=>{tree=create(createElement(ClinicUpload,{snapshot:clinicSnapshot,actorScope:'synthetic-page-scope',locale,onLoaded:()=>{}}));});
  const text=()=>JSON.stringify(tree.toJSON());
  assert.ok(text().includes(locale==='en'?'PDF files up to 4 MB each.':'PDF ֆայլեր՝ յուրաքանչյուրը մինչև 4 ՄԲ։'),`${locale}: limit is stated before choosing`);
  const big=new File([new Uint8Array(CLINIC_UPLOAD_MAX_BYTES+1)],'Too big.pdf',{type:'application/pdf'}),ok=new File([new Uint8Array(CLINIC_UPLOAD_MAX_BYTES)],'At limit.pdf',{type:'application/pdf'});
  await act(async()=>tree.root.findByType('input').props.onChange({target:{files:[big,ok],value:'ignored'}}));
  assert.ok(!text().includes('Too big.pdf'),`${locale}: oversized file is not selected`);assert.equal(tree.root.findAllByType('li').length,1,`${locale}: only the at-limit file is selected`);assert.ok(!text().includes('At limit.pdf'),`${locale}: selected file uses a neutral label`);
  await act(async()=>tree.unmount());
 }
}finally{hook.deregister();}
console.log('Clinic upload 4 MiB limit: stated in EN/HY, enforced at selection, reservation, transport reader and storage; at-limit accepted.');
