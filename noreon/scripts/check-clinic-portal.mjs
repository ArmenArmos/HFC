import {clinicSqlTarget} from './fixtures/clinic-db-target.mjs';
const target=clinicSqlTarget();
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const transactional=process.env.NOREON_CLINIC_TRANSACTIONAL==='1';
const sql=(transactional?'begin;\n'+readFileSync('supabase/migrations/20261016054000_clinic_portal_persistence.sql','utf8'):'')+readFileSync('scripts/check-clinic-portal.sql','utf8').replace(transactional?'begin;':'__unused__','');
const r=spawnSync('docker',['exec','-i',target.container,'psql','-U','postgres','-d',target.database,'-X','-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8'});
const path=process.env.NOREON_CLINIC_SQL_LOG??'/tmp/noreon-clinic-portal-sql.log';writeFileSync(path,(r.stdout??'')+'\n'+(r.stderr??''));assert.equal(r.status,0,`Clinic SQL failed; see ${path}`);console.log('PASS clinic SQL fixture ROLLBACK; actual Auth/storage/browser remain separate checks.');
