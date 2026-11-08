import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createHash,randomUUID} from 'node:crypto';
import {runLabSweep,type LabRoute} from '@/lib/lab-ai/worker';
import {createFakeLabProvider} from '@/lib/lab-ai/provider';
import ts from 'typescript';
import {z} from 'zod';
import {createClient} from '@supabase/supabase-js';
import {attachInputSchema} from '@/lib/clinic-admin/files-schema';
import {clinicLabLinkCommandSchema} from '@/lib/clinic-portal/lab-results-schema';
import {labAiEnabled,labProviderMode} from '@/lib/lab-ai/config';
import {runResultAttach} from '@/lib/clinic-portal/result-attach-runtime';
import {runClinicLabLink} from '@/lib/clinic-portal/lab-results-runtime';
import {attachMemberFile} from '@/lib/clinic-admin/files';
import {runLabRequest} from '@/lib/lab-ai/doctor-runtime';

globalThis.fetch=async()=>{throw Error('Network forbidden in lab upload check');};

// Actual upload/action/trigger code, with request lifetime, Auth, storage and worker IO mocked.
// Removing a kick, awaiting the worker, bypassing a gate or leaking an error must fail here.
const id='c1000000-0000-4000-8000-000000000001';
const env:Record<string,string|undefined>={NOREON_LAB_AI_ENABLED:'true',NOREON_DOCTOR_COMPLETION_ENABLED:'true',
 NOREON_REAL_MEMBER_REVIEW_ENABLED:'true',NEXT_PUBLIC_SUPABASE_URL:'https://synthetic.invalid',NEXT_PUBLIC_SUPABASE_ANON_KEY:'synthetic'};
