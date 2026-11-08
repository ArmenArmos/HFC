import assert from 'node:assert/strict';
import React from 'react';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import {NurseChat} from '@/components/staff/nurse-chat';
import type {NurseWorkspace} from '@/lib/nurse-chat/contracts';
(globalThis as unknown as {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
Object.assign(globalThis,{self:{setTimeout:()=>0}});
const styles=new Map<string,string>();
const shell={style:{setProperty:(key:string,value:string)=>styles.set(key,value),removeProperty:(key:string)=>styles.delete(key)}};
let height=240,resize:()=>void=()=>{},disconnects=0,observed:unknown=null;
const original=globalThis.ResizeObserver;
globalThis.ResizeObserver=class{
 constructor(callback:()=>void){resize=callback;}
 observe(target:unknown,options:unknown){observed=target;assert.deepEqual(options,{box:'border-box'});}
 disconnect(){disconnects++;}
} as unknown as typeof ResizeObserver;
const form={closest:(selector:string)=>{assert.equal(selector,'[data-nurse-chat-shell]');return shell;},getBoundingClientRect:()=>({height})};
let data:NurseWorkspace={ok:true,memberId:'ad110000-0000-4000-8000-000000000001',memberName:'Fictional member',doctorName:'Fictional doctor',version:1,canSend:true,items:[]};
let tree!:ReactTestRenderer;
try{
 await act(async()=>{tree=create(React.createElement(NurseChat,{memberId:data.ok?data.memberId:'',nurseName:'Fictional nurse',initial:data,locale:'en',ports:{read:async()=>data,send:async()=>{throw Error('No send expected');}}}),{createNodeMock:element=>element.type==='form'?form:null});});
 assert.equal(observed,form);
 assert.equal(styles.get('--nurse-composer-height'),'240px','Initial measured height reserves space below scrollable visit and safety content');
 height=320;await act(async()=>resize());
 assert.equal(styles.get('--nurse-composer-height'),'320px','Growing localized notice or keyboard resize remeasures the actual form');
 const main={scrollTop:5000};
 const section={closest:()=>main};
 const visitProps={memberId:data.ok?data.memberId:'',nurseName:'Fictional nurse',initial:data,locale:'en' as const,visitKey:'appointment:one',ports:{read:async()=>data,send:async()=>{throw Error('No send expected');}},children:React.createElement('article',{'data-visit-content':true},'Visit checklist')};
 await act(async()=>{tree.unmount();tree=create(React.createElement(NurseChat,visitProps),{createNodeMock:element=>element.type==='section'?section:element.type==='form'?form:null});});
 assert.equal(main.scrollTop,0,'Opening a visit starts at the top');
 assert.equal(tree.root.findAll(n=>n.props['data-nurse-reply-composer']).length,0,'Visit content has no covering reply dock');
 assert.equal(tree.root.findAll(n=>n.props.role==='log').length,0,'A visit is outside the conversation auto-scroll container');
 assert.ok(tree.root.find(n=>n.props['data-nurse-visit-safety']),'The role boundary remains above the visit; the page pins emergency guidance');
 assert.match(tree.root.findByType('a').props.href,/card=conversation/,'Back to conversation selects the conversation card');
 main.scrollTop=1200;
 await act(async()=>tree.root.findAllByType('button').find(n=>n.children.join('').includes('Reload conversation'))!.props.onClick());
 assert.equal(main.scrollTop,1200,'Conversation reload never scrolls an open visit');
 await act(async()=>tree.update(React.createElement(NurseChat,{...visitProps,visitKey:'appointment:two'})));
 assert.equal(main.scrollTop,0,'Switching visits opens the next visit at the top');
 await act(async()=>tree.update(React.createElement(NurseChat,{...visitProps,visitKey:undefined})));
 assert.equal(tree.root.findAll(n=>n.props['data-nurse-reply-composer']).length,1,'Returning to the conversation restores the reply box');
 assert.equal(styles.get('--nurse-composer-height'),'320px','Returning to chat reserves the measured composer again');
 await act(async()=>tree.update(React.createElement(NurseChat,{...visitProps,visitKey:undefined,workActive:true})));
 assert.equal(tree.root.findAll(n=>n.props['data-nurse-reply-composer']).length,0,'Work cards use an inline reply disclosure without a covering dock');
 assert.equal(styles.has('--nurse-composer-height'),false,'Work cards clear the conversation dock reservation');
 assert.equal(tree.root.findAllByType('details').filter(n=>n.props.open).length,0,'Conversation and reply stay collapsed while a work card is active');
 data={ok:false,code:'denied'};
 await act(async()=>tree.root.findAllByType('button').find(n=>n.children.join('').includes('Reload conversation'))!.props.onClick());
 assert.equal(tree.root.findAll(n=>n.props['data-nurse-reply-composer']).length,0,'Access loss removes dock');
 assert.equal(styles.has('--nurse-composer-height'),false,'Access loss clears reserved composer space');
 assert.equal(disconnects,2);
 console.log('Nurse viewport stand-in: measured composer, visit top and safety, no visit auto-scroll, chat return and access-loss cleanup passed (no visual proof).');
}finally{
 if(tree)await act(async()=>tree.unmount());
 globalThis.ResizeObserver=original;
}
