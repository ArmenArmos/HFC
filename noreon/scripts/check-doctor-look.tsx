import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {doctorGreeting,HomeMemberHeader,HomeGlance} from '@/components/staff/doctor-workspace/home-presentation';
import {DaySummary,dayStatus} from '@/components/staff/doctor-workspace/day-cards';
import type {ToolResult} from '@/lib/staff-zoe/contracts';
import {readDoctorDay} from '@/lib/doctor-inbox/day';
import {sourceData,at,task,member,other} from './doctor-chat-home-fixture';
const rpc={async rpc(name:string){return {data:sourceData[name],error:null};}};
const day=await readDoctorDay(rpc,true,new Date(at));
const empty={...day,windows:[],urgentWindowsTotal:0,urgentCapped:false,inbox:{...day.inbox,p0:[],p0Total:0,items:[],unavailable:[]},firstNotes:{version:'first-note-queue-v1' as const,enabled:true,items:[],closed:[]},ldl:[],medicines:[],tasks:{items:[],hasMore:false}};
for(const locale of ['en','hy','ru'] as const){
 const greeting=doctorGreeting(locale,'Dr Fictional Hayk','2026-10-31T21:30:00Z');
 assert.ok(!greeting.name.includes('Dr. Dr'));
 assert.match(greeting.date,/1|նոյ|ноя/);
 const html=renderToStaticMarkup(<DaySummary day={empty} locale={locale}/>);
 assert.ok(html.includes('zk-from')&&html.includes('zk-bubble'),'Summary is a Zoe turn');
 assert.ok(!html.includes('Waiting: 0'),'No counts line');
}
assert.match(doctorGreeting('en','Dr Fictional Hayk','2026-10-31T05:00:00Z').name,/Good morning, Dr Fictional Hayk/);
assert.match(doctorGreeting('en','Ani Petrosyan','2026-10-31T13:00:00Z').name,/Good afternoon, Dr\. Ani Petrosyan/);
assert.match(doctorGreeting('en','Ani','2026-10-31T17:00:00Z').name,/Good evening/);
const windows=[member,other].map(memberId=>({memberId,memberName:'Fictional member',since:at,openedBy:'rule' as const}));
const sparse=renderToStaticMarkup(<DaySummary day={{...empty,windows,urgentWindowsTotal:2,handoffs:{items:[],hasMore:false}}} locale="en"/>);
assert.match(sparse,/2 urgent items/,'The summary counts actionable rows, including windows without care alerts');
assert.doesNotMatch(sparse,/>[^<]*\b0\b[^<]*</,'Only waiting work is included in the summary');
const summary=renderToStaticMarkup(<DaySummary day={empty} locale="en"/>);
assert.match(summary,/nothing needs your decision/i);
const failed=renderToStaticMarkup(<DaySummary day={{...empty,ldl:null}} locale="en"/>);
assert.doesNotMatch(failed,/nothing needs your decision/i);
assert.match(failed,/Some sources are unavailable/);
const handoffDay:typeof day={...empty,handoffs:{items:[{messageId:'handoff-message',messageText:'Fictional message',topic:'other',observation:'Saved observation',nurseName:'Fictional nurse',task:{...task,kind:'contact-followup',status:'open',events:[]}}],hasMore:false}};
const withHandoffs=renderToStaticMarkup(<DaySummary day={handoffDay} locale="en"/>);
assert.equal(dayStatus(handoffDay,'en').counts.total,1);
assert.match(withHandoffs,/Open nurse handoffs: 1/);
assert.match(withHandoffs,/zk-bubble/,'Handoff counts keep the conversation look');
const unavailableHandoffs={...empty,handoffs:null};
assert.ok(dayStatus(unavailableHandoffs,'en').missing.includes('handoffs'));
const handoffFailure=renderToStaticMarkup(<DaySummary day={unavailableHandoffs} locale="en"/>);
assert.match(handoffFailure,/Some sources are unavailable/);
assert.doesNotMatch(handoffFailure,/nothing needs your decision/i);
assert.doesNotMatch(summary,/Open nurse handoffs/,'Disabled handoffs stay absent');
const result=(tool:ToolResult['tool'],facts:ToolResult['facts']=[],state:ToolResult['state']='ok'):ToolResult=>({tool,state,facts,quotes:[],missing:[],href:'/staff/real/members'});
const fact=(id:string,label:string,value:string)=>({id,label,value,date:'2026-10-31',mark:null,href:null,analyte:null});
const records=[result('ldl',[fact('ldl.1','Index event','Heart attack'),fact('ldl.2','LDL goal','< 1.8 mmol/L'),{...fact('ldl.3','Latest reviewed LDL','2.3 mmol/L'),mark:'not_reviewed' as const}]),result('bp',[], 'unavailable'),result('adherence',[], 'off'),result('plan',[], 'none')];
const glance=renderToStaticMarkup(<HomeGlance records={records} locale="en" reference="ABC" asOf={at}/>);
assert.match(glance,/2.3 mmol\/L/);assert.match(glance,/Not reviewed/);
assert.doesNotMatch(glance.split('<details')[0],/CV risk|Heart attack/,'No fabricated risk or index event as LDL');
assert.match(glance,/Could not be read/);assert.match(glance,/Switched off/);
const header=renderToStaticMarkup(<HomeMemberHeader member={{id:'member',name:'Recorded member',birthYear:1970,sex:null}} locale="en"/>);
assert.match(header,/Recorded member/);assert.doesNotMatch(header,/Risk pending/);assert.doesNotMatch(header,/No plan yet|Change member|Open record/,'Member header is identity only');
console.log('Doctor look: localized Yerevan greetings, truthful empty/failure prose, exact LDL selection, omitted CV risk and selected header passed');

