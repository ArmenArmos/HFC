import {z} from 'zod';
import {scheduleCommandSchema} from '@/lib/clinic-scheduling/schema';
export const chatQuerySchema=z.discriminatedUnion('kind',[
 z.strictObject({kind:z.literal('home')}),
 z.strictObject({kind:z.literal('records')}),
 z.strictObject({kind:z.literal('bookings'),scope:z.enum(['upcoming','past']),day:z.iso.date().nullable()}),
 z.strictObject({kind:z.literal('batches'),cursor:z.string().min(1).max(1024).nullable()}),
 z.strictObject({kind:z.literal('batch'),batchId:z.uuid(),cursor:z.string().min(1).max(1024).nullable()}),
 z.strictObject({kind:z.literal('members'),query:z.string().trim().max(100),page:z.number().int().min(1).max(10000)}),
 z.strictObject({kind:z.literal('member'),memberId:z.uuid()}),
]);
export type ChatQuery=z.infer<typeof chatQuerySchema>;
/** The chat uses the same guarded booking command as the booking page. */
export const chatCommandSchema=scheduleCommandSchema;
