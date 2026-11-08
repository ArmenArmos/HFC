import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
assert.ok(existsSync('lib/staff-zoe/plan-ready.ts'),'The plan card needs a shared projection of current result matches and consultation proposal');
const {matchedPlanResults,consultationProposal,planLabFiles}=await import('@/lib/staff-zoe/plan-ready');
assert.deepEqual(planLabFiles(null),[]);
assert.deepEqual(planLabFiles(undefined),[]);
const {staffLabResultsSchema}=await import('@/lib/lab-ai/staff-results');
const filesInput={version:'staff-lab-ai-v1',enabled:true,viewer:'doctor',memberUploads:[],clinic:[{fileId:'e1a00000-0000-4000-8000-000000000001',name:'Lab.pdf',clinic:'Clinic',uploadedAt:'2026-11-07T08:00:00Z',job:null,values:[]}]};
const validatedFiles=staffLabResultsSchema.parse(filesInput);
assert.deepEqual(planLabFiles(validatedFiles),[{fileId:validatedFiles.clinic[0].fileId,fileName:'Lab.pdf',needsReview:false}]);
assert.deepEqual(planLabFiles({...validatedFiles,enabled:false}),[]);
assert.equal(staffLabResultsSchema.safeParse({...filesInput,clinic:[{...filesInput.clinic[0],fileId:'invalid'}]}).success,false,'Invalid file IDs cannot become plan links');
const test={id:'tsh',title:'Thyroid function',method:'lab' as const};
const value={id:'value',seq:1,reviewedAt:'2026-11-07T08:00:00Z',name:'TSH',valueText:'2',value:2,unit:null,reference:null,collectedOn:'2026-11-07',laboratory:null};
const source={attachmentId:'attachment',fileId:'file',fileName:'Thyroid.pdf',clinic:'Clinic',attachedAt:'2026-11-07T08:00:00Z',values:[value]};
assert.equal(matchedPlanResults([test],[source],'2026-11-07T00:00:00Z')[0].source?.fileName,'Thyroid.pdf');
assert.equal(matchedPlanResults([test],[],'2026-11-07T00:00:00Z')[0].reason,'missing');
assert.equal(matchedPlanResults([test],[{...source,values:[{...value,collectedOn:'2026-11-06'}]}],'2026-11-07T00:00:00Z')[0].reason,'before');
assert.equal(matchedPlanResults([{...test,id:'lipid-panel'}],[source],'2026-11-07T00:00:00Z')[0].source,null,'Incomplete panels cannot supply a result');
assert.equal(consultationProposal(null,null),null,'No field means no invented proposal');
for(const urgency of ['green','yellow','orange'])for(const sentence of [null,undefined,'','  '])assert.equal(consultationProposal(urgency,sentence),null,'Urgency alone never supplies a consultation reason or decision');
assert.deepEqual(consultationProposal('yellow','Medical consultation within 14 days'),{decision:'required',note:'Medical consultation within 14 days'});
assert.deepEqual(consultationProposal('green','Routine follow-up'),{decision:null,note:'Routine follow-up'},'Routine follow-up does not state that consultation is not required');
assert.deepEqual(consultationProposal('yellow','Routine follow-up'),{decision:null,note:'Routine follow-up'},'Urgency does not invent a decision either');
for(const sentence of ['Բժշկի խորհրդատվություն՝ 2 շաբաթվա ընթացքում','Консультация врача в течение 2 недель'])assert.equal(consultationProposal('yellow',sentence)?.note,sentence,'Keep the actual sentence in its original language');
// Never turn routine follow-up into a claim that consultation is unnecessary.
for(const sentence of ['No consultation is needed.','Խորհրդատվություն անհրաժեշտ չէ։','Консультация не требуется.']){
 assert.deepEqual(consultationProposal('green',sentence),{decision:'not-required',note:sentence});
 assert.equal(consultationProposal('orange',sentence)?.decision,null,'Urgency must defeat a contradictory sentence');
}
assert.equal(consultationProposal('green','x'.repeat(2001)),null,'Do not truncate a clinical sentence to fit the server limit');
console.log('Plan ready projection: complete reviewed files, eligible dates and draft-only consultation proposals.');
assert.ok(existsSync('components/doctor-chat-v2/plan-ready-card.tsx'),'The checklist must be a mounted card, not just a data helper');
const React=await import('react');
const {create,act}=await import('react-test-renderer');
const {renderToStaticMarkup}=await import('react-dom/server');
const {PlanReadyCard,PlanLabFileLinks}=await import('@/components/doctor-chat-v2/plan-ready-card');
const {fixtureAiPlan,fixturePlan,fixtureLab}=await import('../e2e/doctor-chat-v2/data');
const labsWithValues=staffLabResultsSchema.parse({...filesInput,clinic:[{...filesInput.clinic[0],values:fixtureLab().values}]});
assert.equal(planLabFiles(labsWithValues)[0].needsReview,true);
assert.equal(planLabFiles({...labsWithValues,clinic:labsWithValues.clinic.map(file=>({...file,values:file.values.map(value=>({...value,status:'auto_accepted' as const}))}))})[0].needsReview,false,'Rule-confirmed values do not add a review link in the header');
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
const id='11111111-1111-4111-8111-111111111111';
const approvals=fixturePlan(id);
approvals.regimen!.review.versions=[];
approvals.regimen!.review.draft!.medicines=[];
approvals.regimen!.clinicalReview!.consultation.decision='not-required';
approvals.consultation!.review.consultation.decision='not-required';
const draft={...fixtureAiPlan(id),savedDraftCurrent:true,ready:{results:[],sourcesAvailable:true,reviewCurrent:true,urgency:'green' as const,proposal:{decision:'not-required' as const,note:'Routine review within 12 months'}}};
const props={draft,approvals,locale:'en' as const,urgent:false,urgentReason:'An urgent alert is open.',unavailable:false,formId:'draft',onReviewLabs(){},onDetails(){},async onRecord(){},async onPress(){return {ok:true,message:''};},async onRefresh(){}};
let tree:ReturnType<typeof create>;
await act(async()=>{tree=create(React.createElement(PlanReadyCard,props));});
const primary=()=>tree!.root.findAllByType('button').find(b=>b.props.className?.split(' ').includes('w-full'))!;
assert.equal(primary().props.children,'Approve and publish');
assert.equal(primary().props.disabled,false);
await act(async()=>tree!.update(React.createElement(PlanReadyCard,{...props,urgent:true})));
assert.equal(primary().props.disabled,true,'An urgent alert never allows publication');
assert.ok(JSON.stringify(tree!.toJSON()).includes('An urgent alert is open.'));
for(const locale of ['en','hy','ru'] as const){const html=renderToStaticMarkup(React.createElement(PlanReadyCard,{...props,locale}));assert.ok(html.includes('data-plan-ready="true"'));}
await act(async()=>tree!.unmount());
console.log('Mounted plan card: all-green publication, urgent refusal and three languages.');
for(const locale of ['en','hy','ru'] as const)for(const count of [0,1,2]){
 const labFiles=Array.from({length:count},(_,i)=>({fileId:`e1a00000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,fileName:`Lab ${i+1}.pdf`,needsReview:true}));
 const linkDraft={...draft,ready:{...draft.ready,labFiles,results:[{...test,source:null,reason:'missing' as const,recorded:false}]}};
 await act(async()=>{tree=create(React.createElement(PlanReadyCard,{...props,locale,draft:linkDraft}));});
 const label=locale==='en'?'Open the lab file':locale==='hy'?'Բացել լաբորատոր ֆայլը':'Открыть файл анализов';
 const checkLinks=(root:typeof tree.root)=>{
  const links=root.findAllByType('a').filter(a=>String(a.props.href).endsWith('/check'));
  assert.equal(links.length,count);
  links.forEach((link,i)=>{
   assert.equal(link.props.href,`/staff/real/members/${id}/documents/${labFiles[i].fileId}/check`);
   assert.equal(link.props.target,undefined,'Match Overview: open the lab check in the same tab');
   assert.ok(JSON.stringify(link.props.children).includes(label));
   assert.ok(JSON.stringify(link.props.children).includes(labFiles[i].fileName));
  });
 };
 checkLinks(tree!.root.findByProps({'data-slot':'card-header'}));
 checkLinks(tree!.root.findByProps({'data-check':'values'}));
 checkLinks(tree!.root.findByProps({'data-check':'results'}));
 // Reviewed files still help with missing results, but no longer belong in the header or values row.
 await act(async()=>tree!.update(React.createElement(PlanReadyCard,{...props,locale,draft:{...linkDraft,ready:{...linkDraft.ready,labFiles:labFiles.map(file=>({...file,needsReview:false}))}}})));
 assert.equal(tree!.root.findByProps({'data-slot':'card-header'}).findAllByType('a').length,0);
 assert.equal(tree!.root.findByProps({'data-check':'values'}).findAllByType('a').length,0);
 checkLinks(tree!.root.findByProps({'data-check':'results'}));
 await act(async()=>tree!.update(React.createElement(PlanReadyCard,{...props,locale,draft:{...linkDraft,ready:{...linkDraft.ready,labFiles:labFiles.map(file=>({...file,needsReview:false})),results:[]}}})));
 assert.equal(tree!.root.findAllByType('a').filter(a=>String(a.props.href).endsWith('/check')).length,0,'No review or missing lab result means no lab file links');
 await act(async()=>tree!.unmount());
}
console.log('Mounted lab links: zero, one and two files, reviewed and unreviewed, in all three languages.');
for(const [fields,detail,status] of [
 [{explanation:'accepted',instructions:'accepted'},'All accepted','green'],
 [{explanation:'accepted',followUp:'edited'},'1 edited','green'],
 [{explanation:'accepted',followUp:'rejected'},'1 rejected (they will not be saved)','amber'],
 [{explanation:'accepted',followUp:'not-decided'},'1 still to decide','amber'],
] as const){
 await act(async()=>{tree=create(React.createElement(PlanReadyCard,{...props,editor:{dirty:false,pending:false,blocked:false,fields,excludedFields:['followUp']}}));});
 const row=tree!.root.findByProps({'data-check':'fields'});
 assert.equal(row.props['data-state'],status);
 assert.ok(JSON.stringify(row.findAllByType('p').map(p=>p.props.children)).includes(detail));
 await act(async()=>tree!.unmount());
}
for(const locale of ['en','hy','ru'] as const){
 const needsConsultation={...approvals,consultation:{...approvals.consultation!,review:{...approvals.consultation!.review,consultation:{decision:'undecided' as const}}}};
 const noSentence={...draft,ready:{...draft.ready,urgency:'yellow' as const,proposal:null}};
 await act(async()=>{tree=create(React.createElement(PlanReadyCard,{...props,locale,draft:noSentence,approvals:needsConsultation}));});
 assert.equal(tree!.root.findByType('select').props.value,'');
 assert.equal(tree!.root.findByType('textarea').props.value,'');
 assert.equal(primary().props.disabled,true,'A missing sentence requires the doctor’s decision and reason');
 await act(async()=>tree!.root.findByType('select').props.onChange({target:{value:'not-required'}}));
 assert.equal(primary().props.disabled,true,'Choosing a decision without a reason is insufficient');
 await act(async()=>tree!.root.findByType('textarea').props.onChange({target:{value:'  '}}));
 assert.equal(primary().props.disabled,true,'Whitespace is not a clinical reason');
 await act(async()=>tree!.root.findByType('textarea').props.onChange({target:{value:'Doctor-entered reason'}}));
 assert.equal(primary().props.disabled,false);
 await act(async()=>tree!.unmount());
 const proposal=consultationProposal('yellow','Medical consultation within 14 days');
 await act(async()=>{tree=create(React.createElement(PlanReadyCard,{...props,locale,draft:{...draft,ready:{...draft.ready,proposal}},approvals:needsConsultation}));});
 assert.equal(tree!.root.findByType('textarea').props.value,proposal!.note);
 const {PLAN_SHOWN_IN_ENGLISH}=await import('@/lib/ai-plan/language');
 assert.equal(JSON.stringify(tree!.toJSON()).includes(PLAN_SHOWN_IN_ENGLISH[locale]),locale!=='en');
 await act(async()=>tree!.unmount());
}
// A single explicit press records the exact proposal; edits remove its attribution.
for(const locale of ['en','hy','ru'] as const){
 const proposal={decision:'not-required' as const,note:'No consultation is needed.'};
 const undecided=structuredClone(approvals);undecided.consultation!.review.consultation={decision:'undecided'};
 const commands:unknown[]=[];
 const proposedProps={...props,locale,approvals:undecided,draft:{...draft,ready:{...draft.ready,proposal}},async onPress(command:unknown){commands.push(command);return {ok:true,message:'Saved'};}};
 await act(async()=>{tree=create(React.createElement(PlanReadyCard,proposedProps));});
 const attribution=locale==='en'?"Zoe's proposal":locale==='hy'?'Զոյայի առաջարկը':'Предложение Zoe';
 assert.equal(tree!.root.findByType('select').props.value,'not-required');
 assert.equal(tree!.root.findByType('textarea').props.value,proposal.note);
 assert.ok(JSON.stringify(tree!.toJSON()).includes(attribution));
 assert.equal(commands.length,0,'Rendering never records the doctor act');
 await act(async()=>primary().props.onClick());
 assert.deepEqual(commands,[{kind:'consultation-decision',context:undecided.consultation!.context,decision:'not-required',note:'No consultation is needed.'}]);
 await act(async()=>{tree!.unmount();tree=create(React.createElement(PlanReadyCard,proposedProps));});
 await act(async()=>tree!.root.findByType('select').props.onChange({target:{value:'required'}}));
 assert.ok(!JSON.stringify(tree!.toJSON()).includes(attribution),'An override is no longer Zoe’s proposal');
 await act(async()=>tree!.root.findByType('textarea').props.onChange({target:{value:'Doctor override reason'}}));
 await act(async()=>primary().props.onClick());
 assert.equal((commands.at(-1) as {decision:string}).decision,'required');
 assert.equal((commands.at(-1) as {note:string}).note,'Doctor override reason');
 for(const withdrawal of ['missing','abnormal'] as const)for(const edit of ['untouched','reason','decision','both'] as const){
  await act(async()=>{tree!.unmount();tree=create(React.createElement(PlanReadyCard,proposedProps));});
  const decisionEdited=edit==='decision'||edit==='both',reasonEdited=edit==='reason'||edit==='both';
  if(decisionEdited)await act(async()=>tree!.root.findByType('select').props.onChange({target:{value:edit==='both'?'required':'not-required'}}));
  if(reasonEdited)await act(async()=>tree!.root.findByType('textarea').props.onChange({target:{value:'Doctor-entered reason'}}));
  const withdrawn=structuredClone(undecided);
  if(withdrawal==='abnormal'){
   withdrawn.consultation!.review.engine.tests=[{id:'ecg-12-lead',title:'ECG',method:'clinic'}];
   withdrawn.consultation!.review.evidenceReceipts={'ecg-12-lead':{source:'investigation',sourceId:id,actorId:id,at:'2026-11-07T00:00:00Z',snapshot:{result:'abnormal'}}};
  }
  await act(async()=>tree!.update(React.createElement(PlanReadyCard,{...proposedProps,approvals:withdrawn,draft:{...proposedProps.draft,ready:{...proposedProps.draft.ready,proposal:withdrawal==='missing'?null:proposal}}})));
  assert.equal(tree!.root.findByType('select').props.value,decisionEdited?(edit==='both'?'required':'not-required'):'',`${withdrawal}/${edit}: only a doctor-chosen decision survives withdrawal`);
  assert.equal(tree!.root.findByType('textarea').props.value,reasonEdited?'Doctor-entered reason':'',`${withdrawal}/${edit}: only an edited reason survives withdrawal`);
  assert.equal(primary().props.disabled,!(decisionEdited&&reasonEdited),'Incomplete decisions disable Save');
  const beforeWithdrawalSubmit:number=commands.length;
  await act(async()=>primary().props.onClick({preventDefault(){}}));
  assert.equal(commands.length,beforeWithdrawalSubmit+(decisionEdited&&reasonEdited?1:0),'Withdrawal cannot submit an untouched automatic decision');
  if(decisionEdited&&reasonEdited)assert.equal((commands.at(-1) as {decision:string}).decision,'required');
 }
 // Re-render a newly unsafe read: old defaults must not remain actionable.
 for(const unsafe of ['urgent','orange','abnormal','missing-evidence','stale','unknown'] as const){
  await act(async()=>{tree!.unmount();tree=create(React.createElement(PlanReadyCard,proposedProps));});
  const unsafeApprovals=structuredClone(undecided);
  if(unsafe==='missing-evidence')unsafeApprovals.consultation!.review.engine.tests=[{id:'ecg-12-lead',title:'ECG',method:'clinic'}];
  if(unsafe==='abnormal'){
   unsafeApprovals.consultation!.review.engine.tests=[{id:'ecg-12-lead',title:'ECG',method:'clinic'}];
   unsafeApprovals.consultation!.review.evidenceReceipts={'ecg-12-lead':{source:'investigation',sourceId:id,actorId:id,at:'2026-11-07T00:00:00Z',snapshot:{result:'abnormal'}}};
  }
  await act(async()=>tree!.update(React.createElement(PlanReadyCard,{...proposedProps,approvals:unsafeApprovals,urgent:unsafe==='urgent',draft:{...proposedProps.draft,stale:unsafe==='stale',ready:{...proposedProps.draft.ready,urgency:unsafe==='orange'?'orange':unsafe==='unknown'?null:'green'}}})));
  assert.equal(tree!.root.findByType('select').props.value,'',unsafe+' cannot keep not-required selected');
 }
 await act(async()=>tree!.unmount());
}
await act(async()=>{tree=create(React.createElement(PlanReadyCard,{...props,editor:{dirty:true,pending:false,blocked:false}}));});
assert.equal(primary().props.children,'Use this draft','Editing after saving requires a new save before publication');
await act(async()=>tree!.unmount());
// Exercise the actual chat entry point and DraftForm with only external IO replaced.
const {readFileSync}=await import('node:fs');
const vm=await import('node:vm');
const {default:ts}=await import('typescript');
const jsx=await import('react/jsx-runtime');
const io=await import('../e2e/doctor-chat-v2/actions');
const documentFixture=Object.assign(new EventTarget(),{getElementById:()=>({requestSubmit(){
 const form=screen!.root.findByProps({id:screen!.root.findByType(PlanReadyCard).props.formId});
 const fields=Object.fromEntries(form.findAll(node=>(node.type==='input'||node.type==='textarea')&&!!node.props.name).map(node=>[node.props.name,node.props.value??'']));
 form.props.onSubmit({preventDefault(){},currentTarget:{fields}});
}})});
const modules:Record<string,unknown>={react:React,'react/jsx-runtime':jsx,
 'next/navigation':{useRouter:()=>({refresh(){}}),unstable_rethrow(){}},
 '@/lib/staff-zoe/chat-v2-actions':io,
 '@/lib/patient-care/clinical-actions':io,'@/lib/patient-care/clinical-review-actions':io,'@/lib/ai-plan/actions':io,
 './regimen':{RegimenEditor:()=>null},'./medicine-checks':{MedicineChecks:()=>null},
 './plan-ready-card':{PlanReadyCard,PlanLabFileLinks},'./patient-graphs':{PlanSparklines:()=>null},
 '@/components/staff/chat-member-identity':{ChatMemberIdentity:()=>null},
 '@/components/staff/doctor-workspace/approval-cards':{DoctorApprovalCards:()=>null},
 '@/components/real-review/urgent-publication':{UrgentPublicationBlock:()=>null},'./messages':{time:()=>''},
};
for(const path of ['@/lib/staff-zoe/outcome-copy','@/lib/patient-care/required-lab-match','@/lib/lab-ai/analyte-names','@/lib/staff/yerevan-time','@/lib/staff/staff-locale-copy','@/lib/ai-plan/language','@/lib/ai-plan/contracts','@/lib/ai-plan/draft-fields','@/lib/ai-plan/display','@/lib/staff/staff-server-copy','@/lib/staff/alert-label','@/lib/patient-care/action-timeout','@/lib/locale','@/lib/patient-care/regimen'])modules[path]=await import(path);
function load(file:string){const exports:Record<string,unknown>={};vm.runInNewContext(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,document:documentFixture,FormData:class extends FormData{constructor(form?:{fields:Record<string,string>}){super();for(const [key,value]of Object.entries(form?.fields??{}))this.set(key,value);}},require:(name:string)=>{assert.ok(name in modules,`Unmocked ${name}`);return modules[name];}});return exports;}
for(const path of ['@/lib/patient-care/consultation-proposal','@/components/real-review/use-consultation-decision','@/lib/doctor-decisions/publication-gate','@/components/patient-care/common','@/lib/first-note/compose','@/lib/service-workflow/publication','@/components/patient-care/regimen-changes','@/components/real-review/clinical-summary'])modules[path]=await import(path);
modules['next/link']={default:(props:React.AnchorHTMLAttributes<HTMLAnchorElement>)=>React.createElement('a',props)};
modules['@/lib/first-note/actions']=io;modules['@/lib/doctor-decisions/approval-actions']=io;
modules['@/components/staff/doctor-workspace/approval-cards']=load('components/staff/doctor-workspace/approval-cards.tsx');
modules['@/components/real-review/forms']=load('components/real-review/forms.tsx');
const {DoctorChatPlan}=load('components/doctor-chat-v2/plan.tsx') as typeof import('@/components/doctor-chat-v2/plan');
let screen:ReturnType<typeof create>;
const fakeWindow={fixture:{locale:'en',state:'plan-ready',history:[],long:false,dayReads:0,pollReads:0,newAlert:false}};
Object.assign(globalThis,{window:fakeWindow,document:documentFixture});
await act(async()=>{screen=create(React.createElement(DoctorChatPlan,{memberId:id,name:'Synthetic member',doctorId:'fictional-doctor',locale:'en',aiDraft:true,onOpen(){},onSaved(){},onCheckAgain(){},onAction(){},onReviewLabs(){}}));});
function nextButton(){return screen!.root.findByType(PlanReadyCard).findAllByType('button').find(button=>button.props.className?.split(' ').includes('w-full'))!;}
await act(async()=>screen!.root.findByType('select').props.onChange({target:{value:'not-required'}}));
await act(async()=>screen!.root.findAllByType('textarea').find(node=>node.props.maxLength===2000&&!node.props.name)!.props.onChange({target:{value:'Doctor-entered consultation reason'}}));
let count=0;
for(const label of ['Accept prepared fields','Record matched results','Save consultation decision','Use this draft','Approve and publish']){
 assert.equal(nextButton().props.children,label);
 assert.equal(nextButton().props.disabled,false,label);
 await act(async()=>{nextButton().props.onClick();});count++;
}
assert.equal(count,5);
const state=fakeWindow.fixture as typeof fakeWindow.fixture&{aiPlanSaves:Record<string,string>[];readyReceiptCalls:Record<string,string>[];planCommands:{kind:string}[]};
assert.equal(state.aiPlanSaves.length,2);
assert.equal(state.readyReceiptCalls.length,1);
assert.deepEqual(state.planCommands.map(command=>command.kind),['consultation-decision','regimen']);
await act(async()=>screen!.unmount());
console.log('Actual mounted chat and editor: accept/save, bulk receipt, consultation confirmation, refreshed save, explicit publication in five presses (synthetic IO).');
for(const disposition of ['rejected','edited'] as const){
 fakeWindow.fixture={locale:'en',state:'plan-ready',history:[],long:false,dayReads:0,pollReads:0,newAlert:false};
 await act(async()=>{screen=create(React.createElement(DoctorChatPlan,{memberId:id,name:'Synthetic member',doctorId:'fictional-doctor',locale:'en',aiDraft:true,onOpen(){},onSaved(){},onCheckAgain(){},onAction(){},onReviewLabs(){}}));});
 const followUp=screen!.root.findByProps({name:'followUp'});
 if(disposition==='rejected')await act(async()=>followUp.parent!.parent!.findAllByType('button').find(button=>button.props.children==='Reject')!.props.onClick());
 else await act(async()=>followUp.props.onChange({target:{value:'Doctor edited follow-up'}}));
 const fields=()=>screen!.root.findByProps({'data-check':'fields'});
 assert.ok(JSON.stringify(fields().findAllByType('p').map(p=>p.props.children)).includes(`1 ${disposition}`));
 await act(async()=>nextButton().props.onClick());
 const saved=(fakeWindow.fixture as typeof state).aiPlanSaves.at(-1)!;
 assert.equal(saved.followUp,disposition==='rejected'?'':'Doctor edited follow-up');
 assert.ok(JSON.stringify(fields().findAllByType('p').map(p=>p.props.children)).includes(`1 ${disposition}`),'The disposition remains visible after save');
 await act(async()=>screen!.unmount());
}
console.log('Actual mounted regressions: rejected follow-up is omitted from the save; edited follow-up is saved; both checklist counts stay truthful.');
// Replacing editor text must discard decisions about the text it replaced.
const {DraftForm}=modules['@/components/real-review/forms'] as typeof import('@/components/real-review/forms');
type DraftSnapshot=import('@/components/real-review/forms').DraftSnapshot;
type DraftEditorState=import('@/components/real-review/forms').DraftEditorState;
let captured:Record<string,string>={};
let capturedSaves=0;
async function captureSave(_previous:import('@/lib/patient-care/clinical-actions').ClinicalFormState,form:FormData){
 capturedSaves++;
 captured=Object.fromEntries([...form.entries()].map(([key,value])=>[key,String(value)]));
 return {ok:true,message:'Saved',revision:Number(form.get('revision'))};
}
function ReloadHarness({snapshot}:{snapshot:DraftSnapshot}){
 const [editor,onState]=React.useState<DraftEditorState>({dirty:false,pending:false,blocked:false});
 return React.createElement(React.Fragment,null,
  React.createElement(PlanReadyCard,{...props,editor}),
  React.createElement(DraftForm,{snapshot,ai:{generationId:draft.generation.id,values:draft.generation.draft},regimen:true,chat:{formId:'draft',disabled:false,resave:true,preaccepted:true,prefill:true,onState,
   save:captureSave,
   async adopt(){return true;},async refresh(){},async onSaved(){return true;}}}));
}
const fieldRowText=()=>JSON.stringify(screen!.root.findByProps({'data-check':'fields'}).findAllByType('p').map(p=>p.props.children));
const followUpInput=()=>screen!.root.findByProps({name:'followUp'});
const rejectFollowUp=()=>followUpInput().parent!.parent!.findAllByType('button').find(button=>button.props.children==='Reject')!.props.onClick();
function assertRejectedPayloadAgreement(){
 const editor=screen!.root.findByType(PlanReadyCard).props.editor as DraftEditorState;
 const reportsRejected=fieldRowText().includes('1 rejected');
 assert.equal(reportsRejected,editor.fields?.followUp==='rejected'&&captured.followUp==='','A rejected checklist field must be excluded from the actual save payload');
 assert.equal(captured.followUp,followUpInput().props.value,'The visible follow-up must match what is saved');
}
// Astra round 3: an empty loaded field still needs a derived decision after typing.
await act(async()=>{screen=create(React.createElement(ReloadHarness,{snapshot:{...draft.snapshot,draft:null}}));});
await act(async()=>rejectFollowUp());
await act(async()=>screen!.update(React.createElement(ReloadHarness,{snapshot:{...draft.snapshot,revision:draft.snapshot.revision+1,draft:{...draft.snapshot.draft!,followUp:''}}})));
await act(async()=>screen!.root.findAllByType('button').find(button=>button.props.children==='Use the new text')!.props.onClick());
assert.equal((screen!.root.findByType(PlanReadyCard).props.editor as DraftEditorState).fields?.followUp,'rejected','Empty loaded follow-up remains in the checklist');
await act(async()=>followUpInput().props.onChange({target:{value:'Typed after empty reload'}}));
assert.equal((screen!.root.findByType(PlanReadyCard).props.editor as DraftEditorState).fields?.followUp,'edited');
await act(async()=>documentFixture.getElementById().requestSubmit());
assert.equal(captured.followUp,'Typed after empty reload');
assert.ok(fieldRowText().includes('edited'));
await act(async()=>screen!.unmount());
for(const disposition of ['rejected','edited'] as const)for(const [keep,loadedFollowUp] of [[false,'New saved follow-up'],[false,''],[true,'New saved follow-up']] as const){
 const original={...draft.snapshot,draft:null};
 await act(async()=>{screen=create(React.createElement(ReloadHarness,{snapshot:original}));});
 if(disposition==='rejected')await act(async()=>rejectFollowUp());
 else await act(async()=>followUpInput().props.onChange({target:{value:'Doctor edited follow-up'}}));
 const updated={...original,revision:original.revision+1,draft:{...draft.snapshot.draft!,followUp:loadedFollowUp}};
 await act(async()=>screen!.update(React.createElement(ReloadHarness,{snapshot:updated})));
 const choice=keep?'I reviewed the changes, keep my edits':'Use the new text';
 await act(async()=>screen!.root.findAllByType('button').find(button=>button.props.children===choice)!.props.onClick());
 const expected=keep?(disposition==='rejected'?'':'Doctor edited follow-up'):loadedFollowUp;
 assert.equal(followUpInput().props.value,expected);
 if(!keep){
  const editor=screen!.root.findByType(PlanReadyCard).props.editor as DraftEditorState;
  assert.equal(editor.fields?.followUp,loadedFollowUp?'edited':'rejected','Loaded text derives a fresh decision, including an empty follow-up');
  assert.equal(fieldRowText().includes('All accepted'),false,'Loading text does not implicitly accept it');
 }
 await act(async()=>documentFixture.getElementById().requestSubmit());
 assert.equal(captured.followUp,expected);
 assertRejectedPayloadAgreement();
 await act(async()=>screen!.unmount());
}
// Reloading the exact proposal clears both explicit acceptance and rejection.
await act(async()=>{screen=create(React.createElement(ReloadHarness,{snapshot:{...draft.snapshot,draft:null}}));});
await act(async()=>rejectFollowUp());
await act(async()=>screen!.update(React.createElement(ReloadHarness,{snapshot:{...draft.snapshot,revision:draft.snapshot.revision+1,draft:{...draft.snapshot.draft!,...draft.generation.draft}}})));
await act(async()=>screen!.root.findAllByType('button').find(button=>button.props.children==='Use the new text')!.props.onClick());
assert.deepEqual((screen!.root.findByType(PlanReadyCard).props.editor as DraftEditorState).fields,{explanation:'not-decided',instructions:'not-decided',followUp:'not-decided'});
await act(async()=>screen!.unmount());
// The actual editor and checklist must agree after every action, including repeated saves.
const {DRAFT_FIELDS}=await import('@/lib/ai-plan/contracts');
function assertChecklistPayload(){
 const editor=screen!.root.findByType(PlanReadyCard).props.editor as DraftEditorState;
 const counts={edited:0,rejected:0,'not-decided':0,accepted:0};
 for(const key of DRAFT_FIELDS){
  const current=screen!.root.findByProps({name:key}).props.value as string;
  const disposition=editor.fields?.[key];
  assert.ok(disposition,`${key} always has a decision`);
  counts[disposition]++;
  assert.equal(captured[key],current.trim()?current:'',`${key}: payload follows visible text`);
  assert.equal(disposition==='rejected',!captured[key],`${key}: rejection exactly matches empty payload text`);
  if(disposition==='edited')assert.notEqual(captured[key],draft.generation.draft[key]);
 }
 assert.equal(editor.excludedFields?.length,counts.rejected);
 for(const key of ['edited','rejected'] as const)assert.equal(fieldRowText().includes(`${counts[key]} ${key}`),counts[key]>0);
 assert.equal(fieldRowText().includes(`${counts['not-decided']} still to decide`),counts['not-decided']>0);
 assert.equal(fieldRowText().includes('All accepted'),counts.accepted===DRAFT_FIELDS.length);
}
for(const actions of [['reject','edit'],['edit','reject'],['empty','edit'],['reject','same']] as const){
 await act(async()=>{screen=create(React.createElement(ReloadHarness,{snapshot:{...draft.snapshot,draft:null}}));});
 const reject=followUpInput().parent!.parent!.findAllByType('button').find(button=>button.props.children==='Reject')!.props.onClick;
 for(const action of actions)await act(async()=>{
  if(action==='reject')reject();
  else followUpInput().props.onChange({target:{value:action==='empty'?'':action==='same'?draft.generation.draft.followUp:'Doctor replacement'}});
 });
 const expected=actions[1]==='reject'?'rejected':actions[1]==='same'?'not-decided':'edited';
 assert.equal((screen!.root.findByType(PlanReadyCard).props.editor as DraftEditorState).fields?.followUp,expected);
 const before=capturedSaves;
 for(let save=0;save<2;save++){
  await act(async()=>documentFixture.getElementById().requestSubmit());
  assertChecklistPayload();
 }
 assert.equal(capturedSaves,before+2,'Both saves reach the payload builder');
 await act(async()=>screen!.unmount());
}
// Seeded sequences exercise edits, empty values, accept/reject, reload and save in varying orders.
for(let seed=1;seed<=6;seed++){
 let random=seed,revision=draft.snapshot.revision;
 const next=()=>{random=(Math.imul(random,1664525)+1013904223)>>>0;return random;};
 await act(async()=>{screen=create(React.createElement(ReloadHarness,{snapshot:{...draft.snapshot,draft:null}}));});
 const reject=followUpInput().parent!.parent!.findAllByType('button').find(button=>button.props.children==='Reject')!.props.onClick;
 const accept=followUpInput().parent!.parent!.findAllByType('button').find(button=>String(button.props.children).startsWith('Accepted'))!.props.onClick;
 for(let step=0;step<18;step++){
  const action=next()%6;
  if(action===4){
   const snapshot={...draft.snapshot,revision:++revision,draft:{...draft.snapshot.draft!,followUp:next()%2?'Loaded follow-up':''}};
   await act(async()=>screen!.update(React.createElement(ReloadHarness,{snapshot})));
   const choice=screen!.root.findAllByType('button').find(button=>button.props.children==='Use the new text');
   if(choice)await act(async()=>choice.props.onClick());
  }else await act(async()=>{
   if(action===2)reject();
   else if(action===3)accept();
   else followUpInput().props.onChange({target:{value:action===0?'':action===5?draft.generation.draft.followUp:`Edited ${seed}/${step}`}});
  });
  const before=capturedSaves;
  await act(async()=>documentFixture.getElementById().requestSubmit());
  assert.equal(capturedSaves,before+1,'Each sequence step checks a fresh submitted payload');
  assertChecklistPayload();
 }
 await act(async()=>screen!.unmount());
}
console.log('Mounted transition checks: edit empty, reject/edit, edit/reject, restored proposal, double save and 108 seeded sequence steps agree with actual payloads.');
// A clean editor also reloads saved text automatically, including after rejection restores its baseline.
await act(async()=>{screen=create(React.createElement(ReloadHarness,{snapshot:{...draft.snapshot,draft:null}}));});
await act(async()=>rejectFollowUp());
for(const key of ['explanation','instructions'])await act(async()=>screen!.root.findByProps({name:key}).parent!.parent!.findAllByType('button').find(button=>button.props.children==='Reject')!.props.onClick());
await act(async()=>screen!.update(React.createElement(ReloadHarness,{snapshot:{...draft.snapshot,revision:draft.snapshot.revision+1,draft:{...draft.snapshot.draft!,followUp:'Automatically loaded follow-up'}}})));
assert.equal((screen!.root.findByType(PlanReadyCard).props.editor as DraftEditorState).fields?.followUp,'edited','Automatic reload derives the replacement text decision');
await act(async()=>documentFixture.getElementById().requestSubmit());
assert.equal(captured.followUp,'Automatically loaded follow-up');
assertRejectedPayloadAgreement();
await act(async()=>screen!.unmount());
// Rejecting prepared text can restore saved text; that saved value must never be called excluded.
await act(async()=>{screen=create(React.createElement(ReloadHarness,{snapshot:{...draft.snapshot,draft:{...draft.snapshot.draft!,followUp:'Retained saved follow-up'}}}));});
await act(async()=>rejectFollowUp());
assert.equal(fieldRowText().includes('rejected'),false,'Restored nonempty saved text is not reported as excluded');
await act(async()=>documentFixture.getElementById().requestSubmit());
assert.equal(captured.followUp,'Retained saved follow-up');
assertRejectedPayloadAgreement();
await act(async()=>screen!.unmount());
console.log('Mounted reload regressions: rejection/edit then replace/keep, automatic reload and restored saved text all agree with the submitted payload.');
// The checklist must fail closed if its caller supplies a rejection without payload exclusion.
await act(async()=>{tree=create(React.createElement(PlanReadyCard,{...props,editor:{dirty:false,pending:false,blocked:false,fields:{followUp:'rejected'},excludedFields:[]}}));});
assert.equal(JSON.stringify(tree!.toJSON()).includes('rejected (they will not be saved)'),false);
await act(async()=>tree!.unmount());
// A save confirmation never covers text edited afterwards, even when adoption hides the AI generation.
fakeWindow.fixture={locale:'en',state:'plan-ready',history:[],long:false,dayReads:0,pollReads:0,newAlert:false};
await act(async()=>{screen=create(React.createElement(DoctorChatPlan,{memberId:id,name:'Synthetic member',doctorId:'fictional-doctor',locale:'en',aiDraft:true,onOpen(){},onSaved(){},onCheckAgain(){},onAction(){},onReviewLabs(){}}));});
await act(async()=>screen!.root.findByType('select').props.onChange({target:{value:'not-required'}}));
await act(async()=>screen!.root.findAllByType('textarea').find(node=>node.props.maxLength===2000&&!node.props.name)!.props.onChange({target:{value:'Doctor-entered consultation reason'}}));
for(const label of ['Accept prepared fields','Record matched results','Save consultation decision','Use this draft']){
 assert.equal(nextButton().props.children,label);await act(async()=>nextButton().props.onClick());
}
assert.equal(nextButton().props.children,'Approve and publish');
const legacyPublish=()=>screen!.root.findAllByType('button').find(button=>button.props.children==='Approve and publish this plan')!;
await act(async()=>screen!.root.findAllByType('input').find(input=>input.props.type==='checkbox')!.props.onChange({target:{checked:true}}));
assert.equal(legacyPublish().props.disabled,false,'Existing explicit approval remains usable when the saved editor is clean');
await act(async()=>screen!.root.findAllByType('textarea').find(node=>node.props.name==='instructions')!.props.onChange({target:{value:'Edited after final save'}}));
assert.equal(nextButton().props.children,'Use this draft');
assert.equal(legacyPublish().props.disabled,true,'The existing approval card also refuses publication of a dirty editor');
assert.equal(screen!.root.findAllByType('button').some(button=>button.props.children==='Approve and publish'),false);
await act(async()=>nextButton().props.onClick());
const editedState=fakeWindow.fixture as typeof fakeWindow.fixture&{aiPlanSaves:Record<string,string>[]};
assert.equal(editedState.aiPlanSaves.at(-1)!.instructions,'Edited after final save');
assert.equal(nextButton().props.children,'Approve and publish');

await act(async()=>screen!.root.findAllByType('input').find(input=>input.props.type==='checkbox')!.props.onChange({target:{checked:true}}));
assert.equal(legacyPublish().props.disabled,false,'Existing explicit approval remains usable when the saved editor is clean');
await act(async()=>screen!.unmount());
console.log('Actual mounted regression: editing after final save replaces publication with save and persists the edited instructions.');
// Single outstanding action states and exact blocked gate explanations.
for(const scenario of [
 {name:'values',draft:{...draft,labEvidence:{generationId:draft.generation.id,values:[{valueId:id,testName:'TSH',catalogueRef:null,value:2,unit:null,labFlag:null,collectedOn:'2026-11-07',attention:null,status:'unverified' as const}]}},expected:'Review these values'},
 {name:'prepared',draft:{...draft,snapshot:{...draft.snapshot,draft:null}},expected:'Accept prepared fields'},
 {name:'save',draft:{...draft,snapshot:{...draft.snapshot,draftStale:true}},expected:'Use this draft'},
]){
 await act(async()=>{tree=create(React.createElement(PlanReadyCard,{...props,draft:scenario.draft}));});
 assert.equal(primary().props.children,scenario.expected,scenario.name);await act(async()=>tree!.unmount());
}
for(const [kind,reason] of [['source','Review and approve the lab file'],['lab','Needs Thyroid function result: review lab file'],['evidence','Confirm Thyroid function on the Evidence tab'],['unsupported','Thyroid function cannot be confirmed in Noreon yet. Review the evidence pathway']] as const){
 const blockedApprovals={...approvals,regimen:{...approvals.regimen!,publicationGate:{kind,title:'Thyroid function'}}};
 await act(async()=>{tree=create(React.createElement(PlanReadyCard,{...props,approvals:blockedApprovals}));});
 assert.equal(primary().props.disabled,true,kind);assert.ok(JSON.stringify(tree!.toJSON()).includes(reason),reason);await act(async()=>tree!.unmount());
}
const requiredReview={...approvals.consultation!.review,consultation:{decision:'required' as const}};
await act(async()=>{tree=create(React.createElement(PlanReadyCard,{...props,approvals:{...approvals,consultation:{...approvals.consultation!,review:requiredReview}}}));});
assert.equal(primary().props.disabled,true);assert.ok(JSON.stringify(tree!.toJSON()).includes('Record the completed consultation'));await act(async()=>tree!.unmount());
console.log('Mounted states: next review/accept/save actions, source/lab/investigation/unsupported blocks and required consultation completion.');
// A routine save is also the explicit regimen review press; publication remains a separate press.
Object.assign(globalThis,{document:{getElementById:()=>({requestSubmit(){}})}});
const medicines=[{name:'Existing doctor-selected medicine',dose:'Existing doctor-selected dose',instructions:'Saved instructions',times:['09:00']}];
const regimenApprovals={...approvals,regimen:{...approvals.regimen!,current:false,review:{...approvals.regimen!.review,draft:{...approvals.regimen!.review.draft!,medicines}}}};
await act(async()=>{tree=create(React.createElement(PlanReadyCard,{...props,draft:{...draft,snapshot:{...draft.snapshot,draftStale:true}},approvals:regimenApprovals}));});
assert.equal(primary().props.children,'Use this draft');
assert.ok(JSON.stringify(tree!.toJSON()).includes('Your press confirms that you reviewed every medicine and dose'));
await act(async()=>primary().props.onClick());
await act(async()=>tree!.update(React.createElement(PlanReadyCard,{...props,approvals:{...regimenApprovals,regimen:{...regimenApprovals.regimen,current:true}}})));
assert.equal(primary().props.children,'Approve and publish','Saving and explicitly reviewing the medicines adds no separate regimen press');
assert.equal(primary().props.disabled,false);await act(async()=>tree!.unmount());
console.log('Mounted medicine path: explicit regimen review combined with save, final publication stays separate.');
const ruleConfirmed={...draft,labEvidence:{generationId:draft.generation.id,values:[{valueId:id,testName:'TSH',catalogueRef:null,value:2,unit:null,labFlag:null,collectedOn:'2026-11-07',attention:null,status:'auto_accepted' as const}]}};
await act(async()=>{tree=create(React.createElement(PlanReadyCard,{...props,draft:ruleConfirmed}));});
assert.equal(primary().props.children,'Approve and publish','Rule-confirmed inputs do not add a doctor review press; receipt coverage is still checked separately');
assert.equal(primary().props.disabled,false);await act(async()=>tree!.unmount());
await act(async()=>{tree=create(React.createElement(PlanReadyCard,{...props,draft:{...draft,ready:{...draft.ready,urgency:'orange'}}}));});
assert.equal(primary().props.disabled,true,'The existing orange mandatory-pathway hold stays blocked');
assert.ok(JSON.stringify(tree!.toJSON()).includes('Routine publication is on hold'));
await act(async()=>tree!.unmount());
