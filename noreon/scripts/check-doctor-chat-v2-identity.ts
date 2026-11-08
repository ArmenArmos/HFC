import assert from 'node:assert/strict';
import * as identity from '@/lib/staff/member-identity';

// Removing Yerevan calendar arithmetic or trusting a birth year as an age must fail.
assert.equal(typeof identity.chatMemberIdentityLine,'function','Chat identities need DOB, age, sex, permitted phone and clinic');
const member={id:'00000000-0000-4000-8000-000000000001',name:'Ani Example',birthDate:'1986-11-06',birthYear:1986,sex:'female' as const,phoneLast4:'3456',shortId:'00000001',clinic:'Linked clinic'};
for(const locale of ['en','hy','ru'] as const){
 const before=identity.chatMemberIdentityLine(member,locale,new Date('2026-11-05T19:59:59Z'));
 const after=identity.chatMemberIdentityLine(member,locale,new Date('2026-11-05T20:00:00Z'));
 assert.match(before,/39/);assert.match(after,/40/);
 assert.match(before,/1986/);assert.match(before,/•••• 3456/);assert.match(before,/Linked clinic/);assert.match(before,/00000001/);
 assert.doesNotMatch(before,/37499123456/);
 assert.match(identity.chatMemberIdentityLine({...member,phone:'+37499123456'},locale),/\+37499123456/);
 assert.doesNotMatch(identity.chatMemberIdentityLine({...member,birthDate:null},locale),/39|40/,'Never estimate age from birth year');
 assert.doesNotMatch(identity.chatMemberIdentityLine({...member,birthDate:'2026-02-30'},locale),/30 .*2026/,'Impossible date is not an identity');
 assert.doesNotMatch(identity.chatMemberIdentityLine({...member,birthDate:'2099-11-06'},locale),/-\d/,'Future DOB never makes a negative age');
}
const {readChatMemberIdentities}=await import('@/lib/staff/chat-member-identity-read');
let calls=0;
const rpc={rpc:async(name:string,args?:Record<string,unknown>)=>{calls++;assert.equal(name,'staff_chat_member_identities');assert.deepEqual(args,{p_members:[member.id]});return {data:[member],error:null};}};
assert.deepEqual(await readChatMemberIdentities(rpc,[member.id,member.id]),[member]);
assert.equal(calls,1);
assert.equal(await readChatMemberIdentities(rpc,['invalid']),null);assert.equal(calls,1);
assert.deepEqual(await readChatMemberIdentities(rpc,[]),[]);assert.equal(calls,1);
const {resolveQuestionMember}=await import('@/lib/staff-zoe/chat-v2-zoe-read');
const twin={...member,id:'00000000-0000-4000-8000-000000000002',birthDate:'1992-04-15',phoneLast4:'7890',shortId:'00000002'};
const found=await resolveQuestionMember('What did Ani Example write?',undefined,async()=>({kind:'members',page:{rows:[member,twin],hasMore:false,nextCursor:null}}));
assert.equal(found.kind,'choose','A same-name pair must never auto-pick');
if(found.kind==='choose')assert.equal(found.rows.length,2);
console.log('Doctor chat identity: Yerevan birthday, missing dates, role-safe read contract and same-name guard passed.');

