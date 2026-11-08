import {readdirSync,readFileSync,existsSync,statSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {availableParallelism} from 'node:os';
const sql=process.argv.includes('--sql');
const container=process.env.NOREON_TEST_DB_CONTAINER;
// The primary local database (supabase_db_noreon-core) holds a developer's own data: only the
// isolated CI replay may use that name (the same rule as check-shared-dose-concurrency.mjs).
// Lanes use their own container from output/workflow-tools/lane-ports.mjs.
const isolatedCi=process.env.GITHUB_ACTIONS==='true'&&(process.env.RUNNER_ENVIRONMENT==='github-hosted'||(process.env.RUNNER_ENVIRONMENT==='self-hosted'&&process.env.NOREON_ISOLATED_CI_RUNNER==='noreon-ci'))&&process.env.GITHUB_REPOSITORY==='noreon-health/noreon-core';
if(!container?.startsWith('supabase_db_')||(container==='supabase_db_noreon-core'&&!isolatedCi))throw Error('Set NOREON_TEST_DB_CONTAINER to an isolated local Supabase container; the local primary database is forbidden outside isolated CI.');
const files=readdirSync('scripts').filter(f=>f.startsWith('check-')&&f.endsWith(sql?'.sql':'.ts')).sort();
let failed=0;const failures=[];
if(sql){
 for(const file of files){
  console.log(`Checking ${file}`);
  const result=spawnSync('docker',['exec','-i',container,'psql','-U','postgres','-X','-v','ON_ERROR_STOP=1'],{input:readFileSync(`scripts/${file}`),stdio:['pipe','inherit','inherit']});
  if(result.error)console.error(result.error.message);
  if(result.status!==0){
   failed++;failures.push(file);
   // Evidence for lock or ordering failures: any other open session on the CI database.
   spawnSync('docker',['exec','-i',container,'psql','-U','postgres','-X','-At','-c',"select 'other session: '||pid||' '||coalesce(state,'')||' since '||coalesce(xact_start::text,'-')||' '||left(regexp_replace(coalesce(query,''),'\\s+',' ','g'),160) from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid() and backend_type='client backend'"],{stdio:['ignore','inherit','inherit']});
  }
 }
}else{
 // Checks that touch the shared database, start processes or open local ports
 // (directly or through imports) run one at a time; the rest are pure and run in parallel. Output is
 // buffered per check so logs stay readable.
 // A check counts as shared when it or anything it imports (relative or @/
 // paths, followed transitively) mentions one of these.
 const shared=/NOREON_TEST_DB_CONTAINER|docker|psql|spawn|execFile|127\.0\.0\.1|localhost:/;
 const memo=new Map();
 const touches=file=>{
  if(memo.has(file))return memo.get(file);
  memo.set(file,false);
  const text=readFileSync(file,'utf8');
  let hit=shared.test(text);
  for(const [,spec] of text.matchAll(/from\s+['"]((?:\.{1,2}\/|@\/)[^'"]+)['"]/g)){
   if(hit)break;
   const base=spec.startsWith('@/')?spec.slice(2):join(dirname(file),spec);
   const found=[base,`${base}.ts`,`${base}.tsx`,`${base}.mjs`,`${base}.js`,join(base,'index.ts')].find(c=>existsSync(c)&&statSync(c).isFile());
   if(found)hit=touches(found);
  }
  memo.set(file,hit);
  return hit;
 };
 const serial=files.filter(f=>touches(`scripts/${f}`));
 const parallel=files.filter(f=>!serial.includes(f));
 const args=f=>['--disable-warning=DEP0205','--disable-warning=MODULE_TYPELESS_PACKAGE_JSON','--conditions=noreon-server-test','--import','./scripts/register-alias.mjs',`scripts/${f}`];
 const env={...process.env,NOREON_VALIDATE_AI:'false'};
 const run=f=>new Promise(resolve=>{
  const child=spawn(process.execPath,args(f),{env});
  let out='';
  child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>out+=b);
  child.on('error',e=>{out+=e.message;});
  child.on('close',code=>{process.stdout.write(`Checking ${f}\n${out}`);if(code!==0){failed++;failures.push(f);}resolve();});
 });
 const queue=[...parallel];
 const workers=Math.max(1,Math.min(Number(process.env.NOREON_CHECK_JOBS)||availableParallelism(),8));
 await Promise.all(Array.from({length:workers},async()=>{while(queue.length)await run(queue.shift());}));
 for(const f of serial)await run(f);
}
console.log(`${files.length} checks; ${failed} failed.`);
if(failures.length)console.log(`Failed: ${failures.sort().join(', ')}`);
process.exitCode=failed?1:0;
