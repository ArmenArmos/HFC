import assert from 'node:assert/strict';
import {memberIdentityParts,memberIdentityLine} from '@/lib/staff/member-identity';
import {calendarDate} from '@/lib/staff/yerevan-time';
import type {StaffLocale} from '@/lib/staff/staff-locale-copy';

const member={name:'Ani Example',birthDate:'1986-01-01',birthYear:1985,phoneLast4:'1234',shortId:null};
for(const [locale,fallback] of [['en','Member'],['hy','Անդամ'],['ru','Участник']] as const){
 const parts=memberIdentityParts(member,locale);
 assert.equal(parts[0],member.name);
 assert.equal(parts.length,3);
 assert.equal(parts[1],calendarDate('1986-01-01',locale));
 assert.doesNotMatch(parts[1],/^\d{1,2}[/.\-]\d{1,2}[/.\-]\d{4}$/,'Never a numeric day/month date');
 assert.equal(parts[2],'•••• 1234');
 assert.equal(memberIdentityLine(member,locale),parts.join(' · '));
 assert.deepEqual(memberIdentityParts({name:null},locale),[fallback]);
 assert.deepEqual(memberIdentityParts({name:' ',birthYear:1986,shortId:'NRN-AB'},locale),[fallback,'1986','NRN-AB']);
 assert.deepEqual(memberIdentityParts({name:'Ani',birthDate:null,birthYear:1986},locale),['Ani','1986']);
 assert.deepEqual(memberIdentityParts({name:'Ani',birthDate:'invalid'},locale),['Ani']);
 for(const phoneLast4 of [null,'','123','+37499123456','12a4'])assert.deepEqual(memberIdentityParts({name:'Ani',phoneLast4},locale),['Ani']);
 assert.doesNotMatch(memberIdentityLine(member,locale),/[<>*_`]/,'Plain text has no added markup');
 assert.equal(parts[2].replace(/\D/g,'').length,4);
}
// UTC midnight is the previous day in Los Angeles. A date-only birthday stays put.
const previous=process.env.TZ;
try{
 for(const timezone of ['America/Los_Angeles','Pacific/Kiritimati','Asia/Yerevan']){
  process.env.TZ=timezone;
  for(const locale of ['en','hy','ru'] as StaffLocale[])assert.equal(memberIdentityParts(member,locale)[1],calendarDate('1986-01-01',locale));
 }
}finally{if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous;}
console.log('Member identity: three locales, optional parts, date-only timezone stability, plain text and four-digit phone passed.');

// Actual scoped read and server action with isolated auth/RPC, never hosted IO.
const {runStaffMemberIdentities}=await import('@/lib/staff/member-identity-command');
const {readFileSync}=await import('node:fs');
const vm=await import('node:vm');
const ts=await import('typescript');
const id='aa110000-0000-4000-8000-000000000001';
const other='aa110000-0000-4000-8000-000000000002';
let reads=0,denied=true,answer:unknown=[{id,...member}],rpcError=false;
const client={rpc:async(name:string,args:unknown)=>{assert.equal(name,'staff_member_identities');assert.deepEqual(JSON.parse(JSON.stringify(args)),{p_members:[id]});reads++;return {data:answer,error:rpcError?{code:'42501'}:null};}};
for(const input of ['invalid',['invalid'],Array(51).fill(id)])assert.equal(await runStaffMemberIdentities(input,client),null);
assert.deepEqual(await runStaffMemberIdentities([],client),[]);assert.equal(reads,0);
assert.deepEqual(await runStaffMemberIdentities([id,id],client),answer);
answer=[];assert.deepEqual(await runStaffMemberIdentities([id],client),[],'An inaccessible member is absent');
for(answer of [[{id,...member,phoneLast4:'37499123456'}],[{id:other,...member}],[{id,...member},{id,...member}]])assert.equal(await runStaffMemberIdentities([id],client),null);
answer=[{id,...member}];rpcError=true;assert.equal(await runStaffMemberIdentities([id],client),null);rpcError=false;
assert.equal(await runStaffMemberIdentities([id],{rpc:async()=>{throw Error('synthetic');}}),null);
const exports:Record<string,(input:unknown)=>Promise<unknown>>={};
const modules:Record<string,unknown>={
 '@/lib/observability/with-logging':{loggedAction:(_name:string,fn:unknown)=>fn},
 '@/lib/patient-care/clinical-case-repository':{requireRealStaff:async()=>{if(denied)throw Error('Denied');return {client};}},
 './member-identity-command':{runStaffMemberIdentities},
};
vm.runInNewContext(ts.transpileModule(readFileSync('lib/staff/member-identity-actions.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:(name:string)=>{assert.ok(name in modules,name);return modules[name];}});
const before=reads;await assert.rejects(()=>exports.readStaffMemberIdentities([id]),/Denied/);assert.equal(reads,before);
denied=false;assert.deepEqual(await exports.readStaffMemberIdentities([id]),answer);
console.log('Member identity action: authentication first, bounded IDs, strict response, omitted inaccessible members and safe failure passed (isolated IO).');
