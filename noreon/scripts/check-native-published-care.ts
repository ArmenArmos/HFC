import assert from 'node:assert/strict';
import {memberInstruction} from '@/lib/text-language';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ApprovedPlan} from '@/components/patient-care/care-layout';
import type {CarePlan} from '@/lib/patient-care/types';
const merged='A complete reviewed explanation that must remain body text.\nCare instructions and follow-up are not a clinical goal.';
const plan:CarePlan={id:'10000000-0000-4000-8000-000000000001',clinician:'Recorded doctor',publishedAt:'2026-10-12T00:00:00Z',instructions:merged,acknowledgedAt:null,medications:[]};
for(const locale of ['en','hy'] as const){
 const html=renderToStaticMarkup(createElement(ApprovedPlan,{plan,locale,readAction:null} as Parameters<typeof ApprovedPlan>[0]));
 assert.ok(html.includes(locale==='en'?'Your instructions':'Ձեր ցուցումները'),'Native heading stays concise and never infers a goal from explanation');
 assert.ok(html.includes(memberInstruction(merged,locale)),'Legacy instructions use the member language guard');
}
const demoHtml=renderToStaticMarkup(createElement(ApprovedPlan,{plan,locale:'en',readAction:null}));
assert.ok(demoHtml.includes(merged.split('\n')[0]),'Existing demo title rendering is preserved');
const publicationProjection=await import('@/lib/patient-care/published-review');
const draft={explanation:'Ամբողջական բացատրություն։ '.repeat(35),instructions:'Long recorded instructions.\n'.repeat(35),followUp:'Recorded follow-up',medicationName:'',medicationDose:'',medicationInstructions:'',medicationTimes:[]};
const publication={planId:plan.id,publishedAt:plan.publishedAt,draft,receipts:{},reports:[]};
const originalPlan=structuredClone(plan);
const enriched=publicationProjection.withPublishedReview(plan,[publication]);
assert.deepEqual(plan,originalPlan,'Display projection never rewrites clinical records');
assert.equal(enriched.instructions,merged,'Projection preserves the stored legacy combined text');
assert.deepEqual(enriched.publishedReview,{explanation:draft.explanation,instructions:draft.instructions,followUp:draft.followUp});
assert.equal(publicationProjection.withPublishedReview(plan,[{...publication,planId:'10000000-0000-4000-8000-000000000002'}]),plan,'Another publication never enriches the current plan');
assert.equal(publicationProjection.withPublishedReview(plan,[]),plan,'Legacy plan without immutable publication remains unchanged');
for(const locale of ['en','hy'] as const){
 const html=renderToStaticMarkup(createElement(ApprovedPlan,{plan:enriched,locale,readAction:null} as Parameters<typeof ApprovedPlan>[0]));
 for(const content of [draft.explanation,draft.instructions,draft.followUp])assert.ok(html.includes(memberInstruction(content,locale)),'Recorded content appears when usable in the selected locale');
 assert.ok(!html.includes(merged),'Structured current publication fields render separately instead of merged text');
 const headings=html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/)?.[1]??'';
 assert.ok(!headings.includes(draft.explanation));
}
console.log('Native care: concise EN/HY heading, locale-guarded long content in separate disclosures, exact immutable current-plan projection and legacy display guard pass.');
const reviewComponent=await import('@/components/real-review/published-review-card').catch(()=>null);
assert.ok(reviewComponent,'Published review must have structured member sections and compact source rows');
for(const locale of ['en','hy'] as const){
 const sourcePublication={...publication,receipts:{LDL:{reportId:'10000000-0000-4000-8000-000000000003',rows:[0],note:'Recorded relevance note shown to the member'}},reports:[{id:'10000000-0000-4000-8000-000000000003',reviewed:{laboratory:'Recorded source lab',reportDate:'2026-10-12',personName:null,summary:'Recorded source',warnings:[],rows:[{name:'LDL',literal:'2.1',unit:'mmol/L',reference:'Below 3.0',page:1,snippet:'Original source row',uncertain:false}]}}]};
 const html=renderToStaticMarkup(createElement(reviewComponent.PublishedReviewCard,{publication:sourcePublication,current:true,locale}));
 assert.ok(html.includes(memberInstruction(draft.explanation,locale)));assert.ok(html.includes(memberInstruction(draft.instructions,locale)));assert.ok(html.includes(memberInstruction(draft.followUp,locale)));
 assert.ok(html.includes(locale==='en'?'Care instructions':'Խնամքի ցուցումներ'));
 assert.ok(html.includes(memberInstruction('Recorded relevance note shown to the member',locale)));
 assert.ok(html.includes('Recorded source lab'));assert.ok(html.includes('Below 3.0'));
 assert.ok(!html.includes('Request a new review'),'Published content must not promise an unsupported repeat-review action');
 for(const content of [draft.explanation,draft.instructions,draft.followUp]){
  const position=html.indexOf(memberInstruction(content,locale));
  const preceding=html.slice(0,position);
  const depth=(preceding.match(/<details\b/g)??[]).length-(preceding.match(/<\/details>/g)??[]).length;
  assert.equal(depth,0,'Current publication clinical text is visible outside any disclosure');
 }
 assert.ok(!html.includes('<details'),'Current publication has no hidden clinical sections');
 const previous=renderToStaticMarkup(createElement(reviewComponent.PublishedReviewCard,{publication:sourcePublication,current:false,locale}));
 assert.equal((previous.match(/<details\b/g)??[]).length,3,'Prior publication retains all three historical sections');
 for(const content of [draft.explanation,draft.instructions,draft.followUp,'Recorded relevance note shown to the member','Recorded source lab','Below 3.0'])assert.ok(previous.includes(['Recorded source lab','Below 3.0'].includes(content)?content:memberInstruction(content,locale)),'Prior publication guards clinical text and preserves source provenance');
 const literalPublication={...sourcePublication,reports:[{...sourcePublication.reports[0],reviewed:{...sourcePublication.reports[0].reviewed,rows:[{name:'Printed threshold',literal:'<0.5',unit:null,reference:'Printed reference',page:1,snippet:'<0.5',uncertain:false},{name:'Unitless result',literal:'negative',unit:null,reference:null,page:1,snippet:'negative',uncertain:false}]}}],receipts:{source:{reportId:sourcePublication.reports[0].id,rows:[0,1],note:'Original source order'}}};
 for(const current of [true,false]){
  const literalHtml=renderToStaticMarkup(createElement(reviewComponent.PublishedReviewCard,{publication:literalPublication,current,locale}));
  assert.ok(literalHtml.includes('&lt;0.5')&&literalHtml.includes('negative'),'Current and historical sources preserve threshold and unitless negative literal values');
  assert.ok(literalHtml.indexOf('Printed threshold')<literalHtml.indexOf('Unitless result'),'Selected source row order stays recorded');
  assert.ok(literalHtml.includes(memberInstruction('Original source order',locale))&&literalHtml.includes('Recorded source lab'),'Literal result presentation guards source note and preserves laboratory');
 }

}
console.log('Published review EN/HY: current locale-guarded text visible without disclosures, prior history guarded, exact threshold/unitless sources and provenance preserved.');

