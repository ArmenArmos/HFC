import 'server-only';
import {z} from 'zod';
import {commandSchema} from '@/lib/conversation-core/contracts';
import {retryDeliveryResultSchema,memberCommandSchema,proposalSchema,outcomeSchema,claimSchema,memberWorkspaceSchema,staffWorkspaceSchema,receiveResultSchema,proposalResultSchema,commandResultSchema,actionsResultSchema,manualProposalSchema,summaryEditSchema,recoverySchema,recoveryResultSchema,outcomeResultSchema,awaitingRepliesSchema,deliveryProblemsSchema,normalizeReplyBody,type ConversationRpc} from './contracts';
import {zoeAnsweredListSchema} from '@/lib/doctor-inbox/zoe-answered';
import {nurseWorkspaceSchema,nurseReplySchema,nurseSendResultSchema} from '@/lib/nurse-chat/contracts';
import {telegramEnabled} from '@/lib/telegram-runtime/config';
/** D2: compose and edit bodies are normalised before the database hashes them. */
function normalizedBody(input:unknown){
 if(input&&typeof input==='object'&&'body'in input&&typeof input.body==='string')return {...input,body:normalizeReplyBody(input.body)};
 return input;
}
/** Each call is one SQL transaction; this never loads/saves an in-memory CoreState. */
export class ConversationRepository {
 private client:ConversationRpc;
 constructor(client:ConversationRpc){this.client=client;}
 async call(name:string,args:Record<string,unknown>){
  try{
   const r=await this.client.rpc(name,args);
   if(r.error?.code==='42501'&&['conversation_actions','conversation_compose','conversation_propose','conversation_edit_summary','conversation_command','doctor_decision_reply_apply','conversation_retry_delivery'].includes(name))return {ok:false,code:'approval_access'};
   if(r.error)throw Error('Conversation unavailable');
   return r.data;
  }catch{
   // Transport failures remain uncertain. Never rethrow database/provider text.
   throw Error('Conversation unavailable');
  }
 }
 async receive(input:unknown,toDoctor=false){return receiveResultSchema.parse(await this.call('conversation_receive',{p_command:memberCommandSchema.parse(input),p_to_doctor:z.boolean().parse(toDoctor)}));}
 async workspace(memberId:string|null=null){return(memberId===null?memberWorkspaceSchema:staffWorkspaceSchema).parse(await this.call(memberId===null?'conversation_workspace':'conversation_retry_workspace',{p_member:memberId===null?null:z.uuid().parse(memberId)}));}
 async intakeWorkspace(memberId:string){return memberWorkspaceSchema.parse(await this.call('conversation_intake_workspace',{p_member:z.uuid().parse(memberId)}));}
 async nurseWorkspace(memberId:string){return nurseWorkspaceSchema.parse(await this.call('conversation_nurse_workspace',{p_member:z.uuid().parse(memberId),p_telegram_enabled:telegramEnabled()}));}
 async nurseReply(input:unknown){const p=nurseReplySchema.parse(normalizedBody(input));return nurseSendResultSchema.parse(await this.call('conversation_nurse_reply',{p_member:p.memberId,p_request_id:p.requestId,p_expected_version:p.expectedVersion,p_body:p.body}));}
 async propose(input:unknown){const p=proposalSchema.parse(input);return proposalResultSchema.parse(await this.call('conversation_propose',{p_member:p.memberId,p_request_id:p.requestId,p_expected_version:p.expectedVersion,p_expected_clinical_revision:p.expectedClinicalRevision,p_expected_draft_epoch:p.expectedDraftEpoch,p_expected_source:p.expectedSource,p_body:p.body,p_summary:p.summary,p_provenance:p.provenance}));}
 async compose(input:unknown){const p=manualProposalSchema.parse(normalizedBody(input));return proposalResultSchema.parse(await this.call('conversation_compose',{p_member:p.memberId,p_request_id:p.requestId,p_expected_version:p.expectedVersion,p_expected_clinical_revision:p.expectedClinicalRevision,p_expected_draft_epoch:p.expectedDraftEpoch,p_expected_source:p.expectedSource,p_body:p.body,p_summary:p.summary}));}
 async editSummary(input:unknown){const p=summaryEditSchema.parse(input);return proposalResultSchema.parse(await this.call('conversation_edit_summary',{p_member:p.memberId,p_request_id:p.requestId,p_draft:p.draftId,p_expected_revision:p.expectedRevision,p_summary:p.summary}));}
 async actions(memberId:string){return actionsResultSchema.parse(await this.call('conversation_actions',{p_member:z.uuid().parse(memberId)}));}
 async command(input:unknown,decision?:unknown){
  const command=commandSchema.parse(normalizedBody(input));
  if(decision===undefined)return commandResultSchema.parse(await this.call('conversation_command',{p_command:command}));
  const expected=z.strictObject({memberId:z.uuid(),modeRevision:z.string().regex(/^[a-f0-9]{32}$/)}).parse(decision);
  return commandResultSchema.parse(await this.call('doctor_decision_reply_apply',{p_member:expected.memberId,p_mode_revision:expected.modeRevision,p_command:command}));
 }
 async awaiting(){return awaitingRepliesSchema.parse(await this.call('conversation_awaiting_replies',{}));}
 async zoeAnswered(){return zoeAnsweredListSchema.parse(await this.call('conversation_zoe_answered',{}));}
 async deliveryProblems(){return deliveryProblemsSchema.parse(await this.call('telegram_delivery_problems',{}));}
 async recover(memberId:string,input:unknown){
  const request=recoverySchema.parse(input);let payload:unknown;let requestId:string;
  if(request.kind==='command'){payload=commandSchema.parse(normalizedBody(request.input));requestId=commandSchema.parse(normalizedBody(request.input)).requestId;}
  else if(request.kind==='summary'){const p=request.input;requestId=p.requestId;payload={op:'summary.edit',draftId:p.draftId,expectedRevision:p.expectedRevision,summary:p.summary};}
  else{const p={...request.input,body:normalizeReplyBody(request.input.body)};requestId=p.requestId;payload={op:'propose',memberId:p.memberId,requestId:p.requestId,expectedVersion:p.expectedVersion,clinicalRevision:p.expectedClinicalRevision,draftEpoch:p.expectedDraftEpoch,source:p.expectedSource,body:p.body,summary:p.summary,provenance:{kind:'staff',engine:'doctor-authored',version:'1',protocolVersion:'not-applicable'}};}
  const result=recoveryResultSchema.parse(await this.call('conversation_recover',{p_member:z.uuid().parse(memberId),p_request_id:requestId,p_payload:payload}));if(result.status==='not-recorded'&&result.requestId!==requestId)throw Error('Recovery request mismatch');return result;
 }
 async retryDelivery(deliveryId:string){return retryDeliveryResultSchema.parse(await this.call('conversation_retry_delivery',{p_delivery:z.uuid().parse(deliveryId)}));}
 async claim(deliveryId:string,attemptId:string){return claimSchema.parse(await this.call('conversation_claim',{p_delivery:z.uuid().parse(deliveryId),p_attempt:z.uuid().parse(attemptId)}));}
 async outcome(attemptId:string,outcome:unknown){return outcomeResultSchema.parse(await this.call('conversation_outcome',{p_attempt:z.uuid().parse(attemptId),p_outcome:outcomeSchema.parse(outcome)}));}
 async reconcile(attemptId:string){return outcomeResultSchema.parse(await this.call('conversation_reconcile',{p_attempt:z.uuid().parse(attemptId)}));}
}
