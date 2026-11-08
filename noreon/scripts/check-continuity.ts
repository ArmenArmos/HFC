import assert from 'node:assert/strict';
import {test} from 'node:test';
import {dosesForDay} from '@/lib/patient-care/model';
import {createWorkflow,applyServiceCommand as apply,workflowCare} from '@/lib/service-workflow/model';
import {newDemoState} from '@/lib/patient/demo-model';
import {normalizeSharedWorkflow} from '@/lib/service-workflow/normalization';
const now=new Date('2026-10-11T10:00:00Z');
let w=createWorkflow([],now);
w=apply(w,{type:'consultation',decision:'not-required'},now);
const draft={...w.draft,instructions:'Reviewed fictional instructions',medicationName:'Fictional existing order',medicationDose:'Example dose',medicationTimes:['08:00']};
w=apply(w,{type:'save-draft',draft,evidenceRevision:0},now);
w=apply(w,{type:'publish',evidenceRevision:0},now);
const initial=workflowCare(w,[],false);
w=apply(w,{type:'save-draft',draft:{...draft,explanation:'Updated explanation only'},evidenceRevision:0},now);
w=apply(w,{type:'publish',evidenceRevision:0},now);
const updated=workflowCare(w,[],false);
test('explanation-only republication retains medication identity', () => {
  assert.equal(updated.plan!.medications[0].id, initial.plan!.medications[0].id);
});
const state=newDemoState();state.state.profile={userId:state.userId,name:'Fictional continuity',birthDate:'1980-01-01',biologicalSex:'male',locale:'en'};state.state.consentAccepted=true;
state.workflow={...w,questionnaireRevision:1,bookings:[{id:'booked-visit',testIds:['lipid-panel'],at:'2026-10-13T05:00:00Z',mode:'clinic',address:'',status:'scheduled'}]};
state.state.assessment={id:'assessment',revision:2,answers:{},assessmentDate:'2026-10-11',completedAt:null,urgentRule:null};
normalizeSharedWorkflow(state);
test('restarting questions retains the booking record', () => {
  assert.equal(state.workflow!.bookings[0]?.id, 'booked-visit');
});

test('republishing retains check-ins for the unchanged medication', () => {
  const event = {medicationId:initial.plan!.medications[0].id,dueAt:'2026-10-11T04:00:00Z',recordedAt:now.toISOString(),status:'taken' as const};
  assert.deepEqual(workflowCare(w,[event],false).events,[event]);
});

test('replacing a booking keeps the original reservation history', () => {
  const testItem = {id:'lipid-panel',title:'Lipid panel',method:'lab' as const,preparation:'',source:'Fictional test'};
  let booked = apply(createWorkflow([testItem],now),{type:'book',testIds:[testItem.id],at:'2026-10-13T05:00:00Z',mode:'clinic',address:''},now);
  const original = structuredClone(booked.bookings[0]);
  booked = apply(booked,{type:'book',testIds:[testItem.id],at:'2026-10-14T05:00:00Z',mode:'clinic',address:'',replacingId:original.id},now);
  const retained = booked.bookings.find(b => b.id === original.id);
  assert.ok(retained, 'original booking remains available');
  assert.equal(retained.status,'cancelled');
  assert.equal(retained.at,original.at);
  assert.equal(booked.bookings.filter(b=>b.status==='scheduled').length,1);
});


test('explanation-only republication does not hide earlier doses from today', () => {
  const morning = new Date('2026-10-11T03:00:00Z');
  let prior = apply(createWorkflow([],morning),{type:'consultation',decision:'not-required'},morning);
  prior = apply(prior,{type:'save-draft',draft,evidenceRevision:0},morning);
  prior = apply(prior,{type:'publish',evidenceRevision:0},morning);
  const before = dosesForDay(workflowCare(prior,[],false),now);
  assert.equal(before.length,1);
  prior = apply(prior,{type:'save-draft',draft:{...draft,explanation:'Explanation revised at midday'},evidenceRevision:0},now);
  prior = apply(prior,{type:'publish',evidenceRevision:0},now);
  assert.equal(dosesForDay(workflowCare(prior,[],false),now).length,1);
});

test('medication changes retire orders while stop and restart keep history', () => {
  let current = structuredClone(w);
  const originalOrder = current.publication!.medicationOrderId;
  const republish = (nextDraft: typeof draft, hour: number) => {
    const at = new Date(`2026-10-11T${hour}:00:00Z`);
    current = apply(current,{type:'save-draft',draft:nextDraft,evidenceRevision:0},at);
    current = apply(current,{type:'publish',evidenceRevision:0},at);
  };
  republish({...draft,medicationDose:'Changed example dose'},11);
  const changedOrder = current.publication!.medicationOrderId;
  assert.notEqual(changedOrder,originalOrder);
  assert.equal(current.medicationOrders!.find(o=>o.id===originalOrder)!.retiredAt,'2026-10-11T11:00:00.000Z');
  republish({...draft,medicationName:'',medicationDose:'',medicationTimes:[]},12);
  assert.equal(current.publication!.medicationOrderId,undefined);
  assert.equal(current.medicationOrders!.find(o=>o.id===changedOrder)!.retiredAt,'2026-10-11T12:00:00.000Z');
  republish(draft,13);
  assert.notEqual(current.publication!.medicationOrderId,originalOrder);
  assert.equal(current.medicationOrders!.length,3);
  assert.equal(current.publicationHistory!.length,current.publication!.version-1);
  assert.equal(current.publicationHistory![0].draft.medicationDose,'Example dose');
});

