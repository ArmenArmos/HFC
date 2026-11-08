import {z} from 'zod';

/** The finished outcomes a Zoe run can have (zoe_runs.outcome). */
export const ZOE_RUN_OUTCOMES=['draft_proposed','draft_blocked','summary_only','discarded','no_output','stale','answered','intake_asked','intake_completed','intake_escalated','chatted','skipped']as const;
/** Doctor-facing view of Zoe's recent runs for one member (zoe_runs_for_doctor). */
export const zoeRunsSchema=z.object({ok:z.literal(true),runs:z.array(z.object({id:z.uuid(),messageSeq:z.number().int(),
 // Every outcome zoe_runs can hold; an unknown one (a newer outcome than this build) reads as 'other' instead of failing the
 // whole block (lead 19 Oct: 'chatted' runs broke the doctor's Zoe summary with "results could not be loaded").
 outcome:z.enum([...ZOE_RUN_OUTCOMES,'other']).catch('other'),reason:z.string().nullable(),summary:z.string().nullable(),
 guardReasons:z.array(z.string()),provider:z.string().nullable(),model:z.string().nullable(),draftId:z.uuid().nullable(),draftState:z.enum(['pending','approved','rejected','info_requested','superseded']).nullable().default(null).catch(null),draftCurrent:z.boolean().nullable().default(null),answer:z.string().nullable().default(null),finishedAt:z.string()}))});
export type ZoeRunView=z.infer<typeof zoeRunsSchema>['runs'][number];

