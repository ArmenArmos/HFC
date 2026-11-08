import {z} from 'zod';
/** Read-only linkage contract for the nurse integration. No RPC or new nurse
 * authority is implemented by this schema. The server must resolve and lock
 * the accepted version again for each collection command. */
export const nurseBookingContextSchema=z.strictObject({
 version:z.literal('booking-visit-context-v1'),
 appointmentId:z.uuid(),
 // The version associated with current_reservation_id's accepted notice;
 // never blindly use the appointment's latest proposed revision.
 acceptedRevision:z.number().int().nonnegative().safe(),
 tests:z.array(z.strictObject({id:z.string().min(1).max(100),title:z.string().min(1).max(500),method:z.enum(['lab','clinic'])})).min(1).max(100),
}).refine(value=>new Set(value.tests.map(test=>test.id)).size===value.tests.length,'Duplicate assigned test');
export type NurseBookingContext=z.infer<typeof nurseBookingContextSchema>;
