import type {StaffId,ClinicId} from '@/lib/conversation-core/contracts';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {TestOrders} from '@/components/patient-care/test-orders';
import {PlanApproval} from '@/components/patient-care/care-layout';
import {ResultHistory} from '@/components/patient-care/result-history';
import {LdlGoalCard} from '@/components/patient-care/ldl-goal-card';
import {MemberChat} from '@/components/chat-v2/member-chat';
import {memberResultsSchema} from '@/lib/member-history/lab-results';
import {PLAN} from '@/lib/zoe-chat-actions/copy';
import {FirstNoteCard} from '@/components/patient-care/first-note-card';
import {doctorShortName} from '@/lib/zoe/conversation';
import {closingText} from '@/lib/zoe/symptoms/intake';
import {renderOutboundText} from '@/lib/conversation-core/channel-contract';
import {LDL} from '@/lib/zoe-chat-actions/copy';

// Scan fixed-member wording literals, including template fragments; comments marking pending copy are excluded.
for(const path of ['conversation.ts','health-answer.ts','symptoms/intake.ts','urgent-followup.ts','member-clear.ts','alarm-conversation.ts']){
 const source=ts.createSourceFile(path,readFileSync(`lib/zoe/${path}`,'utf8'),ts.ScriptTarget.Latest,true);
 const scan=(node:ts.Node)=>{
  if(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node)||ts.isTemplateHead(node)||ts.isTemplateMiddle(node)||ts.isTemplateTail(node))assert.doesNotMatch(node.text,/STAGING/u,`${path}: no staging label in fixed member text`);
  ts.forEachChild(node,scan);
 };
 scan(source);
}

for(const name of ['STAGING Test Doctor','Dr Aram Petrosyan'])for(const l of ['en','hy','ru']as const){
 const html=renderToStaticMarkup(createElement(FirstNoteCard,{locale:l,note:{textEn:'Your next step',textHy:'Հաջորդ քայլը',approvedAt:'2026-11-02T08:00:00Z',doctorName:name}}));
 const at='2026-11-02T08:00:00Z';
 const resultHtml=renderToStaticMarkup(createElement(ResultHistory,{locale:l,results:[{id:'r',testId:null,marker:'LDL',value:2,unit:'mmol/L',referenceLow:null,referenceHigh:3,collectedAt:at,receivedAt:at,source:'laboratory',sourceLabel:'Lab',reviewedAt:at,reviewedBy:name,explanation:'Your explanation'}]}));
 const orderHtml=renderToStaticMarkup(createElement(TestOrders,{locale:l,tests:[{id:'t',title:'Blood test',preparation:null,status:'ordered',orderedBy:name,orderedAt:at,dueAt:null,location:null,source:'clinic',sourceLabel:'Clinic'}]}));
 const planHtml=renderToStaticMarkup(createElement(PlanApproval,{locale:l,pendingReview:false,plan:{id:'p',clinician:name,publishedAt:at,instructions:'Your instructions',acknowledgedAt:null,medications:[]}}));
 const ldlHtml=renderToStaticMarkup(createElement(LdlGoalCard,{locale:l,data:{version:'ldl-member-v1',enabled:true,inPathway:true,goal:null,observations:[],withDoctor:{since:at,doctorName:name}}}));
 const chatHtml=renderToStaticMarkup(createElement(MemberChat,{locale:l,memberName:'Member',revision:0,initial:{ok:true,version:0,ack:null,zoeReplies:true,settledSeq:0,messages:[],answers:[],replies:[{id:'r',text:'Your reply',at,doctorName:name}]}}));
 const parsed=memberResultsSchema.parse({version:'member-upload-results-v1',enabled:true,approvalRequired:true,documents:[{documentId:'11111111-1111-4111-8111-111111111111',fileName:'Results',resultDate:null,state:'approved',approvedAt:at,doctorName:name,interpretation:null}],values:[]});
 assert.ok(parsed.enabled);
 assert.equal(parsed.documents[0].doctorName,name==='Dr Aram Petrosyan'?name:null,'member-history attribution');
 const texts=[html,resultHtml,orderHtml,planHtml,ldlHtml,chatHtml,PLAN.approvedBy(name,'2 Nov')[l],closingText(l,name),LDL.withName(name)[l],renderOutboundText({body:{en:'A reply',hy:'Պատասխան',ru:'Ответ'}[l],approvedBy:{staffId:'synthetic' as StaffId,displayName:name,role:'doctor',clinicId:'synthetic' as ClinicId}})];
 for(const text of texts){
  assert.doesNotMatch(text,/STAGING|Test Doctor/iu,`${l}: no placeholder attribution`);
  assert.equal(text.includes('Aram Petrosyan'),name==='Dr Aram Petrosyan',`${l}: real name preserved`);
 }
 assert.equal(doctorShortName(name),name==='Dr Aram Petrosyan'?'Aram Petrosyan':null);
}
console.log('Member staff names: render, chat, history, intake, card and Telegram checks passed.');
