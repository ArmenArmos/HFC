import assert from 'node:assert/strict';
import {memberSearchInputSchema,memberSearchPageSchema} from '@/lib/staff/member-search-schema';
import {runMemberSearch,runMemberIdentitySearch} from '@/lib/staff/member-search-command';
import {memberRequestedAt} from '@/lib/staff/member-queue-format';
assert.equal(memberRequestedAt('2026-01-01T00:00:00+00:00'),'01/01/2026 04:00');
assert.equal(memberRequestedAt('2025-12-31T22:15:00Z'),'01/01/2026 02:15');
const id='11111111-1111-4111-8111-111111111111';
assert.equal(memberSearchInputSchema.parse({query:'  Արմեն  ',cursor:null}).query,'Արմեն');
assert.equal(memberSearchInputSchema.parse({query:'+374 (99) 12-34-56',cursor:null}).query,'+374 (99) 12-34-56');
assert.equal(memberSearchInputSchema.parse({query:'',cursor:null}).query,'');
for(const query of ['1','123','+3 (74)','a','a'.repeat(101),'John\nSmith'])assert.equal(memberSearchInputSchema.safeParse({query,cursor:null}).success,false);
assert.equal(memberSearchInputSchema.safeParse({query:'12ab',cursor:null}).success,true);
assert.equal(memberSearchInputSchema.safeParse({query:'Jo',cursor:{createdAt:'bad',id}}).success,false);
assert.equal(memberSearchInputSchema.safeParse({query:'Jo',cursor:{id}}).success,false);
const row={id,name:'Synthetic member',revision:0,doctorId:null,nurseId:null,createdAt:'2026-10-16T00:00:00+00:00',bookingCounts:{requested:0,providerProposed:0,confirmed:0,changePending:0}};
const page={rows:[row],hasMore:false,nextCursor:null};
assert.deepEqual(memberSearchPageSchema.parse(page),page);
for(const birthYear of [1980,null])assert.equal(memberSearchPageSchema.parse({...page,rows:[{...row,birthYear}]}).rows[0].birthYear,birthYear);
assert.equal(memberSearchPageSchema.safeParse({...page,rows:[{...row,birthYear:'1980'}]}).success,false);
const identity={birthDate:'1980-05-12',phoneLast4:'1234',shortId:null};
assert.deepEqual(memberSearchPageSchema.parse({...page,rows:[{...row,...identity}]}).rows[0],{...row,...identity});
for(const phoneLast4 of ['123','12345','+37499123456'])assert.equal(memberSearchPageSchema.safeParse({...page,rows:[{...row,phoneLast4}]}).success,false);
assert.equal(memberSearchPageSchema.safeParse({...page,rows:[{...row,phone:'secret'}]}).success,false);
assert.equal(memberSearchPageSchema.safeParse({...page,hasMore:true}).success,false);
assert.equal(memberSearchPageSchema.safeParse({...page,nextCursor:{id,createdAt:row.createdAt}}).success,false);
let calls=0;
assert.deepEqual(await runMemberSearch({query:'1',cursor:null},async()=>{calls++;return {data:page,error:null};}),{ok:false,reason:'invalid'});
assert.equal(calls,0);
assert.deepEqual(await runMemberSearch({query:'31.02.1968',cursor:null},async()=>({data:null,error:{code:'22023',message:'Enter a valid date of birth'}})),{ok:false,reason:'invalid'},'A server-rejected date stays invalid rather than unavailable');
assert.deepEqual(await runMemberSearch({query:'John',cursor:null},async()=>({data:page,error:null})),{ok:true,page});
assert.deepEqual(await runMemberSearch({query:'John',cursor:null},async()=>({data:null,error:{code:'42501'}})),{ok:false,reason:'unavailable'});
assert.deepEqual(await runMemberSearch({query:'John',cursor:null},async()=>{throw Error('sensitive');}),{ok:false,reason:'unavailable'});
assert.deepEqual(await runMemberSearch({query:'John',cursor:null},async()=>({data:{...page,rows:[{...row,phone:'secret'}]},error:null})),{ok:false,reason:'unavailable'});
console.log('Member search query/cursor/strict DTO and unavailable-vs-empty checks passed.');

// Execute actual server-action body with isolated IO; SQL separately proves scope.
const {readFileSync}=await import('node:fs');
const vm=await import('node:vm');const ts=await import('typescript');
const source=readFileSync('lib/staff/real-member-search-actions.ts','utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
let denied=true,rpcDenied=false,reads=0;let seen:unknown;
const modules:Record<string,unknown>={
 '@/lib/patient-care/clinical-case-repository':{requireRealStaff:async()=>{if(denied)throw Error('Denied');return {client:{rpc:async(name:string,args:unknown)=>{assert.equal(name,'patient_clinical_case_search_identity');seen=args;reads++;return {data:page,error:rpcDenied?{code:'42501'}:null};}}};}},
 './member-search-command':{runMemberIdentitySearch},
 // The TEST badge read is covered by check-test-account-reset.sql; here it passes the page through.
 './test-accounts':{withTestAccountFlags:async(_client:unknown,result:unknown)=>result},
};
const actions:Record<string,(raw:unknown)=>Promise<unknown>>={};
vm.runInNewContext(compiled,{exports:actions,require:(name:string)=>{if(name==='@/lib/observability/with-logging')return {loggedAction:(_action:string,run:unknown)=>run,withRouteLogging:(handler:unknown)=>handler,logSweep:()=>{}};assert.ok(name in modules);return modules[name];}});
await assert.rejects(()=>actions.searchRealMembers({query:'John',cursor:null}),/Denied/);assert.equal(reads,0);
denied=false;await actions.searchRealMembers({query:' John ',cursor:null});assert.equal(reads,1);assert.equal(JSON.stringify(seen),JSON.stringify({p_query:'John'}));
await actions.searchRealMembers({query:'John',cursor:{id,createdAt:row.createdAt}});
assert.equal(JSON.stringify(seen),JSON.stringify({p_query:'John',p_after_created_at:row.createdAt,p_after_user_id:id}));
rpcDenied=true;
for(const input of [{query:'',cursor:null},{query:'John',cursor:null},{query:'John',cursor:{id,createdAt:row.createdAt}}]){
 assert.deepEqual(await actions.searchRealMembers(input),{ok:false,reason:'unavailable'},'An audit refusal returns no member data on first load, search or paging');
}
console.log('Actual exported search action: authentication first, fixed RPC and validated cursor arguments passed (mocked IO).');
