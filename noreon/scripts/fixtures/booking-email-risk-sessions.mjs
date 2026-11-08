/** Owned test-only deterministic scheduling; originals are restored byte-for-byte. */
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
const quote=s=>`'${String(s).replaceAll("'","''")}'`;
export function riskSessions(container){
 const args=['exec','-i',container,'psql','-U','postgres','-X','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'];
 const sql=text=>execFileSync('docker',args,{input:text,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
 const m2='b2000000-0000-4000-8000-000000000002',nurse='b2000000-0000-4000-8000-000000000005';
 const claims=id=>`set request.jwt.claim.sub=${quote(id)};set request.jwt.claims=${quote(JSON.stringify({sub:id,role:'authenticated',session_id:id,amr:[{method:'password'}]}))};set role service_role;`;
 function session(text='',name=''){
  const child=spawn('docker',args);let out='',err='';let readyResolve;
  const ready=new Promise(resolve=>{readyResolve=resolve;});
  child.stdout.on('data',data=>{out+=data;if(out.includes('BEP_GATE_HELD'))readyResolve();});child.stderr.on('data',data=>{err+=data;});
  const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>resolve({code,out,err}));});
  child.stdin.write(`set statement_timeout='8s';set application_name=${quote(name)};\n`+text);
  return {child,ready,done};
 }
 const run=(text,name='')=>{const s=session(text,name);s.child.stdin.end();return s.done;};
 async function waitAdvisory(name){
  for(let i=0;i<80;i++){
   if(sql(`select exists(select 1 from pg_stat_activity where application_name=${quote(name)}and wait_event_type='Lock'and wait_event='advisory')`)==='t')return;
   await new Promise(resolve=>setTimeout(resolve,30));
  }
  throw Error('Expected ordered advisory wait was not reached');
 }
 async function withFixture(fixture,extra,fn){
  assert.equal(sql("select count(*)from auth.users where id::text like 'b2000000-%'"),'0','Risk fixture IDs must be unused');
  const originalCopy=JSON.parse(sql('select row_to_json(s)from public.workspace_scheduling_settings s where id'));
  const restores=[];const children=[];
  try{
   sql(fixture+'\n'+extra+'\ncommit;');
   const pause=(kind,name,key)=>{
    const actor=kind==='actor';
    const target=actor?'_booking_assert_actor':'_legacy_command_patient_test_request';
    const types=actor?'uuid,uuid':'uuid,uuid,boolean,uuid,bigint,uuid,text,jsonb';
    const saved=actor?'_bep_saved_actor':'_bep_saved_legacy';
    const original=sql(`select pg_get_functiondef('public.${target}(${types})'::regprocedure)`);
    const copy=original.replace(`FUNCTION public.${target}(`,`FUNCTION public.${saved}(`);assert.notEqual(copy,original);
    const gate=`if current_setting('application_name')=${quote(name)}and current_setting('bep.pause_once',true)is distinct from '1'then perform set_config('bep.pause_once','1',true);perform pg_advisory_xact_lock(${key}::bigint);end if;`;
    const definition=actor?`create or replace function public.${target}(p_member uuid,p_actor uuid)returns void language plpgsql volatile security definer set search_path=''as $$begin perform public.${saved}(p_member,p_actor);${gate}end$$;`
     :`create or replace function public.${target}(p_user_id uuid,p_actor uuid,p_staff boolean,p_id uuid,p_revision bigint,p_command_id uuid,p_operation text,p_input jsonb)returns jsonb language plpgsql security definer set search_path=''as $$begin ${gate}return public.${saved}(p_user_id,p_actor,p_staff,p_id,p_revision,p_command_id,p_operation,p_input);end$$;`;
    restores.push({original,saved,types,target});
    sql(`begin;${copy};revoke all on function public.${saved}(${types})from public,anon,authenticated,service_role;${definition}commit;`);
    return createHash('sha256').update(original).digest('hex');
   };
   const hold=async key=>{const s=session(`begin;select pg_advisory_xact_lock(${key}::bigint);\n\\echo BEP_GATE_HELD\n`,'bep_gate_holder');children.push(s);await s.ready;return s;};
   await fn({sql,run,waitAdvisory,pause,hold,claims,m2,nurse,children});
  }finally{
   for(const s of children){if(!s.child.stdin.destroyed&&!s.child.stdin.writableEnded)s.child.stdin.end('rollback;\n');await s.done;}
   for(const r of restores.reverse()){
    sql(r.original+`;drop function if exists public.${r.saved}(${r.types});`);
    assert.equal(sql(`select pg_get_functiondef('public.${r.target}(${r.types})'::regprocedure)`),r.original,'Instrumented production definition must be restored exactly');
   }
   sql(`begin;
delete from public.booking_legacy_conversions where legacy_id::text like 'b2000000-%';
delete from public.booking_appointment_events where appointment_id::text like 'b2000000-%';
delete from public.booking_appointment_commands where member_id::text like 'b2000000-%';
delete from public.booking_appointment_versions where appointment_id::text like 'b2000000-%';
delete from public.booking_notice_attempts where notice_id::text like 'b2000000-%';
delete from public.booking_scheduling_notices where appointment_id::text like 'b2000000-%';
delete from public.booking_manual_reservations where member_id::text like 'b2000000-%';
delete from public.booking_appointments where member_id::text like 'b2000000-%';
delete from public.booking_offer_snapshots where created_by::text like 'b2000000-%';
delete from public.booking_manual_capacity where created_by::text like 'b2000000-%';
delete from public.booking_program_seals where member_id::text like 'b2000000-%';
delete from public.patient_test_request_events where request_id::text like 'b2000000-%';
delete from public.patient_test_requests where user_id::text like 'b2000000-%';
delete from public.patient_clinical_case_events where user_id::text like 'b2000000-%';
delete from public.patient_clinical_cases where user_id::text like 'b2000000-%';
delete from public.workspace_staff where user_id::text like 'b2000000-%';
delete from public.workspace_clinics where id::text like 'b2000000-%';
delete from auth.users where id::text like 'b2000000-%';
update public.workspace_scheduling_settings set copy_email=${originalCopy.copy_email===null?'null':quote(originalCopy.copy_email)},revision=${originalCopy.revision} where id;commit;`);
  }
 }
 function secondMember({legacy=false,confirmed=false,nurseActor=false}={}){
  let text=`select public.register_manual_booking_offer('b2000000-0000-4000-8000-000000000003',jsonb_set(jsonb_set(jsonb_set(jsonb_set(offer,'{id}','"b2000000-0000-4000-8000-000000000031"'),'{startsAt}',to_jsonb(now()+interval '3 days')),'{endsAt}',to_jsonb(now()+interval '3 days 1 hour')),'{reservationContract,reference}','"synthetic-second-capacity"'),1,now()+interval '30 minutes')from email_offer;\n`;
  if(legacy){
   text+=`select public._legacy_create_patient_test_request('${m2}','b2000000-0000-4000-8000-000000000040',public.patient_test_context('${m2}')->>'token',jsonb_build_object('startsAt',now()+interval '2 days','timezone','Asia/Yerevan','mode','office','location','Original synthetic office'),(select jsonb_agg(jsonb_build_object('id',i->>'id','title',i->>'title','method',i->>'method'))from public.booking_program_seals s cross join lateral jsonb_array_elements(s.program->'items')i where s.id='b2000000-0000-4000-8000-000000000020'and i->>'method'<>'home-log'),'synthetic-engine-v1');\n`;
   if(confirmed)text+=`select public.command_patient_test_request('${m2}','b2000000-0000-4000-8000-000000000003',true,'b2000000-0000-4000-8000-000000000040',0,'b2000000-0000-4000-8000-000000000060','confirm',jsonb_build_object('provider','Original synthetic provider','terms',jsonb_build_object('startsAt',now()+interval '2 days','endsAt',now()+interval '2 days 1 hour','timezone','Asia/Yerevan','mode','office','location','Original synthetic office'),'obtainedAt',now(),'channel','phone','source','Original attributed synthetic source','preparation','Original preparation','engine',jsonb_build_object('sourceToken',public.patient_test_context('${m2}')->>'token','version','synthetic-engine-v1','tests',(select requirements from public.patient_test_requests where id='b2000000-0000-4000-8000-000000000040'))));
select public.command_patient_test_request('${m2}','${m2}',false,'b2000000-0000-4000-8000-000000000040',1,'b2000000-0000-4000-8000-000000000061','accept',jsonb_build_object('engine',jsonb_build_object('sourceToken',public.patient_test_context('${m2}')->>'token','version','synthetic-engine-v1','tests',(select requirements from public.patient_test_requests where id='b2000000-0000-4000-8000-000000000040'))));\n`;
  }
  text+=`insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id)values('${m2}','b2000000-0000-4000-8000-000000000004','${nurse}')on conflict(user_id)do update set assigned_doctor_id=excluded.assigned_doctor_id,assigned_nurse_id=excluded.assigned_nurse_id;\n`;
  if(nurseActor)text+=`select pg_temp.email_actor('${nurse}');\n`;
  const actor=nurseActor?nurse:m2;
  text+=`select public.register_booking_program('b2000000-0000-4000-8000-000000000022','${m2}','${actor}',jsonb_build_object('memberId','${m2}','sourceToken',public.patient_test_context('${m2}')->>'token','requirementsToken',public.patient_test_context('${m2}')->>'requirementsToken','engineVersion','synthetic-engine-v1','items',(select program->'items'from public.booking_program_seals where id='b2000000-0000-4000-8000-000000000020')));\n`;
  return text;
 }
 const selectSecond=(actor=m2,legacy=false)=>`select public.select_booking_appointment('b2000000-0000-4000-8000-000000000024','${m2}','${actor}','b2000000-0000-4000-8000-000000000022','b2000000-0000-4000-8000-000000000031','source-v1',p_agreement_source=>'Synthetic approved member agreement'${legacy?",p_legacy_id=>'b2000000-0000-4000-8000-000000000040'":''},p_sender_email=>'noreon@example.invalid',p_template_version=>'synthetic-approved-v1',p_subject=>'Synthetic second schedule',p_text_content=>'Synthetic approved second content')`;
 return {withFixture,secondMember,selectSecond};
}
