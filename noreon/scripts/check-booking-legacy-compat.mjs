import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {clinicSqlTarget} from './fixtures/clinic-db-target.mjs';
const target=clinicSqlTarget();
for(const file of ['check-booking-legacy-compat.sql','check-booking-legacy-compat-exclusion.sql']) {
 const r=spawnSync('docker',['exec','-i',target.container,'psql','-U','postgres','-d',target.database,'-X','-v','ON_ERROR_STOP=1'],{input:readFileSync(`scripts/${file}`,'utf8'),encoding:'utf8'});
 writeFileSync(`/tmp/${file}.log`,(r.stdout??'')+'\n'+(r.stderr??''));
 assert.equal(r.status,0,`Compatibility fixture failed: /tmp/${file}.log`);
}
console.log('PASS legacy continuity/provider lifecycle, unlinked nurse facts and pilot exclusion (SQL rollback; actual Auth/UI separate).');
