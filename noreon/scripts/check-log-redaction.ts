import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {LOG_FIELDS,normaliseRoute,redactEvent,scrubCounts,scrubErrorMessage,scrubStack} from '@/lib/observability/redact';
import {createLogger,errorFields} from '@/lib/observability/logger';
import {clientIpPrefix,cookieActor,country,ipPrefix,uaFamily} from '@/lib/observability/request-meta';

/**
 * Privacy check for server logs: sample objects full of member data go in, and nothing that
 * identifies a person or carries health content may come out. If this fails, a field or a
 * scrubber lets data through: fix lib/observability/redact.ts, never the samples.
 */
const memberId='3f1c9a52-7d4e-4b8a-9c11-2e5f6a7b8c9d';
const staffId='a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const pii={
  name:'Anahit Petrosyan',fullName:'Anahit Petrosyan',first_name:'Anahit',
  phone:'+37491234567',email:'anahit.p@example.am',
  message:'I have chest pain since this morning',text:'Զգում եմ ցավ կրծքավանդակում',
  answers:{chest_pain:'yes',smoker:'20 per day'},answer:'yes',
  systolic:182,diastolic:121,pulse:97,bp:'182/121',
  glucose:11.4,ldl:4.9,hba1c:7.8,labValue:'LDL 4.9 mmol/L',
  document:'%PDF-1.7 ...',contents:'Lab report for Anahit',
  token:'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.abc',access_token:'sbp_123456',
  cookie:'sb-access-token=eyJhbGci; noreon-real-clinic-auth=xyz',
  authorization:'Bearer sk-live-123',headers:{authorization:'Bearer x',cookie:'a=b'},
  query:'?phone=%2B37491234567',url:'https://app.noreon.health/welcome?token=abc123456789',
  body:{phone:'+37491234567'},args:{p_member:memberId,p_text:'chest pain'},result:{systolic:182},
};
const forbidden=['Anahit','Petrosyan','37491234567','91234567','example.am','chest','pain','Զգում','182','121','4.9','7.8','PDF','eyJ','sbp_','sk-live','cookie=','abc123456789','smoker','20 per day','mmol'];
// The clock fields (_time, ts) are generated, never copied from input, and a real
// timestamp like "…:57.812Z" contains "7.8" by chance, so they are left out of the search.
const CLOCK=new Set(['_time','ts']);
const withoutClock=(value:unknown):unknown=>{
  if(typeof value==='string'&&value.startsWith('{')){try{return withoutClock(JSON.parse(value));}catch{return value;}}
  if(Array.isArray(value))return value.map(withoutClock);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>!CLOCK.has(key)).map(([key,v])=>[key,withoutClock(v)]));
  return value;
};
const leaks=(event:unknown)=>{const text=JSON.stringify(withoutClock(event));return forbidden.filter(word=>text.includes(word));};
// The search itself must still see everything else: a planted value in any other field is caught.
assert.deepEqual(leaks({ts:'2026-10-18T12:34:57.812Z',_time:'x182',nested:['{"ts":"7.8","msg":"chest"}']}),['chest'],'Only the clock fields are skipped');

// 1. Unknown fields are dropped whole, whatever their value.
const event=redactEvent('info','route',{...pii,request_id:'req_12345678',actor_id:staffId,member_id:memberId,status:200,duration_ms:12.345});
assert.deepEqual(leaks(event),[],'No sample PII/PHI survives redaction');
assert.equal(event.member_id,memberId);assert.equal(event.actor_id,staffId);assert.equal(event.status,200);assert.equal(event.duration_ms,12.3);
assert.equal(event.redacted_fields,Object.keys(pii).length,'Dropped fields are only counted');
for(const key of Object.keys(pii))assert.equal(key in event,false,`${key} is never a log field`);

