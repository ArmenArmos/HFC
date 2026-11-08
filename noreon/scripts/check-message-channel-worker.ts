import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {runMessageWorker,type MessageWorkerStore} from '@/lib/messaging/worker';
import {parseTwilioConfig,submitPlanMessage,twilioAvailableChannels} from '@/lib/messaging/twilio';
const container=process.env.NOREON_TEST_DB_CONTAINER;
// Explicitly owned verification databases only; all fixtures roll back.
if(container!=='supabase_db_noreon-trello-overnight'&&container!=='supabase_db_noreon-mvp-combined-replay-20261014'&&container!=='supabase_db_noreon-twilio-hook-replay'&&container!=='supabase_db_noreon-core'&&container!=='supabase_db_noreon-real-booking-verification-2026101'&&container!=='supabase_db_noreon-clinic-settings-qa')throw Error('Isolated test container required');
// One PostgreSQL session and transaction: actual admission/finish functions, then rollback.
const child=spawn('docker',['exec','-i',container,'psql','-U','postgres','-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1']);
let buffer='',pending:((value:string)=>void)|null=null,rejectPending:((reason:Error)=>void)|null=null;
child.stdout.on('data',value=>{buffer+=String(value);const marker=buffer.indexOf('__CHANNEL_END__\n');if(marker>=0&&pending){const body=buffer.slice(0,marker);buffer=buffer.slice(marker+16);pending(body.trim());pending=null;rejectPending=null;}});
child.stderr.on('data',value=>{if(rejectPending)rejectPending(Error(String(value)));});
child.on('exit',code=>{if(code&&rejectPending)rejectPending(Error('SQL session failed'));});
async function sql(query:string):Promise<string>{return await new Promise((resolve,reject)=>{pending=resolve;rejectPending=reject;child.stdin.write(query+'\n\\echo __CHANNEL_END__\n');});}
const ids=[randomUUID(),randomUUID()],plans=[randomUUID(),randomUUID()];
const config=parseTwilioConfig({accountSid:'AC'+'1'.repeat(32),apiKeySid:'SK'+'2'.repeat(32),apiKeySecret:'fictional-test-secret',smsFrom:'Noreon',appUrl:'https://app.example.com',callbackUrl:'https://app.example.com/callback'});
const available=twilioAvailableChannels(config,{NOREON_TWILIO_SMS_READY:'true'});assert.deepEqual(available,['sms']);
try{
 await sql(`begin; select public.configure_patient_message_spend((select revision from public.patient_message_spend_policy where id=1),' {"enabled":true,"currency":"USD","daily_limit_micros":5000000,"sms_segment_ceiling_micros":1000,"whatsapp_message_ceiling_micros":1000,"max_sms_segments":3,"allowed_prefixes":["+374"]}'::jsonb||jsonb_build_object('valid_until',clock_timestamp()+interval '1 day'),'test-operator');`);
 for(let i=0;i<2;i++)await sql(`insert into auth.users(id,phone,phone_confirmed_at)values('${ids[i]}','3749900022${i}',now()); update public.profiles set display_name='Synthetic channel check',birth_date='1980-01-01',biological_sex='female',locale='en' where id='${ids[i]}'; insert into public.patient_consents(user_id,version)values('${ids[i]}','patient-pilot-v1'); insert into public.patient_message_preferences(user_id,revision,channel,verified_phone,consent_version,consented_at)values('${ids[i]}',1,'${i===0?'whatsapp':'sms'}','+3749900022${i}','messaging-service-v1',clock_timestamp()-interval '1 minute'); insert into public.patient_reminder_preferences(user_id,revision,preferences)values('${ids[i]}',1,'{"medicationEnabled":true,"medicationOffsetMinutes":0,"bpEnabled":false,"bpTimes":["08:00"],"quietStart":"00:00","quietEnd":"00:00"}'); insert into public.patient_care_plans(id,user_id,clinician,instructions,published_at)values('${plans[i]}','${ids[i]}','Synthetic clinician','Local test only',now()); select public.enqueue_patient_plan_message('${plans[i]}');`);
 const jobs=JSON.parse(await sql(`select json_agg(id order by channel desc) from public.patient_message_outbox where user_id in('${ids[0]}','${ids[1]}');`)) as string[];
 const revision=Number(await sql('select revision from public.patient_message_spend_policy where id=1;'));
 let requests=0;
 const store:MessageWorkerStore={sweep:async()=>0,sources:async()=>[],claimSource:async()=>null,completeSource:async()=>false,enqueue:async()=>null,queued:async()=>jobs,
  begin:async job=>{const value=JSON.parse(await sql(`select coalesce(json_agg(r),'[]'::json) from public.begin_patient_message_submission_budgeted('${job}',${revision},array['sms'])r;`));return value[0]?{attemptId:value[0].attempt_id,destination:value[0].destination,channel:value[0].channel,locale:value[0].locale}:null;},
  finish:async(id,status,reference)=>(await sql(`select public.finish_patient_message_submission('${id}','${status}',${reference?"'"+reference+"'":'null'});`))==='t',attempt:async()=>null,record:async()=>true};
 const result=await runMessageWorker(store,input=>submitPlanMessage(config,input,{messages:{create:async()=>{requests++;return {sid:'SM'+'a'.repeat(32),status:'queued'};}}}));
 const control=await sql(`select row_to_json(c) from public.patient_message_dispatch_control c where id=1;`);
 const why=`worker result ${JSON.stringify(result)}; provider requests ${requests}; dispatch control ${control}`;
 assert.equal(result.accepted,1,why);assert.equal(result.skipped,1,why);assert.equal(result.halted,null);assert.equal(requests,1);
 const stats=JSON.parse(await sql(`select json_build_object('wa_attempts',(select count(*) from public.patient_message_attempts where user_id='${ids[0]}'),'sms_attempts',(select count(*) from public.patient_message_attempts where user_id='${ids[1]}'),'reserved',(select sum(amount_micros) from public.patient_message_spend_reservations),'wa_state',(select state from public.patient_message_outbox where user_id='${ids[0]}'),'paused',(select paused_reason from public.patient_message_dispatch_control where id=1));`));
 assert.deepEqual(stats,{wa_attempts:0,sms_attempts:1,reserved:3000,wa_state:'queued',paused:null});
 console.log('Actual worker + PostgreSQL admission: unavailable WhatsApp skips without reservation/attempt/pause; following SMS submits once (provider mocked).');
}finally{try{await sql('rollback;');}finally{child.stdin.end();}}
