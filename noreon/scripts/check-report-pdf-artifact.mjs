import assert from'node:assert/strict';import{readFileSync,writeFileSync}from'node:fs';import{spawnSync}from'node:child_process';
const container=process.env.NOREON_TEST_DB_CONTAINER;
assert.equal(container,'supabase_db_noreon-clinic-settings-qa','Existing owned QA database required');
const result=spawnSync('docker',['exec','-i',container,'psql','-U','postgres','-X','-v','ON_ERROR_STOP=1'],{input:readFileSync('scripts/check-report-pdf-artifact.sql','utf8'),encoding:'utf8'});
const path=process.env.NOREON_PDF_ARTIFACT_EVIDENCE_FILE??'/tmp/noreon-report-pdf-artifact-sql.log';writeFileSync(path,(result.stdout??'')+'\n'+(result.stderr??''));
assert.equal(result.status,0,`PDF artifact SQL failed; see ${path}`);
console.log('Local synthetic SQL: strict non-null artifact shape/identity/limits/map, source hash/DTO, unchanged requirements, member write denial, stale SQL CAS, deletion, shared RPC persistence and metadata association lifecycle. No Auth/storage/parser/provider/live proof.');
