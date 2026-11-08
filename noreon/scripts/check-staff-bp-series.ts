import assert from 'node:assert/strict';
import {bpResult,buildBpSeries} from '@/lib/staff-zoe/facts';
import {toolResultSchema,savedAnswer} from '@/lib/staff-zoe/contracts';
import {checkRendered} from '@/lib/staff-zoe/check';
import {recordBlock} from '@/lib/staff-zoe/prompt';
import type {BpWeek,BpWeekRead} from '@/lib/bp-week/model';

const context={memberId:'f0000000-0000-4000-8000-000000000001',role:'doctor' as const,locale:'en' as const,now:new Date('2026-11-04T08:00:00Z')};
const reading=(measuredAt:string,systolic:number,diastolic:number,slot:'morning'|'evening'='morning')=>({id:crypto.randomUUID(),day:1,slot,systolic,diastolic,pulse:null,measuredAt});
const week=(startsOn:string,readings:BpWeek['readings']):BpWeek=>({id:crypto.randomUUID(),startsOn,days:7,readingsPerSlot:2,morningTime:'08:00',eveningTime:'20:00',reminders:false,startedByRole:'member',createdAt:startsOn+'T00:00:00Z',stoppedAt:null,stopReason:null,device:null,readings});
const read=(weeks:BpWeek[]):BpWeekRead=>({version:'bp-week-v1',enabled:true,today:'2026-11-04',currentDevice:null,weeks});
const current=week('2026-11-02',[reading('2026-11-03T16:00:00Z',128,82,'evening'),reading('2026-11-02T04:00:00Z',137,87)]);
const previous=week('2026-10-26',[reading('2026-10-27T04:00:00Z',131,81)]);
const older=week('2026-10-19',[reading('2026-10-20T04:00:00Z',150,90)]);
const input=read([previous,older,current]),before=structuredClone(input);
const card=bpResult(input,null,context);
assert.deepEqual(card.bpSeries,[
 {measuredAt:'2026-10-27T04:00:00.000Z',systolic:131,diastolic:81,slot:'morning'},
 {measuredAt:'2026-11-02T04:00:00.000Z',systolic:137,diastolic:87,slot:'morning'},
 {measuredAt:'2026-11-03T16:00:00.000Z',systolic:128,diastolic:82,slot:'evening'},
],'Only two latest BP weeks, chronological recorded pairs, without averaging');
assert.deepEqual(input,before,'The record is not reordered or modified');
assert.equal(card.facts.find(f=>/week average/.test(f.label))?.value,'133/85 mmHg','Existing facts remain unchanged');
assert.ok(toolResultSchema.safeParse(card).success);
const oldCard={...card};delete oldCard.bpSeries;
assert.ok(savedAnswer({version:'staff-zoe-1',state:'answered',say:[],quotes:[],notKnown:[],declined:false,notice:null,cards:[oldCard]}),'Old answers need no series');
assert.equal(recordBlock([card],[]),recordBlock([oldCard],[]),'Raw readings never enter the model record');
assert.equal(checkRendered([{text:'Recorded pair: 137/87 mmHg',facts:[card.facts[0]!]}],[card]).ok,false,'A plotted value cannot license a model fact');
assert.equal(bpResult(read([older,previous,{...current,readings:[]}]),null,context).bpSeries?.length,1,'An empty current week does not pull in a third week');
for(const source of [null,{version:'bp-week-v1',enabled:false} as const,read([])])assert.deepEqual(bpResult(source,null,context).bpSeries,[]);
// The upstream schema allows a string timestamp: malformed data must not break the chart or become midnight.
assert.deepEqual(buildBpSeries(read([week('2026-11-02',[reading('bad timestamp',120,80)])])),[]);
assert.ok(toolResultSchema.safeParse({...oldCard,bpSeries:[{measuredAt:'2026-11-02T04:00:00Z',systolic:120,diastolic:80}]}).success,'Slot is optional for saved/display records');
assert.deepEqual(buildBpSeries(read([week('2026-11-02',[
 reading('2026-11-02T08:00:00Z',122,82),reading('2026-11-02T10:00:00+04:00',120,80),
])])).map(p=>p.measuredAt),['2026-11-02T06:00:00.000Z','2026-11-02T08:00:00.000Z'],'Offset timestamps are ordered by instant');
console.log('Staff BP series: two-week scope, exact values, ordering, empty/off/failed data, old answers and model boundary passed.');
