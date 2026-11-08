// Run with --conditions=noreon-server-test --import ./scripts/register-alias.mjs.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createClient} from '@supabase/supabase-js';
const e=JSON.parse(fs.readFileSync('.superpowers/local-db.json','utf8'));
assert.equal(new URL(e.API_URL).hostname,'127.0.0.1');
Object.assign(process.env,{NOREON_SHARED_DEMO:'true',NEXT_PUBLIC_PATIENT_DEMO:'true',NOREON_WORKSPACE_SUPABASE_URL:e.API_URL,NOREON_WORKSPACE_SERVICE_ROLE_KEY:e.SERVICE_ROLE_KEY});
const {findWorkspaceCase}=await import('../lib/staff/cases.ts');
const {newDemoState}=await import('../lib/patient/demo-model.ts');
const {createWorkflow}=await import('../lib/service-workflow/model.ts');
const db=createClient(e.API_URL,e.SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const data=newDemoState();
data.state.profile={userId:data.userId,name:'Fictional normalization',birthDate:'1980-01-01',biologicalSex:'male',locale:'en'};
data.state.consentAccepted=true;
data.state.assessment={id:crypto.randomUUID(),revision:2,answers:{},assessmentDate:'2026-10-11',completedAt:null,urgentRule:null};
try {
 assert.ifError((await db.rpc('workspace_create_case',{p_id:data.userId,p_state:data})).error);
 const workflow=createWorkflow([]);workflow.questionnaireRevision=1;
 assert.ifError((await db.rpc('workspace_initialize_workflow',{p_id:data.userId,p_expected_revision:0,p_workflow:workflow})).error);
 const items=await Promise.all(Array.from({length:8},()=>findWorkspaceCase(data.userId)));
 for(const item of items){assert.equal(item.state.workflow.questionnaireRevision,2);assert.equal(item.state.workflow.allResultsAt,null);assert.deepEqual(item.state.workflow.tests,[]);assert.equal(item.revision,2);}
 const persisted=await db.rpc('workspace_case_snapshot',{p_id:data.userId});assert.ifError(persisted.error);
 assert.equal(persisted.data.case.revision,2,'only one normalization write commits');
 console.log('Eight concurrent legacy reads reload conflicts and return the same persisted normalized workflow.');
} finally {
 execFileSync('docker',['exec','-i','supabase_db_noreon-core','psql','-U','postgres','-X','-v','ON_ERROR_STOP=1'],{input:`begin; select 1 from public.workspace_cases where id='${data.userId}' for update; delete from public.workspace_cases where id='${data.userId}'; commit;`,stdio:['pipe','ignore','pipe']});
}
