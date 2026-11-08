import assert from 'node:assert/strict';
import { localVersions, pendingVersions, unknownVersions } from './schema-pending.mjs';

const local = localVersions(['20261017084014_b5.sql', '20261018120000_a.sql', '20261019010000_b.sql', 'README.md']);
assert.deepEqual(local, ['20261017084014', '20261018120000', '20261019010000']);
assert.deepEqual(pendingVersions(local, local), [], 'everything applied');
assert.deepEqual(pendingVersions(local, ['20261017084014']), ['20261018120000', '20261019010000'], 'two pending, oldest first');
assert.deepEqual(pendingVersions(local, []), local, 'empty remote history: all pending');
// A version a failed earlier run left behind is pending even if this commit did not add it.
assert.deepEqual(pendingVersions(local, ['20261017084014', '20261019010000']), ['20261018120000'], 'gap in the middle');
assert.deepEqual(unknownVersions(local, [...local, '20261020000000']), ['20261020000000'], 'newer schema live');
assert.deepEqual(unknownVersions(local, local), []);
console.log('Schema-pending: pending = local versions missing from the remote history; newer remote versions are reported, not pending.');
