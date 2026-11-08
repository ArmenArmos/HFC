import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
const db=process.env.NOREON_TEST_DB_CONTAINER;
assert.ok(db?.startsWith('supabase_db_'),'Explicit local test database required');
const args=['exec','-i',db,'psql','-U','postgres','-X','-At','-v','ON_ERROR_STOP=1'];
const sql=s=>execFileSync('docker',args,{input:s,encoding:'utf8'}).trim();
const run=s=>new Promise((resolve,reject)=>{const p=spawn('docker',args);let out='',err='';p.stdout.on('data',c=>out+=c);p.stderr.on('data',c=>err+=c);p.on('error',reject);p.on('close',code=>code?reject(Error(err)):resolve(out.trim()));p.stdin.end(s);});
assert.equal(sql('select count(*) from public.workspace_admission_counters'),'0','Isolated admission counters must be empty');
try {
 for(const [operation,cap] of [['case',200],['upload',500]]) {
  sql(`select public.claim_workspace_admission('${operation}',lpad(to_hex(i),64,'0'),null) from generate_series(1,${cap-1}) i;`);
  const results=await Promise.all(['a','b'].map(x=>run(`select public.claim_workspace_admission('${operation}',repeat('${x}',64),null)=0`)));
  assert.deepEqual(results.sort(),['f','t'],`${operation}: only one final global slot`);
 }
 sql("select public.claim_workspace_admission('login',repeat('c',64),repeat('d',64)) from generate_series(1,7)");
 const login=await Promise.all([1,2].map(()=>run("select public.claim_workspace_admission('login',repeat('c',64),repeat('d',64))=0")));
 assert.deepEqual(login.sort(),['f','t'],'Login pair final slot admits one');
 console.log('Concurrent final-slot claims admit exactly one request for case/upload global caps and login pair.');
} finally {sql('delete from public.workspace_admission_counters');}
