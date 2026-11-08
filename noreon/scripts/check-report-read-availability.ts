import assert from 'node:assert/strict';
// @ts-expect-error Runtime provides registerHooks; project types target Node 20.
import {registerHooks} from 'node:module';
import {sampleReports} from '@/lib/reports/demo';
const own = {...sampleReports()[0], id: crypto.randomUUID(), user_id: 'member-one', object_path: 'member-one/original'};
const other = {...own, id: crypto.randomUUID(), user_id: 'member-two'};
const fixture = {identity: {userId: 'member-one', phone: '+12025550199'} as {userId:string;phone:string}|null, rows: [own, other], downloads: 0, writes: 0, authError: null as {status?:number}|null, profileError: false, listError: false, storageError: false, recordError: false};
Object.assign(globalThis, {__reportReadFixture: fixture});
const hook = registerHooks({resolve(specifier: string, context: object, next: (s:string,c:object)=>object) {
  const stubs: Record<string,string> = {
    '@/lib/patient/auth': 'export async function patientIdentity(){return globalThis.__reportReadFixture.authError ? null : globalThis.__reportReadFixture.identity}',
    '@/lib/patient/demo': 'export function demoEnabled(){return process.env.NEXT_PUBLIC_PATIENT_DEMO === "true"}',
    '@/lib/supabase/server': `export async function createClient(){return {auth:{async getUser(){const f=globalThis.__reportReadFixture;return {data:{user:f.identity?{id:f.identity.userId,phone:f.identity.phone,phone_confirmed_at:"2026-10-01T00:00:00Z"}:null},error:f.authError}}},from(table){return {select(){return this},async maybeSingle(){return {data:{id:"member-one"},error:globalThis.__reportReadFixture.profileError?{code:"LOCAL_UNAVAILABLE"}:null}},order(){return this},async range(){return {data:globalThis.__reportReadFixture.rows.filter(r=>r.user_id===globalThis.__reportReadFixture.identity?.userId),error:globalThis.__reportReadFixture.listError?{code:"LOCAL_UNAVAILABLE"}:null}}}}}}`,
    '@supabase/supabase-js': `export function createClient(){return {from(){const filters={};return {select(){return this},eq(k,v){filters[k]=v;return this},async maybeSingle(){return {data:globalThis.__reportReadFixture.rows.find(r=>Object.entries(filters).every(([k,v])=>r[k]===v))??null,error:globalThis.__reportReadFixture.recordError?{code:"LOCAL_UNAVAILABLE"}:null}}}},rpc(){globalThis.__reportReadFixture.writes++;throw new Error("Unexpected mutation")},storage:{from(){return {async download(){globalThis.__reportReadFixture.downloads++;return {data:new Blob(["fictional original"],{type:"application/pdf"}),error:globalThis.__reportReadFixture.storageError?{status:503,message:"Do not expose backend details"}:null}}}}}}}`,
  };
  if (stubs[specifier]) return {url:'data:text/javascript,'+encodeURIComponent(stubs[specifier]),shortCircuit:true};
  return next(specifier,context);
}});
const saved = {demo:process.env.NEXT_PUBLIC_PATIENT_DEMO, flag:process.env.NOREON_REPORT_IMPORT_ENABLED, key:process.env.OPENAI_API_KEY};
try {
  process.env.NEXT_PUBLIC_PATIENT_DEMO='false';
  const {GET:list, POST} = await import('@/app/api/patient/reports/route');
  const {GET:original} = await import('@/app/api/patient/reports/[id]/original/route');
  for (const configuration of [{flag:'false',key:''},{flag:'true',key:''},{flag:'false',key:'test-key'}]) {
    process.env.NOREON_REPORT_IMPORT_ENABLED=configuration.flag;process.env.OPENAI_API_KEY=configuration.key;
    const response = await list();
    assert.equal(response.status,200,'Owned history must stay readable with import or AI disabled');
    assert.equal(response.headers.get('cache-control'),'no-store');
    assert.deepEqual((await response.json()).reports.map((r:{id:string})=>r.id),[own.id],'Session client maintains RLS-filtered history');
    const download = await original(new Request(`https://app.test/api/patient/reports/${own.id}/original`),{params:Promise.resolve({id:own.id})});
    assert.equal(download.status,200);assert.equal(await download.text(),'fictional original');
    assert.equal(download.headers.get('cache-control'),'private, no-store');
    const calls = fixture.downloads;
    assert.equal((await original(new Request('https://app.test/original'),{params:Promise.resolve({id:other.id})})).status,404);
    assert.equal(fixture.downloads,calls,'Cross-owner denial happens before storage access');
    for (const op of ['upload','extract','explain','confirm']) {
      const denied = await POST(new Request('https://app.test/api/patient/reports',{method:'POST',headers:{origin:'https://app.test','content-type':'application/json'},body:JSON.stringify({op,id:own.id})}));
      assert.equal(denied.status,503);assert.equal((await denied.json()).error,'disabled');
    }
    assert.equal(fixture.writes,0);
    // Deleting your own report never needs the import or the model (privacy audit B3-4).
    const removal=await POST(new Request('https://app.test/api/patient/reports',{method:'POST',headers:{origin:'https://app.test','content-type':'application/json'},body:JSON.stringify({op:'delete',id:own.id})}));
    assert.notEqual((await removal.json()).error,'disabled','Deletion is not gated by import availability');
    fixture.identity=null;
    assert.equal((await list()).status,401);
    assert.equal((await original(new Request('https://app.test/original'),{params:Promise.resolve({id:own.id})})).status,404);
    fixture.identity={userId:'member-one',phone:'+12025550199'};
  }
  for(const status of [408,429]){fixture.authError={status};const response=await list();assert.equal(response.status,503,'Auth timeout/rate limit is retryable');fixture.authError=null;}
  for (const fault of ['authError','profileError','listError'] as const) {
    if(fault==='authError')fixture.authError={status:503};else fixture[fault]=true;
    const response=await list();assert.equal(response.status,503,`${fault} is retryable infrastructure failure, not invalid input or signed-out state`);
    assert.equal((await response.json()).error,'unavailable');
    fixture.authError=null;fixture.profileError=false;fixture.listError=false;
  }
  for(const fault of ['storageError','recordError'] as const){
    fixture[fault]=true;const response=await original(new Request(`https://app.test/api/patient/reports/${own.id}/original`),{params:Promise.resolve({id:own.id})});
    assert.equal(response.status,503,`${fault} must be retryable without exposing absence`);
    assert.equal(response.headers.get('cache-control'),'private, no-store');
    const text=await response.text();assert.match(text,/Try downloading again/);assert.doesNotMatch(text,/Do not expose backend details|LOCAL_UNAVAILABLE/);
    fixture[fault]=false;
  }
  own.deleted_at='2026-10-14T00:00:00Z';
  assert.equal((await original(new Request('https://app.test/original'),{params:Promise.resolve({id:own.id})})).status,404,'Deleted records stay absent');
  own.deleted_at=null;
  console.log('Actual report handlers pass mocked-boundary checks: import/key disabled reads, own download bytes, auth, cross-owner denial and gated writes.');
} finally {
  for (const [name,value] of Object.entries({NEXT_PUBLIC_PATIENT_DEMO:saved.demo,NOREON_REPORT_IMPORT_ENABLED:saved.flag,OPENAI_API_KEY:saved.key})) if(value===undefined) delete process.env[name]; else process.env[name]=value;
  hook.deregister();Reflect.deleteProperty(globalThis,'__reportReadFixture');
}
