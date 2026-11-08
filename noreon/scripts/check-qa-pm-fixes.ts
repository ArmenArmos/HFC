import assert from 'node:assert/strict';
import {calendarDate,yerevanInputToInstant} from '@/lib/staff/yerevan-time';
import {memberContactsSchema,phoneText} from '@/lib/staff/member-contact-schema';
// F-12: birth dates read like every other date.
assert.equal(calendarDate('1974-03-14','en'),'14 Mar 1974');
assert.equal(calendarDate('1974-03-14','hy'),'14 մրտ 1974');
for(const raw of['1974-13-01','14/03/1974',''])assert.equal(calendarDate(raw,'en'),raw);
// F-02: the completion picker is Yerevan wall-clock time.
assert.equal(yerevanInputToInstant('2026-10-17T14:30'),'2026-10-17T14:30:00+04:00');
assert.equal(yerevanInputToInstant('2026-10-17T14:30:00+04:00'),null);
// F-01: contact rows are strict; a malformed or unexpected field is unreadable, never shown.
const id='a2c00000-0000-4000-8000-000000000004';
assert.equal(memberContactsSchema.safeParse({[id]:{phone:'+37499011004',telegramLinked:true}}).success,true);
assert.equal(memberContactsSchema.safeParse({[id]:{phone:null,telegramLinked:false}}).success,true);
for(const bad of[{phone:'37499011004',telegramLinked:true},{phone:'+374 99',telegramLinked:true},{phone:null,telegramLinked:false,email:'x'}])assert.equal(memberContactsSchema.safeParse({[id]:bad}).success,false);
assert.equal(memberContactsSchema.safeParse({'not-a-member':{phone:null,telegramLinked:false}}).success,false);
assert.equal(phoneText('+37499011004'),'+374 99 011004');
assert.equal(phoneText('+4915112345678'),'+4915112345678');
console.log('QA 17 Oct PM helpers: calendar dates, Yerevan completion time, strict member contact and phone display PASS.');
