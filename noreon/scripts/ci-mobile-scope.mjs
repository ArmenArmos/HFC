import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

const MOBILE = 'apps/patient-mobile';
const CODE = /\.(ts|tsx|mjs|cjs|js|json)$/;
const SUFFIXES = ['.ts', '.tsx', '.mjs', '.cjs', '.js', '.json'];
// Metro picks a platform variant over the generic file for an import without an extension, so a new or
// changed lib/x.native.ts reaches the app even though lib/x.ts exists.
const PLATFORMS = ['', '.native', '.ios', '.android'];
const EXTENSIONS = ['', ...PLATFORMS.flatMap((p) => SUFFIXES.map((x) => p + x)), ...PLATFORMS.flatMap((p) => ['.ts', '.tsx', '.js'].map((x) => `/index${p}${x}`))];
// Directories the mobile tooling names only as resolution roots (Metro watchFolders, the Jest and Node
// resolvers): what mobile uses inside them is found through its imports, not the directory itself.
const RESOLUTION_ROOTS = new Set(['lib']);

/**
 * Root files outside the mobile app that it reaches: every relative path or `@/` specifier in the app's
 * files, then the imports of those root files, transitively. A reference that does not resolve still
 * counts (its candidate paths), so deleting or moving a shared file needs native checks. Directory
 * references count as a prefix (for example styles/noreon/). Returns null when the app cannot be read,
 * so callers fail closed.
 * @returns {{ files: Set<string>, prefixes: string[] } | null}
 */
export function mobileSharedFiles(root = '.') {
  const appDir = join(root, MOBILE);
  if (!existsSync(appDir)) return null;
  const walk = (dir) => readdirSync(dir).flatMap((entry) => {
    if (entry === 'node_modules' || entry.startsWith('.')) return [];
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
  const appFiles = walk(appDir).filter((f) => CODE.test(f));
  if (!appFiles.length) return null;
  const files = new Set(), prefixes = [], queue = [];
  // Globs (tsconfig "paths") are mappings, not references.
  const specifiers = (text) => [...text.matchAll(/['"](\.{1,2}\/[^'"\n]*|@\/[^'"\n]+)['"]/g)].map((m) => m[1]).filter((spec) => !spec.includes('*'));
  const visit = (fromFile) => {
    for (const spec of specifiers(readFileSync(fromFile, 'utf8'))) {
      const target = spec.startsWith('@/') ? join(root, spec.slice(2)) : join(dirname(fromFile), spec);
      const rel = relative(root, normalize(target)).replaceAll('\\', '/');
      if (rel.startsWith('..') || rel === '' || rel === MOBILE || rel.startsWith(`${MOBILE}/`)) continue;
      const bare = rel.replace(/\/$/, '');
      if (existsSync(join(root, bare)) && statSync(join(root, bare)).isDirectory()) {
        if (!RESOLUTION_ROOTS.has(bare)) prefixes.push(`${bare}/`);
        continue;
      }
      // Every candidate counts, existing or not (a new variant, a deleted file); existing code is followed.
      for (const candidate of EXTENSIONS.map((ext) => bare + ext)) {
        if (files.has(candidate)) continue;
        files.add(candidate);
        if (/\.(ts|tsx|mjs|cjs|js)$/.test(candidate) && existsSync(join(root, candidate)) && statSync(join(root, candidate)).isFile()) queue.push(join(root, candidate));
      }
    }
  };
  for (const f of appFiles) visit(f);
  while (queue.length) visit(queue.pop());
  return { files, prefixes };
}

// Only known web-only areas, and root files the mobile app does not reach, can skip native checks.
// Unknown paths fail closed. Without a readable mobile app (shared === null) every lib/ change counts.
export function mobileRequired(paths, shared = null) {
  if (!paths.length) return true;
  return paths.some((path) => {
    if (/^(apps\/patient-mobile|styles|\.github)\//.test(path)) return true;
    if (/^scripts\/(ci-mobile-scope|check-ci-mobile-scope)\.mjs$/.test(path)) return true;
    if (shared && (shared.files.has(path) || shared.prefixes.some((p) => path.startsWith(p)))) return true;
    if (/^lib\//.test(path)) return !shared;
    // Schema changes reach mobile only through lib/db/types.ts, which is in the shared set when mobile uses it.
    if (/^(scripts|supabase)\//.test(path)) return !shared;
    return !/^(app|components|hooks|public|docs|tools)\//.test(path)
      && !/^(README\.md|AGENTS\.md|CLAUDE\.md)$/.test(path);
  });
}

export function changedPaths(event, eventName, git) {
  const base = eventName === 'pull_request' ? event.pull_request?.base?.sha : event.before;
  const head = eventName === 'pull_request' ? event.pull_request?.head?.sha : event.after;
  if (!['pull_request', 'push'].includes(eventName)
      || ![base, head].every((sha) => /^[a-f0-9]{40}$/.test(sha ?? '') && !/^0+$/.test(sha))) {
    throw new Error('No reliable comparison SHAs');
  }
  // Exact endpoints work for multi-commit pushes and PRs, including shallow checkouts.
  // --no-renames reports both sides of moves, so moving shared code out is not missed.
  git(['fetch', '--no-tags', '--depth=1', 'origin', base, head]);
  return git(['diff', '--name-only', '--no-renames', '-z', base, head, '--'])
    .split('\0').filter(Boolean);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let required = true;
  let reason = 'Comparison unavailable; running mobile checks conservatively.';
  try {
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    const paths = changedPaths(event, process.env.GITHUB_EVENT_NAME,
      (args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
    let shared = null;
    try { shared = mobileSharedFiles('.'); } catch (error) { console.warn(`Mobile shared-file scan failed: ${error.message}`); }
    required = mobileRequired(paths, shared);
    reason = required ? 'Mobile, files the mobile app uses, configuration or unknown paths changed.'
      : `No change reaches the mobile app (${shared ? `${shared.files.size} shared root paths checked` : 'shared files unknown'}); native checks are not needed.`;
  } catch (error) {
    console.warn(`Mobile scope fallback: ${error.message}`);
  }
  console.log(`mobile_required=${required}: ${reason}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `mobile_required=${required}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `### Native mobile checks\n${required ? 'Required' : 'Skipped'}: ${reason}\nWeb, clinical, database and security verification remains unchanged.\n`);
}
