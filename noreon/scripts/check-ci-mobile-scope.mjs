import assert from 'node:assert/strict';
import { changedPaths, mobileRequired, mobileSharedFiles } from './ci-mobile-scope.mjs';

for (const path of ['app/page.tsx', 'components/patient/bp-value-row.tsx', 'hooks/use-focus.ts',
  'public/logo.svg', 'docs/operations/queue.md', 'tools/telegram-assistant/index.ts', 'AGENTS.md']) {
  assert.equal(mobileRequired([path]), false, path);
}
for (const path of ['apps/patient-mobile/src/app/index.tsx', 'lib/clinical/rules/rules.ts',
  'lib/patient/validation.ts', 'styles/noreon/colors.css', 'scripts/fixtures/patient-answers.json',
  '.github/workflows/verify.yml', 'scripts/ci-mobile-scope.mjs', 'supabase/migrations/example.sql',
  'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.json', 'new-shared/code.ts']) {
  assert.equal(mobileRequired([path]), true, path);
  assert.equal(mobileRequired(['app/page.tsx', path]), true, `mixed: ${path}`);
}
assert.equal(mobileRequired([]), true);
const base = 'a'.repeat(40), head = 'b'.repeat(40);
for (const [name, event] of [
  ['pull_request', { pull_request: { base: { sha: base }, head: { sha: head } } }],
  ['push', { before: base, after: head }],
]) {
  const calls = [];
  const paths = changedPaths(event, name, (args) => {
    calls.push(args);
    return args[0] === 'diff' ? 'lib/deleted.ts\0components/moved.ts\0app/name\nwith newline.tsx\0' : '';
  });
  assert.deepEqual(calls[0], ['fetch', '--no-tags', '--depth=1', 'origin', base, head]);
  assert.deepEqual(calls[1], ['diff', '--name-only', '--no-renames', '-z', base, head, '--']);
  assert.equal(paths.length, 3);
  assert.equal(mobileRequired(paths), true, 'deletion/rename of shared code');
}
assert.throws(() => changedPaths({ before: '0'.repeat(40), after: head }, 'push', () => assert.fail()));
assert.throws(() => changedPaths({}, 'workflow_dispatch', () => assert.fail()));
assert.throws(() => changedPaths({ before: base, after: head }, 'push', () => { throw Error('fetch denied'); }));
// With the mobile app's shared files known, only changes it can see need native checks.
const shared = { files: new Set(['lib/clinical/rules/rules.ts', 'lib/db/types.ts', 'scripts/fixtures/patient-answers.json']), prefixes: ['styles/noreon/'] };
for (const path of ['lib/zoe/server.ts', 'supabase/migrations/20261019000000_x.sql', 'scripts/check-booking.sql', 'app/page.tsx'])
  assert.equal(mobileRequired([path], shared), false, `not reached by mobile: ${path}`);
for (const path of ['lib/clinical/rules/rules.ts', 'lib/db/types.ts', 'scripts/fixtures/patient-answers.json', 'styles/noreon/colors.css',
  'styles/other.css', 'apps/patient-mobile/src/x.ts', '.github/workflows/verify.yml', 'scripts/ci-mobile-scope.mjs', 'scripts/check-ci-mobile-scope.mjs',
  'package.json', 'pnpm-lock.yaml', 'new-shared/code.ts'])
  assert.equal(mobileRequired(['lib/zoe/server.ts', path], shared), true, `reached or unknown: ${path}`);
// The real app: direct and transitive shared files, nothing the app does not import.
const real = mobileSharedFiles('.');
assert.ok(real && real.files.has('lib/db/types.ts') && real.files.has('lib/clinical/rules/thresholds.ts'), 'direct and transitive imports');
assert.ok(real.prefixes.includes('styles/noreon/'), 'the theme folder');
assert.ok(!real.files.has('lib/zoe/server.ts') && ![...real.files].some((f) => f.includes('*')), 'no unrelated files, no globs');
for (const variant of ['lib/patient/validation.native.ts', 'lib/patient/validation.ios.ts', 'lib/patient/validation.android.tsx', 'lib/db/types.native.ts'])
  assert.equal(mobileRequired([variant], real), true, `Metro platform variant: ${variant}`);
