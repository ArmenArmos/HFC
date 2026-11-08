import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// QA F-07: the Visit slots page may say bookings email the clinic only when the
// email channel is on. Both early returns must come before that sentence.
const page=readFileSync('app/staff/real/(review)/booking-slots/page.tsx','utf8');
const replaced=page.indexOf('if(homeRequestsOnly())return'),notInUse=page.indexOf('if(!bookingChannelConfigured())return'),email=page.indexOf('emails the clinic scheduling address');
assert.ok(replaced>0,'scheduling on, email off: "Replaced by clinic hours"');
assert.ok(notInUse>replaced,'both channels off: "Not in use"');
assert.match(page.slice(notInUse,page.indexOf('</section>',notInUse)),/Not in use[\s\S]*Slots are not offered to members/);
assert.ok(email>notInUse,'the clinic-email sentence only renders after both gates');
console.log('Visit slots copy: clinic-email sentence only when the email channel is on PASS.');
