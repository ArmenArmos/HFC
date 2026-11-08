import {z} from 'zod';
import {zoeReasonText} from '@/lib/zoe/contracts';

type Env=Record<string,string|undefined>;
/** Dark by default: the admin Trace pages exist only when this is exactly "true". Events are written regardless. */
export const traceViewEnabled=(env:Env=process.env)=>env.NOREON_CONVERSATION_TRACE_ENABLED==='true';

export const traceOutcomes=['allow','block','redact','escalate','queued','held','sending','sent','failed','unknown','recorded','skipped','superseded']as const;
const code=z.string().max(80).nullable();
export const traceEventSchema=z.object({
 id:z.number().int(),at:z.string(),step:z.string(),name:z.string(),outcome:z.enum(traceOutcomes),reason:code,rule:code,ruleVersion:code,
 actorKind:z.enum(['system','member','doctor','staff','admin','ai','provider']),actorName:z.string().nullable(),
 subjectKind:z.string(),subjectId:z.string().nullable(),attributes:z.record(z.string(),z.unknown()),
});
export type TraceEvent=z.infer<typeof traceEventSchema>;
export const conversationTraceSchema=z.object({ok:z.literal(true),asOf:z.string(),memberId:z.string(),memberName:z.string(),conversationId:z.string().nullable(),events:z.array(traceEventSchema)});
export const traceMembersSchema=z.object({ok:z.literal(true),asOf:z.string(),members:z.array(z.object({memberId:z.string(),memberName:z.string(),lastAt:z.string(),events:z.number(),blocked:z.number()}))});

