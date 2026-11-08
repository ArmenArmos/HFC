import assert from 'node:assert/strict';
import {nurseLandingDestination,nurseLandingNext} from '@/lib/nurse-chat/landing';
for(const word of ['today','Today','այսօր','сегодня'])assert.equal(nurseLandingDestination(word),'/staff/real/nurse-chat?view=today');
for(const word of ['visits','այցեր','визиты'])assert.equal(nurseLandingDestination(word),'/staff/real/nurse-chat?view=visits');
for(const word of ['members','անդամներ','участники'])assert.equal(nurseLandingDestination(word),'/staff/real/nurse-chat?view=members');
assert.equal(nurseLandingDestination('  Fictional member '),'/staff/real/nurse-chat?view=members&q=Fictional+member');
assert.equal(nurseLandingDestination('Which of my members has high blood pressure?'),null,'A clinical question is never searched as a member name');
assert.equal(nurseLandingDestination(''),null);
assert.equal(nurseLandingDestination('a'),null);
assert.equal(nurseLandingNext({ok:false,code:'unavailable'}),null);
const empty={ok:true as const,identities:[],page:null,visits:null,asOf:'2026-11-01T10:00:00Z'};
assert.equal(nurseLandingNext(empty),null,'Unknown work is not manufactured');
const visit={source:'appointment',id:'visit-id',memberId:'member-id',startsAt:'2026-11-01T08:00:00Z',completion:null};
const data={...empty,visits:{enabled:true,visits:[visit]}} as unknown as Parameters<typeof nurseLandingNext>[0];
assert.deepEqual(nurseLandingNext(data),{kind:'visit',href:'/staff/real/nurse-chat?member=member-id&source=appointment&visit=visit-id'});
assert.equal(nurseLandingNext({...empty,visits:{enabled:true,visits:[{...visit,completion:{}}]}} as unknown as Parameters<typeof nurseLandingNext>[0]),null,'Completed visits are not a next step');
console.log('Nurse landing: localized navigation, bounded member search, no fabricated work, selected visit and completed-work exclusion passed.');

// Exercise the actual composer with a controlled navigation port. No server action is called.
const React=await import('react');
const {act,create}=await import('react-test-renderer');
const {AppRouterContext}=await import('next/dist/shared/lib/app-router-context.shared-runtime.js');
const {NurseChatLanding}=await import('@/components/staff/nurse-chat-landing');
(globalThis as unknown as {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
for(const locale of ['en','hy','ru'] as const){
 const pushed:string[]=[];
 const router={push:(href:string)=>pushed.push(href)} as unknown as NonNullable<React.ContextType<typeof AppRouterContext>>;
 let tree!:import('react-test-renderer').ReactTestRenderer;
 try{
  await act(async()=>{tree=create(React.createElement(AppRouterContext.Provider,{value:router},React.createElement(NurseChatLanding,{locale,next:null})));});
  assert.ok(JSON.stringify(tree.toJSON()).includes(({en:'Nothing needs your attention right now.',hy:'Այս պահին ոչինչ ձեր ուշադրության կարիքը չունի։',ru:'Сейчас ничто не требует вашего внимания.'})[locale]),'An empty nurse landing has a localized Zoe turn');
  assert.equal(tree.root.findAllByType('input').length,1);
  assert.equal(tree.root.findAllByType('a').length,0,'Empty landing has no fabricated next step');
  await act(async()=>tree.root.findByType('input').props.onChange({target:{value:locale==='hy'?'այցեր':locale==='ru'?'визиты':'visits'}}));
  await act(async()=>tree.root.findByType('form').props.onSubmit({preventDefault(){}}));
  assert.deepEqual(pushed,['/staff/real/nurse-chat?view=visits']);
  await act(async()=>tree.update(React.createElement(AppRouterContext.Provider,{value:router},React.createElement(NurseChatLanding,{locale,next:null,unavailable:true}))));
  assert.ok(!JSON.stringify(tree.toJSON()).includes(({en:'Nothing needs your attention right now.',hy:'Այս պահին ոչինչ ձեր ուշադրության կարիքը չունի։',ru:'Сейчас ничто не требует вашего внимания.'})[locale]),'Unavailable work never appears as an empty queue');
  assert.equal(tree.root.findByType('input').props.value,'','Successful navigation clears the composer');
  await act(async()=>tree.update(React.createElement(AppRouterContext.Provider,{value:router},React.createElement(NurseChatLanding,{locale,next:null},React.createElement('p',null,'Work list sentinel')))));
  assert.equal(tree.root.findAllByType('input').length,1,'List view retains the composer');
  assert.ok(JSON.stringify(tree.toJSON()).includes('Work list sentinel'));
 }finally{if(tree)await act(async()=>tree.unmount());}
}
console.log('Nurse landing rendered: en/hy/ru composer navigation, empty/unavailable and list composer passed (controlled router, no browser or data access).');
