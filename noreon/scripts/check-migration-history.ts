import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { historyViolations, parseNameStatusZ, parseRawAddsZ, parseTreeZ, rangeViolations } from './migration-history.mjs';

// Pure rules.
const m = (n: string) => `supabase/migrations/2026101800000${n}_x.sql`;
const e = (path: string, blob: string, mode = '100644') => ({ path, mode, blob });
const tree = (...entries: ReturnType<typeof e>[]) => new Map(entries.map((x) => [x.path, x]));
assert.deepEqual(historyViolations([e(m('1'), 'a'), e(m('2'), 'b')], tree(e(m('1'), 'a'), e(m('2'), 'b'))), []);
assert.match(historyViolations([e(m('1'), 'a')], tree(e(m('1'), 'z'))).join(), /edited/);
assert.match(historyViolations([e(m('1'), 'a')], tree()).join(), /removed or renamed/);
assert.match(historyViolations([e(m('1'), 'a')], tree(e(m('1'), 'a', '120000'))).join(), /changed type/, 'same blob as a symlink');
assert.match(historyViolations([e(m('2'), 'a'), e(m('1'), 'b')], tree(e(m('2'), 'a'), e(m('1'), 'b'))).join(), /added after .*sorts later/, 'older stamp added later');
assert.match(historyViolations([e('supabase/migrations/x.sql', 'a')], tree(e('supabase/migrations/x.sql', 'a'))).join(), /not named/);
// Re-added after a removal: the first addition is the applied one.
assert.match(historyViolations([e(m('1'), 'a'), e(m('1'), 'b')], tree(e(m('1'), 'b'))).join(), /edited/);
const base = new Set([m('1'), m('2')]);
const head = tree(e(m('1'), 'a'), e(m('2'), 'b'), e(m('3'), 'c'));
assert.deepEqual(rangeViolations([{ status: 'A', from: m('3') }], base, head), [], 'a new, later migration');
assert.match(rangeViolations([{ status: 'M', from: m('1') }], base, head).join(), /edited/);
assert.match(rangeViolations([{ status: 'D', from: m('2') }], base, head).join(), /removed/);
assert.match(rangeViolations([{ status: 'T', from: m('2') }], base, head).join(), /retyped/);
assert.match(rangeViolations([{ status: 'R100', from: m('1'), to: m('4') }], base, head).join(), /renamed to/);
assert.deepEqual(rangeViolations([{ status: 'C100', from: m('1'), to: m('5') }], base, head), [], 'copying into a later name leaves the applied file as it was');
assert.match(rangeViolations([{ status: 'A', from: m('0') }], base, head).join(), /sorts at or before/, 'older new migration');
assert.match(rangeViolations([{ status: 'R090', from: 'docs/x.sql', to: m('0') }], base, head).join(), /sorts at or before/, 'renamed in, out of order');
assert.match(rangeViolations([], base, tree(e(m('1'), 'a', '100755'))).join(), /not a regular file/);
assert.deepEqual(parseNameStatusZ('M\0a b.sql\0R100\0x\0y\0'), [{ status: 'M', from: 'a b.sql' }, { status: 'R100', from: 'x', to: 'y' }]);
assert.deepEqual(parseRawAddsZ(':000000 100644 0000 abcd A\0p\tq.sql\0\n:000000 120000 0000 ef01 A\0r.sql\0'), [{ path: 'p\tq.sql', mode: '100644', blob: 'abcd' }, { path: 'r.sql', mode: '120000', blob: 'ef01' }]);
assert.deepEqual([...parseTreeZ('100644 blob ab\tsupabase/migrations/café.sql\0').keys()], ['supabase/migrations/café.sql']);
console.log('Migration history rules: applied migrations keep their content and type; additions sort last; NUL-delimited parsing.');

