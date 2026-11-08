import assert from 'node:assert/strict';
import {chatReportedFacts,withChatFacts} from '@/lib/staff-zoe/chat-reported';
import type {Quote,ToolResult} from '@/lib/staff-zoe/contracts';

const q=(text:string,over:Partial<Quote>={}):Quote=>({id:'member_messages.1',text,date:'2026-11-03',at:'2026-11-03T08:00:00Z',flagged:false,...over});
const one=(text:string,over:Partial<Quote>={})=>chatReportedFacts([q(text,over)],'en');

// Blood pressure the member wrote: a plausible pair, marked member reported, never a saved reading.
{
 const r=one('Good morning, my pressure today is 150/95 and I feel ok');
 assert.equal(r.bp.length,1);assert.equal(r.bp[0].value,'150/95 mmHg');assert.equal(r.bp[0].mark,'member_reported');assert.equal(r.bp[0].date,'2026-11-03');
 assert.match(r.bp[0].label,/Member-reported, not verified/);assert.match(r.bp[0].id,/^bp\.\d+$/);
 assert.equal(one('давление 140 на 90').bp[0].value,'140/90 mmHg');
 for(const text of ['visit on 12/05','date 2026/11/03','ratio 300/20','tablet 5/10 mg','time 14:30/15:30','version 1.2/3.4','100/95 and 5000/80'])assert.equal(one(text).bp.length,0,text);
 assert.equal(chatReportedFacts([q('125/80',{flagged:true})],'en').bp.length,0,'A flagged message is not read');
 assert.equal(chatReportedFacts([q('125/80',{nurseName:'Nurse'}),q('125/80',{zoe:true})],'en').bp.length,0,'Only the member words count');
 const many=chatReportedFacts([1,2,3,4,5].map(n=>q(`bp 1${n}0/80`,{at:`2026-11-0${n}T08:00:00Z`,date:`2026-11-0${n}`})),'en');
 assert.deepEqual(many.bp.map(f=>f.value),['150/80 mmHg','140/80 mmHg','130/80 mmHg'],'Newest first, at most three');
}
// Medicines the member named: a fixed list, a dose when written, never when the sentence says she does not take it.
{
 const r=one('I take amlodipine 5 mg every morning. And atorvastatin at night');
 assert.deepEqual(r.medicines.map(f=>f.value),['amlodipine 5 mg','atorvastatin']);assert.ok(r.medicines.every(f=>f.mark==='member_reported'&&/^adherence\.\d+$/.test(f.id)));
 assert.match(r.medicines[0].label,/member-reported, not a confirmed prescription/);
 assert.equal(one('Принимаю амлодипин 10 мг утром').medicines[0].value,'amlodipine 10 mg');
 for(const text of ['I stopped losartan last week','I do not take bisoprolol','never took aspirin','не принимаю лозартан','перестал пить аторвастатин','I read about candesartan in a magazine and not for me'])assert.equal(one(text).medicines.length,0,text);
 assert.equal(one('my mother takes vitamin d').medicines.length,0,'A name outside the list is not read');
 assert.equal(chatReportedFacts([q('amlodipine 5 mg',{at:'2026-11-01T08:00:00Z'}),q('amlodipine 10 mg',{at:'2026-11-03T08:00:00Z'})],'en').medicines.map(f=>f.value).join(),'amlodipine 10 mg','The newest message names the dose, once');
}
// LDL the member wrote: a plausible value with its unit, newest first, never invented.
{
 assert.equal(one('my LDL was 3.4 mmol/L last week').ldl[0].value,'3.4 mmol/L');assert.equal(one('my LDL was 3.4 mmol/L last week').ldl[0].mark,'member_reported');assert.match(one('LDL 3.4 mmol/L').ldl[0].label,/member-reported, not verified/);
 assert.equal(one('ЛПНП 2,8 ммоль/л').ldl[0].value,'2.8 mmol/L');assert.equal(one('LDL is 130 mg/dL').ldl[0].value,'130 mg/dL');
 for(const text of ['LDL 99 mmol/L','LDL 3.4','LDL','cholesterol 5.1 mmol/L','LDL 5 mg/dL','HDL 1.2 mmol/L'])assert.equal(one(text).ldl.length,0,text);
 assert.equal(chatReportedFacts([q('LDL 3.4 mmol/L',{flagged:true})],'en').ldl.length,0);
}
// Adding to a card: "nothing recorded" becomes ok; an unavailable read stays unavailable but still shows what she wrote.
{
 const card=(state:ToolResult['state']):ToolResult=>({tool:'bp',state,facts:[],quotes:[],missing:[],href:'/staff/real/members/x'});
 const facts=one('150/95').bp;
 assert.equal(withChatFacts(card('none'),facts).state,'ok');assert.equal(withChatFacts(card('unavailable'),facts).state,'unavailable');assert.equal(withChatFacts(card('unavailable'),facts).facts.length,1);
 assert.equal(withChatFacts(card('none'),[]).state,'none','Nothing written, nothing changed');
}
console.log('Nurse chat-reported facts: pressure pairs, fixed medicine list, negation, flagged and non-member text, newest first, card states passed.');
