import {clinicSqlTarget} from './fixtures/clinic-db-target.mjs';
/** Ordinary first-send lifecycle on the existing owned QA database. No HTTP,
 * session mutation, contention probes, or stopped browser harness. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const target=clinicSqlTarget();const container=target.container;
let fixture=readFileSync('scripts/check-booking-email.sql','utf8').split('-- A partial recipient receipt')[0];
// Reuse only synthetic seed/setup, not the older test matrix. The transaction
// rolls back all b210 fixture data and temporary functions at completion.
fixture=fixture.split('\n').filter(line=>!line.startsWith('select pg_temp.email_assert(')&&!line.startsWith('select pg_temp.email_reject(')).join('\n').replaceAll('b2000000','b2100000');
const start=(command='b2100000-0000-4000-8000-000000000060',actor='b2100000-0000-4000-8000-000000000003',engine='synthetic-engine-v1')=>`public.start_booking_notice('b2100000-0000-4000-8000-000000000001','${actor}','b2100000-0000-4000-8000-000000000020',0,'b2100000-0000-4000-8000-000000000020','${command}','${engine}','noreon@example.invalid','synthetic-approved-v1')`;
const sql=fixture+`
select pg_temp.email_assert((select public._booking_appointment_dto(a)->>'canStartScheduling'='true' from public.booking_appointments a where id='b2100000-0000-4000-8000-000000000020'),'Pending never-claimed notice offers first-send');
set local role service_role;
select set_config('first.claim',${start()}::text,true);
select pg_temp.email_assert(current_setting('first.claim')::jsonb#>>'{envelope,generation}'='1','First send uses generation one');
select pg_temp.email_assert(${start()}->'envelope'='null'::jsonb,'Original command replay never gets another envelope');
select pg_temp.email_reject($q$select ${start('b2100000-0000-4000-8000-000000000061')}$q$,'40001');
select pg_temp.email_reject($q$select ${start(undefined,'b2100000-0000-4000-8000-000000000004')}$q$,'42501');
select pg_temp.email_reject($q$select ${start(undefined,undefined,'changed-engine')}$q$,'22023');
savepoint first_claimed;
select public.record_booking_notice_receipt('b2100000-0000-4000-8000-000000000020','b2100000-0000-4000-8000-000000000060',1,current_setting('first.claim')::jsonb#>>'{envelope,envelopeHash}','unknown');
select public.apply_booking_notice_receipt('b2100000-0000-4000-8000-000000000020','b2100000-0000-4000-8000-000000000060','synthetic-engine-v1','noreon@example.invalid','synthetic-approved-v1');
select pg_temp.email_reject($q$select ${start('b2100000-0000-4000-8000-000000000063')}$q$,'40001');
select pg_temp.email_assert(${start()}->'envelope'='null'::jsonb,'Unknown receipt replay cannot resend');
rollback to first_claimed;
select public.record_booking_notice_receipt('b2100000-0000-4000-8000-000000000020','b2100000-0000-4000-8000-000000000060',1,current_setting('first.claim')::jsonb#>>'{envelope,envelopeHash}','accepted','synthetic-first-receipt','{"clinic":"clinic@example.invalid","copy":"copy@example.invalid"}');
select pg_temp.email_assert(${start()}->>'receiptRecorded'='true','Durable receipt recovered without another send');
reset role;
select pg_temp.email_assert((select public._booking_appointment_dto(a)->>'status'='reconciliation' and public._booking_appointment_dto(a)#>>'{history,0,noticeState}'='reconciliation' from public.booking_appointments a where id='b2100000-0000-4000-8000-000000000020'),'Heading and history agree for recorded receipt before application');
select pg_temp.email_assert((select count(*)=1 from public.booking_notice_attempts where notice_id='b2100000-0000-4000-8000-000000000020'),'Only one transport attempt');
select pg_temp.email_assert((select count(*)=1 from public.booking_notice_first_send_commands where member_id='b2100000-0000-4000-8000-000000000001'),'One audited operator command');
set local role service_role;
select public.apply_booking_notice_receipt('b2100000-0000-4000-8000-000000000020','b2100000-0000-4000-8000-000000000060','synthetic-engine-v1','noreon@example.invalid','synthetic-approved-v1');
select pg_temp.email_assert(${start()}->'envelope'='null'::jsonb,'Confirmed original replay cannot resend');
select pg_temp.email_reject($q$select ${start('b2100000-0000-4000-8000-000000000062')}$q$,'40001');
rollback;
`;
const result=spawnSync('docker',['exec','-i',container,'psql','-U','postgres','-d',target.database,'-X','-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8'});
const evidence=process.env.NOREON_FIRST_SEND_EVIDENCE_FILE??'/tmp/noreon-booking-first-send-sql.log';
writeFileSync(evidence,(result.stdout??'')+'\n'+(result.stderr??''));
assert.equal(result.status,0,`First-send SQL failed; see ${evidence}`);
console.log('Ordinary owned SQL lifecycle: audited first attempt, no replay envelope, distinct command denied after claim, bound operator/full command, receipt recovery, DTO heading/history parity, confirmed no resend. No concurrency/Auth/provider claim.');
