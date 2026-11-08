import {z} from 'zod';
import {nurseReplyViewSchema} from '@/lib/nurse-chat/contracts';
/** Same size cap as a Telegram text message; the database enforces it too. */
export const memberCommandSchema=z.strictObject({requestId:z.uuid().transform(value=>value.toLowerCase()),text:z.string().min(1).max(4096)});
export const proposalSchema=z.strictObject({memberId:z.uuid().transform(value=>value.toLowerCase()),requestId:z.uuid().transform(value=>value.toLowerCase()),expectedVersion:z.number().int().nonnegative(),expectedClinicalRevision:z.number().int().nonnegative(),expectedDraftEpoch:z.number().int().nonnegative(),expectedSource:z.string().min(1).max(128),body:z.string().min(1).max(8000),summary:z.string().min(1).max(16000),provenance:z.strictObject({kind:z.enum(['synthetic','clinical']),engine:z.string().min(1).max(128),version:z.string().min(1).max(128),protocolVersion:z.string().min(1).max(128)})});
export const outcomeSchema=z.discriminatedUnion('kind',[z.strictObject({kind:z.literal('accepted'),providerRef:z.string().min(1).max(256)}),z.strictObject({kind:z.literal('definitely_failed'),evidence:z.string().min(1).max(512)}),z.strictObject({kind:z.literal('unknown'),reason:z.string().min(1).max(512)})]);
export type Proposal=z.infer<typeof proposalSchema>;
export type RpcResult={data:unknown;error:{code?:string;message?:string}|null};
export type ConversationRpc={rpc(name:string,args:Record<string,unknown>):PromiseLike<RpcResult>};
export const envelopeSchema=z.strictObject({deliveryId:z.uuid().transform(value=>value.toLowerCase()),attemptId:z.uuid().transform(value=>value.toLowerCase()),attemptSeq:z.literal(1),endpointId:z.uuid().transform(value=>value.toLowerCase()),address:z.string().min(1),generation:z.number().int(),body:z.string(),contentHash:z.string(),approvalId:z.uuid().transform(value=>value.toLowerCase()),approvedBy:z.strictObject({staffId:z.uuid().transform(value=>value.toLowerCase()),displayName:z.string(),role:z.literal('doctor'),clinicId:z.uuid().transform(value=>value.toLowerCase())})});
export const claimSchema=z.union([z.object({ok:z.literal(false),code:z.string()}),z.object({ok:z.literal(true),fresh:z.literal(true),adapter:z.string(),accountRef:z.string(),envelope:envelopeSchema})]);
/** CR2 typed recording result. `retryable` failures never authorise another send. */
export const outcomeResultSchema=z.union([z.strictObject({ok:z.literal(true),result:z.enum(['recorded','duplicate','conflict','late'])}),z.strictObject({ok:z.literal(false),code:z.string(),retryable:z.boolean()})]);
export type OutcomeResult=z.infer<typeof outcomeResultSchema>;
export const observeResultSchema=z.union([z.strictObject({ok:z.literal(true),result:z.enum(['retained','conflict'])}),z.strictObject({ok:z.literal(false),code:z.string(),retryable:z.boolean()})]);
export type ObserveResult=z.infer<typeof observeResultSchema>;
export const retryDeliveryResultSchema=z.union([z.strictObject({ok:z.literal(true),deliveryId:z.uuid(),replayed:z.boolean()}),z.strictObject({ok:z.literal(false),code:z.string()})]);
const failure=z.strictObject({ok:z.literal(false),code:z.string()});
export const receiveResultSchema=z.union([failure,z.strictObject({ok:z.literal(true),conversationId:z.uuid().transform(value=>value.toLowerCase()),version:z.number().int().nonnegative(),replayed:z.boolean()})]);
export const memberWorkspaceSchema=z.union([z.strictObject({ok:z.literal(true),conversation:z.null()}),z.strictObject({ok:z.literal(true),conversationId:z.uuid().transform(value=>value.toLowerCase()),version:z.number().int().nonnegative(),messages:z.array(z.strictObject({seq:z.number().int(),text:z.string(),at:z.string(),author:z.literal('member')})),nurseReplies:z.array(nurseReplyViewSchema).optional(),replies:z.array(z.strictObject({approvalId:z.uuid().transform(value=>value.toLowerCase()),body:z.string(),approvedAt:z.string(),approvedBy:z.strictObject({displayName:z.string()}),deliveryState:z.enum(['accepted_by_provider','unknown'])}))})]);
export const memberRequestSchema=z.discriminatedUnion('op',[z.strictObject({op:z.literal('receive'),command:memberCommandSchema}),z.strictObject({op:z.literal('read')})]);
const proposalResult=z.strictObject({ok:z.literal(true),draftId:z.uuid().transform(value=>value.toLowerCase()),revision:z.number().int(),replayed:z.boolean()});
export const proposalResultSchema=z.union([failure,proposalResult]);
export const commandResultSchema=z.union([failure,proposalResult.extend({purpose:z.enum(['reply.approve','reply.edit','reply.reject','reply.request_info']),approvalId:z.uuid().transform(value=>value.toLowerCase()).optional(),deliveryId:z.uuid().transform(value=>value.toLowerCase()).optional()})]);
export const actionsResultSchema=z.union([failure,z.strictObject({ok:z.literal(true),view:z.strictObject({conversationId:z.uuid().transform(value=>value.toLowerCase()),conversationVersion:z.number().int(),draft:z.strictObject({revision:z.number().int(),body:z.string(),summary:z.string(),contentHash:z.string(),author:z.enum(['staff','ai_assistant'])}),actions:z.array(z.strictObject({purpose:z.enum(['reply.approve','reply.edit','reply.reject','reply.request_info']),intentId:z.string().regex(/^[a-f0-9]{32}$/)}))})})]);
const revisionSchema=z.strictObject({draft_id:z.uuid().transform(value=>value.toLowerCase()),revision:z.number().int(),body:z.string(),summary:z.string(),content_hash:z.string(),author_id:z.uuid().transform(value=>value.toLowerCase()).nullable(),author_kind:z.enum(['staff','ai_assistant']),provenance:z.json(),created_at:z.string()});
const approvalSchema=z.strictObject({id:z.uuid().transform(value=>value.toLowerCase()),draft_id:z.uuid().transform(value=>value.toLowerCase()),revision:z.number().int(),context_version:z.number().int(),content_hash:z.string(),body:z.string(),doctor_id:z.uuid().transform(value=>value.toLowerCase()),doctor_name:z.string(),doctor_role:z.literal('doctor'),clinic_id:z.uuid().transform(value=>value.toLowerCase()),grant_id:z.uuid().transform(value=>value.toLowerCase()),grant_generation:z.number().int(),intent_id:z.uuid().transform(value=>value.toLowerCase()),created_at:z.string()});
export const staffWorkspaceSchema=z.union([z.strictObject({ok:z.literal(true),conversation:z.null()}),z.strictObject({ok:z.literal(true),conversationId:z.uuid().transform(value=>value.toLowerCase()),version:z.number().int(),messages:z.array(z.strictObject({seq:z.number().int(),text:z.string(),at:z.string(),author:z.literal('member')})),nurseReplies:z.array(nurseReplyViewSchema).optional(),replies:z.array(z.strictObject({approvalId:z.uuid().transform(value=>value.toLowerCase()),body:z.string(),approvedAt:z.string(),approvedBy:z.strictObject({staffId:z.uuid().transform(value=>value.toLowerCase()),displayName:z.string(),role:z.literal('doctor'),clinicId:z.uuid().transform(value=>value.toLowerCase())}),deliveryState:z.enum(['accepted_by_provider','unknown']),reviewAfterSend:z.boolean()})),memberName:z.string().default(''),unsavedOverLimit:z.boolean().default(false),unsupportedMedia:z.boolean().default(false),clinicalRevision:z.number().int(),draftEpoch:z.number().int(),sourceToken:z.string(),drafts:z.array(z.strictObject({id:z.uuid().transform(value=>value.toLowerCase()),conversation_id:z.uuid().transform(value=>value.toLowerCase()),revision:z.number().int(),state:z.enum(['pending','approved','rejected','info_requested','superseded']),context_version:z.number().int(),clinical_revision:z.number().int(),source_token:z.string(),created_at:z.string(),revisions:z.array(revisionSchema)})),deliveries:z.array(z.strictObject({id:z.uuid().transform(value=>value.toLowerCase()),conversation_id:z.uuid().transform(value=>value.toLowerCase()),approval_id:z.uuid().transform(value=>value.toLowerCase()),state:z.enum(['queued','held','sending','accepted_by_provider','definitely_failed','unknown']),reason:z.string().nullable(),state_seq:z.number().int(),endpoint_id:z.uuid().transform(value=>value.toLowerCase()).nullable(),endpoint_generation:z.number().int().nullable(),policy_version:z.string().nullable(),review_after_send:z.boolean(),created_at:z.string(),retry_of:z.uuid().nullable().optional(),can_retry:z.boolean().optional(),approval:approvalSchema}))})]);

