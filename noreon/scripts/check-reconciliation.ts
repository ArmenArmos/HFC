import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createWorkflow, applyServiceCommand as apply} from '@/lib/service-workflow/model';
import {reconcileRecommendations, bookingApplies} from '@/lib/service-workflow/reconciliation';
import type {ServiceTest} from '@/lib/service-workflow/types';
const now = new Date('2026-10-11T10:00:00Z');
const a:ServiceTest={id:'a',title:'Fictional A',method:'lab',preparation:'',source:'fictional'};
const b:ServiceTest={...a,id:'b',title:'Fictional B'};
function initial() {
  let w=createWorkflow([a,b],now);
  w=apply(w,{type:'book',testIds:['a','b'],at:'2026-10-12T05:00:00Z',mode:'clinic',address:''},now);
  w=apply(w,{type:'receive',testIds:['a']},now);
  return reconcileRecommendations(w,[a,b],true,1,'context-a',now);
}
test('restart and unchanged recompletion retain bookings and applicable receipts',()=>{
  const old=initial();
  const pending=reconcileRecommendations(old,[],false,2,'context-a',now);
  assert.equal(pending.bookings[0].id,old.bookings[0].id);
  assert.equal(pending.allResultsAt,null);
  assert.deepEqual(pending.receivedTestIds,[]);
  const next=reconcileRecommendations(pending,[a,b],true,3,'context-a',now);
  assert.deepEqual(next.receivedTestIds,['a']);
  assert.equal(bookingApplies(next,next.bookings[0],'b'),true);
  assert.equal(next.bookings[0].at,old.bookings[0].at);
});
test('removed and re-added test gets a new requirement and cannot reuse old receipt or reservation',()=>{
  const old=initial();
  const removed=reconcileRecommendations(old,[b],true,2,'context-b',now);
  assert.deepEqual(removed.receivedTestIds,[]);
  assert.deepEqual(removed.bookings[0].review?.changedTestIds,['a']);
  const readded=reconcileRecommendations(removed,[a,b],true,3,'context-c',now);
  assert.deepEqual(readded.receivedTestIds,[]);
  assert.equal(bookingApplies(readded,readded.bookings[0],'a'),false);
  assert.equal(readded.receiptHistory!.length,1);
  assert.equal(readded.requirements!.filter(r=>r.test.id==='a').length,2);
});
test('method change requires review and preserves the original booking details',()=>{
  const changed=reconcileRecommendations(initial(),[{...a,method:'clinic'},b],true,2,'context-b',now);
  assert.deepEqual(changed.receivedTestIds,[]);
  assert.equal(changed.bookings[0].testSnapshots![0].method,'lab');
  assert.equal(bookingApplies(changed,changed.bookings[0],'a'),false);
});
test('no-op context preserves consultation but changed clinical context resets it',()=>{
  const old={...initial(),consultation:'not-required' as const};
  const same=reconcileRecommendations(old,[a,b],true,2,'context-a',now);
  assert.equal(same.consultation,'not-required');
  const changed=reconcileRecommendations(same,[a,b],true,3,'context-b',now);
  assert.equal(changed.consultation,'undecided');
});
test('mixed reservation confirmation keeps only unchanged items and retains original history',()=>{
  const changed=reconcileRecommendations(initial(),[a],true,2,'context-b',now);
  const original=structuredClone(changed.bookings[0]);
  const confirmed=apply(changed,{type:'confirm-booking',bookingId:original.id,testIds:['a']},now);
  assert.equal(confirmed.bookings[0].status,'cancelled');
  assert.deepEqual(confirmed.bookings[0].testIds,['a','b']);
  assert.equal(confirmed.bookings[1].at,original.at);
  assert.deepEqual(confirmed.bookings[1].testIds,['a']);
  assert.equal(bookingApplies(confirmed,confirmed.bookings[1],'a'),true);
  assert.deepEqual(confirmed.receivedTestIds,['a']);
});
test('changed-method reservation cannot be confirmed as unchanged or received',()=>{
  const changed=reconcileRecommendations(initial(),[{...a,method:'clinic'},b],true,2,'context-b',now);
  assert.throws(()=>apply(changed,{type:'confirm-booking',bookingId:changed.bookings[0].id,testIds:['a','b']},now),/unchanged/);
  assert.throws(()=>apply(changed,{type:'receive',testIds:['a']},now),/Book/);
});
test('consultation context ignores answer recording metadata and respects clinical values',async()=>{
  const {clinicalContext}=await import('@/lib/service-workflow/reconciliation');
  const {newDemoState}=await import('@/lib/patient/demo-model');
  const data=newDemoState();
  data.state.profile={userId:data.userId,name:'Fictional',birthDate:'1980-01-01',biologicalSex:'male',locale:'en'};
  data.state.assessment={id:'fictional',revision:1,assessmentDate:'2026-10-11',answers:{a:{fieldId:'a',value:'yes',source:'manual',answeredAt:now.toISOString()}},completedAt:now.toISOString(),urgentRule:null};
  const original=clinicalContext(data.state);
  data.state.assessment.answers.a.answeredAt='2026-10-12T00:00:00Z';
  data.state.assessment.answers.a.source='voice';
  data.state.profile.locale='hy';data.state.profile.name='Changed name';
  assert.equal(clinicalContext(data.state),original);
  data.state.assessment.answers.a.value='no';
  assert.notEqual(clinicalContext(data.state),original);
});
test('pending questionnaire cannot make a received reservation cancellable',()=>{
  const pending=reconcileRecommendations(initial(),[],false,2,'context-a',now);
  assert.throws(()=>apply(pending,{type:'cancel',bookingId:pending.bookings[0].id},now),/Received/);
});
test('recompletion retains the original result-completion date',()=>{
  const completed=apply(initial(),{type:'receive',testIds:['b']},now);
  const later=new Date('2026-10-15T10:00:00Z');
  const pending=reconcileRecommendations(completed,[],false,2,'context-a',later);
  const next=reconcileRecommendations(pending,[a,b],true,3,'context-a',later);
  assert.equal(next.allResultsAt,completed.allResultsAt);
});
test('past affected reservations require replacement',()=>{
  const changed=reconcileRecommendations(initial(),[a],true,2,'context-b',now);
  assert.throws(()=>apply(changed,{type:'confirm-booking',bookingId:changed.bookings[0].id,testIds:['a']},new Date('2026-10-15T10:00:00Z')),/future|past|slot/i);
});
