import assert from 'node:assert/strict';
import {cardSchema,doseItem} from '@/lib/zoe-chat-actions/registry';
import {cardTurns,dialogThread,mergeCards} from '@/lib/zoe-chat-actions/thread';

const slot={medicineId:crypto.randomUUID(),planId:crypto.randomUUID(),name:'Rosuvastatin',dose:'20 mg',dueAt:'2026-11-02T16:00:00Z',time:'20:00',status:'due',revision:0};
const raw={id:crypto.randomUUID(),requestId:crypto.randomUUID(),kind:'dose',source:'chip',sourceSeq:null,state:'done',outcome:{[doseItem(slot)]:{status:'skipped',doneAt:'2026-11-02T16:10:00Z'}},at:'2026-11-02T16:00:00Z',snapshot:{v:1,v3:true,enabled:true,date:'2026-11-02',slots:[slot]}};
const card=cardSchema.parse(raw);
assert.equal(card.valid,true,'A confirmed-plan reminder parses');
assert.deepEqual(cardTurns(card),[{item:doseItem(slot),at:'2026-11-02T16:10:00Z',said:false}]);
const thread=dialogThread([{kind:'member',key:'m1',text:'My question',at:'2026-11-02T16:05:00Z',channel:'app',requestId:crypto.randomUUID()}],[card]);
assert.equal(thread.at(-1)?.type,'turn','The dose answer is newest, even from an older card');
assert.equal(thread.some(e=>e.type==='card'),false,'The used form leaves its old place');
assert.equal(cardTurns(cardSchema.parse({...raw,snapshot:{...raw.snapshot,v3:undefined}})).length,0,'Legacy dose cards keep their ordering');
const justPosted=cardSchema.parse({...raw,id:crypto.randomUUID(),state:'open',outcome:{},at:new Date().toISOString()});
const read={enabled:true,cards:[justPosted,card],clearedSeq:null};
assert.deepEqual(mergeCards(read,{...read,cards:[card]}).cards,[card],'An authoritative poll removes a superseded reminder even within the new-card grace period, preserving completed history');
console.log('V3 dose dialog: exact snapshot, action time and legacy isolation passed');