export const manualProposalSchema=proposalSchema.omit({provenance:true});
export const summaryEditSchema=z.strictObject({memberId:z.uuid().transform(value=>value.toLowerCase()),requestId:z.uuid().transform(value=>value.toLowerCase()),draftId:z.uuid().transform(value=>value.toLowerCase()),expectedRevision:z.number().int().positive(),summary:z.string().min(1).max(16000)});

export type StaffConversationWorkspace=z.infer<typeof staffWorkspaceSchema>;
export type ConversationActions=z.infer<typeof actionsResultSchema>;
export type ConversationCommandResult=z.infer<typeof commandResultSchema>;

export const recoverySchema=z.discriminatedUnion('kind',[
 z.strictObject({kind:z.literal('command'),input:z.unknown()}),
 z.strictObject({kind:z.literal('compose'),input:manualProposalSchema}),
 z.strictObject({kind:z.literal('summary'),input:summaryEditSchema}),
]);
export const recoveryResultSchema=z.union([z.strictObject({status:z.literal('unknown')}),z.strictObject({status:z.literal('not-recorded'),requestId:z.string(),serialized:z.literal(true)}),z.strictObject({status:z.literal('recorded'),result:z.union([proposalResultSchema,commandResultSchema])})]);
export type ConversationRecovery=z.infer<typeof recoverySchema>;

