import assert from 'node:assert/strict';
import {spawn, execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
const container = 'supabase_db_noreon-core';
const sql = text => execFileSync('docker',['exec','-i',container,'psql','-U','postgres','-X','-At','-v','ON_ERROR_STOP=1'],{input:text,encoding:'utf8'}).trim();
class Session {
  constructor(name) {
    this.name=name; this.buffer=''; this.error='';
    this.child=spawn('docker',['exec','-i',container,'psql','-U','postgres','-X','-At','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe']});
    this.child.stdout.on('data',c=>{this.buffer+=c;this.check?.();});
    this.child.stderr.on('data',c=>{this.error+=c;});
    this.child.on('exit',code=>this.reject?.(new Error(`session exited ${code}: ${this.error}`)));
  }
  run(text) {
    const marker=`done_${randomUUID().replaceAll('-','')}`;
    return new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>{this.reject=null;reject(new Error(`timeout ${this.name}: ${this.error}`));},15000);
      this.reject=reject;
      this.check=()=>{if(this.buffer.includes(marker)){clearTimeout(timeout);this.check=null;this.reject=null;const out=this.buffer;this.buffer='';resolve(out);}};
      this.child.stdin.write(`${text}\n\\echo ${marker}\n`);
    });
  }
  close(){this.reject=null;this.child.stdin.end('rollback;\n\\q\n');}
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function blocked(name) {
  const until=Date.now()+10000;
  while(Date.now()<until){
    if(sql(`select exists(select 1 from pg_stat_activity where application_name='${name}' and wait_event_type='Lock');`)==='t') return;
    await sleep(30);
  }
  throw new Error(`${name} never blocked on a database lock`);
}
const q=v=>`'${JSON.stringify(v).replaceAll("'","''")}'::jsonb`;
const d=randomUUID(),cl=randomUUID(),cases=[];
let a,b;
try {
 sql(`insert into auth.users(id) values('${d}');insert into public.workspace_clinics(id,name) values('${cl}','Fictional review race clinic');insert into public.workspace_staff(user_id,role,display_name,clinic_id) values('${d}','doctor','Fictional reviewer','${cl}');`);
 a=new Session('noreon_review_a');b=new Session('noreon_review_b');
 await a.run(`set application_name='${a.name}';`);await b.run(`set application_name='${b.name}';`);
 for(const completionFirst of [true,false]) {
  const c=randomUUID(),r=randomUUID();cases.push(c);
  const draft={explanation:'Fictional',instructions:'Fictional approved plan',followUp:'',medicationName:'',medicationDose:'',medicationInstructions:'',medicationTimes:[]};
  const workflow={revision:0,startedAt:new Date().toISOString(),tests:[],receivedTestIds:[],allResultsAt:new Date().toISOString(),consultation:'not-required',draft,draftSaved:false,publication:null};
  const state={userId:c,expiresAt:Date.now()+86400000,state:{consentAccepted:true,assessment:{completedAt:new Date().toISOString(),urgentRule:null}}};
  sql(`select public.workspace_create_case('${c}',${q(state)},'${d}');select public.workspace_initialize_workflow('${c}',0,${q(workflow)});`);
  const counters=()=>sql(`select revision||','||evidence_revision from public.workspace_cases where id='${c}';`).split(',').map(Number);
  let [rev,ev]=counters();sql(`select public.workspace_save_review_draft('${c}','${d}',${rev},${ev},${q(draft)});`);[rev,ev]=counters();
  sql(`select public.workspace_publish_review('${c}','${d}',${rev},${ev});`);[rev,ev]=counters();
  const task=sql(`select public.workspace_reconcile_review_task('${c}',true,'fictional-questionnaire-review');`);
  const original=sql(`select state#>'{workflow,publication}' from public.workspace_cases where id='${c}';`);
  const complete=`perform public.workspace_complete_review_no_change('${c}','${d}',${rev},'${task}',${ev},'Reviewed fictional evidence');`;
  const report=`perform public.workspace_write_report('${c}','${r}','insert',null,${q({id:r,user_id:c,revision:1,state:'uploaded'})});`;
  await a.run(`begin;do $$ begin ${completionFirst?complete:report} end $$;`);
  const second=completionFirst ? report : `begin ${complete} raise exception 'TEST: stale review completed';exception when others then if sqlerrm not like '%changed evidence%' then raise;end if;end;`;
  const pending=b.run(`begin;do $$ begin ${second} end $$;commit;`);
  await blocked(b.name);await a.run('commit;');await pending;
  const tasks=JSON.parse(sql(`select jsonb_agg(to_jsonb(t)) from public.workspace_review_tasks t where case_id='${c}';`));
  const open=tasks.filter(t=>t.status==='open');assert.equal(open.length,1);
  assert.equal(open[0].target_evidence_revision,counters()[1]);
  assert.equal(open[0].owner_id,d);
  assert.equal(open[0].id===task,!completionFirst);
  assert.equal(tasks.find(t=>t.id===task).status,completionFirst?'completed':'open');
  assert.equal(sql(`select state#>'{workflow,publication}' from public.workspace_cases where id='${c}';`),original,'no-change/report race preserves approved plan');
 }
 console.log('Two forced no-change/report interleavings passed: stale completion rejects; later evidence opens a new task; prior care and review history survive.');
} finally {
 a?.close();b?.close();
 for(const c of cases) sql(`delete from public.workspace_cases where id='${c}';`);
 sql(`delete from public.workspace_staff where user_id='${d}';delete from public.workspace_clinics where id='${cl}';delete from auth.users where id='${d}';`);
}
