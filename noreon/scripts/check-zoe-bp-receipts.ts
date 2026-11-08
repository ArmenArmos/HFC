/** Render the actual receipt, including partial queue failures and out-of-hours timing. */
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {FlowWords} from '@/components/chat-v2/bp-flow-cards';
import {failedFlow,type BpFlow} from '@/lib/zoe-chat-actions/bp-flow';
const flow:BpFlow={...failedFlow(),zone:'orange',sentTo:'physician',taskIds:['stored-doctor'],slaHours:4,outOfHours:true};
const render=(f:BpFlow)=>renderToStaticMarkup(createElement(FlowWords,{flow:f,locale:'en'}));
const doctorOnly=render(flow);
assert.match(doctorOnly,/Your doctor will review this today/,'Closed clinic must preserve actual doctor urgency');
assert.match(doctorOnly,/within 4 hours/,'Closed clinic must preserve actual deadline');
assert.match(doctorOnly,/data-zoe-out-of-hours/);
assert.doesNotMatch(doctorOnly,/nurse/i,'A failed nurse task cannot promise a nurse');
const both=render({...flow,nurseTask:true});
assert.match(both,/Your doctor will review this today/);
assert.match(both,/within 4 hours/);
assert.match(both,/clinic nurse will see your reading/,'Original disclosure remains when the nurse task exists');
const nurseOnly=render({...flow,sentTo:'nurse',nurseTask:true});
assert.match(nurseOnly,/Your nurse will review this today/);
assert.doesNotMatch(nurseOnly,/Your doctor/);
const provisional=render({...flow,provisional:true,next:'red_flags'});
assert.match(provisional,/Your doctor will review this today/,'First same-day save acknowledges actual work even before confirmation');
console.log('BP receipts: stored ownership and deadlines survive out of hours');

// The alert's routing and urgency lead even when the averaged zone is lower.
const alert=render({...flow,zone:'yellow',taskIds:[],alertId:'stored-alert',alertReason:'bp_doctor_today',slaHours:null,outOfHours:false});
assert.match(alert,/Your doctor will review this today/);
assert.doesNotMatch(alert,/48 hours|within 4 hours|nurse|data-zoe-chip/);
const unassigned=render({...flow,sentTo:null,alertId:'stored-alert',alertReason:'bp_doctor_today',taskIds:[],outOfHours:false});
assert.doesNotMatch(unassigned,/Your doctor|Your nurse/);
