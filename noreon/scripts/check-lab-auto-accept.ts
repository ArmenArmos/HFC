import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {LAB_ANALYTES} from "@/lib/lab-ai/catalogue";
import {AI_READ_LABEL} from "@/lib/lab-ai/provenance";
import {readFileSync,readdirSync} from "node:fs";
import {validateResult,type Extraction} from "@/lib/lab-ai/extraction";
import {autoAcceptBlock} from "@/lib/lab-ai/auto-accept";
import {runLabJob,type ClaimedJob} from "@/lib/lab-ai/worker";
import {buildSkeleton} from "@/lib/ai-plan/skeleton";

/** SYNTHETIC checks for default confirmation of matched lab values. Every name and value is fictional; no model is called. */
globalThis.fetch=(()=>{throw Error("network used in a check");}) as typeof fetch;

type Row=Extraction["results"][number];
const row=(o:Partial<Row>={}):Row=>{const r:Row={testName:"Haemoglobin",analyte:"hemoglobin",valueText:"140",unit:"g/L",referenceRange:"120-160",flag:null,collectedOn:"2026-10-15",page:1,snippet:"Haemoglobin 140 g/L [120-160]",...o};
 return {...r,snippet:o.snippet??`${r.testName} ${r.valueText} ${r.unit??""}${r.referenceRange?` [${r.referenceRange}]`:""}`};
};
const ctx={pageCount:2,sampleDate:"2026-10-15",labName:"Synthetic Lab",today:"2026-10-19"};
const block=(o:Partial<Row>={},identity:"match"|"unknown"|"mismatch"="match")=>autoAcceptBlock(validateResult(row(o),ctx),identity,ctx.today);

// Safeguards: abnormal values and clinical attention are data, not extraction uncertainty.
assert.equal(block(),null);
assert.equal(block({valueText:"170",flag:"high"}),null,"out-of-range high haemoglobin");
assert.equal(block({testName:"LDL-C",analyte:"ldl_c",valueText:"7",unit:"mmol/L",referenceRange:"<3",flag:"high"}),null,"high LDL and its clinical attention count");
assert.equal(block({testName:"HbA1c",analyte:"hba1c",valueText:"12",unit:"%",referenceRange:"4-6",flag:"high"}),null,"high HbA1c and threshold alert count");
assert.equal(block({flag:"critical"}),null,"a printed flag alone is not extraction uncertainty");
for(const identity of ["unknown","mismatch","multiple_patients"] as const)
 assert.equal(autoAcceptBlock(validateResult(row(),ctx),identity,ctx.today),"identity");
