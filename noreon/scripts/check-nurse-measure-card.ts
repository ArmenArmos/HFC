// A reading typed in the chat becomes a card; only Save writes it, into the member's open nurse visit as a measurement mark
// (lib/nurse-chat/measure-card.ts). No visit, a visit not yet due, an item already recorded or a lost answer never write twice or wrongly.
import assert from 'node:assert/strict';
import {prepareMeasureCard,saveMeasureCard,measureValueLabel,type MeasureIo} from '@/lib/nurse-chat/measure-card';

const member={id:'aa110000-0000-4000-8000-000000000001',name:'Ani Example'};
const visit=(id:string,startsAt:string,over:Record<string,unknown>={})=>({memberId:member.id,source:'home-request',id,startsAt,completion:null,...over});
type Marks=Parameters<MeasureIo['mark']>[0][];
function io(opts:{visits?:unknown[];today?:string;listStatus?:string;items?:unknown[];detail?:unknown;results?:unknown[];throwMark?:boolean}={}){
 const marks:Marks=[];let n=0;const results=[...(opts.results??[])];
 const api:MeasureIo={
  readVisits:async()=>opts.listStatus?{status:opts.listStatus}:{status:'ready',data:{version:'nurse-visit-v1',enabled:true,today:opts.today??'2026-11-04',role:'nurse',visits:opts.visits??[visit('v1','2026-11-04T08:00:00Z')]} as never},
  readVisit:async()=>(opts.detail as never)??({enabled:true,visit:{completion:null},items:opts.items??[{key:'measure:bp',kind:'measurement',field:'bp',mark:null},{key:'measure:weight',kind:'measurement',field:'weight',mark:null},{key:'measure:waist',kind:'measurement',field:'waist',mark:null}]} as never),
  mark:async command=>{marks.push(command);if(opts.throwMark)throw new Error('lost');return (results.shift()??{status:'saved',markId:'11111111-1111-4111-8111-111111111111',submissionId:command.submissionId,replayed:false}) as never;},
  newId:()=>`00000000-0000-4000-8000-${String(++n).padStart(12,'0')}`,
 };
 return {api,marks};
}
const bp=[{field:'bp' as const,text:'148/93 72'}];

// A reading with an open visit today becomes a confirm card and writes nothing.
{
 const {api,marks}=io();
 const card=await prepareMeasureCard(api,member,[...bp,{field:'weight',text:'82'}],'en');
 assert.ok('state' in card&&card.state==='confirm');if(!('state' in card))throw 0;
 assert.deepEqual(card.visit,{source:'home-request',id:'v1',startsAt:'2026-11-04T08:00:00Z'});
 assert.equal(measureValueLabel('bp',card.entries[0]!.values,'en'),'148/93 mmHg · Pulse 72');assert.equal(measureValueLabel('weight',card.entries[1]!.values,'en'),'82 kg');
 assert.equal(marks.length,0,'Preparing a card writes nothing');
 // Save writes one mark per reading, with the visit flow's command and distinct submission ids.
 const saved=await saveMeasureCard(api,card,'en');
 assert.equal(saved.state,'saved');assert.equal(marks.length,2);
 assert.deepEqual(marks.map(m=>m.item),['measure:bp','measure:weight']);assert.equal(new Set(marks.map(m=>m.submissionId)).size,2);
 assert.deepEqual(marks[0],{version:'nurse-visit-v1',memberId:member.id,source:'home-request',sourceId:'v1',submissionId:marks[0]!.submissionId,startsAt:'2026-11-04T08:00:00Z',item:'measure:bp',done:true,note:null,values:{systolic:148,diastolic:93,pulse:72},expectUnmarked:true});
 assert.deepEqual(marks[1]!.values,{value:82});
 // A second press on a saved card writes nothing.
 assert.equal((await saveMeasureCard(api,saved,'en')).state,'saved');assert.equal(marks.length,2);
}
// Out-of-range values are an error line, not a card.
{const {api}=io();const bad=await prepareMeasureCard(api,member,[{field:'bp',text:'93/148'}],'en');assert.ok('error' in bad&&Boolean(bad.error));
 const weird=await prepareMeasureCard(api,member,[{field:'weight',text:'8'}],'en');assert.ok('error' in weird);}
