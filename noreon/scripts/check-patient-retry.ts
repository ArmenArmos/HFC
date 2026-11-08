import assert from 'node:assert/strict';
import { Children, isValidElement, type ReactElement } from 'react';
import { ErrorBoundaryHandler } from 'next/dist/client/components/error-boundary';
import PatientError from '@/app/patient/error';

// Use the installed framework callbacks: legacy reset keeps the cached failed
// server segment, whereas retry must request fresh data before clearing it.
let unavailable = true, refreshes = 0;
const boundary = new ErrorBoundaryHandler({
  pathname: '/patient/profile', errorComponent: PatientError,
  errorStyles: null, errorScripts: null, children: null,
});
boundary.context = { refresh() { refreshes++; unavailable = false; } } as never;
boundary.setState = ((patch: object) => { Object.assign(boundary.state, patch); }) as typeof boundary.setState;
const props = { reset: boundary.reset, retry: boundary.retry };
const view = PatientError(props);
const button = Children.toArray(view.props.children).find(child =>
  isValidElement(child) && typeof (child.props as { onClick?: unknown }).onClick === 'function',
) as ReactElement<{ onClick: () => void }>;
assert.ok(button, 'Recovery must expose an operable retry button');
button.props.onClick();
assert.equal(refreshes, 1, 'Retry must refetch the failed server segment, not just clear its error');
assert.equal(unavailable, false, 'A recovered server read must be reached');
assert.equal(boundary.state.error, null);
console.log('Patient error retry requests fresh server data through the installed Next boundary.');
