/** Actual compact shell viewport adapter and shared hook, with controlled keyboard geometry. */
import assert from 'node:assert/strict';
import React from 'react';
import {act,create} from 'react-test-renderer';
import {ClinicChatViewport} from '@/components/clinic-portal/chat-viewport';
const properties=new Map<string,string>();
let editing=false;
const view=Object.assign(new EventTarget(),{height:844,offsetTop:0});
const browser=Object.assign(new EventTarget(),{setTimeout:(run:()=>void)=>{run();return 1;},clearTimeout:()=>{},visualViewport:view,scrollY:0,scrollTo(){browser.scrollY=0;}});
const documentFixture=Object.assign(new EventTarget(),{
 querySelector:()=>null,
 documentElement:{style:{setProperty:(name:string,value:string)=>properties.set(name,value),removeProperty:(name:string)=>properties.delete(name)}},
 activeElement:{matches:()=>editing},
});
Object.assign(globalThis,{window:browser,document:documentFixture,IS_REACT_ACT_ENVIRONMENT:true,requestAnimationFrame:(callback:FrameRequestCallback)=>{callback(0);return 0;}});
let tree!:ReturnType<typeof create>;
try{
 await act(async()=>{tree=create(React.createElement(ClinicChatViewport,{locale:'en'},React.createElement('input',{name:'clinic-message'})));});
 const frame=tree.root.findByType('div');
 assert.equal(frame.props.style.height,'var(--chat-view-height, 100dvh)','The shell consumes keyboard viewport height');
 assert.equal(frame.props.style.top,'var(--chat-view-top, 0px)','The shell consumes viewport offset');
 assert.ok(frame.props.className.includes('fixed'),'Viewport offset positions the whole shell and composer');
 assert.equal(properties.size,0,'Unfocused screen uses CSS viewport height');
 editing=true;view.height=420;view.offsetTop=28;browser.scrollY=80;
 await act(async()=>{documentFixture.dispatchEvent(new Event('focusin'));});
 assert.equal(properties.get('--chat-view-height'),'420px','Keyboard focus constrains the actual shell height');
 assert.equal(properties.get('--chat-view-top'),'28px');
 assert.equal(browser.scrollY,0,'Keyboard focus clears document scrolling');
 view.height=390;view.offsetTop=32;
 await act(async()=>{view.dispatchEvent(new Event('resize'));});
 assert.equal(properties.get('--chat-view-height'),'390px','Keyboard animation updates shell geometry');
 assert.equal(properties.get('--chat-view-top'),'32px');
 editing=false;
 await act(async()=>{documentFixture.dispatchEvent(new Event('focusout'));});
 assert.equal(properties.size,0,'Keyboard closing restores dynamic CSS viewport');
 editing=true;
 await act(async()=>{documentFixture.dispatchEvent(new Event('focusin'));});
 await act(async()=>tree.unmount());
 assert.equal(properties.size,0,'Leaving clinic chat clears viewport overrides');
 view.dispatchEvent(new Event('resize'));
 assert.equal(properties.size,0,'Unmount removes geometry listeners');
 console.log('Clinic chat viewport PASS: actual compact shell + shared hook track focus, keyboard resize/top, document scroll reset, blur and cleanup. Controlled geometry, not a mobile browser.');
}finally{await act(async()=>tree?.unmount());}
