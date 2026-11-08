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
const c=randomUUID(),d=randomUUID(),cl=randomUUID(),req=randomUUID(),sub=randomUUID();
const draft={explanation:'Reviewed',instructions:'Fictional plan',followUp:'',medicationName:'',medicationDose:'',medicationInstructions:'',medicationTimes:[]};
const state={userId:c,expiresAt:Date.now()+86400000,state:{consentAccepted:true,profile:{userId:c},assessment:{completedAt:new Date().toISOString(),urgentRule:null}},measurements:[]};
const workflow={revision:0,startedAt:new Date().toISOString(),publication:null,tests:[],receivedTestIds:[],allResultsAt:new Date().toISOString(),consultation:'not-required',draft,draftSaved:false};
const current=()=>JSON.parse(sql(`select jsonb_build_object('revision',revision,'evidence',evidence_revision) from public.workspace_cases where id='${c}';`));
let a,b;
try {
 sql(`insert into auth.users(id) values('${d}');insert into public.workspace_clinics(id,name) values('${cl}','Fictional monitoring race');insert into public.workspace_staff(user_id,role,display_name,clinic_id) values('${d}','doctor','Fictional reviewer','${cl}');select public.workspace_create_case('${c}',${q(state)},'${d}');select public.workspace_initialize_workflow('${c}',0,${q(workflow)});`);
 let now=current();sql(`select public.workspace_save_review_draft('${c}','${d}',${now.revision},${now.evidence},${q(draft)});`);now=current();sql(`select public.workspace_publish_review('${c}','${d}',${now.revision},${now.evidence});`);now=current();
 sql(`select public.workspace_create_monitoring('${c}','${d}',${now.revision},${now.evidence},'${req}',now()+interval '1 hour',now()+interval '2 hours',2,'Fictional race requirement');update public.workspace_monitoring_requirements set created_at=now()-interval '3 hours',starts_at=now()-interval '2 hours',ends_at=now()-interval '1 hour' where id='${req}';`);
 a=new Session('noreon_monitoring_a');b=new Session('noreon_monitoring_b');await a.run("set application_name='noreon_monitoring_a';");await b.run("set application_name='noreon_monitoring_b';");
 await a.run(`begin;select public.workspace_reconcile_monitoring('${c}');`);
 let pending=b.run(`begin;select public.workspace_reconcile_monitoring('${c}');commit;`);await blocked(b.name);await a.run('commit;');await pending;
 assert.equal(sql(`select count(*) from public.workspace_followup_review_links where requirement_id='${req}' and event='window-ended';`),'1');
 const measured=new Date(Date.now()-90*60000).toISOString(),ev=current().evidence;
 const accept=`select public.workspace_accept_reading('${c}','${sub}','${measured}',120,80,null);`;
 await a.run(`begin;${accept}`);pending=b.run(`begin;${accept}commit;`);await blocked(b.name);await a.run('commit;');await pending;
 assert.equal(current().evidence,ev+1);assert.equal(sql(`select count(*) from public.workspace_accepted_readings where case_id='${c}';`),'1');
 now=current();await a.run(`begin;select public.workspace_cancel_monitoring('${c}','${d}',${now.revision},'${req}','Fictional cancellation');`);
 pending=b.run(`begin;select public.workspace_accept_reading('${c}','${randomUUID()}','${measured}',121,80,null);commit;`);await blocked(b.name);await a.run('commit;');await pending;
 assert.equal(sql(`select count(*) from public.workspace_monitoring_evidence where requirement_id='${req}';`),'1');assert.equal(sql(`select status from public.workspace_followup_work where requirement_id='${req}';`),'cancelled');
 console.log('Forced concurrent dispatch, duplicate acceptance and cancel-before-reading preserve one review event, one evidence increment and frozen cancelled evidence.');
}finally{a?.close();b?.close();sql(`begin;select 1 from public.workspace_cases where id='${c}' for update;delete from public.workspace_cases where id='${c}';delete from public.workspace_staff where user_id='${d}';delete from auth.users where id='${d}';delete from public.workspace_clinics where id='${cl}';commit;`);}
