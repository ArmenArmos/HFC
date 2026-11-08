import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ProgressRings} from '@/components/patient-care/progress-rings';
import {ProgrammeJourneyCard,ProgrammeTimeline} from '@/components/patient/programme-timeline';
import {RecentReadings,PressureDetailSummary} from '@/components/patient-care/pressure-detail-summary';
import {journeyStages} from '@/lib/programme/stages';
import {memberTimelineSchema} from '@/lib/programme/schema';
import type {Measurement} from '@/lib/patient/types';
// Progress in the prototype's style (pairs 11, 12, 20) keeps the honesty rules: reading counts have
// no denominator, empty days stay empty, no targets or status colours, a text alternative for every
// drawing, and the journey shows exactly one "you are here".
const days=['2026-10-12','2026-10-13','2026-10-14','2026-10-15','2026-10-16','2026-10-17','2026-10-18'].map((day,i)=>({day,count:i===2?0:i%3}));
for(const locale of ['en','hy'] as const){
 const html=renderToStaticMarkup(createElement(ProgressRings,{locale,readings:5,days,taken:0,doses:0}));
 const reading=html.match(/<a\b[^>]*href="\/patient\/health"[^>]*>([\s\S]*?)<\/a>/)![1];
 assert.ok(!reading.includes('<circle'),'reading count is never a ring');
 assert.ok(!/\bof 7\b|7-ից/.test(html),'no 7-day denominator for readings');
 assert.equal((reading.match(/data-measured/g)??[]).length,days.filter(d=>d.count>0).length,'only days with readings are filled');
 assert.equal((reading.match(locale==='en'?/no reading/g:/չափում չկա/g)??[]).length,days.filter(d=>!d.count).length,'each empty day is read out as empty, never normal');
 assert.ok(!html.includes('stroke-dasharray'),'no doses: no medicine segment');
}
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const programme=memberTimelineSchema.parse({version:'programme-v1',enabled:true,today:'2026-01-20',schedulePending:true,opensDaysBefore:3,startedAt:'2026-01-10T09:00:00Z',
 checkpoints:(['week4_review','month3','month6'] as const).map((kind,i)=>({id:id(i+1),kind,dueOn:['2026-02-08','2026-04-11','2026-07-11'][i],state:'scheduled',openedAt:null,completedAt:null,outcome:null,doctorNote:null,checkin:null}))});
if(!programme.enabled)throw Error('fixture');
const stages=journeyStages({questionnaireComplete:true,lab:'results-received',testsArranged:true,planPublishedAt:null,programme});
for(const locale of ['en','hy'] as const){
 const card=renderToStaticMarkup(createElement(ProgrammeJourneyCard,{stages,locale}));
 assert.equal((card.match(/<li /g)??[]).length,5,'five-stage strip');
 assert.equal((card.match(/aria-current="step"/g)??[]).length,1,'one current stage on the strip');
 assert.ok(card.includes('href="#programme-timeline-title"'));
 const tl=renderToStaticMarkup(createElement(ProgrammeTimeline,{stages,schedulePending:true,locale,submit:async()=>({status:'off' as const})}));
 assert.deepEqual([...tl.matchAll(/data-group="([a-z]+)"/g)].map(m=>m[1]),['start','decide','checkins']);
 assert.equal((tl.match(/data-stage=/g)??[]).length,stages.length,'every stage appears once');
 assert.equal((tl.match(/aria-current="step"/g)??[]).length,1,'exactly one you-are-here');
 assert.ok(tl.includes(locale==='en'?'Urgent care never waits for a planned step.':'Շտապ օգնությունը երբեք չի սպասում'),'urgent help never waits for a planned step');
 assert.ok(!tl.includes('href="tel:103"'),'the header pill is the one 103 button (Khikar, 18 Oct 22:57)');
 assert.ok(tl.includes('id="programme-timeline-title"'),'Home card anchor still resolves');
 for(const kind of ['week4_review','month3','month6']){const li=tl.slice(tl.indexOf(`data-stage="${kind}"`));const head=li.slice(0,li.indexOf('</h4>')+400);assert.ok(head.includes('data-actor="you"')&&head.includes('data-actor="doctor"'),`${kind}: the member has a check-in, so You and Your doctor`);}
}
const now=new Date('2026-10-18T10:00:00Z');
const m=(i:number,at:string,pulse?:number):Measurement=>({id:`m${i}`,submissionId:`s${i}`,source:'manual',systolic:130+i,diastolic:80,measuredAt:at,...(pulse?{pulse}:{})} as Measurement);
const rows=[m(1,'2026-10-11T08:00:00Z'),m(2,'2026-10-12T08:00:00Z',70),m(3,'2026-10-13T08:00:00Z'),m(4,'2026-10-14T08:00:00Z'),m(5,'2026-10-15T08:00:00Z'),m(6,'2026-10-16T08:00:00Z'),m(9,'2026-10-19T08:00:00Z')];
for(const locale of ['en','hy'] as const){
 const recent=renderToStaticMarkup(createElement(RecentReadings,{measurements:rows,locale,now}));
 assert.equal((recent.match(/<li /g)??[]).length,5,'five most recent');
 assert.ok(!recent.includes('139/80'),'a future reading is never listed');
 assert.ok(recent.indexOf('136/80')<recent.indexOf('135/80'),'newest first');
 assert.ok(!recent.includes('131/80'),'only five');
 const sum=renderToStaticMarkup(createElement(PressureDetailSummary,{measurements:rows,locale,now}));
 assert.ok(!/target|թիրախ/i.test(sum.replace(/treatment goals|բուժման նպատակները/gi,'')),'no target on the summary');
 assert.equal(renderToStaticMarkup(createElement(RecentReadings,{measurements:[],locale,now})),'');
}
console.log('Progress prototype alignment: counts without denominators, empty days visible, grouped journey with one you-are-here, recent readings past-only.');
