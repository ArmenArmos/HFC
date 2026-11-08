import assert from "node:assert/strict";
import {createHash,randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import type {Extraction} from "@/lib/lab-ai/extraction";
import {createFakeLabProvider,createLabGatewayProvider,FAKE_MARKER,type LabGenerate} from "@/lib/lab-ai/provider";
import {runLabSweep,type LabRoute,type LabWorkerDeps} from "@/lib/lab-ai/worker";
import {chartMeasure,claimedMemberUploadJobSchema,runMemberUploadJob,type ClaimedMemberUploadJob} from "@/lib/lab-ai/member-upload-worker";
import {buildSummary,workupStatus,NARRATIVE_SYSTEM,guardNarrative} from "@/lib/lab-ai/summary";
import {resultsCardItems,staffLabResultsSchema,outOfRange} from "@/lib/lab-ai/staff-results";
import {ANALYTE_NAME_HY,analyteDisplayName} from "@/lib/lab-ai/analyte-names";
import {LAB_ANALYTES} from "@/lib/lab-ai/catalogue";
import {chartValueProblem,editCommandSchema,identityCommandSchema,memberEditVersion,memberIdentityVersion,readingState,SLOW_AFTER_MS,type MemberReadingJob} from "@/lib/member-history/ai-reading";

/** SYNTHETIC checks for member uploads read by the lab reader. Fictional names and values; the reader is the fake
 * (NOREON_LAB_AI_PROVIDER=fake) or a mock of the Gateway call; any network use fails. */
globalThis.fetch=(()=>{throw Error("network used in a check");}) as typeof fetch;

const marker=(e:unknown)=>`${FAKE_MARKER}${Buffer.from(JSON.stringify(e)).toString("base64")}\n`;
const pdfWith=(e:unknown|null)=>new Uint8Array(Buffer.from(`%PDF-1.7\n${e===null?"":marker(e)}1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n`,"latin1"));
const jpegWith=(e:unknown)=>new Uint8Array(Buffer.concat([Buffer.from([0xff,0xd8,0xff,0xe0,0x0a]),Buffer.from(marker(e),"latin1"),Buffer.from([0xff,0xd9])]));
const sha=(b:Uint8Array)=>createHash("sha256").update(b).digest("hex");
const member={name:"Test Fictional",birthDate:"1980-03-14"};
const ROUTE:LabRoute={tier:"medium",primary:{id:"anthropic/claude-sonnet-5.5",inputUsdPerMTok:3,outputUsdPerMTok:15},fallback:null};
const sheet=(over:Partial<Extraction>={}):Extraction=>({patients:[{name:"Test Fictional",birthDate:"1980-03-14"}],sampleDate:"2026-10-10",labName:"Synthetic lab",unreadable:false,results:[
 {testName:"HbA1c",analyte:"hba1c",valueText:"5.9",unit:"%",referenceRange:"4.0 - 5.6",flag:"high",collectedOn:null,page:1,snippet:"HbA1c 5.9 %"},
 {testName:"LDL cholesterol",analyte:"ldl_c",valueText:"130",unit:"mg/dL",referenceRange:"< 100",flag:"high",collectedOn:"2026-10-10",page:1,snippet:"LDL 130 mg/dL"},
 {testName:"TSH",analyte:"tsh",valueText:"2.1",unit:"mIU/L",referenceRange:"0.4 - 4.0",flag:null,collectedOn:"2026-10-10",page:1,snippet:"TSH 2.1"},
 {testName:"Glucose",analyte:"fasting_glucose",valueText:"<1",unit:"mmol/L",referenceRange:null,flag:null,collectedOn:"2026-10-10",page:1,snippet:"Glucose <1"},
],...over});

function harness(bytes:Uint8Array,opts:{reserve?:(a:Record<string,unknown>)=>unknown;mime?:"application/pdf"|"image/jpeg"|"image/png";route?:LabRoute|null;provider?:ReturnType<typeof createFakeLabProvider>}={}){
 const calls:{name:string;args:Record<string,unknown>}[]=[];
 const job:ClaimedMemberUploadJob={kind:"member_upload",jobId:randomUUID(),leaseToken:randomUUID(),attempt:1,
  file:{documentId:randomUUID(),bucket:"member-history",objectKey:"member/1.pdf",sizeBytes:bytes.byteLength,sha256:sha(bytes),mime:opts.mime??"application/pdf"},member,previous:[]};
 const deps:LabWorkerDeps={rpc:async(name,args)=>{calls.push({name,args});
   if(name==="lab_ai_call_reserve")return opts.reserve?opts.reserve(args):{ok:true,callId:randomUUID()};
   if(name==="lab_ai_call_finish")return {ok:true};
   throw Error(`unexpected rpc ${name}`);},
  download:async(bucket)=>{assert.equal(bucket,"member-history");return bytes;},route:opts.route===undefined?ROUTE:opts.route,providerFor:()=>opts.provider??createFakeLabProvider(),today:()=>"2026-10-18"};
 return {job,deps,calls};
}
type Done={disposition:string;outcome:string;identityStatus?:string;pageCount?:number;values?:{catalogueRef:string|null;measure:string|null;measureUnit:string|null;attention:string|null}[];summary?:{narrative:unknown}|null;provider?:string};

// A matching PDF: values kept with the chart measure decided in code; summary for the doctor; both calls reserved.
{
 const h=harness(pdfWith(sheet()));
 const r=await runMemberUploadJob(h.job,h.deps) as Done;
 assert.equal(r.disposition,"done");assert.equal(r.outcome,"extracted");assert.equal(r.identityStatus,"match");assert.equal(r.provider,"noreon.fake");
 const by=(k:string)=>r.values!.find(v=>v.catalogueRef===k)!;
 assert.deepEqual([by("hba1c").measure,by("hba1c").measureUnit],["hba1c","%"]);
 assert.deepEqual([by("ldl_c").measure,by("ldl_c").measureUnit],["ldl_c","mg/dL"],"mg/dL kept as printed, not converted");
 assert.equal(by("tsh").measure,null,"not a charted measure");
 assert.equal(by("fasting_glucose").measure,null,"a censored value is not charted");
 assert.equal(by("hba1c").attention,"needs_doctor","doctor marks still computed");
 assert.ok(r.summary&&r.summary.narrative,"summary with the guarded narrative");
 assert.deepEqual(h.calls.filter(c=>c.name==="lab_ai_call_reserve").map(c=>[c.args.p_purpose,c.args.p_local,c.args.p_tier]),[["extract",true,"medium"],["summary",true,"medium"]]);
 assert.ok(claimedMemberUploadJobSchema.safeParse(h.job).success);
}
// A photo goes to the model as an image, one page.
{
 const bytes=jpegWith(sheet());let seen:string|undefined;
 const generate:LabGenerate=async a=>{seen=a.mediaType;return {object:a.pdf?sheet():{en:"Synthetic.",hy:"Սինթետիկ։"},finishReason:"stop",usage:{inputTokens:3000,outputTokens:200},response:{modelId:"anthropic/claude-opus-5.5"}};};
 const provider=createLabGatewayProvider({id:"anthropic/claude-opus-5.5",inputUsdPerMTok:4,outputUsdPerMTok:20,label:"x",provider:"anthropic",strength:"high"} as never,{env:{NOREON_ZOE_MODEL_CALLS_ENABLED:"true"},generate});
 const h=harness(bytes,{mime:"image/jpeg",provider:provider as never});
 const r=await runMemberUploadJob(h.job,h.deps) as Done;
 assert.equal(r.outcome,"extracted");assert.equal(r.pageCount,1);
 assert.equal(h.calls[0]!.args.p_local,false,"a real reader reserves a non-local call (refused while model calls are off)");
 assert.equal(seen,undefined,"narrative call has no file");
 const h2=harness(bytes,{mime:"image/jpeg",provider:createLabGatewayProvider({id:"m",inputUsdPerMTok:1,outputUsdPerMTok:1} as never,{env:{NOREON_ZOE_MODEL_CALLS_ENABLED:"true"},generate:async a=>{if(a.pdf)seen=a.mediaType;return {object:a.pdf?sheet():{en:"S.",hy:"Ս։"},finishReason:"stop",usage:{},response:{modelId:"m"}};}}) as never});
 await runMemberUploadJob(h2.job,h2.deps);
 assert.equal(seen,"image/jpeg","the photo is sent as an image");
}
// Someone else's sheet: values kept for the member's question, no summary or narrative.
{
 const h=harness(pdfWith(sheet({patients:[{name:"Other Fictional",birthDate:"1969-11-30"}]})));
 const r=await runMemberUploadJob(h.job,h.deps) as Done;
 assert.equal(r.outcome,"identity_mismatch");assert.equal(r.values!.length,4);assert.equal(r.summary,null);
 assert.equal(h.calls.filter(c=>c.args.p_purpose==="summary").length,0,"no narrative for another person's sheet");
}
// Two people: nothing kept. Not a lab sheet: unreadable.
{
 const two=await runMemberUploadJob(...(()=>{const h=harness(pdfWith(sheet({patients:[{name:"Test Fictional",birthDate:"1980-03-14"},{name:"Second Fictional",birthDate:"1975-07-02"}]})));return [h.job,h.deps] as const;})()) as Done;
 assert.equal(two.outcome,"multiple_patients");assert.deepEqual(two.values,[]);
 const none=await runMemberUploadJob(...(()=>{const h=harness(pdfWith(null));return [h.job,h.deps] as const;})()) as Done;
 assert.equal(none.outcome,"unreadable");assert.deepEqual(none.values,[]);
}
// File checks before any call; switched off or capped readings wait.
{
 const bytes=pdfWith(sheet());
 const tampered=harness(bytes);tampered.job.file.sha256="0".repeat(64);
 assert.deepEqual(await runMemberUploadJob(tampered.job,tampered.deps),{disposition:"rejected",outcome:"hash_mismatch"});
 const wrongType=harness(bytes,{mime:"image/png"});
 assert.deepEqual(await runMemberUploadJob(wrongType.job,wrongType.deps),{disposition:"rejected",outcome:"not_supported"});
 const many=new Uint8Array(Buffer.from(`%PDF-1.7\n1 0 obj << /Type /Pages /Kids [] /Count 40 >> endobj\n3 0 obj << /Type /Page >> endobj\n%%EOF\n`,"latin1"));
 const manyH=harness(many);
 assert.deepEqual(await runMemberUploadJob(manyH.job,manyH.deps),{disposition:"rejected",outcome:"too_many_pages"});
 assert.equal(manyH.calls.length,0,"no call for a rejected file");
 const off=harness(bytes,{route:null});
 assert.deepEqual(await runMemberUploadJob(off.job,off.deps),{disposition:"defer",outcome:"reading_off"});
 for(const code of["model_calls_not_permitted","daily_spend_cap_reached","tier_spend_cap_reached"]){
  const h=harness(bytes,{reserve:()=>({ok:false,code,callId:randomUUID()})});
  assert.deepEqual(await runMemberUploadJob(h.job,h.deps),{disposition:"defer",outcome:code},`${code} defers`);
 }
}
// The sweep hands member jobs to the member runner and finishes them.
{
 const bytes=pdfWith(sheet());const h=harness(bytes);
 const finishes:Record<string,unknown>[]=[];let claims=0;
 const report=await runLabSweep({...h.deps,rpc:async(name,args)=>{
  if(name==="lab_ai_job_claim"){claims++;return claims===1?[h.job]:[];}
  if(name==="lab_ai_job_finish"){finishes.push(args.p_result as Record<string,unknown>);return {ok:true,state:"done"};}
  return h.deps.rpc(name,args);}});
 assert.deepEqual(report,{claimed:1,finished:{extracted:1},failed:0});
 assert.equal((finishes[0]!.values as unknown[]).length,4);
}

// Chart measures, ranges and the member's card.
assert.equal(chartMeasure({catalogueRef:"hba1c",value:48,unit:"mmol/mol",checks:[]}),null,"HbA1c in mmol/mol is not charted");
assert.equal(chartMeasure({catalogueRef:"ldl_c",value:3.1,unit:"ммоль/л",checks:[]})?.measureUnit,"mmol/L","units folded as for clinic sheets");
assert.equal(chartMeasure({catalogueRef:"ldl_c",value:3.1,unit:"mmol/L",checks:["implausible"]}),null);
assert.equal(chartMeasure({catalogueRef:"ldl_c",value:30,unit:"mmol/L",checks:[]}),null,"outside the hand-entry range");
assert.equal(chartValueProblem({measure:"ldl_c",measureUnit:"mmol/L"},99),true);
assert.equal(chartValueProblem({measure:"ldl_c",measureUnit:"mmol/L"},3.1),false);
assert.equal(chartValueProblem({measure:null,measureUnit:null},99999),false);
const now=Date.parse("2026-10-18T10:00:00Z");
const job=(over:Partial<MemberReadingJob>):MemberReadingJob=>({jobId:randomUUID(),state:"queued",outcome:null,createdAt:new Date(now-60_000).toISOString(),finishedAt:null,identityStatus:null,sampleDate:null,confirmation:null,valueCount:0,...over});
const doc=(j:MemberReadingJob|null,ageMs=60_000)=>({createdAt:new Date(now-ageMs).toISOString(),job:j});
assert.deepEqual(readingState(doc(job({})),now),{state:"reading",shown:true});
assert.deepEqual(readingState(doc(job({createdAt:new Date(now-SLOW_AFTER_MS-1).toISOString(),outcome:"model_calls_not_permitted"})),now),{state:"slow",shown:true});
assert.deepEqual(readingState(doc(job({state:"done",identityStatus:"match",valueCount:3,confirmation:{identityAnswer:null,valuesSaved:3,valuesCharted:2,at:new Date(now-1000).toISOString()}})),now),{state:"saved",shown:true},"own sheet: saved at once");
assert.deepEqual(readingState(doc(job({state:"done",identityStatus:"mismatch",valueCount:1})),now),{state:"identity",shown:true},"a mismatch asks before saving");
assert.deepEqual(readingState(doc(job({state:"done",identityStatus:"match",valueCount:3})),now),{state:"slow",shown:true},"never \"saved\" without a save record (Codex F1)");
assert.deepEqual(readingState(doc(job({state:"done",identityStatus:"match",valueCount:2,confirmation:{identityAnswer:null,valuesSaved:2,valuesCharted:2,at:new Date(now-8*86_400_000).toISOString()}})),now),{state:"saved",shown:false},"the saved card goes after a week (Edit stays under Your files)");
assert.deepEqual(readingState(doc(job({state:"done",identityStatus:"multiple_patients",valueCount:0})),now),{state:"unreadable",shown:true});
assert.deepEqual(readingState(doc(job({state:"done",outcome:"unreadable",valueCount:0})),now),{state:"unreadable",shown:true});
assert.deepEqual(readingState(doc(job({state:"failed"})),now),{state:"unreadable",shown:true});
assert.deepEqual(readingState(doc(job({state:"rejected"}),20*86_400_000),now),{state:"unreadable",shown:false});
assert.deepEqual(readingState(doc(null),now),{state:"unreadable",shown:true},"never a silent nothing: not queued is said");
assert.deepEqual(readingState(doc(null,5*86_400_000),now),{state:"unreadable",shown:false},"old files from before the switch are not announced");
assert.deepEqual(readingState(doc(job({state:"done",identityStatus:"match",valueCount:2,confirmation:{identityAnswer:null,valuesSaved:2,valuesCharted:1,at:new Date(now-1000).toISOString()}})),now),{state:"saved",shown:true});
assert.deepEqual(readingState(doc(job({state:"done",identityStatus:"mismatch",valueCount:2,confirmation:{identityAnswer:"not_mine",valuesSaved:0,valuesCharted:0,at:new Date(now-1000).toISOString()}})),now),{state:"not_mine",shown:true});

// Commands: a correction carries its value, a confirmation does not.
const id=randomUUID();
assert.ok(editCommandSchema.safeParse({version:memberEditVersion,submissionId:id,jobId:id,edits:[{valueId:id,action:"correct",value:3.1},{valueId:id,action:"remove"}]}).success);
assert.ok(!editCommandSchema.safeParse({version:memberEditVersion,submissionId:id,jobId:id,edits:[{valueId:id,action:"remove",value:3.1}]}).success,"a removal carries no value");
assert.ok(!editCommandSchema.safeParse({version:memberEditVersion,submissionId:id,jobId:id,edits:[{valueId:id,action:"correct"}]}).success,"a correction carries its value");
assert.ok(!editCommandSchema.safeParse({version:memberEditVersion,submissionId:id,jobId:id,edits:[]}).success,"at least one edit");
assert.ok(identityCommandSchema.safeParse({version:memberIdentityVersion,submissionId:id,jobId:id,answer:"not_mine"}).success);
assert.ok(!identityCommandSchema.safeParse({version:memberIdentityVersion,submissionId:id,jobId:id,answer:"maybe"}).success);

// Armenian names: every catalogue analyte has one; common unmapped tests (sodium, potassium) too, display only.
for(const a of LAB_ANALYTES)assert.ok(ANALYTE_NAME_HY[a.key],`${a.key} has an Armenian name`);
assert.equal(analyteDisplayName("Sodium","hy"),"Նատրիում");assert.equal(analyteDisplayName("Potassium (K+)","hy"),"Կալիում");assert.equal(analyteDisplayName("Калий","hy"),"Կալիում");
assert.equal(analyteDisplayName("Hemoglobin","hy"),"Հեմոգլոբին");assert.equal(analyteDisplayName("Sodium","en"),"Sodium");
assert.equal(analyteDisplayName("Albumin/creatinine ratio","hy"),ANALYTE_NAME_HY.uacr,"the catalogue wins over a display name");
assert.equal(analyteDisplayName("Ironman score","hy"),"Ironman score","whole words only");

// Member copy follows the voice guide: no em dashes, no exclamation marks in what the member reads.
for(const f of["components/member-history/ai-reading-card.tsx","components/staff/member-upload-ai.tsx"]){
 const strings=[...readFileSync(f,"utf8").matchAll(/"([^"\n]{12,})"/g)].map(m=>m[1]!).filter(s=>/\s/.test(s)&&!/^[a-z0-9 :\-[\]().%_/]+$/.test(s));
 for(const s of strings){assert.ok(!s.includes("—"),`${f}: no em dash in "${s}"`);assert.ok(!/!(\s|$)/.test(s),`${f}: no exclamation mark in "${s}"`);}
}
// The summary relates the sheet to the hypertension work-up, in code; the narrative is told to use only those facts.
{
 const lipids=["total_cholesterol","hdl_c","triglycerides"].map(k=>({catalogueRef:k,attention:null,labFlag:null}));
 const w=workupStatus([{catalogueRef:"ldl_c",attention:"needs_doctor",labFlag:"high"},...lipids,{catalogueRef:"tsh",attention:null,labFlag:null}] as never);
 assert.deepEqual([w.found.sort(),w.outOfRange],[["lipid-panel","tsh"],["lipid-panel"]]);
 assert.ok(w.missing.includes("hba1c")&&w.missing.includes("creatinine-egfr"));
 // C2-03: one row of a several-row test does not make the test present.
 const a1c=workupStatus([{catalogueRef:"hba1c",attention:null,labFlag:null}] as never);
 assert.deepEqual([a1c.found,a1c.missing.includes("hba1c-glucose")],[["hba1c"],true]);
 assert.ok(workupStatus([{catalogueRef:"ldl_c",attention:null,labFlag:null}] as never).missing.includes("lipid-panel"));
 const planned=(values:string[])=>buildSummary({values:values.map(k=>({catalogueRef:k,attention:null,labFlag:null,checks:[]})) as never,previous:[],visitTests:[{id:"hba1c-glucose",title:null}] as never,
  identity:"match" as never,pageCount:1,model:null,unreadable:false,narrative:null}).missingForPlan.map(m=>m.testId);
 assert.deepEqual([planned(["hba1c"]),planned(["fasting_glucose"]),planned(["hba1c","fasting_glucose"])],[["hba1c-glucose"],["hba1c-glucose"],[]],"a planned paired test needs both halves");
 assert.match(NARRATIVE_SYSTEM,/facts\.workup only/);
 assert.equal(guardNarrative({en:"Start a statin for the LDL.",hy:"Սինթետիկ։"}),null,"no treatment advice gets through");
 const h=harness(pdfWith(sheet()));
 const r=await runMemberUploadJob(h.job,h.deps) as unknown as {summary:{workup:{found:string[]};narrative:{en:string}}};
 assert.ok(r.summary.workup.found.includes("hba1c")&&!r.summary.workup.found.includes("lipid-panel"),"member upload summary carries the work-up; LDL alone is not the whole lipid panel");
 assert.match(r.summary.narrative.en,/programme tests are on the sheet/,"the (fake) narrative was given the work-up facts");
}
// Results card and the staff read shape.
{
 const t=(ms:number)=>new Date(now-ms).toISOString();
 const v=(attention:string|null,labFlag:string|null)=>({valueId:randomUUID(),seq:1,testName:"LDL",catalogueRef:"ldl_c",valueText:"4",value:4,unit:"mmol/L",refText:null,labFlag,collectedOn:null,page:1,checks:[],attention,attentionRule:null});
 const job=(state:string,finished:string|null)=>({jobId:randomUUID(),state,outcome:"extracted",pageCount:1,identityStatus:"match",identity:null,summary:null,provider:"noreon.fake",model:"m",createdAt:t(3600_000),finishedAt:finished});
 const fileId=randomUUID(),docId=randomUUID(),oldId=randomUUID(),memberId=randomUUID();
 const raw={version:"staff-lab-ai-v1",enabled:true,viewer:"doctor",
  clinic:[{fileId,name:"clinic.pdf",clinic:"Fictional clinic",uploadedAt:t(7200_000),job:{...job("done",t(60_000)),identityConfirmedAt:null},values:[{...v("needs_doctor","high"),status:"unverified",correctedValue:null,correctedUnit:null,reviewedAt:null},{...v(null,"normal"),status:"verified",correctedValue:null,correctedUnit:null,reviewedAt:t(1000)}]}],
  memberUploads:[{documentId:docId,name:"mine.pdf",uploadedAt:t(60_000),job:{...job("running",null),confirmation:null},values:[]},
   {documentId:oldId,name:"old.pdf",uploadedAt:t(30*86_400_000),job:{...job("done",t(20*86_400_000)),confirmation:null},values:[{...v(null,null),memberStatus:"pending",memberValue:null,memberReviewedAt:null}]}]};
 const r=staffLabResultsSchema.parse(raw);
 const items=resultsCardItems(r,memberId,now);
 assert.deepEqual(items.map(i=>[i.source,i.state,i.outOfRange,i.values]),[["member","reading",0,0],["clinic","read",1,2]],"running and recent readings, newest first; old ones dropped");
 assert.equal(items[1]!.href,`/staff/real/members/${memberId}/documents/${fileId}/check`,"the doctor goes to the check page");
 assert.equal(resultsCardItems({...r,viewer:"admin"},memberId,now)[1]!.href,`#lab-ai-${fileId}`,"an admin stays on the read-only page");
 assert.deepEqual(resultsCardItems({...r,enabled:false},memberId,now),[]);
 assert.ok(outOfRange({attention:null,labFlag:"low"})&&!outOfRange({attention:null,labFlag:"normal"}));
}
console.log("member upload AI checks passed");
