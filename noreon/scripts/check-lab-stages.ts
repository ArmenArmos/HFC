import assert from 'node:assert/strict';
import {createElement} from 'react';
import {create,act} from 'react-test-renderer';
import {renderToStaticMarkup} from 'react-dom/server';
import {LabStages} from '@/components/staff/lab-stages';
import {LabStageCard} from '@/components/patient-care/lab-stage-card';
import {VisitChecklist} from '@/components/staff/visit-checklist';
import {checklistProgress,visitChecklist,visitChecklistStatus,type ChecklistItem} from '@/lib/staff/visit-checklist';
import {saveLabStage,readLabStages} from '@/lib/staff/lab-stage-runtime';
import {labStageCommandSchema,memberLabReadSchema,memberLabSummary,staffLabReadSchema,type LabStageCommand,type LabStageResult,type StaffLabRead} from '@/lib/staff/lab-stage-schema';
import {yerevanInputNow,yerevanInputToInstant,yerevanStamp} from '@/lib/staff/yerevan-time';
import type {CareVisit} from '@/lib/staff/visit-evidence-schema';
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true,self:globalThis});

const member='b8000000-0000-4000-8000-000000000001',entry='b8000000-0000-4000-8000-000000000031',visit='b8000000-0000-4000-8000-000000000021';
const atLab={id:'b8000000-0000-4000-8000-000000000051',stage:'at-lab' as const,occurredAt:'2026-10-16T05:00:00+00:00',recordedAt:'2026-10-16T05:01:00+00:00',actor:{name:'Synthetic nurse',role:'nurse' as const}};
const sample=(stages:StaffLabRead['samples'][number]['stages'])=>({entryId:entry,visitId:visit,testId:'cbc',title:null,collectedAt:'2026-10-16T04:00:00+00:00',stages});
const read=(stages:StaffLabRead['samples'][number]['stages']):StaffLabRead=>({version:'lab-stage-v1',memberId:member,revision:1,samples:[sample(stages)]});

// Schemas: order is enforced on read, and commands carry no result or clinical field.
assert.ok(staffLabReadSchema.safeParse(read([atLab])).success);
assert.ok(!staffLabReadSchema.safeParse(read([{...atLab,stage:'results-received'}])).success,'Results cannot precede the lab stage');
assert.ok(!memberLabReadSchema.safeParse({version:'lab-stage-v1',samples:[{...sample([]),stages:[atLab]}]}).success,'Member reads carry no staff identity');
assert.ok(!labStageCommandSchema.safeParse({version:'lab-stage-v1',id:member,submissionId:atLab.id,entryId:entry,stage:'at-lab',occurredAt:'2026-10-16T09:00:00+04:00',result:'normal'}).success,'Commands are strict');
assert.equal(memberLabSummary([]),null);
assert.equal(memberLabSummary([{stages:[]}]),'collected');
assert.equal(memberLabSummary([{stages:[]},{stages:[{stage:'at-lab'}]}]),'partial','One sample at the lab never claims all reached it');
assert.equal(memberLabSummary([{stages:[{stage:'at-lab'}]},{stages:[{stage:'at-lab'},{stage:'results-received'}]}]),'at-lab','An outstanding lab sample keeps processing visible');
assert.equal(memberLabSummary([{stages:[]},{stages:[{stage:'at-lab'},{stage:'results-received'}]}]),'partial','Received results never hide a sample still on its way');
assert.equal(memberLabSummary([{stages:[{stage:'at-lab'},{stage:'results-received'}]}]),'results-received');

// Yerevan time: fixed UTC+04:00, deterministic formatting (no ICU punctuation).
assert.equal(yerevanInputToInstant('2026-10-16T09:05'),'2026-10-16T09:05:00+04:00');
assert.equal(yerevanInputToInstant('2026-10-16T09:05:30'),'2026-10-16T09:05:00+04:00');
assert.equal(yerevanInputToInstant(''),null);assert.equal(yerevanInputToInstant('2026-10-16T25:00'),null);
assert.equal(yerevanInputNow(Date.parse('2026-10-16T20:30:00Z')),'2026-10-17T00:30');
assert.equal(yerevanStamp('2026-10-16T05:00:00+00:00','en'),'16 Oct 2026, 09:00');
assert.equal(yerevanStamp('2026-10-16T05:00:00+00:00','hy'),'16 հոկ 2026, 09:00');

