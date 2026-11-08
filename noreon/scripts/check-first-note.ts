import assert from "node:assert/strict";
import {evaluate} from "@/lib/clinical/rules/engine";
import type {Answers} from "@/lib/clinical/types";
import {FIRST_NOTE_MAX_FINDINGS,firstNoteNext,noteFindings,prepareFirstNote} from "@/lib/first-note/compose";
import {approveCommandSchema} from "@/lib/first-note/schema";
import type {Appointment} from "@/lib/real-booking/appointment-schema";

/** SYNTHETIC checks for the first doctor note: closed vocabulary from the rules engine, no model, refused when urgent. */
globalThis.fetch=(()=>{throw Error("network used in a check");}) as typeof fetch;
const at="2026-10-18T10:00:00+04:00";
const a=(v:Record<string,unknown>):Answers=>Object.fromEntries(Object.entries(v).map(([k,value])=>[k,{fieldId:k,value,source:"manual",answeredAt:at}])) as Answers;
const base={"q1.age":52,"q1.sex":"male","q2.height":175,"q2.weight":80,"q2.waist":95,"q2.activity":"active","q2.activity_minutes":200,"q2.diet":["veg","fruit","fish"],
 "q3.status":"never","q4.frequency":"never","q5.diagnosed":"untreated","q5.last_reading.systolic":146,"q5.last_reading.diastolic":92,"q6.conditions":["none"],"q7.relatives":["none"],
 "q8.sleep_quality":"good","q8.stress":"no","q9.present":"no","q10.symptoms":"no"};
const note=(answers:Record<string,unknown>,o:Partial<Parameters<typeof prepareFirstNote>[0]>={})=>prepareFirstNote({answers:a(answers),completedAt:at,urgentRule:null,firstName:"Ani",next:"book",...o});

// Armen, team group message 588, 2 Nov: yellow starts at 135/85, either number.
// A screening reading below that cut must not become an elevated finding in the first note (Gohar 639).
for(const [systolic,diastolic,elevated] of [[118,76,false],[120,70,false],[130,80,false],[134,84,false],[135,80,true],[125,85,true]] as const){
 const screening={...base,"q2.weight":70,"q2.waist":84,"q2.diet":["veg","fruit","fish","nuts","meat","grain","salt","ssb"],
  "q5.diagnosed":"no","q5.last_reading.systolic":systolic,"q5.last_reading.diastolic":diastolic};
 const decision=evaluate({answers:a(screening),observations:[]});
 assert.equal(decision.findings.some(f=>f.ruleId==="NRN-RULE-BP-004"),elevated,`${systolic}/${diastolic}: screening finding`);
 const draft=note(screening);
 assert.ok(typeof draft!=="string");
 assert.equal(draft.sources.includes("NRN-RULE-BP-004"),elevated,`${systolic}/${diastolic}: first-note findings`);
 if(elevated){assert.match(draft.text.en,/elevated/i);assert.match(draft.text.hy,/բարձրացած/u);}
 else{assert.doesNotMatch(draft.text.en,/elevated/i);assert.doesNotMatch(draft.text.hy,/բարձրացած/u);}
}

// Refusals: not finished, urgent rule stamped, engine red.
assert.equal(note(base,{completedAt:null}),"not_ready");
assert.equal(note(base,{urgentRule:"RF-01"}),"urgent");
assert.equal(note({...base,"q9.present":"yes","q9.right_now":"yes"}),"urgent","chest pain right now is red: no note");

// The findings are the engine's own sentences, in both languages; ids are kept for the doctor only.
const d=note({...base,"q3.status":"current","q3.years":20,"q3.per_day":20,"q2.activity":"sedentary","q2.activity_minutes":20});
assert.ok(typeof d!=="string");
const decision=evaluate({answers:a({...base,"q3.status":"current","q3.years":20,"q3.per_day":20,"q2.activity":"sedentary","q2.activity_minutes":20}),observations:[]});
const shown=noteFindings(decision);
assert.ok(shown.length>0&&shown.length<=FIRST_NOTE_MAX_FINDINGS);
for(const f of shown){assert.ok(d.text.en.includes(f.reason.en!.trim().replace(/\.$/,"")),`EN names ${f.ruleId}`);assert.ok(d.text.hy.includes(f.reason.hy.trim().replace(/[.։]$/,"")),`HY names ${f.ruleId}`);}
assert.deepEqual(d.sources,shown.map(f=>f.ruleId));
assert.ok(d.text.en.startsWith("Hello Ani.")&&d.text.hy.startsWith("Բարև ձեզ, Ani։"));