// 2. Allow-listed fields reject values of the wrong shape.
const shaped=redactEvent('info','route',{actor_id:'Anahit Petrosyan',member_id:'+37491234567',rpc:'chest pain',table:'members; drop',action:'save anahit',sweep:'Telegram Sweep',error_code:'value "182/121"',request_id:'short',method:'TRACE',status:999,actor_kind:'doctor',region:'Frankfurt am Main',commit:'not-a-sha',digest:'NEXT_REDIRECT;replace;/patient?phone=1;307;'});
assert.deepEqual(leaks(shaped),[],'Wrongly shaped values are dropped');
for(const key of ['actor_id','member_id','rpc','table','action','sweep','error_code','request_id','method','status','actor_kind','region','commit','digest'])assert.equal(key in shaped,false,`${key} rejects a malformed value`);
assert.equal(redactEvent('info','Saved answers for Anahit').msg,'invalid_msg','A message is an event name, never free text');
assert.equal(redactEvent('loud','x').level,'info');
// Staff Zoe binding fields contain only UUIDs and a fixed clinical staff role.
for(const key of ['conversation_id','run_id','submission_id']){
 assert.equal(redactEvent('info','staff_zoe.ask.accepted',{[key]:memberId.toUpperCase()})[key],memberId);
 for(const value of ['Anahit Petrosyan','+37491234567','182/121',{},123])assert.equal(key in redactEvent('info','staff_zoe.ask.accepted',{[key]:value}),false);
}
for(const role of ['doctor','nurse'])assert.equal(redactEvent('info','staff_zoe.ask.accepted',{staff_role:role}).staff_role,role);
for(const role of ['admin','Anahit Petrosyan',{},123])assert.equal('staff_role' in redactEvent('info','staff_zoe.ask.accepted',{staff_role:role}),false);
// Booking diagnostics admit only fixed locations and failure reasons, never free text.
for(const place of ['page','runtime'])assert.equal(redactEvent('error','booking.load_failed',{place}).place,place);
for(const reason of ['unavailable','clinical-hold','profile-mismatch','source-unavailable'])assert.equal(redactEvent('error','booking.load_failed',{unavailable_reason:reason}).unavailable_reason,reason);
for(const value of ['Anahit Petrosyan','chest pain','182/121',{},123]){
 assert.equal('place' in redactEvent('error','booking.load_failed',{place:value}),false);
 assert.equal('unavailable_reason' in redactEvent('error','booking.load_failed',{unavailable_reason:value}),false);
}

// 3. Routes keep words and turn ids, numbers, tokens and names into placeholders; queries are removed.
assert.equal(normaliseRoute(`/staff/real/members/${memberId}/documents/9b2f?download=1`),'/staff/real/members/:id/documents/:x');
assert.equal(normaliseRoute('/welcome/k7Pq9xZ2mN4vB8rT1yU6wE3sA5dF0gH?ref=sms'),'/welcome/:x');
assert.equal(normaliseRoute('/patient/reports/123/original'),'/patient/reports/:n/original');
assert.equal(normaliseRoute('/patient/anahit.p@example.am'),'/patient/:x');
assert.equal(normaliseRoute('/patient/+37491234567'),'/patient/:x');
assert.equal(normaliseRoute('/staff/real/(review)/members/[id]/gp-report'),'/staff/real/(review)/members/[id]/gp-report','Next route templates are kept');
assert.equal(normaliseRoute('/patient/progress#bp=182'),'/patient/progress');
assert.equal(normaliseRoute('https://evil.example/patient'),undefined);

// 4. Error text: quoted values, emails, phones, digits, URLs and opaque strings are scrubbed.
const messages=[
  'invalid input syntax for type uuid: "Anahit Petrosyan"',
  'duplicate key value violates unique constraint "members_phone_key" Key (phone)=(+37491234567) already exists.',
  'Failed to send to anahit.p@example.am: 550',
  'fetch https://app.noreon.health/welcome?token=abc123456789 failed',
  "Reading 182/121 is out of range for 'Anahit'",
  'JWT eyJhbGciOiJIUzI1NiJ9eyJzdWIiOiIxMjMifQabcdef expired',
  'chest pain «Anahit» note: `I have chest pain`',
];
for(const message of messages){const out=scrubErrorMessage(message);assert.ok(out===undefined||!/Anahit|37491234567|example\.am|abc123456789|182|eyJ|I have chest/.test(out),`Scrubbed: ${out}`);}
for(const pg of ['new row for relation "measurements" violates check constraint "bp_range" Failing row contains (3f1c9a52, 182, 121, Anahit, chest pain).','null value in column x violates not-null constraint DETAIL: Failing row contains (Anahit, +37491234567)','duplicate key value violates unique constraint members_phone_key Key (phone)=(+37491234567) already exists'])
  assert.ok(!/Anahit|182|121|chest|37491234567|3f1c9a52/.test(scrubErrorMessage(pg)??''),`Postgres row details are dropped: ${scrubErrorMessage(pg)}`);