assert.equal(block({testName:"Panel item 7",analyte:"hemoglobin"}),"mapping");
assert.equal(block({unit:"mmol/L"}),"checks");
assert.equal(block({unit:null}),"checks");
assert.equal(block({referenceRange:null}),null,"a range is no longer required");
assert.equal(block({referenceRange:"see comment"}),"checks","a recorded failed check remains a blocker");
assert.equal(block({valueText:"122"}),null,"range margin dropped");
assert.equal(block({valueText:"<5"}),"checks");
assert.equal(block({valueText:"140 H"}),"value");
assert.equal(block({collectedOn:"2026-10-20"}),"checks");
assert.equal(block({collectedOn:"2025-09-14"}),null,"exactly 400 days before upload is allowed");
assert.equal(block({collectedOn:"2025-09-13"}),"date","401 days old");
assert.equal(autoAcceptBlock(validateResult(row({collectedOn:null}),{...ctx,sampleDate:null}),"match",ctx.today),"date");
assert.equal(autoAcceptBlock({...validateResult(row(),ctx),attention:'needs_doctor'},"match",ctx.today),"attention","unexplained attention mark");
assert.equal(autoAcceptBlock({...validateResult(row(),ctx),attentionRule:'unexpected'},"match",ctx.today),"attention");
assert.equal(autoAcceptBlock({...validateResult(row(),ctx),value:141},"match",ctx.today),"value","stored number must equal the printed number");
assert.equal(autoAcceptBlock({...validateResult(row(),ctx),canonical:140,unit:'unknown'},"match",ctx.today),"mapping","unit is independently recomputed");
assert.equal(block({snippet:""}),"mapping","missing source text");
// The first result token must corroborate; reference bounds and unit prefixes cannot.
for(const [valueText,unit,snippet] of [
 ["5","mmol/L","Glucose 50 mmol/L; reference 3 - 5 mmol/L"],
 ["5","mmol/L","Glucose 2 5 mmol/L"],
 ["5","mmol/L","Glucose 5; result 5 mmol/L"],
 ["5","mmol/L","50 mmol/L; reference 3 - 5 mmol/L"],
 ["5","mmol/L","< 5 mmol/L"],
 ["5","mmol/L","Glucose 5 mmol/L / kg"],
 ["5","mmol/L","Glucose 5 mmol/L/ kg"],
 ["5","mmol/L","Glucose 5 mmol/mol"],
 ["90","mg/dL","Glucose 90 mg/dL/kg"],
 ["90","mg/dL","Glucose 90 mg/dL / kg"],
 ["5","mmol/L","Glucose 5 mmol/L · kg"],
 ["5","mmol/L","Glucose 5 mmol/L * kg"],
 ["5","mmol/L","Glucose 5 mmol/L ^ 2"],
 ["5","mmol/L","Glucose 5 mmol/L per kg"],
 ["5","mmol/L","Glucose 5 mmol/L в кг"],
 ["5","mmol/L","Glucose 5 mmol/L kg"],
 ["5","mmol/L","Glucose 5.0 mmol/L"],
 ["5","mmol/L","Glucose .5 mmol/L"],
 ["5","mmol/L","Glucose 5e0 mmol/L"],
 ["5","mmol/L","Glucose < \t 5 mmol/L"],
 ["5","mmol/L","Glucose > \t 5 mmol/L"],
 ["5","mmol/L","Glucose ≤ \t 5 mmol/L"],
 ["5","mmol/L","Glucose ≥ \t 5 mmol/L"],
 ["5","mmol/L","Glucose ~ \t 5 mmol/L"],
 ["5","mmol/L","Glucose - \t 5 mmol/L"],
 ["5","mmol/L","Glucose – \t 5 mmol/L"],
 ["5","mmol/L","Glucose to \t 5 mmol/L"],
 ["5","mmol/L","Glucose до \t 5 mmol/L"],
 ["5","mmol/L","Glucose от \t 5 mmol/L"],
] as const)
 assert.equal(block({testName:"Glucose",analyte:"fasting_glucose",valueText,unit,snippet,referenceRange:null}),"mapping",snippet);
