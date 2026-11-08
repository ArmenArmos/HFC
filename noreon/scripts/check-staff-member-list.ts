import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import {act,create} from 'react-test-renderer';
import * as contracts from '@/lib/staff-zoe/contracts';
import {st} from '@/lib/staff/staff-locale-copy';
import type {WorkspaceMemberList} from '@/components/staff/doctor-workspace/member-list';

// Actual shared doctor/nurse list, with only navigation and server actions replaced.
const require=createRequire(import.meta.url),exports:Record<string,unknown>={};
const opened:string[]=[],pushed:string[]=[];
new vm.Script(ts.transpileModule(readFileSync('components/staff/doctor-workspace/member-list.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText).runInNewContext({exports,require(name:string){
 if(name==='@/lib/staff-zoe/contracts')return contracts;
 if(name==='next/navigation')return {useRouter:()=>({push:(href:string)=>pushed.push(href)})};
 if(name==='@/lib/staff/real-member-search-actions')return {searchRealMembers:()=>{throw Error('Unexpected search');}};
 if(name==='@/lib/staff-zoe/actions')return {openStaffZoe:async(id:string)=>{opened.push(id);return {ok:true,conversationId:id};}};
 if(name==='@/lib/staff/staff-locale-copy')return {st};
 return require(name);
}});
const List=exports.WorkspaceMemberList as typeof WorkspaceMemberList;
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
const row=(ending:string,birthYear:number|null)=>({id:`11111111-1111-4111-8111-00000000${ending}`,name:'Same member name',birthYear,revision:0,doctorId:null,nurseId:null,createdAt:'2026-11-01T00:00:00Z',bookingCounts:{requested:0,providerProposed:0,confirmed:0,changePending:0}});
const initialPage={rows:[row('1234',1980),row('5678',1980),{...row('9012',null),name:null}],hasMore:false,nextCursor:null};
const nodeText=(node:import('react-test-renderer').ReactTestInstance):string=>node.children.map(c=>typeof c==='string'?c:nodeText(c)).join('');
for(const nurseChat of [false,true])for(const locale of ['en','hy','ru'] as const){
 let tree!:ReturnType<typeof create>;
 try{
  await act(async()=>{tree=create(React.createElement(List,{initialPage,nurseChat,locale}));});
  const choices=tree.root.findAll(n=>n.type==='button'&&n.props.className==='dw-member');
  assert.equal(choices.length,3);
  const labels=choices.map(nodeText);
  assert.notEqual(labels[0],labels[1],'Same name and birth year still need distinct visible reference endings');
  assert.match(labels[0],/1980.*1234/);assert.match(labels[1],/1980.*5678/);
  assert.ok(!labels[0].includes(initialPage.rows[0].id),'Show only the reference ending');
  assert.match(labels[2],/9012/,'Missing name and year retain a distinguishing reference');
  await act(async()=>choices[1].props.onClick());
  assert.equal(pushed.at(-1),nurseChat?`/staff/real/nurse-chat?member=${initialPage.rows[1].id}`:`/staff/real/doctor-workspace?c=${initialPage.rows[1].id}`);
  if(!nurseChat)assert.equal(opened.at(-1),initialPage.rows[1].id);
 }finally{if(tree)await act(async()=>tree.unmount());}
}
console.log('Doctor/nurse duplicate-name selection: birth year, reference endings, unknown identity and correct navigation passed in en/hy/ru (controlled IO).');