// Render the production components with only identity IO replaced. No auth, network or hosted data.
const React=await import('react');
const jsx=await import('react/jsx-runtime');
const {create,act}=await import('react-test-renderer');
const {renderToStaticMarkup}=await import('react-dom/server');
const {readFileSync}=await import('node:fs');
const vm=await import('node:vm');
const ts=(await import('typescript')).default;
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const pending=new Map<string,(value:unknown)=>void>();
const identityRequests:string[][]=[];
const modules:Record<string,unknown>={
 react:React,'react/jsx-runtime':jsx,
 '@/lib/staff/member-identity':identity,
 '@/lib/staff/staff-locale-copy':await import('@/lib/staff/staff-locale-copy'),
 '@/lib/staff/chat-member-identity-actions':{readStaffChatMemberIdentities:async(ids:string[])=>{identityRequests.push(ids);return new Promise(resolve=>pending.set(ids[0],resolve));}},
};
function loadComponent(file:string){
 const exports:Record<string,unknown>={};
 vm.runInNewContext(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,Promise,Date,require:(name:string)=>{assert.ok(name in modules,name);return modules[name];}});
 return exports;
}
modules['./member-identity']=loadComponent('components/staff/member-identity.tsx');
const ui=loadComponent('components/staff/chat-member-identity.tsx') as typeof import('@/components/staff/chat-member-identity');
modules['@/components/staff/chat-member-identity']=ui;
const {DoctorMemberBanner}=loadComponent('components/doctor-chat-v2/member-banner.tsx') as typeof import('@/components/doctor-chat-v2/member-banner');
let chosen:string[]=[];
for(const locale of ['en','hy','ru'] as const){
 const html=renderToStaticMarkup(React.createElement(ui.MemberDisambiguationCard,{rows:[member,twin],locale,onChoose:row=>chosen.push(row.id)}));
 assert.match(html,/1986/);assert.match(html,/1992/);assert.match(html,/3456/);assert.match(html,/7890/);assert.match(html,/Linked clinic/);assert.match(html,/00000001/);assert.match(html,/00000002/);
}
let view:ReturnType<typeof create>;
await act(async()=>{view=create(React.createElement(ui.MemberDisambiguationCard,{rows:[member,twin],locale:'en',onChoose:row=>chosen.push(row.id)}));});
assert.deepEqual(chosen,[],'Rendering same-name identities opens neither');
await act(async()=>view!.root.findAllByType('button')[1].props.onClick());
assert.deepEqual(chosen,[twin.id],'Only the chosen identity opens');
await act(async()=>view!.unmount());
// An old response after a switch must never become the new member's banner.
await act(async()=>{view=create(React.createElement(DoctorMemberBanner,{member:{memberId:member.id,memberName:member.name},locale:'en',restored:false}));});
await act(async()=>view!.update(React.createElement(DoctorMemberBanner,{member:{memberId:twin.id,memberName:twin.name},locale:'en',restored:false})));
await act(async()=>pending.get(twin.id)!([twin]));
assert.match(JSON.stringify(view!.toJSON()),/1992/);assert.doesNotMatch(JSON.stringify(view!.toJSON()),/1986/);
await act(async()=>pending.get(member.id)!([member]));
assert.match(JSON.stringify(view!.toJSON()),/1992/);assert.doesNotMatch(JSON.stringify(view!.toJSON()),/1986/);
assert.equal(view!.root.findByProps({'data-current-member':twin.id}).props['aria-live'],'polite');
await act(async()=>view!.unmount());
// Loading and failed identities cannot open a queue row.
chosen=[];
await act(async()=>{view=create(React.createElement(ui.MemberIdentityButton,{memberId:member.id,name:member.name,locale:'en',onClick:()=>chosen.push(member.id)}));});
assert.equal(view!.root.findByType('button').props.disabled,true);
await act(async()=>view!.root.findByType('button').props.onClick({}));assert.deepEqual(chosen,[]);
await act(async()=>pending.get(member.id)!(null));
assert.equal(view!.root.findByType('button').props.disabled,true);
await act(async()=>view!.root.findByType('button').props.onClick({}));assert.deepEqual(chosen,[]);
await act(async()=>view!.unmount());
console.log('Doctor chat identity UI: both same-name lines, explicit choice, switch response race, live banner and unavailable-identity guard passed (rendered React, synthetic identity IO).');

const readCount=identityRequests.length;
await act(async()=>{view=create(React.createElement(React.StrictMode,null,React.createElement(ui.ChatMemberIdentityProvider,null,
 React.createElement(ui.ChatMemberIdentity,{memberId:member.id,name:member.name,locale:'en'}),
 React.createElement(ui.ChatMemberIdentity,{memberId:member.id,name:member.name,locale:'en'}),
 React.createElement(ui.ChatMemberIdentity,{memberId:twin.id,name:twin.name,locale:'en'}))));});