// A matching first number is insufficient when reference/result structure is ambiguous.
for(const [valueText,snippet] of [
 ["5","Glucose reference: 5 mmol/L; result: 50 mmol/L"],
 ["3","Glucose 3 mmol/L - 5 mmol/L; result 50 mmol/L"],
 ["5","Glucose result: 5 mmol/L"],
 ["5","Glucose ref 5 mmol/L"],
 ["5","Glucose норма 5 mmol/L"],
 ["5","Glucose референс 5 mmol/L"],
 ["5","Glucose արդյունք 5 mmol/L"],
 ["5","Glucose նորմ 5 mmol/L"],
 ["5","Glucose: 5 mmol/L"],
 ["5","Glucose = 5 mmol/L"],
 ["3","Glucose 3 mmol/L – 5 mmol/L"],
 ["3","Glucose 3 mmol/L — 5 mmol/L"],
 ["3","Glucose 3 mmol/L to 5 mmol/L"],
 ["3","Glucose 3 mmol/L до 5 mmol/L"],
 ["3","Glucose 3 mmol/L մինչև 5 mmol/L"],
 ["5","Glucose 5 mmol/L; result: 50 mmol/L"],
 ["5.6","Glucose 5.6 mmol/L 3.9 - 5.6 mmol/L"],
 ["5","Glucose 5 mmol/L H 50 mmol/L"],
 ["5","Glucose 5 mmol/L (3-6); 50 mmol/L"],
 ["5","Glucose 5 mmol/L; reference 3-6; result 50 mmol/L"],
 ["5","Glucose 5 mmol/L; reference result 50 mmol/L"],
 ["5","Glucose 5 mmol/L (3-6"],
 ["5","Glucose 5 mmol/L [3-6)"],
] as const)assert.equal(block({testName:"Glucose",analyte:"fasting_glucose",valueText,unit:"mmol/L",snippet,referenceRange:null}),"mapping",snippet);
// Bare table columns must match the extractor's own reference, never a second result.
const tableCases=[
 ["HDL cholesterol","hdl_c","1.2","HDL cholesterol 1.2 mmol/L > 1.0","> 1.0",1,null,null,true],
 ["LDL cholesterol","ldl_c","3.7","LDL cholesterol 3.7 mmol/L < 3.0","< 3.0",null,3,"needs_doctor",true],
 ["Total cholesterol","total_cholesterol","5.6","Total cholesterol 5.6 mmol/L < 5.2","< 5.2",null,5.2,"needs_doctor",true],
 ["Triglycerides","triglycerides","1.6","Triglycerides 1.6 mmol/L < 1.7","< 1.7",null,1.7,null,true],
 ["Glucose","fasting_glucose","5","Glucose 5 mmol/L 3 - 5 mmol/L; result 50 mmol/L","3 - 5",3,5,null,false],
 ["Glucose","fasting_glucose","5","Glucose 5 mmol/L < 3.0","< 6.1",null,6.1,null,false],
 ["LDL","ldl_c","3.7","LDL 3.7 mmol/L < 3.0 (corrected 50 mmol/L)","< 3.0",null,3,"needs_doctor",false],
 ["Glucose","fasting_glucose","5","Glucose 5 mmol/L 50",null,null,null,null,false],
 ["Glucose","fasting_glucose","5","Glucose 5 mmol/L < 6.1","",null,null,null,false],
 ["Glucose","fasting_glucose","5","Glucose 5 mmol/L H 3.0—6.1 MMOL / L"," 3,0 – 6,1 ",3,6.1,null,true],
 ["Glucose","fasting_glucose","5","Glucose 5 mmol/L 3–6","3 - 6",3,6,null,true],
 ["Glucose","fasting_glucose","5","Glucose 5 mmol/L <6.1","< 6.1",null,6.1,null,true],
 ["Glucose","fasting_glucose","5","Glucose 5 mmol/L ≤ 6.1","≤ 6.1",null,6.1,null,true],
 ["Glucose","fasting_glucose","5","Glucose 5 mmol/L ≤ 6.1","< 6.1",null,6.1,null,false],
 ["Glucose","fasting_glucose","5","Glucose 5 mmol/L < 6.1 mg/L","< 6.1",null,6.1,null,false],
 ["Glucose","fasting_glucose","5","Glucose 5 mmol/L < 6.1 corrected","< 6.1 corrected",null,6.1,null,false],
 ["Glucose","fasting_glucose","5","Glucose reference: 5 mmol/L < 6.1; result: 50 mmol/L","< 6.1",null,6.1,null,false],
 ["Glucose","fasting_glucose","5","Glucose 5 mmol/L H (corrected result: 50 mmol/L)","< 6.1",null,6.1,null,false],
] as const;
for(const [testName,analyte,valueText,snippet,referenceRange,refLow,refHigh,attention,accepted] of tableCases){
 const v=validateResult(row({testName,analyte,valueText,unit:"mmol/L",snippet,referenceRange}),ctx);
 assert.deepEqual([v.refLow,v.refHigh,v.attention,v.labFlag],[refLow,refHigh,attention,null],`table extraction: ${snippet}`);
 assert.equal(autoAcceptBlock(v,"match",ctx.today),accepted?null:"mapping",snippet);
}
// Only one complete reference may follow the result and optional status flag.
const referenceCases=[
 ["Glucose","fasting_glucose","5","mmol/L","Glucose 5 mmol/L H (corrected result: 50 mmol/L)",false],
 ["Glucose","fasting_glucose","5","mmol/L","Glucose 5 mmol/L H [corrected result: 50 mmol/L]",false],
 ["Glucose","fasting_glucose","5","mmol/L","Glucose 5 mmol/L H (исправленный результат: 50 mmol/L)",false],
 ["Glucose","fasting_glucose","5","mmol/L","Glucose 5 mmol/L H [исправленный результат: 50 mmol/L]",false],
 ["Glucose","fasting_glucose","5","mmol/L","Glucose 5 mmol/L H (ուղղված արդյունք: 50 mmol/L)",false],
 ["Glucose","fasting_glucose","5","mmol/L","Glucose 5 mmol/L H [ուղղված արդյունք: 50 mmol/L]",false],
 ["Glucose","fasting_glucose","5","mmol/L","Glucose 5 mmol/L (3-6) [3-6]",false],
 ["Glucose","fasting_glucose","5","mmol/L","Glucose 5 mmol/L (3-6) (3-6)",false],
 ["Glucose","fasting_glucose","5","mmol/L","Glucose 5 mmol/L (3-6) corrected",false],
 ["Glucose","fasting_glucose","5","mmol/L","Glucose 5 mmol/L [3-6] նոր",false],
 ["Glucose","fasting_glucose","5","mmol/L","Glucose 5 mmol/L (3-6) 50",false],
 ["Glucose","fasting_glucose","5","mmol/L","Glucose 5 mmol/L [3-6];",false],
 ["Glucose","fasting_glucose","5","mmol/L","Glucose 5 mmol/L (ref: 3-6 result 50)",false],
 ["Glucose","fasting_glucose","5","mmol/L","Glucose 5 mmol/L [норма: 3-6 измерение 50]",false],
 ["Glucose","fasting_glucose","5","mmol/L","Glucose 5 mmol/L (նորմ: 3-6 նոր 50)",false],
 ["Glucose","fasting_glucose","5","mmol/L","Glucose 5 mmol/L (repeat 50)",false],
 ["Glucose","fasting_glucose","5","mmol/L","Glucose 5 mmol/L [result 50]",false],
 ["Glucose","fasting_glucose","5","mmol/L","Glucose 5 mmol/L ()",false],
 ["Glucose","fasting_glucose","5","mmol/L","Glucose 5 mmol/L []",false],
 ["Glucose","fasting_glucose","5","mmol/L","Glucose 5 mmol/L (5)",false],
 ["Glucose","fasting_glucose","5","mmol/L","Glucose 5 mmol/L (=6)",false],
 ["Glucose","fasting_glucose","5","mmol/L","Glucose 5 mmol/L (~6)",false],
 ["Glucose","fasting_glucose","5","mmol/L","Glucose 5 mmol/L (ref: <6 50)",false],
 ["Glucose","fasting_glucose","5","mmol/L","Glucose 5 mmol/L ref 3-6 50",false],
 ["Glucose","fasting_glucose","5","mmol/L","Glucose 5 mmol/L ref 3-6 corrected",false],
 ["Glucose","fasting_glucose","5","mmol/L","Glucose 5 mmol/L ref (3-6)",false],
 ["Glucose","fasting_glucose","5","mmol/L","Glucose 5 mmol/L ref H 3-6",false],
 ["Glucose","fasting_glucose","5","mmol/L","Glucose 5 mmol/L ref:: 3-6",false],
 ["Glucose","fasting_glucose","5","mmol/L","Glucose 5 mmol/L (3-6 mg/L)",false],
 ["Glucose","fasting_glucose","5","mmol/L","Glucose 5 mmol/L [<6 mg/L]",false],
 ["Glucose","fasting_glucose","5","mmol/L","Glucose 5 mmol/L (3 mmol/L - 6 mmol/L)",false],
 ["Glucose","fasting_glucose","5","mmol/L","Glucose 5 mmol/L (3-6) H",false],
 ["Glucose","fasting_glucose","5","mmol/L","Glucose 5 mmol/L H L",false],
 ["Glucose","fasting_glucose","5","mmol/L","Glucose 5 mmol/L normal 70 to 100 mg/dL",false],
 ["Glucose","fasting_glucose","5","mmol/L","Glucose 5 mmol/L референсные 70-100",false],
 ["LDL-C","ldl_c","3.9","mmol/L","LDL-C 3.9 mmol/L (<3.0)",true],
 ["Glucose","fasting_glucose","90","mg/dL","Glucose 90 mg/dL",true],
 ["Glucose","fasting_glucose","5.6","mmol/L","Glucose 5.6 mmol/L (3.9 - 5.6 mmol/L)",true],
 ["Glucose","fasting_glucose","5.6","mmol/L","Glucose 5.6 mmol/L H [ref: 3.9-5.6]",true],
 ["Glucose","fasting_glucose","5.6","mmol/L","Glucose 5.6 mmol/L ref 3.9 - 5.6",true],
 ["Glucose","fasting_glucose","5.6","mmol/L","Glucose 5.6 mmol/L (reference: <6 mmol/L)",true],
 ["Glucose","fasting_glucose","5.6","mmol/L","Glucose 5.6 mmol/L [normal: >3.9]",true],
 ["Glucose","fasting_glucose","5.6","mmol/L","Glucose 5.6 mmol/L (range: ≤5.6)",true],
 ["Glucose","fasting_glucose","5.6","mmol/L","Glucose 5.6 mmol/L [норма: ≥3.9]",true],
 ["Glucose","fasting_glucose","5.6","mmol/L","Glucose 5.6 mmol/L (референс: 3,9–5,6 ммоль/л)",true],
 ["Glucose","fasting_glucose","5.6","mmol/L","Glucose 5.6 mmol/L [референсные значения: 3.9—5.6]",true],
 ["Glucose","fasting_glucose","5.6","mmol/L","Glucose 5.6 mmol/L (նորմ: 3.9-5.6 մմոլ/լ)",true],
 ["Glucose","fasting_glucose","5.6","mmol/L","Glucose 5.6 mmol/L [հղումային: <6]",true],
 ["Glucose","fasting_glucose","5.6","mmol/L","Glucose 5.6 mmol/L референсные значения: 3.9-5.6",true],
 ["Glucose","fasting_glucose","5.6","mmol/L","Glucose 5.6 mmol/L норм: <6",false],
] as const;
for(const [testName,analyte,valueText,unit,snippet,accepted] of referenceCases)
 assert.equal(block({testName,analyte,valueText,unit,snippet,referenceRange:null}),accepted?null:"mapping",snippet);
