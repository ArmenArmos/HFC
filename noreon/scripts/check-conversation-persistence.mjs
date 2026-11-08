import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
assert.equal(process.env.NOREON_TEST_DB_CONTAINER,'supabase_db_noreon-clinic-settings-qa','Requires granted existing QA database window');
const prefix=process.env.NOREON_CONVERSATION_TRANSACTIONAL_MIGRATION==='1'?'begin;\n'+readFileSync('supabase/migrations/20261016162000_conversation_persistence.sql','utf8'):'';
const fixture=readFileSync('scripts/check-conversation-persistence.sql','utf8');
const r=spawnSync('docker',['exec','-i',process.env.NOREON_TEST_DB_CONTAINER,'psql','-U','postgres','-X','-v','ON_ERROR_STOP=1'],{input:prefix+fixture.replace(prefix?'begin;':'__unused__',''),encoding:'utf8'});
const path=process.env.NOREON_CONVERSATION_SQL_LOG??'/tmp/noreon-conversation-sql.log';writeFileSync(path,(r.stdout??'')+'\n'+(r.stderr??''));assert.equal(r.status,0,`Conversation SQL failed; see ${path}`);
console.log('PASS normal synthetic conversation SQL lifecycle (rollback). Remote Auth, process restart and concurrent schedules are separate gates.');
