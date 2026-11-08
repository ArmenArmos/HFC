import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import React,{startTransition} from 'react';
import {create,act} from 'react-test-renderer';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
let resolveAction;
globalThis.__assignmentAction=()=>new Promise(resolve=>{resolveAction=resolve;});
const hook=registerHooks({resolve(s,c,next){if(s==='@/lib/staff/nurse-actions')return{url:'data:text/javascript,'+encodeURIComponent('export async function assignNurse(){return globalThis.__assignmentAction()} export const assignRealNurse=assignNurse;'),shortCircuit:true};return next(s,c);}});
try {
 const{NurseAssignment}=await import('@/components/staff/nurse-assignment');
 for(const native of [false,true]){
  const props={id:'case-one',revision:1,assignedNurseId:null,nurses:[{id:'nurse-a',name:'Nurse A'},{id:'nurse-b',name:'Nurse B'}],native};
  let renderer;await act(()=>{renderer=create(React.createElement(NurseAssignment,props))});
  const select=()=>renderer.root.findByType('select');
  let prevented=false;renderer.root.findByType('form').props.onReset({preventDefault(){prevented=true;}});
  assert.ok(prevented,'Successful server action native reset must not override controlled select DOM');
  assert.equal(select().props.value,'','Selection must be controlled so a successful form reset cannot restore an obsolete default');
  await act(()=>select().props.onChange({target:{value:'nurse-a'}}));
  assert.equal(select().props.value,'nurse-a');
  await act(()=>renderer.update(React.createElement(NurseAssignment,{...props,revision:2,assignedNurseId:'nurse-a'})));
  assert.equal(select().props.value,'nurse-a','Refreshed saved assignment displayed');
  assert.equal(renderer.root.findAllByType('input').find(i=>i.props.name==='revision').props.value,2);
  await act(()=>select().props.onChange({target:{value:'nurse-b'}}));
  await act(()=>startTransition(()=>renderer.root.findByType('form').props.action(new FormData())));
  await act(()=>resolveAction({status:'error',message:'Changed case'}));
  assert.equal(select().props.value,'nurse-b','Failure preserves attempted selection');
  await act(()=>startTransition(()=>renderer.root.findByType('form').props.action(new FormData())));
  await act(()=>renderer.update(React.createElement(NurseAssignment,{...props,revision:3,assignedNurseId:null})));
  assert.equal(select().props.value,'','Newer removal props replace stale draft');
  await act(()=>resolveAction({status:'success',message:'Nurse assignment saved.'}));
  assert.equal(select().props.value,'','Late action status cannot overwrite newer authoritative props');
  await act(()=>renderer.update(React.createElement(NurseAssignment,{...props,id:'case-two',revision:3,assignedNurseId:'nurse-b'})));
  assert.equal(select().props.value,'nurse-b','Different case has independent selection');
  await act(()=>renderer.unmount());
 }
 console.log('Actual nurse assignment component preserves drafts/errors and follows authoritative case revisions in real and demo modes.');
}finally{hook.deregister();delete globalThis.__assignmentAction;delete globalThis.IS_REACT_ACT_ENVIRONMENT;}
