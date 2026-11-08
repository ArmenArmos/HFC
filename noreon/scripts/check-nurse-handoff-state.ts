// Where a handoff stands, from its task and events (lib/nurse-chat/handoff-state.ts). "Seen" is not claimed: there is no read receipt.
import assert from 'node:assert/strict';
import {handoffState} from '@/lib/nurse-chat/handoff-state';

type Task=Parameters<typeof handoffState>[0];
const ev=(id:number,role:string,name:string,note:string,at='2026-11-04T08:00:00Z')=>({id,revision:id,request_id:'11111111-1111-4111-8111-111111111111',actor_id:'22222222-2222-4222-8222-222222222222',actor_name:name,actor_role:role,operation:'x',old_status:null,new_status:'open',old_owner_id:null,new_owner_id:'22222222-2222-4222-8222-222222222222',note,care_note_id:null,detail:{input:{}},created_at:at}) as Task['events'][number];
const task=(status:Task['status'],events:Task['events']):Task=>({status,events});

assert.deepEqual(handoffState(task('open',[ev(1,'nurse','Nurse','Handed over')])),{state:'sent',by:null,note:null,at:null},'Only the nurse acted: sent');
assert.equal(handoffState(task('awaiting-doctor',[])).state,'sent');
const working=handoffState(task('awaiting-member',[ev(1,'nurse','Nurse','x'),ev(2,'doctor','Dr Hovsep','Called her, waiting')]));
assert.equal(working.state,'working');assert.equal(working.by,'Dr Hovsep');assert.equal(working.note,'Called her, waiting');
const answered=handoffState(task('completed',[ev(1,'nurse','Nurse','x'),ev(2,'doctor','Dr Hovsep','Repeat the reading Thursday')]));
assert.deepEqual([answered.state,answered.by,answered.note],['answered','Dr Hovsep','Repeat the reading Thursday']);
assert.equal(handoffState(task('completed',[ev(1,'nurse','Nurse','Done by me')])).state,'closed','Closed by the nurse is not a doctor answer');
assert.equal(handoffState(task('cancelled',[ev(1,'nurse','Nurse','x'),ev(2,'doctor','Dr Hovsep','Not needed')])).state,'closed','A cancelled task is closed, not answered');
assert.equal(handoffState(task('completed',[ev(1,'nurse','Nurse','x'),ev(2,'doctor','Dr Hovsep','  ')])).state,'closed','A doctor event without a note is no answer');
assert.equal(handoffState(task('completed',[ev(3,'doctor','Dr B','Later'),ev(2,'doctor','Dr A','Earlier')])).by,'Dr B','The latest doctor event wins, in event order not array order');
console.log('Nurse handoff state: sent, working, answered and closed from the task and its events; no seen claim.');