// Runtime: errors map to truthful statuses, and a mismatched receipt is never "saved".
const rpc=(response:{data:unknown;error:{code?:string}|null})=>({rpc:async()=>response});
const command:LabStageCommand={version:'lab-stage-v1',id:member,submissionId:'b8000000-0000-4000-8000-000000000510',entryId:entry,stage:'at-lab',occurredAt:'2026-10-16T09:00:00+04:00'};
assert.deepEqual(await saveLabStage({memberId:member,client:rpc({data:null,error:{code:'42501'}})},command),{status:'access'});
assert.deepEqual(await saveLabStage({memberId:member,client:rpc({data:null,error:{code:'55P03'}})},command),{status:'unavailable'});
assert.deepEqual(await saveLabStage({memberId:member,client:rpc({data:null,error:{code:'08006'}})},command),{status:'outcome-unknown'});
assert.deepEqual(await saveLabStage({memberId:member,client:rpc({data:{status:'saved',submissionId:atLab.id,stageId:atLab.id,revision:2,replayed:false},error:null})},command),{status:'outcome-unknown'},'Foreign receipt is not proof');
assert.equal((await saveLabStage({memberId:member,client:rpc({data:{status:'saved',submissionId:command.submissionId,stageId:atLab.id,revision:2,replayed:true},error:null})},command)).status,'saved');
assert.deepEqual(await saveLabStage({memberId:'b8000000-0000-4000-8000-000000000006',client:rpc({data:null,error:null})},command),{status:'access'},'Command must target the page member');
await assert.rejects(readLabStages({memberId:member,client:rpc({data:{...read([]),memberId:'b8000000-0000-4000-8000-000000000006'},error:null})}),'A read for another member is refused');

// Staff panel: role gates the next action; an unknown outcome resends the same command.
const sent:LabStageCommand[]=[];let reply:LabStageResult={status:'outcome-unknown'};
const port=async(input:LabStageCommand)=>{sent.push(input);return reply;};
const ids={[`${entry}:at-lab`]:'b8000000-0000-4000-8000-000000000520',[`${entry}:results-received`]:'b8000000-0000-4000-8000-000000000521'};
const markup=(role:'nurse'|'doctor',data:StaffLabRead,locale:'en'|'hy'='en')=>renderToStaticMarkup(createElement(LabStages,{data,locale,role,submissionIds:ids,command:port}));
assert.ok(markup('nurse',read([])).includes('Mark as handed to the lab'));
assert.ok(!markup('doctor',read([])).includes('Mark as handed to the lab'),'Doctors do not record lab hand-over');
assert.ok(markup('doctor',read([atLab])).includes('Mark results as received'));
assert.ok(!markup('nurse',read([atLab,{...atLab,id:ids[`${entry}:results-received`],stage:'results-received'}])).includes('Mark'),'No action after results are received');
assert.ok(markup('nurse',read([atLab]),'hy').includes('Լաբորատորիայում է')&&markup('nurse',read([atLab]),'hy').includes('Synthetic nurse, բուժքույր'));
assert.ok(markup('nurse',{...read([]),samples:[]}).includes('No samples are recorded as collected.'));
let view!:ReturnType<typeof create>;
await act(async()=>{view=create(createElement(LabStages,{data:read([]),locale:'en',role:'nurse',submissionIds:ids,command:port}));});
const text=()=>JSON.stringify(view.toJSON());
const button=(label:string)=>view.root.findAllByType('button').find(b=>JSON.stringify(b.props.children).includes(label))!;
await act(async()=>button('Mark as handed to the lab').props.onClick());
await act(async()=>view.root.findByType('form').props.onSubmit({preventDefault(){}}));
assert.equal(sent.length,0);assert.ok(text().includes('Enter when it happened.'),'A missing time is caught before sending');
await act(async()=>view.root.findByProps({type:'datetime-local'}).props.onChange({target:{value:'2026-10-16T09:00'}}));
await act(async()=>view.root.findByType('form').props.onSubmit({preventDefault(){}}));
assert.deepEqual(sent[0],{version:'lab-stage-v1',id:member,submissionId:ids[`${entry}:at-lab`],entryId:entry,stage:'at-lab',occurredAt:'2026-10-16T09:00:00+04:00'});
assert.ok(text().includes('Save outcome unknown'));assert.equal(view.root.findAllByType('form').length,0,'No new entry while the outcome is unknown');
reply={status:'saved',submissionId:ids[`${entry}:at-lab`],stageId:atLab.id,revision:2,replayed:true};
await act(async()=>button('Check again').props.onClick());
assert.deepEqual(sent[1],sent[0],'Check again resends the frozen command');assert.ok(text().includes('Stage recorded.'));
await act(async()=>view.unmount());

