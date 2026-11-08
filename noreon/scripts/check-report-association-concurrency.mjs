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
const c=randomUUID(),d=randomUUID(),cl=randomUUID(),r=randomUUID();
const state={userId:c,expiresAt:Date.now()+86400000,state:{consentAccepted:true,assessment:{completedAt:new Date().toISOString(),urgentRule:null}}};
const workflow={revision:0,publication:null,tests:[{id:'lipid',method:'lab'}],requirements:[{requirementId:'req-1',retiredAtRevision:null,test:{id:'lipid',method:'lab'}}],receivedTestIds:[]};
const report={id:r,user_id:c,revision:0,state:'confirmed',reviewed:{rows:[{name:'Fictional LDL',literal:'3.2'}]}};
let a,b;
try {
 sql(`insert into auth.users(id) values('${d}');insert into public.workspace_clinics(id,name) values('${cl}','Fictional association race');insert into public.workspace_staff(user_id,role,display_name,clinic_id) values('${d}','doctor','Fictional reviewer','${cl}');select public.workspace_create_case('${c}',${q(state)},'${d}');select public.workspace_initialize_workflow('${c}',0,${q(workflow)});select public.workspace_write_report('${c}','${r}','insert',null,${q(report)});`);
 a=new Session('noreon_association_a');b=new Session('noreon_association_b');
 await a.run("set application_name='noreon_association_a';");await b.run("set application_name='noreon_association_b';");
 const evidence=()=>Number(sql(`select evidence_revision from public.workspace_cases where id='${c}';`));
 const current=()=>JSON.parse(sql(`select record from public.workspace_case_reports where case_id='${c}' and id='${r}';`));
 let ev=evidence();
 await a.run(`begin;select public.workspace_associate_report('${c}','${r}','${d}',${ev},0,'req-1',array[0]);`);
 let pending=b.run(`begin;do $$ begin perform public.workspace_write_report('${c}','${r}','update',0,${q({...report,reviewed:{rows:[{name:'Fictional LDL',literal:'3.4'}]}})},null,'${d}');raise exception 'TEST: stale edit accepted';exception when others then if sqlerrm not like '%conflict%' then raise;end if;end $$;commit;`);
 await blocked(b.name);await a.run('commit;');await pending;
 assert.equal(current().associations.length,1);
 const edited={...current(),reviewed:{rows:[{name:'Fictional LDL',literal:'3.4'}]}};
 ev=evidence();
 await a.run(`begin;select public.workspace_write_report('${c}','${r}','update',1,${q(edited)},null,'${d}');`);
 pending=b.run(`begin;do $$ begin perform public.workspace_associate_report('${c}','${r}','${d}',${ev},1,'req-1',array[0]);raise exception 'TEST: stale association accepted';exception when others then if sqlerrm not like '%conflict%' then raise;end if;end $$;commit;`);
 await blocked(b.name);await a.run('commit;');await pending;
 assert.equal(current().associations.length,0);assert.equal(current().associationHistory[0].reason,'content-changed');
 assert.equal(current().contentRevision,1);
 console.log('Forced association/content-edit interleavings reject stale writes in both orders; content change retains attributed history and no active stale link.');
} finally {
 a?.close();b?.close();
 sql(`begin;select 1 from public.workspace_cases where id='${c}' for update;delete from public.workspace_cases where id='${c}';delete from public.workspace_staff where user_id='${d}';delete from auth.users where id='${d}';delete from public.workspace_clinics where id='${cl}';commit;`);
}
