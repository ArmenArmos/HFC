import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {TestOrders} from '@/components/patient-care/test-orders';
import type {CareTest} from '@/lib/patient-care/types';
// Recorded clinical orders keep their original wording in every locale, status and source.
const base:CareTest={id:'lipid-panel',title:'Lipid profile with LDL-C',status:'ordered',orderedAt:'2026-10-15T04:00:00Z',orderedBy:'Fixture doctor',dueAt:null,source:'clinic',sourceLabel:'Fixture clinic',preparation:'',location:null};
const render=(test:CareTest,locale:'en'|'hy'='hy')=>renderToStaticMarkup(createElement(TestOrders,{tests:[test],locale}));
const before=JSON.stringify(base);
for(const source of ['clinic','laboratory','member'] as const) assert.match(render({...base,source}),/Lipid profile with LDL-C/,'Provider clinical record title is preserved');
for(const status of ['ordered','booked','collected','cancelled'] as const) assert.match(render({...base,status}),/Lipid profile with LDL-C/,'Status never changes the recorded title');
assert.match(render({...base,title:'Լիպիդային պրոֆիլ և LDL-C'},'en'),/Լիպիդային պրոֆիլ և LDL-C/,'A stored title is shown as recorded');
assert.match(render(base),/Fixture doctor/,'The ordering clinician is shown');
assert.equal(JSON.stringify(base),before,'Presentation never mutates the order');
console.log('Actual TestOrders: recorded titles, ordering clinician and immutable data across sources, statuses and locales.');
