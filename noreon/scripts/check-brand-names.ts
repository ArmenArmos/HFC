/** Brand names in copy (WP B, 8 Nov 2026). Armenian copy names the assistant «Զոյա» and the service
 *  «Նորեոն Հելթ»; Russian copy says «Зоя» and «Нореон Хелс» (lib/brand.ts). This check walks every string
 *  literal, template and JSX text in app/, components/ and lib/ and fails on:
 *  - Latin "Zoe" or "Noreon" inside an Armenian or a Russian part of a string ("Zoe-ն", "Noreon-ի", "Спросите Zoe"),
 *  - the old spellings «Զոի», «Զոե» and the case forms «Զոյի», «Զոյին» that are not in ZOE_HY,
 *  - the partial service names «Նորեոն» without «Հելթ» and «Нореон» without «Хелс»,
 *  - a template that starts with the Latin signature "Zoe: " before interpolated text (Telegram heads take
 *    zoeSignature(locale), since the text after them is Armenian or Russian for most members),
 *  - a bare "Zoe" or "Noreon" JSX label in member or staff chat components, which must use zoeName()/noreonName().
 *  Bilingual strings ("Armenian line\nEnglish line", "hy / en / ru") are judged part by part, so the English part
 *  keeps "Noreon". Lower-case identifiers (noreon.health, NOREON_*, zoe_*) never match. */
import assert from 'node:assert/strict';
import ts from 'typescript';
import {readFileSync, readdirSync, statSync} from 'node:fs';
import {join, relative} from 'node:path';
import {BRAND_NAMES_PROMPT_RULE, NOREON, NOREON_HY, ZOE, ZOE_HY, noreonName, zoeName, zoeSignature} from '@/lib/brand';
import {APP_FACTS, systemPrompt} from '@/lib/zoe/provider';
import {ZOE_DIRECT_ANSWERS, ZOE_STATEMENT} from '@/lib/zoe/consent-copy';

// lib/brand.ts is the one source of the names.
assert.deepEqual({...ZOE}, {hy: 'Զոյա', en: 'Zoe', ru: 'Зоя'});
assert.deepEqual({...NOREON}, {hy: 'Նորեոն Հելթ', en: 'Noreon Health', ru: 'Нореон Хелс'});
assert.deepEqual({...ZOE_HY}, {base: 'Զոյա', definite: 'Զոյան', genitive: 'Զոյայի', dative: 'Զոյային', ablative: 'Զոյայից', instrumental: 'Զոյայով'});
assert.deepEqual({...NOREON_HY}, {base: 'Նորեոն Հելթ', definite: 'Նորեոն Հելթը', genitive: 'Նորեոն Հելթի', dative: 'Նորեոն Հելթին', ablative: 'Նորեոն Հելթից'});
assert.ok(Object.isFrozen(ZOE) && Object.isFrozen(NOREON) && Object.isFrozen(ZOE_HY) && Object.isFrozen(NOREON_HY), 'brand records are frozen');
for (const l of ['hy', 'en', 'ru'] as const) {
  assert.equal(zoeName(l), ZOE[l]);
  assert.equal(noreonName(l), NOREON[l]);
}
assert.deepEqual([zoeSignature('hy'), zoeSignature('en'), zoeSignature('ru')], ['Զոյա՝ ', 'Zoe: ', 'Зоя: '], 'Telegram signature per language');
for (const form of [...Object.values(ZOE_HY), NOREON_HY.base, NOREON_HY.genitive, NOREON_HY.dative, ZOE.ru, NOREON.ru])
  assert.ok(BRAND_NAMES_PROMPT_RULE.includes(form), `the prompt rule names ${form}`);
assert.ok(systemPrompt(false).includes(BRAND_NAMES_PROMPT_RULE) && systemPrompt(true).includes(BRAND_NAMES_PROMPT_RULE), 'the Zoe system prompt carries the naming rule');
assert.doesNotMatch(APP_FACTS, /Armenian and English only/, 'the app facts no longer say the app has no Russian');
assert.match(APP_FACTS, /Armenian, English and Russian/);
// The consent statement is versioned: its Armenian name changed with a new wording version (draft-3, draft-2 still valid).
assert.ok(ZOE_STATEMENT.hy.startsWith(ZOE_HY.definite) && ZOE_DIRECT_ANSWERS.hy.startsWith(ZOE_HY.definite), 'consent statement says «Զոյան»');
assert.match(readFileSync('lib/zoe/member.ts', 'utf8'), /export const ZOE_CONSENT_VERSION='zoe-consent-draft-3';/, 'the renamed consent wording has its own version');
// Migrations go live before the app: the server's wording moves to draft-3 only after the app deploy (an operator step).
const brandMigration = readFileSync('supabase/migrations/20261108064222_brand_names_ru_templates.sql', 'utf8');
assert.doesNotMatch(brandMigration, /update public\.zoe_settings/, 'the schema migration does not switch the consent wording under the running app');
assert.match(readFileSync('docs/operations/staging-ai-mode.sql', 'utf8'), /consent_wording_version='zoe-consent-draft-3'[^;]*'zoe-consent-draft-2'/, 'the operator step moves to draft-3 and keeps draft-2 valid');
// The database signs Zoe's Telegram texts with the same signature as zoeSignature().
for (const sig of ['Զոյա՝ ', 'Зоя: ', 'Zoe: ']) assert.ok(brandMigration.includes(`'${sig}'`), `the migration signs Telegram texts with «${sig}»`);

