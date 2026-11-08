import assert from 'node:assert/strict';
import {SIDE_EFFECTS} from '@/lib/zoe-chat-actions/copy';
import {sideEffectNurseFirstEnabled,sideEffectRoute} from '@/lib/member-medicines/side-effect-routing';

// Only the approved list goes to the nurse. Everything else, including what nobody has classified, stays with the doctor.
const nurse=SIDE_EFFECTS.filter(what=>sideEffectRoute(what)==='nurse');
assert.deepEqual([...nurse].sort(),['ankle_swelling','dizziness','dry_cough','frequent_urination','headache','nausea']);
for(const what of ['muscle_aches','flushing','other'] as const)assert.equal(sideEffectRoute(what),'doctor',what);
assert.equal(sideEffectNurseFirstEnabled({}),false,'off by default');
assert.equal(sideEffectNurseFirstEnabled({NOREON_SIDE_EFFECT_NURSE_FIRST:'1'}),false,'only exactly true');
assert.equal(sideEffectNurseFirstEnabled({NOREON_SIDE_EFFECT_NURSE_FIRST:'true'}),true);
console.log('Side effect routing: nurse list, doctor default and switch passed.');