const pending:(()=>Promise<void>)[]=[],warnings:unknown[][]=[],infos:unknown[][]=[];
function assertInfo(message:string,metadata:Record<string,unknown>,since=0){
 const matches=infos.slice(since).filter(line=>line[0]===message);
 assert.equal(matches.length,1,`Expected one log: ${message}`);
 assert.deepEqual(JSON.parse(JSON.stringify(matches[0][1])),metadata);
}
let handlerDelay=0,lastRequestDeadline=0;
let runs=0,fail=false,scheduleFails=false,savedNotRead=false,status='stored',workerResult:unknown={claimed:1,finished:{extracted:1},failed:0};
const privateError='private-name.pdf private@example.invalid 1975-04-05';
function load<T>(path:string,deps:Record<string,unknown>,globals:Record<string,unknown>={}):T{
 const exports={};
 vm.runInNewContext(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
  {exports,process:{env},Request,Response,Buffer,URL,Date,AbortController,AbortSignal,setTimeout,clearTimeout,fetch:globalThis.fetch,...globals,console:{info:(...args:unknown[])=>infos.push(args),warn:(...args:unknown[])=>warnings.push(args)},require:(name:string)=>{
   assert.ok(name in deps,`${path}: missing stub ${name}`);return deps[name];
  }});
 return exports as T;
}
let trigger:typeof import('../lib/lab-ai/upload-trigger')|undefined;
const kick={scheduleLabRead:(...args:unknown[])=>{
 trigger??=load('lib/lab-ai/upload-trigger.ts',{
  'server-only':{},'next/server':{after:(work:()=>Promise<void>)=>{if(scheduleFails)throw Error(privateError);pending.push(work);}},
  './feature-config':{labAiEnabled:()=>labAiEnabled(env)},'./server':{runConfiguredLabSweep:async(_env:unknown,options:{sourceId:string;deadlineAt:number})=>{
   lastRequestDeadline=options.deadlineAt;
   runs++;assert.equal(options.sourceId,id,'Kick carries the queued source identity');
   if(fail)throw Error(privateError);return workerResult;
  }},
 });
 const loaded=trigger as typeof import('../lib/lab-ai/upload-trigger');
 return loaded.scheduleLabRead(...args as Parameters<typeof loaded.scheduleLabRead>);
}};
const logging={loggedAction:(_name:string,f:unknown)=>f,withRouteLogging:(f:unknown)=>f};
const common={'@/lib/observability/with-logging':logging,'@/lib/lab-ai/upload-trigger':kick};
const member=load<typeof import('../app/patient/progress/earlier/upload/route')>('app/patient/progress/earlier/upload/route.ts',{
 ...common,'@/lib/clinic-portal/upload-server':{readClinicUploadBody:async()=>{if(handlerDelay)Date.now=()=>100_000;return Buffer.from('%PDF-synthetic');}},
 '@/lib/member-history/measures':{MEMBER_UPLOAD_MAX_BYTES:4194304},'@/lib/member-history/server':{storeOwnDocument:async(input:{savedNotRead:boolean})=>{
  assert.equal(input.savedNotRead,savedNotRead);return status==='stored'?{status,id}:{status};
 }},'@/lib/staff/request':{sameWorkspaceOrigin:()=>true},'@/lib/patient/zoe-app-v3':{zoeAppV3Enabled:()=>savedNotRead},
});
const clinic=load<typeof import('../app/clinic/real/batches/[id]/files/[fileId]/route')>('app/clinic/real/batches/[id]/files/[fileId]/route.ts',{
 ...common,'@/lib/clinic-portal/identity':{requireClinicPortal:async()=>({identity:{userId:id},actorScope:'current'})},
 '@/lib/clinic-portal/upload-server':{clinicStorageService:()=>null,readClinicUploadBody:async()=>{if(handlerDelay)Date.now=()=>100_000;return Buffer.from('%PDF-synthetic');}},
 '@/lib/clinic-portal/upload-runtime':{storeClinicOriginal:async()=>({status,fileId:id})},
 '@/lib/clinic-portal/config':{clinicRequestOriginAllowed:()=>true},'@/lib/clinic-portal/upload-limits':{CLINIC_UPLOAD_MAX_BYTES:4194304},
 '@/lib/security/rate-limit':{rateLimit:async()=>({ok:true})},
});
async function drain(){for(const work of pending.splice(0))await work();}
async function upload(path:'clinic'|'member'){
 const request=new Request('https://synthetic.invalid/upload',{method:'PUT',headers:{'content-type':'application/pdf','x-clinic-ui-scope':'current'},body:'%PDF-synthetic'});
 return path==='member'?member.PUT(request):clinic.PUT(request,{params:Promise.resolve({id,fileId:id})});
}
for(const path of ['clinic','member'] as const){
 const before=runs,logStart=infos.length;
 assert.equal((await upload(path)).status,200);
 assertInfo('Lab reading kick scheduled',{sourceId:id,enabled:true},logStart);
 assert.equal(infos.slice(logStart).some(line=>line[0]==='Lab reading kick started'),false,'Start is logged only inside after()');
 assert.equal(runs,before,`${path}: upload response arrives before the worker starts`);
 assert.equal(pending.length,1,`${path}: upload schedules exactly one kick`);
 await drain();assert.equal(runs,before+1);
 assertInfo('Lab reading kick started',{sourceId:id},logStart);
 status='invalid';assert.equal((await upload(path)).status,400);assert.equal(pending.length,0,'Failed upload schedules nothing');status='stored';
 fail=true;assert.equal((await upload(path)).status,200);await drain();fail=false;
 scheduleFails=true;assert.equal((await upload(path)).status,200,'Scheduling failure cannot change the successful upload');scheduleFails=false;
 env.NOREON_LAB_AI_ENABLED='false';const off=runs,offLogs=infos.length;assert.equal((await upload(path)).status,200);assert.equal(pending.length,0);assert.equal(runs,off);
 assertInfo('Lab reading kick scheduled',{sourceId:id,enabled:false},offLogs);
 assertInfo('Lab reading kick skipped',{sourceId:id,state:'disabled'},offLogs);
 env.NOREON_LAB_AI_ENABLED='true';
 assert.ok(clinic.maxDuration>=300&&member.maxDuration>=300,'Upload functions retain the cron worker budget');
}
savedNotRead=true;await upload('member');assert.equal(pending.length,0,'V3 saved-not-read uploads do not start reading');savedNotRead=false;

