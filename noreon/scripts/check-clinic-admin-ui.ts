import assert from 'node:assert/strict';
import {createElement} from 'react';
import {create,act,type ReactTestRenderer,type ReactTestInstance} from 'react-test-renderer';
import {ClinicAccessManager} from '@/components/clinic-portal/admin-memberships';
import type {ClinicAdminPage,ClinicAdminPorts} from '@/lib/clinic-portal/admin-ports';
import type {ClinicAdminCommand} from '@/lib/clinic-portal/admin-schema';
import {realtimeStubs} from './realtime-test-stubs';
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
const id=(n:number)=>`c4710000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const clinic=id(1),user=id(2),membership=id(3);
const initial:ClinicAdminPage={version:'clinic-admin-memberships-v1',clinic:{id:clinic,name:'Synthetic clinic',active:true},memberships:[{id:membership,userId:user,email:'member@example.invalid',displayName:'Synthetic member',active:true,revision:2}],invitations:[],invitationsHasMore:false,nextCursor:null,capabilities:{grantExisting:true,inviteNew:false}};
const sent:ClinicAdminCommand[]=[],recoveries:ClinicAdminCommand[]=[];let reads=0;let readResult:unknown={status:'loaded',data:initial};let commandResult:unknown={status:'unknown'};let recoveryResult:unknown={status:'unavailable'};
const ports:ClinicAdminPorts={read:async()=>{reads++;return readResult;},lookup:async(_c,email)=>({status:'eligible',account:{userId:id(4),email}}),command:async(_c,command)=>{sent.push(command);return commandResult;},recover:async(_c,command)=>{recoveries.push(command);return recoveryResult;}};
const values=new Map<string,string>();const recoveryStorage={getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v);},removeItem:(k:string)=>{values.delete(k);}};
Object.assign(globalThis,{window:{addEventListener(){},removeEventListener(){}}});
const trees:ReactTestRenderer[]=[];
async function mount(scope='synthetic',initialValue=initial,store=recoveryStorage,locale:import('@/lib/locale').Locale='en'){let tree!:ReactTestRenderer;await act(async()=>{tree=create(createElement(ClinicAccessManager,{initial:initialValue,actorScope:scope,actorId:id(10),ports,recoveryStorage:store,locale}),{createNodeMock:()=>({focus(){}})});});trees.push(tree);return tree;}
const label=(n:ReactTestInstance):string=>n.children.map(c=>typeof c==='string'?c:label(c)).join('');
const button=(t:ReactTestRenderer,s:string)=>t.root.findAllByType('button').find(b=>label(b)===s)!;
async function click(b:ReactTestInstance){await act(async()=>b.props.onClick());}
async function change(t:ReactTestRenderer,name:string,value:string){await act(async()=>t.root.findByProps({'aria-label':name}).props.onChange({target:{value}}));}
try{
 const tree=await mount();const preToggle=sent.length;assert.ok(button(tree,'Add clinic access'));assert.equal(tree.root.findAllByProps({'aria-label':'Account email'}).length,0,'Populated roster starts without the grant form');await click(button(tree,'Add clinic access'));assert.equal(sent.length,preToggle,'Opening the grant form writes nothing');assert.ok(label(tree.root).includes('New-account invitations are unavailable.'));await change(tree,'Account email','new@example.invalid');await click(button(tree,'Check account'));assert.ok(label(tree.root).includes('new@example.invalid'));
 await change(tree,'Account email','other@example.invalid');assert.equal(button(tree,'Grant clinic access').props.disabled,true,'Edited email invalidates eligible lookup');await click(button(tree,'Check account'));await change(tree,'Display name','Synthetic new colleague');
 const grant=button(tree,'Grant clinic access');await act(async()=>{grant.props.onClick();grant.props.onClick();});assert.equal(sent.length,1,'Concurrent clicks send once');const frozen=structuredClone(sent[0]);assert.equal(frozen.op,'grant-existing');assert.equal('email'in frozen&&frozen.email,'other@example.invalid');assert.equal(button(tree,'Check account').props.disabled,true);assert.equal(button(tree,'Grant clinic access').props.disabled,true);assert.equal(button(tree,'Revoke access').props.disabled,true);
 await click(button(tree,'Check saved change'));assert.deepEqual(recoveries[0],frozen);assert.equal(sent.length,1,'Unavailable recovery never re-executes');assert.equal(button(tree,'Grant clinic access').props.disabled,true);
 recoveryResult={status:'loaded',receipt:{status:'retired',submissionId:frozen.submissionId,serialized:true},membership:null};await click(button(tree,'Check saved change'));assert.deepEqual(recoveries[1],frozen);assert.equal(sent.length,1);assert.ok(label(tree.root).includes('This change was not saved.'));assert.equal(reads,1);
 commandResult={status:'committed',submissionId:id(99),membershipId:membership,revision:3};await click(button(tree,'Revoke access'));const revoked=sent.at(-1)!;assert.equal(revoked.op,'revoke');assert.ok('expectedRevision'in revoked);assert.equal(revoked.expectedRevision,2);assert.equal(button(tree,'Revoke access').props.disabled,true,'Mismatched receipt is unknown');
 const revoke=sent.at(-1)!;recoveryResult={status:'loaded',receipt:{status:'committed',submissionId:revoke.submissionId,membershipId:membership,revision:3},membership:{...initial.memberships[0],active:false,revision:3}};readResult={status:'unavailable'};await click(button(tree,'Check saved change'));assert.ok(label(tree.root).includes('Change saved.'));assert.equal(button(tree,'Revoke access').props.disabled,true,'Read failure after known save requires refresh');assert.equal(sent.length,2);
 readResult={status:'loaded',data:{...initial,memberships:[{...initial.memberships[0],active:false,revision:3}]}};await click(button(tree,'Reload access list'));assert.ok(button(tree,'Reactivate access'));assert.equal(button(tree,'Reactivate access').props.disabled,false);assert.equal(sent.length,2);
 await click(button(tree,'Edit name'));await change(tree,'Member display name for member@example.invalid','Synthetic renamed');commandResult={status:'rejected',submissionId:id(99),reason:'conflict',noWrite:true};await click(button(tree,'Save name'));const renamed=sent.at(-1)!;assert.equal(renamed.op,'update');assert.ok('active'in renamed);assert.equal(renamed.active,false);assert.equal(renamed.expectedRevision,3);
 // A same-actor remount/password session keeps exact unknown command and can only recover it.
 values.clear();const source=await mount('first-session');await click(button(source,'Add clinic access'));await change(source,'Account email','recover@example.invalid');await click(button(source,'Check account'));await change(source,'Display name','Synthetic recovery');commandResult={status:'unknown'};await click(button(source,'Grant clinic access'));const savedCommand=structuredClone(sent.at(-1)!);const beforeRemount=sent.length;await act(async()=>source.unmount());
 const resumed=await mount('fresh-session');assert.equal(button(resumed,'Add clinic access').props.disabled,true);assert.equal(resumed.root.findAllByProps({'aria-label':'Account email'}).length,0);assert.ok(button(resumed,'Check saved change'));recoveryResult={status:'loaded',receipt:{status:'retired',submissionId:savedCommand.submissionId,serialized:true},membership:null};await click(button(resumed,'Check saved change'));assert.deepEqual(recoveries.at(-1),savedCommand);assert.equal(sent.length,beforeRemount,'Remount never resends unknown mutation');assert.equal(values.size,0,'Authoritative retirement clears journal');
 // Each membership has an unambiguous accessible input/action name.
 const multi=await mount('multi', {...initial,memberships:[...initial.memberships,{...initial.memberships[0],id:id(77),userId:id(78),email:'second@example.invalid',displayName:'Synthetic second'}]});const revokeNames=multi.root.findAllByType('button').filter(b=>label(b)==='Revoke access').map(b=>b.props['aria-label']);assert.deepEqual(revokeNames,['Revoke access for member@example.invalid','Revoke access for second@example.invalid']);const edits=multi.root.findAllByType('button').filter(b=>label(b)==='Edit name');assert.equal(edits.length,2);const noWriteBefore=sent.length;await click(edits[1]);await change(multi,'Member display name for second@example.invalid','Unsaved fictional name');await click(button(multi,'Cancel'));assert.equal(multi.root.findAllByProps({'aria-label':'Member display name for second@example.invalid'}).length,0);assert.ok(label(multi.root).includes('Synthetic second'));assert.equal(sent.length,noWriteBefore,'Edit and Cancel never write');
 const empty=await mount('empty',{...initial,memberships:[]});assert.ok(empty.root.findByProps({'aria-label':'Account email'}),'Empty state shows the grant form without a toggle');
 // Unavailable recovery storage must fail before any mutation is sent.
 const beforeStorageFailure=sent.length;const broken={getItem:():string|null=>{throw Error('Synthetic blocked storage');},setItem:()=>{throw Error('Synthetic blocked storage');},removeItem:()=>{throw Error('Synthetic blocked storage');}};
 const unavailable=await mount('storage-unavailable',initial,broken);assert.equal(button(unavailable,'Add clinic access').props.disabled,true);assert.equal(button(unavailable,'Revoke access').props.disabled,true);assert.ok(label(unavailable.root).includes('Changes will not be sent.'));assert.equal(sent.length,beforeStorageFailure);
 for(const locale of ['hy','ru'] as const){
  const localized=await mount(`localized-${locale}`,{...initial,memberships:[{...initial.memberships[0],displayName:'Անուն'}]}, {getItem:()=>null,setItem(){},removeItem(){}},locale);
  const visible=()=>label(localized.root).replaceAll('member@example.invalid','').replaceAll('Անուն','');
  const noEnglish=()=>{assert.doesNotMatch(visible(),/[A-Za-z]{2}/);for(const node of localized.root.findAll(n=>typeof n.props['aria-label']==='string'))assert.doesNotMatch(node.props['aria-label'].replaceAll('member@example.invalid',''),/[A-Za-z]{2}/);};
  noEnglish();assert.ok(button(localized,locale==='hy'?'Ավելացնել կլինիկայի հասանելիություն':'Добавить доступ к клинике'));
  await click(button(localized,locale==='hy'?'Ավելացնել կլինիկայի հասանելիություն':'Добавить доступ к клинике'));noEnglish();
  await click(button(localized,locale==='hy'?'Փոխել անունը':'Изменить имя'));noEnglish();
  await click(button(localized,locale==='hy'?'Չեղարկել':'Отменить'));noEnglish();
 }
 console.log('Clinic admin UI PASS: lookup binding, duplicate click fence, frozen unknown exact recovery/no resend, retired versus saved, read failure lock, current CAS/name/reactivation controls. Mocked ports, not Auth/browser.');
}finally{for(const t of trees)await act(async()=>t.unmount());}

// Render the real server page with synthetic IO, so bringing back clinical sections fails.
const {readFileSync}=await import('node:fs');
const {default:vm}=await import('node:vm');
const {default:ts}=await import('typescript');
const {renderToStaticMarkup}=await import('react-dom/server');
const jsx=await import('react/jsx-runtime');
const localeModule=await import('@/lib/locale');
const displayTime=await import('@/lib/real-booking/display-time');
const {clinicAdminRecord}=await import('./fixtures/clinic-admin');
const maskedDisplay=await import('@/components/clinic-portal/member-masked');
const clinicDisplay=await import('@/lib/clinic-portal/display-time');
const consentNames=await import('@/lib/clinic-portal/consent-name');
const react=await import('react');
const personalExports:Record<string,unknown>={};
const personalDependencies:Record<string,unknown>={
 'react/jsx-runtime':jsx,'react':react,'@/lib/clinic-portal/display-time':clinicDisplay,
 './member-masked':maskedDisplay,
 './member-record-forms':{ProfileEditForm:({current}:{current:{name:string;birthDate:string|null}})=>createElement('div',{'data-profile-dob':current.birthDate},'Edit name and date of birth')},
};
new vm.Script(ts.transpileModule(readFileSync('components/clinic-portal/member-personal-data.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText).runInNewContext({exports:personalExports,require:(name:string)=>{assert.ok(name in personalDependencies,name);return personalDependencies[name];}});
const PersonalData=personalExports.ClinicMemberPersonalData as typeof import('@/components/clinic-portal/member-personal-data').ClinicMemberPersonalData;
const masked={memberId:id(7),phoneLast4:'1234',birthYear:1968};
const reveals:unknown[]=[];
type RevealResult=import('@/lib/clinic-admin/member-reveal-schema').ClinicMemberRevealResult;
let revealResponse:RevealResult={ok:false,code:'unavailable'};
let finishReveal:((value:RevealResult)=>void)|null=null;
const reveal=async(input:unknown)=>{reveals.push(input);return finishReveal?await new Promise<RevealResult>(resolve=>{finishReveal=resolve;}):revealResponse;};
let profileSaveOutcome:import('@/lib/clinic-admin/schema').EditOutcome='saved';
const personalProps={locale:'en' as const,name:'Synthetic masked member',masked,reveal,save:async()=>profileSaveOutcome};
let personal!:ReactTestRenderer;
await act(async()=>{personal=create(createElement(PersonalData,personalProps));});
assert.ok(label(personal.root).includes('•••• 1234')&&label(personal.root).includes('1968'));
assert.equal(personal.root.findAllByType('a').length,0,'Masked phone is not callable');
assert.ok(!label(personal.root).includes('Edit name and date of birth'),'Editing is gated before reveal');
await click(button(personal,'Show details to edit'));
const textarea=personal.root.findByType('textarea');assert.equal(textarea.props.required,true);assert.equal(textarea.props.maxLength,500);assert.equal(textarea.props.minLength,5);
await act(async()=>personal.root.findByType('form').props.onSubmit({preventDefault(){}}));
assert.equal(reveals.length,0,'Blank reason never sends a reveal');assert.ok(label(personal.root).includes('Write a reason of at least 5 characters.'));
await act(async()=>textarea.props.onChange({target:{value:'  Calling about tomorrow’s visit  '}}));
for(const code of ['reason_required','rate_limited','refused','unavailable','disabled','access'] as const){
 revealResponse={ok:false,code};await act(async()=>personal.root.findByType('form').props.onSubmit({preventDefault(){}}));
 assert.equal(personal.root.findAllByType('a').length,0,`${code}: failure keeps data masked`);assert.ok(!label(personal.root).includes('Edit name and date of birth'));
}
finishReveal=()=>{};const beforeConcurrent= reveals.length;
await act(async()=>{personal.root.findByType('form').props.onSubmit({preventDefault(){}});personal.root.findByType('form').props.onSubmit({preventDefault(){}});});
assert.equal(reveals.length,beforeConcurrent+1,'Concurrent reveals send once');assert.equal(JSON.stringify(reveals.at(-1)),JSON.stringify({reason:'Calling about tomorrow’s visit'}));
await act(async()=>finishReveal!({ok:true,phone:'+37499123456',birthDate:'1968-02-23'}));
assert.equal(personal.root.findByType('a').props.href,'tel:+37499123456');assert.ok(label(personal.root).includes('23 Feb 1968')&&!label(personal.root).includes('12:00'),'Revealed DOB has no time');
assert.ok(label(personal.root).includes('Shown for this visit. Your reason was recorded.'));
assert.equal(personal.root.findByProps({'data-profile-dob':'1968-02-23'}).props['data-profile-dob'],'1968-02-23','Edit expected value comes from successful reveal');
const editor=personal.root.findAll(node=>typeof node.type==='function'&&node.props.current?.birthDate==='1968-02-23')[0];
await act(async()=>editor.props.save({birthDate:'1968-02-24'}));
assert.ok(personal.root.findByProps({'data-profile-dob':'1968-02-24'}),'Saved DOB becomes the next edit expected value');
profileSaveOutcome='stale';
const staleEditor=personal.root.findAll(node=>typeof node.type==='function'&&node.props.current?.birthDate==='1968-02-24')[0];
await act(async()=>staleEditor.props.save({birthDate:'1968-02-26'}));
assert.equal(personal.root.findAllByType('a').length,0,'A stale edit clears previously revealed personal data');
assert.ok(button(personal,'Show details to edit'),'Stale edit offers a fresh audited reveal');
assert.ok(label(personal.root).includes('Someone changed this member while you were editing.'),'Stale edit retains its explanation');
assert.ok(!label(personal.root).includes('Edit name and date of birth'),'Stale expected values cannot be retried');
finishReveal=null;revealResponse={ok:true,phone:'+37499123456',birthDate:'1968-02-25'};
await click(button(personal,'Show details to edit'));
await act(async()=>personal.root.findByType('textarea').props.onChange({target:{value:'Recheck after profile changed'}}));
const beforeRereveal=reveals.length;
await act(async()=>personal.root.findByType('form').props.onSubmit({preventDefault(){}}));
assert.equal(reveals.length,beforeRereveal+1,'Recovery requires a new audited reveal');
assert.ok(personal.root.findByProps({'data-profile-dob':'1968-02-25'}),'Re-reveal supplies the current expected DOB');
profileSaveOutcome='saved';
await act(async()=>personal.unmount());
await act(async()=>{personal=create(createElement(PersonalData,personalProps));});
assert.equal(personal.root.findAllByType('a').length,0,'A new page lifetime starts masked again');
assert.ok(!label(personal.root).includes('Edit name and date of birth'));
await act(async()=>personal.unmount());

for(const locale of ['en','hy','ru'] as const){
 const html=renderToStaticMarkup(createElement(PersonalData,{...personalProps,locale,masked:undefined}));
 assert.ok(html.includes(maskedDisplay.clinicNotGiven(locale))&&!html.includes('tel:'),`${locale}: absent masked values have normal fallback`);
}
const {MemberResultsUpload}=await import('@/components/clinic-portal/member-results-upload');
const historicalCompare={status:'compared' as const,read:true,differs:true,mismatch:'birth_date' as const,sheet:{nameMatch:'yes' as const,birthYearMatch:'no' as const},member:{name:'Synthetic previous name',birthDate:'1975-04-05',editedAt:'2026-11-01T08:00:00Z'}};
const comparisonFile={fileId:id(80),name:'Synthetic historical result.pdf',uploadedAt:'2026-11-01T08:00:00Z',fromRecord:true,state:'check' as const,attached:false,override:false,fileReading:'done' as const,memberReading:null,readingOn:true,compare:historicalCompare};
for(const [locale,hidden]of Object.entries({en:'Date of birth hidden',hy:'Ծննդյան ամսաթիվը թաքցված է',ru:'Дата рождения скрыта'}) as [import('@/lib/locale').Locale,string][]){
 const props={locale,clinicId:clinic,memberId:masked.memberId,actorScope:'synthetic',masked:{...masked,birthYear:1980},initial:{version:'clinic-member-files-v1' as const,enabled:true as const,status:'ok' as const,uploadAvailable:true,uploads:[comparisonFile],unmatched:[]},begin:async()=>({status:'unavailable' as const}),reserve:async()=>({status:'unavailable' as const}),read:async()=>({status:'unavailable' as const}),attach:async()=>({status:'unavailable' as const})};
 const html=renderToStaticMarkup(createElement(MemberResultsUpload,props));
 assert.ok(html.includes(hidden)&&!html.includes('1980'),`${locale}: historical comparison never presents the current year as the pre-edit DOB`);
 assert.ok(html.includes('Synthetic previous name')&&!html.includes('1975')&&!html.includes('5 Apr 1975')&&!html.includes('1975-04-05'),`${locale}: prior profile name remains but no PDF identity text is shown`);
 const current=renderToStaticMarkup(createElement(MemberResultsUpload,{...props,initial:{...props.initial,uploads:[{...comparisonFile,compare:{...historicalCompare,member:{name:'Synthetic current name',birthDate:null}}}]}}));
 assert.ok(current.includes('1980'),`${locale}: current comparison still shows current masked year`);
}
const {MemberRecordsList}=await import('@/components/clinic-portal/member-record-forms');
const {ClinicMemberSearch}=await import('@/components/clinic-portal/member-search');
const syntheticMember={memberId:masked.memberId,name:'Synthetic member',phone:'+37499123456',birthDate:'1968-02-23'};
for(const locale of ['en','hy','ru'] as const){
 const list=renderToStaticMarkup(createElement(MemberRecordsList,{clinicId:clinic,locale,rows:[{...syntheticMember,doctorName:null,nurseName:null}],maskedMembers:[masked]}));
 // @ts-expect-error Stale DTO is injected to verify defensive masked rendering.
 const search=renderToStaticMarkup(createElement(ClinicMemberSearch,{clinicId:clinic,locale,initial:{status:'loaded',data:{enabled:true,members:[syntheticMember],total:1,page:1,pageSize:25,maskedMembers:[masked]}},search:async()=>({status:'unavailable' as const})}));
 for(const html of [list,search])assert.ok(html.includes('•••• 1234')&&html.includes('1968')&&!html.includes('+37499123456')&&!html.includes('23 Feb')&&!html.includes('tel:'),`${locale}: list/search render only masked values even with stale full input`);
}
const chatExports:Record<string,unknown>={};
const chatDependencies:Record<string,unknown>={
 'react/jsx-runtime':jsx,'react':react,'next/link':{default:({children,...props}:Record<string,unknown>)=>createElement('a',props,children as import('react').ReactNode)},
 'lucide-react':new Proxy({},{get:()=>()=>null}),
 '@/lib/locale':localeModule,'@/lib/clinic-scheduling/schema':await import('@/lib/clinic-scheduling/schema'),
 './member-masked':maskedDisplay,'./bookings':{ClinicBookingCard:()=>null,statusText:{}},
 './batch-detail':{ClinicBatchDetail:()=>null},'./create-batch':{CreateClinicBatch:()=>null},'./chat-member-files':{ChatMemberFiles:()=>null},
 './member-record-forms':{MemberRecordsList},'./pdf-viewer':{ClinicPdfViewer:()=>null},
 '@/components/staff/chat-menu-items':{ChatMenuItems:()=>null},'@/lib/clinic-portal/display-time':clinicDisplay,
 '@/lib/clinic-chat/receipt':{bookingActionReceipt:()=>null},'@/components/staff/empty-chat':{EmptyStaffChat:()=>null},
 ...await realtimeStubs(),
};
new vm.Script(ts.transpileModule(readFileSync('components/clinic-portal/chat.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText).runInNewContext({exports:chatExports,require:(name:string)=>{assert.ok(name in chatDependencies,name);return chatDependencies[name];}});
const Chat=chatExports.ClinicChat as typeof import('@/components/clinic-portal/chat').ClinicChat;
for(const locale of ['en','hy','ru'] as const){
 const identity={version:'clinic-portal-v1' as const,userId:id(1),membershipId:id(2),membershipRevision:1,clinicId:clinic,clinicName:'Synthetic clinic',displayName:'Synthetic staff',capability:'clinic_staff' as const};
 const common={identity,locale,actorScope:'synthetic',canChooseClinic:false,resultLink:false,read:async()=>({kind:'unavailable' as const}),run:async()=>({status:'invalid' as const}),slots:async()=>null};
 // @ts-expect-error Deliberately inject stale full contact values; current chat replies require nulls.
 const member=renderToStaticMarkup(createElement(Chat,{...common,initialQuery:{kind:'member',memberId:masked.memberId},initial:{kind:'member',maskedMembers:[masked],result:{status:'loaded',data:{version:'clinic-member-file-v1',enabled:true,status:'ok',member:syntheticMember,bookings:[],checkins:[],visits:[],files:[]}}}}));
 // @ts-expect-error Deliberately inject stale full contact values; current chat replies require nulls.
 const members=renderToStaticMarkup(createElement(Chat,{...common,initialQuery:{kind:'members',query:'',page:1},initial:{kind:'members',maskedMembers:[masked],result:{status:'loaded',data:{version:'clinic-member-search-v2',enabled:true,maskedMembers:[],members:[syntheticMember],total:1,page:1,pageSize:25}}}}));
 for(const html of [member,members])assert.ok(html.includes('•••• 1234')&&html.includes('1968')&&!html.includes('+37499123456')&&!html.includes('23 Feb')&&!html.includes('tel:'),`${locale}: chat member/list keep full personal data out of rendered content`);
}
console.log('Clinic member reveal UI PASS: masked initial state, reason required, refusals, duplicate fence, successful reveal/date-only DOB/edit gate. Mocked server action, not Auth/browser.');

const record={...clinicAdminRecord,
 assessment:{answers:{private:{value:'PRIVATE ANSWER'}},completedAt:null,urgentRule:'PRIVATE URGENT RULE'},
 measurements:[{systolic:199,diastolic:111,pulse:99,measuredAt:'2026-11-01T08:00:00Z'}],
 tests:[{title:'PRIVATE TEST',orderedAt:'2026-11-01T08:00:00Z'}],results:[{marker:'PRIVATE RESULT',value:999,collectedAt:'2026-11-01T08:00:00Z'}],
 plan:{clinician:'PRIVATE CLINICIAN',instructions:'PRIVATE PLAN',publishedAt:'2026-11-01T08:00:00Z',medicines:[]},
 memberDocuments:[{name:'PRIVATE DOCUMENT',uploadedAt:'2026-11-01T08:00:00Z'}],reports:[{name:'PRIVATE REPORT',uploadedAt:'2026-11-01T08:00:00Z'}],
 visits:[{...clinicAdminRecord.visits[0],entries:[{payload:{kind:'note',text:'PRIVATE VISIT NOTE'}}]}],
};
let recordStatus='loaded',fileStatus='loaded';
const noop=async()=>{};
const dependencies:Record<string,unknown>={
 'react/jsx-runtime':jsx,'next/link':{default:({children,...props}:Record<string,unknown>)=>createElement('a',props,children as import('react').ReactNode)},
 'next/navigation':{redirect:()=>{throw Error('redirect');}},'lucide-react':{FileText:()=>null,Phone:()=>null},
 '@/lib/clinic-portal/locale':{clinicLocale:async(value:unknown)=>localeModule.parseLocale(value,'en')},
 '@/lib/locale':localeModule,'@/lib/real-booking/display-time':displayTime,'@/lib/clinic-portal/display-time':clinicDisplay,
 '@/lib/clinic-portal/consent-name':consentNames,
 '@/components/clinic-portal/member-masked':maskedDisplay,
 '@/components/clinic-portal/member-personal-data':{ClinicMemberPersonalData:PersonalData},
 '@/lib/clinic-portal/member-masked':{readClinicMemberMasked:async()=>({status:'loaded',members:[{...masked,memberId:record.member.memberId}]})},
 '@/lib/clinic-portal/identity':{requireClinicPortal:async()=>({identity:{clinicId:clinic,capability:'clinic_admin'},rpc:{},actorScope:'synthetic'})},
 '@/components/clinic-portal/shell':{ClinicShell:({children}:{children:import('react').ReactNode})=>createElement('main',null,children)},
 '@/lib/clinic-admin/approval-actions':{clinicChangeDecide:noop},
 '@/components/clinic-portal/change-approvals':{ChangeApprovals:()=>null},
 '@/lib/clinic-admin/record':{readClinicPatientRecord:async()=>({status:recordStatus,data:record})},
 '@/lib/clinic-admin/actions':Object.fromEntries(['clinicAdminMemberReveal','clinicPatientCareTeamChange','clinicPatientProfileUpdate','clinicMemberFileAttach','clinicMemberFilesRead','clinicMemberUploadBegin','clinicMemberUploadReserve'].map(key=>[key,noop])),
 '@/components/clinic-portal/member-record-forms':{CareTeamForm:()=>null,ProfileEditForm:()=>null},
 '@/components/clinic-portal/member-results-upload':{MemberResultsUpload:()=>null},
 '@/lib/clinic-admin/files':{readMemberFiles:async()=>({status:fileStatus,data:{}})},
};
const out:Record<string,unknown>={};
new vm.Script(ts.transpileModule(readFileSync('app/clinic/real/records/[memberId]/page.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText).runInNewContext({exports:out,require:(name:string)=>{assert.ok(name in dependencies,name);return dependencies[name];}});
const recordPage=out.default as (props:{params:Promise<{memberId:string}>;searchParams:Promise<Record<string,string>>})=>Promise<import('react').ReactElement>;
async function recordMarkup(locale:string){return renderToStaticMarkup(await recordPage({params:Promise.resolve({memberId:record.member.memberId}),searchParams:Promise.resolve({clinic,locale})}));}
const intros={
 en:"Personal data, care team, visits and your clinic's files. Questionnaire answers, results and the care plan are seen only by the member's doctor and nurse. Phone and date of birth are partly hidden. Opening this record and revealing details are recorded.",
 hy:'Անձնական տվյալներ, խնամքի թիմ, այցեր և ձեր կլինիկայի ֆայլերը։ Հարցաշարի պատասխանները, արդյունքները և խնամքի ծրագիրը տեսնում են միայն անդամի բժիշկն ու բուժքույրը։ Հեռախոսն ու ծննդյան ամսաթիվը մասամբ թաքցված են։ Այս քարտի բացումն ու տվյալների ցուցադրումը գրանցվում են։',
 ru:'Личные данные, медицинская команда, приёмы и файлы вашей клиники. Ответы на анкету, результаты и план лечения видят только врач и медсестра участника. Телефон и дата рождения частично скрыты. Открытие этой карты и показ данных фиксируются.',
};
const consentCopy={
 en:{name:'Pilot consent',fallback:'Consent',date:'1 Nov 2026',laterDate:'3 Nov 2026',empty:'Not given'},
 hy:{name:'Փորձնական ծրագրի համաձայնություն',fallback:'Համաձայնություն',date:'1 նոյ 2026',laterDate:'3 նոյ 2026',empty:'Տրված չէ'},
 ru:{name:'Согласие на участие в пилоте',fallback:'Согласие',date:'1 ноя 2026',laterDate:'3 ноя 2026',empty:'Не указано'},
};
for(const [locale,intro]of Object.entries(intros)){
 const html=await recordMarkup(locale);
 const consent=consentCopy[locale as keyof typeof consentCopy];
 assert.ok(html.includes(`<dd>${consent.name} · ${consent.date}</dd>`),`${locale}: human consent name keeps its acceptance date`);
 assert.doesNotMatch(html,/[a-z]+(-[a-z0-9]+)+-v\d+/,`${locale}: no raw version IDs render on the record`);
 assert.ok(html.includes('•••• 1234'),`${locale}: phone is masked by default`);
 assert.ok(!html.includes('tel:')&&!html.includes(record.member.birthDate??'NOT_PRESENT'),`${locale}: no full personal data by default`);
 assert.ok(html.includes(renderToStaticMarkup(createElement('p',null,intro)).slice(3,-4)),`${locale}: restricted-content intro`);
 assert.ok(!html.includes('PRIVATE'),`${locale}: no clinical payload rendered`);
 for(const section of ['questionnaire','plan','results'])assert.ok(!html.includes(`id="${section}"`)&&!html.includes(`href="#${section}"`),`${locale}: no ${section} section or nav`);
 for(const text of ['Home blood pressure readings','Տնային ճնշման չափումներ','Домашние измерения давления','Published care plan','Հրապարակված խնամքի ծրագիր','Опубликованный план лечения','Lab results','Լաբորատոր արդյունքներ','Результаты анализов'])assert.ok(!html.includes(text));
 assert.ok(html.includes('Fictional clinic nurse')&&!html.includes('Fictional clinic upload.pdf'),`${locale}: operational visits remain and file names are neutral`);
 assert.ok(!html.includes('Open PDF')&&!html.includes('/files/'),`${locale}: no clinic PDF opening control`);
}
const originalConsents=record.consents;
for(const [locale,copy]of Object.entries(consentCopy)){
 for(const version of ['future-consent-v99','toString','__proto__','']){
  record.consents=[...originalConsents,{version,acceptedAt:'2026-11-03T08:00:00Z'}];
  const html=await recordMarkup(locale);
  assert.ok(html.includes(`<dd>${copy.name} · ${copy.date}, ${copy.fallback} · ${copy.laterDate}</dd>`),`${locale}: unknown ${version} uses a neutral localized name and keeps both dates`);
  assert.doesNotMatch(html,/[a-z]+(-[a-z0-9]+)+-v\d+/,`${locale}: unknown version IDs never render`);
 }
 record.consents=[];
 assert.ok((await recordMarkup(locale)).includes(`<dd>${copy.empty}</dd>`),`${locale}: missing consent stays localized`);
}
record.consents=originalConsents;
for(const status of ['missing','disabled','forbidden','unavailable']){recordStatus=status;const html=await recordMarkup('en');assert.ok(html.includes('role="alert"')&&!html.includes('Fictional clinic member'),`${status}: no record exposed`);}
recordStatus='loaded';fileStatus='unavailable';assert.ok((await recordMarkup('en')).includes('Uploads could not load. Try again.'));
console.log('Clinic admin record page PASS: EN/HY/RU consent names/dates, unknown-version fallback/no raw IDs, missing consent, intro, operational visits/files, no clinical sections or values, refusal and upload-error states. Real page rendered with synthetic IO, not browser/Auth.');

for(const locale of ['hy','ru'] as const){
 const html=renderToStaticMarkup(createElement(ClinicAccessManager,{initial:{...initial,memberships:[{...initial.memberships[0],displayName:'Անուն'}]},actorScope:'localized',actorId:id(10),ports,locale,telegram:true,telegramRecovery:true}));
 const text=html.replace(/<script[\s\S]*?<\/script>/g,'').replace(/<[^>]*>/g,'').replaceAll('member@example.invalid','').replace(/\b(?:Noreon|Telegram)\b/g,'');
 assert.doesNotMatch(text,/[A-Za-z]{2}/,`${locale}: parent passes language through to Telegram controls`);
}
