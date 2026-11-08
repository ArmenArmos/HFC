import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {NurseChatVisitList} from '@/components/staff/nurse-chat-visit-list';
import type {NurseVisitList} from '@/lib/nurse-visit/schema';
const id=(n:number)=>`aa110000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const row={source:'appointment' as const,id:id(1),memberId:id(2),memberName:'Fictional member',arrangementToken:id(3),startsAt:'2026-11-01T08:00:00Z',endsAt:null,mode:'clinic' as const,location:null,bookingStatus:'confirmed' as const,completion:null,samplesPlanned:1,samplesTaken:0,openItems:2,steps:[],nurseName:null};
const list:NurseVisitList={version:'nurse-visit-v1',enabled:true,today:'2026-11-01',role:'nurse',visits:[row,{...row,id:id(3),startsAt:'2026-10-31T08:00:00Z'},{...row,id:id(4),startsAt:'2026-11-02T08:00:00Z'},{...row,id:id(5),completion:{completedAt:'2026-11-01T09:00:00Z',nurseName:'Fictional nurse',summary:{samplesPlanned:1,samplesTaken:1,bpTaken:false,deviceDone:null,openItems:[]}}}]};
for(const locale of ['en','hy','ru'] as const){
 const html=renderToStaticMarkup(React.createElement(NurseChatVisitList,{list,locale}));
 assert.equal((html.match(/data-visit-group=/g)||[]).length,4,'All four time groups are reachable');
 assert.equal((html.match(/data-visit-link=/g)||[]).length,4);
 assert.ok(html.includes('/staff/real/nurse-chat?member='));
 assert.ok(!html.includes('/staff/real/visits/'),'Opening a visit stays in chat');
 assert.ok(html.includes('Fictional member'));
}
for(const state of [null,{version:'nurse-visit-v1',enabled:false,visits:[]},{...list,visits:[]}] as (NurseVisitList|null)[]){
 const html=renderToStaticMarkup(React.createElement(NurseChatVisitList,{list:state,locale:'en'}));
 assert.ok(/role="(status|alert)"/.test(html),'Unavailable, disabled and empty states remain explicit');
}
console.log('Nurse visit list: all time groups, chat links, en/hy/ru and empty/off/unavailable states passed.');
