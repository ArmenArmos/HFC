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
const c=randomUUID(),r=randomUUID(),other=randomUUID();
const state={userId:c,expiresAt:Date.now()+86400000};
const record=(id,path=randomUUID())=>({id,user_id:c,checksum:'a'.repeat(64),object_path:`${c}/${id}/${path}`,state:'needs_review',revision:0,extraction:{source:'original'}});
const first=record(r),second=record(other);
let a,b;
try {
 sql(`select public.workspace_create_case('${c}',${q(state)},null);`);
 a=new Session('noreon_report_dedupe_a');b=new Session('noreon_report_dedupe_b');
 await a.run(`set application_name='${a.name}';`);await b.run(`set application_name='${b.name}';`);
 const evidence=()=>Number(sql(`select evidence_revision from public.workspace_cases where id='${c}';`));
 const current=()=>JSON.parse(sql(`select record from public.workspace_case_reports where case_id='${c}' and id='${r}';`));
 const ev=evidence();
 await a.run(`begin;select public.workspace_write_report('${c}','${r}','insert',null,${q(first)});`);
 let pending=b.run(`begin;do $$ begin perform public.workspace_write_report('${c}','${other}','insert',null,${q(second)});raise exception 'TEST: concurrent duplicate accepted';exception when unique_violation then if sqlerrm<>'duplicate' then raise;end if;end $$;commit;`);
 await blocked(b.name);await a.run('commit;');await pending;
 assert.equal(sql(`select count(*) from public.workspace_case_reports where case_id='${c}';`),'1');
 assert.equal(evidence(),ev+1,'Only the winning upload changes evidence');
 const original=current();
 assert.equal(original.object_path,first.object_path);
 // A same-ID replay blocks behind the original and returns it without replacing source content.
 await a.run(`begin;select 1 from public.workspace_cases where id='${c}' for update;`);
 pending=b.run(`begin;select public.workspace_write_report('${c}','${r}','insert',null,${q({...record(r),extraction:{source:'retry'}})});commit;`);
 await blocked(b.name);await a.run('commit;');await pending;
 assert.deepEqual(current(),original);assert.equal(evidence(),ev+1);
 // Cleanup waits for a concurrent insert, then refuses its now-live object.
 const c2=randomUUID(),r2=randomUUID(),live={...record(r2),user_id:c2,object_path:`${c2}/${r2}/${randomUUID()}`};
 sql(`select public.workspace_create_case('${c2}',${q({userId:c2,expiresAt:Date.now()+86400000})},null);`);
 try {
  await a.run(`begin;select public.workspace_write_report('${c2}','${r2}','insert',null,${q(live)});`);
  pending=b.run(`begin;select public.workspace_write_report('${c2}','${r2}','discard-upload',null,${q({object_path:live.object_path})});commit;`);
  await blocked(b.name);await a.run('commit;');await pending;
  assert.equal(sql(`select count(*) from public.workspace_report_cleanup where object_path='${live.object_path}';`),'0');
 } finally {sql(`delete from public.workspace_cases where id='${c2}';delete from public.workspace_report_cleanup where object_path like '${c2}/%';`);}
 // Reupload waits for deletion, then succeeds with a fresh ID/path. Old path alone is queued.
 await a.run(`begin;select public.workspace_write_report('${c}','${r}','delete',0);`);
 pending=b.run(`begin;select public.workspace_write_report('${c}','${other}','insert',null,${q(second)});commit;`);
 await blocked(b.name);await a.run('commit;');await pending;
 assert.equal(sql(`select count(*) from public.workspace_case_reports where case_id='${c}';`),'1');
 assert.equal(sql(`select id from public.workspace_case_reports where case_id='${c}';`),other);
 assert.equal(sql(`select count(*) from public.workspace_report_cleanup where object_path='${first.object_path}';`),'1');
 assert.equal(sql(`select count(*) from public.workspace_report_cleanup where object_path='${second.object_path}';`),'0');
 console.log('Forced concurrent checksum duplicates and same-ID retries serialize without evidence churn; cleanup cannot remove a live concurrent insert; delete/reupload queues only the old path.');
} finally {
 a?.close();b?.close();
 sql(`delete from public.workspace_cases where id='${c}';delete from public.workspace_report_cleanup where object_path like '${c}/%';`);
}
