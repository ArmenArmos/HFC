import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
// run-checks.mjs must refuse the primary local database before it starts Docker, except in the
// isolated CI replay. PATH points nowhere, so a run that passes the guard fails at `docker`.
const run=(extra: Record<string,string | undefined>)=>spawnSync(process.execPath,['scripts/run-checks.mjs','--sql'],{encoding:'utf8',env:{...process.env,PATH:'/nonexistent-noreon-guard-test',GITHUB_ACTIONS:'',RUNNER_ENVIRONMENT:'',GITHUB_REPOSITORY:'',NOREON_ISOLATED_CI_RUNNER:'',NOREON_TEST_DB_CONTAINER:'supabase_db_noreon-core',...extra}});
for(const extra of [{},{NOREON_TEST_DB_CONTAINER:''},{NOREON_TEST_DB_CONTAINER:'noreon-core'},{GITHUB_ACTIONS:'true',RUNNER_ENVIRONMENT:'self-hosted',GITHUB_REPOSITORY:'noreon-health/noreon-core'},{GITHUB_ACTIONS:'true',RUNNER_ENVIRONMENT:'github-hosted',GITHUB_REPOSITORY:'other/repository'},{GITHUB_ACTIONS:'true',RUNNER_ENVIRONMENT:'self-hosted',GITHUB_REPOSITORY:'noreon-health/noreon-core',NOREON_ISOLATED_CI_RUNNER:'yes'}]) {
 const result=run(extra);
 assert.notEqual(result.status,0);
 assert.match(result.stderr,/Set NOREON_TEST_DB_CONTAINER to an isolated local Supabase container/,`unsafe environment rejects before Docker: ${JSON.stringify(extra)}`);
 assert.doesNotMatch(result.stderr,/spawnSync docker/);
}
for(const extra of [{GITHUB_ACTIONS:'true',RUNNER_ENVIRONMENT:'github-hosted',GITHUB_REPOSITORY:'noreon-health/noreon-core'},{GITHUB_ACTIONS:'true',RUNNER_ENVIRONMENT:'self-hosted',GITHUB_REPOSITORY:'noreon-health/noreon-core',NOREON_ISOLATED_CI_RUNNER:'noreon-ci'},{NOREON_TEST_DB_CONTAINER:'supabase_db_noreon-lane-guard'}]) {
 const result=run(extra);
 assert.doesNotMatch(result.stderr,/Set NOREON_TEST_DB_CONTAINER/,`allowed environment passes the guard: ${JSON.stringify(extra)}`);
 assert.match(result.stderr,/spawnSync docker ENOENT/,'a run that passes the guard reaches Docker (absent here on purpose)');
}
console.log('run-checks.mjs refuses the primary local database outside isolated CI, before Docker; CI and lane containers pass.');
