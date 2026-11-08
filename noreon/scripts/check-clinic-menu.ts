import assert from 'node:assert/strict';
import {createElement} from 'react';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import {ClinicMenu} from '@/components/clinic-portal/menu';
import {ChatMenuItems} from '@/components/staff/chat-menu-items';

Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
type FixtureEvent={target?:unknown;key?:string;preventDefault?:()=>void};
const listeners=new Map<string,Set<(event:FixtureEvent)=>void>>();
const documentMock={
 getElementById:()=>null,
 addEventListener:(name:string,fn:(event:FixtureEvent)=>void)=>{if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name)!.add(fn);},
 removeEventListener:(name:string,fn:(event:FixtureEvent)=>void)=>{listeners.get(name)?.delete(fn);},
};
Object.assign(globalThis,{document:documentMock});
let focused=false;
const inside={closest:()=>null},item={closest:()=>({})},outside={closest:()=>null};
const fire=(name:string,event:FixtureEvent)=>listeners.get(name)?.forEach(fn=>fn(event));
for(const locale of ['en','hy','ru'] as const){
 let menu!:ReactTestRenderer;
 const props={locale,children:createElement('a',{href:'#test'},'Item')};
 await act(async()=>{menu=create(createElement(ClinicMenu,props),{createNodeMock:element=>element.type==='button'?{focus:()=>{focused=true;}}:{contains:(target:unknown)=>target===inside||target===item}});});
 const button=()=>menu.root.findByType('button');
 assert.equal(button().props.type,'button');assert.equal(button().props['aria-expanded'],false);
 assert.equal(button().children.join(''),{en:'Menu',hy:'Ընտրացանկ',ru:'Меню'}[locale]);
 assert.ok(button().props['aria-controls']);
 const panel=()=>menu.root.findByProps({id:button().props['aria-controls']});
 assert.equal(panel().props.hidden,true);
 await act(async()=>{button().props.onClick();});assert.equal(button().props['aria-expanded'],true);
 assert.equal(panel().props.hidden,false);
 await act(async()=>{button().props.onClick();});assert.equal(button().props['aria-expanded'],false,'button toggles closed');
 await act(async()=>{button().props.onClick();});
 focused=false;await act(async()=>{fire('keydown',{key:'Escape',preventDefault(){}});});
 assert.equal(button().props['aria-expanded'],false);assert.equal(focused,true);
 await act(async()=>{button().props.onClick();});
 await act(async()=>{fire('pointerdown',{target:inside});});assert.equal(button().props['aria-expanded'],true);
 await act(async()=>{fire('pointerdown',{target:outside});});assert.equal(button().props['aria-expanded'],false);
 await act(async()=>{button().props.onClick();});
 await act(async()=>{fire('click',{target:item});});assert.equal(button().props['aria-expanded'],false,'native click also covers portaled clinic actions');
 await act(async()=>{menu.unmount();});
 assert.ok([...listeners.values()].every(set=>set.size===0),'all listeners removed');
}
for(const target of ['clinic-chat-menu','doctor-chat-menu']){
 let menu!:ReactTestRenderer;
 const props={target,locale:'en' as const,children:'Item'};
 await act(async()=>{menu=create(createElement(ChatMenuItems,props));});
 if(target==='clinic-chat-menu'){
  assert.equal(menu.root.findByType('button').props['aria-expanded'],false,'clinic fallback is the button disclosure');
  assert.equal(menu.root.findAllByType('details').length,0);
 }else{
  assert.equal(menu.root.findAllByType('details').length,1,'staff fallback keeps its existing disclosure');
 }
 await act(async()=>{menu.unmount();});
}
console.log('Clinic Menu button: labels, expanded state, Escape/focus, outside tap and item selection passed.');
