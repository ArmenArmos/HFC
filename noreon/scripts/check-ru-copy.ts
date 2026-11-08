/** Every piece of Armenian UI copy must have Russian next to it (Khikar, 22 Oct 2026).
 *  The type checker already catches a missing argument to tx/copy/st or a missing key in a
 *  Record<Locale, ...>. This check catches the shapes it cannot see:
 *  - an object with an Armenian `hy` value and no `ru` key,
 *  - a call with an Armenian string argument and no Russian one (local t(en, hy) helpers),
 *  - a conditional whose branches hold Armenian but no Russian (hy ? '...' : '...'),
 *  - an array holding Armenian and no Russian ([en, hy] pairs).
 *  Text that stays Armenian for Russian readers is listed in EXCLUDED with the reason. */
import ts from 'typescript';
import {readFileSync, readdirSync, statSync} from 'node:fs';
import {join, relative} from 'node:path';

const ROOT = process.cwd();
const DIRS = ['app', 'components', 'lib'];
const EXCLUDED: Array<[RegExp, string]> = [
  [/^lib\/zoe\/(?!member-screen\.ts$)/, 'Zoe prompts, language detection and versioned consent statements; Zoe already answers in Russian'],
  [/^lib\/zoe-synthetic\//, 'Zoe evaluation scenarios'],
  [/^lib\/ai-plan\/(?!actions\.ts$)/, 'AI care-plan text stays Armenian; action feedback follows the staff locale'],
  [/^lib\/gp-report\//, 'GP report stays Armenian'],
  [/^lib\/db\/types\.ts$/, 'generated'],
  [/^(components|lib)\/marketing\/|^app\/\(marketing\)\//, 'public website, not in the 22 Oct scope'],
  [/^lib\/telegram-auth\/(hook|staff-signin|staff-invite|staff-recovery|clinic-invite)\.ts$/, 'fixed Armenian and English Telegram code texts, not per-locale templates'],
  [/^lib\/patient\/date-format\.ts$/, 'Armenian month names; Russian dates use Intl'],
  [/^lib\/first-note\/compose\.ts$/, 'doctor-approved first note text stays Armenian'],
  [/^components\/staff\/nurse-urgent-guidance\.tsx$/, 'protocol urgent guidance uses clinicalLocale; clinical text stays Armenian for Russian readers'],
  [/^lib\/lab-ai\/(member-approval|provider)\.ts$|^lib\/reports\/source-bound-output\.ts$/, 'results summaries (health summary text) stay Armenian'],
  [/^lib\/reports\/history\.ts$|^lib\/lab-ai\/(catalogue|identity)\.ts$/, 'Armenian analyte names matched in uploaded reports, not shown as copy'],
  [/^lib\/patient-care\/demo\.ts$/, 'fictional presentation data'],
  [/^lib\/staff-zoe\/(home-intent|typed-boundary|small-talk)\.ts$/, 'per-language keyword tables that recognise typed doctor commands, not shown text'],
  [/^lib\/voice-core\/(spoken-numbers|intent|confirm)\.ts$/, 'WP V: per-language tables that recognise spoken numbers, commands and yes or no in hy/ru/en, not shown text'],
  [/^lib\/clinical\/rules\/branch-coverage\.ts$/, 'quotes the clinical source conditions for traceability, not shown on screen'],
];
const ARMENIAN = /[Ա-և]/;
const CYRILLIC = /[Ѐ-ӿ]/;
const STAFF_COPY = /^(components\/(doctor-chat-v2|nurse-chat-v2|staff|conversation|real-review)\/|app\/staff\/|lib\/ai-plan\/actions\.ts$|lib\/staff-zoe\/.*copy|lib\/staff\/display-text\.ts$)/;
const REPORT_COPY = /^(lib\/(ai-plan\/skeleton|lipid-planner\/copy))\.ts$/;
const INTERNAL_NOTE = /pending (?:Armen|Yesayi|clinicians)|(?:Armen|Yesayi)[^\n]*pending|draft wording|wording pending|to be confirmed by|not signed(?: by)?|(?:pending|awaiting) clinical sign-off|items from code|open \(Q\d+\)|Product wording/i;

function walk(dir: string, out: string[]) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(relative(ROOT, path));
  }
  return out;
}
const literal = (n: ts.Node) => ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateExpression(n);
/** Text of a string-like node, template spans included. */
const text = (n: ts.Node, sf: ts.SourceFile) => n.getText(sf);
/** Whether any string inside the node contains the script. */
function holds(n: ts.Node, script: RegExp, sf: ts.SourceFile): boolean {
  if (literal(n) || ts.isJsxText(n)) return script.test(text(n, sf));
  return ts.forEachChild(n, c => holds(c, script, sf) || undefined) ?? false;
}
const propName = (p: ts.ObjectLiteralElementLike) => p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : null;

const problems: string[] = [];
const files = DIRS.flatMap(d => walk(join(ROOT, d), []));
for (const file of files) {
  const excluded = EXCLUDED.some(([re]) => re.test(file));
  if (excluded && !REPORT_COPY.test(file)) continue;
  const source = readFileSync(file, 'utf8');
  const staffCopy = STAFF_COPY.test(file);
  if (!ARMENIAN.test(source) && !staffCopy && !REPORT_COPY.test(file)) continue;
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const flag = (n: ts.Node, why: string) => {
    const {line} = sf.getLineAndCharacterOfPosition(n.getStart(sf));
    problems.push(`${file}:${line + 1}: ${why}: ${text(n, sf).replace(/\s+/g, ' ').slice(0, 100)}`);
  };
  /** Nearest call, object, array or JSX element around the node: the unit that must carry Russian. */
  const container = (n: ts.Node): ts.Node | null => {
    for (let p = n.parent; p; p = p.parent)
      if (ts.isCallExpression(p) || ts.isNewExpression(p) || ts.isObjectLiteralExpression(p) || ts.isArrayLiteralExpression(p) || ts.isJsxElement(p) || ts.isJsxFragment(p)) return p;
    return null;
  };
  /** Inside a branch that only runs for Armenian: `if (locale === 'hy')`, the true side of
   *  `l === 'hy' ? ... : ...`, or the `hy` entry of an object that also has `ru`. */
  const hyBranch = (n: ts.Node) => {
    for (let c: ts.Node = n, p = n.parent; p; c = p, p = p.parent) {
      if (ts.isIfStatement(p) && c === p.thenStatement && /===?\s*['"]hy['"]/.test(text(p.expression, sf))) return true;
      if (ts.isConditionalExpression(p) && c === p.whenTrue && /===?\s*['"]hy['"]/.test(text(p.condition, sf))) return true;
      if (ts.isPropertyAssignment(p) && propName(p) === 'hy' && ts.isObjectLiteralExpression(p.parent) && p.parent.properties.some(q => propName(q) === 'ru')) return true;
    }
    return false;
  };
  const covered = (n: ts.Node) => {
    const c = container(n);
    if (c && holds(c, CYRILLIC, sf) || hyBranch(n)) return true;
    // Bilingual JSX keeps each language in its own sibling element: <p lang="hy">…</p><p lang="ru">…</p>.
    const outer = c && (ts.isJsxElement(c) || ts.isJsxFragment(c)) ? container(c) : null;
    return !!outer && (ts.isJsxElement(outer) || ts.isJsxFragment(outer)) && holds(outer, CYRILLIC, sf);
  };
  /** An Armenian-only table with a Russian twin: const HY_MONTHS = [...] next to RU_MONTHS. */
  const hyTable = (n: ts.Node) => ts.isVariableDeclaration(n.parent) && /^HY_/.test(text(n.parent.name, sf));
  /** Russian produced by a helper, such as russianAgeUnit(n) for plural forms. */
  const russianHelper = (n: ts.Node) => ts.isCallExpression(n) && /^russian/.test(text(n.expression, sf));
  /** The language's own name in a picker. */
  const ownName = (n: ts.Node) => literal(n) && /^['"`](Հայերեն|Հայ)['"`]$/.test(text(n, sf));
  const visit = (n: ts.Node): void => {
    if ((staffCopy || REPORT_COPY.test(file)) && (literal(n) || ts.isJsxText(n)) && INTERNAL_NOTE.test(text(n, sf))) flag(n, 'Internal note in staff copy');
    if (excluded) { ts.forEachChild(n, visit); return; }
    if (staffCopy) {
      if ((ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)) && ['ReplyDraftSources','AiPlanPrepare'].includes(text(n.tagName, sf)) &&
        !n.attributes.properties.some(p => ts.isJsxAttribute(p) && text(p.name, sf) === 'locale')) flag(n, 'Pass the staff locale to the panel');
      // Check each locale independently: a Russian neighbour cannot cover English in hy.
      let args = ts.isCallExpression(n) && /^(t|st|tx|copy|c|s)$/.test(text(n.expression, sf))
        ? [...n.arguments].slice(n.arguments.length === 4 ? 1 : 0)
        : ts.isArrayLiteralExpression(n) ? [...n.elements] : [];
      // The older member-copy helper takes (locale, hy, en, ru).
      if (ts.isCallExpression(n) && text(n.expression, sf) === 'tx' && args.length === 3) args = [args[1], args[0], args[2]];
      if (args.length === 3 && args.every(literal)) {
        const [en, hy, ru] = args.map(a => ts.isStringLiteralLike(a) ? a.text : text(a, sf).slice(1, -1));
        // Product names and clinical abbreviations are not translation gaps.
        if (!['Zoe','Noreon','Telegram'].includes(en) && (/[a-z]{2}/.test(en) || en === 'TEST')) {
          if (!hy.trim() || hy === en) flag(n, 'Staff hy copy is empty or English');
          if (!ru.trim() || ru === en) flag(n, 'Staff ru copy is empty or English');
        }
      }
    }
    if (ts.isObjectLiteralExpression(n)) {
      if (staffCopy) {
        const values = Object.fromEntries(n.properties.flatMap(p => ts.isPropertyAssignment(p) && ts.isStringLiteralLike(p.initializer) ? [[propName(p), p.initializer.text]] : []));
        if (values.en && /[a-z]{3}/i.test(values.en) && !['Noreon','Zoe','Telegram'].includes(values.en)) {
          for (const locale of ['hy','ru']) if (values[locale] === values.en) flag(n, `Staff ${locale} copy is English`);
        }
      }
      const names = n.properties.map(propName);
      const hy = n.properties.find(p => propName(p) === 'hy');
      if (hy && holds(hy, ARMENIAN, sf) && !names.includes('ru') && !n.properties.some(ts.isSpreadAssignment) && !hyBranch(n)) flag(n, 'hy without ru');
    } else if (ts.isCallExpression(n) || ts.isNewExpression(n)) {
      const args = n.arguments ?? ts.factory.createNodeArray();
      if (args.some(a => literal(a) && ARMENIAN.test(text(a, sf)) && !ownName(a)) && !args.some(a => holds(a, CYRILLIC, sf) || russianHelper(a)) && !hyBranch(n)) flag(n, 'Armenian argument without Russian');
    } else if (ts.isConditionalExpression(n)) {
      if ((literal(n.whenTrue) || literal(n.whenFalse)) && holds(n, ARMENIAN, sf) && !holds(n, CYRILLIC, sf) && !covered(n)) { flag(n, 'Armenian-only conditional'); return; }
    } else if (ts.isArrayLiteralExpression(n)) {
      if (n.elements.some(e => literal(e) && ARMENIAN.test(text(e, sf)) && !ownName(e)) && !holds(n, CYRILLIC, sf) && !covered(n) && !hyTable(n)) flag(n, 'Armenian array without Russian');
    } else if (ts.isJsxText(n) && ARMENIAN.test(n.text) && !/^(Հայերեն|Հայ)$/.test(n.text.trim()) && !covered(n)) flag(n, 'Armenian JSX text');
    ts.forEachChild(n, visit);
  };
  visit(sf);
}
if (problems.length) {
  console.error(`Russian copy missing (${problems.length}):\n${problems.join('\n')}`);
  process.exit(1);
}
console.log(`Russian copy present wherever Armenian UI copy is (${files.length} files scanned).`);
