/** Real chat, member setup and upload controllers; synthetic RPC/Auth/transport boundaries. */
import assert from 'node:assert/strict';
import React from 'react';
import {act,create} from 'react-test-renderer';
// @ts-expect-error Runtime provides registerHooks; project types target Node 20.
import {registerHooks} from 'node:module';
import {beginMemberUpload} from '@/lib/clinic-admin/files';
import {clinicIdentity,clinicSnapshot,actor} from './fixtures/clinic-portal';
import type {ClinicCommand,ClinicSnapshot} from '@/lib/clinic-portal/schema';
import type {ClinicChatReply} from '@/lib/clinic-chat/runtime';
import type {ChatQuery} from '@/lib/clinic-chat/schema';
import type {MemberFile} from '@/lib/clinic-admin/files-schema';
const identity={...clinicIdentity,fullAccess:true},scope='synthetic-scope';
const commands:ClinicCommand[]=[],recoveries:unknown[]=[],batches=new Map<string,string>();
let lostCreate=true,lostRegister=true,registered=false,stored=false,puts=0,unavailable=false;
let uploadAvailable=true;
let readStatus:Partial<Pick<MemberFile,'noValuesRead'|'override'>>={};
let putFinished!:()=>void;
const putComplete=new Promise<void>(resolve=>{putFinished=resolve;});
let snapshot:ClinicSnapshot={...clinicSnapshot,files:[]};
const rpc={rpc:async(name:string,args?:Record<string,unknown>)=>{
 if(name==='clinic_batch_command'){
  const c=args!.p_command as ClinicCommand;commands.push(structuredClone(c));
  if(c.op==='create-batch'){
   const prior=batches.get(c.submissionId);if(prior)assert.equal(prior,JSON.stringify(c));else batches.set(c.submissionId,JSON.stringify(c));
   snapshot={...snapshot,batch:{...snapshot.batch,id:c.batchId}};
   if(lostCreate){lostCreate=false;throw Error('Synthetic lost create response');}
  }else{assert.ok(registered,'No reservation before member registration');}
  return {error:null,data:{status:'committed',submissionId:c.submissionId,batchId:c.batchId,revision:1}};
 }
 assert.equal(name,'clinic_admin_member_upload_register');assert.equal(args!.p_member,actor);registered=true;
 if(lostRegister){lostRegister=false;throw Error('Synthetic lost register response');}
 return {error:null,data:{status:'registered'}};
}};
const memberFiles={version:'clinic-member-files-v1',enabled:true,status:'ok',uploadAvailable:true,uploads:[],unmatched:[]};
const api={
 begin:async(clinic:string,expected:string,member:string,input:unknown)=>{
  assert.equal(clinic,identity.clinicId);assert.equal(expected,scope);assert.equal(member,actor);
  // Pass the actual frozen setup request through the production runtime.
  return (beginMemberUpload as (...args:unknown[])=>Promise<unknown>)(rpc,identity,member,input);
 },
 files:async()=>unavailable?{status:'forbidden'}:{status:'loaded',data:{...memberFiles,uploadAvailable,uploads:stored?[{fileId:snapshot.files[0].id,name:'Synthetic new.pdf',uploadedAt:'2026-11-01T08:00:00Z',fromRecord:true,state:'attached',attached:true,override:false,fileReading:'done',memberReading:'done',readingOn:true,compare:null,...readStatus}]:[]}},
 read:async()=>({status:'loaded',data:snapshot}),
 command:async(_clinic:string,c:ClinicCommand,expected:string)=>{assert.equal(expected,scope);return (await rpc.rpc('clinic_batch_command',{p_command:c})).data;},
 recover:async(_clinic:string,c:ClinicCommand,expected:string)=>{
  assert.equal(expected,scope);recoveries.push(structuredClone(c));
  return {status:'loaded',snapshot,receipt:{status:'committed',submissionId:c.submissionId,batchId:c.batchId,revision:1}};
 },
};
Object.assign(globalThis,{__chatUpload:api,__chatUploadReact:React,IS_REACT_ACT_ENVIRONMENT:true,requestAnimationFrame:()=>0,cancelAnimationFrame:()=>{},document:{getElementById:()=>null}});
const hook=registerHooks({resolve(s:string,c:object,next:(s:string,c:object)=>object){
 const source=s==='next/link'?'export default function Link(p){return globalThis.__chatUploadReact.createElement("a",p,p.children)}':
 s==='next/navigation'?'export function useRouter(){return {refresh(){},push(){}}} export function unstable_rethrow(){}':
 s==='@/lib/clinic-admin/actions'?'export const clinicMemberUploadBegin=(...a)=>globalThis.__chatUpload.begin(...a);export const clinicMemberFilesRead=(...a)=>globalThis.__chatUpload.files(...a);export async function clinicMemberFileAttach(){return {status:"refused"}} export async function clinicMemberUploadReserve(){throw Error("Legacy transport must not run")}':
 s==='@/lib/clinic-portal/actions'?'export const clinicRead=(...a)=>globalThis.__chatUpload.read(...a);export const clinicCommand=(...a)=>globalThis.__chatUpload.command(...a);export const clinicRecover=(...a)=>globalThis.__chatUpload.recover(...a);':
 s==='@/lib/clinic-portal/lab-results-actions'?'export async function clinicLabResults(){return {status:"unavailable"}} export async function clinicLabLink(){return {status:"access"}}':null;
 return source?{url:'data:text/javascript,'+encodeURIComponent(source),shortCircuit:true}:next(s,c);
}});
const originalFetch=globalThis.fetch;
globalThis.fetch=async(_url,options)=>{
 puts++;assert.equal(options?.method,'PUT');
 const c=commands.at(-1)!;assert.ok(c.op==='reserve-upload');
 snapshot={...snapshot,files:[{...clinicSnapshot.files[0],id:c.fileId,logicalKey:c.logicalKey,name:c.name,checksum:c.fingerprint,upload:{...clinicSnapshot.files[0].upload,status:'stored',attemptId:c.attemptId}}]};stored=true;
 putFinished();
 throw Error('Synthetic lost stored response');
};
const {ClinicChat}=await import('@/components/clinic-portal/chat');
let tree!:ReturnType<typeof create>;
type Node={children:(Node|string)[]};const label=(n:Node):string=>n.children.map(c=>typeof c==='string'?c:label(c)).join('');
const button=(name:string)=>tree.root.findAllByType('button').find(b=>label(b as unknown as Node)===name);
const click=async(name:string)=>{assert.ok(button(name),`Missing ${name}`);await act(async()=>{await button(name)!.props.onClick();});};
const home:ClinicChatReply={kind:'home',maskedMembers:[],bookings:{status:'unavailable'},today:{status:'unavailable'},batches:{status:'unavailable'},asOf:'2026-11-01T08:00:00Z'};
const reads:ChatQuery[]=[];
const read=async(q:ChatQuery):Promise<ClinicChatReply>=>{
 reads.push(q);
 if(q.kind==='batches')return {kind:'batches',maskedMembers:[],result:{status:'loaded',data:{version:'clinic-batches-page-v1',clinicId:identity.clinicId,batches:[],nextCursor:null}}};
 if(q.kind==='records')return {kind:'records',maskedMembers:[],result:{status:'loaded',maskedMembers:[],patients:[{memberId:actor,name:'Synthetic member',phone:null,birthDate:null,doctorName:null,nurseName:null}]}};
 assert.equal(q.kind,'member');return {kind:'member',maskedMembers:[],result:{status:'loaded',data:{member:{memberId:actor,name:'Synthetic member',phone:null,birthDate:null},bookings:[],files:[]}}};
};
try{
 await act(async()=>{tree=create(React.createElement(ClinicChat,{identity,actorScope:scope,locale:'en',canChooseClinic:false,resultLink:false,initial:home,initialQuery:{kind:'home'},read,run:async()=>({status:'stale' as const}),slots:async()=>[]}));});
 await click('Show upload status');await click('Choose a member');
 const memberButton=tree.root.findAllByType('button').find(b=>label(b as unknown as Node).includes('Synthetic member'))!;
 await act(async()=>memberButton.props.onClick());
 assert.deepEqual(reads.map(q=>q.kind),['batches','records','member']);
 await act(async()=>{const press=button('Upload results')!.props.onClick;press();press();});
 assert.equal(commands.length,1,'Same-tick setup press creates one request');assert.equal(puts,0);
 await click('Retry upload setup');assert.equal(puts,0);
 await click('Retry upload setup');
 assert.equal(batches.size,1,'Lost create and registration responses reuse exactly one batch');
 assert.deepEqual(commands[0],commands[1]);assert.deepEqual(commands[1],commands[2]);
 const file=new File(['%PDF-synthetic'],'Synthetic new.pdf',{type:'application/pdf'});
 await act(async()=>{
  tree.root.find(n=>n.type==='input'&&n.props.type==='file').props.onChange({target:{files:[file],value:''}});
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{await Promise.race([putComplete,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Upload did not reach transport')),2000);})]);}finally{clearTimeout(timer);}
 });
 assert.equal(stored,true);assert.ok(button('Check saved work'),'Existing upload recovery is available in chat');
 const reserved=commands.at(-1)!;await click('Check saved work');
 assert.deepEqual(recoveries,[reserved]);assert.equal(puts,1,'Stored PDF is not sent again');assert.equal(batches.size,1);
 assert.ok(!button('Check saved work'),'Recovered stored receipt closes the uncertain upload');
 assert.ok(label(tree.root as unknown as Node).includes('Ready for the doctor'),'Stored upload refreshes the member results in chat');
 const {ChatMemberFiles}=await import('@/components/clinic-portal/chat-member-files');
 for(const locale of ['en','hy','ru'] as const)for(const state of ['ready','unreadable','override'] as const){
  readStatus={noValuesRead:state==='unreadable',override:state==='override'};
  await act(async()=>tree.update(React.createElement(ChatMemberFiles,{key:`${locale}-${state}`,clinicId:identity.clinicId,memberId:actor,actorScope:scope,locale})));
  const text=label(tree.root as unknown as Node);
  const labels={ready:{en:'Ready for the doctor',hy:'Պատրաստ է բժշկի համար',ru:'Готово для врача'},
   unreadable:{en:"Couldn't read this file",hy:'Չհաջողվեց կարդալ այս ֆայլը',ru:'Не удалось прочитать этот файл'},
   override:{en:'Waiting for the doctor to check this file',hy:'Սպասում է բժշկի ստուգմանը',ru:'Ожидает проверки врачом'}};
  assert.ok(text.includes(labels[state][locale]),`Chat file list: ${state} in ${locale}`);
  if(state!=='ready')assert.doesNotMatch(text,/Ready for the doctor|Պատրաստ է բժշկի համար|Готово для врача|Their doctor reviews the values|Արժեքները վերանայում է նրա բժիշկը|Значения проверяет его врач/);
 }
 readStatus={};unavailable=true;
 // A scope denial hides upload and attachment controls, as before.
 await act(async()=>tree.update(React.createElement(ChatMemberFiles,{clinicId:identity.clinicId,memberId:actor,actorScope:'changed',locale:'en'})));
 assert.equal(tree.root.findAll(n=>n.type==='input'&&n.props.type==='file').length,0);
 assert.ok(!button('Upload results'));
 unavailable=false;uploadAvailable=false;
 await act(async()=>tree.update(React.createElement(ChatMemberFiles,{clinicId:identity.clinicId,memberId:actor,actorScope:scope,locale:'en'})));
 assert.equal(button('Upload results')?.props.disabled,true,'Switched-off uploads cannot prepare a batch');
 assert.equal(tree.root.findAll(n=>n.type==='input'&&n.props.type==='file').length,0);
 const before=commands.length;
 assert.deepEqual(await beginMemberUpload(rpc,identity,actor,{submissionId:actor,batchId:actor,name:'Results upload',clinicId:identity.clinicId}),{status:'invalid'});
 assert.equal(commands.length,before,'Setup accepts no caller clinic/actor override');
 console.log('Clinic chat member upload PASS: admin → upload status → member → PDF, exact setup retries after lost create/register responses, existing stored-file recovery, no duplicate batch/PUT, denied scope. Synthetic boundaries, not live Auth/Storage.');
}finally{await act(async()=>tree?.unmount());hook.deregister();globalThis.fetch=originalFetch;Reflect.deleteProperty(globalThis,'__chatUpload');Reflect.deleteProperty(globalThis,'__chatUploadReact');}
