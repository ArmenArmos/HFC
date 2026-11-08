/** Real upload controller, with only server actions and the PUT transport replaced. */
import assert from 'node:assert/strict';
// @ts-expect-error Runtime provides registerHooks; project types target Node 20.
import {registerHooks} from 'node:module';
import {createElement} from 'react';
import {act,create} from 'react-test-renderer';
import {clinicSnapshot} from './fixtures/clinic-portal';
import type {ClinicCommand,ClinicSnapshot} from '@/lib/clinic-portal/schema';

let snapshot=clinicSnapshot,commands=0,puts=0;
let finish!:(response:Response)=>void,putSeen!:()=>void;
let sawPut=new Promise<void>(resolve=>{putSeen=resolve;});
const state={
 read:async()=>({status:'loaded',data:snapshot}),
 save:async(_clinic:string,command:ClinicCommand)=>{
  assert.equal(command.op,'reserve-upload');commands++;
  if(command.op!=='reserve-upload')throw Error('Expected upload');
  snapshot={...snapshot,files:[...snapshot.files,{...clinicSnapshot.files[0],id:command.fileId,name:command.name,checksum:command.fingerprint,upload:{...clinicSnapshot.files[0].upload,status:'reserved',attemptId:command.attemptId}}]};
  return {status:'committed'};
 },
};
Object.assign(globalThis,{__autoUpload:state,IS_REACT_ACT_ENVIRONMENT:true});
const hook=registerHooks({resolve(s:string,c:object,next:(s:string,c:object)=>object){
 const source=s==='@/lib/clinic-portal/actions'?'export const clinicRead=(...a)=>globalThis.__autoUpload.read(...a);export const clinicCommand=(...a)=>globalThis.__autoUpload.save(...a);export async function clinicRecover(){throw Error("No recovery expected")}':s==='next/navigation'?'export function unstable_rethrow(){}':null;
 return source?{url:'data:text/javascript,'+encodeURIComponent(source),shortCircuit:true}:next(s,c);
}});
const originalFetch=globalThis.fetch;
globalThis.fetch=async()=>{puts++;putSeen();return new Promise<Response>(resolve=>{finish=resolve;});};
const {ClinicUpload}=await import('@/components/clinic-portal/upload');
let tree!:ReturnType<typeof create>;
type Node={children:(string|Node)[]};
const text=(n:Node):string=>n.children.map(c=>typeof c==='string'?c:text(c)).join('');
const file=new File(['%PDF-synthetic'],'Chosen lab.pdf',{type:'application/pdf'});
const props={snapshot,actorScope:'scope',locale:'en' as const,onLoaded:(next:ClinicSnapshot)=>{snapshot=next;tree.update(createElement(ClinicUpload,{...props,snapshot:next}));}};
try{
 await act(async()=>{tree=create(createElement(ClinicUpload,props));});
 assert.match(text(tree.root as unknown as Node),/upload automatically/i,'Explain automatic upload before selection');
 assert.ok(!text(tree.root as unknown as Node).includes('Upload selected files'),'Automatic upload has no manual upload button');
 await act(async()=>{tree.root.findByType('input').props.onChange({target:{files:[file],value:'chosen'}});await sawPut;});
 assert.equal(commands,1);assert.equal(puts,1,'Choosing starts one upload without another press');
 assert.match(text(tree.root as unknown as Node),/Lab result PDF[\s\S]*Uploading/,'Show a neutral dated label while sending');
 assert.ok(!text(tree.root as unknown as Node).includes('Upload selected files'),'No manual upload button while sending');
 const fileId=snapshot.files.at(-1)!.id;
 snapshot={...snapshot,files:snapshot.files.map(f=>f.id===fileId?{...f,upload:{...f.upload,status:'stored'}}:f)};
 await act(async()=>{finish(new Response(JSON.stringify({status:'stored',fileId}),{headers:{'content-type':'application/json'}}));});
 assert.ok(text(tree.root as unknown as Node).includes('Uploaded files appear below.'),'Keep success feedback after the stored-file list takes over');
 assert.ok(!text(tree.root as unknown as Node).includes('Chosen lab.pdf'),'The upload controller removes its duplicate row after the stored snapshot lists that file');
 await act(async()=>{tree.root.findByType('input').props.onChange({target:{files:[file],value:'chosen'}});});
 assert.equal(puts,1,'Choosing the same bytes again does not resend them');
 const deadline=Date.now()+2000;
 while(!text(tree.root as unknown as Node).includes('Already uploaded')&&Date.now()<deadline){
  await act(async()=>{await new Promise<void>(resolve=>setImmediate(resolve));});
 }
 assert.match(text(tree.root as unknown as Node),/Already uploaded/);
 assert.equal(puts,1,'The completed duplicate check did not send more bytes');
 // A lost transport result must never become a success receipt or send itself again.
 sawPut=new Promise<void>(resolve=>{putSeen=resolve;});
 await act(async()=>{tree.root.findByType('input').props.onChange({target:{files:[new File(['%PDF-other'],'Unconfirmed.pdf',{type:'application/pdf'})],value:'chosen'}});await sawPut;});
 await act(async()=>{finish(new Response('{}',{status:503}));});
 assert.match(text(tree.root as unknown as Node),/Lab result PDF[\s\S]*Outcome unknown/);
 assert.equal(puts,2);
 console.log('Clinic automatic upload UI PASS: preselection explanation, filename/progress, retained success receipt, duplicate and unconfirmed transport. Server boundaries mocked.');
}finally{
 await act(async()=>tree?.unmount());hook.deregister();globalThis.fetch=originalFetch;Reflect.deleteProperty(globalThis,'__autoUpload');
}
