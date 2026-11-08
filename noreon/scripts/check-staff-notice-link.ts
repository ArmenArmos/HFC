/** Offline checks. The companion SQL exercises authorization against a replayed database. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as links from '@/lib/staff-zoe/notice-link';

assert.equal(typeof links.staffNoticeReturnPath,'function','Notice sign-in must preserve only an opaque notice path');
const token='ab'.repeat(24),path=`/staff/real/n/${token}`;
assert.equal(links.staffNoticeReturnPath(path),path);
for(const invalid of [null,undefined,[],`https://evil.invalid${path}`,`//evil.invalid${path}`,`${path}?member=name`,`${path}/extra`,'/staff/real/members/id','/staff/real/n/short']){
 assert.equal(links.staffNoticeReturnPath(invalid),null);
}
const login=links.staffNoticeSignInPath('/staff/real/login',path);
assert.equal(new URL(login,'https://backoffice.noreon.health').searchParams.get('next'),path);
assert.equal(links.staffNoticeReturnPath(new URL(login,'https://backoffice.noreon.health').searchParams.get('next')),path,'Signed-out round trip retains the exact token path');
assert.equal(new URL(links.staffNoticeSignInPath('/staff/real/verify',path),'https://backoffice.noreon.health').searchParams.get('next'),path,'The second step retains the same path');
const member='d2000000-0000-4000-8000-000000000001';
const chatEnv={NOREON_DOCTOR_WORKSPACE:'true',NOREON_DOCTOR_CHAT_HOME:'true',NOREON_DOCTOR_CHAT_V2:'true'};
assert.equal(links.staffTokenNoticeDestination(member,'doctor',chatEnv),`/staff/real/doctor-chat-v2/patient/${member}`);
const alertId='d2000000-0000-4000-8000-000000000002';
assert.equal(links.staffTokenNoticeDestination(member,'doctor',chatEnv,alertId),`/staff/real/doctor-chat-v2/patient/${member}?alert=${alertId}`);
for(const value of [null,undefined,'bad',`${alertId}&name=private`,[alertId]])assert.equal(links.staffTokenNoticeDestination(member,'doctor',chatEnv,value),`/staff/real/doctor-chat-v2/patient/${member}`);
for(const role of ['nurse','admin'])assert.equal(links.staffTokenNoticeDestination(member,role,chatEnv,alertId),`/staff/real/members/${member}`);
for(const role of ['nurse','admin'])assert.equal(links.staffTokenNoticeDestination(member,role,chatEnv),`/staff/real/members/${member}`);
for(const env of [{},{...chatEnv,NOREON_DOCTOR_CHAT_V2:'false'}]){
 assert.equal(links.staffTokenNoticeDestination(member,'doctor',env),`/staff/real/members/${member}`,'Flag-off links retain the existing member page');
 assert.equal(links.doctorNoticeUrl(`https://backoffice.noreon.health${path}`,env),`https://backoffice.noreon.health${path}`,'Opaque links pass through unchanged');
}
assert.equal(links.doctorNoticeUrl(`https://backoffice.noreon.health/staff/real/members/${member}`,{NOREON_DOCTOR_WORKSPACE:'true',NOREON_DOCTOR_CHAT_HOME:'true'}),`https://backoffice.noreon.health/staff/real/notice/members/${member}`,'Other notices retain existing behavior');

const sql=readFileSync('supabase/migrations/20261104175500_staff_notice_links.sql','utf8');
// Offline guard only. The SQL companion checks denied requests acquire no case lock.
const resolver=sql.slice(sql.indexOf('create function public.staff_notice_resolve'),sql.indexOf('revoke all on function public.staff_notice_resolve'));
assert.match(resolver,/for authorization_pass in 1\.\.2 loop\s+if authorization_pass=2 then\s+begin\s+perform 1 .*for share;/,'Only the second authorization pass takes the case lock');
assert.match(resolver,/for share;\s+exception when others or query_canceled then allowed:=false;exit;/,'Lock errors follow the same refusal path');
const recheck=resolver.slice(resolver.indexOf('allowed:=false;',resolver.indexOf('end;')));
assert.match(recheck,/select \* into notice[\s\S]*notice\.recipient_id=auth\.uid\(\)and notice\.expires_at>clock_timestamp\(\)/,'Both passes re-read the recipient and expiry');
assert.match(recheck,/real_clinical_staff_identity\(\)[\s\S]*_staff_zoe_assigned\(notice\.member_id\)[\s\S]*exit when not allowed;\s+end loop;/,'Current identity and assignment must pass before attempting the locking pass');
assert.match(sql,/gen_random_bytes\(24\)/);
assert.match(sql,/extensions\.digest\(.*'sha256'/);
assert.match(sql,/enable row level security/);
assert.match(sql,/grant execute on function public\.staff_notice_issue\(uuid,uuid,uuid\)to service_role/);
assert.match(sql,/grant execute on function public\.staff_notice_resolve\(text\)to authenticated/);
assert.doesNotMatch(sql,/\b(?:insert into|update) public\.system_message_templates\b/i,'No wording or approval changes');
assert.equal((sql.match(/_telegram_auth_enqueue\('care_alert.staff_notice'/g)??[]).length,3,'Initial, escalated and reassigned notices all carry links');
assert.equal((sql.match(/'https:\/\/backoffice.noreon.health\/staff\/real\/n\/'\|\|public\.staff_notice_issue/g)??[]).length,3);
const table=sql.slice(sql.indexOf('create table'),sql.indexOf('create function'));
assert.doesNotMatch(table,/\b(?:raw_token|token text)\b/,'Only the token hash is stored in the token table');
assert.doesNotMatch(sql,/\/staff\/real\/n\/'\|\|a\.member_id/,'Telegram URL never contains member identity');
console.log('PASS staff notice links: opaque destinations, bounded sign-in return path, unchanged other notices and template boundary');

// Real server entry points with Auth/RPC/navigation IO replaced. No credentials or database.
const {registerHooks}=await import('node:module') as unknown as {registerHooks:(hooks:{resolve:(s:string,c:unknown,next:(s:string,c:unknown)=>{url:string;shortCircuit?:boolean})=>{url:string;shortCircuit?:boolean}})=>{deregister:()=>void}};
const {pathToFileURL}=await import('node:url');
const {renderToStaticMarkup}=await import('react-dom/server');
const root=pathToFileURL(process.cwd()+'/').href;
const f={signedIn:false,role:'doctor',locale:'en',pendingStep:false,result:{data:[] as unknown,error:null as unknown},failRpc:false,calls:[] as {name:string;args:unknown}[]};
Object.assign(globalThis,{__staffNoticeTest:f});
const prefix='const f=globalThis.__staffNoticeTest;';
const mocks:Record<string,string>={
 'next/navigation':`export const redirect=p=>{throw Error('redirect:'+p)};export const notFound=()=>{throw Error('notFound')};`,
 'next/headers':prefix+`export const headers=async()=>new Headers({'host':'backoffice.noreon.health','x-noreon-staff-notice-path':'${path}'});export const cookies=async()=>({getAll:()=>[],get:()=>undefined});`,
 '@supabase/ssr':prefix+`export const createServerClient=()=>({rpc:async(name,args)=>{f.calls.push({name,args});if(f.failRpc)throw Error('Synthetic offline failure');return f.result;}});`,
 '@/lib/staff/real-staff-access':prefix+`export const realStaffSchema={};export const staffAccessSession=async()=>f.signedIn?{sessionId:'synthetic'}:null;export const staffAccessIdentity=async()=>({result:{data:f.pendingStep?null:{}},parsed:f.pendingStep?{success:false}:{success:true,data:{id:'synthetic',role:f.role}}});`,
 '@/lib/staff/real-staff-render':`export {requireRealStaff as requireRealStaffForRender} from '${root}lib/patient-care/clinical-case-repository.ts';`,
 '@/lib/staff/staff-locale':prefix+`export const staffLocale=async()=>f.locale;`,
 '@/lib/observability/with-logging':`export const loggedAction=(_name,action)=>action;`,
 '@/lib/telegram-auth/staff-signin':`export const sendStaffCode=async()=>({ok:true});export const verifyStaffCode=async()=>({ok:true});`,
};
const hook=registerHooks({resolve(s,c,next){const source=mocks[s];return source?{url:'data:text/javascript,'+encodeURIComponent(source),shortCircuit:true}:next(s,c);}});
const testEnv={...chatEnv,NOREON_REAL_MEMBER_REVIEW_ENABLED:'true',NEXT_PUBLIC_SUPABASE_URL:'https://notice-test.invalid',NEXT_PUBLIC_SUPABASE_ANON_KEY:'synthetic-unused',NOREON_SHARED_DEMO:'false',NOREON_WORKSPACE_SUPABASE_URL:'https://notice-test.invalid'};
const savedEnv=Object.fromEntries([...Object.keys(testEnv),'NOREON_STAFF_TELEGRAM_SIGNIN'].map(key=>[key,process.env[key]]));
Object.assign(process.env,testEnv);
try{
 const {default:page}=await import('@/app/staff/real/(review)/n/[token]/page');
 const {verifyStaffTelegramCode}=await import('@/app/staff/real/verify/actions');
 const open=()=>page({params:Promise.resolve({token})});
 // The same guard is used by the review layout before rendering the leaf page.
 await assert.rejects(open(),e=>String(e)==='Error: redirect:'+login);
 f.signedIn=true;
 for(const role of ['doctor','nurse','admin']){
  f.role=role;
  for(const focus of [null,alertId]){
   f.result={data:[{member_id:member,alert_id:focus}],error:null};
   await assert.rejects(open(),e=>String(e)==='Error: redirect:'+links.staffTokenNoticeDestination(member,role,process.env,focus));
  }
 }
 assert.deepEqual(f.calls.at(-1),{name:'staff_notice_resolve',args:{p_token:token}},'Only the server resolver supplies the member destination');
 const form=new FormData();form.set('code','123456');form.set('next',path);
 await assert.rejects(verifyStaffTelegramCode({status:'idle',message:''},form),e=>String(e)==='Error: redirect:'+path,'Successful Telegram verification returns to the exact notice');
 process.env.NOREON_STAFF_TELEGRAM_SIGNIN='true';f.pendingStep=true;
 f.result={data:{required:true,admitted:false,enrolled:true,eligible:true,staffEligible:true},error:null};
 await assert.rejects(open(),e=>String(e)==='Error: redirect:'+links.staffNoticeSignInPath('/staff/real/verify',path),'An existing password session waiting for Telegram keeps the path');
 f.pendingStep=false;
 for(const locale of ['en','hy','ru'] as const){
  f.locale=locale;
  const rendered=[];
  for(const result of [{data:[],error:null},{data:null,error:{code:'42501'}},{data:[{member_id:'malformed',alert_id:null}],error:null}]){
   f.result=result;rendered.push(renderToStaticMarkup(await open()));
  }
  f.failRpc=true;rendered.push(renderToStaticMarkup(await open()));f.failRpc=false;
  assert.equal(new Set(rendered).size,1,'Empty, error, malformed and thrown resolver failures have the same page');
  const html=rendered[0];
  assert.ok(html.includes({en:'This link isn&#x27;t available for you',hy:'Այս հղումը հասանելի չէ ձեզ',ru:'Эта ссылка вам недоступна'}[locale]!));
  assert.ok(html.includes('href="/staff/real/members"'));
  assert.ok(!html.includes(member)&&!html.includes(token),'Failure page carries no member data or token');
 }
 console.log('PASS notice server entry: signed-out/second-step return, role destinations, identical localized refusal and RPC failures (Auth/RPC mocked)');
}finally{
 hook.deregister();delete (globalThis as {__staffNoticeTest?:unknown}).__staffNoticeTest;
 for(const [key,value]of Object.entries(savedEnv)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
}
