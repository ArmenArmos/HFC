import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const run=(extra: Record<string,string | undefined>)=>spawnSync(process.execPath,['scripts/check-shared-dose-concurrency.mjs'],{encoding:'utf8',env:{...process.env,PATH:'/nonexistent-noreon-guard-test',GITHUB_ACTIONS:'',RUNNER_ENVIRONMENT:'',GITHUB_REPOSITORY:'',NOREON_ISOLATED_CI_RUNNER:'',NOREON_TEST_DB_CONTAINER:'supabase_db_noreon-core',...extra}});
for(const extra of [{},{GITHUB_ACTIONS:'true',RUNNER_ENVIRONMENT:'self-hosted',GITHUB_REPOSITORY:'noreon-health/noreon-core'},{GITHUB_ACTIONS:'true',RUNNER_ENVIRONMENT:'github-hosted',GITHUB_REPOSITORY:'other/repository'},{GITHUB_ACTIONS:'true',RUNNER_ENVIRONMENT:'self-hosted',GITHUB_REPOSITORY:'other/repository',NOREON_ISOLATED_CI_RUNNER:'noreon-ci'},{GITHUB_ACTIONS:'true',RUNNER_ENVIRONMENT:'self-hosted',GITHUB_REPOSITORY:'noreon-health/noreon-core',NOREON_ISOLATED_CI_RUNNER:'yes'}]) {
 const result=run(extra);
 assert.notEqual(result.status,0);
 assert.match(result.stderr,/local primary database is forbidden|Set an isolated NOREON_TEST_DB_CONTAINER/,'unsafe environment rejects before invoking Docker');
 assert.doesNotMatch(result.stderr,/spawnSync docker/);
}
const ci=run({GITHUB_ACTIONS:'true',RUNNER_ENVIRONMENT:'github-hosted',GITHUB_REPOSITORY:'noreon-health/noreon-core'});
assert.match(ci.stderr,/spawnSync docker ENOENT/,'the exact isolated CI configuration passes the guard; Docker is intentionally unavailable in this guard-only check');
const selfHosted=run({GITHUB_ACTIONS:'true',RUNNER_ENVIRONMENT:'self-hosted',GITHUB_REPOSITORY:'noreon-health/noreon-core',NOREON_ISOLATED_CI_RUNNER:'noreon-ci'});
assert.match(selfHosted.stderr,/spawnSync docker ENOENT/,'the dedicated isolated self-hosted CI runner (docs/operations/ci-runner.md) passes the guard');
const replay=run({NOREON_TEST_DB_CONTAINER:'supabase_db_noreon-guard-replay'});
assert.match(replay.stderr,/spawnSync docker ENOENT/,'an explicitly isolated replay container passes the guard');
console.log('Dose concurrency guard permits the exact hosted or dedicated self-hosted repository CI and replay containers; local primary and other runner/repository contexts reject before Docker.');
