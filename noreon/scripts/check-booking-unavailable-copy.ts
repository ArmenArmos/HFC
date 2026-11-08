import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {BookingUnavailable} from '@/components/real-booking/appointment-status';
import {profileContextMismatch} from '@/lib/real-booking/form-error';
import type {PilotBookingData} from '@/lib/real-booking/appointment-schema';

const data=(unavailableReason:PilotBookingData['unavailableReason']):PilotBookingData=>({available:false,unavailableReason,program:[],offers:[],appointments:[]});
const html=(reason:PilotBookingData['unavailableReason'],audience:'member'|'staff',locale:'en'|'hy'='en')=>renderToStaticMarkup(createElement(BookingUnavailable,{data:data(reason),locale,refreshHref:'/x',audience}));

// R2-02: a profile/questionnaire mismatch names the cause and never offers a saved-booking check.
assert.ok(profileContextMismatch(Error('Profile and questionnaire context disagree.')));
assert.ok(!profileContextMismatch(Error('Something else')));
const member=html('profile-mismatch','member');
assert.match(member,/disagree on your age or sex/);assert.match(member,/href="\/patient\/profile"/);assert.doesNotMatch(member,/Check saved booking/);
const staff=html('profile-mismatch','staff');
assert.match(staff,/Ask the member to check their profile/);assert.doesNotMatch(staff,/href="\/patient\/profile"/,"Staff never get the member profile link");assert.match(staff,/href="\/x"/,"Staff keep the reload control");
assert.match(html('profile-mismatch','member','hy'),/Ստուգել իմ պրոֆիլը/);
// S-05: staff with nothing booked are not sent to check a booking that does not exist.
assert.match(html('unavailable','staff'),/No visit is booked/);
assert.match(html('unavailable','member'),/Booking could not be loaded/);
console.log('Booking unavailable copy: profile mismatch names the cause (member link, staff instruction, EN/HY); staff empty-booking wording.');