for(const tail of ["H","L","HH","LL","↑","↓","*","high","low","выше","ниже","բարձր","ցածր",
 "[70-100]","H (70-100)","H; ref: 70-100 mg/dL","reference 70 - 100 mg/dL",
 "range 70-100","норма 70-100","референс 70-100","նորմ 70-100","հղումային 70-100"])
 assert.equal(block({testName:"Glucose",analyte:"fasting_glucose",valueText:"90",unit:"mg/dL",snippet:`Glucose 90 mg/dL ${tail}`,referenceRange:null}),null,tail);
for(const tail of ["normal 70 to 100 mg/dL","референсные 70-100"])
 assert.equal(block({testName:"Glucose",analyte:"fasting_glucose",valueText:"90",unit:"mg/dL",snippet:`Glucose 90 mg/dL ${tail}`,referenceRange:null}),"mapping",tail);
// validateResult folds whitespace. Also exercise the guard with uncollapsed stored text.
for(const snippet of ["Glucose 5  mmol/L","Glucose 5\tmmol/L"]){
 const v=validateResult(row({testName:"Glucose",analyte:"fasting_glucose",valueText:"5",unit:"mmol/L",referenceRange:null}),ctx);
 assert.equal(autoAcceptBlock({...v,snippet},"match",ctx.today),"mapping",snippet);
}
// Source units must corroborate the number, including overlapping unit windows.
for(const [testName,analyte,valueText,unit,snippet] of [
 ["Glucose","fasting_glucose","50","mmol/L","Glucose 50 mg/dL"],
 ["Urea","urea","30","mmol/L","Urea 30 mg/dL"],
 ["LDL-C","ldl_c","5","mg/dL","LDL-C 5 mmol/L"],
 ["HbA1c","hba1c","12","%","HbA1c 12 mmol/mol"],
 ["HbA1c","hba1c","12","mmol/mol","HbA1c 12 %"],
 ["Creatinine","creatinine","20","µmol/L","Creatinine 20 mg/dL"],
 ["Creatinine","creatinine","20","mg/dL","Creatinine 20 µmol/L"],
 ["LDL-C","ldl_c","3.9","mmol/L","LDL-C 3.9"],
 ["LDL-C","ldl_c","3.9","mmol/L","mmol/L LDL-C 3.9"],
 ["LDL-C","ldl_c","3.9","mmol/L","LDL-C 13.9 mmol/L"],
 ["LDL-C","ldl_c","3.9","mmol/L","LDL-C 3.9 mmol/L (mg/dL)"],
 ["LDL-C","ldl_c","3.9","mmol/L","LDL-C 3.9 mmol/L (151mg/dL)"],
 ["LDL-C","ldl_c","3.9","mmol/L","LDL-C 3.9 mmol/Litre"],
] as const)assert.equal(block({testName,analyte,valueText,unit,snippet,referenceRange:null}),"mapping",snippet);
for(const [testName,analyte,valueText,unit,snippet] of [
 ["LDL-C","ldl_c","3.9","mmol/L","LDL-C 3.9 mmol/L"],
 ["LDL-C","ldl_c","3.9","mmol/L","LDL-C 3.9 mmol/L (<3.0)"],
 ["Glucose","fasting_glucose","5","mmol/L","Glucose 5 mmol/L; reference 3 - 5 mmol/L"],
 ["Glucose","fasting_glucose","5","mmol/L","5 mmol/L (<6)"],
 ["Glucose","fasting_glucose","5.0","mmol/L","Glucose 5.0 mmol/L"],
 ["Glucose","fasting_glucose","90","mg/dL","Glucose 90 mg/dL"],
 ["Glucose","fasting_glucose","90","mg/dL","Glucose 90mg／dL"],
 ["Գլյուկոզա","fasting_glucose","5.5","mmol/L","ԳԼՅՈՒԿՈԶԱ 5,5 մմոլ/լ"],
 ["Глюкоза","fasting_glucose","5.5","mmol/L","ГЛЮКОЗА 5,5 ммоль/л"],
 ["Lp(a)","lpa","100","nmol/L","LP(A) 100 nmol/L"],
 ["Glucose (serum)+","fasting_glucose","5","mmol/L","Glucose (serum)+ 5 mmol/L"],
 ["25(OH)D","vitamin_d","30","ng/mL","25(OH)D 30 ng/mL"],
 ["HbA1c","hba1c","5.5","%","HbA1c 5.5 %"],
 ["HbA1c","hba1c","42","mmol/mol","HbA1c 42 mmol/mol Hb"],
 ["Creatinine","creatinine","90","umol/L","Creatinine 90 µmol / L"],
 ["Creatinine","creatinine","1","mg/dL","Creatinine 1 MG / DL"],
 ["Creatinine","creatinine","90","µmol/L","Creatinine 90 мкмоль/л"],
 ["Glucose","fasting_glucose","5.5","mmol/L","Glucose 5,5 մմոլ/լ"],
] as const)assert.equal(block({testName,analyte,valueText,unit,snippet,referenceRange:null}),null,snippet);
for(const [testName,analyte,valueText,unit] of [
 ["Glucose","fasting_glucose","18.018017","mg/dL"],
 ["Glucose","fasting_glucose","1081.081083","mg/dL"],
 ["HbA1c","hba1c","9.269784","mmol/mol"],
 ["HbA1c","hba1c","195.102756","mmol/mol"],
 ["Creatinine","creatinine","0.113121","mg/dL"],
 ["Creatinine","creatinine","33.936653","mg/dL"],
 // Rounded printed bounds alone are insufficient: the canonical window must also hold.
 ["Glucose","fasting_glucose","18.018018","mg/dL"],
] as const){
 const v=validateResult(row({testName,analyte,valueText,unit,referenceRange:null}),ctx);
 assert.equal(autoAcceptBlock({...v,checks:[]},'match',ctx.today),"plausibility",`${testName} ${valueText} ${unit}`);
}
// Every catalogue analyte has inclusive bounds; values outside them cannot silently confirm.
const {PLAUSIBLE,PRINTED_PLAUSIBLE,AUTO_ACCEPT_VERSION}=await import('@/lib/lab-ai/auto-accept');
assert.equal(AUTO_ACCEPT_VERSION,'lab-auto-accept-v2');
for(const a of LAB_ANALYTES){
 const bounds=PLAUSIBLE[a.key];assert.ok(bounds,`window for ${a.key}`);
 for(const n of bounds){
  const v=validateResult(row({testName:a.label,analyte:a.key,valueText:String(n),unit:a.canonical||null,referenceRange:null}),ctx);
  assert.equal(autoAcceptBlock(v,'match',ctx.today),a.canonical?null:'mapping',`${a.key} boundary ${n}`);
 }
 for(const n of [bounds[0]-0.000001,bounds[1]+0.000001]){
  const v=validateResult(row({testName:a.label,analyte:a.key,valueText:n.toFixed(6),unit:a.canonical||null,referenceRange:null}),ctx);
  assert.notEqual(autoAcceptBlock(v,'match',ctx.today),null,`${a.key} outside ${n}`);
 }
 for(const [unit,conversion] of Object.entries(a.units)){
  const scale=typeof conversion.toCanonical==='number'?conversion.toCanonical:conversion.toCanonical(1)-conversion.toCanonical(0);
  const offset=typeof conversion.toCanonical==='number'?0:conversion.toCanonical(0);
  const value=Number((((bounds[0]+bounds[1])/2-offset)/scale).toFixed(6));
  const v=validateResult(row({testName:a.label,analyte:a.key,valueText:String(value),unit:unit||null,referenceRange:null}),ctx);
  assert.equal(autoAcceptBlock(v,'match',ctx.today),unit?null:'mapping',`${a.key} ${unit} conversion`);
  for(const n of [PRINTED_PLAUSIBLE[a.key][unit][0]-0.000001,PRINTED_PLAUSIBLE[a.key][unit][1]+0.000001]){
   const outside=validateResult(row({testName:a.label,analyte:a.key,valueText:n.toFixed(6),unit:unit||null,referenceRange:null}),ctx);
   assert.notEqual(autoAcceptBlock({...outside,checks:[]},'match',ctx.today),null,`${a.key} outside printed ${unit}: ${n}`);
  }
 }
}
// The SQL table must remain equivalent to catalogue aliases,
// accepted conversions and the v2 windows. This catches drift; it is not a substitute for SQL replay.
const migrationFiles=readdirSync('supabase/migrations').filter(file=>file.endsWith('_lab_ai_default_confirm.sql'));
assert.equal(migrationFiles.length,1,'one v2 migration, including after the lead replaces its stamp');
const migration=readFileSync(`supabase/migrations/${migrationFiles[0]}`,'utf8');
const sqlCases=[...readFileSync('scripts/check-lab-auto-accept.sql','utf8').matchAll(/\('([^'\n]+)',(true|false),'reference grammar: [^'\n]+'\)/g)]
 .map(m=>({delta:JSON.parse(m[1]),accepted:m[2]==='true'}));
