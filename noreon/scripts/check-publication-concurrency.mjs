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
const c=randomUUID(), d=randomUUID(), cl=randomUUID(), r=randomUUID();
const draft={explanation:'Evidence reviewed.',instructions:'Reviewed plan.',followUp:'',medicationName:'',medicationDose:'',medicationInstructions:'',medicationTimes:[]};
const workflow={version:1,revision:0,startedAt:'2026-10-11T00:00:00.000Z',questionnaireRevision:1,tests:[],bookings:[],receivedTestIds:[],allResultsAt:'2026-10-11T00:00:00Z',consultation:'not-required',appointment:null,draft,draftSaved:false,publication:null,events:[]};
const state={version:1,userId:c,expiresAt:Date.now()+86400000,measurements:[],state:{consentAccepted:true,profile:{name:'Fictional test'},assessment:{revision:1,completedAt:'2026-10-11T00:00:00Z',urgentRule:null}}};
const q=v=>`'${JSON.stringify(v).replaceAll("'","''")}'::jsonb`;
const record={id:r,user_id:c,revision:0,state:'confirmed',reviewed:{rows:[]},explanation:{summary:'Checked'}};
const storedRecord=record=>({...record,contentRevision:0,associations:[],associationHistory:[]});
const approval={revision:0,doctor:'Fictional',at:'2026-10-11T00:00:00Z',report:storedRecord(record)};
let a,b;
const extraCases=[];
try {
 sql(`insert into auth.users(id) values('${d}'); insert into public.workspace_clinics(id,name) values('${cl}','Fictional concurrency clinic'); insert into public.workspace_staff(user_id,role,display_name,clinic_id) values('${d}','doctor','Fictional','${cl}'); select public.workspace_create_case('${c}',${q(state)},'${d}'); select public.workspace_initialize_workflow('${c}',0,${q(workflow)}); select public.workspace_write_report('${c}','${r}','insert',null,${q(record)}); select public.workspace_write_report('${c}','${r}','approve',0,null,${q(approval)},'${d}');`);
 const revisions=()=>sql(`select revision||','||evidence_revision from public.workspace_cases where id='${c}';`).split(',').map(Number);
 const save=()=>{const [rev,ev]=revisions();sql(`select public.workspace_save_review_draft('${c}','${d}',${rev},${ev},${q(draft)});`);return revisions();};
 a=new Session('noreon_integrity_a'); b=new Session('noreon_integrity_b');
 await a.run("set application_name='noreon_integrity_a';");await b.run("set application_name='noreon_integrity_b';");
 // Publication holds case lock; report writer must wait. It then invalidates only the next review.
 let [rev,ev]=save();
 await a.run(`begin; select public.workspace_publish_review('${c}','${d}',${rev},${ev});`);
 let pending=b.run(`begin; select public.workspace_write_report('${c}','${r}','update',1,${q({...record,revision:1})},null,'${d}'); commit;`);
 await blocked(b.name); await a.run('commit;'); await pending;
 assert.equal(sql(`select published#>>'{approval,revision}' from public.workspace_case_reports where case_id='${c}';`),'0');
 assert.equal(revisions()[1],ev+1);
 // Report mutation first, publication waits and must reject the outdated association.
 const rec1={...record,revision:1};
 sql(`select public.workspace_write_report('${c}','${r}','approve',2,null,${q({...approval,revision:1,report:storedRecord(rec1)})},'${d}');`);
 [rev,ev]=save();
 await a.run(`begin; select public.workspace_write_report('${c}','${r}','update',3,${q({...record,revision:2})},null,'${d}');`);
 pending=b.run(`begin; do $$ begin perform public.workspace_publish_review('${c}','${d}',${rev},${ev}); raise exception 'TEST: stale publish accepted'; exception when others then if sqlerrm not like '%changed evidence%' then raise; end if; end $$; commit;`);
 await blocked(b.name); await a.run('commit;'); await pending;
 assert.equal(sql(`select state#>>'{workflow,publication,version}' from public.workspace_cases where id='${c}';`),'1');
 // Doctor deactivation locks staff; publishing waits, then rejects.
 sql(`select public.workspace_write_report('${c}','${r}','approve',4,null,${q({...approval,revision:2,report:storedRecord({...record,revision:2})})},'${d}');`);
 [rev,ev]=save();
 await a.run(`begin; update public.workspace_staff set active=false where user_id='${d}';`);
 pending=b.run(`begin; do $$ begin perform public.workspace_publish_review('${c}','${d}',${rev},${ev}); raise exception 'TEST: inactive doctor published'; exception when others then if sqlerrm not like '%active GP%' then raise; end if; end $$; commit;`);
 await blocked(b.name); await a.run('commit;');await pending;
 sql(`update public.workspace_staff set active=true where user_id='${d}';`);
 [rev,ev]=save();
 sql(`select public.workspace_publish_review('${c}','${d}',${rev},${ev});`);
 assert.equal(sql(`select state#>>'{workflow,publication,version}' from public.workspace_cases where id='${c}';`),'2');
 // Repeat both commit orders for every mutation boundary, with two approved reports.
 for (const kind of ['insert','update','delete','approve','questionnaire','assignment','doctor','clinic','expiry']) {
  for (const mutationFirst of [true,false]) {
   const id=randomUUID(), r2=randomUUID(), r3=randomUUID();extraCases.push(id);
   const baseRecord={...record,user_id:id};
   sql(`select public.workspace_create_case('${id}',${q({...state,userId:id})},'${d}'); select public.workspace_initialize_workflow('${id}',0,${q(workflow)});`);
   for(const rid of [r,r2]) {
    const item={...baseRecord,id:rid};
    sql(`select public.workspace_write_report('${id}','${rid}','insert',null,${q(item)}); select public.workspace_write_report('${id}','${rid}','approve',0,null,${q({...approval,report:storedRecord(item)})},'${d}');`);
   }
   const counters=()=>sql(`select revision||','||evidence_revision from public.workspace_cases where id='${id}';`).split(',').map(Number);
   let [cr,ce]=counters();sql(`select public.workspace_save_review_draft('${id}','${d}',${cr},${ce},${q(draft)});`);[cr,ce]=counters();
   const stored=JSON.parse(sql(`select state from public.workspace_cases where id='${id}';`));
   stored.state.assessment.revision=2;
   const commands={
    insert:`select public.workspace_write_report('${id}','${r3}','insert',null,${q({...baseRecord,id:r3})});`,
    update:`select public.workspace_write_report('${id}','${r}','update',1,${q({...baseRecord,revision:1})},null,'${d}');`,
    delete:`select public.workspace_write_report('${id}','${r}','delete',1);`,
    approve:`select public.workspace_write_report('${id}','${r}','approve',1,null,${q({...approval,at:'2026-10-11T01:00:00Z',report:storedRecord(baseRecord)})},'${d}');`,
    questionnaire:`select public.workspace_save_case('${id}',${cr},${q(stored)});`,
    assignment:`select public.workspace_assign_case('${id}',${cr},null);`,
    doctor:`update public.workspace_staff set active=false where user_id='${d}';`,
    clinic:`update public.workspace_clinics set active=false where id='${cl}';`,
    expiry:`update public.workspace_cases set expires_at=now()-interval '1 second' where id='${id}'; select public.workspace_delete_expired_case('${id}');`,
   };
   const publish=`perform public.workspace_publish_review('${id}','${d}',${cr},${ce});`;
   if(mutationFirst) {
    await a.run(`begin; ${commands[kind]}`);
    const expected=kind==='doctor'?'active GP':kind==='clinic'?'clinic is inactive':['questionnaire','assignment','expiry'].includes(kind)?'workspace case conflict':'changed evidence';
    pending=b.run(`begin; do $$ begin ${publish} raise exception 'TEST: publication accepted after ${kind}'; exception when others then if sqlerrm not like '%${expected}%' then raise; end if; end $$; commit;`);
    await blocked(b.name);await a.run('commit;');await pending;
    if(kind!=='expiry') assert.equal(sql(`select state#>>'{workflow,publication}' from public.workspace_cases where id='${id}';`),'');
   } else {
    await a.run(`begin; do $$ begin ${publish} end $$;`);
    // Member optimistic writes racing a publication reject; report writes have their own revisions.
    let mutation=commands[kind];
    if(kind==='questionnaire') mutation=`do $$ begin ${mutation} raise exception 'TEST: stale member write accepted'; exception when others then if sqlerrm not like '%workspace case conflict%' then raise; end if; end $$;`;
    pending=b.run(`begin; ${mutation} commit;`);
    await blocked(b.name);await a.run('commit;');await pending;
    if(kind!=='expiry') {
     assert.equal(sql(`select state#>>'{workflow,publication,version}' from public.workspace_cases where id='${id}';`),'1');
     assert.equal(sql(`select published#>>'{approval,revision}' from public.workspace_case_reports where case_id='${id}' and id='${r2}';`),'0');
    }
   }
   sql(`update public.workspace_staff set active=true where user_id='${d}'; update public.workspace_clinics set active=true where id='${cl}';`);
  }
 }
 console.log('18 additional forced interleavings passed: report insert/update/delete/approval, questionnaire, assignment, doctor/clinic deactivation and expiry, in both orders with multiple reports.');
 console.log('Forced lock interleavings passed: publish/report both orders, retained snapshots, stale rejection, doctor deactivation and refreshed retry.');
} finally {
 a?.close(); b?.close();
 for(const id of extraCases) sql(`begin; select 1 from public.workspace_cases where id='${id}' for update; delete from public.workspace_cases where id='${id}'; commit;`);
 sql(`begin; select 1 from public.workspace_cases where id='${c}' for update; delete from public.workspace_cases where id='${c}'; delete from public.workspace_staff where user_id='${d}'; delete from public.workspace_clinics where id='${cl}'; delete from auth.users where id='${d}'; commit;`);
}