assert.equal(scrubErrorMessage('violates check constraint bp_range Failing row contains (182, 121).'),'violates check constraint bp_range <detail>');
assert.equal(scrubErrorMessage('Telegram channel database unavailable (PGRST303)'),'Telegram channel database unavailable (PGRST#)','Plain code-authored messages stay readable');
// Opus L-1: every number goes, lower-case names go, words in parentheses go.
assert.equal(scrubErrorMessage('member armen petrosyan not found'),'member <w> <w> not found');
assert.equal(scrubErrorMessage('BP 95/60 pulse 72'),'BP #/# <w> #');
assert.equal(scrubErrorMessage('lookup failed (armen petrosyan, age 54)'),'lookup failed (?)');
assert.equal(scrubErrorMessage('reminder 3 of 7 for anahit skipped'),'reminder # of # for <w> skipped');
assert.equal(scrubErrorMessage('fetch failed: ECONNRESET on rpc member_home_summary'),'fetch failed: ECONNRESET on rpc member_home_summary','Codes and identifiers stay');
assert.equal(scrubErrorMessage('Cannot read properties of undefined (reading x)'),'Cannot read properties of undefined (?)');
for(const message of ['member armen petrosyan not found','BP 95/60 pulse 72','smoker 20 per day, chest pain','name: lilit hakobyan phone 091 23 45 67'])
  assert.ok(!/armen|petrosyan|95|60|72|20|chest|pain|lilit|hakobyan|091/.test(scrubErrorMessage(message)??''),`Scrubbed: ${scrubErrorMessage(message)}`);
// Opus L-2: codes and names are code-shaped, never long digit strings or free text.
for(const code of ['23505','PGRST303','ECONNRESET','UND_ERR_SOCKET','otp_expired','42P01'])assert.equal(redactEvent('error','x',{error_code:code}).error_code,code,code);
for(const code of ['37491234567','A123456789','ID_99887766','chest pain','4.9'])assert.equal('error_code' in redactEvent('error','x',{error_code:code}),false,code);
for(const name of ['Error','TypeError','PostgrestError','AuthApiError'])assert.equal(redactEvent('error','x',{error_name:name}).error_name,name);
for(const name of ['anahit','Anahit_Petrosyan','Error123456'])assert.ok(name==='Error123456'||!('error_name' in redactEvent('error','x',{error_name:name})),name);
assert.equal(scrubErrorMessage('Member Anahit Petrosyan has BP 182/121'),'Member <w> <w> has BP #/#','Capitalised words outside the vocabulary are treated as names');
assert.equal(scrubErrorMessage('Անահիտ Պետրոսյան error'),'<w> <w> error','Non-Latin words are dropped');

// 5. Stacks keep frames only.
const error=new Error('Member Anahit Petrosyan +37491234567 has BP 182/121');
const stack=scrubStack(error.stack);
assert.ok(stack&&stack.startsWith('at '),'Frames are kept');
assert.deepEqual(leaks({stack}),[],'The message line of a stack is never kept');
assert.equal(scrubStack('Error: Anahit\n    at "Anahit" (file:///x.ts?token=abc123456789:1:2)')?.includes('abc123456789')??false,false);
const fromError=redactEvent('error','route',errorFields(Object.assign(new Error('value "Anahit" for +37491234567'),{code:'23505'})));
assert.deepEqual(leaks(fromError),[],'errorFields + redaction leak nothing');
assert.equal(fromError.error_code,'23505');assert.equal(fromError.error_name,'Error');

// 6. Sweep counts: numbers under code-defined keys only, never clinical-looking keys, never strings.
const counts=scrubCounts({processed:4,failed:0,hasMore:true,systolic:182,score:9,hba1c:7.8,ldl:4.9,glucoseMmol:11,name:'Anahit',zoe:{sent:2,text:'chest pain',reading:182},members:[{phone:'+37491234567'}]});
assert.deepEqual(counts,{processed:4,failed:0,hasMore:1,'zoe.sent':2},'Only count-named keys survive');

