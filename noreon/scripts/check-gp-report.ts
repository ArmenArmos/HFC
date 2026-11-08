import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {PDFDocument} from 'pdf-lib';
import {buildGpReport,type GpReport} from '@/lib/gp-report/builder';
import {documentBlocks,languageBlocks,footerText,statusLine,type Block,type GpApproval} from '@/lib/gp-report/document';
import {day,dayTime,time,yerevanDate} from '@/lib/gp-report/format';
import {loadFonts,renderPdf} from '@/lib/gp-report/render-pdf';
import {renderDocx} from '@/lib/gp-report/render-docx';
import {gpReportReadSchema,type GpReportSource} from '@/lib/gp-report/schema';
import {CONSULTATION_WINDOW,buildPlan,consultationWindow,evaluate} from '@/lib/clinical/rules/engine';
import {derivedMetrics,modifiers} from '@/lib/clinical/rules/derived';
import {CORE_QUESTIONS} from '@/lib/clinical/seed/questions';
import {pruneAnswers} from '@/lib/patient/questionnaire';
import type {Answers} from '@/lib/clinical/types';
import {FIXTURE_MEMBER,FIXTURE_READ_AT,emptySource,fixtureSource} from './gp-report-fixture';

// Fictional data only. Checks: values come from the source rows or the engine, never
// invented; missing data says "Not available"; red wins; the header stays "Not
// clinically reviewed" until an approval exists; PDF and DOCX render the template.
const build=(source:GpReportSource,versions:{version:number;approvedAt:string;approvedByName:string;contentSha256:string}[]=[])=>buildGpReport({memberId:FIXTURE_MEMBER,token:'a'.repeat(32),readAt:FIXTURE_READ_AT,source,versions});
const text=(blocks:Block[])=>blocks.map(b=>b.type==='table'?[...b.head,...b.rows.flat()].join('\n'):b.type==='pagebreak'?'':b.text).join('\n');
const both=(r:GpReport,approval:GpApproval|null=null)=>({en:text(languageBlocks(r,approval,'en')),hy:text(languageBlocks(r,approval,'hy'))});
const numbers=(s:string)=>s.match(/\d+(?:\.\d+)?/g)??[];
const tags=(s:string)=>new Set(s.match(/\[[A-Z]\d+(?:, [A-Z]\d+)*\]/g)?.flatMap(t=>t.slice(1,-1).split(', '))??[]);

// The source contract parses what the SQL returns.
assert.equal(gpReportReadSchema.safeParse({enabled:false}).success,true);
assert.equal(gpReportReadSchema.safeParse({enabled:true,memberId:FIXTURE_MEMBER,token:'a'.repeat(32),readAt:FIXTURE_READ_AT,source:fixtureSource(),doctorName:'Synthetic doctor',versions:[]}).success,true);

// 1. Empty records: every clinical value is "Not available" with a reason, nothing is guessed.
{
 const r=build(emptySource());
 const {en,hy}=both(r);
 assert.equal(r.priorityLevel,'cannot-assess');
 assert.match(r.priority.en,/^CANNOT ASSESS\. Reason: Not available: the questionnaire is not completed/);
 for(const row of [...r.bp.rows,...r.labs.rows])for(const cell of row.slice(1))assert.match(cell.en,/^Not available: /,`expected Not available, got ${cell.en}`);
 for(const row of [...r.bp.rows,...r.labs.rows])for(const cell of row.slice(1))assert.match(cell.hy,/^Հասանելի չէ՝ /);
 assert.match(r.history.en,/^Not available: the questionnaire is not completed/);
 assert.match(r.risk.en,/^Not available: /);
 // Only identifiers, the report's own time and template constants carry digits.
 const allowed=new Set([...numbers(`${r.reportRef} v1 ${dayTime(FIXTURE_READ_AT).en} ${dayTime(FIXTURE_READ_AT).hy} UTC+4 C1 C16 12 lead 103 NRN-GP-REP-001 v1.0 NRN-CLIN-ALG-001-v1.1`)]);
 for(const n of numbers(en+hy))assert.ok(allowed.has(n),`invented number ${n} in an empty report`);
 assert.doesNotMatch(en,/normal|negative|denies|\bno chest pain\b/i,'missing data must not read as a normal or negative finding');
 assert.ok(r.gaps.length>=15);
}

