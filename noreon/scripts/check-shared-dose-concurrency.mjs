import assert from 'node:assert/strict';
import {spawn, execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
const container = process.env.NOREON_TEST_DB_CONTAINER;
const isolatedGithubRunner = process.env.GITHUB_ACTIONS === 'true' && (process.env.RUNNER_ENVIRONMENT === 'github-hosted' || (process.env.RUNNER_ENVIRONMENT === 'self-hosted' && process.env.NOREON_ISOLATED_CI_RUNNER === 'noreon-ci')) && process.env.GITHUB_REPOSITORY === 'noreon-health/noreon-core';
const ciReplay = isolatedGithubRunner && container === 'supabase_db_noreon-core';
if (!container || (!ciReplay && (container === 'supabase_db_noreon-core' || !/^supabase_db_noreon-.*replay$/.test(container)))) throw new Error('Set NOREON_TEST_DB_CONTAINER to an isolated replay container; the local primary database is forbidden.');
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

const d=randomUUID(),cl=randomUUID(),c=randomUUID(),run=randomUUID().replaceAll('-','');
let a,b;
try {
 sql(`insert into auth.users(id) values('${d}');insert into public.workspace_clinics(id,name) values('${cl}','Fictional dose race clinic');insert into public.workspace_staff(user_id,role,display_name,clinic_id) values('${d}','doctor','Fictional','${cl}');`);
 const due=sql(`select to_char(date_trunc('minute',now()) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"');`);
 const time=sql(`select to_char('${due}'::timestamptz at time zone 'Asia/Yerevan','HH24:MI');`);
 const draft={explanation:'Fictional',instructions:'Fictional approved plan',followUp:'',medicationName:'Example',medicationDose:'Example dose',medicationInstructions:'',medicationTimes:[time]};
 const workflow={revision:0,startedAt:new Date().toISOString(),tests:[],receivedTestIds:[],allResultsAt:new Date().toISOString(),consultation:'not-required',draft,draftSaved:false,publication:null};
 const state={userId:c,expiresAt:Date.now()+86400000,state:{consentAccepted:true,assessment:{completedAt:new Date().toISOString(),urgentRule:null}}};
 sql(`select public.workspace_create_case('${c}',${q(state)},'${d}');select public.workspace_initialize_workflow('${c}',0,${q(workflow)});`);
 const counters=()=>sql(`select revision||','||evidence_revision from public.workspace_cases where id='${c}';`).split(',').map(Number);
 let [rev,ev]=counters(); sql(`select public.workspace_save_review_draft('${c}','${d}',${rev},${ev},${q(draft)});`); [rev,ev]=counters();
 sql(`select public.workspace_publish_review('${c}','${d}',${rev},${ev});update public.workspace_cases set state=jsonb_set(state,'{workflow,medicationOrders,0,effectiveAt}',to_jsonb(now()-interval '1 hour')) where id='${c}';`);
 const report=(r,status,expected)=>`public.workspace_report_dose_versioned('${c}',${r},'workflow-plan-1','workflow-medication-1','${due}','${status}',${expected})`;
 [rev]=counters();sql(`select ${report(rev,'taken',0)};`);
 a=new Session(`dose_a_${run}`);b=new Session(`dose_b_${run}`);
 await a.run(`set application_name='${a.name}';`);await b.run(`set application_name='${b.name}';`);
 [rev]=counters();
 await a.run(`begin;select ${report(rev,'skipped',1)};`);
 const waiting=b.run(`do $$ begin perform ${report(rev,'taken',1)};raise exception 'TEST: concurrent correction accepted';exception when others then if sqlerrm<>'workspace case conflict' then raise;end if;end $$;`);
 await blocked(b.name);
 await a.run('commit;');await waiting;
 [rev]=counters();
 sql(`do $$ begin perform ${report(rev,'taken',1)};raise exception 'TEST: refreshed case accepted stale dose';exception when others then if sqlerrm<>'dose revision conflict' then raise;end if;end $$;`);
 const before=sql(`select jsonb_build_object('events',state#>'{care,events}','revision',revision) from public.workspace_cases where id='${c}';`);
 sql(`select ${report(rev,'skipped',1)};`);
 assert.equal(sql(`select jsonb_build_object('events',state#>'{care,events}','revision',revision) from public.workspace_cases where id='${c}';`),before,'unknown-response retry changes neither timestamp nor revisions');
 assert.equal(sql(`select string_agg(status,',' order by revision) from public.workspace_dose_event_history where case_id='${c}';`),'taken,skipped');
 console.log('Shared dose: forced row-lock race rejects concurrent overwrite; refreshed case still rejects stale dose; immediate network retry preserves state and audit.');
} finally {
 a?.close();b?.close();
 sql(`delete from public.workspace_cases where id='${c}';delete from public.workspace_staff where user_id='${d}';delete from auth.users where id='${d}';delete from public.workspace_clinics where id='${cl}';`);
}
