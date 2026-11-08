import assert from 'node:assert/strict';
import { historicalPoints, canonicalMarker, simpleRange } from '@/lib/reports/history';
import { sampleReports, SAMPLE_EXTRACTION } from '@/lib/reports/demo';
function report(date='2024-01-01',name='Glucose',literal='4.8',unit:string|null='mmol/L',reference:string|null='4,1 - 5,9'){
 const r=sampleReports()[0];r.state='confirmed';r.reviewed={...SAMPLE_EXTRACTION,reportDate:date,rows:[{name,literal,unit,reference,page:1,snippet:'Fictional test',uncertain:false}]};return r;
}
assert.equal(canonicalMarker('Glucose/Գլյուկոզա'),'Glucose');
assert.equal(canonicalMarker('Glucose / urine'),null);
assert.equal(canonicalMarker('Glucose/Cholesterol'),null);
assert.deepEqual(simpleRange('4,1 - 5,9'),[4.1,5.9]);
for(const s of ['<5','Adult: 4-6','0-0','No risk: <5.2'])assert.equal(simpleRange(s),null);
assert.deepEqual(historicalPoints([report('2025-01-01'),report()]).points.map(p=>p.date),['2024-01-01','2025-01-01']);
const dup=historicalPoints([report(),{...report(),id:'second-source'}]);assert.equal(dup.points.length,1);assert.equal(dup.points[0].sources.length,2);assert.equal(dup.duplicates,1);
assert.equal(historicalPoints([report(),report('2024-01-01','Glucose','86','mg/dL')]).points.length,2);
for(const r of [report('2024-02-30'),report('2999-01-01'),report('',),report('2024-01-01','Glucose','<5'),report('2024-01-01','Glucose','negative'),report('2024-01-01','Unknown'),report('2024-01-01','Glucose','4.8',null),report('2024-01-01','Glucose','4.8','unknown')]) assert.equal(historicalPoints([r]).points.length,0);
const uncertain=report();uncertain.reviewed={...SAMPLE_EXTRACTION,reportDate:'2024-01-01',rows:[{...SAMPLE_EXTRACTION.rows[0],uncertain:true}]};assert.equal(historicalPoints([uncertain]).points.length,0);
const urine=report();urine.file_name='Urinalysis.pdf';assert.equal(historicalPoints([urine]).points.length,0);
console.log('Historical chart checks passed: identity, chronology, exact units, duplicate provenance, ranges, uncertainty, specimen exclusions and invalid dates.');
const exclusions=historicalPoints([report('2024-01-01','Unknown'),report('2024-01-01','Glucose','negative')]);
assert.deepEqual(exclusions.unplotted.map(item=>item.reason),['Test not supported in charts','Result is not a numerical value']);
assert.equal(exclusions.unplotted[0].row,1);
