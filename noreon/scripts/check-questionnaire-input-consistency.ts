import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { UNKNOWN, type Answers, type FieldValue } from "@/lib/clinical/types";
import { fieldById } from "@/lib/clinical/seed/questions";
import { fieldComplete, mergeAnswers, assessmentProgress } from "@/lib/patient/questionnaire";
import { createPatientService } from "@/lib/patient/service";
import { demoStoreFor, newDemoState } from "@/lib/patient/demo-model";

const answer = (fieldId: string, value: FieldValue) => ({fieldId, value, source: "manual" as const, answeredAt: "2026-10-15T00:00:00Z"});
const answers = (values: Record<string, FieldValue>): Answers => Object.fromEntries(Object.entries(values).map(([id, value]) => [id, answer(id, value)]));
const bp = (systolic: FieldValue, diastolic: FieldValue) => [{fieldId:"q5.last_reading.systolic",value:systolic},{fieldId:"q5.last_reading.diastolic",value:diastolic}];
for (const [systolic, diastolic] of [[80,120],[120,120]]) {
  test(`rejects assessment BP ${systolic}/${diastolic} before acceptance`, () => {
    assert.throws(() => mergeAnswers({},bp(systolic,diastolic)));
    assert.equal(fieldComplete(fieldById("q5.last_reading")!,answers({"q5.last_reading.systolic":systolic,"q5.last_reading.diastolic":diastolic})),false);
  });
}
test("valid and unknown BP remain accepted, including a partial edit", () => {
  for(const entries of [bp(125,82),bp(UNKNOWN,UNKNOWN),bp(UNKNOWN,82)]) {
    const accepted=mergeAnswers({},entries);
    assert.equal(fieldComplete(fieldById("q5.last_reading")!,accepted),true);
  }
  const partial=mergeAnswers({},[{fieldId:"q5.last_reading.systolic",value:125}]);
  assert.equal(fieldComplete(fieldById("q5.last_reading")!,partial),false);
  assert.equal(fieldComplete(fieldById("q5.last_reading")!,mergeAnswers(partial,[{fieldId:"q5.last_reading.diastolic",value:82}])),true);
});
for(const status of ["current","former","alternative"]) {
  test(`rejects smoking 70 years at age 56 for ${status}`, () => {
    const seed=answers({"q1.age":56,"q3.status":status});
    assert.throws(()=>mergeAnswers(seed,[{fieldId:"q3.years",value:70}]));
    assert.equal(fieldComplete(fieldById("q3.years")!,{...seed,...answers({"q3.years":70})}),false);
    assert.equal(mergeAnswers(seed,[{fieldId:"q3.years",value:56}])["q3.years"].value,56);
    assert.equal(mergeAnswers(seed,[{fieldId:"q3.years",value:0}])["q3.years"].value,0);
  });
}
test("unknown age adds no invented smoking start-age restriction; never prunes smoking years",()=>{
  for(const age of [undefined,UNKNOWN]) {
    const seed=answers({"q3.status":"current",...(age===undefined?{}:{"q1.age":age})});
    assert.equal(mergeAnswers(seed,[{fieldId:"q3.years",value:70}])["q3.years"].value,70);
  }
  assert.equal(mergeAnswers(answers({"q3.status":"current","q3.years":70}),[{fieldId:"q3.status",value:"never"}])["q3.years"],undefined);
});
test("shared real/demo service rejects inconsistent input without a persistence write",async()=>{
  const data=newDemoState();
  const profile={name:"Synthetic member",birthDate:"1970-01-01",biologicalSex:"male" as const,locale:"en" as const};
  data.state={profile:{...profile,userId:data.userId},consentAccepted:true,assessment:{id:"synthetic",revision:0,assessmentDate:"2026-10-15",answers:answers({"q1.age":56,"q3.status":"current"}),completedAt:null,urgentRule:null}};
  let writes=0;
  const store=demoStoreFor(data,async()=>{writes++;});
  const service=createPatientService({user:async()=>({userId:data.userId,phone:"+37499000000"}),store:()=>store});
  for(const entries of [bp(80,120),[{fieldId:"q3.years",value:70}]]) {
    assert.deepEqual(await service.saveAnswers({expectedRevision:0,entries}),{ok:false,reason:"invalid"});
    assert.equal(writes,0);
    assert.equal(data.state.assessment!.revision,0);
  }
  assert.deepEqual(await service.saveAnswers({expectedRevision:0,entries:bp(125,82)}),{ok:true,revision:1});
});
test("a corrected DOB reopens invalid retained duration and completion requires correction",async()=>{
  const data=newDemoState();
  const full=JSON.parse(readFileSync("scripts/fixtures/patient-answers.json","utf8")) as Answers;
  Object.assign(full,answers({"q1.age":76,"q3.status":"current","q3.years":70,"q3.per_day":10}));
  assert.equal(assessmentProgress(full).complete,true);
  data.state={profile:{name:"Synthetic member",birthDate:"1950-01-01",biologicalSex:"male",locale:"en",userId:data.userId},consentAccepted:true,assessment:{id:"synthetic",revision:0,assessmentDate:"2026-10-15",answers:full,completedAt:"2026-10-15T00:00:00Z",urgentRule:null}};
  const store=demoStoreFor(data,async()=>{});
  const service=createPatientService({user:async()=>({userId:data.userId,phone:"+37499000000"}),store:()=>store});
  assert.deepEqual(await service.saveProfile({...data.state.profile,birthDate:"1970-01-01"},true,0),{ok:true,revision:1});
  assert.equal(data.state.assessment!.completedAt,null);
  assert.equal(fieldComplete(fieldById("q3.years")!,data.state.assessment!.answers),false);
  assert.deepEqual(await service.completeAssessment(1),{ok:false,reason:"incomplete",missing:"answers"},"A retained answer that no longer counts is named, not a bare failure");
  assert.deepEqual(await service.saveAnswers({expectedRevision:1,entries:[{fieldId:"q3.years",value:56}]}),{ok:true,revision:2,enrol:"completed"},"Completing the questionnaire asks the caller to enrol the member");
  assert.equal(assessmentProgress(data.state.assessment!.answers).complete,true);
});