test('legacy publication imports its actual order identity and start time', () => {
  const legacy=structuredClone(w);
  delete legacy.medicationOrders;
  delete legacy.publicationHistory;
  delete legacy.publication!.medicationOrderId;
  const oldId=`workflow-medication-${legacy.publication!.version}`;
  const originalAt=legacy.publication!.at;
  const saved=apply(legacy,{type:'save-draft',draft,evidenceRevision:0},now);
  const next=apply(saved,{type:'publish',evidenceRevision:0},new Date('2026-10-12T10:00:00Z'));
  assert.equal(next.publication!.medicationOrderId,oldId);
  assert.equal(next.medicationOrders![0].effectiveAt,originalAt);
  assert.equal(next.publicationHistory!.length,1,'do not invent erased earlier publications');
});

test('schedule order and duplicate times do not create a different medication order', () => {
  let current=apply(w,{type:'save-draft',draft:{...draft,medicationTimes:['08:00','20:00']},evidenceRevision:0},now);
  current=apply(current,{type:'publish',evidenceRevision:0},now);
  const id=current.publication!.medicationOrderId;
  current=apply(current,{type:'save-draft',draft:{...draft,medicationTimes:['20:00','08:00','08:00']},evidenceRevision:0},now);
  current=apply(current,{type:'publish',evidenceRevision:0},now);
  assert.equal(current.publication!.medicationOrderId,id);
});

test('a new order cannot expose doses before its effective instant', () => {
  assert.equal(dosesForDay(workflowCare(w,[],false),now).length,0);
});

test('each medication field change creates a new order without mutating the input', () => {
  for (const change of [
    {medicationName:'Different fictional medicine'},
    {medicationDose:'Different fictional dose'},
    {medicationInstructions:'Changed medication instructions'},
    {medicationTimes:['09:00']},
  ]) {
    const original=structuredClone(w);
    const saved=apply(w,{type:'save-draft',draft:{...draft,...change},evidenceRevision:0},now);
    const changed=apply(saved,{type:'publish',evidenceRevision:0},now);
    assert.notEqual(changed.publication!.medicationOrderId,w.publication!.medicationOrderId);
    assert.deepEqual(w,original);
  }
});

test('republishing retains historical results with stable receipt identity and date',()=>{
  const early=new Date('2026-10-10T03:00:00Z');
  let current=createWorkflow([{id:'lipid-panel',title:'Fictional lipid panel',method:'lab',preparation:'',source:'fictional'}],early);
  current=apply(current,{type:'book',testIds:['lipid-panel'],at:'2026-10-11T05:00:00Z',mode:'clinic',address:''},early);
  current=apply(current,{type:'receive',testIds:['lipid-panel']},now);
  current=apply(current,{type:'consultation',decision:'not-required'},now);
  const publishAt=(explanation:string,at:Date)=>{
    current=apply(current,{type:'save-draft',draft:{...draft,explanation},evidenceRevision:current.evidenceRevision ?? 0},at);
    current=apply(current,{type:'publish',evidenceRevision:current.evidenceRevision ?? 0},at);
  };
  publishAt('First explanation',now);
  const first=workflowCare(current,[],false).results[0];
  publishAt('Updated explanation',new Date('2026-10-12T10:00:00Z'));
  const care=workflowCare(current,[],false);
  assert.equal(care.results.length,1,'one receipt does not become two measurements');
  assert.equal(care.results[0].id,first.id);
  assert.equal(care.results[0].receivedAt,first.receivedAt);
  assert.equal(care.results[0].collectedAt,first.collectedAt);
  assert.equal(care.results[0].explanation,'Updated explanation');
  assert.equal(care.planHistory![0].explanation,'First explanation');
  assert.match(care.results[0].sourceLabel,/collection date not recorded/);
});
test('legacy result keeps one stable point after its first republish',()=>{
  const legacy=structuredClone(w);
  legacy.tests=[{id:'lipid-panel',title:'Fictional',method:'lab',preparation:'',source:'fictional'}];
  legacy.receivedTestIds=['lipid-panel'];delete legacy.requirements;delete legacy.receiptHistory;
  legacy.publication!.resultTestIds=['lipid-panel'];delete legacy.publication!.resultReceipts;
  const first=workflowCare(legacy,[],false).results[0];
  const published=apply(apply(legacy,{type:'save-draft',draft,evidenceRevision:0},now),{type:'publish',evidenceRevision:0},now);
  const results=workflowCare(published,[],false).results;
  assert.equal(results.length,1);assert.equal(results[0].id,first.id);assert.equal(results[0].collectedAt,first.collectedAt);
});