/**
 * D2 (TG-06): a reply is normalised before it is saved and hashed, so the doctor
 * approves exactly the text that can be delivered. Delivery never edits text.
 */
export const normalizeReplyBody=(body:string)=>body.replace(/\r\n?/g,'\n').trim();

/** CR6: the only conversation facts an engine may read. No IDs, grants, intents or source tokens. */
export function engineContextFrom(context:Extract<StaffConversationWorkspace,{drafts:unknown}>){
 return Object.freeze({conversationVersion:context.version,messages:context.messages.map(m=>Object.freeze({seq:m.seq,text:m.text,at:m.at})),approvedReplies:context.replies.map(r=>Object.freeze({body:r.body,approvedAt:r.approvedAt}))});
}
export type EngineContext=ReturnType<typeof engineContextFrom>;

export const awaitingRepliesSchema=z.strictObject({ok:z.literal(true),items:z.array(z.strictObject({memberId:z.uuid().transform(value=>value.toLowerCase()),memberName:z.string(),lastMessageAt:z.string(),unanswered:z.number().int().nonnegative(),latestDelivery:z.enum(['queued','held','sending','accepted_by_provider','definitely_failed','unknown']).nullable(),latestReason:z.string().nullable(),reason:z.enum(['new_message','not_delivered']),mediaPending:z.boolean().default(false),overLimit:z.boolean(),channel:z.enum(['telegram','app'])}))});
export type AwaitingReplies=z.infer<typeof awaitingRepliesSchema>;
const problemHistory=z.array(z.strictObject({kind:z.string(),detail:z.record(z.string(),z.unknown()),at:z.string()})).nullable();
export const deliveryProblemsSchema=z.strictObject({ok:z.literal(true),asOf:z.string(),unapprovedHeld:z.number().int().nonnegative(),
 system:z.array(z.strictObject({id:z.uuid(),memberId:z.uuid(),memberName:z.string(),template:z.string(),state:z.enum(['held','definitely_failed','unknown']),reason:z.string().nullable(),createdAt:z.string(),updatedAt:z.string(),history:problemHistory})),
 replies:z.array(z.strictObject({id:z.uuid(),memberId:z.uuid(),memberName:z.string(),doctorName:z.string(),state:z.enum(['held','definitely_failed','unknown']),reason:z.string().nullable(),approvedAt:z.string(),history:problemHistory})),
 inbox:z.strictObject({dead:z.number().int(),pending:z.number().int()})});
export type DeliveryProblems=z.infer<typeof deliveryProblemsSchema>;

/** Fixed diagnostics only; never log arbitrary RPC result text as a code. */
export const conversationFailureCodes=[
 'approval_access','refused','disabled','invalid','invalid_command','stale_context',
 'conversation_unknown','draft_not_pending','intent_unknown','intent_actor_mismatch',
 'intent_invalidated','content_hash_mismatch','request_conflict','command_retired',
 'clinical_engine_unavailable','policy_unavailable','route_unavailable','route_policy_missing',
 'approval_authority_lapsed','delivery_unknown','delivery_not_retryable','busy',
] as const;