// 7. The logger applies the same gate to everything it prints or sends.
const printed:string[]=[];
const logger=createLogger({env:{NOREON_LOG_CONSOLE:'on'},console:{log:(line:string)=>printed.push(line),warn:(line:string)=>printed.push(line),error:(line:string)=>printed.push(line)}});
logger.info('route',pii);logger.error('error.unhandled',{...pii,...errorFields(error)});logger.warn('sweep',{counts:{...pii,processed:3}});
assert.equal(printed.length,3);assert.deepEqual(leaks(printed),[],'Console lines are redacted too');
for(const line of printed){const parsed=JSON.parse(line);for(const key of Object.keys(parsed))assert.ok(key in LOG_FIELDS||['_time','ts','level','msg','redacted_fields'].includes(key),`Unexpected field ${key}`);}

// 8. Proxy request facts: the IP is only ever a /24 or /48 network, the user agent only a family.
assert.equal(ipPrefix('203.0.113.77'),'203.0.113.0/24');
assert.equal(ipPrefix('::ffff:203.0.113.77'),'203.0.113.0/24');
assert.equal(ipPrefix('2001:0db8:85a3:0000:0000:8a2e:0370:7334'),'2001:db8:85a3::/48');
assert.equal(ipPrefix('2001:db8::1'),'2001:db8:0::/48');
assert.equal(ipPrefix('[2a02:2149:8a1b:4c00::12]'),'2a02:2149:8a1b::/48');
for(const bad of ['999.1.1.1','not-an-ip','1.2.3','2001:db8::1::2','',undefined])assert.equal(ipPrefix(bad),undefined,String(bad));
assert.equal(clientIpPrefix(new Headers({'x-forwarded-for':'198.51.100.23, 10.0.0.1'})),'198.51.100.0/24','First forwarded hop');
assert.equal(clientIpPrefix(new Headers({'x-real-ip':'192.0.2.9','x-forwarded-for':'198.51.100.23'})),'192.0.2.0/24','Vercel x-real-ip first');
const ipEvent=redactEvent('info','proxy',{ip_prefix:'203.0.113.77',ip:'203.0.113.77'});
assert.equal('ip_prefix' in ipEvent,false,'A full IPv4 address is never accepted as ip_prefix');assert.ok(!JSON.stringify(ipEvent).includes('113.77'));
assert.equal('ip_prefix' in redactEvent('info','proxy',{ip_prefix:'2001:db8:85a3:8a2e::/64'}),false,'Only /48 for IPv6');
assert.equal(redactEvent('info','proxy',{ip_prefix:'203.0.113.0/24'}).ip_prefix,'203.0.113.0/24');
assert.equal(country(new Headers({'x-vercel-ip-country':'am'})),'AM');assert.equal(country(new Headers({'x-vercel-ip-country':'Yerevan'})),undefined);
assert.equal(uaFamily('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'),'safari');
assert.equal(uaFamily('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36'),'chrome');
assert.equal(uaFamily('Mozilla/5.0 ... Chrome/130.0 Safari/537.36 Edg/130.0'),'edge');
assert.equal(uaFamily('Mozilla/5.0 ... Telegram-Android/11.2'),'telegram');assert.equal(uaFamily('Googlebot/2.1'),'bot');
assert.equal(redactEvent('info','proxy',{ua_family:'Mozilla/5.0 (iPhone)'}).ua_family,undefined,'A raw user agent is never accepted');
assert.equal(cookieActor(['sb-abcd-auth-token.0']),'member');assert.equal(cookieActor(['noreon-real-staff-auth']),'staff');
assert.equal(cookieActor(['noreon-real-clinic-auth','sb-abcd-auth-token']),'clinic');assert.equal(cookieActor(['_ga','theme']),'anon');

// 9. Server components read the request id from Next's request store; keep that import alive across upgrades.
assert.ok(existsSync('node_modules/next/dist/server/app-render/work-unit-async-storage.external.js'),'Next request store module moved: update lib/observability/context.ts');

console.log('Log redaction drops unknown fields, rejects malformed ids, scrubs routes, errors, stacks and counts, and leaks none of the PII/PHI samples.');
