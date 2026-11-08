import assert from 'node:assert/strict';
import {configuredConversationEngine,prepareConversationDraft} from '../lib/conversation-persistence/engine';
import {ConversationRepository} from '../lib/conversation-persistence/repository';
const memberId='c4400000-0000-4000-8000-000000000001';let contextVersion=7;let proposal:Record<string,unknown>|undefined;
const repo=new ConversationRepository({rpc:async(name,args)=>{
 if(name==='conversation_retry_workspace')return {data:{ok:true,conversationId:'c4400000-0000-4000-8000-000000000002',version:contextVersion,clinicalRevision:3,draftEpoch:4,sourceToken:'captured-source',messages:[],replies:[],drafts:[],deliveries:[]},error:null};
 proposal=args;return {data:{ok:false,code:'stale_context'},error:null};
}});
assert.equal(configuredConversationEngine({NODE_ENV:'production',NOREON_CONVERSATION_SYNTHETIC_ENGINE:'true',NOREON_CONVERSATION_HARNESS_ENABLED:'true'}),undefined);
const disabled=await prepareConversationDraft(repo,memberId);assert.ok('code'in disabled);assert.equal(disabled.code,'clinical_engine_unavailable');
const result=await prepareConversationDraft(repo,memberId,{propose:async()=>{contextVersion++;return {body:'Synthetic only',summary:'Factual synthetic summary',provenance:{kind:'synthetic',engine:'fixture',version:'1',protocolVersion:'none'}};}});
assert.equal(result.ok,false);assert.equal(proposal?.p_expected_version,7,'Engine cannot silently replace captured version after async I/O');assert.equal(proposal?.p_expected_source,'captured-source');
console.log('PASS captured asynchronous source/version and production-disabled synthetic engine ports');

const maliciousRequest='c4400000-0000-4000-8000-000000000099';
await prepareConversationDraft(repo,memberId,{propose:async()=>({body:'Synthetic text',summary:'Private synthetic facts',provenance:{kind:'synthetic',engine:'fixture',version:'1',protocolVersion:'none'},expectedVersion:999,expectedClinicalRevision:999,expectedDraftEpoch:999,expectedSource:'injected-source',memberId:'c4400000-0000-4000-8000-000000000098',requestId:maliciousRequest})});
assert.equal(proposal?.p_expected_version,8,'CR1 engine extra version cannot replace captured context');
assert.equal(proposal?.p_expected_clinical_revision,3);
assert.equal(proposal?.p_expected_draft_epoch,4);
assert.equal(proposal?.p_expected_source,'captured-source');
assert.equal(proposal?.p_member,memberId);
assert.notEqual(proposal?.p_request_id,maliciousRequest);
assert.equal(proposal?.p_body,'Synthetic text');
assert.equal(proposal?.p_summary,'Private synthetic facts');
console.log('PASS CR1 actual engine→repository ignores extra authority/context/request fields');
