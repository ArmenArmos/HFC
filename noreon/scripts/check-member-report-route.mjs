// Integration against an explicitly configured local shared-demo app.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createClient} from '@supabase/supabase-js';
import {PDFDocument} from 'pdf-lib';
import {newDemoState,sealDemoState} from '../lib/patient/demo-model.ts';
import {sampleReports} from '../lib/reports/demo.ts';
const base=process.env.NOREON_TEST_BASE_URL, secret=process.env.NOREON_TEST_DEMO_SECRET;
assert.ok(base&&secret,'Set local app URL and its test demo secret');
assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname));
const e=JSON.parse(fs.readFileSync('.superpowers/local-db.json','utf8'));
assert.equal(new URL(e.API_URL).hostname,'127.0.0.1');
const db=createClient(e.API_URL,e.SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const state=newDemoState();state.state.profile={userId:state.userId,name:'Fictional report route test',birthDate:'1980-01-01',biologicalSex:'male',locale:'en'};state.state.consentAccepted=true;
const token=sealDemoState(state,secret);const headers={cookie:`noreon-demo-0=${token}`,origin:base};
const id=crypto.randomUUID();
try {
 assert.ifError((await db.rpc('workspace_create_case',{p_id:state.userId,p_state:state})).error);
 const pdf=await PDFDocument.create();pdf.addPage();const bytes=await pdf.save();
 const form=new FormData();form.set('op','upload');form.set('sharedConsent','true');form.set('file',new File([bytes],'fictional.pdf',{type:'application/pdf'}));
 form.set('record',JSON.stringify({id,file_name:'fictional.pdf',mime:'application/pdf',extraction:sampleReports()[0].extraction,model:'fictional-test',prompt_version:'local-test'}));
 const uploaded=await fetch(`${base}/patient/reports/shared`,{method:'POST',headers,body:form});assert.equal(uploaded.status,200,await uploaded.text());
 let snapshot=await db.rpc('workspace_case_snapshot',{p_id:state.userId});assert.ifError(snapshot.error);assert.equal(snapshot.data.reports.length,1);
 const original=await fetch(`${base}/patient/reports/shared?original=${id}`,{headers});assert.equal(original.status,200);assert.equal((await original.arrayBuffer()).byteLength,bytes.length);
 const listed=await fetch(`${base}/patient/reports/shared`,{headers});const body=await listed.json();assert.equal(listed.status,200);assert.equal(body.reports.length,1);assert.equal(body.reports[0].record.extraction,null);assert.equal(body.reports[0].record.object_path,'');
 const removed=await fetch(`${base}/patient/reports/shared`,{method:'DELETE',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({id})});assert.equal(removed.status,200,await removed.text());
 snapshot=await db.rpc('workspace_case_snapshot',{p_id:state.userId});assert.equal(snapshot.data.reports.length,0);
 assert.ok((await db.storage.from('workspace-case-reports').download(`${state.userId}/${id}`)).error,'original deleted after database removal');
 console.log('Member multipart upload, original download, unpublished redaction and deletion pass through actual local HTTP routes.');
} finally {
 execFileSync('docker',['exec','-i','supabase_db_noreon-core','psql','-U','postgres','-X','-v','ON_ERROR_STOP=1'],{input:`begin; select 1 from public.workspace_cases where id='${state.userId}' for update; delete from public.workspace_cases where id='${state.userId}'; commit;`,stdio:['pipe','ignore','pipe']});
 await db.storage.from('workspace-case-reports').remove([`${state.userId}/${id}`]);await db.from('workspace_report_cleanup').delete().eq('object_path',`${state.userId}/${id}`);
}