assert.equal(sqlCases.length,referenceCases.length,'matching TS/SQL reference fixture counts');
for(const [i,[testName,catalogueRef,valueText,unit,snippet,accepted]] of referenceCases.entries())
 assert.deepEqual(sqlCases[i],{delta:{testName,catalogueRef,valueText,value:Number(valueText),unit,snippet,refLow:null,refHigh:null,refText:null},accepted},`SQL reference fixture ${snippet}`);


const tableSqlCases=[...readFileSync('scripts/check-lab-auto-accept.sql','utf8').matchAll(/\('([^'\n]+)',(true|false),'table grammar: [^'\n]+'\)/g)]
 .map(m=>({delta:JSON.parse(m[1]),accepted:m[2]==='true'}));
assert.equal(tableSqlCases.length,tableCases.length,'matching TS/SQL table fixture counts');
// validateResult stores an empty reference as null; the database rejects empty text.
for(const [i,[testName,catalogueRef,valueText,snippet,refText,refLow,refHigh,attention,accepted]] of tableCases.entries())
 assert.deepEqual(tableSqlCases[i],{delta:{testName,catalogueRef,valueText,value:Number(valueText),unit:"mmol/L",snippet,refLow,refHigh,refText:refText||null,labFlag:null,attention,attentionRule:null},accepted},`SQL table fixture ${snippet}`);

