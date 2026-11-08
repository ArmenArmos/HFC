import assert from 'node:assert/strict';
// @ts-expect-error Runtime provides registerHooks; project types target Node 20.
import { registerHooks } from 'node:module';
registerHooks({ resolve(specifier: string, context: object, next: (specifier: string, context: object) => object) {
  if (specifier === 'next/link') return {url: 'data:text/javascript,export default function Link(p){return globalThis.__reportTestReact.createElement("a",p,p.children)}', shortCircuit: true};
  if (specifier === 'next/navigation') return {url: 'data:text/javascript,export function usePathname(){return "/patient/reports"}', shortCircuit: true};
  return next(specifier, context);
}});
const React = await import('react');
Object.assign(globalThis, {__reportTestReact: React});
const {create, act} = await import('react-test-renderer');
const {DemoReportsProvider, useDemoReports} = await import('@/components/service-workflow/reports-provider');
const {ReportIntake} = await import('@/components/service-workflow/report-intake');
const {sampleReports} = await import('@/lib/reports/demo');
const {reportFailureMessage} = await import('@/lib/reports/feedback');
let memory: ReturnType<typeof useDemoReports>;
function Probe() { const current = useDemoReports(); React.useEffect(() => { memory = current; }); return null; }
const originalFetch = globalThis.fetch;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalReader = Object.getOwnPropertyDescriptor(globalThis, 'FileReader');
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {value: true, configurable: true});
Object.defineProperty(globalThis, 'window', {value: {location: {pathname: '/patient/reports'}, setTimeout, clearTimeout}, configurable: true});
Object.defineProperty(globalThis, 'FileReader', {value: class {
  result = 'data:application/pdf;base64,RmljdGlvbmFs';
  onload?: () => void;
  readAsDataURL() { queueMicrotask(() => this.onload?.()); }
}, configurable: true});
try {
  for (const locale of ['en', 'hy'] as const) for (const code of ['invalid_file', 'duplicate', 'report_limit', 'unavailable', 'mixed']) {
    let writes = 0;
    const existing = code === 'duplicate' || code === 'mixed' ? {...sampleReports()[0], id: crypto.randomUUID(), file_name: 'existing.pdf'} : null;
    let existingEntries = existing ? [{record: existing, revision: 0, approval: null, published: null, original: false}] : [];
    globalThis.fetch = async (input, init) => {
      const path = String(input);
      if (path === '/patient/reports/ai') return Response.json({extraction: sampleReports()[0].extraction, pages: 1, model: 'fictional'});
      if (!init?.method) return Response.json({reports: existingEntries});
      if (init.method === 'DELETE') { existingEntries = []; return Response.json({ok: true}); }
      writes++;
      return Response.json({error: code === 'mixed' ? (writes === 1 ? 'invalid_file' : 'duplicate') : code}, {status: 400});
    };
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(React.createElement(DemoReportsProvider, {shared: true, locale} as Parameters<typeof DemoReportsProvider>[0], React.createElement(Probe), React.createElement(ReportIntake, {locale, demo: true, demoAi: true, publicationKey: null})));
    });
    await act(async () => { await memory!.refresh(); });
    const fileInput = renderer.root.findByProps({type: 'file'});
    const files = [new File(['Fictional'], 'fictional.pdf', {type: 'application/pdf'})];
    if (code === 'mixed') files.push(new File(['Fictional'], 'duplicate.pdf', {type: 'application/pdf'}));
    await act(async () => { fileInput.props.onChange({target: {files}}); });
    const checkboxes = renderer.root.findAll(node => node.type === 'input' && node.props.type === 'checkbox');
    await act(async () => { checkboxes[0].props.onChange({target: {checked: true}}); checkboxes[1].props.onChange({target: {checked: true}}); });
    const upload = renderer.root.findAllByType('button').find(node => node.children.includes(locale === 'en' ? 'Upload for review' : 'Վերբեռնել վերանայման համար'))!;
    assert.equal(upload.props.disabled, false);
    await act(async () => { await upload.props.onClick(); });
    const alerts = renderer.root.findAll(node => node.type === 'p' && node.props.role === 'alert');
    assert.equal(alerts.length, 1, 'One actionable upload error replaces repeated error paragraphs');
    if (code !== 'mixed') assert.equal(alerts[0].children.join(''), reportFailureMessage(code, locale));
    else {
      assert.ok(JSON.stringify(renderer.toJSON()).includes(reportFailureMessage('invalid_file', locale)));
      assert.ok(JSON.stringify(renderer.toJSON()).includes(reportFailureMessage('duplicate', locale)), 'Mixed failures identify both actionable reasons');
    }
    assert.equal(memory!.reports.length, existing ? 1 : 0, 'A rejected upload leaves no optimistic report and preserves any original');
    assert.equal(writes, code === 'mixed' ? 2 : 1);
    assert.equal(upload.props.disabled, false, 'Failure leaves upload available for retry');
    if (existing) {
      const remove = renderer.root.findAllByType('button').find(node => node.children.includes(locale === 'en' ? 'Remove this report' : 'Հեռացնել փաստաթուղթը'))!;
      await act(async () => { await remove.props.onClick(); });
      assert.equal(memory!.reports.length, 0);
      assert.equal(renderer.root.findAll(node => node.type === 'p' && node.props.role === 'alert').length, 0, 'Removing the original clears the now-stale duplicate error');
    } else {
      await act(async () => { fileInput.props.onChange({target: {files: [new File(['New fictional file'], 'replacement.pdf', {type: 'application/pdf'})]}}); });
      assert.equal(renderer.root.findAll(node => node.type === 'p' && node.props.role === 'alert').length, 0, 'Selecting a replacement does not resurrect the previous upload error');
    }
    await act(async () => { renderer.unmount(); });
  }
  globalThis.fetch = async () => Response.json({error: 'unavailable'}, {status: 503});
  let unavailableRenderer!: ReturnType<typeof create>;
  await act(async () => { unavailableRenderer = create(React.createElement(DemoReportsProvider, {shared: true, locale: 'en'} as Parameters<typeof DemoReportsProvider>[0], React.createElement(Probe))); });
  await act(async () => { await memory!.refresh().catch(() => {}); });
  const loadError = memory!.persistenceError;
  assert.ok(loadError);
  await act(async () => { memory!.clearUploadError(); });
  assert.equal(memory!.persistenceError, loadError, 'Resetting a file attempt never dismisses a report-history outage');
  await act(async () => { unavailableRenderer.unmount(); });
} finally {
  globalThis.fetch = originalFetch;
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow); else Reflect.deleteProperty(globalThis, 'window');
  if (originalReader) Object.defineProperty(globalThis, 'FileReader', originalReader); else Reflect.deleteProperty(globalThis, 'FileReader');
}
console.log('Report upload UI checks passed: EN/HY file, duplicate, quota and outage errors; single alert, rollback and retry through actual component handlers (mocked network).');