// No visit, completed visit only, not yet due, unreadable.
{
 assert.equal(((await prepareMeasureCard(io({visits:[]}).api,member,bp,'en')) as {state:string}).state,'no-visit');
 assert.equal(((await prepareMeasureCard(io({visits:[visit('v1','2026-11-04T08:00:00Z',{completion:{completedAt:'2026-11-04T09:00:00Z'}})]}).api,member,bp,'en')) as {state:string}).state,'no-visit','A completed visit is not open');
 assert.equal(((await prepareMeasureCard(io({visits:[visit('v1','2026-11-04T08:00:00Z',{memberId:'bb110000-0000-4000-8000-000000000009'})]}).api,member,bp,'en')) as {state:string}).state,'no-visit','Another member\'s visit is never used');
 const early=await prepareMeasureCard(io({visits:[visit('v2','2026-11-06T08:00:00Z')]}).api,member,bp,'en') as {state:string;nextDay?:string};
 assert.deepEqual([early.state,early.nextDay],['not-today','2026-11-06'],'A visit on a later day takes readings on that day');
 assert.equal(((await prepareMeasureCard(io({listStatus:'unavailable'}).api,member,bp,'en')) as {state:string}).state,'unavailable');
 assert.equal(((await prepareMeasureCard(io({detail:'unavailable'}).api,member,bp,'en')) as {state:string}).state,'unavailable');
 // Past visit still open counts (the nurse is running late); the latest started one wins over an older one.
 const two=io({visits:[visit('old','2026-11-02T08:00:00Z'),visit('now','2026-11-04T02:00:00Z'),visit('later','2026-11-06T08:00:00Z')]});
 const card=await prepareMeasureCard(two.api,member,bp,'en') as {visit:{id:string}};assert.equal(card.visit.id,'now');
}
// An item that is missing from the visit, or already recorded, cannot be saved.
{
 assert.equal(((await prepareMeasureCard(io({items:[{key:'measure:weight',kind:'measurement',field:'weight',mark:null}]}).api,member,bp,'en')) as {state:string}).state,'no-item');
 const {api,marks}=io({items:[{key:'measure:bp',kind:'measurement',field:'bp',mark:{done:true,values:{systolic:120,diastolic:80,pulse:null}}}]});
 const card=await prepareMeasureCard(api,member,bp,'en') as {state:string};assert.equal(card.state,'recorded');
 assert.equal((await saveMeasureCard(api,card as never,'en')).state,'recorded');assert.equal(marks.length,0,'A recorded item is not overwritten');
}
// A lost answer is "unsure": repeating the press resends the same submission ids, and a reading that already saved is not resent.
{
 const {api,marks}=io({results:[{status:'outcome-unknown'}]});
 const card=await prepareMeasureCard(api,member,[...bp,{field:'weight',text:'82'}],'en') as never;
 const first=await saveMeasureCard(api,card,'en');assert.equal(first.state,'unsure');assert.equal(marks.length,1);
 const second=await saveMeasureCard(api,first,'en');assert.equal(second.state,'saved');
 assert.equal(marks[1]!.submissionId,marks[0]!.submissionId,'The retry reuses the submission id');assert.equal(marks.length,3);
 const thrown=io({throwMark:true});const c2=await prepareMeasureCard(thrown.api,member,bp,'en') as never;assert.equal((await saveMeasureCard(thrown.api,c2,'en')).state,'unsure');
}
// A refusal stops the rest and says why; nothing after it is written.
{
 const {api,marks}=io({results:[{status:'too-early'}]});
 const card=await prepareMeasureCard(api,member,[...bp,{field:'weight',text:'82'}],'en') as never;
 const refused=await saveMeasureCard(api,card,'en');assert.equal(refused.state,'error');assert.ok(refused.error&&refused.error.length>0);assert.equal(marks.length,1,'Nothing after a refusal is written');
}
// Stale cards: an item marked after the card was prepared is never replaced; a completed visit is not written to.
{
 const first=io();const card=await prepareMeasureCard(first.api,member,bp,'en') as never;
 const marked=io({detail:{enabled:true,visit:{completion:null},items:[{key:'measure:bp',kind:'measurement',field:'bp',mark:{done:true,values:{systolic:120,diastolic:80,pulse:null}}}]}});
 const stale=await saveMeasureCard(marked.api,card,'en');assert.equal(stale.state,'recorded');assert.equal(marked.marks.length,0,'A reading saved elsewhere since the card was prepared is not replaced');
 const done=io({detail:{enabled:true,visit:{completion:{completedAt:'x'}},items:[{key:'measure:bp',kind:'measurement',field:'bp',mark:null}]}});
 assert.equal((await saveMeasureCard(done.api,card,'en')).state,'no-visit');assert.equal(done.marks.length,0);
 const unread=io({detail:'unavailable'});assert.equal((await saveMeasureCard(unread.api,card,'en')).state,'unavailable');assert.equal(unread.marks.length,0,'If the visit cannot be checked nothing is written');
 // Two cards for the same item: the second one finds the first one's mark and writes nothing.
 const shared=io();const a=await prepareMeasureCard(shared.api,member,bp,'en') as never,b=await prepareMeasureCard(shared.api,member,[{field:'bp',text:'150/95'}],'en') as never;
 assert.equal((await saveMeasureCard(shared.api,a,'en')).state,'saved');assert.equal(shared.marks.length,1);
}
// A partial save is shown as such: the saved entry stays marked, the refused one is not, and a retry resends only the rest.
{
 const {api,marks}=io({results:[undefined,{status:'too-early'},undefined]});
 const card=await prepareMeasureCard(api,member,[...bp,{field:'weight',text:'82'}],'en') as never;
 const partial=await saveMeasureCard(api,card,'en');assert.equal(partial.state,'error');assert.deepEqual(partial.entries.map(e=>[e.saved,e.attempted]),[[true,true],[false,true]]);
 const retried=await saveMeasureCard(api,partial,'en');assert.equal(marks.filter(m=>m.item==='measure:bp').length,1,'The saved reading is not resent');assert.equal(retried.state,'saved');
}
// The database refuses a reading whose item was marked after the check (another tab): nothing is claimed saved, the rest is not written.
{
 const {api,marks}=io({results:[{status:'saved',markId:'11111111-1111-4111-8111-111111111111',submissionId:'x',replayed:false},{status:'already-marked'}]});
 const card=await prepareMeasureCard(api,member,[...bp,{field:'weight',text:'82'},{field:'waist',text:'98'}],'en') as never;
 const result=await saveMeasureCard(api,card,'en');assert.equal(result.state,'recorded');assert.deepEqual(result.entries.map(e=>e.saved),[true,false,false]);assert.equal(marks.length,2,'Nothing after the refused reading is written');
 assert.ok(marks.every(m=>m.expectUnmarked===true),'Every write carries the precondition');
}
console.log('Nurse reading card: prepare writes nothing; Save writes visit measurement marks once; no visit, not due, recorded, lost answer and refusal are handled.');
