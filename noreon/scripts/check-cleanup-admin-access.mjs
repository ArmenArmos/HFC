import assert from 'node:assert/strict';
import {readFile,stat} from 'node:fs/promises';
import {request} from 'node:http';
const origin=process.env.NOREON_TEST_APP_ORIGIN,sessionFile=process.env.NOREON_TEST_STAFF_SESSIONS;
assert.ok(origin&&sessionFile,'Explicit local app origin and private fictional session file required');
assert.ok(['127.0.0.1','localhost'].includes(new URL(origin).hostname)&&new URL(origin).protocol==='http:','Local fixture app only');
assert.equal((await stat(sessionFile)).mode&0o077,0,'Fixture sessions must be private');
const sessions=JSON.parse(await readFile(sessionFile,'utf8'));
const page=(path,cookie='',host)=>new Promise((resolve,reject)=>{const req=request(origin+path,{headers:{cookie,...(host?{host}:{})}},r=>{let text='';r.setEncoding('utf8');r.on('data',part=>{text+=part});r.on('end',()=>resolve({status:r.statusCode,text}));});req.on('error',reject);req.end();});
for(const role of ['admin','doctor','nurse','member','inactive','anon']){
 if(role!=='anon')assert.ok(Array.isArray(sessions[role]),'Missing fictional '+role+' session');
 const cookie=(sessions[role]??[]).map(([k,v])=>`${k}=${v}`).join('; ');
 const result=await page('/staff/real/operations',cookie);
 if(role==='admin'){
  assert.equal(result.status,200);assert.match(result.text,/Operations/);assert.match(result.text,/No cleanup runs have been recorded/);assert.ok(!/access_token|refresh_token|PRIVATE-TOKEN|fictional-invalid-key/.test(result.text));
  const invalid=await page('/staff/real/operations?before=invalid',cookie);assert.match(invalid.text,/This page link is invalid/);
  assert.equal((await page('/staff/real/operations',cookie,'app.noreon.health')).status,404,'Wrong-host admin denied');
 }else assert.ok([307,404].includes(result.status),role+' cannot access operational data');
}
console.log('Actual local route permits active admin and denies doctor/nurse/member/inactive/anon/wrong-host identities; malformed paging fails safely.');
