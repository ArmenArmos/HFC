import assert from 'node:assert/strict';
import { bookingFailure, clinicalBookingFailure } from '../lib/real-booking/form-error';
assert.equal(bookingFailure({ code: 'P0001', message: 'Choose a future preferred time' }).code, 'past-time');
assert.equal(bookingFailure({ code: 'P0001', message: 'Choose valid future preferred terms' }).code, 'past-time');
assert.equal(bookingFailure({ code: '40001', message: 'internal context detail' }).code, 'conflict');
assert.equal(bookingFailure({ code: '55P03', message: 'lock unavailable' }).code, 'conflict');
assert.equal(bookingFailure({ code: 'XX000', message: 'private database detail' }).message.includes('private database detail'), false);
assert.equal(bookingFailure(new Error('private server detail')).message.includes('private server detail'), false);
assert.equal(bookingFailure(new SyntaxError('Unexpected token with private input')).code, 'invalid');
assert.equal(bookingFailure(new Error('Your recommended tests changed. Reload before requesting.')).code, 'conflict');
console.log('Booking errors preserve actionable time/conflict states without exposing raw database details.');

assert.equal(bookingFailure({message:'Resolve the pending cancellation first'}).code,'provider-action');
assert.equal(bookingFailure(new Error('Urgent guidance takes priority over routine publication.')).code,'clinical-hold');
assert.equal(clinicalBookingFailure(new Error('private unknown clinical detail')),undefined);

assert.equal(bookingFailure(new TypeError('Synthetic transport failure')).outcomeUnknown,true,'A lost RPC response must not claim that the write failed');
assert.equal(bookingFailure(new SyntaxError('invalid input')).outcomeUnknown,undefined,'Validation failures remain definite');