// The CLI against a real throwaway repository.
const script = resolve('scripts/migration-history.mjs');
const repo = mkdtempSync(join(tmpdir(), 'noreon-mig-history-'));
const g = (...args: string[]) => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'core.quotepath=true', ...args], { encoding: 'utf8' });
const run = (...args: string[]) => spawnSync('node', [script, ...args], { cwd: repo, encoding: 'utf8' });
const file = (name: string, text: string) => writeFileSync(join(repo, name), text);
try {
  g('init', '-q', '-b', 'main');
  mkdirSync(join(repo, 'supabase/migrations'), { recursive: true });
  file(m('1'), '-- harmless\n'); g('add', '.'); g('commit', '-qm', 'one');
  file(m('2'), 'create table b();\n'); g('add', '.'); g('commit', '-qm', 'two');
  assert.equal(run('--history').status, 0, 'clean history passes');
  // A feature branch that edits its own new migration, merged with a merge commit: fine on first-parent.
  g('checkout', '-qb', 'feat');
  file(m('3'), 'create table c();\n'); g('add', '.'); g('commit', '-qm', 'c draft');
  file(m('3'), 'create table c(id int);\n'); g('add', '.'); g('commit', '-qm', 'c final');
  g('checkout', '-q', 'main'); g('merge', '-q', '--no-ff', '-m', 'merge feat', 'feat');
  assert.equal(run('--history').status, 0, 'a merged branch that edited its own new migration passes');
  const tip = g('rev-parse', 'HEAD').trim();
  // Edit, then restore.
  file(m('1'), 'select 1;\n'); g('commit', '-qam', 'edit applied');
  const edited = run('--history');
  assert.equal(edited.status, 1, 'an edited applied migration fails');
  assert.match(edited.stderr, /20261018000001_x\.sql was edited/);
  assert.equal(run('--range', tip, 'HEAD').status, 1, 'range mode sees the edit');
  file(m('1'), '-- harmless\n'); g('commit', '-qam', 'restore');
  assert.equal(run('--history').status, 0, 'restoring the original content passes again');
  // Same blob, different type: a symlink whose target text equals the old content.
  const t1 = g('rev-parse', 'HEAD').trim();
  unlinkSync(join(repo, m('1'))); symlinkSync('-- harmless\n', join(repo, m('1'))); g('add', '-A'); g('commit', '-qm', 'symlink');
  assert.match(run('--history').stderr, /changed type \(100644 to 120000\)/, 'symlink retype with the same blob fails history');
  assert.equal(run('--range', t1, 'HEAD').status, 1, 'and range');
  g('reset', '-q', '--hard', t1);
  chmodSync(join(repo, m('2')), 0o755); g('add', '-A'); g('commit', '-qm', 'exec bit');
  assert.match(run('--history').stderr, /changed type \(100644 to 100755\)/, 'an executable bit fails');
  g('reset', '-q', '--hard', t1);
  // An older timestamp added after a newer one, directly and through a rename.
  file('supabase/migrations/20261017000000_late.sql', 'select 1;\n'); g('add', '.'); g('commit', '-qm', 'late');
  assert.match(run('--history').stderr, /20261017000000_late\.sql was added after/, 'history rejects an out-of-order addition');
  assert.match(run('--range', t1, 'HEAD').stderr, /sorts at or before/, 'range rejects it too');
  g('reset', '-q', '--hard', t1);
  file('docs.sql', 'select 1;\n'); g('add', '.'); g('commit', '-qm', 'draft'); const t2 = g('rev-parse', 'HEAD').trim();
  g('mv', 'docs.sql', 'supabase/migrations/20261018000000_moved.sql'); g('commit', '-qm', 'move in');
  assert.match(run('--range', t2, 'HEAD').stderr, /sorts at or before/, 'renamed in, out of order');
  g('reset', '-q', '--hard', t1);
  // A path git would quote (non-ASCII) is still seen.
  const cafe = 'supabase/migrations/20261019000000_café.sql';
  file(cafe, 'select 1;\n'); g('add', '.'); g('commit', '-qm', 'cafe'); const t3 = g('rev-parse', 'HEAD').trim();
  file(cafe, 'select 2;\n'); g('commit', '-qam', 'edit cafe');
  assert.match(run('--range', t3, 'HEAD').stderr, /café\.sql edited/, 'a quoted path is not skipped by range');
  assert.match(run('--history').stderr, /café\.sql (was edited|is not named)/, 'nor by history');
  g('reset', '-q', '--hard', t1);
  g('mv', m('2'), m('7')); g('commit', '-qm', 'rename');
  assert.match(run('--history').stderr, /20261018000002_x\.sql was removed or renamed/);
  assert.equal(run('--range', 'HEAD~1', 'HEAD').status, 1);
  assert.equal(run('--bogus').status, 2, 'usage error fails closed');
  console.log('migration-history.mjs: fails edits, renames, retypes (symlink, exec bit), out-of-order additions and quoted paths; passes clean, merged and restored histories.');
} finally {
  rmSync(repo, { recursive: true, force: true });
}
