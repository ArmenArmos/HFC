import {clinicSqlTarget} from './fixtures/clinic-db-target.mjs';
const target=clinicSqlTarget();
import assert from 'node:assert/strict';
import{readFileSync,writeFileSync}from'node:fs';import{spawnSync}from'node:child_process';
const tx=process.env.NOREON_CLINIC_ADMIN_TRANSACTIONAL==='1';
const input=(tx?'begin;\n'+readFileSync('supabase/migrations/20261016061000_clinic_admin_memberships.sql','utf8'):'')+readFileSync('scripts/check-clinic-admin.sql','utf8').replace(tx?'begin;':'__none__','');
const r=spawnSync('docker',['exec','-i',target.container,'psql','-U','postgres','-d',target.database,'-X','-v','ON_ERROR_STOP=1'],{input,encoding:'utf8'});const path=process.env.NOREON_CLINIC_ADMIN_LOG??'/tmp/clinic-admin-sql.log';writeFileSync(path,(r.stdout??'')+'\n'+(r.stderr??''));assert.equal(r.status,0,`Admin SQL failed; inspect ${path}`);console.log('PASS fictional SQL-role clinic administration ROLLBACK; actual admin UI/Auth separate.');
