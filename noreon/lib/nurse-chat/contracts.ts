import {z} from 'zod';

export const nurseReplySchema=z.strictObject({
 memberId:z.uuid(),requestId:z.uuid(),expectedVersion:z.number().int().nonnegative(),
 body:z.string().min(1).max(4096),
});
export const nurseReplyViewSchema=z.strictObject({
 id:z.uuid(),text:z.string(),at:z.string(),senderName:z.string(),senderRole:z.literal('nurse'),
});
export const nurseChatItemSchema=z.strictObject({
 id:z.string(),text:z.string(),at:z.string(),senderName:z.string(),senderRole:z.enum(['member','doctor','nurse','zoe']),
});
export const nurseWorkspaceSchema=z.union([
 z.strictObject({ok:z.literal(false),code:z.enum(['off','denied','unavailable'])}),
 z.strictObject({ok:z.literal(true),memberId:z.uuid(),memberName:z.string(),doctorName:z.string(),version:z.number().int().nonnegative(),canSend:z.boolean(),telegramLinked:z.boolean().optional(),telegramSendingEnabled:z.boolean().optional(),unsupportedMedia:z.boolean().optional(),unsavedOverLimit:z.boolean().optional(),items:z.array(nurseChatItemSchema)}),
]);
export const nurseSendResultSchema=z.union([
 z.strictObject({ok:z.literal(true),replyId:z.uuid(),replayed:z.boolean()}),
 z.strictObject({ok:z.literal(false),code:z.enum(['off','denied','unavailable','invalid','stale_context','request_conflict'])}),
]);
export type NurseWorkspace=z.infer<typeof nurseWorkspaceSchema>;
export type NurseSendResult=z.infer<typeof nurseSendResultSchema>;
export type NurseReply=z.infer<typeof nurseReplySchema>;
export type NurseReplyView=z.infer<typeof nurseReplyViewSchema>;
