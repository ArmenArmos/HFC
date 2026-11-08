import assert from 'node:assert/strict';
import {bookingTermsSchema,providerInputSchema} from '@/lib/real-booking/schema';
import {realBookingEnabled} from '@/lib/real-booking/config';
assert.equal(realBookingEnabled({}),false);
const terms={startsAt:'2026-11-01T08:00:00+04:00',endsAt:'2026-11-01T10:00:00+04:00',timezone:'Asia/Yerevan',mode:'clinic',location:'Member requested location'};
assert.equal(bookingTermsSchema.safeParse(terms).success,true);
assert.equal(bookingTermsSchema.safeParse({...terms,endsAt:terms.startsAt}).success,false);
assert.equal(providerInputSchema.safeParse({provider:'Provider',terms,obtainedAt:'2026-10-13T10:00:00Z',channel:'phone',source:'Actual provider conversation',preparation:''}).success,false);
console.log('Real booking validation checks passed');
