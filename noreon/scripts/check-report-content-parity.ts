import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {reportContentTransition} from '@/lib/service-workflow/report-associations';
import {SAMPLE_EXTRACTION} from '@/lib/reports/demo';
const at='2026-10-11T08:00:00Z';
const old={revision:7,contentRevision:3,state:'confirmed',extraction:structuredClone(SAMPLE_EXTRACTION),reviewed:structuredClone(SAMPLE_EXTRACTION),explanation:{summary:'Initial'},associations:[{requirementId:'q',rowIndices:[0],contentRevision:3,actorId:'d',actorLabel:'Fictional',confirmedAt:at}],associationHistory:[]};
const fixtures=[
 ['row edit',(r:typeof old)=>{r.reviewed.rows[0].literal='3.8';}],
 ['row reorder',(r:typeof old)=>{r.reviewed.rows.reverse();}],
 ['date',(r:typeof old)=>{r.reviewed.reportDate='2025-01-02';}],
 ['name',(r:typeof old)=>{r.reviewed.personName='Changed fictional name';}],
 ['summary',(r:typeof old)=>{r.reviewed.summary='Changed summary';}],
 ['warning',(r:typeof old)=>{r.reviewed.warnings.push('Changed warning');}],
 ['explanation',(r:typeof old)=>{r.explanation.summary='New explanation';}],
 ['association',(r:typeof old)=>{r.associations=[];}],
 ['downgrade',(r:typeof old)=>{r.state='needs_review';}],
 ['no-op',(_r:typeof old)=>{}],
] as const;
const databaseContainer=process.env.NOREON_TEST_DB_CONTAINER;
assert.ok(databaseContainer && databaseContainer.startsWith('supabase_db_'),'Set NOREON_TEST_DB_CONTAINER to a local Supabase database container');
const quote=(v:unknown)=>`'${JSON.stringify(v).replaceAll("'","''")}'::jsonb`;
const values=fixtures.map(([name,mutate])=>{const next=structuredClone(old);mutate(next);return {name,next,expected:reportContentTransition(old,next,at)};});
const query=values.map(v=>`select public.workspace_report_content_transition(${quote(old)},${quote(v.next)},'${at}');`).join('\n');
const result=spawnSync('docker',['exec','-i',databaseContainer,'psql','-U','postgres','-X','-q','-t','-A','-v','ON_ERROR_STOP=1'],{input:query,encoding:'utf8'});
assert.equal(result.status,0,result.stderr);
const rows=result.stdout.trim().split('\n').map(r=>JSON.parse(r));
assert.equal(rows.length,values.length);values.forEach((v,i)=>assert.deepEqual(rows[i],v.expected,v.name));
console.log(`${values.length} report content/association TS and SQL transitions agree.`);