let result:unknown;
const rpc={rpc:async()=>({error:null,data:result})};
const attachment=load<typeof import('../lib/clinic-portal/result-attach-actions')>('lib/clinic-portal/result-attach-actions.ts',{
 ...common,'next/cache':{revalidatePath(){}},'@/lib/staff/real-admin':{requireRealAdmin:async()=>{if(handlerDelay)Date.now=()=>100_000;return {client:rpc};}},
 './result-attach-runtime':{runResultAttach},'./result-attach-schema':{resultAttachEnabled:()=>true},
});
const admin=load<typeof import('../lib/clinic-admin/actions')>('lib/clinic-admin/actions.ts',{
 ...common,'./files-schema':{attachInputSchema},'next/cache':{revalidatePath(){}},'@/lib/clinic-portal/identity':{requireClinicPortal:async()=>{if(handlerDelay)Date.now=()=>100_000;return {actorScope:'current',identity:{capability:'clinic_admin'},rpc};}},
 './record':{},'./files':{attachMemberFile},'./member-reveal':{},
});
const link=load<typeof import('../lib/clinic-portal/lab-results-actions')>('lib/clinic-portal/lab-results-actions.ts',{
 ...common,'./lab-results-schema':{clinicLabLinkCommandSchema},'./identity':{requireClinicPortal:async()=>{if(handlerDelay)Date.now=()=>100_000;return {actorScope:'current',rpc};}},
 './lab-results-runtime':{runClinicLabLink},'./result-attach-schema':{resultAttachEnabled:()=>true},
});
const doctor=load<typeof import('../lib/lab-ai/actions')>('lib/lab-ai/actions.ts',{
 ...common,'./upload-trigger':kick,'next/cache':{revalidatePath(){}},'@/lib/patient-care/clinical-case-repository':{requireRealStaff:async()=>{if(handlerDelay)Date.now=()=>100_000;return {client:rpc,identity:{role:'doctor'}};}},
 './config':{labAiEnabled:()=>labAiEnabled(env)},'./doctor-runtime':{runLabRequest},'./member-approval-server':{},
});
const actions=[
 {run:()=>attachment.attachClinicResult(id,{version:'clinic-result-attach-v1',submissionId:id,fileId:id,memberId:id,visitId:id}),
  saved:{status:'saved',attachmentId:id,corrected:false,moved:1,waitingForLab:0,atLabAfterUpload:0,alreadyReceived:0,retracted:0}},
 {run:()=>admin.clinicMemberFileAttach('c2000000-0000-4000-8000-000000000002','current','c2000000-0000-4000-8000-000000000002',{fileId:id,submissionId:id,confirm:false}),saved:{status:'saved',replayed:false}},
 {run:()=>link.clinicLabLink('c2000000-0000-4000-8000-000000000002',{version:'clinic-lab-link-v1',submissionId:id,fileId:id,memberId:id},'current'),saved:{status:'saved',replayed:false}},
];
for(const action of actions){
 result=action.saved;const before=runs;assert.equal((await action.run()).status,'saved');
 assert.equal(runs,before);assert.equal(pending.length,1,'Every successful attachment schedules one kick');await drain();assert.equal(runs,before+1);
 result={status:'invalid'};assert.equal((await action.run()).status,'invalid');assert.equal(pending.length,0);
 result=action.saved;fail=true;assert.equal((await action.run()).status,'saved');await drain();fail=false;
 scheduleFails=true;assert.equal((await action.run()).status,'saved');scheduleFails=false;
 env.NOREON_LAB_AI_ENABLED='false';assert.equal((await action.run()).status,'saved');assert.equal(pending.length,0);env.NOREON_LAB_AI_ENABLED='true';
}
result={status:'queued'};const beforeRequest=runs;
assert.equal((await doctor.requestLabReading(id,id)).status,'queued');assert.equal(runs,beforeRequest);
assert.equal(pending.length,1,'Doctor read/retry request also schedules a kick');await drain();assert.equal(runs,beforeRequest+1);
// A slow body/auth operation must count against the same request lifetime.
for(const operation of [()=>upload('member'),()=>upload('clinic'),...actions.map(action=>async()=>{result=action.saved;return action.run();}),async()=>{result={status:'queued'};return doctor.requestLabReading(id,id);}]){
 const originalNow=Date.now;Date.now=()=>0;handlerDelay=100_000;
 try{await operation();await drain();assert.equal(lastRequestDeadline,270_000,'All kick entry points preserve request start before body/auth IO');}
 finally{Date.now=originalNow;handlerDelay=0;}
}
result={status:'running'};await doctor.requestLabReading(id,id);assert.equal(pending.length,0,'An already-running request does not kick');
workerResult={claimed:1,finished:{},failed:1};await upload('clinic');const beforeWarnings=warnings.length;await drain();assert.equal(warnings.length,beforeWarnings+1,'Worker report failures are logged too');
assert.ok(warnings.length>=11);assert.ok(warnings.every(line=>JSON.stringify(line).includes(id)),'Failure logs carry the internal id');
assert.doesNotMatch(JSON.stringify(warnings),/private-name|private@example|1975-04-05/,'No provider error or file/member data in logs');
for(const state of ['disabled','reading_off','unconfigured']){
 const logStart=infos.length;
 workerResult={state};await upload('clinic');await drain();
 assertInfo('Lab reading kick skipped',{sourceId:id,state},logStart);
}

