import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
assert.ok(existsSync('lib/conversation-persistence/repository.ts'), 'Durable conversation repository is absent');
const {ConversationRepository}=await import('../lib/conversation-persistence/repository');
const calls: {name:string;args:unknown}[]=[];
const repo=new ConversationRepository({rpc:async(name:string,args:unknown)=>{calls.push({name,args});return {data:{ok:true,conversationId:'00000000-0000-4000-8000-000000000002',version:1,replayed:false},error:null};}});
await repo.receive({requestId:'00000000-0000-4000-8000-000000000001',text:'Synthetic member concern'});
assert.equal(calls[0].name,'conversation_receive');
assert.deepEqual(calls[0].args,{p_command:{requestId:'00000000-0000-4000-8000-000000000001',text:'Synthetic member concern'},p_to_doctor:false});
await assert.rejects(()=>repo.receive({requestId:'00000000-0000-4000-8000-000000000001',text:'x',memberId:'forged'}));
console.log('PASS conversation repository strict member boundary (injected RPC port, not SQL/Auth proof)');
const recoveryCalls:{name:string;args:Record<string,unknown>}[]=[];
const recoverRepo=new ConversationRepository({rpc:async(name,args)=>{recoveryCalls.push({name,args});return {data:{status:'unknown'},error:null};}});
const manual={memberId:'00000000-0000-4000-8000-000000000002',requestId:'00000000-0000-4000-8000-000000000003',expectedVersion:7,expectedClinicalRevision:3,expectedDraftEpoch:2,expectedSource:'source',body:'Exact reply',summary:'Private summary'};
await recoverRepo.recover(manual.memberId,{kind:'compose',input:manual});
assert.equal(recoveryCalls[0].name,'conversation_recover');
assert.deepEqual(recoveryCalls[0].args.p_payload,{op:'propose',memberId:manual.memberId,requestId:manual.requestId,expectedVersion:7,clinicalRevision:3,draftEpoch:2,source:'source',body:'Exact reply',summary:'Private summary',provenance:{kind:'staff',engine:'doctor-authored',version:'1',protocolVersion:'not-applicable'}});
assert.equal(recoveryCalls.length,1,'Recovery never submits original mutation');
console.log('PASS manual-command full payload recovery mapping; no execution or absence inference');

const upper={...manual,memberId:'ABCDEF00-0000-4000-8000-000000000002',requestId:'ABCDEF00-0000-4000-8000-000000000003'};
const lexicalCalls:{name:string;args:Record<string,unknown>}[]=[];
const lexicalRepo=new ConversationRepository({rpc:async(name,args)=>{lexicalCalls.push({name,args});return {data:name==='conversation_recover'?{status:'unknown'}:{ok:true,draftId:'00000000-0000-4000-8000-000000000004',revision:1,replayed:false},error:null};}});
await lexicalRepo.compose(upper);
await lexicalRepo.recover(upper.memberId,{kind:'compose',input:upper});
assert.equal(lexicalCalls[0].args.p_request_id,upper.requestId.toLowerCase());
assert.equal(lexicalCalls[1].args.p_request_id,lexicalCalls[0].args.p_request_id);
assert.equal((lexicalCalls[1].args.p_payload as {requestId:string}).requestId,lexicalCalls[0].args.p_request_id);
assert.equal((lexicalCalls[1].args.p_payload as {memberId:string}).memberId,lexicalCalls[0].args.p_member);
for(const requestId of [upper.requestId.replaceAll('-',''),`{${upper.requestId}}`]){
 await assert.rejects(()=>lexicalRepo.compose({...upper,requestId}));
 await assert.rejects(()=>lexicalRepo.recover(upper.memberId,{kind:'compose',input:{...upper,requestId}}));
}
const opaque={schema:1,purpose:'reply.approve',intentId:'abcdef00000040008000000000000004',requestId:'OpaqueRequest_ABC12345'};
await lexicalRepo.recover(upper.memberId,{kind:'command',input:opaque});
assert.equal(lexicalCalls.at(-1)?.args.p_request_id,opaque.requestId,'Core opaque request IDs remain case-sensitive');
console.log('PASS UUID compose/recovery canonical namespace; noncanonical forms rejected at port; opaque command IDs preserved');
