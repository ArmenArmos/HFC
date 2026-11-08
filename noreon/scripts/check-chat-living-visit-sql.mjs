import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const container=process.env.NOREON_TEST_DB_CONTAINER;
if(!container?.startsWith('supabase_db_')||container==='supabase_db_noreon-core')throw Error('Set NOREON_TEST_DB_CONTAINER to an isolated local replay container. Hosted and primary data are forbidden.');
const run=spawnSync('docker',['exec','-i',container,'psql','-U','postgres','-X','-v','ON_ERROR_STOP=1'],{input:readFileSync('scripts/check-chat-living-visit.sql'),stdio:['pipe','inherit','inherit']});
if(run.error)console.error(run.error.message);
process.exitCode=run.status??1;
