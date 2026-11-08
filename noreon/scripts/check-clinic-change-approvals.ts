import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup as renderMarkup} from 'react-dom/server';
import {AppRouterContext,type AppRouterInstance} from 'next/dist/shared/lib/app-router-context.shared-runtime';
import type {ReactElement} from 'react';
import {create as createRenderer,act,type ReactTestRenderer,type ReactTestInstance} from 'react-test-renderer';
import {clinicAdminRecord} from './fixtures/clinic-admin';
import {recordSchema} from '@/lib/clinic-admin/schema';
import {clinicChangeRequestSchema,staffChangeRequestSchema,requestResultSchema} from '@/lib/clinic-admin/approvals-schema';
import {readChangeRequests,decideChangeRequest} from '@/lib/clinic-admin/approvals';
import {readClinicPatientRecord,updateClinicPatientProfile,changeClinicPatientCareTeam} from '@/lib/clinic-admin/record';
import {ChangeApprovals,ChangeSummary,decisionText,decidedLine} from '@/components/clinic-portal/change-approvals';
import {ProfileEditForm,CareTeamForm} from '@/components/clinic-portal/member-record-forms';
const router={bfcacheId:'synthetic',refresh(){},push(){},replace(){},back(){},forward(){},prefetch:async()=>{},hmrRefresh(){}} as AppRouterInstance;
const wrap=(node:ReactElement)=>createElement(AppRouterContext.Provider,{value:router},node);
const renderToStaticMarkup=(node:ReactElement)=>renderMarkup(wrap(node));
const create=(node:ReactElement)=>createRenderer(wrap(node));
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
const id=(n:number)=>`c4920000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const request={id:id(1),clinicId:id(2),clinicName:'Synthetic clinic',kind:'profile' as const,memberId:id(3),memberName:'Synthetic member',requesterName:'Synthetic admin',mine:false,createdAt:'2026-11-05T10:00:00Z',decidedAt:null,state:'pending' as const,decisionNote:null,summary:{name:{before:'Old synthetic',after:'New synthetic'},birthDate:{beforeYear:1970,afterYear:1971}}};
const careRequest={...request,kind:'care_team' as const,summary:{doctor:{before:'Synthetic previous doctor',after:'Synthetic next doctor'}}};
const staffRequest={...request,summary:{...request.summary,birthDate:{...request.summary.birthDate,before:'1970-03-04',after:'1971-05-06'}}};
assert.equal(clinicChangeRequestSchema.safeParse(request).success,true);
assert.equal(staffChangeRequestSchema.safeParse(staffRequest).success,true);
assert.equal(clinicChangeRequestSchema.safeParse(staffRequest).success,false,'Full DOB cannot pass the clinic boundary');
assert.equal(requestResultSchema.safeParse({status:'unchanged',reason:'doctor_unavailable'}).success,false);
assert.equal(requestResultSchema.safeParse({status:'rejected'}).success,false);
const calls:{name:string;args?:Record<string,unknown>}[]=[];let data:unknown={status:'pending',requestId:id(1)};
const rpc={rpc:async(name:string,args?:Record<string,unknown>)=>{calls.push({name,args});return{data,error:null};}};
const profile={submissionId:id(4),expected:{name:'Old synthetic',birthDate:'1970-03-04'},name:'New synthetic',birthDate:'1971-05-06'};
assert.equal(await updateClinicPatientProfile(rpc,id(2),id(3),profile),'saved');
assert.deepEqual(calls.at(-1),{name:'clinic_admin_change_request',args:{p_clinic:id(2),p_member:id(3),p_kind:'profile',p_submission:id(4),p_expected:profile.expected,p_proposed:{name:profile.name,birthDate:profile.birthDate}}});
assert.equal(await changeClinicPatientCareTeam(rpc,id(2),id(3),{submissionId:id(4),expectedRevision:8,doctorId:id(5),nurseId:null}),'pending');
assert.deepEqual(calls.at(-1)?.args,{p_clinic:id(2),p_member:id(3),p_kind:'care_team',p_submission:id(4),p_expected:{revision:8},p_proposed:{doctorId:id(5),nurseId:null}});
for(const status of ['pending_exists','unchanged','stale','invalid','refused','disabled','not_enrolled','conflict']as const){data={status,...(status==='pending_exists'?{requestId:id(1)}:{})};assert.equal(await updateClinicPatientProfile(rpc,id(2),id(3),profile),status==='conflict'||status==='pending_exists'?'stale':status);}
data={status:'pending_exists',requestId:id(1)};assert.equal(await changeClinicPatientCareTeam(rpc,id(2),id(3),{submissionId:id(4),expectedRevision:8,doctorId:id(5),nurseId:null}),'pending_exists');
for(const reason of ['doctor_unavailable','nurse_unavailable']){data={status:'rejected',reason};assert.equal(await changeClinicPatientCareTeam(rpc,id(2),id(3),{submissionId:id(4),expectedRevision:8,doctorId:id(5),nurseId:null}),reason);}
data={status:'refused',reason:'other_clinic'};assert.equal(await updateClinicPatientProfile(rpc,id(2),id(3),profile),'other_clinic');
const before=calls.length;assert.equal(await decideChangeRequest(rpc,id(2),{requestId:id(1),decision:'reject',note:' x '}),'reason_required');assert.equal(calls.length,before);
assert.equal(await decideChangeRequest(rpc,null,{requestId:id(1),decision:'cancel'}),'refused');assert.equal(calls.length,before);
for(const status of ['approved','rejected','cancelled','stale','expired','self_approval','refused','reason_required','invalid','disabled','not_pending']as const){data={status};assert.equal(await decideChangeRequest(rpc,id(2),{requestId:id(1),decision:'approve'}),status);}
data={status:'ok',requests:[request]};assert.equal((await readChangeRequests(rpc,id(2))).status,'loaded');
data={status:'ok',requests:[request,careRequest]};assert.deepEqual(await readChangeRequests(rpc,id(2)),{status:'loaded',requests:[careRequest]},'Queue and navigation count include only care-team approvals');
data={status:'ok',requests:[{...request,clinicId:id(9)}]};assert.equal((await readChangeRequests(rpc,id(2))).status,'unavailable');
data={status:'ok',requests:[staffRequest]};assert.equal((await readChangeRequests(rpc,id(2))).status,'unavailable');assert.equal((await readChangeRequests(rpc,null)).status,'loaded');
data={status:'disabled'};assert.equal((await readChangeRequests(rpc,id(2))).status,'disabled');
data={...clinicAdminRecord,pendingRequests:[{...request,memberId:clinicAdminRecord.member.memberId}]};
const noPendingProfile=await readClinicPatientRecord(rpc,id(2),clinicAdminRecord.member.memberId);assert.ok(noPendingProfile.status==='loaded'&&noPendingProfile.data.pendingRequests.length===0,'Profile history never creates record pending state');
data={...clinicAdminRecord,pendingRequests:[request]};assert.equal((await readClinicPatientRecord(rpc,id(2),clinicAdminRecord.member.memberId)).status,'unavailable','Record refuses requests for another member');
const legacyRecord:Record<string,unknown>={...clinicAdminRecord};delete legacyRecord.pendingRequests;const legacy=recordSchema.parse(legacyRecord);assert.ok('pendingRequests'in legacy&&legacy.pendingRequests.length===0,'Legacy deployed record defaults to no embedded requests');
const label=(n:ReactTestInstance):string=>n.children.map(c=>typeof c==='string'?c:label(c)).join('');
for(const locale of ['en','hy','ru']as const){
 const html=renderToStaticMarkup(createElement(ChangeApprovals,{requests:[careRequest,request],locale,decide:async()=>'approved' as const}));
 assert.ok(html.includes(`/clinic/real/records/${request.memberId}?clinic=${request.clinicId}&amp;locale=${locale}`));
 assert.ok(html.includes('Synthetic next doctor')&&!html.includes('New synthetic')&&!html.includes('1970'));
 const own=renderToStaticMarkup(createElement(ChangeApprovals,{requests:[{...careRequest,mine:true},request],locale,decide:async()=>'approved' as const}));
 assert.ok(own.includes({en:'You asked for this. Another admin must approve it.',hy:'Այս հարցումն ուղարկել եք դուք։ Այն պետք է հաստատի մեկ այլ ադմինիստրատոր։',ru:'Этот запрос отправили вы. Его должен одобрить другой администратор.'}[locale]));
 assert.ok(!own.includes('>Approve change<')&&!own.includes('>Հաստատել փոփոխությունը<')&&!own.includes('>Одобрить изменение<'));
 const banner=renderToStaticMarkup(createElement(ChangeApprovals,{requests:[{...careRequest,mine:true},request],locale,compact:true,decide:async()=>'cancelled' as const}));
 assert.ok(banner.includes({en:'Waiting for approval:',hy:'Սպասում է հաստատման․',ru:'Ожидает согласования:'}[locale]));
 assert.ok(banner.includes({en:'Cancel request',hy:'Չեղարկել հարցումը',ru:'Отменить запрос'}[locale]));
 const decided=renderToStaticMarkup(createElement(ChangeApprovals,{requests:[{...careRequest,state:'rejected',decisionNote:'Synthetic decision reason'}],locale,decide:async()=>'approved' as const}));
 assert.ok(decided.includes('Synthetic decision reason'));
 const full=renderToStaticMarkup(createElement(ChangeSummary,{request:staffRequest,locale,staff:true}));assert.ok(full.includes('1970')&&full.includes('1971'));assert.notEqual(full,renderToStaticMarkup(createElement(ChangeSummary,{request,locale})));
 for(const status of ['stale','expired','self_approval','disabled','reason_required']as const)assert.ok(decisionText(locale,status).length>10);
}
const staffHtml=renderToStaticMarkup(createElement(ChangeApprovals,{requests:[careRequest,staffRequest],locale:'en',staff:true,decide:async()=>'approved' as const}));assert.ok(staffHtml.includes(`/staff/real/members/${request.memberId}`));assert.ok(staffHtml.includes('Synthetic next doctor')&&!staffHtml.includes('4 Mar 1970'));
let sent:unknown[]=[];let tree!:ReactTestRenderer;
await act(async()=>{tree=create(createElement(ChangeApprovals,{requests:[careRequest,request],locale:'en',decide:async(input)=>{sent.push(input);return'rejected';}}));});
const buttons=()=>tree.root.findAllByType('button');
await act(async()=>buttons().find(b=>label(b)==='Reject change')!.props.onClick());
const note=tree.root.findByType('textarea');assert.equal(note.props.minLength,5);assert.equal(note.props.maxLength,500);assert.equal(note.props.required,true);
await act(async()=>tree.root.findByType('form').props.onSubmit({preventDefault(){}}));assert.equal(sent.length,0);
await act(async()=>note.props.onChange({target:{value:'  Synthetic reason  '}}));
await act(async()=>{const form=tree.root.findByType('form');form.props.onSubmit({preventDefault(){}});form.props.onSubmit({preventDefault(){}});});
assert.deepEqual(sent,[{requestId:id(1),decision:'reject',note:'Synthetic reason'}]);await act(async()=>tree.unmount());
sent=[];
await act(async()=>{tree=create(createElement(ProfileEditForm,{locale:'en',current:{name:'Old synthetic',birthDate:'1970-03-04'},save:async(input)=>{sent.push(input);return'saved';}}));});
await act(async()=>tree.root.findByType('button').props.onClick());
await act(async()=>{const form=tree.root.findByType('form');form.props.onSubmit({preventDefault(){}});form.props.onSubmit({preventDefault(){}});});
assert.equal(sent.length,1);assert.ok(label(tree.root).includes('Saved. The member sees the change in their profile.'));assert.ok(!label(tree.root).includes('approval'));assert.equal(tree.root.findByType('button').props.disabled,undefined);await act(async()=>tree.unmount());
for(const locale of ['hy','ru'] as const){
 await act(async()=>{tree=create(createElement(ProfileEditForm,{locale,current:{name:'Old synthetic',birthDate:'1970-03-04'},save:async()=>'saved' as const}));});
 await act(async()=>tree.root.findByType('button').props.onClick());
 await act(async()=>tree.root.findByType('form').props.onSubmit({preventDefault(){}}));
 assert.ok(label(tree.root).includes({hy:'Պահպանված է։ Անդամը փոփոխությունը կտեսնի իր պրոֆիլում։',ru:'Сохранено. Участник увидит изменение в своём профиле.'}[locale]));
 await act(async()=>tree.unmount());
}
sent=[];
await act(async()=>{tree=create(createElement(CareTeamForm,{locale:'en',revision:4,doctorId:id(5),nurseId:null,doctors:[{id:id(5),name:'Synthetic doctor'}],nurses:[],save:async(input)=>{sent.push(input);return'unavailable';}}));});
await act(async()=>tree.root.findByType('form').props.onSubmit({preventDefault(){}}));
await act(async()=>tree.root.findByType('form').props.onSubmit({preventDefault(){}}));
assert.deepEqual(sent[0],sent[1],'Unknown request retries keep submission and payload');await act(async()=>tree.unmount());
console.log('Clinic change approvals PASS: strict masked/full summaries, request RPC contract, refusal mapping, scoped lists, decisions, own-request controls, EN/HY/RU and staff rendered summaries, rejection validation and duplicate fence. Synthetic RPC/render, not database/browser E2E.');

// Render the actual page entry points with explicit synthetic boundaries.
const {readFileSync}=await import('node:fs');
const {default:vm}=await import('node:vm');
const {default:ts}=await import('typescript');
const jsx=await import('react/jsx-runtime');
const {parseLocale}=await import('@/lib/locale');
let role='clinic_admin',listStatus='loaded',adminAllowed=true;
let listedState='';
const pageDeps:Record<string,unknown>={
 'react/jsx-runtime':jsx,
 'next/link':{default:({children,...props}:Record<string,unknown>)=>createElement('a',props,children as import('react').ReactNode)},
 'next/navigation':{redirect:()=>{throw Error('synthetic redirect');}},
 '@/lib/clinic-portal/locale':{clinicLocale:async(value:unknown)=>parseLocale(value,'en')},
 '@/lib/locale':{parseLocale},
 '@/lib/clinic-portal/identity':{requireClinicPortal:async()=>({identity:{clinicId:id(2),capability:role},actorScope:'synthetic',rpc})},
 '@/components/clinic-portal/shell':{ClinicShell:({children}: {children:import('react').ReactNode})=>createElement('main',null,children)},
 '@/components/clinic-portal/change-approvals':{ChangeApprovals},
 '@/lib/clinic-admin/approvals':{readChangeRequests:async(_rpc:unknown,clinicId:string|null,state:string)=>{listedState=state;return listStatus==='loaded'?{status:'loaded',requests:[careRequest]}:{status:listStatus};}},
 '@/lib/clinic-admin/approval-actions':{clinicChangeDecide:async()=>'approved' as const,staffClinicChangeDecide:async()=>'approved' as const},
 '@/lib/staff/real-admin':{requireRealAdmin:async()=>{if(!adminAllowed)throw Error('synthetic admin refusal');return{client:rpc,actorScope:'synthetic'};}},
};
function loadModule(path:string,deps=pageDeps){
 const out:Record<string,unknown>={};
 new vm.Script(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText).runInNewContext({exports:out,require:(name:string)=>{assert.ok(name in deps,name);return deps[name];}});
 return out;
}
type Page=(p:{searchParams:Promise<Record<string,string>>})=>Promise<import('react').ReactElement>;
const clinicPage=loadModule('app/clinic/real/approvals/page.tsx').default as Page;
for(const locale of ['en','hy','ru']){
 const html=renderToStaticMarkup(await clinicPage({searchParams:Promise.resolve({clinic:id(2),locale})}));
 assert.ok(html.includes('Synthetic member')&&html.includes('Synthetic next doctor')&&!html.includes('4 Mar 1970'));
 assert.ok(html.includes(`locale=${locale}`)&&html.includes('state=decided'));
}
role='clinic_staff';await assert.rejects(()=>clinicPage({searchParams:Promise.resolve({})}),/synthetic redirect/);role='clinic_admin';
for(const status of ['disabled','unavailable','refused']){listStatus=status;assert.ok(renderToStaticMarkup(await clinicPage({searchParams:Promise.resolve({locale:'en'})})).includes('role="alert"'));}
listStatus='loaded';
const staffPage=loadModule('app/staff/real/(review)/clinics/approvals/page.tsx').default as Page;
const pageHtml=renderToStaticMarkup(await staffPage({searchParams:Promise.resolve({})}));assert.ok(pageHtml.includes('Synthetic next doctor')&&pageHtml.includes('Synthetic clinic'));
await staffPage({searchParams:Promise.resolve({state:'decided'})});assert.equal(listedState,'decided');
adminAllowed=false;await assert.rejects(()=>staffPage({searchParams:Promise.resolve({})}),/synthetic admin refusal/);
console.log('Clinic approval pages PASS: real EN/HY/RU clinic and staff server pages rendered with synthetic IO, Waiting/Decided selection, staff/clinic-admin entry gates, disabled/error states. Not browser/Auth E2E.');

// Invoke actual server action wrappers with synthetic sessions to pin both scope fences.
let actionCalls=0,revalidations=0,capability='clinic_admin';
const scope='current',staffScope='current';
const actionDeps:Record<string,unknown>={
 'next/cache':{revalidatePath:()=>{revalidations++;}},
 '@/lib/observability/with-logging':{loggedAction:(_name:string,fn:unknown)=>fn},
 '@/lib/clinic-portal/identity':{requireClinicPortal:async()=>({identity:{capability},actorScope:scope,rpc})},
 '@/lib/staff/real-admin':{requireRealAdmin:async()=>({client:rpc,actorScope:staffScope})},
 './approvals':{decideChangeRequest:async()=>{actionCalls++;return'approved';}},
};
const actions=loadModule('lib/clinic-admin/approval-actions.ts',actionDeps);
const clinicDecide=actions.clinicChangeDecide as (clinic:string,scope:string,input:unknown)=>Promise<string>;
const staffDecide=actions.staffClinicChangeDecide as (scope:string,input:unknown)=>Promise<string>;
assert.equal(await clinicDecide(id(2),'old',{}),'refused');assert.equal(actionCalls,0);
capability='clinic_staff';assert.equal(await clinicDecide(id(2),'current',{}),'refused');assert.equal(actionCalls,0);
capability='clinic_admin';assert.equal(await clinicDecide(id(2),'current',{}),'approved');assert.equal(actionCalls,1);
assert.equal(await staffDecide('old',{}),'refused');assert.equal(actionCalls,1);
assert.equal(await staffDecide('current',{}),'approved');assert.equal(actionCalls,2);assert.equal(revalidations,6);
console.log('Clinic approval actions PASS: actual wrapper checks fresh admin capability/scope before scoped RPC and revalidates affected pages (synthetic sessions).');

// The decided card names who decided once the database sends deciderName; until then it shows the bare outcome.
const decided={...request,state:'approved' as const,decidedAt:'2026-11-05T06:48:00Z'};
assert.equal(clinicChangeRequestSchema.safeParse(decided).success,true,'deciderName stays optional while the old database omits it');
assert.equal(clinicChangeRequestSchema.safeParse({...decided,deciderName:'Synthetic approver'}).success,true);
assert.equal(clinicChangeRequestSchema.safeParse({...decided,deciderName:null}).success,true);
assert.match(decidedLine('en',{...decided,deciderName:'Synthetic approver'}),/^Approved by Synthetic approver, .+ \(UTC\+4\)$/);
assert.match(decidedLine('en',{...decided,state:'rejected',deciderName:'Noreon'}),/^Rejected by Noreon, /);
assert.match(decidedLine('hy',{...decided,deciderName:'Synthetic approver'}),/^Հաստատել է՝ Synthetic approver, /);
assert.match(decidedLine('ru',{...decided,state:'rejected',deciderName:'Noreon'}),/^Отклонено администратором Noreon, /);
assert.match(decidedLine('en',decided),/^Approved\. · /);
assert.match(decidedLine('en',{...decided,state:'cancelled',deciderName:'Synthetic approver'}),/^Cancelled\. · /);
assert.ok(renderToStaticMarkup(createElement(ChangeApprovals,{requests:[{...careRequest,...decided,kind:'care_team',summary:careRequest.summary,deciderName:'Synthetic approver'}],locale:'en',decide:async()=>'approved' as const})).includes('Approved by Synthetic approver, '));
console.log('Clinic approval decided line PASS: names the decider when sent, bare outcome otherwise (synthetic).');

// Render the nav boundary with the real filtered reader, using a mixed legacy DTO.
data={status:'ok',requests:[request,careRequest]};
const navDeps={
 '@/lib/clinic-portal/identity':{requireClinicPortal:async()=>({identity:{capability:'clinic_admin'},rpc})},
 '@/lib/clinic-admin/approvals':{readChangeRequests},
 'react/jsx-runtime':jsx,
 './navigation':{ClinicNavigation:({pendingCount}:{pendingCount:number})=>createElement('span',null,String(pendingCount))},
};
const approvalNav=loadModule('components/clinic-portal/approval-navigation.tsx',navDeps).ClinicApprovalNavigation as (p:unknown)=>Promise<ReactElement>;
assert.equal(renderToStaticMarkup(await approvalNav({items:['approvals'],clinicId:id(2),locale:'en'})),'<span>1</span>','Nav counts only care-team items');
console.log('Clinic approval navigation PASS: real reader filters profile history before the count (synthetic IO).');
