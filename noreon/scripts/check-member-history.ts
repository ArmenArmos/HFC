import assert from 'node:assert/strict';
import {chartSeries,cleanFileName,measures,sniffMime,valueInputSchema,yerevanToday} from '@/lib/member-history/measures';
import {fieldById} from '@/lib/clinical/seed/questions';
const ok=(v:object)=>valueInputSchema.safeParse(v).success;
const base={value2:null,measuredOn:'2025-03-01'};
// Bounds come from the questionnaire where it has them.
for(const [measure,id] of [['weight','q2.weight'],['waist','q2.waist'],['hba1c','q6.hba1c']] as const){
 const field=fieldById(id) as {min:number;max:number};
 assert.deepEqual(measures[measure].units[0].bounds,{min:field.min,max:field.max},`${measure} bounds follow ${id}`);
}
assert.ok(ok({...base,measure:'weight',value:82.5,unit:'kg'}));
assert.ok(!ok({...base,measure:'weight',value:400,unit:'kg'}),'weight above bound');
assert.ok(!ok({...base,measure:'weight',value:82.55,unit:'kg'}),'too many decimals');
assert.ok(ok({...base,measure:'ldl_c',value:3.42,unit:'mmol/L'}));
assert.ok(ok({...base,measure:'ldl_c',value:130,unit:'mg/dL'}));
assert.ok(!ok({...base,measure:'ldl_c',value:3.4,unit:'mg/dL'}),'unit-specific bound');
assert.ok(!ok({...base,measure:'ldl_c',value:3.4,unit:'%'}),'unknown unit');
assert.ok(ok({measure:'bp',value:142,value2:91,unit:'mmHg',measuredOn:'2025-03-01'}));
assert.ok(!ok({measure:'bp',value:142,value2:null,unit:'mmHg',measuredOn:'2025-03-01'}),'BP needs both');
assert.ok(!ok({measure:'bp',value:90,value2:95,unit:'mmHg',measuredOn:'2025-03-01'}),'diastolic below systolic');
assert.ok(!ok({...base,measure:'hba1c',value:5.9,unit:'%',measuredOn:'2999-01-01'}),'no future date');
assert.ok(!ok({...base,measure:'hba1c',value:5.9,unit:'%',measuredOn:'2025-02-30'}),'real dates only');
assert.ok(ok({...base,measure:'hba1c',value:5.9,unit:'%',measuredOn:yerevanToday()}),'today is allowed');
// Content decides the type.
assert.equal(sniffMime(Buffer.from('%PDF-1.7')),'application/pdf');
assert.equal(sniffMime(Buffer.from([0xff,0xd8,0xff,0xe0])),'image/jpeg');
assert.equal(sniffMime(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])),'image/png');
assert.equal(sniffMime(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')),null);
assert.equal(sniffMime(Buffer.from('<html>%PDF-')),null);
assert.equal(cleanFileName('../../etc/passwd','application/pdf'),'....etcpasswd.pdf');
assert.equal(cleanFileName('scan.HEIC','image/jpeg'),'scan.jpg');
assert.equal(cleanFileName('Lab results.pdf','application/pdf'),'Lab results.pdf');
// Sources never merge; a nurse BP reading is clinic, not a home reading.
const s=chartSeries(
 [{id:'v1',measure:'ldl_c',value:116,value2:null,unit:'mg/dL',measuredOn:'2024-01-10'},{id:'v2',measure:'bp',value:150,value2:95,unit:'mmHg',measuredOn:'2024-02-01'}],
 {bp:[{id:'m-clinic',systolic:138,diastolic:88,at:'2026-10-01T08:00:00Z'}],observations:[{field:'weight',value:84.2,unit:'kg',at:'2026-10-01T08:00:00Z'}]},
 [{id:'m-clinic',systolic:138,diastolic:88,measuredAt:'2026-10-01T08:00:00Z'},{id:'m-home',systolic:131,diastolic:84,measuredAt:'2026-10-05T08:00:00Z'}]);
assert.deepEqual(s.bp.map(p=>[p.source,p.value,p.value2]),[['member',150,95],['clinic',138,88],['member',131,84]]);
assert.deepEqual(s.ldl_c.map(p=>[p.source,p.value]),[['member',3]],'mg/dL drawn in mmol/L');
assert.deepEqual(s.weight.map(p=>[p.source,p.value]),[['clinic',84.2]]);
assert.equal(s.hba1c.length,0);
console.log('check-member-history: ok');
