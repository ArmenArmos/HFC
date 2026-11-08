import {z} from 'zod';
const measurement=z.object({op:z.literal('measurement'),submissionId:z.uuid(),measuredAt:z.iso.datetime({offset:true}),systolic:z.number().int().min(60).max(300),diastolic:z.number().int().min(30).max(200),pulse:z.number().int().min(20).max(250).optional()});
const note=z.object({op:z.literal('note'),kind:z.enum(['evidence','contact-attempted','reached','unreachable','refer-doctor']),note:z.string().trim().min(1).max(2000)});
export const careCommandSchema=z.discriminatedUnion('op',[
 measurement.extend({caseId:z.uuid(),caseRevision:z.number().int().nonnegative()}).strict(),
 note.extend({caseId:z.uuid(),caseRevision:z.number().int().nonnegative()}).strict(),
]);
export const nativeCareCommandSchema=z.discriminatedUnion('op',[
 measurement.extend({id:z.uuid(),revision:z.number().int().nonnegative()}).strict(),
 note.extend({id:z.uuid(),revision:z.number().int().nonnegative()}).strict(),
]);
