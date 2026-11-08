import assert from 'node:assert/strict';
import ReportError from '@/app/patient/reports/error';
let reloads = 0;
Object.assign(globalThis, {window: {location: {reload() {reloads++;}}}});
try {
  const rendered = ReportError();
  const retry = rendered.props.children.find((child: unknown) => !!child && typeof child === 'object' && 'props' in child && typeof (child as {props: {onClick?: unknown}}).props.onClick === 'function');
  assert.ok(retry, 'Report failure exposes retry');
  retry.props.onClick();
  assert.equal(reloads, 1, 'Retry makes a fresh server request instead of resetting the cached failed render');
  console.log('Report retry requests a fresh authenticated render.');
} finally {Reflect.deleteProperty(globalThis, 'window');}
