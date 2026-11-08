import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {NurseChat} from '@/components/staff/nurse-chat';
import {NurseConversation} from '@/components/nurse-chat-v2/conversation';
import {nurseWorkspaceSchema} from '@/lib/nurse-chat/contracts';

const id='ad110000-0000-4000-8000-000000000001';
const base={ok:true as const,memberId:id,memberName:'Ani Example',doctorName:'Doctor Example',version:1,canSend:true,items:[
 {id:'member',text:'A question',at:'2026-11-04T08:00:00Z',senderName:'Ani Example',senderRole:'member' as const},
 {id:'nurse',text:'A nurse reply',at:'2026-11-04T08:01:00Z',senderName:'Nurse Example',senderRole:'nurse' as const},
]};
// Old RPC responses must still parse while the app and migration roll out separately.
assert.ok(nurseWorkspaceSchema.safeParse(base).success);
const cases=[
 {route:{telegramLinked:true,telegramSendingEnabled:true},handoff:true,reason:['Ani Example uses Telegram','Ani Example-ն օգտվում է Telegram-ից','Ani Example использует Telegram']},
 {route:{telegramLinked:false,telegramSendingEnabled:true},handoff:false,reason:['Ani Example has no active Telegram connection','Ani Example-ը Telegram-ի ակտիվ կապ չունի','У Ani Example нет активного подключения к Telegram']},
 {route:{telegramLinked:true,telegramSendingEnabled:false},handoff:false,reason:['Telegram sending is switched off','Telegram-ով ուղարկումն անջատված է','Отправка в Telegram отключена']},
 {route:{telegramLinked:false,telegramSendingEnabled:false},handoff:false,reason:['Telegram sending is switched off','Telegram-ով ուղարկումն անջատված է','Отправка в Telegram отключена']},
 {route:{telegramLinked:true,telegramSendingEnabled:true,canSend:false},handoff:true,reason:['Member app chat is switched off','Անդամի հավելվածի զրույցն անջատված է','Чат участника в приложении отключён']},
 {route:{},handoff:false,reason:['Your nurse replies go to the Noreon app','Ձեր՝ որպես բուժքրոջ պատասխանները հասնում են Նորեոն Հելթ հավելված','Ваши ответы как медсестры поступают в приложение Нореон Хелс']},
];
for(const [index,locale] of (['en','hy','ru'] as const).entries())for(const scenario of cases){
 const data=nurseWorkspaceSchema.parse({...base,...scenario.route});
 assert.ok(data.ok);
 // Isolate the view from the polling and handoff action IO. No command runs during render.
 const conversation={session:{data,member:{id,name:base.memberName,birthDate:null,sex:null,clinic:null}},handoff:{selected:null,active:false,remembered:[],page:null,failed:[],flow:null,fallbacks:[]},optimistic:[],notice:'',frozen:false} as unknown as React.ComponentProps<typeof NurseConversation>['conversation'];
 const views=[
  renderToStaticMarkup(React.createElement(NurseChat,{memberId:id,nurseName:'Nurse Example',locale,initial:data,ports:{read:async()=>data,send:async()=>{throw Error('Render cannot send');},escalate:async()=>{throw Error('Render cannot hand off');}}})),
  renderToStaticMarkup(React.createElement(NurseConversation,{conversation,locale,nurseName:'Nurse Example',onRetry(){},onAction(){}})),
 ];
 for(const html of views){
  assert.ok(html.includes(scenario.reason[index]),`${locale}: member-specific route reason: ${scenario.reason[index]}`);
  assert.equal(html.includes('data-nurse-telegram-handoff'),scenario.handoff,`${locale}: Telegram handoff needs a current link and sending switch`);
  assert.ok(html.includes(['Sent to the app. Reading is not confirmed.','Ուղարկված է հավելվածին։ Կարդալը հաստատված չէ։','Отправлено в приложение. Прочтение не подтверждено.'][index]));
  assert.equal((html.match(/data-nurse-reply-state/g)??[]).length,1,'Only saved nurse replies get an app status');
  for(const claim of ['Not read yet','Read in the app','Դեռ կարդացված չէ','Կարդացված է հավելվածում','Ещё не прочитано','Прочитано в приложении'])assert.ok(!html.includes(claim),'No read or unread evidence exists');
  assert.ok(!html.includes('—'),'No em dashes');
  for(const internal of ['telegramLinked','telegramSendingEnabled','route_policy_missing','Telegram delivery is unavailable here'])assert.ok(!html.includes(internal));
 }
}
// Confirmed app publication remains visible even while a follow-up read is unavailable.
const sent={session:{data:base,member:{id,name:base.memberName,birthDate:null,sex:null,clinic:null}},handoff:{selected:null,active:false,remembered:[],page:null,failed:[],flow:null,fallbacks:[]},optimistic:[{request:{requestId:id,body:'Saved reply'},at:'2026-11-04T08:02:00Z',state:'sent',replyId:id}],notice:'savedUnread',frozen:false} as unknown as React.ComponentProps<typeof NurseConversation>['conversation'];
const html=renderToStaticMarkup(React.createElement(NurseConversation,{conversation:sent,locale:'en',nurseName:'Nurse Example',onRetry(){},onAction(){}}));
assert.equal((html.match(/data-nurse-reply-state/g)??[]).length,2);
console.log('PASS nurse app-only route reasons, optional RPC fields, Telegram-only handoff guidance and honest per-reply states in en, hy and ru (both rendered views, isolated IO).');
