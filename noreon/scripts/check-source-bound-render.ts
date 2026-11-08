import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ReportExplanation} from '@/components/reports/report-explanation';
import {SAMPLE_EXTRACTION} from '@/lib/reports/demo';
import {sourceBoundExplanation} from '@/lib/reports/source-bound-output';

const old={summary:'Unsafe diagnosis sentinel',attention:[],questions:[],items:[]};
for(const locale of ['en','hy'] as const) {
 const render=(value:unknown,published=false)=>renderToStaticMarkup(createElement(ReportExplanation,{value,reviewed:SAMPLE_EXTRACTION,locale,published}));
 assert.ok(!render(old).includes(old.summary),'Historical unapproved model prose must not render');
 assert.ok(render(old,true).includes(old.summary),'Explicitly clinician-approved publication retains its note');
 const canonical=sourceBoundExplanation(SAMPLE_EXTRACTION,locale);
 const html=render(canonical);
 assert.ok(html.includes('3.2'),'Source value remains visible');
 assert.ok(!render({...canonical,summary:old.summary}).includes(old.summary),'Mutated source summary must not render');
}
console.log('EN/HY rendered report summaries suppress unapproved historical or altered prose and preserve approved clinician notes.');
