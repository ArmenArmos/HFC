import assert from 'node:assert/strict';
import { planDetails, planRemindersAllowed } from '@/lib/zoe-chat-actions/plan';
import type { CareData } from '@/lib/patient-care/types';
import type { MemberLdl } from '@/lib/ldl/schema';

const id='00000000-0000-4000-8000-000000000008';
const care:CareData={tests:[],results:[],appointments:[],events:[],plan:{id,clinician:'Dr. Mariam',publishedAt:'2026-11-02T08:00:00Z',acknowledgedAt:null,instructions:'Walk as agreed.',medications:[]}};
const state={planId:id,version:1,teachBackConfirmedAt:null};
const ldl:MemberLdl={version:'ldl-member-v1',enabled:true,inPathway:true,goal:{version:1,category:'high',thresholdMmol:1.8,reductionRule:false,reductionPct:null,baseline:{kind:'unknown',mmol:null,on:null,source:null},nextTestOn:null,setAt:'2026-11-02T08:00:00Z',doctorName:'Dr. Mariam'},observations:[]};
const detail=planDetails(care,state,ldl);
assert.ok(detail);
assert.equal(detail.bp,null,'An absent doctor BP target stays unknown');
assert.equal(detail.ldl?.target,1.8);
assert.equal(detail.ldl?.current,null);
assert.equal(JSON.stringify(detail).includes('category'),false,'No risk category in the member projection');
assert.equal(JSON.stringify(detail).includes('high'),false);
assert.equal(planDetails(care,{...state,planId:'other'},ldl),null,'An unrelated version cannot authorize this plan');
assert.equal(planDetails({...care,plan:null},state,ldl),null);
assert.equal(planDetails({...care,plan:{...care.plan!,clinician:'Staging doctor'}},state,ldl)?.clinician,null);
assert.equal(planRemindersAllowed(true,state,id),false,'No reminders before teach-back');
const confirmed={...state,teachBackConfirmedAt:'2026-11-02T09:00:00Z'};
assert.equal(planRemindersAllowed(true,confirmed,id),true);
assert.equal(planRemindersAllowed(true,confirmed,'new-plan'),false,'A new plan requires new confirmation');
assert.equal(planRemindersAllowed(true,null,id),false);
assert.equal(planRemindersAllowed(false,null,null),true,'Switch off retains the existing behavior');
console.log('Zoe V3 plan: projection, privacy and activation gates passed');

// Before the chat-only scheduler is built, V3 holds legacy outbound medicine reminders and asks.
const {runTelegramSweep}=await import('@/lib/telegram-runtime/dispatch');
for(const v3 of [false,true]){
 process.env.NOREON_ZOE_APP_V3=String(v3);
 const calls:string[]=[];
 await runTelegramSweep({accountRef:'fixture',adapter:{capabilities:()=>({plainText:true})} as never,rpc:async name=>{
  calls.push(name);
  if(name==='telegram_dispatch_queue')return {system:[],replies:[]};
  if(['channel_inbox_next','telegram_auth_message_queue','telegram_signin_links_expire','telegram_link_sessions_expire'].includes(name))return [];
  if(name==='zoe_held_ack_release')return {};
  if(name==='delivery_reconcile_stale')return {reconciled:0};
  if(name.endsWith('_run'))return {state:'off'};
  return [];
 }});
 assert.equal(calls.includes('member_medicine_reminders_run'),!v3,'V3 has no legacy outbound dose reminders');
 assert.equal(calls.includes('member_medicine_asks_run'),!v3,'V3 has no legacy outbound missed-dose asks');
}
delete process.env.NOREON_ZOE_APP_V3;
