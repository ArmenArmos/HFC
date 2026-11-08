import assert from 'node:assert/strict';
import {openCard} from '@/lib/zoe-chat-actions/commands';
import {mintActor} from '@/lib/zoe-chat-actions/actor';
import {cardSchema,type ZoeCard} from '@/lib/zoe-chat-actions/registry';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const actor=mintActor(id(1),'app');
for(const kind of ['visit','medicines','account','menu','plan','bp'] as const){
 const snapshot=kind==='plan'?{v:1,available:true,plan:null}:kind==='bp'?{v:1,week:null}:kind==='visit'?{v:1,available:true,next:null,proposal:null,attention:false,bookingToken:'a'.repeat(64)}:{v:1,token:'a'.repeat(64),...(kind==='menu'?{view:'earlier'}:{})};
 const card=(n:number,over:Record<string,unknown>={})=>cardSchema.parse({id:id(n),requestId:id(n+100),kind,source:'chip',sourceSeq:null,state:'open',claims:{},outcome:{},snapshot,at:`2026-11-01T10:00:0${n}Z`,...over});
 let cards:ZoeCard[]=[card(3),card(2)],posts=0;
 const ports={snapshot:async()=>snapshot,readCards:async()=>({enabled:true,cards,clearedSeq:null}),post:async()=>{posts++;return {ok:true as const,card:card(9),replayed:false};}};
 const input={requestId:id(30),kind,sourceSeq:null,reuseCurrent:true};
 if(kind==='menu')cards.push(card(4,{snapshot:{...snapshot,view:'help'}}));
 const result=await openCard(actor,ports,input);
 assert.equal(result.card?.id,id(3),`${kind}: newest current open card is reused regardless of array order`);
 assert.equal(posts,0);
 assert.equal((await openCard(actor,ports,{...input,requestId:id(31)})).card?.id,id(3),'A reload with another request id creates nothing');
 cards=[card(2),card(3,{snapshot:kind==='plan'?{...snapshot,available:false}:kind==='bp'?{...snapshot,latest:{systolic:125,diastolic:80,pulse:null,measuredAt:'2026-11-01T09:00:00Z'}}:kind==='visit'?{...snapshot,attention:true}:{...snapshot,token:'b'.repeat(64)}})];
 await openCard(actor,ports,input);assert.equal(posts,1,'A stale newest open card causes a fresh post, not fallback to an older match');
 cards=[card(3,{state:'done',outcome:{[kind]:{status:'saved'}}})];
 await openCard(actor,ports,input);assert.equal(posts,2,'A completed choice is never reopened');
 cards=[card(3)];
 await openCard(actor,ports,{...input,sourceSeq:4});assert.equal(posts,3,'Typed offers retain the pipeline post checks');
 await openCard(mintActor(id(1),'telegram'),ports,input);assert.equal(posts,4,'App page reuse does not change Telegram opens');
 await openCard(actor,ports,{requestId:id(33),kind,sourceSeq:null});assert.equal(posts,5,'Explicit Show current recovery posts a new card even when the old snapshot still matches');
}
console.log('Page card reopen: visit, medicines, account, everyday menu, plan, BP; newest open/current only, reload, stale, done, typed and Telegram boundaries. In-memory IO.');

// A generic menu is not an everyday view and must keep its ordinary posting behavior.
{
 let posts=0;
 const snapshot={v:1};
 const card=cardSchema.parse({id:id(1),requestId:id(2),kind:'menu',source:'chip',sourceSeq:null,state:'open',claims:{},outcome:{},snapshot,at:'2026-11-01T10:00:00Z'});
 const ports={snapshot:async()=>snapshot,readCards:async()=>({enabled:true,cards:[card],clearedSeq:null}),post:async()=>{posts++;return {ok:true as const,card,replayed:false};}};
 await openCard(actor,ports,{requestId:id(30),kind:'menu',sourceSeq:null,reuseCurrent:true});
 assert.equal(posts,1,'The generic menu does not reuse an everyday card');
}
