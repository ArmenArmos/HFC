import {memberInstruction} from '@/lib/text-language';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {clinicalReviewSchema,isClinicLabReceipt} from '../lib/patient-care/clinical-review-schema';
import {clinicLabSourcesSchema,type ClinicLabSource} from '../lib/patient-care/clinic-lab-sources';
import {publishedReviewSchema,publishedSourceRows} from '../lib/patient-care/published-review';
import {hasCurrentResultReceipt} from '../components/real-review/report-provenance';
import {PublishedReviewCard} from '../components/real-review/published-review-card';
import type {ClinicalSnapshot} from '../lib/patient-care/clinical-case-repository';
// QA 174: a required laboratory result received from a doctor-confirmed clinic lab result (20261029211406).
const doctor='c1ab0000-0000-4000-8000-000000000004',attachment='c1ab0000-0000-4000-8000-000000000031';
const ldl={id:'c1ab0000-0000-4000-8000-000000000051',seq:1,reviewedAt:'2026-10-29T20:00:00+00:00',name:'LDL-C',valueText:'3.4',value:3.4,unit:'mmol/L',reference:'< 3.0',collectedOn:'2026-10-28',laboratory:'SYNTHETIC Clinic Lab'};
const panel=[ldl,...['Total cholesterol','HDL-C','Triglycerides'].map((name,i)=>({...ldl,id:`c1ab0000-0000-4000-8000-00000000005${i+2}`,seq:i+2,name}))];
const clinicReceipt={source:'clinic-lab',attachmentId:attachment,values:panel,note:'Checked against the clinic sheet',actorId:doctor,at:'2026-10-29T20:05:00+00:00'};
const reportReceipt={reportId:'71000000-0000-4000-8000-000000000020',reportRevision:1,rows:[0],note:'Checked',actorId:doctor,at:'2026-10-29T20:05:00+00:00'};
const review=clinicalReviewSchema.parse({evidenceToken:'t',doctorId:doctor,preparedAt:'2026-10-29T19:00:00Z',engine:{version:'v',urgency:'green',tests:[{id:'lipid-panel',title:'Lipid panel',method:'lab'}]},approvals:{},
 receipts:{'lipid-panel':clinicReceipt,'other':reportReceipt},consultation:{decision:'undecided'}});
// Both receipt kinds parse; the clinic one keeps its values, the report one is unchanged.
assert.ok(isClinicLabReceipt(review.receipts['lipid-panel']));
assert.ok(!isClinicLabReceipt(review.receipts.other));
assert.equal(clinicalReviewSchema.safeParse({...review,receipts:{x:{...clinicReceipt,values:[]}}}).success,false,'a clinic receipt needs values');
const snapshot={id:'c1ab0000-0000-4000-8000-000000000001',revision:6,evidenceToken:'t',draft:null,draftSavedAt:null,draftStale:false,review,evidence:{reports:[],assessment:{completed_at:'2026-10-28T10:00:00Z'}}} as unknown as ClinicalSnapshot;
const sources:ClinicLabSource[]=clinicLabSourcesSchema.parse({version:'clinic-lab-receipt-sources-v1',attachments:[{attachmentId:attachment,fileId:'c1ab0000-0000-4000-8000-000000000021',fileName:'lab.pdf',clinic:'Clinic',attachedAt:'2026-10-29T19:00:00+00:00',values:panel}]}).attachments;
assert.equal(hasCurrentResultReceipt(snapshot,'lipid-panel',sources),true,'unchanged values are current');
assert.equal(hasCurrentResultReceipt(snapshot,'lipid-panel',[{...sources[0],values:[{...ldl,value:3.3,valueText:'3.3',reviewedAt:'2026-10-29T21:00:00+00:00'}]}]),false,'a later correction is historical');
assert.equal(hasCurrentResultReceipt(snapshot,'lipid-panel',[]),false,'a detached result is historical');
assert.equal(hasCurrentResultReceipt({...snapshot,evidenceToken:'changed'},'lipid-panel',sources),false,'changed evidence is historical');
assert.equal(hasCurrentResultReceipt({...snapshot,review:{...review,doctorId:'c1ab0000-0000-4000-8000-000000000005'}},'lipid-panel',sources),false,'another doctor’s receipt is historical');
// Legacy partial panels remain historical even when every stored value still
// equals the current, doctor-confirmed source. Completeness is a separate gate.
for(const [test,names,complete]of [
 ['cbc-hb',['WBC'],false],['cbc-hb',['Platelets'],false],
 ['cbc-hb',['Hemoglobin','WBC','Platelets'],false],['urinalysis',['Urinalysis'],false],
 ['creatinine-egfr',['Creatinine'],false],['insulin-homa',['Insulin'],false],
 ['creatinine-egfr',['Creatinine','eGFR'],true],['insulin-homa',['Insulin','HOMA-IR'],true],
]as const){
 const values=names.map((name,index)=>({...panel[index],name}));
 const legacy:typeof snapshot={...snapshot,review:{...review,engine:{...review.engine,tests:[{id:test,title:test,method:'lab' as const}]},receipts:{[test]:{...review.receipts['lipid-panel'],source:'clinic-lab' as const,attachmentId:attachment,values}}}};
 assert.equal(hasCurrentResultReceipt(legacy,test,[{...sources[0],values}]),complete,`${test}: legacy current-source receipt still needs a complete panel`);
 if(complete){
  assert.equal(hasCurrentResultReceipt(legacy,test,[{...sources[0],values:values.slice(0,1)}]),false,`${test}: losing a confirmed component invalidates the receipt`);
  assert.equal(hasCurrentResultReceipt(legacy,test,[{...sources[0],values:values.map((v,index)=>index===1?{...v,reviewedAt:'2026-10-29T22:00:00Z'}:v)}]),false,`${test}: a re-reviewed component invalidates the receipt`);
 }
}
// The member's published review: a clinic receipt parses, adds no report rows, and shows its values.
const publications=publishedReviewSchema.parse([{planId:'c1ab0000-0000-4000-8000-0000000000a1',publishedAt:'2026-10-29T20:10:00Z',draft:{explanation:'Synthetic explanation',instructions:'Synthetic instructions',followUp:'',medicationName:'',medicationDose:'',medicationInstructions:'',medicationTimes:[]},receipts:{'lipid-panel':clinicReceipt},reports:[]}]);
assert.deepEqual(publishedSourceRows(publications),[]);
for(const locale of ['en','hy','ru'] as const){
 const html=renderToStaticMarkup(createElement(PublishedReviewCard,{publication:publications[0],current:true,locale}));
 for(const text of ['LDL-C','3.4','mmol/L','&lt; 3.0','SYNTHETIC Clinic Lab','2026-10-28','Checked against the clinic sheet'])assert.ok(html.includes(text==='Checked against the clinic sheet'?memberInstruction(text,locale):text),`${locale}: ${text}`);
}
console.log('Clinic lab receipts parse, go historical when a value changes or the result is detached, and render in the published review.');
