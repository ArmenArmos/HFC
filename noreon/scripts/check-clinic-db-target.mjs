import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {clinicSqlTarget} from './fixtures/clinic-db-target.mjs';
const local={NOREON_TEST_DB_CONTAINER:'supabase_db_noreon-clinic-settings-qa',NOREON_TEST_DB_NAME:'noreon_clinic_selected_20261016'};
const ci={CI:'true',GITHUB_ACTIONS:'true',NOREON_TEST_DB_CONTAINER:'supabase_db_noreon-core',NOREON_TEST_DB_NAME:'postgres'};
assert.equal(clinicSqlTarget(local).database,'noreon_clinic_selected_20261016');
assert.equal(clinicSqlTarget({...local,NOREON_TEST_DB_NAME:'postgres'}).ci,false);
assert.equal(clinicSqlTarget(ci).ci,true);
const denied=[{}, {...local,NOREON_TEST_DB_NAME:undefined},{...local,NOREON_TEST_DB_NAME:'production'},{...local,NOREON_TEST_DB_CONTAINER:'production'},{...ci,CI:undefined},{...ci,GITHUB_ACTIONS:undefined},{...ci,NOREON_TEST_DB_NAME:'noreon_clinic_selected_20261016'}];
for(const input of denied)assert.throws(()=>clinicSqlTarget(input));
const py=spawnSync('python3',['-c',"import json,sys;from scripts.fixtures.clinic_db_target import clinic_sql_target; cases=json.load(sys.stdin);\nfor e in cases['allowed']: clinic_sql_target(e)\nfor e in cases['denied']:\n try: clinic_sql_target(e)\n except ValueError: continue\n raise AssertionError('Target unexpectedly allowed')"],{input:JSON.stringify({allowed:[local,{...local,NOREON_TEST_DB_NAME:'postgres'},ci],denied}),encoding:'utf8'});
assert.equal(py.status,0,py.stderr);
// Exercise actual entrypoints with denied inputs. They must stop before Docker.
const runners=['check-clinic-admin.mjs','check-clinic-portal.mjs','check-patient-care-visits.mjs','check-booking-first-send.mjs','check-booking-notice-retry.mjs','check-booking-notice-recovery.mjs','check-booking-legacy-compat.mjs','check-clinic-admin-race.py','check-booking-legacy-compat-races.py'];
for(const name of runners)for(const input of [{NOREON_TEST_DB_CONTAINER:'arbitrary-production',NOREON_TEST_DB_NAME:'postgres'},{NOREON_TEST_DB_CONTAINER:local.NOREON_TEST_DB_CONTAINER}]) {
 const env={...process.env,CI:'',GITHUB_ACTIONS:'',NOREON_TEST_DB_CONTAINER:'',NOREON_TEST_DB_NAME:'',...input};
 const result=spawnSync(name.endsWith('.py')?'python3':'node',[`scripts/${name}`,...(name==='check-clinic-admin-race.py'?['green']:[])],{env,encoding:'utf8'});
 assert.notEqual(result.status,0,name);
 assert.match(result.stderr,/Owned clinic QA or repository Actions CI database required|Explicit allowed NOREON_TEST_DB_NAME required/,name);
}
console.log('PASS shared JS/Python target matrix and18 actual denied CLI invocations; no database operations.');
