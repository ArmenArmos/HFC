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
 sql(`insert into auth.users(id) values('${d}');insert into public.workspace_clinics(id,name) values('${cl}','Fictional continuity race clinic');insert into public.workspace_staff(user_id,role,display_name,clinic_id) values('${d}','doctor','Fictional','${cl}');`);
 a=new Session('noreon_care_a');b=new Session('noreon_care_b');
 await a.run(`set application_name='${a.name}';`);await b.run(`set application_name='${b.name}';`);
 for(const kind of ['dose','acknowledgement']) for(const publicationFirst of [true,false]) {
  const c=randomUUID();cases.push(c);
  const due=sql(`select to_char(date_trunc('minute',now()) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"');`);
  const time=sql(`select to_char('${due}'::timestamptz at time zone 'Asia/Yerevan','HH24:MI');`);
  const draft={explanation:'Fictional',instructions:'Fictional approved plan',followUp:'',medicationName:'Example',medicationDose:'Example dose',medicationInstructions:'',medicationTimes:[time]};
  const workflow={revision:0,startedAt:new Date().toISOString(),tests:[],receivedTestIds:[],allResultsAt:new Date().toISOString(),consultation:'not-required',draft,draftSaved:false,publication:null};
  const state={userId:c,expiresAt:Date.now()+86400000,state:{consentAccepted:true,assessment:{completedAt:new Date().toISOString(),urgentRule:null}}};
  sql(`select public.workspace_create_case('${c}',${q(state)},'${d}');select public.workspace_initialize_workflow('${c}',0,${q(workflow)});`);
  const counters=()=>sql(`select revision||','||evidence_revision from public.workspace_cases where id='${c}';`).split(',').map(Number);
  let [rev,ev]=counters();sql(`select public.workspace_save_review_draft('${c}','${d}',${rev},${ev},${q(draft)});`);[rev,ev]=counters();
  sql(`select public.workspace_publish_review('${c}','${d}',${rev},${ev});update public.workspace_cases set state=jsonb_set(state,'{workflow,medicationOrders,0,effectiveAt}',to_jsonb(now()-interval '1 hour')) where id='${c}';`);
  [rev,ev]=counters();
  const member=(r,version)=>kind==='dose' ? `perform public.workspace_report_dose('${c}',${r},'workflow-plan-${version}','workflow-medication-1','${due}','taken');` : `perform public.workspace_acknowledge_plan('${c}',${r},'workflow-plan-${version}');`;
  const publish=r=>`perform public.workspace_publish_review('${c}','${d}',${r},${ev});`;
  const first=publicationFirst ? publish(rev) : member(rev,1);
  const second=publicationFirst ? member(rev,1) : publish(rev);
  await a.run(`begin;do $$ begin ${first} end $$;`);
  const pending=b.run(`begin;do $$ begin ${second} raise exception 'TEST: stale racing write accepted';exception when others then if sqlerrm not like '%workspace case conflict%' then raise;end if;end $$;commit;`);
  await blocked(b.name);await a.run('commit;');await pending;
  let saved=JSON.parse(sql(`select state from public.workspace_cases where id='${c}';`));
  assert.equal(saved.workflow.publication.version,publicationFirst ? 2 : 1);
  if(!publicationFirst) {
    if(kind==='dose') assert.equal(saved.care.events[0].planId,'workflow-plan-1');
    else assert.equal(saved.care.acknowledgements[0].planId,'workflow-plan-1');
  }
  [rev,ev]=counters();
  sql(`do $$ begin ${publicationFirst ? member(rev,2) : publish(rev)} end $$;`);
  saved=JSON.parse(sql(`select state from public.workspace_cases where id='${c}';`));
  assert.equal(saved.workflow.publication.version,2);
  const expectedPlan=publicationFirst ? 'workflow-plan-2' : 'workflow-plan-1';
  if(kind==='dose') {assert.equal(saved.care.events.length,1);assert.equal(saved.care.events[0].planId,expectedPlan);}
  else {assert.equal(saved.care.acknowledgements.length,1);assert.equal(saved.care.acknowledgements[0].planId,expectedPlan);}
  assert.equal(counters()[1],ev,'care races do not alter clinical evidence');
 }
 console.log('Four forced lock interleavings passed: publication versus dose and acknowledgement in both orders; stale writes reject, refreshed retries preserve original plan context.');
} finally {
 a?.close();b?.close();
 for(const c of cases) sql(`delete from public.workspace_cases where id='${c}';`);
 sql(`delete from public.workspace_staff where user_id='${d}';delete from public.workspace_clinics where id='${cl}';delete from auth.users where id='${d}';`);
}
