import assert from 'node:assert/strict';
import {deliveryLabelText,deliveryDetailText,deliveryLabel} from '@/lib/telegram-runtime/delivery-copy';

const states=['queued','sending','accepted_by_provider','definitely_failed','held','unknown'] as const;
const labels={en:['Sent','Sent','Delivered','Not delivered','Not delivered','Not confirmed'],hy:['Ուղարկված է','Ուղարկված է','Առաքված է','Չի առաքվել','Չի առաքվել','Հաստատված չէ'],ru:['Отправлено','Отправлено','Доставлено','Не доставлено','Не доставлено','Не подтверждено']};
const holds=['route_unavailable','route_policy_missing','approval_authority_lapsed','newer_member_message','stale_context','endpoint_unlinked','endpoint_relinked','member_over_intake_limit','member_sent_unsupported_media','template_unapproved','template_changed'];
const failures=['telegram_bot_blocked','telegram_chat_not_found','telegram_message_refused','telegram_timeout','not_sent_unsupported_payload','Adapter unavailable before invocation'];
for(const locale of ['en','hy','ru'] as const){
 states.forEach((state,index)=>assert.equal(deliveryLabelText(state,locale),labels[locale][index]));
 for(const reason of holds){const text=deliveryDetailText('held',reason,locale);assert.ok(text.length>25);assert.ok(!text.includes(reason));assert.ok(!text.includes('—'));}
 for(const reason of failures){const text=deliveryDetailText('definitely_failed',reason,locale);assert.ok(text.length>15);assert.ok(!text.includes(reason));assert.ok(!text.includes('—'));}
 assert.equal(deliveryDetailText('definitely_failed','provider text with private information',locale),deliveryDetailText('definitely_failed',null,locale));
 assert.equal(deliveryDetailText('held','unknown_private_reason',locale),deliveryDetailText('held',null,locale));
}
assert.equal(deliveryDetailText('queued',null),'Waiting for Telegram to accept it.');
assert.equal(deliveryDetailText('accepted_by_provider',null),'Telegram accepted it. This does not confirm the member has read it.');
assert.equal(deliveryDetailText('unknown',null),"We can't confirm it arrived. To avoid sending it twice, there is no retry. Contact the member another way.");
assert.match(deliveryDetailText('definitely_failed','telegram_bot_blocked'),/blocked the bot/);
assert.match(deliveryDetailText('definitely_failed','telegram_chat_not_found'),/chat was not found/);
assert.match(deliveryDetailText('definitely_failed','telegram_message_refused'),/refused/);
assert.match(deliveryDetailText('definitely_failed','telegram_timeout'),/time/);
assert.equal(deliveryLabel.queued.label,'Approved, waiting to send','Other surfaces retain their English');
console.log('PASS delivery labels and fixed reasons in en, hy and ru; private provider text is never displayed');