assert.equal(typeof publicationProjection.publishedSourceRows,'function','Immutable selected source rows must be available without numeric inference');
const rawReport={reportDate:'2026-10-12',personName:null,laboratory:'Recorded lab',summary:'',warnings:[],rows:[{name:'Urine protein',literal:'Trace',unit:null,reference:'Negative',page:1,snippet:'Trace',uncertain:false}]};
const rawPublication={...publication,receipts:{urine:{reportId:'10000000-0000-4000-8000-000000000003',rows:[0],note:'Checked source'},second:{reportId:'10000000-0000-4000-8000-000000000003',rows:[0],note:'Also relevant'}},reports:[{id:'10000000-0000-4000-8000-000000000003',reviewed:rawReport}]};
const sourceRows=publicationProjection.publishedSourceRows([rawPublication]);
assert.equal(sourceRows.length,1,'Same published source row is stable across multiple receipt references');
assert.deepEqual(sourceRows[0].source,rawReport.rows[0],'Unitless nonnumeric source text remains literal');
assert.deepEqual(sourceRows[0].notes,['Checked source','Also relevant']);
assert.equal(publicationProjection.publishedSourceRows([{...rawPublication,receipts:{}}]).length,0,'Unselected report rows are not released');
assert.ok(publicationProjection.currentPublishedReviewSchema,'Current publication payload must have a validated bounded schema');
const current={planId:plan.id,publishedAt:plan.publishedAt,draft,sourceRows:[{reportId:rawPublication.reports[0].id,rowIndex:0,source:rawReport.rows[0],laboratory:rawReport.laboratory,reportDate:rawReport.reportDate,notes:['Checked source']}]};
const parsedCurrent=publicationProjection.currentPublishedReviewSchema.parse(current);
assert.deepEqual(publicationProjection.withCurrentPublishedReview(plan,parsedCurrent).publishedReview,{explanation:draft.explanation.trim(),instructions:draft.instructions.trim(),followUp:draft.followUp});
assert.equal(publicationProjection.withCurrentPublishedReview(plan,null),plan,'Absent active publication preserves legacy care');
assert.deepEqual(publicationProjection.currentPublishedSourceRows(parsedCurrent)[0].source,rawReport.rows[0]);
assert.equal(publicationProjection.currentPublishedSourceRows(null).length,0);