for(const a of LAB_ANALYTES){
 const match=new RegExp(`\\('${a.key}',array\\[([^\\n]+?)\\],'([^']+)'::jsonb,([0-9.]+),([0-9.]+)\\)`).exec(migration);
 assert.ok(match,`SQL row ${a.key}`);
 assert.deepEqual([...match[1].matchAll(/'((?:[^']|'')*)'/g)].map(m=>m[1].replaceAll("''","'")),a.aliases,`SQL aliases ${a.key}`);
 assert.deepEqual([+match[3],+match[4]],PLAUSIBLE[a.key],`SQL bounds ${a.key}`);
 const units=JSON.parse(match[2]) as Record<string,[number,number,number,number]>;
 assert.deepEqual(Object.keys(units),Object.keys(a.units),`SQL accepted units ${a.key}`);
 for(const unit of Object.keys(a.units))assert.deepEqual(units[unit].slice(2),PRINTED_PLAUSIBLE[a.key][unit],`SQL printed window ${a.key}/${unit}`);
 for(const [unit,conversion]of Object.entries(a.units))for(const n of [0,1,10]){
  const expected=typeof conversion.toCanonical==='number'?n*conversion.toCanonical:conversion.toCanonical(n);
  assert.ok(Math.abs(units[unit][0]*n+units[unit][1]-expected)<1e-10,`SQL conversion ${a.key}/${unit}`);
 }
}
assert.doesNotMatch(migration,/set auto_accept_enabled=true|AUTO_ACCEPT_MARGIN|AUTO_ACCEPT_CUTS|clearOfCuts|insideRangeWithMargin/);
assert.match(migration,/v.status='unverified'and public\._lab_ai_current/,'publication blocks unverified values');