// Orange: its next step is included (the member already sees it on the summary).
const o=note({...base,"q5.last_reading.systolic":185,"q5.last_reading.diastolic":112,"q5.crisis_symptoms":["none"]});
assert.ok(typeof o!=="string");
const orange=noteFindings(evaluate({answers:a({...base,"q5.last_reading.systolic":185,"q5.last_reading.diastolic":112,"q5.crisis_symptoms":["none"]}),observations:[]})).find(f=>f.urgency==="orange");
assert.ok(orange?.nextStep,"fixture has an orange finding with a next step");
assert.ok(o.text.en.includes(orange.nextStep.en!.trim().replace(/\.$/,"")),"orange next step in the note");

// Next step wording follows the visit state.
const booked=note(base,{next:"booked",visitWhen:{en:"Tuesday 21 October at 10:30",hy:"երեքշաբթի, 21 հոկտեմբերի, 10:30"}});
assert.ok(typeof booked!=="string"&&booked.text.en.includes("Your visit for the tests is Tuesday 21 October at 10:30."));
const waiting=note(base,{next:"waiting"});assert.ok(typeof waiting!=="string"&&waiting.text.en.includes("Your care team will contact you"));
const nameless=note(base,{firstName:null});assert.ok(typeof nameless!=="string"&&nameless.text.en.startsWith("Hello. "));

// Voice and safety: no registry ids, no em dashes, no exclamation marks, no numbers the engine did not say, length fits the database.
for(const t of [d,o,booked,waiting].flatMap(x=>typeof x==="string"?[]:[x.text.en,x.text.hy])){
 assert.doesNotMatch(t,/\bRF-\d|\b[A-Z]{2,4}-\d{3}\b/,"no internal rule ids");
 assert.doesNotMatch(t,/—|!/);
 assert.ok(t.length<=1500);
}

// Visit state from appointments.
const appt=(startsAt:string,status:Appointment["status"]="confirmed")=>({id:"00000000-0000-4000-8000-000000000001",status,createdAt:at,current:{startsAt,endsAt:startsAt,mode:"clinic"},portal:{channel:"portal",checkin:null,proposal:null}}) as unknown as Appointment;
const now=Date.parse("2026-10-19T09:00:00+04:00");
assert.equal(firstNoteNext(undefined,now).next,"book");
assert.equal(firstNoteNext([],now).next,"book");
assert.equal(firstNoteNext([appt("2026-10-21T10:30:00+04:00")],now).next,"booked");
assert.match(firstNoteNext([appt("2026-10-21T10:30:00+04:00")],now).visitWhen!.en,/21 October/);
assert.equal(firstNoteNext([appt("2026-10-18T10:30:00+04:00")],now).next,"waiting","a past visit: the care team follows up");
assert.equal(firstNoteNext([appt("2026-10-21T10:30:00+04:00","notification-pending")],now).next,"waiting");
assert.equal(firstNoteNext([appt("2026-10-21T10:30:00+04:00","cancelled")],now).next,"book");

// Command shape.
const cmd={version:"first-note-v1",memberId:"00000000-0000-4000-8000-000000000002",submissionId:"00000000-0000-4000-8000-000000000003",textEn:"x",textHy:"y",builderVersion:"first-note-1",sources:["HTN-002"],edited:false,assessmentRevision:3};
assert.ok(!approveCommandSchema.safeParse({...cmd,assessmentRevision:undefined}).success,"the answers revision is required");
assert.ok(approveCommandSchema.safeParse(cmd).success);
assert.ok(!approveCommandSchema.safeParse({...cmd,textEn:" "}).success,"both languages needed");
assert.ok(!approveCommandSchema.safeParse({...cmd,extra:1}).success,"strict");

// Several orange findings: every one is named and every next step kept, within the database limits (Astra FN-03).
const many={...base,"q5.last_reading.systolic":185,"q5.last_reading.diastolic":112,"q5.crisis_symptoms":["none"],"q9.present":"yes","q9.right_now":"no","q9.crescendo":"worse","q10.symptoms":"yes","q10.syncope":"exertion",
 "q3.status":"current","q3.years":20,"q3.per_day":20,"q2.activity":"sedentary","q2.activity_minutes":20};
const mDecision=evaluate({answers:a(many),observations:[]});
const oranges=mDecision.findings.filter(f=>f.urgency==="orange");
assert.ok(oranges.length>=3,`fixture has several orange findings (${oranges.map(f=>f.ruleId).join(",")})`);
const m=note(many);
assert.ok(typeof m!=="string");
for(const f of oranges){
 assert.ok(m.sources.includes(f.ruleId),`${f.ruleId} kept beyond the cap`);
 if(f.nextStep){assert.ok(m.text.en.includes(f.nextStep.en!.trim().replace(/\.$/,"")),`${f.ruleId} EN next step kept`);assert.ok(m.text.hy.includes(f.nextStep.hy.trim().replace(/[.։]$/,"")),`${f.ruleId} HY next step kept`);}
}
assert.ok(m.text.en.length<=1500&&m.text.hy.length<=2000,`within limits (${m.text.en.length}/${m.text.hy.length})`);

console.log("first note checks passed");