const reasonText:Record<string,string>={
 received:'the message was accepted',member_over_intake_limit:'the member sent more messages than the intake limit allows in one window, so the text was not stored',
 unsupported_media_not_read:'it was a photo, voice note or file, which is not read',principal_not_linked:'the Telegram account is not connected to any member',
 generation_mismatch:'the Telegram connection changed after the message arrived',member_not_eligible:'the member cannot use Telegram messaging',
 member_message_received:'a member message reached the conversation',first_over_limit_message_this_window:'this was the first message over the limit in this window',
 non_text_message:'the member sent a non-text message',already_acknowledged_this_window:'the member was already acknowledged in this window',
 no_template_available:'no acknowledgement wording exists for the member’s language',assigned_doctor_alerted:'the assigned doctor was alerted',
 no_assigned_doctor:'the member has no assigned doctor',alert_recorded_for_assigned_doctor:'an alert was recorded for the assigned doctor (this does not mean it was read)',
 queued_wording_unapproved_will_be_held:'it was queued, but its wording is not approved yet, so it will be held and not sent',
 engine_draft:'the draft engine wrote it at the doctor’s request',staff_draft:'a staff member wrote it',
 'contact:linked':'the member shared their phone and Telegram was connected','contact:proven':'the member proved their phone in Telegram','contact:refused':'the shared contact did not match the member',
 'auth:prompted':'the member was asked to share their phone','auth:token_invalid':'the sign-in link was invalid or expired',
 member_unlinked:'the member disconnected Telegram',replaced:'a newer Telegram connection replaced it',phone_moved:'the phone number moved to another account',replaced_earlier_binding:'it replaced an earlier connection',
 adapter_unavailable_before_invocation:'the Telegram sender was not available, so nothing was sent',transport_invocation_returned_no_conclusive_acknowledgement:'Telegram gave no clear answer, so delivery is unknown',not_sent_unsupported_payload:'the message could not be sent in this form',exact_text_approved:'the doctor approved this exact text',template_unapproved:'the wording is not approved yet',
 newer_member_message:'the member wrote again before it was sent',member_over_intake_limit_hold:'the member went over the intake limit',
 member_sent_unsupported_media:'the member sent a non-text message before it was sent',endpoint_unlinked:'the member disconnected Telegram',
 route_unavailable:'there is no active Telegram connection',stale_context:'the conversation changed after approval',approval_authority_lapsed:'the doctor’s approval authority lapsed',
 newer_context:'newer information replaced it',linked:'Telegram was connected',unlinked_or_revoked:'Telegram was disconnected or the connection was revoked',
 principal_linked_elsewhere:'that Telegram account is connected to another member',accepted:'Telegram accepted it',
};
const nameText:Record<string,string>={
 'intake.committed':'Telegram message received','intake.rejected':'Telegram update refused at the webhook','intake.dead_lettered':'Incoming message could not be processed',
 'intake.processed':'Incoming message checked','message.stored':'Member message stored','doctor_alert.created':'Doctor alert',
 'auto_ack.decided':'Automatic acknowledgement decision','system_message.enqueued':'Automatic message queued','system_message.held':'Automatic message held',
 'system_message.sending':'Automatic message send attempt','system_message.accepted_by_provider':'Automatic message delivered to Telegram',
 'system_message.definitely_failed':'Automatic message not delivered','system_message.unknown':'Automatic message delivery unknown',
 'draft.created':'Reply draft started','draft.revision_written':'Reply draft written','draft.approved':'Reply draft approved','draft.rejected':'Reply draft rejected',
 'draft.info_requested':'More information requested','draft.superseded':'Reply draft replaced','approval.recorded':'Exact reply approved',
 'delivery.queued':'Reply queued for Telegram','delivery.held':'Reply held','delivery.sending':'Reply being sent','delivery.accepted_by_provider':'Reply delivered to Telegram',
 'delivery.definitely_failed':'Reply not delivered','delivery.unknown':'Reply delivery unknown','send.attempt':'Reply send attempt','provider.receipt':'Telegram answered',
 'binding.created':'Telegram connection created','binding.reproven':'Telegram connection confirmed again','binding.revoked':'Telegram connection revoked',
 'zoe.guard.consent':'Zoe: consent check','zoe.guard.urgent_match':'Zoe: urgent words check','zoe.guard.scope':'Zoe: scope and language check','zoe.guard.redaction':'Zoe: personal details removed before the AI',
 'zoe.spend.reserve':'Zoe: daily AI spending cap','zoe.provider.call':'Zoe: AI model call','zoe.guard.output_schema':'Zoe: AI answer format check','zoe.guard.output_summary':'Zoe: summary safety check',
 'zoe.guard.output_draft':'Zoe: draft safety check','zoe.guard.output_missing_info':'Zoe: follow-up list safety check','zoe.route':'Zoe: result','zoe.run.io_viewed':'Zoe: AI input and output opened','zoe.trace.event_rejected':'Zoe: trace event rejected',
 'link.active':'Telegram connected','link.redeemed':'Connection link used','link.inactive':'Telegram disconnected','link.issued':'Connection link issued','link.refused':'Connection refused','link.unlinked':'Member asked to disconnect',
};
export const outcomeLabel:Record<TraceEvent['outcome'],{label:string;tone:'neutral'|'due'|'complete'|'attention'}>={
 allow:{label:'Allowed',tone:'complete'},block:{label:'Blocked',tone:'attention'},redact:{label:'Not read',tone:'due'},escalate:{label:'Escalated',tone:'due'},
 queued:{label:'Queued',tone:'neutral'},held:{label:'Held',tone:'attention'},sending:{label:'Sending',tone:'neutral'},sent:{label:'Sent',tone:'complete'},
 failed:{label:'Failed',tone:'attention'},unknown:{label:'Unknown',tone:'attention'},recorded:{label:'Recorded',tone:'neutral'},skipped:{label:'Skipped',tone:'neutral'},superseded:{label:'Replaced',tone:'neutral'},
};
const plain=(s:string)=>s.replaceAll(/[_.:-]+/g,' ').trim();
export const traceTitle=(e:Pick<TraceEvent,'name'>)=>nameText[e.name]??(e.name.startsWith('zoe.')?`Zoe: ${plain(e.name.slice(4))}`:plain(e.name));
/** One plain sentence on why: the reason, in words when we know it. */
export const traceReason=(e:Pick<TraceEvent,'reason'|'name'>)=>{
 if(!e.reason)return null;
 if(e.name.startsWith('delivery.')&&e.reason==='member_over_intake_limit')return reasonText.member_over_intake_limit_hold;
 if(e.name.startsWith('zoe.')&&!reasonText[e.reason])return zoeReasonText(e.reason);
 return reasonText[e.reason]??plain(e.reason);
};
export const actorText=(e:Pick<TraceEvent,'actorKind'|'actorName'>)=>({system:'Noreon',member:'Member',doctor:'Doctor',staff:'Staff',admin:'Admin',ai:'Zoe (AI)',provider:'Telegram'}[e.actorKind])+(e.actorName&&e.actorKind!=='system'&&e.actorKind!=='provider'?` · ${e.actorName}`:'');