// 2. The fictional member: every number is traceable to the rows, the engine or the template.
const source=fixtureSource();
const report=build(source);
// Snapshot of the fictional report built by main with the switch off, taken after #518 changed which tests the report lists
// (3 Nov: main and this branch with the switch off hash the same). It proves the switch adds nothing when off.
// Re-taken 8 Nov after the Armenian brand names (Noreon-ի -> Նորեոն Հելթի, WP B); mapping the names back gives the
// 3 Nov hash 46aec3fa3306ddd974453f75583ecb8442300d8fd82b5e55c4c870064e31f5c8, so nothing else changed.
assert.equal(createHash('sha256').update(JSON.stringify(report)).digest('hex'),'fa0ddea7fb762301d76e7053230051e9837ea7fd3849d7f357fb256aa88dd688','switch-off report remains byte-identical');
assert.deepEqual(buildGpReport({memberId:FIXTURE_MEMBER,token:'a'.repeat(32),readAt:FIXTURE_READ_AT,source,versions:[],resultsAssessment:false}),report);
const phase2=buildGpReport({memberId:FIXTURE_MEMBER,token:'a'.repeat(32),readAt:FIXTURE_READ_AT,source,versions:[],resultsAssessment:true});
assert.ok(phase2.results);
assert.ok(buildGpReport({memberId:FIXTURE_MEMBER,token:'a'.repeat(32),readAt:FIXTURE_READ_AT,source:emptySource(),versions:[],resultsAssessment:true}).gaps.some(g=>g.section==='results'));
assert.match(both(phase2).en,/Results assessment/);
assert.match(both(phase2).hy,/Արդյունքների գնահատում/);
assert.doesNotMatch(both(phase2).en,/calculates no percentage without lipid observations/);
assert.doesNotMatch(phase2.labs.note.en,/no.*target is derived/);
assert.doesNotMatch(both(phase2).en,/Treatment, drug classes, targets and referrals: Not available/);
assert.doesNotMatch(both(phase2).en,/post-test decision rules \(C1 to C16\) are pending/);
{
 const {en,hy}=both(report);
 const answers=pruneAnswers(source.assessment!.answers as Answers);
 const decision=evaluate({answers,observations:[]});
 // Independent recomputation of the means the report shows.
 const avg=(xs:number[])=>Math.round(xs.reduce((a,b)=>a+b,0)/xs.length);
 const oct=source.deviceReadings,jun=source.homeReadings;
 const expected=[`${avg(oct.map(r=>r.systolic))}/${avg(oct.map(r=>r.diastolic))}`,`${avg(jun.map(r=>r.systolic))}/${avg(jun.map(r=>r.diastolic))}`];
 for(const e of expected)assert.ok(en.includes(e),`home mean ${e} missing`);
 const visitPairs=(id:string)=>source.visitObservations.filter(o=>o.visitId===id&&typeof o.value==='number');
 const vMean=(id:string)=>`${avg(visitPairs(id).filter(o=>o.field==='systolic').map(o=>o.value as number))}/${avg(visitPairs(id).filter(o=>o.field==='diastolic').map(o=>o.value as number))}`;
 assert.ok(en.includes(`${vMean('visit-oct')}; 15 Oct 2026; mean of 2 readings [C2]`));
 assert.ok(en.includes(`${vMean('visit-june')}; 20 Jun 2026; mean of 2 readings [C1]`));
 const instants=JSON.stringify(source).match(/\d{4}-\d{2}-\d{2}(?:T[0-9:.+Z-]+)?/g)??[];
 const dates=[...instants,FIXTURE_READ_AT].flatMap(i=>[day(i).en,day(i).hy,dayTime(i).en,dayTime(i).hy,time(i),day(yerevanDate(i)).en,day(yerevanDate(i)).hy]);
 const window=(end:string)=>{const d=new Date(Date.parse(`${end}T00:00:00Z`)-6*864e5).toISOString().slice(0,10);return [day(d).en,day(d).hy];};
 const engine=JSON.stringify([decision,consultationWindow(decision),CONSULTATION_WINDOW,buildPlan(decision),derivedMetrics(answers),modifiers(answers),CORE_QUESTIONS.flatMap(q=>q.fields.map(f=>f.options))]);
 const corpus=[JSON.stringify(source),engine,...dates,...window('2026-10-15'),...window('2026-06-23'),...expected,vMean('visit-oct'),vMean('visit-june'),
  report.reportRef,'v1 UTC+4 C1 C16 12 lead 103 NRN-GP-REP-001 v1.0','28 readings 7 days 2 readings','10 pack-years',String(Math.round(97/1.76/1.76*10)/10)].join(' ');
 const allowed=new Set(numbers(corpus));
 for(const n of numbers(en))assert.ok(allowed.has(n),`number ${n} in the English report has no source`);
 for(const n of numbers(hy))assert.ok(allowed.has(n),`number ${n} in the Armenian report has no source`);
 // Every measured value carries a tag, and every tag is listed in the sources line.
 for(const row of [...report.bp.rows,...report.labs.rows])for(const cell of row.slice(1))assert.ok(/^Not available: /.test(cell.en)||/\[[A-Z]\d+/.test(cell.en),`untagged value: ${cell.en}`);
 for(const tag of tags(en))assert.ok(report.sources.en.includes(`${tag} `),`tag ${tag} is not in the sources line`);
 assert.deepEqual([...tags(en)].sort(),[...tags(hy)].sort(),'both languages cite the same sources');
 assert.deepEqual([...tags(en)].filter(t=>/^[CBLPQ]/.test(t)).sort(),['B1','B2','C1','C2','L1','L2','P1','Q1']);
 // Priority is the engine's own result and window, nothing added.
 assert.equal(report.priorityLevel,decision.urgency);
 assert.ok(report.priority.en.startsWith(`NEEDS ATTENTION: ${consultationWindow(decision).en}.`));
 // Nothing after tests is interpreted and no treatment is proposed.
 assert.doesNotMatch(en.replace('no CKD stage, G/A category, critical-value flag or target is derived',''),/\bG[1-5]a?\b|\bA[1-3]\b|CKD stage|resistant|thiazide|SGLT2|\bARB\b|\bCCB\b|statin|titrat/i);
 assert.doesNotMatch(report.proposals.map(r=>r.map(c=>c.en).join(' ')).join(' '),/\bmg\b|dose/i,'proposals carry no doses');
 assert.match(report.labs.note.en,/Interpretation: Not available: post-test decision rules \(C1 to C16\)/);
 assert.match(report.ecg.en,/^Automated ECG interpretation unavailable\./);
 // An "unknown" visit observation is never shown as a value.
 assert.doesNotMatch(en,/\d\s?kg\b|weight:? \d/i);
 // Header: the template's wording until a doctor approves.
 assert.equal(statusLine(null).en,'AI prepared | Not clinically reviewed | Adult pathway; pregnancy status not recorded');
 assert.ok(statusLine(null).hy.startsWith('Պատրաստված է AI-ի միջոցով | Բժշկի կողմից չի վերանայվել'));
 assert.ok(en.includes('AI prepared and not clinically reviewed')&&en.includes('Clinical review: pending'));
 const approval={version:1,approvedAt:'2026-10-16T07:00:00.000Z',approvedByName:'Synthetic doctor'};
 const approved=both(report,approval);
 assert.doesNotMatch(approved.en,/Not clinically reviewed|not clinically reviewed|Clinical review: pending/);
 assert.ok(approved.en.includes('Reviewed by Noreon doctor Synthetic doctor, 16 Oct 2026, 11:00'));
 assert.equal(footerText(null),'Noreon | NRN-GP-REP-001 v1.0 | DRAFT, NOT CLINICALLY REVIEWED');
}

// 3. Red always wins, and a missing answer is not a negative.
{
 const alert={id:'alert-1',source:'questionnaire',reasonCode:'rf',redFlags:['RF-01'],ruleId:'rf-01',ruleVersion:'v1',state:'open' as const,createdAt:'2026-10-16T05:50:00.000Z',lastSeenAt:null,acknowledgedAt:null,resolvedAt:null,resolution:null};
 const r=build({...source,alerts:[alert],deviceReadings:[...source.deviceReadings,{id:'crisis',systolic:186,diastolic:112,pulse:90,measuredAt:'2026-10-15T18:00:00.000Z',receivedAt:'2026-10-15T18:00:00.000Z',transport:'synthetic'}]});
 assert.equal(r.priorityLevel,'emergency');
 assert.ok(r.priority.en.includes('Call 103 now')&&r.priority.en.includes('[A1]'));
 const crisisOnly=build({...source,deviceReadings:[...source.deviceReadings,{id:'crisis',systolic:186,diastolic:112,pulse:90,measuredAt:'2026-10-15T18:00:00.000Z',receivedAt:'2026-10-15T18:00:00.000Z',transport:'synthetic'}]});
 assert.equal(crisisOnly.priorityLevel,'cannot-assess');
 assert.ok(crisisOnly.priority.en.includes('186/112'));
 const resolved=build({...source,alerts:[{...alert,state:'resolved',acknowledgedAt:'2026-10-16T05:55:00.000Z',resolvedAt:'2026-10-16T05:58:00.000Z',resolution:'member_contacted'}]});
 assert.equal(resolved.priorityLevel,'yellow','a resolved alert no longer sets the priority');
 const urgent=build({...source,assessment:{...source.assessment!,urgentRule:'RF-02'}});
 assert.equal(urgent.priorityLevel,'emergency');
 const answers={...source.assessment!.answers};delete answers['q9.present'];
 const missing=build({...source,assessment:{...source.assessment!,answers}});
 assert.notEqual(missing.priorityLevel,'green');
 assert.match(missing.history.en+missing.priority.en,/chest pain or pressure on exertion: not answered|CANNOT ASSESS/);
 assert.doesNotMatch(missing.history.en,/exertion: “No”/);
 // Review findings (Fable, 17 Oct): unknown medicine use is not a negative; red answers win even
 // in an incomplete questionnaire; an unreadable answer is reported, not read as unanswered.
 const medUnknown=build({...source,assessment:{...source.assessment!,answers:{...source.assessment!.answers,'q5.diagnosed':{fieldId:'q5.diagnosed',value:'unknown',source:'manual',answeredAt:'2026-10-16T05:40:00.000Z'}}}});
 assert.match(medUnknown.meds.rows.map(r=>r[1].en).join(' '),/Not available: the member does not know/);
 const incompleteRed=build({...source,assessment:{...source.assessment!,completedAt:null,answers:{...source.assessment!.answers,'q9.present':{fieldId:'q9.present',value:'yes',source:'manual',answeredAt:'2026-10-16T05:40:00.000Z'},'q9.right_now':{fieldId:'q9.right_now',value:'yes',source:'manual',answeredAt:'2026-10-16T05:40:00.000Z'}}}});
 assert.equal(incompleteRed.priorityLevel,'emergency','a red answer wins in an incomplete questionnaire');
 assert.ok(incompleteRed.sources.en.includes('Q1 questionnaire not completed'));
 const unreadable=build({...source,assessment:{...source.assessment!,answers:{...source.assessment!.answers,'q8.stress':{fieldId:'q8.stress',value:'often',source:'robot',answeredAt:'x'}}}});
 assert.equal(unreadable.priorityLevel,'cannot-assess');
 assert.match(unreadable.sources.en,/1 stored answers unreadable and not used/);
 assert.match(unreadable.history.en,/^Not available: /);
 const withRef=build({...source,labResults:source.labResults.map(r=>r.marker==='Potassium'?{...r,referenceLow:3.5,referenceHigh:5.1}:r)});
 assert.match(withRef.labs.rows[2][1].en,/Potassium 4\.9 mmol\/L \(ref 3\.5–5\.1\)/);
 const unknown=build({...source,assessment:{...source.assessment!,answers:{...source.assessment!.answers,'q7.relatives':{fieldId:'q7.relatives',value:'unknown',source:'manual',answeredAt:'2026-10-16T05:40:00.000Z'}}}});
 assert.match(unknown.history.en,/family history: not known/);
}

// 3b. Clinic lab PDF values (#225, QA N-01): only doctor-checked values are printed, with unit,
// date and source; unchecked ones are named as awaiting the doctor's check, never valued.
{
 const pdf=(over:Partial<GpReportSource['clinicLabValues'][number]>):GpReportSource['clinicLabValues'][number]=>({id:'v',fileId:'file-1',status:'verified',testName:'LDL-C',catalogueRef:'ldl_c',value:3.6,valueText:'3.6',unit:'mmol/L',referenceLow:null,referenceHigh:3,referenceText:null,collectedOn:'2026-10-16',attachedAt:'2026-10-17T10:00:00.000Z',clinic:'Synthetic Polyclinic',reviewedAt:'2026-10-17T12:00:00.000Z',reviewedBy:'Synthetic assigned doctor',...over});
 const pending=(id:string,testName:string,catalogueRef:string)=>pdf({id,testName,catalogueRef,status:'unverified',value:null,valueText:null,unit:null,referenceLow:null,referenceHigh:null,reviewedAt:null,reviewedBy:null});
 const values=[pdf({id:'a'}),pdf({id:'b',testName:'Total cholesterol',catalogueRef:'total_cholesterol',value:5.9,valueText:'5.9',referenceHigh:5.2}),
  pdf({id:'c',testName:'HbA1c',catalogueRef:'hba1c',status:'corrected',value:6.1,valueText:null,unit:'%',referenceHigh:null}),
  pending('d','Creatinine','creatinine'),pending('e','Fasting glucose','fasting_glucose')];
 const r=build({...emptySource(),clinicLabValues:values,clinicDocuments:[{id:'doc',attachedAt:'2026-10-17T10:00:00.000Z',clinic:'Synthetic Polyclinic'}]});
 const row=(label:string)=>r.labs.rows.find(x=>x[0].en===label)!;
 assert.match(row('Lipids')[1].en,/^LDL-C 3\.6 mmol\/L \(ref –3\)|^LDL-C 3\.6 mmol\/L/);
 assert.match(row('Lipids')[1].en,/Total cholesterol 5\.9 mmol\/L; 16 Oct 2026 \[L1\]$/,'confirmed lipids with unit, date and tag');
 assert.match(row('HbA1c / glucose')[1].en,/^HbA1c 6\.1 % \(corrected by the doctor\); 16 Oct 2026 \[L1\]\. Also awaiting doctor check: Fasting glucose from the clinic PDF attached 17 Oct 2026$/);
 assert.equal(row('Creatinine / eGFR')[1].en,'Not available: awaiting doctor check: Creatinine from the clinic PDF attached 17 Oct 2026');
 assert.equal(row('uACR')[1].en,'Not available: no result received','a row with nothing read still says no result received');
 assert.match(r.sources.en,/L1 lab results dated 16 Oct 2026, Synthetic Polyclinic, clinic PDF read by AI; values confirmed by Synthetic assigned doctor 17 Oct 2026/);
 assert.match(r.labs.note.en,/listed only after the assigned doctor confirmed them/);
 const {en,hy}=both(r);
 for(const label of ['Lipids','HbA1c / glucose','Creatinine / eGFR'])assert.doesNotMatch(row(label)[1].en,/no result received/,`${label} is not "no result received"`);
 assert.doesNotMatch(en+hy,/\b(140|5\.6)\b/,'no unchecked value is printed');
 assert.match(hy,/սպասում է բժշկի ստուգմանը/);
 // The schema refuses an unchecked row that carries a value, so it can never be printed.
 const read=(v:unknown)=>gpReportReadSchema.safeParse({enabled:true,memberId:FIXTURE_MEMBER,token:'a'.repeat(32),readAt:FIXTURE_READ_AT,source:{...emptySource(),clinicLabValues:[v]},doctorName:null,versions:[]}).success;
 assert.equal(read(pending('x','Creatinine','creatinine')),true);
 assert.equal(read({...pending('x','Creatinine','creatinine'),value:140}),false,'unchecked value with a number is refused');
 assert.equal(read({...pending('x','Creatinine','creatinine'),valueText:'140'}),false,'unchecked value with text is refused');
 assert.equal(read({...pdf({}),reviewedAt:null}),false,'a confirmed value without a review time is refused');
 // Fable F1: an unchecked value is named by its catalogue label, never by an AI name holding a number.
 const leaky=build({...emptySource(),clinicLabValues:[pending('n1','Glucose (fasting) 6.66 mmol/L','fasting_glucose'),pending('n2','Mystery 7.77 x',null as unknown as string)]});
 const leakyText=both(leaky);
 assert.doesNotMatch(leakyText.en+leakyText.hy,/6\.66|7\.77/,'no number from an AI test name');
 assert.match(leaky.labs.rows.find(x=>x[0].en==='HbA1c / glucose')![1].en,/awaiting doctor check: Fasting glucose from/);
 assert.match(leaky.labs.rows.find(x=>x[0].en==='Other results')![1].en,/awaiting doctor check: 1 unnamed test from/);
 // Existing laboratory rows still lead their own tags alongside PDF values.
 const mixed=build({...source,clinicLabValues:[pdf({collectedOn:'2026-10-17'})]});
 assert.match(mixed.labs.rows.find(x=>x[0].en==='Lipids')![1].en,/LDL-C 3\.6 mmol\/L \(ref –3\)?.*\[L3\]$|LDL-C 3\.6 mmol\/L.*\[L3\]$/);
}

// 4. Rendering: two pages per language (the template's limit), Armenian first.
const fonts=await loadFonts();
const pageCount=async(lang:'en'|'hy')=>(await PDFDocument.load(await renderPdf(languageBlocks(report,null,lang),footerText(null),fonts,'GP report'))).getPageCount();
// The template asks for two pages per language but never at the cost of a finding. Armenian
// wording runs longer, so with the v1.1 baseline test plan it may take a third page.
assert.equal(await pageCount('en'),2,'the English report fits the template\'s two pages');
assert.ok(await pageCount('hy')<=3,'the Armenian report stays within three pages');
const blocks=documentBlocks(report,null,['hy','en']);
const pdf=await renderPdf(blocks,footerText(null),fonts,'Noreon GP report (fictional)');
assert.equal(new TextDecoder().decode(pdf.slice(0,5)),'%PDF-');
assert.ok((await PDFDocument.load(pdf)).getPageCount()<=5);
const docx=renderDocx(blocks,footerText(null),'Noreon GP report (fictional)');
assert.equal(docx[0],0x50);assert.equal(docx[1],0x4b);
const names=new TextDecoder().decode(docx);
for(const part of ['[Content_Types].xml','word/document.xml','word/styles.xml','word/footer1.xml'])assert.ok(names.includes(part),`docx part ${part}`);
if(process.env.GP_REPORT_SAMPLE_DIR){
 const dir=process.env.GP_REPORT_SAMPLE_DIR;mkdirSync(dir,{recursive:true});
 writeFileSync(path.join(dir,'gp-report-fictional-member.pdf'),pdf);
 writeFileSync(path.join(dir,'gp-report-fictional-member.docx'),docx);
 writeFileSync(path.join(dir,'gp-report-fictional-member-approved.pdf'),await renderPdf(documentBlocks(report,{version:1,approvedAt:'2026-10-16T07:00:00.000Z',approvedByName:'Synthetic doctor'},['hy','en']),footerText({version:1,approvedAt:'',approvedByName:''}),fonts,'Noreon GP report (fictional, approved)'));
}
console.log('GP report checks passed.');

// Future-dated readings (PR #279): a nurse, app or device reading dated after the report's read time is ignored;
// a past crisis reading still holds the report.
{
 const pair=(id:string,visitId:string,t:string,s:number,d:number)=>(['systolic','diastolic'] as const).map((field,j)=>({id:`${id}-${j}`,visitId,field,state:'known' as const,value:[s,d][j],unit:'mmHg',observedAt:t,recordedAt:FIXTURE_READ_AT,actorName:'Synthetic nurse',clinic:'Synthetic clinic'}));
 const future='2026-10-22T09:28:00.000Z',past='2026-10-15T07:00:00.000Z';
 const withFuture=build({...emptySource(),visitObservations:[...pair('fp','visit-past',past,138,86),...pair('ff','visit-future',future,160,120)],
  homeReadings:[{id:'fh',systolic:190,diastolic:125,pulse:null,measuredAt:future,recordedAt:FIXTURE_READ_AT}]} as GpReportSource);
 const f=both(withFuture).en;
 assert.ok(!/160\/120|190\/125/.test(f),'Future clinic and home readings are not in the report');
 assert.match(f,/138\/86/,'The past clinic reading is the latest one');
 assert.doesNotMatch(withFuture.priority.en,/crisis-range reading/,'A future crisis-range row does not hold the report');
 const crisis=build({...emptySource(),visitObservations:pair('fc','visit-crisis',past,185,112)} as GpReportSource);
 assert.match(crisis.priority.en,/crisis-range reading 185\/112/,'A past crisis reading still holds the report');
}
console.log('GP report ignores future-dated readings; past crisis still holds.');