// Member Home card: processing only once at the lab; no staff names; HY copy.
const card=(stages:{stage:'at-lab'|'results-received';occurredAt:string}[],locale:'en'|'hy'='en')=>renderToStaticMarkup(createElement(LabStageCard,{samples:[{entryId:entry,visitId:visit,testId:'cbc',title:null,collectedAt:'2026-10-16T04:00:00+00:00',stages}],locale}));
assert.ok(!card([]).includes('being processed'),'A collected sample alone never says processing');
assert.ok(card([]).includes('Your samples were collected'));
assert.ok(card([{stage:'at-lab',occurredAt:atLab.occurredAt}]).includes('Your results are being processed'));
assert.ok(card([{stage:'at-lab',occurredAt:atLab.occurredAt},{stage:'results-received',occurredAt:atLab.occurredAt}]).includes('appear together after approval'));
assert.ok(card([{stage:'at-lab',occurredAt:atLab.occurredAt}],'hy').includes('Ձեր արդյունքները մշակվում են'));
assert.equal(renderToStaticMarkup(createElement(LabStageCard,{samples:[],locale:'en'})),'','No card without a collected sample');
const mixed=renderToStaticMarkup(createElement(LabStageCard,{samples:[{entryId:entry,visitId:visit,testId:'cbc',title:'Complete blood count',collectedAt:atLab.occurredAt,stages:[{stage:'at-lab',occurredAt:atLab.occurredAt},{stage:'results-received',occurredAt:atLab.occurredAt}]},{entryId:atLab.id,visitId:visit,testId:'lipids',title:'Lipid profile',collectedAt:atLab.occurredAt,stages:[]}],locale:'en'}));
assert.ok(mixed.includes('Some of your samples have reached the lab')&&mixed.includes('Others have not reached the lab yet')&&!mixed.includes('being processed'),'Mixed received/collected is truthful per test');
const partial=card([]).length&&renderToStaticMarkup(createElement(LabStageCard,{samples:[{entryId:entry,visitId:visit,testId:'cbc',title:null,collectedAt:atLab.occurredAt,stages:[{stage:'at-lab',occurredAt:atLab.occurredAt}]},{entryId:atLab.id,visitId:visit,testId:'lipids',title:null,collectedAt:atLab.occurredAt,stages:[]}],locale:'en'}));
assert.ok(!String(partial).includes('being processed')&&!String(partial).includes('Your samples have reached the lab'),'Collected plus at-lab never says every sample reached the lab (review F1)');

// Checklist placeholder: ships empty and unapproved until Q2; structure is factual.
assert.equal(visitChecklistStatus.state,'awaiting-q2','Checklist content waits for Q2');
assert.equal(visitChecklist.length,0,'No invented checklist items before Q2');
const items:ChecklistItem[]=[{id:'waist',field:'waist',required:true,label:{en:'Waist',hy:'Գոտկատեղ'}},{id:'neck',field:'neck',required:false,label:{en:'Neck',hy:'Պարանոց'}},{id:'height',field:'height',required:true,label:{en:'Height',hy:'Հասակ'}}];
const actor={id:member,name:'Synthetic nurse',role:'nurse' as const,clinicId:null};
const careVisit:CareVisit={id:visit,createdAt:'2026-10-16T04:00:00+00:00',bookingContext:null,entries:[
 {id:atLab.id,submissionId:atLab.id,observedAt:'2026-10-16T08:00:00+04:00',observedInstant:'2026-10-16T04:00:00+00:00',recordedAt:'2026-10-16T04:00:00+00:00',actor,source:'staff-entered',measurementId:null,payload:{kind:'observation',field:'waist',observedAt:'2026-10-16T08:00:00+04:00',state:'known',value:80,unit:'cm'}},
 {id:entry,submissionId:atLab.id,observedAt:'2026-10-16T08:00:00+04:00',observedInstant:'2026-10-16T04:00:00+00:00',recordedAt:'2026-10-16T04:00:00+00:00',actor,source:'staff-entered',measurementId:null,payload:{kind:'observation',field:'neck',observedAt:'2026-10-16T08:00:00+04:00',state:'unknown',reason:'Synthetic'}}]};
assert.deepEqual(checklistProgress(items,careVisit).map(p=>p.state),['measured','unknown','not-recorded']);
assert.deepEqual(checklistProgress(items,undefined).map(p=>p.state),['not-recorded','not-recorded','not-recorded']);
assert.equal(renderToStaticMarkup(createElement(VisitChecklist,{visit:careVisit,locale:'en'})),'','Placeholder renders nothing');
assert.ok(renderToStaticMarkup(createElement(VisitChecklist,{visit:careVisit,locale:'hy',items,approved:true})).includes('Պարանոց (ոչ պարտադիր)'));
console.log('Lab stages: schemas, Yerevan time, runtime statuses, role-gated staff panel, unknown-outcome resend, member Home states and Q2 checklist placeholder passed.');
