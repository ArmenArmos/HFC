import assert from 'node:assert/strict';
import {axisDateLabel,chartTimeDomain} from '@/lib/member-history/axis-date';
import {readFileSync} from 'node:fs';
import {duplicateValue} from '@/lib/member-history/duplicate';
import {analyteDisplayName} from '@/lib/lab-ai/analyte-names';

// QA N-12: "26 Sep" style; the year marks a change, or the first tick of a one-year range.
const at=(d:string)=>Date.parse(`${d}T08:00:00Z`);
const one=[at('2026-09-26'),at('2026-09-29'),at('2026-10-02'),at('2026-10-05')];
assert.deepEqual(one.map(x=>axisDateLabel(x,one,'en')),['26 Sep 2026','29 Sep','2 Oct','5 Oct']);
assert.deepEqual(one.map(x=>axisDateLabel(x,one,'hy')),['26 սեպ 2026','29 սեպ','2 հոկ','5 հոկ']);
const two=[at('2025-11-20'),at('2026-03-04'),at('2026-06-15'),at('2026-09-26')];
assert.deepEqual(two.map(x=>axisDateLabel(x,two,'en')),['20 Nov','4 Mar 2026','15 Jun','26 Sep']);
assert.ok(two.every(x=>!/Sept/.test(axisDateLabel(x,two,'en'))));

// QA N-13: same measure, numbers, unit and date is a duplicate; any difference is not.
const row={measure:'ldl_c' as const,unit:'mmol/L',value:3.9,value2:null,measuredOn:'2026-09-26'};
assert.equal(duplicateValue([row],{...row}),true);
assert.equal(duplicateValue([row],{...row,measuredOn:'2026-09-27'}),false);
assert.equal(duplicateValue([row],{...row,value:4}),false);
assert.equal(duplicateValue([row],{...row,unit:'mg/dL'}),false);
const bp={measure:'bp' as const,unit:'mmHg',value:146,value2:92,measuredOn:'2026-09-26'};
assert.equal(duplicateValue([bp],{...bp,value2:93}),false);

// QA N-10: Armenian staff see catalogue names; English and unknown names stay as printed.
assert.equal(analyteDisplayName('LDL cholesterol','hy','ldl_c'),'ՑԽԼ խոլեստերին (LDL)');
assert.equal(analyteDisplayName('Total cholesterol','hy'),'Ընդհանուր խոլեստերին');
assert.equal(analyteDisplayName('Total cholesterol','en'),'Total cholesterol');
assert.equal(analyteDisplayName('Something unlisted','hy'),'Something unlisted');
// QA 179: one reading never draws an axis into the future.
{
 const DAY=864e5,now=Date.parse('2026-10-29T10:30:00Z'),reading=Date.parse('2026-10-29T08:00:00Z');
 const [from,to]=chartTimeDomain(reading,reading,now);
 assert.ok(to<=now&&to>=reading,'A single reading today ends the axis today, never after');
 assert.equal(from,reading-7*DAY,'A week of padding before a single reading');
 const old=Date.parse('2026-07-01T08:00:00Z');
 assert.deepEqual(chartTimeDomain(old,old,now),[old-7*DAY,old+7*DAY],'An older single reading is padded a week each side, still in the past');
 const many=[Date.parse('2026-09-01T08:00:00Z'),Date.parse('2026-10-20T08:00:00Z')] as const;
 assert.deepEqual(chartTimeDomain(many[0],many[1],now),[...many],'Several readings use their own range');
 assert.match(readFileSync('components/member-history/progress-charts.tsx','utf8'),/chartTimeDomain\(first, last\)/,'Progress charts use the clamped domain');
}
console.log('Axis dates (EN/HY, year marks), earlier-result duplicate rule and Armenian analyte names pass.');