const ROOT = process.cwd();
const ARMENIAN = /[Ա-և]/;
const CYRILLIC = /[Ѐ-ӿ]/;
/** Case-sensitive: the product names, never identifiers such as noreon.health or zoeName. */
const LATIN_NAME = /(?<![\w.@/-])(Zoe|Noreon)(?![\w.@/])/;
const OLD_ARMENIAN = /Զոի|Զոե|Զոյի(?![ա-և])|Զոյին(?![ա-և])/;
/** The service's partial names: «Նորեոն» is always «Նորեոն Հելթ…», «Нореон» always «Нореон Хелс». */
const PARTIAL_NOREON = /Նորեոն(?! Հելթ)|Нореон(?! Хелс)/;
/** A Latin signature heading interpolated text: `Zoe: ${...}`. */
const LATIN_SIGNATURE_HEAD = /^Zoe: $/;
/** Components whose JSX labels are read in every language: names come from lib/brand.ts. */
const LOCALISED_LABELS = /^(components\/(chat-v2|patient|patient-care|doctor-chat-v2|nurse-chat-v2|clinic-portal)\/|app\/patient\/)/;
/** Genuine identifiers that must keep the Latin name inside Armenian or Russian text: [file, text, reason].
 *  None today; add one only with its reason. */
const ALLOWED: Array<[RegExp, RegExp, string]> = [
  // The staff trace viewer titles unknown Zoe events in English ("Zoe: quiet hours"); admin-only, English-only screen (WP A).
  [/^lib\/conversation-trace\/contracts\.ts$/, /^Zoe: \u0000$/, 'English admin trace title'],
];

function walk(dir: string, out: string[]) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(relative(ROOT, path));
  }
  return out;
}
/** A bilingual string is judged part by part: lines, and " / " or " | " separated languages. */
const parts = (raw: string) => raw.split(/\\n|\n| \/ | \| /);

const problems: string[] = [];
let literals = 0;
const files = ['app', 'components', 'lib'].flatMap(d => walk(join(ROOT, d), [])).filter(f => f !== 'lib/db/types.ts');
for (const file of files) {
  const source = readFileSync(file, 'utf8');
  if (!/Zoe|Noreon|Զո|Նորեոն|Нореон/.test(source)) continue;
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const flag = (n: ts.Node, why: string, text: string) => {
    if (ALLOWED.some(([f, t]) => f.test(file) && t.test(text.trim()))) return;
    const {line} = sf.getLineAndCharacterOfPosition(n.getStart(sf));
    problems.push(`${file}:${line + 1}: ${why}: ${text.replace(/\s+/g, ' ').slice(0, 120)}`);
  };
  const judge = (n: ts.Node, raw: string) => {
    literals++;
    if (OLD_ARMENIAN.test(raw)) flag(n, 'old Armenian spelling of Zoe (use ZOE_HY forms)', raw);
    if (PARTIAL_NOREON.test(raw)) flag(n, 'partial service name (use «Նորեոն Հելթ…»/«Нореон Хелс»)', raw);
    for (const part of parts(raw)) {
      if (!LATIN_NAME.test(part)) continue;
      if (ARMENIAN.test(part)) flag(n, 'Latin brand name in Armenian text (use «Զոյա»/«Նորեոն Հելթ»)', part);
      else if (CYRILLIC.test(part)) flag(n, 'Latin brand name in Russian text (use «Зоя»/«Нореон Хелс»)', part);
    }
  };
  const visit = (n: ts.Node): void => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return judge(n, n.text);
    if (ts.isTemplateExpression(n)) {
      judge(n, [n.head.text, ...n.templateSpans.map(s => s.literal.text)].join('\u0000'));
      if (LATIN_SIGNATURE_HEAD.test(n.head.text)) flag(n, 'Latin signature before interpolated text (use zoeSignature(locale))', `${n.head.text}\u0000`);
      n.templateSpans.forEach(s => visit(s.expression));
      return;
    }
    if (ts.isJsxText(n)) {
      judge(n, n.text);
      if (LOCALISED_LABELS.test(file) && /^(Zoe|Noreon)$/.test(n.text.trim())) flag(n, 'fixed English brand label in a localised screen (use zoeName/noreonName)', n.text);
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
}
assert.ok(literals > 500, `the walk read the copy (${literals} literals)`);
assert.deepEqual(problems, [], `brand names:\n${problems.join('\n')}`);
console.log(`check-brand-names: ${files.length} files, ${literals} literals in files that name Zoe or Noreon, all names follow lib/brand.ts`);