// The actual configured worker keeps all cron gates, without contacting Supabase.
let clients=0;
const configured=load<typeof import('../lib/lab-ai/server')>('lib/lab-ai/server.ts',{
 'server-only':{},'@supabase/supabase-js':{createClient:()=>{clients++;throw Error('unexpected client');}},
 '@/lib/zoe/purpose-route':{},'@/lib/zoe/route-config':{},'./config':{labAiEnabled,labProviderMode},'./provider':{},'./worker':{},'zod':{z},
});
for(const [configuration,want]of [[{},'disabled'],[env,'reading_off'],[{...env,NOREON_LAB_AI_PROVIDER:'fake'},'unconfigured']]as const){
 const report=await configured.runConfiguredLabSweep(configuration);
 assert.ok('state'in report);assert.equal(report.state,want);
}
assert.equal(clients,0,'Disabled/unconfigured worker does not create a service client');
console.log('Lab upload kick PASS: actual routes/actions return before after(), bounded sweep, isolated failures, ids-only logs and unchanged feature/config gates (mocked IO).');

// Real trigger -> configured sweep -> real worker. Only database/storage/provider IO
// and time are synthetic. The old two-claim kick loses either follow-up or upload.
const regressionResults:unknown[]=[];
for(const scenario of ['single job','slow fallback','older jobs','stale cleanup','interleaved empty claims','round cap','time cap','slow reservations','slow upload','reservation timeout','almost deadline','expired request','empty queue','waiting retry','claim deadline','worker failure','last round failure','last round empty','failure at deadline'] as const){
 const bytes=new Uint8Array(Buffer.from('%PDF-1.7\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF'));
 const file={fileId:id,bucket:'clinic-originals',objectKey:'synthetic',sizeBytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),mime:'application/pdf'};
 const fileJob={kind:'file',jobId:randomUUID(),leaseToken:randomUUID(),attempt:1,file,candidates:[]};
 const queue:unknown[]=[];
 const older=['round cap','last round failure','last round empty'].includes(scenario)?20:['time cap','slow reservations','slow upload'].includes(scenario)?4:scenario==='older jobs'?2:scenario==='stale cleanup'?1:0;
 for(let i=0;i<older;i++)queue.push({...fileJob,jobId:randomUUID(),file:{...file,fileId:randomUUID()}});
 if(scenario!=='empty queue')queue.push(fileJob);
 let clock=scenario==='slow upload'?100_000:scenario==='reservation timeout'?269_000:scenario==='almost deadline'?269_500:scenario==='expired request'?280_000:0,reads=0,claims=0,claimed=0,tableReads=0,emptyClaimCount=0,triggerFinished=false,attachmentFinished=false;
 let sweepReport:Awaited<ReturnType<typeof configured.runConfiguredLabSweep>>|undefined;
 let providerTimeout=0;
 const gateway=load<typeof import('../lib/lab-ai/provider')>('lib/lab-ai/provider.ts',{
  '@/lib/zoe/provider':{costUsd:()=>0},'@/lib/zoe/gateway':{GATEWAY_PROVIDER_NAME:'gateway',zoeModelCallsEnabled:()=>true},
  './extraction':{EXTRACTION_SYSTEM:'synthetic',extractionPrompt:()=>'',extractionSchema:z.unknown()},
  './summary':{NARRATIVE_SYSTEM:'synthetic',narrativeSchema:z.unknown()},
 },{setTimeout:(_fn:unknown,ms:number)=>{providerTimeout=ms;return 0;},clearTimeout:()=>{}});
 const route:LabRoute={tier:'medium',primary:{id:'primary',inputUsdPerMTok:1,outputUsdPerMTok:1},fallback:{id:'fallback',inputUsdPerMTok:1,outputUsdPerMTok:1}};
 let dbFetch:typeof fetch;
 const reservationTimeouts:number[]=[];
 const signalTimeouts=new WeakMap<AbortSignal,number>();
 let clientOptions:Parameters<typeof createClient>[2];
 const client={rpc:async(name:string,args:Record<string,unknown>)=>{
  if(name==='lab_ai_reading_state')return {data:{enabled:true,modelCallsAllowed:true},error:null};
  if(name==='zoe_route_config')return {data:{},error:null};
  if(name==='lab_ai_job_claim'){
   claims++;assert.equal(args.p_limit,1);
   if(['claim deadline','failure at deadline'].includes(scenario))clock=240_000;
   if(['worker failure','failure at deadline'].includes(scenario)||(scenario==='last round failure'&&claims===16))return {data:null,error:{code:'synthetic',message:privateError}};
   if(scenario==='stale cleanup'&&claims===1){queue.shift();emptyClaimCount++;return {data:[],error:null};}
   const jobs=scenario==='waiting retry'||(scenario==='interleaved empty claims'&&[1,2,4,5].includes(claims))||(scenario==='last round empty'&&claims>=14)?[]:queue.splice(0,1);
   claimed+=jobs.length;if(!jobs.length)emptyClaimCount++;
   return {data:jobs,error:null};
  }
  if(name==='lab_ai_file_target')return {data:{target:null},error:null};
  if(name==='lab_ai_call_reserve'){await dbFetch('https://synthetic.invalid/reserve');return {data:{ok:true,callId:randomUUID()},error:null};}
  if(name==='lab_ai_call_finish')return {data:{ok:true},error:null};
  if(name==='lab_ai_job_finish'){
   const result=args.p_result as {disposition:string;extraction?:unknown;pageCount:number;provider:string;model:string};
   if(result.disposition==='retry'||result.disposition==='defer'){queue.push({...fileJob,jobId:args.p_job});return {data:{ok:true,state:'queued'},error:null};}
   if(args.p_job===fileJob.jobId){
    triggerFinished=true;
    if(scenario!=='single job')queue.push({kind:'attachment',jobId:randomUUID(),leaseToken:randomUUID(),attempt:1,file,member:{name:'Synthetic',birthDate:null},visitTests:[],previous:[],
     cached:{extraction:result.extraction,pageCount:result.pageCount,provider:result.provider,model:result.model}});
   }else if(triggerFinished)attachmentFinished=true;
   return {data:{ok:true,state:'done'},error:null};
  }
  throw Error(`Unexpected RPC ${name}`);
 },storage:{from:()=>({download:async()=>({data:{arrayBuffer:async()=>bytes.buffer},error:null})})},
 from:()=>{tableReads++;throw Error('Direct table reads are forbidden in the lab kick');}};
 const service=load<typeof import('../lib/lab-ai/server')>('lib/lab-ai/server.ts',{
  'server-only':{},'@supabase/supabase-js':{createClient:(_url:unknown,_key:unknown,options:NonNullable<Parameters<typeof createClient>[2]>)=>{clientOptions=options;dbFetch=options.global!.fetch!;return client;}},'@/lib/zoe/purpose-route':{purposeRoute:()=>route},
  '@/lib/zoe/route-config':{parseRouteConfig:(v:unknown)=>v},'./config':{labAiEnabled:()=>true,labProviderMode:()=> 'gateway'},
  'zod':{z},'./worker':{runLabSweep},'./provider':{createFakeLabProvider,createLabGatewayProvider:(model:Parameters<typeof gateway.createLabGatewayProvider>[0],options:Parameters<typeof gateway.createLabGatewayProvider>[1])=>gateway.createLabGatewayProvider(model,{...options,generate:async()=>{
   reads++;
   if(['time cap','slow reservations','slow upload'].includes(scenario))clock+=providerTimeout;
   if(scenario==='slow fallback'){
    clock+=model.id==='primary'?90_000:50_000;
    if(model.id==='primary')throw Object.assign(Error('synthetic timeout'),{name:'TimeoutError'});
   }
   return {object:{patients:[],sampleDate:null,labName:null,unreadable:true,results:[]},usage:{inputTokens:1,outputTokens:1},finishReason:'stop',response:{modelId:model.id}};
  }})},
 },{AbortSignal:{timeout:(ms:number)=>{reservationTimeouts.push(ms);const signal=new AbortController().signal;signalTimeouts.set(signal,ms);return signal;},any:AbortSignal.any},fetch:async(_input:unknown,init:RequestInit)=>{
  const duration=['slow reservations','slow upload','reservation timeout'].includes(scenario)?20_000:0;
  const remaining=signalTimeouts.get(init.signal!);assert.notEqual(remaining,undefined,'Reservation IO receives the deadline signal');
  clock+=Math.min(duration,remaining!);
  if(duration>remaining!)throw Error('synthetic reservation timeout');
  return new Response('{}');
 }});
 const realKick=load<typeof import('../lib/lab-ai/upload-trigger')>('lib/lab-ai/upload-trigger.ts',{
  'server-only':{},'next/server':{after:(work:()=>Promise<void>)=>pending.push(work)},'./feature-config':{labAiEnabled:()=>true},
  './server':{runConfiguredLabSweep:async(_env:unknown,options:Parameters<typeof service.runConfiguredLabSweep>[1])=>{
   sweepReport=await service.runConfiguredLabSweep({...env,SUPABASE_SERVICE_ROLE_KEY:'synthetic'},options);return sweepReport;
  }},
 });
 const originalNow=Date.now;Date.now=()=>clock;
 const beforeWarnings=warnings.length,logStart=infos.length;
 try{realKick.scheduleLabRead(id,0);await drain();}finally{Date.now=originalNow;}
 assert.equal(tableReads,0,`${scenario}: the kick must never call client.from`);
 assert.equal(pending.length,0,'Kick never schedules recursive after work');
 const capped=['round cap','time cap','slow reservations','slow upload','reservation timeout','almost deadline','expired request','claim deadline'].includes(scenario);
 const failed=['worker failure','last round failure','failure at deadline'].includes(scenario)?1:0;
 assert.ok(sweepReport&&'claimed'in sweepReport);
 assert.equal(sweepReport.queued,capped,`${scenario}: only a round or deadline cap reports possible queued work`);
 assert.equal(sweepReport.claimed,claimed,`${scenario}: the report counts jobs rather than empty claims`);
 assert.equal(sweepReport.failed,failed,`${scenario}: a claim failure is reported`);
 assert.equal(warnings.length-beforeWarnings,capped||failed?1:0,`${scenario}: queued remainder and failures are recorded with an internal id only`);
 assertInfo('Lab reading kick sweep finished',{sourceId:id,rounds:claims,claimed},logStart);
 const noClaimLogs=infos.slice(logStart).filter(line=>line[0]==='Lab reading kick: no job claimed');
 assert.equal(noClaimLogs.length,emptyClaimCount,`${scenario}: every empty claim has a diagnostic`);
 for(const line of noClaimLogs)assert.deepEqual(JSON.parse(JSON.stringify(line[1])),{sourceId:id});
 if(!capped&&!failed)assertInfo('Lab reading kick empty claim limit reached',{sourceId:id},logStart);
 if(scenario==='single job'){
  assert.equal(reads,1,'A claimed file is read once');
  assert.equal(claims,4,'One job is followed by three empty claims');
 }
 if(scenario==='empty queue'||scenario==='waiting retry')assert.equal(claims,3,'Three empty claims stop, even if future-due work remains');
 if(scenario==='interleaved empty claims')assert.equal(claims,9,'Each claimed job resets the consecutive-empty counter');
 if(['time cap','slow reservations','slow upload','reservation timeout','almost deadline','expired request','claim deadline'].includes(scenario))assertInfo('Lab reading kick deadline reached',{sourceId:id},logStart);
 if(scenario==='round cap')assertInfo('Lab reading kick round limit reached',{sourceId:id},logStart);
 if(failed)assertInfo('Lab reading kick sweep failed',{sourceId:id},logStart);
 // Exercise the installed SDK with the kick's options: a transient RPC response
 // must return to the bounded rounds rather than sleeping on Retry-After.
 if(scenario==='older jobs'){
  let attempts=0;
  const sdk=createClient('https://synthetic.invalid','synthetic',{...clientOptions,global:{fetch:async()=>{attempts++;return new Response('{}',{status:520});}}});
  const response=await sdk.rpc('lab_ai_job_claim',{p_limit:1});
  assert.ok(response.error);assert.equal(attempts,1,'Claims never enter SDK retry sleeps');
 }
 if(scenario==='slow reservations')assert.deepEqual(reservationTimeouts,[240_000,130_000,20_000],'Each reservation receives only the time remaining when its IO starts');
 regressionResults.push({scenario,triggerFinished,attachmentFinished,reads,claims,clock,queued:queue.length});
}
assert.deepEqual(regressionResults,[
 {scenario:'single job',triggerFinished:true,attachmentFinished:false,reads:1,claims:4,clock:0,queued:0},
 {scenario:'slow fallback',triggerFinished:true,attachmentFinished:true,reads:2,claims:5,clock:140_000,queued:0},
 {scenario:'older jobs',triggerFinished:true,attachmentFinished:true,reads:3,claims:7,clock:0,queued:0},
 {scenario:'stale cleanup',triggerFinished:true,attachmentFinished:true,reads:1,claims:6,clock:0,queued:0},
 {scenario:'interleaved empty claims',triggerFinished:true,attachmentFinished:true,reads:1,claims:9,clock:0,queued:0},
 {scenario:'round cap',triggerFinished:false,attachmentFinished:false,reads:16,claims:16,clock:0,queued:5},
 {scenario:'time cap',triggerFinished:false,attachmentFinished:false,reads:3,claims:3,clock:240_000,queued:2},
 {scenario:'slow reservations',triggerFinished:false,attachmentFinished:false,reads:2,claims:3,clock:240_000,queued:3},
 {scenario:'slow upload',triggerFinished:false,attachmentFinished:false,reads:2,claims:2,clock:270_000,queued:3},
 {scenario:'reservation timeout',triggerFinished:false,attachmentFinished:false,reads:0,claims:1,clock:270_000,queued:1},
 {scenario:'almost deadline',triggerFinished:false,attachmentFinished:false,reads:0,claims:0,clock:269_500,queued:1},
 {scenario:'expired request',triggerFinished:false,attachmentFinished:false,reads:0,claims:0,clock:280_000,queued:1},
 {scenario:'empty queue',triggerFinished:false,attachmentFinished:false,reads:0,claims:3,clock:0,queued:0},
 {scenario:'waiting retry',triggerFinished:false,attachmentFinished:false,reads:0,claims:3,clock:0,queued:1},
 {scenario:'claim deadline',triggerFinished:false,attachmentFinished:false,reads:0,claims:1,clock:240_000,queued:1},
 {scenario:'worker failure',triggerFinished:false,attachmentFinished:false,reads:0,claims:1,clock:0,queued:1},
 {scenario:'last round failure',triggerFinished:false,attachmentFinished:false,reads:15,claims:16,clock:0,queued:6},
 {scenario:'last round empty',triggerFinished:false,attachmentFinished:false,reads:13,claims:16,clock:0,queued:8},
 {scenario:'failure at deadline',triggerFinished:false,attachmentFinished:false,reads:0,claims:1,clock:240_000,queued:1},
],'Kick reaches its upload and cached attachment, caps work, and respects queued backoff');
assert.ok(infos.every(line=>JSON.stringify(line).includes(id)),'Kick diagnostics carry only the internal source identity and operational metadata');
assert.doesNotMatch(JSON.stringify([...infos,...warnings]),/private-name|private@example|1975-04-05|Synthetic|synthetic timeout/,'Diagnostics never include file/member data or raw errors');
console.log('Lab upload regressions PASS: stale cleanup, backlog, cached attachment, 16 rounds, empty-claim cap, reservation/provider deadlines and 100 s upload handling through the actual kick (mocked IO/clock).');