console.log('CI mobile scope checks passed');

// Exercise the actual CLI and Git diff, including shared-file moves and failures.
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } = await import('node:fs');
const { tmpdir } = await import('node:os');
const { join } = await import('node:path');
const { execFileSync } = await import('node:child_process');
const script = new URL('./ci-mobile-scope.mjs', import.meta.url);
const root = mkdtempSync(join(tmpdir(), 'noreon-ci-scope-'));
try {
  const repo = join(root, 'repo');
  mkdirSync(repo);
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init');
  git('config', 'user.name', 'CI scope test');
  git('config', 'user.email', 'ci-scope@example.invalid');
  mkdirSync(join(repo, 'lib'));
  mkdirSync(join(repo, 'components'));
  writeFileSync(join(repo, 'lib/shared.ts'), 'export const value = 1;\n');
  git('add', '.'); git('commit', '-m', 'base');
  const first = git('rev-parse', 'HEAD');
  git('remote', 'add', 'origin', repo);
  writeFileSync(join(repo, 'components/web.tsx'), 'web only\n');
  git('add', '.'); git('commit', '-m', 'web');
  const web = git('rev-parse', 'HEAD');
  const eventPath = join(root, 'event.json');
  function run(before, after, expected) {
    const output = join(root, 'output');
    writeFileSync(output, '');
    writeFileSync(eventPath, JSON.stringify({ before, after }));
    execFileSync(process.execPath, [script.pathname], { cwd: repo, env: {
      ...process.env, GITHUB_EVENT_NAME: 'push', GITHUB_EVENT_PATH: eventPath,
      GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: join(root, 'summary'),
    }, stdio: 'pipe' });
    assert.equal(readFileSync(output, 'utf8'), `mobile_required=${expected}\n`);
  }
  run(first, web, false);
  git('mv', 'lib/shared.ts', 'components/shared.ts');
  git('commit', '-m', 'move shared out');
  run(first, git('rev-parse', 'HEAD'), true);
  run('0'.repeat(40), web, true);
  run('f'.repeat(40), web, true); // unavailable object/fetch failure
  // A repository with a mobile app: only files it reaches (directly, transitively, or deleted) count.
  mkdirSync(join(repo, 'apps/patient-mobile/src'), { recursive: true });
  writeFileSync(join(repo, 'apps/patient-mobile/src/a.ts'), "import {a} from '../../../lib/a';\nexport const x = a;\n");
  writeFileSync(join(repo, 'lib/a.ts'), "import {c} from './c';\nexport const a = c;\n");
  writeFileSync(join(repo, 'lib/c.ts'), 'export const c = 1;\n');
  writeFileSync(join(repo, 'lib/b.ts'), 'export const b = 1;\n');
  git('add', '.'); git('commit', '-m', 'mobile app');
  const app = git('rev-parse', 'HEAD');
  const change = (file, text) => { writeFileSync(join(repo, file), text); git('add', '-A'); git('commit', '-m', file); return git('rev-parse', 'HEAD'); };
  run(app, change('lib/b.ts', 'export const b = 2;\n'), false);
  const prev = git('rev-parse', 'HEAD');
  run(prev, change('lib/c.ts', 'export const c = 2;\n'), true);
  // A new platform variant of a shared file, and a file only that variant imports.
  writeFileSync(join(repo, 'lib/d.ts'), 'export const d = 1;\n'); git('add', '.'); git('commit', '-m', 'd');
  const beforeVariant = git('rev-parse', 'HEAD');
  run(beforeVariant, change('lib/c.native.ts', "import {d} from './d';\nexport const c = d;\n"), true);
  run(git('rev-parse', 'HEAD'), change('lib/d.ts', 'export const d = 2;\n'), true);
  git('rm', '-q', 'lib/a.ts'); git('commit', '-m', 'delete a');
  run(app, git('rev-parse', 'HEAD'), true);
  console.log('CI mobile scope CLI/Git integration checks passed');
} finally {
  rmSync(root, { recursive: true, force: true });
}
