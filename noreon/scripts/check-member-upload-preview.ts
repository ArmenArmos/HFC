/** Actual route and PDF slicing; staff identity and audited byte service are mocked. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {PDFDocument} from 'pdf-lib';
import {z} from 'zod';

const source = await PDFDocument.create();
source.addPage([210, 310]);
source.addPage([220, 320]);
const bytes = new Uint8Array(await source.save());
const headers = {'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="original.pdf"', 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff'};
let role = 'doctor', opens = 0;
const client = {};
let reply = () => new Response(bytes, {headers});
const modules: Record<string, unknown> = {
  'pdf-lib': {PDFDocument}, zod: {z},
  '@/lib/observability/with-logging': {withRouteLogging: (handler: unknown) => handler},
  '@/lib/patient-care/clinical-case-repository': {requireRealStaff: async () => ({client, identity: {role}})},
  '@/lib/member-history/server': {documentBytesResponse: async (...args: unknown[]) => {
    assert.deepEqual(args, [client, 'member', 'document', 'staff']);
    opens++; return reply();
  }},
};
const route: {GET?: (request: Request, context: unknown) => Promise<Response>} = {};
const code = ts.transpileModule(readFileSync('app/staff/real/(review)/members/[id]/member-uploads/[docId]/route.ts', 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
vm.compileFunction(code, ['exports', 'require'])(route, (name: string) => {
  assert.ok(name in modules, `Unexpected dependency ${name}`); return modules[name];
});
async function get(query = '') {
  const before = opens;
  const result = await route.GET!(new Request(`https://backoffice.noreon.health/preview${query}`), {params: Promise.resolve({id: 'member', docId: 'document'})});
  assert.equal(opens - before, role === 'doctor' ? 1 : 0, 'One audited byte-service request, with no alternate download');
  return result;
}
const page = await get('?page=2');
for (const [name, value] of Object.entries(headers)) assert.equal(page.headers.get(name), value);
const sliced = await PDFDocument.load(await page.arrayBuffer());
assert.equal(sliced.getPageCount(), 1);
assert.equal(sliced.getPage(0).getWidth(), 220, 'Requested second page is served');
for (const query of ['', '?page=0', '?page=501', '?page=1.5', '?page=no', '?page=3', '?page=500']) {
  assert.deepEqual(new Uint8Array(await (await get(query)).arrayBuffer()), bytes, `Original PDF on absent/invalid/out-of-document page ${query}`);
}
for (const mime of ['image/png', 'image/jpeg']) {
  const photo = new Response(new Uint8Array([1, 2, 3]), {headers: {...headers, 'Content-Type': mime}});
  reply = () => photo;
  assert.equal(await get('?page=1'), photo, 'Photos pass through without reading/replacing the response');
}
for (const status of [404, 503]) {
  const unavailable = new Response(null, {status}); reply = () => unavailable;
  assert.equal(await get('?page=1'), unavailable, 'Authorization/audit errors pass through');
}
const malformed = new Uint8Array([37, 80, 68, 70]);
reply = () => new Response(malformed, {headers});
assert.deepEqual(new Uint8Array(await (await get('?page=1')).arrayBuffer()), malformed, 'Unreadable PDFs preserve the existing lab fallback');
role = 'nurse';
assert.equal((await get('?page=1')).status, 404);
console.log('Member upload preview route PASS: requested PDF page, bounded query, original fallbacks, photos, errors and one audited byte fetch (mocked server boundary).');
