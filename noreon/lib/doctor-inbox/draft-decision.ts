import {z} from 'zod';
import {actionsResultSchema,commandResultSchema} from '@/lib/conversation-persistence/contracts';
import {doctorInboxSchema,rejectReasons} from './contracts';

/**
 * One-tap Approve and Reject of a reply draft from the doctor's Today inbox. There is no new send path: Approve and
 * Reject are the conversation review's own commands (conversation_actions issues the intents, conversation_command
 * consumes one), and both are bound to the exact draft revision and content hash the doctor saw in the inbox.
 * Before any intent is asked for, the inbox is read again and the item must still offer the action (for Approve: the
 * database's approvable flag, which excludes drafts that need judgement, are stale, quote a replaced plan, or belong
 * to a member with an unresolved care alert). Approve is then sent through doctor_inbox_approve, which re-checks that
 * eligibility under the member's care-alert lock and calls conversation_command in the same transaction (Astra ID-01).
 */
export const draftDecisionSchema=z.discriminatedUnion('decision',[
 z.object({decision:z.literal('approve'),memberId:z.uuid(),draftId:z.uuid(),revision:z.coerce.number().int().positive(),contentHash:z.string().min(1).max(200)}),
 z.object({decision:z.literal('reject'),memberId:z.uuid(),draftId:z.uuid(),revision:z.coerce.number().int().positive(),contentHash:z.string().min(1).max(200),
  reason:z.enum(rejectReasons),note:z.string().max(500).transform(s=>s.trim())}).refine(v=>v.reason!=='other'||v.note.length>0,'A note is needed for "other"'),
]);
export type DraftDecision=z.infer<typeof draftDecisionSchema>;

export type DraftDecisionPorts={
 /** doctor_ai_inbox, as the signed-in doctor. */inbox:()=>Promise<unknown>;
 /** conversation_actions(memberId): the existing intent issuer. */actions:(memberId:string)=>Promise<unknown>;
 /** conversation_command: the existing exact-reply command (Reject). */command:(input:unknown)=>Promise<unknown>;
 /** doctor_inbox_approve(memberId, command): the inbox gate, then the same conversation_command (Approve). */approve:(memberId:string,input:unknown)=>Promise<unknown>;
 /** conversation_draft_reject_reason. */recordReason:(draftId:string,reason:string,note:string|null)=>Promise<unknown>;
 requestId:()=>string;
};
export type DraftNotice='draft_approved'|'draft_rejected'|'draft_rejected_no_reason'|'draft_changed'|'draft_invalid'|'unavailable';

export async function decideInboxDraft(ports:DraftDecisionPorts,raw:unknown):Promise<DraftNotice>{
 const parsed=draftDecisionSchema.safeParse(raw);
 if(!parsed.success)return 'draft_invalid';
 const v=parsed.data;
 // 1. The item as the inbox shows it now.
 const inbox=doctorInboxSchema.safeParse(await ports.inbox());
 if(!inbox.success)return 'unavailable';
 const item=inbox.data.items.find(i=>i.memberId===v.memberId&&i.draft?.draftId===v.draftId);
 const d=item?.draft;
 if(!item||!d||d.revision!==v.revision||d.contentHash!==v.contentHash)return 'draft_changed';
 if(v.decision==='approve'&&(!d.approvable||item.confidence==='L'))return 'draft_changed';
 // 2. Intents from the existing issuer, for the same revision and text.
 const issued=actionsResultSchema.safeParse(await ports.actions(v.memberId));
 if(!issued.success||!issued.data.ok)return 'draft_changed';
 const view=issued.data.view;
 if(view.draft.revision!==v.revision||view.draft.contentHash!==v.contentHash)return 'draft_changed';
 const purpose=v.decision==='approve'?'reply.approve':'reply.reject';
 const intent=view.actions.find(a=>a.purpose===purpose);
 if(!intent)return 'draft_changed';
 // 3. The existing command; it re-checks actor, grant, assignment, revision, context and hash. Approve passes the
 //    inbox gate in the same transaction first.
 const input={schema:1,purpose,intentId:intent.intentId,requestId:ports.requestId()};
 const result=commandResultSchema.safeParse(await(v.decision==='approve'?ports.approve(v.memberId,input):ports.command(input)));
 if(!result.success)return 'unavailable';
 if(!result.data.ok||result.data.purpose!==purpose)return 'draft_changed';
 if(v.decision==='approve')return 'draft_approved';
 // 4. The reason, once the rejection is recorded.
 try{
  const r=z.object({ok:z.boolean()}).safeParse(await ports.recordReason(v.draftId,v.reason,v.note||null));
  return r.success&&r.data.ok?'draft_rejected':'draft_rejected_no_reason';
 }catch{return 'draft_rejected_no_reason';}
}