// Mounted components: the server flag alone cannot enable a disallowed state.
const React=await import('react');
const {act,create}=await import('react-test-renderer');
const {ConversationEntries}=await import('@/components/doctor-chat-v2/conversation');
const {ConversationReview}=await import('@/components/conversation/review');
const {canRetryDelivery}=await import('@/lib/telegram-runtime/delivery-copy');
(globalThis as unknown as {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const id=(n:number)=>`d5500000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const approvedAt='2026-11-05T09:00:00Z';
const approval={id:id(2),draft_id:id(3),revision:1,context_version:1,content_hash:'hash',body:'Identical approved reply',doctor_id:id(4),doctor_name:'Doctor Example',doctor_role:'doctor' as const,clinic_id:id(5),grant_id:id(6),grant_generation:1,intent_id:id(7),created_at:approvedAt};
const base={id:id(1),conversation_id:id(8),approval_id:id(2),state:'definitely_failed' as const,reason:'telegram_bot_blocked',state_seq:1,endpoint_id:id(9),endpoint_generation:1,policy_version:'test',review_after_send:false,created_at:approvedAt,approval};
const initial={ok:true as const,conversationId:id(8),version:1,memberName:'Example member',unsavedOverLimit:false,unsupportedMedia:false,clinicalRevision:0,draftEpoch:1,sourceToken:'source',messages:[],replies:[],drafts:[],deliveries:[base]};
const allowedHolds=['route_unavailable','route_policy_missing','approval_authority_lapsed'];
for(const locale of ['en','hy','ru'] as const){
 for(const state of states){for(const reason of state==='held'?holds:[null]){for(const ready of [false,true]){
  const expected=ready&&(state==='definitely_failed'||state==='held'&&allowedHolds.includes(reason??''));
  const delivery={...base,state,reason,can_retry:ready};
  assert.equal(canRetryDelivery(delivery),expected);
  let chat!:ReturnType<typeof create>,review!:ReturnType<typeof create>;
  const onRetry=async()=>{};
  await act(async()=>{chat=create(React.createElement(ConversationEntries,{entries:[{key:'doctor:1',who:'doctor',name:'Doctor',text:approval.body,at:approvedAt,delivery:{...delivery,id:id(1)}}],locale,onRetry}));review=create(React.createElement(ConversationReview,{memberId:id(10),doctorName:'Doctor',locale,initial:{...initial,deliveries:[delivery]},ports:{read:async()=>initial,actions:async()=>({ok:false,code:'none'}),command:async()=>null,compose:async()=>null,summary:async()=>null,recover:async()=>null,retry:async()=>({ok:true,deliveryId:id(11),replayed:false})}}));});
  for(const tree of [chat,review])assert.equal(tree.root.findAllByProps({'data-delivery-retry':id(1)}).length,expected?1:0,`${locale} ${state} ${reason} ${ready}`);
  await act(async()=>{chat.unmount();review.unmount();});
 }}}
}
console.log('PASS mounted chat and review Retry eligibility for every state, hold and locale');

const {DeliveryRetry}=await import('@/components/conversation/delivery-retry');
let calls=0,release!:(result:unknown)=>void;
const pending=new Promise<unknown>(resolve=>{release=resolve;});
let tree!:ReturnType<typeof create>;
await act(async()=>{tree=create(React.createElement(DeliveryRetry,{delivery:{...base,can_retry:true},locale:'en',retry:async()=>{calls++;return pending;}}));});
await act(async()=>{const press=tree.root.findByType('button').props.onClick;press();press();});
assert.equal(calls,1,'A double press issues one request');
assert.equal(tree.root.findByType('button').props.disabled,true);
await act(async()=>release({ok:true,deliveryId:id(11),replayed:false}));
assert.ok(JSON.stringify(tree.toJSON()).includes('Retry queued'));
await act(async()=>tree.unmount());

const child={...base,id:id(11),state:'queued' as const,reason:null,retry_of:base.id,can_retry:false,approval:{...approval,id:id(12)}};
const retryPorts={read:async()=>({...initial,deliveries:[base,child]}),actions:async()=>({ok:false,code:'none'}),command:async()=>null,compose:async()=>null,summary:async()=>null,recover:async()=>null,retry:async()=>({ok:true,deliveryId:child.id,replayed:false})};
await act(async()=>{tree=create(React.createElement(ConversationReview,{memberId:id(10),doctorName:'Doctor',locale:'en',initial:{...initial,deliveries:[{...base,can_retry:true}]},ports:retryPorts}));});
await act(async()=>tree.root.findByProps({id:'conversation-reply'}).props.onChange({target:{value:'Keep my separate unsaved draft'}}));
await act(async()=>tree.root.findByProps({'data-delivery-retry':base.id}).props.onClick());
assert.equal(tree.root.findByProps({id:'conversation-reply'}).props.value,'Keep my separate unsaved draft','Retrying a previous reply retains new unsaved text');
assert.equal(tree.root.findAllByProps({'data-delivery-retry':base.id}).length,0,'Superseded original loses its retry button');
assert.ok(JSON.stringify(tree.toJSON()).includes('History'));
await act(async()=>tree.unmount());
const {memberThread}=await import('@/lib/staff-zoe/chat-v2-read');
const projected=memberThread({...initial,deliveries:[base,child]},[]);
assert.equal(projected.length,1,'A retry updates the existing reply, without duplicate text');
assert.equal(projected[0].delivery?.id,child.id);
assert.equal(projected[0].deliveryHistory?.[0].id,base.id);
const {ReplyOutcome}=await import('@/components/doctor-chat-v2/conversation');
for(const locale of ['en','hy','ru'] as const)for(const code of ['route_unavailable','approval_authority_lapsed','approval_access','stale_context','private_provider_message']){
 await act(async()=>{tree=create(React.createElement(ReplyOutcome,{status:`approval:${code}`,locale}));});
 const text=JSON.stringify(tree.toJSON());assert.ok(!text.includes(code));assert.ok(text.length>100);assert.ok(!text.includes('—'));
 await act(async()=>tree.unmount());
}
console.log('PASS retry double press, status replacement/history, retained draft and plain approval refusals');

const {staffWorkspaceSchema}=await import('@/lib/conversation-persistence/contracts');
const {ConversationRepository}=await import('@/lib/conversation-persistence/repository');
assert.ok(staffWorkspaceSchema.safeParse(initial).success,'All new workspace keys remain optional');
assert.ok(staffWorkspaceSchema.safeParse({...initial,deliveries:[child]}).success);
const rpcCalls:{name:string;args:Record<string,unknown>}[]=[];
const repo=new ConversationRepository({rpc:async(name,args)=>{rpcCalls.push({name,args});return {data:name==='conversation_retry_delivery'?{ok:true,deliveryId:child.id,replayed:true}:initial,error:null};}});
await repo.workspace(id(10));await repo.retryDelivery(base.id);
assert.deepEqual(rpcCalls.map(c=>c.name),['conversation_retry_workspace','conversation_retry_delivery']);
assert.deepEqual(rpcCalls[1].args,{p_delivery:base.id},'Retry accepts only the existing delivery identity, never replacement text');
await assert.rejects(()=>repo.retryDelivery('bad-id'));
const refused=new ConversationRepository({rpc:async()=>({data:null,error:{code:'42501',message:'Private database detail'}})});
assert.deepEqual(await refused.command({schema:1,purpose:'reply.approve',intentId:'a'.repeat(32),requestId:'b'.repeat(32)}),{ok:false,code:'approval_access'},'Transaction-level access refusal says nothing was sent, rather than unknown');
const uncertain=new ConversationRepository({rpc:async()=>{throw Error('Transport acknowledgement lost');}});
await assert.rejects(()=>uncertain.command({schema:1,purpose:'reply.approve',intentId:'a'.repeat(32),requestId:'b'.repeat(32)}),'Lost acknowledgement stays uncertain');
console.log('PASS optional workspace upgrade, exact retry RPC and definitive permission refusal versus lost acknowledgement');