export const zoeOutcomeText:Record<ZoeRunView['outcome'],{label:string;tone:'neutral'|'due'|'complete'|'attention'}>={
 draft_proposed:{label:'AI draft ready for your review',tone:'due'},draft_blocked:{label:'AI draft discarded by a safety check',tone:'attention'},
 summary_only:{label:'AI summary only, no draft',tone:'neutral'},discarded:{label:'Not sent to the AI',tone:'neutral'},
 no_output:{label:'AI could not process this message',tone:'attention'},stale:{label:'AI result replaced by newer information',tone:'neutral'},
 answered:{label:'Zoe answered a logistics question',tone:'complete'},
 intake_asked:{label:'Zoe asked symptom questions',tone:'neutral'},intake_completed:{label:'Zoe sent you a symptom summary',tone:'due'},
 intake_escalated:{label:'Red flag: member shown the 103 urgent path',tone:'attention'},
 chatted:{label:'Zoe chatted with the member (no doctor action)',tone:'neutral'},skipped:{label:'Zoe did not process this message',tone:'neutral'},
 other:{label:'Zoe processed this message',tone:'neutral'},
};
const reasonText:Record<string,string>={
 draft_passed_guards:'the draft passed every safety check',structured_draft_passed_guards:'Zoe prepared a reply that quotes the published plan and leaves decisions to you; it passed every safety check',draft_discarded_by_guard:'the draft contained something Zoe may not suggest, so you write the reply',
 urgent_route_no_model_call:'the message matched urgent words, so no AI was used',urgent_in_window_no_model_call:'an earlier message in this conversation matched urgent words, so no AI was used',urgent_check_unavailable:'the urgent word check is not active yet, so no AI was used',already_answered:'you had already replied to this message',read_in_full_long:'the message is long, so read it in full',
 read_in_full_pasted_document:'the message looks like a pasted document, so read it in full',too_many_identifiers_read_in_full:'the message contains many personal details, so it was not sent to the AI',
 abusive_staff_flag:'the message may be abusive (flagged for staff; Zoe still replied within her rules)',language_not_supported:'Zoe does not draft in this language; you reply yourself',
 injection_suspected_summary_only:'the message tried to instruct the AI, so Zoe wrote a summary only',provider_unavailable:'no AI provider is available',
 daily_spend_cap_reached:'the daily AI spending cap was reached',tier_spend_cap_reached:'the daily spending limit for this risk tier was reached',tier_not_configured:'no model is set for this risk tier',model_calls_not_permitted:'real AI calls are not permitted yet',
 provider_refusal:'the AI declined to answer',provider_timeout:'the AI did not answer in time',provider_server_error:'the AI service failed',provider_rate_limited:'the AI service was busy',
 schema_invalid:'the AI answer was not in the expected form, so it was discarded',summary_blocked:'the AI summary failed a safety check',
 newer_member_message:'the member wrote again; Zoe works on the newest message',doctor_work_since_claim:'you changed the draft while Zoe was working, so your work stands',
 doctor_draft_present:'you already have a draft for this message, so Zoe did not replace it',worker_lost:'the AI step stopped before finishing',
 zoe_reads_messages_granted:'the member agreed that Zoe may read their messages',no_zoe_reads_messages_consent:'the member has not agreed that Zoe may read their messages',
 zoe_settings_off:'Zoe consent collection is switched off',no_assigned_doctor:'the member has no assigned doctor',
 lexicon_awaiting_s1_signoff:'the urgent word list is not clinically signed off yet, so this check did not run (not a sign that nothing is urgent)',
 urgent_words_matched_test_list:'words on the fictional TEST list matched (not the clinical list)',no_test_list_words:'no words on the fictional TEST list matched (not a clinical check)',
 in_scope:'the message is something Zoe may summarise and draft for',identifiers_redacted:'personal details were removed before the AI saw the text',nothing_to_redact:'no personal details were found to remove',
 within_daily_spend_cap:'the call fits within today’s spending cap',completed:'the AI answered',schema_valid:'the AI answer had the expected form',
 no_category_matched:'no safety category matched',flagged_for_doctor:'something was flagged for the doctor to check',blocked_category_matched:'a blocked category matched',
 direct_answer_passed_guards:'the question was about logistics or the app and the answer passed every safety check',direct_answer_blocked_by_guard:'Zoe’s answer failed a safety check, so nothing was sent',
 direct_answer_not_allowed:'the message was not purely about logistics, so Zoe sent nothing',direct_answers_off:'Zoe’s direct answers are switched off',direct_answer_no_channel:'the member wrote in the app, where Zoe’s answers are not shown yet, so nothing was sent',direct_answer_unapproved:'Zoe’s answer wording is not approved yet, so nothing was sent',stand_in_answer_not_sent:'a test stand-in answered, so nothing was sent',
 urgent_words_matched_staging_list:'words on the STAGING placeholder urgent list matched (not the signed clinical list)',no_staging_list_words:'no words on the STAGING placeholder urgent list matched (not a clinical check)',
 symptom_red_flag_no_model_call:'the message matched a symptom red flag, so no AI was used and the member was shown the 103 urgent path',
 intake_red_flag_after_model:'an answer or the AI flagged a possible emergency, so the member was shown the 103 urgent path',
 intake_reply_passed_guards:'Zoe asked the next symptom questions; her text passed every safety check',intake_reply_blocked_sheet_wording:'Zoe’s own question failed a safety check, so the sheet’s wording was sent instead',
 intake_injection_sheet_wording:'the message tried to instruct the AI, so the sheet’s own question was sent and no AI was used',intake_schema_invalid_sheet_wording:'the AI answer was not in the expected form, so the sheet’s own question was sent',
 member_medicine_added:'the member confirmed a medicine they named in chat; it is on their own list, for you to check',member_medicine_not_saved:'the member confirmed a medicine, but it could not be saved to their list',member_medicine_declined:'the member chose not to add a medicine they named',
 intake_complete:'all symptom questions were answered and the summary was sent to you',intake_member_stopped:'the member stopped the questions; the summary was sent to you',
 intake_about_someone_else:'the member said the symptom is someone else’s; the summary was sent to you',intake_wording_unapproved:'Zoe’s answer wording is not approved yet, so nothing was sent',
 intake_not_active:'the symptom questions had already ended',intake_already_active:'another symptom question round was already open',
 admin_opened_run_detail:'an admin opened the redacted AI input and output',event_invalid:'an event failed validation and was not stored as sent',
};
const categoryText:Record<string,string>={
 dose:'a medicine dose',medication_change:'a medication change',contextual_yes_no:'a yes or no to a medicine question',drug_not_in_plan:'a medicine not in the plan',
 diagnosis_reassurance:'a diagnosis or reassurance',threshold_deadline:'a number threshold or deadline',out_of_plan_instruction:'an instruction outside the plan',
 response_time_commitment:'a promise about when the team replies',false_status:'a claim about something that has not happened',contact_or_link:'contact details or a link',
 off_scope:'an off-topic answer',wrong_language:'the wrong language',health_content:'health content in an answer meant for logistics',emergency_advice_altered:'103 advice other than a plain call 103',contradicts_doctor:'telling the member to ignore the doctor',length:'too much text',not_allowed_for_this_run:'a draft where only a summary was allowed',
};
/** A proposed draft's run is labelled by what became of the draft. */
export const zoeRunLabel=(run:Pick<ZoeRunView,'outcome'|'draftState'|'draftCurrent'>)=>{
 if(run.outcome==='draft_proposed'&&run.draftState==='pending'&&run.draftCurrent===false)return {label:'AI draft for an earlier message',tone:'neutral'as const};
 if(run.outcome!=='draft_proposed'||run.draftState==='pending'||run.draftState===null)return zoeOutcomeText[run.outcome];
 return {approved:{label:'AI draft approved by the doctor',tone:'complete'as const},rejected:{label:'AI draft rejected',tone:'neutral'as const},
  info_requested:{label:'AI draft set aside for more information',tone:'neutral'as const},superseded:{label:'AI draft no longer current',tone:'neutral'as const}}[run.draftState];
};
const plain=(s:string)=>s.replaceAll(/[_.:-]+/g,' ').trim();
export const zoeReasonText=(reason:string|null)=>reason?reasonText[reason]??(reason.startsWith('off_scope_')?`the message is off-topic (${plain(reason.slice(10))})`:plain(reason)):null;
/** "draft.dose" → "a medicine dose (draft)". */
export const zoeGuardReasonText=(r:string)=>{const [field,cat]=r.split('.',2);if(field==='no_draft')return `no draft: ${plain(cat??'')}`;if(r==='staff_flag.abusive')return 'the message may be abusive (for staff; Zoe still replied within her rules)';return `${categoryText[cat??'']??plain(cat??r)} (${field==='draft'?'draft':field==='summary'?'summary':field==='answer'?'direct answer':plain(field??'')})`;};

/** One run for the admin Trace page, with its redacted input and output opened server-side. */
export type ZoeRunDetail={id:string;outcome:string|null;reason:string|null;provider:string|null;model:string|null;tier:string|null;tierReason:string|null;fallbackUsed:boolean;configVersion:string|null;costUsd:number|null;inputTokens:number|null;outputTokens:number|null;latencyMs:number|null;
 io:{memberBlock:string;response:string|null;judgeMalformed?:string}|'not_stored'|'key_unavailable'};
