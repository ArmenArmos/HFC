import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseRegistrationFilters,reachedCounts,registrationQuery,registrationsSchema,stepDetail,type RegistrationRow} from '@/lib/registrations/contracts';
import {actionLabel} from '@/lib/activity-log/labels';

// Filters: malformed values are dropped, never passed on.
assert.deepEqual(parseRegistrationFilters({step:'4',stuck:'7'}),{step:4,stuck:7});
assert.deepEqual(parseRegistrationFilters({step:'11',stuck:'0'}),{step:null,stuck:null});
assert.deepEqual(parseRegistrationFilters({step:"1; drop",stuck:['14','3']}),{step:null,stuck:14});
assert.equal(registrationQuery({step:5,stuck:null}),'step=5');
assert.equal(registrationQuery({step:null,stuck:null}),'');

// Funnel: reached = at this step or further.
const reached=reachedCounts({'1':3,'2':0,'3':2,'4':1,'5':1,'10':4});
assert.equal(reached[1],11);assert.equal(reached[4],6);assert.equal(reached[10],4);assert.equal(reached[9],4);

const row:RegistrationRow={id:'cb000000-0000-4000-8000-000000000005',name:null,phoneMasked:'+374 ••• 005',signedUpAt:'2026-10-18T09:00:00+00:00',
 channel:'phone',step:5,stepAt:'2026-10-18T09:00:00+00:00',questionnaire:'completed',urgent:false,enrolled:true,doctorAssigned:false,lastActivityAt:null};
assert.equal(stepDetail(row),'Enrolled, no doctor yet');
assert.equal(stepDetail({...row,step:4,questionnaire:'started'}),'Questionnaire started');
// The page refuses a payload with fields it does not expect to carry (strip, not pass through).
const parsed=registrationsSchema.parse({ok:true,asOf:'x',counts:{},total:1,matching:1,rows:[{...row,urgentRule:'RF-01'}]});
assert.equal('urgentRule' in parsed.rows[0],false);

assert.equal(actionLabel('access','registrations.list'),'Opened the registrations list');

// The page is admin only and reads through the one audited RPC.
const page=readFileSync('app/staff/real/(review)/registrations/page.tsx','utf8');
assert.match(page,/await requireRealAdmin\(\)/);
assert.match(page,/rpc\('admin_member_registrations'/);
assert.doesNotMatch(page,/\.from\(/,'no direct table reads');
console.log('registrations: ok');
