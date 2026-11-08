/** QA 180: member links to PDFs and uploaded files open in a new tab with one shared definition,
 * so the app stays open behind them. */
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {FILE_LINK} from '@/lib/patient/file-link';
import {ReleasedDocuments} from '@/components/patient-care/released-documents';
assert.deepEqual(FILE_LINK,{target:'_blank',rel:'noopener noreferrer'});
const html=renderToStaticMarkup(createElement(ReleasedDocuments,{documents:[{fileId:'00000000-0000-4000-8000-000000000001',clinic:'Fictional clinic',uploadedAt:'2026-10-20T08:00:00Z',releasedAt:'2026-10-21T08:00:00Z'}],locale:'en'}));
assert.match(html,/href="\/patient\/documents\/00000000-0000-4000-8000-000000000001" target="_blank" rel="noopener noreferrer"/,'Released lab PDFs open in a new tab');
// Every member-facing link to a file route uses FILE_LINK.
const fileRoute=/href=\{`(\/patient\/documents\/|\/patient\/progress\/earlier\/files\/|\/api\/patient\/reports\/\$\{record\.id\}\/original`)/;
const walk=(dir:string):string[]=>readdirSync(dir).flatMap(f=>{const p=join(dir,f);return statSync(p).isDirectory()?walk(p):p.endsWith('.tsx')?[p]:[];});
let seen=0;
for(const file of [...walk('components'),...walk('app/patient')]){
 const text=readFileSync(file,'utf8');
 for(const match of text.matchAll(new RegExp(fileRoute.source,'g'))){
  seen++;
  const tag=text.slice(match.index!,match.index!+400).split('>')[0];
  assert.match(tag,/\{\.\.\.FILE_LINK\}/,`${file}: a file link opens in a new tab via FILE_LINK`);
 }
}
assert.ok(seen>=3,'The member file links were found');
assert.match(readFileSync('components/reports/historical-charts.tsx','utf8'),/href=\{urls\[s\.id\]\}\s*\{\.\.\.FILE_LINK\}/,'Original report links in charts open in a new tab');
console.log(`Member file links: ${seen} PDF or file links open in a new tab with noopener and noreferrer.`);
