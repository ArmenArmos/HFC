import 'server-only';
import {z} from 'zod';
import {staffWorkspaceSchema} from '@/lib/conversation-persistence/contracts';
import {doctorModeSchema,topicBreaksSchema} from '@/lib/zoe/doctor-mode';
import {zoeReplyDraftsSchema} from '@/lib/zoe/reply-draft-contracts';
import {zoePipelineEnabled} from '@/lib/zoe/policy';
import type {DocumentRpc} from '@/lib/doctor-completion/document-runtime';

/** Same end-user RPCs as the conversation page: each authorizes the assigned doctor and audits the read.
 * Optional Zoe context failing never hides the doctor's conversation. A permission failure fails the whole read closed.
 */
const reviewCursorSchema=z.object({conversationId:z.uuid(),memberId:z.uuid(),version:z.number().int().nonnegative(),reviewed:z.boolean()});

export async function readEverydayConversation(client:DocumentRpc,memberId:string,env:Record<string,string|undefined>=process.env){
 const pipeline=zoePipelineEnabled(env);
 const r=await client.rpc('doctor_chat_retry_conversation',{p_member:memberId});
 // 42501 identifies the refused read, not which of its authorization predicates failed.
 // In particular it is not evidence that the member was reassigned.
 if(r.error)return r.error.code==='42501'?{kind:'refused' as const,reason:'conversation_access' as const}:{kind:'unavailable' as const};
 const guarded=z.object({workspace:staffWorkspaceSchema,mode:doctorModeSchema,modeRevision:z.string().regex(/^[a-f0-9]{32}$/),zoeReview:reviewCursorSchema.nullable()}).safeParse(r.data);
 if(!guarded.success)return {kind:'unavailable' as const};
 const {workspace:initial,mode,modeRevision}=guarded.data;
 // The approval guard is always required, including when optional Zoe context is switched off.
 if(!pipeline)return {kind:'ready' as const,initial,modeRevision,mode,zoeReview:null,topicBreaks:[] as number[],replyDrafts:null};
 const [topics,drafts]=await Promise.all([
  client.rpc('doctor_conversation_topic_breaks',{p_member:memberId}),client.rpc('zoe_reply_drafts_for_doctor',{p_member:memberId}),
 ]);
 if([topics,drafts].some(r=>r.error?.code==='42501'))return {kind:'refused' as const,reason:'zoe_context_access' as const};
 const cursor=guarded.data.zoeReview;
 const t=topicBreaksSchema.safeParse(topics.data),d=zoeReplyDraftsSchema.safeParse(drafts.data);
 return {kind:'ready' as const,initial,mode,modeRevision,
  // A cursor is valid only for exactly the conversation snapshot being shown. The write checks it again under lock.
  zoeReview:cursor&&'conversationId'in initial&&cursor.memberId===memberId&&cursor.conversationId===initial.conversationId&&cursor.version===initial.version?cursor:null,
  topicBreaks:!topics.error&&t.success?t.data.breaks.map(b=>b.afterSeq):[],replyDrafts:!drafts.error&&d.success?d.data.drafts:null};
}
