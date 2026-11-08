import assert from 'node:assert/strict';
import React from 'react';
import {act,create} from 'react-test-renderer';
import {ChatShellMenu} from '@/components/staff/chat-menu-items';
// QA 214: an open Menu closes on a tap or focus outside it, so the keyboard cannot lift the composer under it.
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const page=new EventTarget(),inside={},outside={};
(globalThis as unknown as {document:EventTarget}).document=page;
const details={open:true,contains:(node:unknown)=>node===inside,removeAttribute(name:string){assert.equal(name,'open');details.open=false;}};
const fire=(type:string,target:object)=>page.dispatchEvent(Object.defineProperty(new Event(type),'target',{value:target}));
let tree!:ReturnType<typeof create>;
await act(async()=>{tree=create(React.createElement(ChatShellMenu,null,'Menu'),{createNodeMock:()=>details});});
for(const type of ['pointerdown','focusin']){
 details.open=true;
 fire(type,inside);assert.equal(details.open,true,`${type} inside keeps the menu open`);
 fire(type,outside);assert.equal(details.open,false,`${type} outside closes the menu`);
}
await act(async()=>tree.unmount());
details.open=true;fire('pointerdown',outside);assert.equal(details.open,true,'No listener stays after unmount');
console.log('Chat shell menu passed: a tap or focus outside closes it, inside keeps it, unmount removes the listeners.');