test("finishing repairs missing details answers from the saved profile instead of failing the member",async()=>{
  const data=newDemoState();
  const full=JSON.parse(readFileSync("scripts/fixtures/patient-answers.json","utf8")) as Answers;
  const withoutDetails=Object.fromEntries(Object.entries(full).filter(([id])=>!id.startsWith("q1.")));
  data.state={profile:{name:"Synthetic member",birthDate:"1970-01-01",biologicalSex:"male",locale:"en",userId:data.userId},consentAccepted:true,assessment:{id:"synthetic",revision:0,assessmentDate:"2026-10-15",answers:withoutDetails,completedAt:null,urgentRule:null}};
  const store=demoStoreFor(data,async()=>{});
  const service=createPatientService({user:async()=>({userId:data.userId,phone:"+37499000000"}),store:()=>store});
  const done=await service.completeAssessment(0);
  assert.equal(done.ok,true,"a profile with a birth date and sex completes the questionnaire");
  assert.equal(data.state.assessment!.answers["q1.age"]?.value,56,"the age is written from the profile");
  assert.equal(data.state.assessment!.answers["q1.sex"]?.value,"male");
  assert.ok(data.state.assessment!.completedAt,"and the assessment is complete");
  // Without a usable profile it names what is missing instead of a bare failure.
  const bare=newDemoState();
  bare.state={profile:{name:"Synthetic member",birthDate:"",biologicalSex:"male",locale:"en",userId:bare.userId} as never,consentAccepted:true,assessment:{id:"synthetic2",revision:0,assessmentDate:"2026-10-15",answers:withoutDetails,completedAt:null,urgentRule:null}};
  const bareService=createPatientService({user:async()=>({userId:bare.userId,phone:"+37499000000"}),store:()=>demoStoreFor(bare,async()=>{})});
  assert.deepEqual(await bareService.completeAssessment(0),{ok:false,reason:"incomplete",missing:"profile"});
});
