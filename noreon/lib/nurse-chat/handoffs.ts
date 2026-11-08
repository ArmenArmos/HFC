import {z} from 'zod';
import {taskSnapshotSchema} from '@/lib/staff/real-coordination/schema';

export const handoffTopics=['blood-pressure','side-effect','adherence','symptom','member-request','other'] as const;
export const nurseHandoffSchema=z.strictObject({
 memberId:z.uuid(),requestId:z.uuid(),messageId:z.string().min(1).max(80),
 expectedVersion:z.number().int().nonnegative(),topic:z.enum(handoffTopics),
 observation:z.string().trim().min(1).max(2000),
});
export type NurseHandoff=z.infer<typeof nurseHandoffSchema>;
export const handoffResultSchema=z.union([
 z.strictObject({ok:z.literal(true),taskId:z.uuid(),replayed:z.boolean()}),
 z.strictObject({ok:z.literal(false),code:z.enum(['off','denied','unavailable','invalid','stale_context','request_conflict','already_exists'])}),
]);
export const handoffViewSchema=z.object({messageId:z.string(),messageText:z.string(),topic:z.enum(handoffTopics),observation:z.string(),nurseName:z.string(),task:taskSnapshotSchema});
export const handoffPageSchema=z.object({items:z.array(handoffViewSchema),hasMore:z.boolean()});
export type HandoffPage=z.infer<typeof handoffPageSchema>;