// Use the production fact builders to catch drift between translated reader labels and the tiles.
const {fixtureRead}=await import('@/lib/staff-zoe/fixture-tools');
const {FICTIONAL_RECORDS,MEMBER_A,EVAL_NOW}=await import('@/lib/staff-zoe/eval/fixtures');
for(const locale of ['en','hy','ru'] as const){
 const reads=await Promise.all((['overview','bp','ldl','plan','adherence','visits','open_items'] as const).map(tool=>fixtureRead(FICTIONAL_RECORDS[MEMBER_A]!,tool,'doctor',locale,EVAL_NOW)));
 const html=renderToStaticMarkup(<HomeGlance records={reads} locale={locale} reference="A" asOf={EVAL_NOW.toISOString()}/>).split('<details')[0];
 assert.ok(html.includes(({en:'mmHg',hy:'մմ ս.ս.',ru:'мм рт. ст.'})[locale]),'The actual localized BP read appears');
 assert.ok(!html.includes('DRAFT ONLY')&&!html.includes('PRIVATE'),'Private drafts never appear in the glance');
 assert.ok(html.includes(({en:'mmol/L',hy:'մմոլ/լ',ru:'ммоль/л'})[locale]),'The actual localized LDL value appears');
 assert.ok(html.includes('Atorvastatin'),'The prescribed medicine is preserved in every locale');
 assert.ok(!html.includes('Could not be read'));
}
console.log('Doctor tiles consume actual production fact builders in English, Armenian and Russian');
const upcoming=renderToStaticMarkup(<HomeGlance records={[result('visits',[
 {...fact('visits.1','Nurse visit','home, confirmed'),date:'2026-11-02'},
 {...fact('visits.2','Nurse visit','clinic, completed'),date:'2026-11-03'},
 {...fact('visits.3','Nurse visit','office, confirmed'),date:'2026-10-01'},
]),result('ldl',[
 {...fact('ldl.1','Next LDL test set for','2026-10-01'),date:'2026-10-01'},
])]} locale="en" reference="A" asOf={at}/>).split('<details')[0];
assert.match(upcoming,/home, confirmed/);
assert.doesNotMatch(upcoming,/clinic, completed|office, confirmed|2026-10-01/,'Coming up excludes past and completed records');
console.log('Coming up excludes past follow-ups and completed visits');
for(const bpWeek of [null,{...FICTIONAL_RECORDS[MEMBER_A]!.bpWeek!,enabled:false as const,weeks:[]}]){
 const read=await fixtureRead({...FICTIONAL_RECORDS[MEMBER_A]!,bpWeek},'bp','doctor','en',EVAL_NOW);
 assert.equal(read.state,'ok','Other BP facts remain available');
 const html=renderToStaticMarkup(<HomeGlance records={[read]} locale="en" reference="A" asOf={at}/>).split('<details')[0];
 assert.ok(html.includes(bpWeek?'Home BP weeks are switched off':'Home BP weeks could not be read'),'Partial failed/disabled home-BP reads cannot become empty history');
}