assert.equal(identityRequests.length,readCount+1,'Repeated cards share one bounded identity batch, including StrictMode');
assert.deepEqual(Array.from(identityRequests.at(-1)!),[member.id,twin.id]);
await act(async()=>pending.get(member.id)!([member,twin]));
assert.match(JSON.stringify(view!.toJSON()),/1986/);assert.match(JSON.stringify(view!.toJSON()),/1992/);
await act(async()=>view!.unmount());
console.log('Chat identity loader batches repeated member cards inside one staff view.');

// Execute the session-bound server read, including an over-broad RPC payload.
// An admin is never an assigned doctor/nurse and must retain only the last four.
let actorRole='admin';
let rpcPhone=true;
modules['@/lib/observability/with-logging']={loggedAction:(_name:string,fn:unknown)=>fn};
modules['@/lib/patient-care/clinical-case-repository']={requireRealStaff:async()=>({identity:{role:actorRole},client:{rpc:async(name:string,args:unknown)=>{
 assert.equal(name,'staff_chat_member_identities');assert.deepEqual(JSON.parse(JSON.stringify(args)),{p_members:[member.id]});
 return {data:[{...member,...(rpcPhone?{phone:'+37499123456'}:{})}],error:null};
}}})};
modules['./chat-member-identity-read']={readChatMemberIdentities};
const {readStaffChatMemberIdentities}=loadComponent('lib/staff/chat-member-identity-actions.ts') as typeof import('@/lib/staff/chat-member-identity-actions');
for(const fullPhone of [false,true]){
 rpcPhone=fullPhone;
 const rows=await readStaffChatMemberIdentities([member.id]);
 assert.ok(rows);assert.equal(rows[0].phoneLast4,'3456');assert.equal('phone'in rows[0],false,'Admin server read exposes masked last four only, even if the RPC returns a full phone');
 assert.doesNotMatch(JSON.stringify(rows),/37499123456/);
}
for(actorRole of ['doctor','nurse']){
 const rows=await readStaffChatMemberIdentities([member.id]);
 assert.equal(rows?.[0].phone,'+37499123456','The care-team RPC payload keeps its permitted full phone');
}
console.log('Chat identity server read: admin last-four-only projection with masked and over-broad fake RPCs; care-team full phones preserved.');


// The mismatch comparison enriches its member through the same role-filtered identity action.
modules['@/lib/lab-ai/empty-read-copy']=await import('@/lib/lab-ai/empty-read-copy');
modules['@/components/patient-care/common']={stamp:()=> 'Synthetic upload time'};
const {UploadIdentityChecks}=loadComponent('components/staff/upload-identity-check.tsx') as typeof import('@/components/staff/upload-identity-check');
const beforeMismatch=identityRequests.length;
await act(async()=>{view=create(React.createElement(UploadIdentityChecks,{locale:'en',rows:[{
 fileId:'00000000-0000-4000-8000-000000000003',fileName:'Synthetic sheet.pdf',at:'2026-11-05T09:00:00Z',clinicName:'Upload clinic',
 mismatch:'name',reason:null,sheet:{name:'Different sheet name',birthDate:'1970-01-01'},member:{name:member.name,birthDate:member.birthDate},
 current:true,memberId:member.id,memberName:member.name,jobState:null,
}]}));});
assert.equal(identityRequests.length,beforeMismatch+1,'Mismatch comparison uses the shared identity loader');
assert.deepEqual(Array.from(identityRequests.at(-1)!),[member.id]);
assert.match(JSON.stringify(view!.toJSON()),/Different sheet name/,'The sheet identity remains separate');
await act(async()=>pending.get(member.id)!([{...member,phone:'+37499123456'}]));
assert.match(JSON.stringify(view!.toJSON()),/Linked clinic/);
assert.match(JSON.stringify(view!.toJSON()),/\+37499123456/,'The care-team identity replaces the initial comparison fallback');
assert.equal(view!.root.findByProps({'data-member-identity':member.id}).type,'span');
assert.equal(view!.root.findAllByType('button').length,0,'Shared identity enrichment adds no confirmation action');
await act(async()=>view!.unmount());
console.log('Mismatch comparison: shared role-filtered identity loader, sheet/member separation and read-only notice passed (mocked identity IO).');