for(const locale of ['hy','ru','en'] as const){
 assert.ok(AI_READ_LABEL[locale]);
 for(const file of ['components/staff/lab-ai-check.tsx','components/staff/lab-ai-results.tsx','components/staff/lab-ai-status.tsx']){
  const source=readFileSync(file,'utf8');assert.ok(source.includes(`AI_READ_LABEL.${locale}`),`${file}: ${locale} provenance`);
  assert.doesNotMatch(source,/accepted automatically/i);
 }
}

// --- Worker: the flag travels with each stored value; mismatched sheets propose nothing --------------------
const job=(patients:Extraction["patients"],results:Row[]):ClaimedJob=>({jobId:randomUUID(),leaseToken:randomUUID(),attempt:1,kind:"attachment",
 file:{fileId:randomUUID(),bucket:"clinic-originals",objectKey:"k",sizeBytes:10,sha256:"a".repeat(64),mime:"application/pdf",uploadedOn:ctx.today},
 member:{name:"Anahit Synthetyan",birthDate:"1970-01-02"},visitTests:[],previous:[],
 cached:{extraction:{patients,sampleDate:"2026-10-15",labName:"Synthetic Lab",unreadable:false,results},pageCount:2,provider:"noreon.fake",model:"fake"}});
const deps={rpc:async()=>{throw Error("no rpc in this check");},download:async()=>null,route:null,providerFor:()=>null,today:()=>"2026-10-19"};
const done=await runLabJob(job([{name:"Anahit Synthetyan",birthDate:"02.01.1970"}],[row(),row({valueText:"170"})]),deps);
const values=done.values as {autoAccept:boolean}[];
assert.deepEqual(values.map(v=>v.autoAccept),[true,true],"both normal and out-of-range values proposed");
const tableRead=await runLabJob(job([{name:"Anahit Synthetyan",birthDate:"02.01.1970"}],tableCases.slice(0,4).map(
 ([testName,analyte,valueText,snippet,referenceRange])=>row({testName,analyte,valueText,unit:"mmol/L",snippet,referenceRange}))),deps);
