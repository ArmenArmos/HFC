import {z} from 'zod';
import {conversationFailureCodes,actionsResultSchema,staffWorkspaceSchema} from '@/lib/conversation-persistence/contracts';
import {log} from '@/lib/observability/logger';
import {doctorModeSchema} from '@/lib/zoe/doctor-mode';
import type {DecisionRpc} from './items';

export const replyCardSchema=z.object({memberId:z.uuid(),draftId:z.uuid(),revision:z.number().int().positive(),body:z.string(),summary:z.string(),author:z.enum(['staff','ai_assistant']),contentHash:z.string(),
 intentId:z.string().regex(/^[a-f0-9]{32}$/),requestId:z.string(),takeover:z.boolean(),modeRevision:z.string().regex(/^[a-f0-9]{32}$/)});
export type ReplyCard=z.infer<typeof replyCardSchema>;
export type ReplyPreparation={memberId:string;expectedVersion:number;expectedClinicalRevision:number;expectedDraftEpoch:number;expectedSource:string};
export async function readReplyCard(client:DecisionRpc,memberId:string):Promise<{card:ReplyCard|null;prepare:ReplyPreparation|null}>{
 let failureCode='prepare_failed';
 try{
 const r=await client.rpc('doctor_decision_reply',{p_member:memberId});
 if(r.error){if(r.error.code==='42501')failureCode='approval_access';throw Error('Decision reply unavailable');}
 const envelope=z.object({workspace:staffWorkspaceSchema,actions:actionsResultSchema,mode:doctorModeSchema,modeRevision:z.string()}).parse(r.data);
 const {workspace:w,actions:a,mode}=envelope;
 if(!('drafts'in w))return {card:null,prepare:null};
 const prepare={memberId,expectedVersion:w.version,expectedClinicalRevision:w.clinicalRevision,expectedDraftEpoch:w.draftEpoch,expectedSource:w.sourceToken};
 if(!a.ok){log.warn('conversation.reply_prepare',{member_id:memberId,outcome:'denied',error_code:conversationFailureCodes.some(code=>code===a.code)?a.code:'prepare_failed'});return {card:null,prepare};}
 const draft=w.drafts.find(d=>d.state==='pending');
 const intent=a.view.actions.find(i=>i.purpose==='reply.approve');
 if(!draft||!intent)return {card:null,prepare};
 return {prepare,card:replyCardSchema.parse({memberId,draftId:draft.id,revision:a.view.draft.revision,body:a.view.draft.body,summary:a.view.draft.summary,author:a.view.draft.author,contentHash:a.view.draft.contentHash,
  intentId:intent.intentId,requestId:crypto.randomUUID().replaceAll('-',''),takeover:mode.zoeActive&&!mode.doctorMode,modeRevision:envelope.modeRevision})};
 }catch{
  log.warn('conversation.reply_prepare',{member_id:memberId,outcome:failureCode==='approval_access'?'denied':'error',error_code:failureCode});
  throw Error('Decision reply unavailable');
 }
}
