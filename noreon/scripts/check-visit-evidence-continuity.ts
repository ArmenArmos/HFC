/** NV11–NV13/NV15 component regressions: compact history, explicit continuation,
 * fresh read-only props and form-level server errors. Mocked ports, not Auth/DB. */
import assert from'node:assert/strict';import{createElement}from'react';import{create,act,type ReactTestRenderer,type ReactTestInstance}from'react-test-renderer';
import{VisitEvidence}from'@/components/staff/visit-evidence';
import type{VisitRead,VisitCommand,VisitCommandResult,VisitRefreshResult,VisitEvidenceProps,VisitEntry,VisitPayload,CareVisit}from'@/lib/staff/visit-evidence-schema';
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
const id=(n:number)=>`b2600000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const member=id(1),accepted={version:'booking-visit-context-v1' as const,appointmentId:id(2),acceptedRevision:2,tests:[{id:'synthetic',title:'Synthetic lab',method:'lab' as const}]};
const nurseA={id:id(3),name:'Synthetic Nurse A',role:'nurse' as const,clinicId:null},nurseB={id:id(4),name:'Synthetic Nurse B',role:'nurse' as const,clinicId:null};
function entry(n:number,submission:string,payload:VisitPayload,over:Partial<VisitEntry>={}):VisitEntry{return{id:id(n),submissionId:submission,observedAt:payload.observedAt,observedInstant:new Date(payload.observedAt).toISOString(),recordedAt:'2026-10-16T04:39:00Z',actor:nurseA,source:'staff-entered',payload,measurementId:null,...over};}
const at='2026-10-16T08:10:00+04:00',west='2026-10-15T18:00:00-03:30',later='2026-10-16T08:20:00+04:00';
const obs=(field:'height'|'weight'|'systolic'|'diastolic'|'pulse',value:number,unit:'cm'|'kg'|'mmHg'|'beats/min',observedAt=at):VisitPayload=>({kind:'observation',field,observedAt,state:'known',value,unit});
const v1:CareVisit={id:id(10),createdAt:'2026-10-16T04:39:00Z',bookingContext:accepted,entries:[
 entry(100,id(20),obs('systolic',125,'mmHg'),{measurementId:id(30)}),entry(101,id(20),obs('diastolic',80,'mmHg'),{measurementId:id(30)}),entry(102,id(20),obs('pulse',72,'beats/min'),{measurementId:id(30)}),
 entry(103,id(20),{kind:'note',observedAt:at,text:'Synthetic linked note'}),entry(104,id(20),{kind:'collection',observedAt:at,appointmentId:id(2),acceptedRevision:2,testId:'synthetic',outcome:'collected'})]};
const v0:CareVisit={id:id(11),createdAt:'2026-10-16T04:32:00Z',bookingContext:null,entries:[
 entry(110,id(21),obs('height',171.5,'cm',west),{actor:nurseB,recordedAt:'2026-10-16T04:32:00Z'}),entry(111,id(21),obs('pulse',900,'beats/min',west),{actor:nurseB,recordedAt:'2026-10-16T04:32:00Z'}),
 entry(112,id(21),obs('systolic',130,'mmHg',west),{actor:nurseB,recordedAt:'2026-10-16T04:32:00Z'}),
 entry(113,id(21),{kind:'observation',field:'temperature',observedAt:west,state:'unknown',reason:'Synthetic not measured'},{actor:nurseB,recordedAt:'2026-10-16T04:32:00Z'}),
 entry(114,id(22),obs('weight',82,'kg',later),{actor:{...nurseA,name:'Synthetic Nurse A Renamed'},recordedAt:'2026-10-17T00:05:00+04:00'})]};
const e1:CareVisit={id:id(12),createdAt:'2026-10-16T04:54:00Z',bookingContext:accepted,entries:[]},e2:CareVisit={id:id(13),createdAt:'2026-10-16T04:53:00Z',bookingContext:null,entries:[]};
const data:VisitRead={version:'visit-evidence-v1',memberId:member,revision:6,bookingContext:accepted,collectionAvailability:'available',visits:[e1,e2,v1,v0]};
const commands:VisitCommand[]=[];let result:(c:VisitCommand)=>VisitCommandResult=c=>({status:'saved',submissionId:c.submissionId,visitId:c.visitId,revision:c.revision+1,entryIds:[id(900)],replayed:false});let refreshResult:VisitRefreshResult={status:'unavailable'};
const props=(over:Partial<VisitEvidenceProps>={}):VisitEvidenceProps=>({data,locale:'en',actorScope:'synthetic-session',canRecord:true,visitId:id(40),openSubmissionId:id(41),appendSubmissionId:id(42),command:async c=>{commands.push(c);return result(c);},refresh:async()=>refreshResult,...over});
const trees:ReactTestRenderer[]=[],focused:string[]=[];
async function mount(p:VisitEvidenceProps){let tree!:ReactTestRenderer;await act(async()=>{tree=create(createElement(VisitEvidence,p),{createNodeMock:node=>{const props=node.props as {'aria-label'?:string;role?:string};return{focus(){focused.push(String(props['aria-label']??props.role??node.type));},scrollIntoView(){}};}});});trees.push(tree);return tree;}
const label=(node:ReactTestInstance):string=>node.children.map(child=>typeof child==='string'?child:label(child)).join('');
const text=(tree:ReactTestRenderer)=>label(tree.root);
const buttons=(tree:ReactTestRenderer,name:string)=>tree.root.findAllByType('button').filter(b=>label(b).includes(name));
const button=(tree:ReactTestRenderer,name:string)=>buttons(tree,name)[0];
const row=(tree:ReactTestRenderer,name:string)=>tree.root.findAllByType('button').find(b=>b.props['aria-expanded']!==undefined&&label(b).includes(name));
const panel=(tree:ReactTestRenderer,trigger:ReactTestInstance)=>tree.root.find(node=>node.props.id===trigger.props['aria-controls']);
async function click(node:ReactTestInstance){await act(async()=>node.props.onClick());}
async function change(tree:ReactTestRenderer,name:string,value:string){await act(async()=>tree.root.findByProps({'aria-label':name}).props.onChange({target:{value}}));}
async function submit(tree:ReactTestRenderer){await act(async()=>tree.root.findByType('form').props.onSubmit({preventDefault(){}}));}
const alerts=(tree:ReactTestRenderer)=>tree.root.findAll(node=>node.type==='div'&&node.props.role==='alert');
try{
 // NV11 compact doctor history.
 const doctor=await mount(props({canRecord:false}));const all=text(doctor);
 assert.ok(!doctor.root.findByProps({'aria-label':'Visit evidence'}).props.className.includes('mx-auto'),'Card is left-aligned with staff sections');
 assert.ok(!all.includes('Staff-entered'),'No repeated source caption');
 assert.ok(all.includes('2 visit records opened without entries'),'Empty opened records are grouped, not discarded');
 const linkedRow=row(doctor,'Blood pressure 125/80 mmHg'),unlinkedRow=row(doctor,'Height 171.5 cm'),emptyRow=row(doctor,'2 visit records opened without entries');assert.ok(linkedRow&&unlinkedRow&&emptyRow);
 assert.equal(linkedRow.props['aria-expanded'],true,'Newest meaningful visit expanded');assert.equal(unlinkedRow.props['aria-expanded'],false);assert.equal(emptyRow.props['aria-expanded'],false);
 assert.ok(label(linkedRow).includes('08:10 UTC+04:00'),'Row shows literal observation time');assert.ok(!label(linkedRow).includes('04:39'),'Record-opened time is not shown as the observation time');
 const linkedPanel=label(panel(doctor,linkedRow));
 assert.ok(linkedPanel.includes('Blood pressure 125/80 mmHg · pulse 72 beats/min'),'Linked same-measurement BP is one line');assert.ok(!linkedPanel.includes('Systolic'),'Linked BP not repeated as atomic rows');
 assert.equal(linkedPanel.split('Synthetic Nurse A, Nurse').length-1,1,'Identical submission attribution appears once');
 assert.ok(linkedPanel.includes('Record opened')&&linkedPanel.includes('16 Oct 2026, 04:39 UTC+00:00'),'Record opened time is labelled in details');assert.ok(linkedPanel.includes('Linked booking, accepted version 2'),'Immutable visit link visible');
 assert.ok(linkedPanel.includes('Synthetic lab: Collected')&&linkedPanel.includes('Synthetic linked note'));
 assert.ok(label(unlinkedRow).includes('2 observation times'),'Different literal observed values are not merged');assert.ok(label(unlinkedRow).includes('Synthetic Nurse B')&&label(unlinkedRow).includes('Synthetic Nurse A Renamed'),'Different names preserved');assert.ok(label(unlinkedRow).includes('No linked booking'));
 assert.equal(doctor.root.findAll(node=>node.props.id===unlinkedRow.props['aria-controls']).length,0,'Older record collapsed');
 await click(unlinkedRow);const unlinkedPanel=label(panel(doctor,row(doctor,'Height 171.5 cm')!));
 for(const fact of['Pulse: 900 beats/min','Systolic: 130 mmHg','Temperature: unknown (Synthetic not measured)','18:00 UTC-03:30','08:20 UTC+04:00','17 Oct 2026, 00:05 UTC+04:00','Synthetic Nurse A Renamed, Nurse','Synthetic Nurse B, Nurse','No linked booking'])assert.ok(unlinkedPanel.includes(fact),`Raw fact preserved: ${fact}`);
 const exactToggles=doctor.root.findAllByType('button').filter(b=>b.props['aria-pressed']!==undefined);assert.equal(exactToggles.length,1,'One history-level exact-times toggle');assert.ok(!text(doctor).includes('2026-10-16T08:10:00+04:00'));await click(exactToggles[0]);assert.equal(doctor.root.findAllByType('button').find(b=>b.props['aria-pressed']!==undefined)!.props['aria-pressed'],true);assert.ok(text(doctor).includes('2026-10-16T08:10:00+04:00')&&text(doctor).includes('2026-10-15T18:00:00-03:30'),'Exact ISO values available');
 await click(row(doctor,'2 visit records opened without entries')!);const emptyPanel=label(panel(doctor,row(doctor,'2 visit records opened without entries')!));assert.ok(emptyPanel.includes('04:54 UTC+00:00')&&emptyPanel.includes('04:53 UTC+00:00')&&emptyPanel.includes('Linked booking, accepted version 2')&&emptyPanel.includes('No linked booking'),'Exact empty-record detail retained');
 assert.equal(buttons(doctor,'Add to this record').length,0,'Doctor has no continuation control');

 // NV13 read-only refresh adopts fresh history without a retained-entries alert.
 const freshNote=entry(120,id(23),{kind:'note',observedAt:'2026-10-16T09:00:00+04:00',text:'Fresh doctor-visible note'});
 await act(async()=>doctor.update(createElement(VisitEvidence,props({canRecord:false,data:{...data,revision:7,visits:[{...v1,id:id(15),createdAt:'2026-10-16T05:00:00Z',entries:[freshNote]},...data.visits]},visitId:id(43),openSubmissionId:id(44),appendSubmissionId:id(45)}))));
 assert.equal(alerts(doctor).length,0,'Doctor refresh shows no false retained-entries alert');assert.ok(text(doctor).includes('Fresh doctor-visible note'),'Doctor adopts fresh history');

 // NV13 idle nurse adopts fresh props and starts with fresh IDs.
 const idle=await mount(props());await act(async()=>idle.update(createElement(VisitEvidence,props({data:{...data,revision:7},visitId:id(46),openSubmissionId:id(47),appendSubmissionId:id(48)}))));
 assert.equal(alerts(idle).length,0,'Idle nurse adopts fresh props silently');await click(button(idle,'Start new visit'));const opened=commands.at(-1)!;assert.equal(opened.op,'open-visit');assert.equal(opened.revision,7);assert.equal(opened.visitId,id(46));assert.equal(opened.submissionId,id(47));
 // Dirty opened nurse keeps protection and draft.
 const dirty=await mount(props({visitId:id(10)}));await change(dirty,'Height','170');await act(async()=>dirty.update(createElement(VisitEvidence,props({data:{...data,revision:7},visitId:id(46),openSubmissionId:id(47),appendSubmissionId:id(48)}))));assert.equal(alerts(dirty).length,1,'Draft remains protected');assert.equal(dirty.root.findByProps({'aria-label':'Height'}).props.value,'170');assert.equal(dirty.root.findAllByProps({type:'submit'}).length,0,'Stale draft cannot save');assert.ok(button(dirty,'Check saved evidence'));
 const quiet=await mount(props({visitId:id(10)}));await act(async()=>quiet.update(createElement(VisitEvidence,props({data:{...data,revision:7},visitId:id(46),openSubmissionId:id(47),appendSubmissionId:id(48)}))));assert.equal(alerts(quiet).length,1,'Explicit opened record is not silently replaced');assert.equal(quiet.root.findAllByType('form').length,1);

 // NV12 explicit add to an existing linked record; selecting writes nothing.
 const add=await mount(props());assert.ok(button(add,'Start new visit'));const before=commands.length;await click(button(add,'Add to this record'));assert.equal(commands.length,before,'Selecting a record writes nothing');
 assert.ok(text(add).includes('Adding to the record opened'),'Selected record is explicit');assert.equal(add.root.findAllByProps({'aria-label':'Synthetic lab'}).length,1,'Linked record with current accepted version keeps collection');
 await change(add,'Observed at','2026-10-16T10:00');await change(add,'Height','172');await submit(add);let last=commands.at(-1)!;assert.equal(last.op,'append-evidence');assert.equal(last.visitId,id(10));assert.equal(last.submissionId,id(42));assert.equal(last.revision,6);
 // Unlinked and old accepted records never gain current collection eligibility.
 const addNull=await mount(props());await click(row(addNull,'Height 171.5 cm')!);await click(buttons(addNull,'Add to this record').find(b=>panel(addNull,row(addNull,'Height 171.5 cm')!).findAll(n=>n===b).length)!);assert.equal(addNull.root.findAllByProps({'aria-label':'Synthetic lab'}).length,0,'NULL record has no collection');await change(addNull,'Observed at','2026-10-16T10:00');await change(addNull,'Pulse','70');await submit(addNull);assert.equal(commands.at(-1)!.visitId,id(11));
 const oldVisit={...v1,id:id(16),bookingContext:{...accepted,acceptedRevision:1}};const addOld=await mount(props({data:{...data,visits:[oldVisit]}}));await click(button(addOld,'Add to this record'));assert.equal(addOld.root.findAllByProps({'aria-label':'Synthetic lab'}).length,0,'Old accepted version record has no current collection');
 const addEmpty=await mount(props());await click(row(addEmpty,'2 visit records opened without entries')!);const emptyAdds=buttons(addEmpty,'Add to this record').filter(b=>panel(addEmpty,row(addEmpty,'2 visit records opened without entries')!).findAll(n=>n===b).length);assert.equal(emptyAdds.length,2);await click(emptyAdds[0]);await change(addEmpty,'Observed at','2026-10-16T10:00');await change(addEmpty,'Weight','80');await submit(addEmpty);assert.equal(commands.at(-1)!.visitId,id(12),'Empty opened record can be explicitly continued');

 // NV12 saved outcome offers Add to this record only after actually fresh props.
 const cont=await mount(props({visitId:id(10)}));await change(cont,'Observed at','2026-10-16T10:00');await change(cont,'Height','172');await submit(cont);const saved=commands.at(-1)!;assert.equal(saved.submissionId,id(42));
 refreshResult={status:'loaded',data:{...data,revision:7},receipt:{status:'committed',submissionId:id(42),visitId:id(10),revision:7,entryIds:[id(900)]}};await click(button(cont,'Check saved evidence'));
 assert.equal(button(cont,'Add to this record').props.disabled,true,'Stale props cannot continue');assert.equal(button(cont,'Start a new entry').props.disabled,true);
 await act(async()=>cont.update(createElement(VisitEvidence,props({data:{...data,revision:7},visitId:id(50),openSubmissionId:id(51),appendSubmissionId:id(42)}))));assert.equal(button(cont,'Add to this record').props.disabled,true,'Used append ID is never reused');
 await act(async()=>cont.update(createElement(VisitEvidence,props({data:{...data,revision:7},visitId:id(50),openSubmissionId:id(51),appendSubmissionId:id(52)}))));const n=commands.length;await click(button(cont,'Add to this record'));assert.equal(commands.length,n,'Continuing writes nothing');
 assert.equal(cont.root.findByProps({'aria-label':'Height'}).props.value,'','Saved form cleared');assert.equal(cont.root.findAllByProps({'aria-label':'Synthetic lab'}).length,1);await change(cont,'Observed at','2026-10-16T11:00');await change(cont,'Weight','81');await submit(cont);last=commands.at(-1)!;assert.equal(last.visitId,id(10));assert.equal(last.submissionId,id(52));assert.equal(last.revision,7);
 // Accepted v1→v2 between save and continuation: same record keeps its own link without collection.
 const moved=await mount(props({visitId:id(10)}));await change(moved,'Observed at','2026-10-16T10:00');await change(moved,'Height','172');await submit(moved);refreshResult={status:'loaded',data:{...data,revision:7},receipt:{status:'committed',submissionId:id(42),visitId:id(10),revision:7,entryIds:[id(900)]}};await click(button(moved,'Check saved evidence'));
 await act(async()=>moved.update(createElement(VisitEvidence,props({data:{...data,revision:8,bookingContext:{...accepted,acceptedRevision:3}},visitId:id(53),openSubmissionId:id(54),appendSubmissionId:id(55)}))));await click(button(moved,'Add to this record'));assert.equal(moved.root.findAllByProps({'aria-label':'Synthetic lab'}).length,0,'Continuation never rebinds to the newer accepted version');
 // Start a new entry remains a separate explicit path to a fresh visit.
 const fresh=await mount(props({visitId:id(10)}));await change(fresh,'Observed at','2026-10-16T10:00');await change(fresh,'Height','172');await submit(fresh);refreshResult={status:'loaded',data:{...data,revision:7},receipt:{status:'committed',submissionId:id(42),visitId:id(10),revision:7,entryIds:[id(900)]}};await click(button(fresh,'Check saved evidence'));
 await act(async()=>fresh.update(createElement(VisitEvidence,props({data:{...data,revision:7},visitId:id(56),openSubmissionId:id(57),appendSubmissionId:id(58)}))));const m=commands.length;await click(button(fresh,'Start a new entry'));assert.equal(commands.length,m);await click(button(fresh,'Start new visit'));last=commands.at(-1)!;assert.equal(last.op,'open-visit');assert.equal(last.visitId,id(56));assert.equal(last.submissionId,id(57));

 // NV13 retired retained draft may select at the same context, never bypass a later stale fence.
 result=()=>({status:'outcome-unknown'});
 const retained=await mount(props({visitId:id(10)}));await change(retained,'Observed at','2026-10-16T10:00');await change(retained,'Height','171');await submit(retained);
 refreshResult={status:'loaded',data,receipt:{status:'not-recorded',submissionId:id(42),serialized:true}};await click(button(retained,'Check saved evidence'));
 await act(async()=>retained.update(createElement(VisitEvidence,props({visitId:id(60),openSubmissionId:id(61),appendSubmissionId:id(62)}))));await click(button(retained,'Continue with my entries'));
 assert.ok(buttons(retained,'Add to this record').length,'Recovered draft can explicitly select a record at its checked revision');
 await act(async()=>retained.update(createElement(VisitEvidence,props({data:{...data,revision:7},visitId:id(63),openSubmissionId:id(64),appendSubmissionId:id(65)}))));
 assert.equal(alerts(retained).length,1,'Retained draft detects the later context change');assert.equal(buttons(retained,'Add to this record').length,0,'History selection cannot bypass stale retained-draft recovery');assert.equal(retained.root.findAllByProps({type:'submit'}).length,0);assert.ok(button(retained,'Check saved evidence'));
 // NV15 empty server path is a form-level error; known paths and BP pair checks stay specific.
 result=()=>({status:'invalid',issues:[{path:'',message:'Synthetic server rejection'}]});
 const generic=await mount(props({visitId:id(10)}));await change(generic,'Observed at','2026-10-16T10:00');await change(generic,'Height','172');focused.length=0;await submit(generic);
 assert.equal(generic.root.findByProps({'aria-label':'Systolic'}).props['aria-invalid'],false,'No false systolic highlight');assert.equal(generic.root.findByProps({'aria-label':'Diastolic'}).props['aria-invalid'],false);assert.ok(label(alerts(generic)[0]).includes('This entry was not accepted. Check the details and try again.'));assert.equal(focused.at(-1),'alert','Form-level error focuses the status');
 result=()=>({status:'invalid',issues:[{path:'entries.0',message:'Synthetic field rejection'}]});const known=await mount(props({visitId:id(10)}));await change(known,'Observed at','2026-10-16T10:00');await change(known,'Height','172');focused.length=0;await submit(known);assert.equal(known.root.findByProps({'aria-label':'Height'}).props['aria-invalid'],true);assert.equal(known.root.findByProps({'aria-label':'Systolic'}).props['aria-invalid'],false);assert.equal(focused.at(-1),'Height');
 result=()=>({status:'invalid',issues:[{path:'entries',message:'Synthetic pair rejection'}]});const pair=await mount(props({visitId:id(10)}));await change(pair,'Observed at','2026-10-16T10:00');await change(pair,'Systolic','125');await change(pair,'Diastolic','80');await submit(pair);assert.equal(pair.root.findByProps({'aria-label':'Systolic'}).props['aria-invalid'],true,'Server pair issue keeps BP highlight');assert.equal(pair.root.findByProps({'aria-label':'Diastolic'}).props['aria-invalid'],true);
 const client=await mount(props({visitId:id(10)}));await change(client,'Observed at','2026-10-16T10:00');await change(client,'Systolic','80');await change(client,'Diastolic','120');const c=commands.length;await submit(client);assert.equal(commands.length,c,'Client pair check blocks the call');assert.equal(client.root.findByProps({'aria-label':'Systolic'}).props['aria-invalid'],true);assert.equal(client.root.findByProps({'aria-label':'Diastolic'}).props['aria-invalid'],true);
 console.log('Visit continuity PASS: compact grouped history with raw facts and one exact toggle, explicit Add to this record/Start new visit with fresh IDs and immutable links, read-only/idle fresh-prop adoption with protected drafts, form-level empty server path. Mocked ports, not Auth/DB/browser.');
}finally{for(const tree of trees)await act(async()=>tree.unmount());}