assert.deepEqual((tableRead.values as {autoAccept:boolean}[]).map(v=>v.autoAccept),[true,true,true,true],"staging table rows proposed for confirmation");
const other=await runLabJob(job([{name:"Anahit Synthetyan",birthDate:null}],[row()]),deps);
assert.deepEqual((other.values as {autoAccept:boolean}[]).map(v=>v.autoAccept),[false],"name without date of birth: identity unknown, nothing proposed");

// --- Care plan draft: system confirmation is usable with provenance ---------------------------
const planInput={now:new Date("2026-10-19T09:00:00+04:00"),language:"en" as const,profile:{birthDate:"1970-01-02",biologicalSex:"female"},
 assessment:{answers:{"q1.age":{value:56}},completed_at:"2026-10-14T10:00:00+04:00",urgent_rule:null},measurements:[],visits:[],publications:[],
 labValues:[{valueId:randomUUID(),catalogueRef:"egfr",testName:"eGFR",value:95,unit:"ml/min/1.73m2",labFlag:null,collectedOn:"2026-10-15",attention:null,status:"auto_accepted" as const}]};
const sk=buildSkeleton(planInput);
assert.ok(typeof sk!=="string");
const labs=(sk.facts as {labs:{reviewed:unknown[];notReviewed:string[]}}).labs;
assert.deepEqual(labs.reviewed,[],"no auto-accepted value is passed as reviewed");
assert.deepEqual(labs.notReviewed,[],"auto-confirmed values do not need review");
assert.ok(!sk.items.some(i=>i.id==="gap:unreviewed-values"));
assert.ok(sk.items.some(i=>i.id.startsWith("info:ai-read:")&&i.member===null&&i.text.includes(AI_READ_LABEL.en)),"doctor-only informational provenance");

const clinicalPlan=buildSkeleton({...planInput,labValues:[
 {...planInput.labValues[0],catalogueRef:'ldl_c',testName:'LDL-C',value:7,unit:'mmol/L',labFlag:'high',attention:'threshold'},
 {...planInput.labValues[0],catalogueRef:'hba1c',testName:'HbA1c',value:12,unit:'%',labFlag:'high',attention:'threshold'},
]});
assert.ok(typeof clinicalPlan!=='string');
assert.ok(clinicalPlan.items.some(i=>i.id==='protocol:ldl-assessment'));
assert.ok(clinicalPlan.items.some(i=>i.id==='protocol:hba1c'));
assert.ok(!clinicalPlan.items.some(i=>i.id==='gap:unreviewed-values'));
for(const item of clinicalPlan.items.filter(i=>i.source.kind==='lab'))assert.equal(item.member,null,'no widening of member-facing lab result lines');
const pendingPlan=buildSkeleton({...planInput,labValues:[...planInput.labValues,{...planInput.labValues[0],status:'unverified' as const,testName:'LDL-C',catalogueRef:'ldl_c',value:7}]});
assert.ok(typeof pendingPlan!=='string');
assert.ok(pendingPlan.items.find(i=>i.id==='gap:unreviewed-values')?.text.startsWith('1 AI-read'));

console.log("lab auto-accept checks passed");
