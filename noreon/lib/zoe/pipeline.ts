import {ownBpReadings} from "./health-answer";
import {labelBpQuotes} from "./bp-provenance";
import {hasThirdPartyBpReading,thirdPartyBpOnly,thirdPartyOwnInstruction} from './third-party-bp';
import {pde5NitrateContext,pde5NitrateReply,guardPde5NitrateReply,PDE5_NITRATE_CATEGORICAL,PDE5_NITRATE_VERSION} from './pde5-nitrate';
import {chatTask,TASK_REPLY} from '@/lib/chat/tasks';
import {ALARM_CONVERSATION_VERSION,DISPUTE_NOTED,SYMPTOM_NOW_QUESTION,alarmExplanation,asksAlarmWhy,disputesSymptomAnswer,alarmMessageHash,alarmSymptom,alarmSymptoms,assertedAlarmSymptom,generalSymptomQuestion,isSymptomNowQuestion,type AlarmTrigger} from './alarm-conversation';
import {memberClearOn,memberClearPhrase,vetoesReadingClear,mentionsUrgentWords,memberClearContextSchema,MEMBER_CLEAR_TEXT,MEMBER_CLEAR_VERSION,type MemberClearReason} from './member-clear';
import {dangerPassed,isUrgentAnswer,urgentWindowOpen,MONITORED_MIN,URGENT_WINDOW_VERSION} from './urgent-window';
import {z} from 'zod';
import {urgentDecision} from './urgent-test';
import {classifyScope,replyLanguageOf,requestedLanguage,SCOPE_VERSION} from './scope';
import {asksForSummary,asksToWithhold,CHAT_RECORD_VERSION,inventedNegatives,MEDICINE_ADDED,MEDICINE_NOT_ADDED,MEDICINE_NOT_SAVED,medicineAskLine,offerableMedicines,pendingMedicines,promisesSecrecy,questionnaireAnswers,questionnaireBlock,questionnaireCorrections,saysAdd,saysNoMedicines,SUMMARY_NOTE,WITHHOLD_LINE,type ChatMedicine,type MemberStatement} from './chat-record';
import {nameTokens,redactText,REDACTION_VERSION} from './redact';
import {ANSWER_MAX_CHARS,guardDraftOutput,guardField,mentionsMedicine,namesDrug,OUTPUT_GUARD_VERSION,patternVerdict,redactContacts,type FieldVerdict} from './output-guard';
import {checkMemberReply,createFakeJudge,judgeBudget,JUDGE_CONTEXT_MAX_CHARS,JUDGE_ATTEMPTS,JUDGE_TIMEOUT_MS,pickJudge,REPLY_CHECK_VERSION} from './reply-check';
import {FAST_PRICE_MULTIPLIER,fastAvailable,realCallsBasis} from './gateway';
import {approxTokens,chatV2On,costUsd,createFakeProvider,PROMPT_VERSION,systemPrompt,type Effort,type ProviderResult,type ReplyLanguage,type ZoeProvider} from './provider';
import {NORMALISER_VERSION,normaliseText} from './normalise';
import {assembleReplyDraft,planBlock,planItems,planSnapshotSchema,REPLY_DRAFT_PROMPT_VERSION,REPLY_DRAFT_SYSTEM_PROMPT,REPLY_DRAFT_VERSION,type ReplyDraftRecord} from './reply-draft';
import {COMMITMENT_VERSION} from './commitment';
import {routeTier,ROUTING_VERSION,tierRank,type Tier,type TierClassifier,type TierDecision} from './routing';
import {askDecisions,DECISIONS_TIMEOUT_MS,decisionsFlags,decisionsTraceEvent,languageToLatinArmenian,raiseRoute,topicKeepsWindow,type CurrentDecision,type DecisionsResult} from './decisions';
import {selfHarmLevel,selfHarmPlanPhrase,stagingMatches,stagingPlaceholderActive} from './urgent-staging';
import {chestPastOrStableNotNow,chestResults,recentCrisisReading,textRedFlags,redFlagIds,SYMPTOM_RED_FLAGS_VERSION,type RedFlagHit} from './symptoms/red-flags';
import {acceptAnswers,activeIntakeSchema,answerRedFlags,checkReply,closingText,emptyRecord,INTAKE_SYSTEM_PROMPT,INTAKE_VERSION,intakeComplete,intakeDataBlock,MAX_INTAKE_TURNS,intakeOutputSchema,
 directAnswer,memberAsks,askedReply,ASKED_MEDICINE_TEXT,URGENT_MEDICINE_TEXT,greetingReply,CHECK_LINE,memberStops,noteAsked,openRedFlagQuestions,mergeHits,openerText,restRedFlagQuestion,yesToRedFlag,startingSheet,URGENT_TEXT,NEUTRAL_LINE,wasNeutral,bareReply,fitsPending,lastAskedQuestions,RESTART_LINE,RESUME_MAX_IDLE_MIN,SAFETY_LINE,sheetQuestionsText,type ActiveIntake,type IntakeRecord} from './symptoms/intake';
import {sheetById,type SymptomSheet} from './symptoms/sheets';
import {buildSummary,runSummaryLine,type IntakeEnding,type SymptomSummary} from './symptoms/summary';
import {calledAndAsksToEatOrDrink,CALLED_EAT_DRINK_TEXT,NO_TRAINING_LINE,S100_TEXT,DRIVE_TEXT,URGENT_CHECK_IN,URGENT_ACK,URGENT_TAKE_NOW,urgentAcknowledgement,urgentMedicineChange,takesSomethingNow,trainingAfterFaint,refuses103,urgentFollowUp,URGENT_FOLLOWUP_VERSION} from './urgent-followup';
import {plainRequestAfterAlert,plainSettledChest} from './alert-gate';
import {urgentProblemContinues,clarifyAlone,clarifyText,isClarifyText,vagueComplaint,VAGUE_QUESTION,modelWindowExit,notConfirmedNote,readUrgencyVerdict,RED_FLAG_QUESTION_TEXT,unclearSymptom,URGENCY_CHECK_MAX_OUTPUT_TOKENS,URGENCY_CHECK_PROMPT,URGENCY_CHECK_TIMEOUT_MS,URGENT_CHECK_VERSION} from './urgent-check';
import {FREE_MODE_CONFIG_VERSION} from './free-mode-config';
import {soonFloor,statinLab} from './same-day-floors';
import {HANDOFF_NEXT,CRISIS_LINE_TEXT,floorSkips,GUIDANCE_LINES,guidanceFound,guidanceSaid,guidanceTopics,hasInterim,INTERIM_LINE,interimFits,medicineNoteDue,spendLabFloors,STATIN_PAUSE_LINE,NOTHING_NEW_LINE,proposesSomething,SELF_SOURCED_MEDICINE_LINE,STOP_MEDICINE_LINE,stopsMedicine,vagueAtRisk} from './health-answer';
import {MILD_SIDE_EFFECT_REASON,nurseFirst} from './nurse-first';
import {conversationMemory,hasOpenTaskWarning,hasSameDayWarning,mayBeOpen,memoryBlock,memoryContext,MEMORY_VERSION,MEMORY_WARNING_HOURS,repeatFindings,type ConversationMemory} from './conversation-memory';
import {freeSpeed,FREE_SPEED_VERSION,type FreeSpeed} from './free-mode-speed';
import {freeStyle,FREE_STYLE_VERSION,type FreeStyle} from './free-mode-style';
import {balancedObject,buildZoeWhy,readModelWhy,whyData,whyDataDoubts,whySourcesBlock,ZOE_WHY_VERSION,zoeWhyModelOn,zoeWhySchema,type ModelWhy,type ZoeWhy} from './why';
import {LOGGING_LINE,LOGGING_LINE_CHAT_V2,plainLoggingRequest} from './logging-request';
import {ASK_AGAIN_LINE,APP_QUESTION_VERSION,missingSections,plainAppQuestion,smallTalk} from './app-question';
import {asksForHeldData,dropAnsweredQuestions,MEMBER_RECORD_VERSION,memberRecordBlock,memberRecordSchema,zoeLdlTargetOn} from './member-record';
import {healthProfileSchema,healthSummaryBlock,reportedLine,runTopicCheck,SAFETY_CARRY,timeline,TOPIC_MAX_GAP_MIN,topicCheckBlock,topicRules,topicStartFor,topicTurns,TOPIC_CHECK_MAX_OUTPUT_TOKENS,TOPIC_CHECK_PROMPT,TOPIC_CHECK_TIMEOUT_MS,TOPIC_VERSION,type DoctorTopic,type TopicKind,type TopicRecord,type TopicSource} from './topic';
import {STAGING_LEXICON_VERSION} from './urgent-staging';
import {BP_CHECK_VERSION} from '@/lib/clinical/rules/bp-check';
import {bmi} from '@/lib/clinical/rules/derived';
import {BP_SOON,bpCareTeamLine,bpRemeasureLine,bpSoonLine,bpTodayLine,bpWaitingLine} from '@/lib/clinical/rules/bp-words';
import {BMI_REQUEST_VERSION,bmiMeasurementReply,bmiMessageNumbers,bmiNumbers,bmiReply,bmiReplyHasValue,bmiRequest,pendingBmi} from './bmi-request';
import {bpAwaitingRepeat,bpChatTurn,bpCrisisNotCurrent,bpCurrentVeryHigh,bpLevelGiven,bpSymptomAsserted,bpTypedSaves} from './bp-chat';
import {BATCH_CORRECTION,BATCH_OTHER_PERSON} from './bp-parse';
import {lowSugar,activityPermissionLine,atLeast,carefulLine,SELF_HARM_TODAY_TEXT,CAREFUL_FOLLOW_UP,CHEST_NOT_NOW_CONTEXT,DOCTOR_SOON_LINE,isCarefulAnswer,NOTHING_NEW_NO_103_LINE,healthReplyPrompt,HEALTH_SUMMARY_MAX_OUTPUT_TOKENS,HEALTH_SUMMARY_PROMPT,HEALTH_SUMMARY_WHY_PROMPT,healthReplySchema,healthSummaryOutputSchema,SUMMARY_UNAVAILABLE,zoeReplyBlock,type DoctorSummary,type HealthOutput,repairHealthJson,composeHealthAnswer,decideForward,HEALTH_ANSWER_MAX_CHARS,HEALTH_ANSWER_VERSION,HEALTH_SYSTEM_PROMPT,healthDataBlock,healthDataSchema,healthOutputSchema,SAME_DAY_LINE,asksForDoctor,autoLine,passedToDoctorLine,endsWithQuestion,freeVoiceClean,pendingAsk,RAW_REPLY_JSON,renderDoctorSummary,replyToAsk,sameDayFloor,sentLine,urgentStepsText,type Forward,type ForwardReason,type Urgency} from './health-answer';
import {AGAIN,WORRIED,chatExemptPhrases,COMPLAINT,CRISIS_TEXT,FIXED_ONLY,isReceipt,latinArmenian,noLetters,REPEAT_TEXT,deflectionText,INJECTION_THROTTLE,MEMBER_DAILY_CAP_USD,MEMBER_SPEND_CAP_LINE,MEMBER_SPEND_CAP_LINE_CHAT_V2,chatFallback,chatIntent,chatOutputSchema,chatSystemPrompt,CONVERSATION_VERSION,ADVICE_ASK,fillName,firstName,isQuestion,shortReply,receiptText,startsWithGreeting,voiceClean,type ChatClass,type ChatIntent} from './conversation';

/**
 * Zoe's message pipeline (ZOE_DESIGN §1.1 worker part, §2, §5; K1, K5, K7). For one claimed
 * run: consent (checked in SQL at claim) → urgent matcher → scope classifier → risk tier →
 * redaction → spend reservation → provider → output guard → a doctor-facing summary plus draft,
 * a direct answer, or a discard. Every step returns a trace event; the database writes them with
 * the run.
 *
 * Direct answers (staging AI mode, Khikar 17 Oct 22:53): Zoe may answer the member herself ONLY
 * when the fixed rules put the whole window in the low tier (logistics, app help) with nothing
 * unsure, the database switch zoe_settings.direct_answers_enabled is on (it comes with the job),
 * the caller allows it (the sweep: only with a real model), and the answer passes the strictest
 * guard (every category blocks, any health wording blocks). Everything else is unchanged: an AI
 * draft becomes a pending draft that only the assigned doctor can approve (K1).
 */
/**
 * Fable PR2 F2: a run's wall budget, judging included (Codex F2-01). A speaker call leaves the judge its 10 s; no
 * retry, attempt, fallback or structured draft starts unless a shortest call (5 s) and the judge still fit; the
 * judge gets what is left (3 s at least, so it can still pass a reply; it fails closed when it runs out).
 * RUN_WORST_MS bounds a whole run (two judge calls at their floor, the writes) for callers' admission.
 */
export const RUN_BUDGET_MS=30_000,MIN_CALL_MS=5_000,JUDGE_MIN_MS=3_000;
export const RETRY_CUTOFF_MS=RUN_BUDGET_MS-JUDGE_TIMEOUT_MS-MIN_CALL_MS;
export const RUN_WORST_MS=44_000;
/**
 * Health answers (health-answer.ts) are longer texts from the strongest models (Opus about 20 to 28 s with its own
 * thinking, measured 19 Oct): their run gets a longer budget and speaker call, and still fits RUN_WORST_MS (the 60 s
 * Telegram webhook admits a run only when a whole one fits; lib/telegram-runtime/server.ts).
 */
export const HEALTH_RUN_BUDGET_MS=38_000,HEALTH_CALL_TIMEOUT_MAX_MS=28_000;
/** Split mode (free-mode-speed.ts): the summary call's own limit, and how long a model emergency waits for it before the marker. */
export const SUMMARY_TIMEOUT_MS=8_000,URGENT_SUMMARY_WAIT_MS=1_500;
/** The summary call's object: the text, the outermost {...} in it, or the first balanced {...}; null when none parses. */
export function repairSummary(raw:string):DoctorSummary|null{
 const read=(t:string|null)=>{if(t===null)return null;try{const p=healthSummaryOutputSchema.safeParse(JSON.parse(t));return p.success?p.data.summary:null;}catch{return null;}};
 const i=raw.indexOf('{'),j=raw.lastIndexOf('}');
 return read(raw)??(i>=0&&j>i?read(raw.slice(i,j+1)):null)??(i>=0?read(balancedObject(raw,i)):null);
}
/** The doctor's summary on an urgent run forwarded automatically (Fable FB-01): fixed, codes and facts only, never the member's words. */
export const URGENT_FORWARD_SUMMARY={
 refused_103:'The member refused to call 103 after Zoe\'s urgent advice. Zoe sent the fixed refusal reply (S100), which repeats the 103 advice with the minimum safety steps. Sent to the doctor automatically; see the conversation.',
 self_harm:'The member wrote about self-harm or suicide. Zoe gave the crisis text with 103. Sent to the doctor automatically; see the conversation.',
} as const satisfies Partial<Record<ForwardReason,string>>;
/** The doctor's summary for self-harm thoughts without a plan (Task 8): the same-day route, no 103 text. */
export const SELF_HARM_TODAY_SUMMARY='The member wrote about thoughts of self-harm or of not wanting to live, with no plan or action. Please see this today. Zoe stayed in the chat, said the care team will know and gave the support line. Sent to the doctor automatically; see the conversation.';
/** The longest a single model call may take (the Gateway adapter's own limit; the budget only shortens it). */
export const CALL_TIMEOUT_MAX_MS=20_000;
export const TIME_BUDGET_VERSION='zoe-time-budget-3';
/** Doctor takeover (20261020082321): in doctor mode only the deterministic safety texts reach the member. */
export const DOCTOR_MODE_VERSION='zoe-doctor-mode-2';
/** Topic scope (topic.ts) is on unless NOREON_ZOE_TOPIC_SCOPE=off (the whole window as before, no check; the eval's "before"). */
/** The rewrite instruction after the member said 103 was called or help came (helpReached). Never shown to the member. */
const HELP_REACHED_NOTE='<help_reached>The member has just told you that they called 103 or that help has arrived. Do not repeat the instructions to call 103 and do not send them to a doctor or clinic now: acknowledge it in one or two short sentences, say help is on the way and they can write again here, and set urgency to "same_day". Keep every other rule.</help_reached>';
/** Internal rewrite instruction for an ordinary follow-up after an alert. Never shown to the member. */
const ALERT_ALREADY_GIVEN_NOTE='<alert_already_given>The 103 advice was already given for the earlier concern. The unanswered messages are a new topic with no danger sign or symptom report. Answer the newest question fully now, do not put it off and do not steer back to the earlier concern. Do not repeat 103 or the emergency instructions. Set urgency to the level given in second_check; the doctor was told when the alert was given. Keep every other rule.</alert_already_given>';
export {BATCH_CORRECTION,BATCH_OTHER_PERSON};
/** The generic reasons at the same-day level: one matter, whatever the model calls it. Every other reason is news the member is told. */
const SAME_MATTER_FORWARD=new Set<string>(['same_day','coming_days','symptom_assessment','other','none']);
const SMALL_TALK=new Set(['greeting','thanks','how_are_you','farewell']);
// Only these refusals are a budget limit; any other refused reservation stays a careful handoff.
const SPEND_CAP_CODES=new Set(['tier_spend_cap_reached','daily_spend_cap_reached','member_spend_cap_reached']);
export const topicScopeOn=(env:Record<string,string|undefined>)=>(env.NOREON_ZOE_TOPIC_SCOPE??'').trim().toLowerCase()!=='off';
export const ZOE_CONFIG_VERSION=[PROMPT_VERSION,REPLY_DRAFT_VERSION,SCOPE_VERSION,REDACTION_VERSION,OUTPUT_GUARD_VERSION,COMMITMENT_VERSION,NORMALISER_VERSION,ROUTING_VERSION,INTAKE_VERSION,SYMPTOM_RED_FLAGS_VERSION,CONVERSATION_VERSION,REPLY_CHECK_VERSION,TIME_BUDGET_VERSION,HEALTH_ANSWER_VERSION,PDE5_NITRATE_VERSION,URGENT_WINDOW_VERSION,URGENT_FOLLOWUP_VERSION,DOCTOR_MODE_VERSION,TOPIC_VERSION,URGENT_CHECK_VERSION,MEMORY_VERSION,CHAT_RECORD_VERSION].join('+');
/** Armenian and Russian cost several times more tokens than English; 800 truncated real answers (staging eval, 17 Oct). */
export const MAX_OUTPUT_TOKENS=1600;
/** A health answer is longer, and the strongest models think before it (thinking counts against the limit). */
export const HEALTH_MAX_OUTPUT_TOKENS=3200;
/** More redactions than this in one message: it looks like a pasted document, so it is not sent. */
export const MAX_REDACTIONS_PER_MESSAGE=6;
const PROVIDER_ATTEMPTS=2;

export type Attr=string|number|boolean;
export type ZoeEvent={name:string;outcome:'allow'|'block'|'redact'|'escalate'|'recorded'|'skipped'|'failed';reason:string;rule:string;ruleVersion:string;actor:'system'|'ai';attributes:Record<string,Attr>};

/** An expired intake the member may be answering (zoe_run_resumable): its sheet, record and how long the member was away. */
export const resumableIntakeSchema=z.strictObject({sheetId:z.string(),sheetVersion:z.number().int(),startedSeq:z.number().int(),language:z.enum(['en','hy','ru']),
 record:activeIntakeSchema.shape.record,idleMinutes:z.number().int().min(0)});
export const zoeJobSchema=z.strictObject({
 runId:z.uuid(),memberId:z.uuid(),messageSeq:z.number().int(),displayName:z.string().nullable(),
 messages:z.array(z.strictObject({seq:z.number().int(),text:z.string(),minutesAgo:z.number().int()})).min(1),
 replies:z.array(z.strictObject({body:z.string(),minutesAgo:z.number().int()})),
 /** Zoe's own earlier direct answers in this window (conversation context). */
 answers:z.array(z.strictObject({body:z.string(),minutesAgo:z.number().int()})).default([]),
 /** The 103 window (zoe_run_urgent_window): minutes since the current run of urgent texts began, null when none. Absent: from the answers above. */
 urgentSinceMinutes:z.number().int().min(0).nullable().optional(),
 /** Who opened that run of urgent texts (zoe_run_urgent_window): only a model's emergency, or a fixed rule. Absent: a fixed rule (today's exits). */
 urgentOpenedBy:z.enum(['model','rule']).nullable().optional(),
 /** The newest member message a 103 text of that run answered (Astra N1-2): an exit sent after it closes the window. */
 urgentThroughSeq:z.number().int().nullable().optional(),
 /** Minutes since the conversation's last self-harm "today" reply (_zoe_self_harm_today_minutes), whatever the answers above hold. Null: none. Absent: an older job or database. */
 selfHarmTodayMinutes:z.number().int().min(0).nullable().optional(),
 /** The worker could not read the window: no answer of Zoe's own unless the answers above show the window. */
 urgentWindowUnavailable:z.boolean().optional(),
 /** Additive window context. Used only with NOREON_ZOE_MEMBER_CLEAR exactly true. */
 memberClear:memberClearContextSchema.optional(),
 /** zoe_settings.direct_answers_enabled at claim time. */
 directAnswers:z.boolean().default(false),
 /** Symptom intake (zoe_settings.symptom_intake_enabled at claim time, and what it needs). Absent or off: no intake, no symptom red flags. */
 intake:z.strictObject({enabled:z.boolean(),registered:z.array(z.strictObject({id:z.string(),version:z.number().int()})),active:activeIntakeSchema.nullable(),
  doctorName:z.string().max(120).nullable(),latestReading:z.strictObject({entrySource:z.string().nullable().optional(),systolic:z.number().int(),diastolic:z.number().int(),minutesAgo:z.number().int()}).nullable(),
  /** Messages up to this seq were already escalated for a red flag; only later ones are checked again. */
  redFlagsAfterSeq:z.number().int(),
  /** The newest intake when it expired and this is the member's next message (zoe_run_resumable). */
  resumable:resumableIntakeSchema.nullable().optional()}).optional(),
 /** Conversational replies (zoe_settings.conversational_replies_enabled, read by zoe_run_context after the claim). Absent or off: no chat path, no receipt. */
 conversation:z.strictObject({enabled:z.boolean(),doctorName:z.string().max(120).nullable(),
  /** The newest member message already answered by a Zoe text or covered by a doctor's approval. */
  answeredThroughSeq:z.number().int(),
  /** Abuse limits: this member's Zoe spend today and runs with suspected injection in the last 24 hours. */
  memberSpentTodayUsd:z.number().min(0).default(0),injectionsLast24h:z.number().int().min(0).default(0),
  /** zoe_settings.member_daily_cap_usd (never above the global cap); absent: MEMBER_DAILY_CAP_USD. */
  memberDailyCapUsd:z.number().min(0).max(10).optional(),
  /** The member's app language (Latin-letter Armenian and messages with no letters are answered in it). */
  locale:z.enum(['en','hy','ru']).nullable().default(null)}).optional(),
 /** Structured reply drafts (zoe_settings.structured_drafts_enabled, zoe_run_plan): the switch and the member's current published plan. Absent or off: the free draft only. */
 replyDraft:z.strictObject({enabled:z.boolean(),plan:planSnapshotSchema.nullable()}).optional(),
 /** Health answers (zoe_settings.health_answers_enabled, zoe_run_health_context; health-answer.ts). Absent or false: the doctor path as before. */
 healthAnswers:z.boolean().optional(),
 /** The member's own data for a health answer, labelled: home BP this week and doctor-reviewed lab results. */
 health:healthDataSchema.nullable().optional(),
 /** What the record already holds (zoe_run_member_record, member-record.ts). */
 memberRecord:memberRecordSchema.nullable().optional(),
 /** The newest member message came by Telegram (zoe_run_member_record), so the member is not on the new chat. */
 viaTelegram:z.boolean().optional(),
 /** Doctor mode (zoe_run_doctor_mode, 20261020082321): the doctor has taken the conversation over. Only the deterministic safety texts run. */
 doctorMode:z.boolean().optional(),
 /**
  * Doctor mode's scope (zoe_settings.doctor_takeover_scope): 'topic' (Armen msg 251) lets Zoe answer a clearly unrelated new
  * question; 'conversation' is the takeover of 20261020082321 (Zoe silent on everything). Absent: 'conversation'.
  */
 doctorScope:z.enum(['topic','conversation']).optional(),
 /** The doctor's matter: their newest reply and the member messages it answered (zoe_run_doctor_mode). */
 doctorMatter:z.strictObject({reply:z.string(),minutesAgo:z.number().int(),messages:z.array(z.strictObject({text:z.string(),minutesAgo:z.number().int()})).max(5)}).nullable().optional(),
 /**
  * Topic scope (topic.ts; zoe_run_topic): the member's newest "New question" divider (after this seq), the topic the last
  * run recorded, whether Zoe owns it since the doctor's newest reply, and the health profile for the summary.
  */
 topic:z.strictObject({breakAfterSeq:z.number().int().nullable(),startSeq:z.number().int().nullable(),zoeOwns:z.boolean(),profile:healthProfileSchema.nullable()}).optional(),
});
export type ZoeJob=z.infer<typeof zoeJobSchema>;
/** Every name the app knows (member, conversation doctor, intake doctor), redacted the same way on every route (privacy audit B3-7). */
const knownNames=(job:ZoeJob)=>[...nameTokens(job.displayName),...nameTokens(job.conversation?.doctorName),...nameTokens(job.intake?.doctorName)].filter(t=>!/^(dr|doctor)$/iu.test(t));

export type ReserveResult={ok:true}|{ok:false;code:string};
export type RunOutcome='draft_proposed'|'draft_blocked'|'summary_only'|'discarded'|'no_output'|'answered'|'intake_asked'|'intake_completed'|'intake_escalated'|'chatted';
/** What one intake turn leaves behind: the intake row's new state, and on an ending the doctor summary. */
export type IntakeFinish={id:string|null;sheetId:string;sheetVersion:number;startedSeq:number;language:ReplyLanguage;state:'active'|'completed'|'stopped'|'escalated';
 record:IntakeRecord;
 /** The doctor summary: final on an ending; while active, the one used if the member goes quiet. Null only for a red flag with no sheet. */
 summary:SymptomSummary|null;
 /** Who wrote the text to the member: the model (guarded), the sheet's own wording, or fixed text. */
 answerSource:'model'|'sheet'|'fixed';
 /** RF ids for the care-team alert on a red flag (may be empty: a symptom red flag without an RF id). */
 alertRedFlags:string[]|null};
export type FinishInput={outcome:RunOutcome;reason:string;summary:string|null;draft:string|null;
 /** The direct answer to send to the member, and its language (outcome answered only). */
 answer:string|null;language:ReplyLanguage|null;guardReasons:string[];redactionCount:number;
 usage:{inputTokens:number;outputTokens:number}|null;costUsd:number;latencyMs:number|null;provider:string;model:string;sealed:string|null;events:ZoeEvent[];
 /** The risk tier (none when the run stopped before routing, e.g. urgent words), why, and whether the fallback answered. */
 tier:'none'|Tier;tierReason:string;fallbackUsed:boolean;
 intake?:IntakeFinish|null;
 /** Outcome chatted: the class and who wrote the text (the model, guarded, or the fixed wording). */
 chat?:{kind:ChatClass;source:'model'|'fixed'}|null;
 /** The warm line for the member when Zoe sends nothing else and the message waits for the doctor; the database decides whether it goes. */
 receipt?:{text:string;language:ReplyLanguage;kind:'receipt'|'deflection'}|null;
 /** A suspected prompt injection was detected in this run's unanswered messages (counted for the member limits). */
 injectionDetected?:boolean;
 /** Free mode (health-answer.ts): the level sent, the model's own level, and what happened about the doctor and why. */
 health?:{urgency:Urgency;modelUrgency:Urgency;forward:Forward;forwardReason:ForwardReason}|null;
 /** Free mode: the newest message's topic (topic.ts). zoe_run_finish records its start and owner; in doctor mode with the
  * 'topic' scope, owner 'zoe' is what lets Zoe's answer through. */
 topic?:TopicRecord|null;
 /** Intent checked against fresh database state under the conversation lock. */
 memberClearEnabled?:boolean;
 /** Fixed-rule facts for the member's alarm explanation, persisted atomically with the alarm. */
 alarmTrigger?:AlarmTrigger;
 memberClear?:{startedAt:string;readingId:string|null;readingVersion:string|null;reason:MemberClearReason}|null};
export type ZoePorts={
 /** Records the pre-provider events and reserves the estimate (every permitted attempt, judge included) against today's caps (K7, per member), atomically. */
 reserve(runId:string,estimateUsd:number,local:boolean,events:ZoeEvent[],route:{tier:Tier;model:string;judgeModel?:string|null}):Promise<ReserveResult>;
 /** Records the result and post-provider events; proposes the draft when it is still current. */
 finish(runId:string,input:FinishInput):Promise<{ok:boolean;outcome?:string}>;
 /** Read-only: may this run's redacted text go to the Decisions classifier (OpenAI), as the reservation would allow a model call (consent now, the provider's data agreement or staging mode, daily and member caps)? Absent or failed: nothing is sent. */
 authorizeClassifier?(runId:string):Promise<{ok:boolean;code?:string}>;
 /** Stores the structured draft's sources for the doctor while the run is started, before finish. Absent: structured drafts are off. */
 recordReplyDraft?(runId:string,record:ReplyDraftRecord):Promise<{ok:boolean}>;
 /** Stores the why record (why.ts) once the run finished. Absent or failed: the run has no record, and the read says so. */
 recordWhy?(runId:string,why:ZoeWhy):Promise<{ok:boolean}>;
 /** Puts the medicines the member confirmed on their own list, as their statement (zoe_run_medicines_add). Status added, or why not. */
 addMedicines?(runId:string,medicines:readonly ChatMedicine[]):Promise<{status:string}>;
 /** Stores what the member's newest message disputes on their questionnaire (zoe_run_member_statements). */
 recordStatements?(runId:string,statements:readonly MemberStatement[]):Promise<void>;
 /** Saves a very high reading the member typed (message seq, reading index) as their own, so the doctor's note or alert follows (zoe_run_bp_typed_save). saved: on the record; notified: the note or alert row exists. */
 saveTypedBp?(runId:string,reading:{seq:number;index:number;systolic:number;diastolic:number}):Promise<{saved:boolean;notified:boolean}>;
 /** Keeps urgent observation writes alive after the response without blocking Telegram dispatch. */
 afterReply?(task:()=>Promise<void>):void;
};
/** One allow-listed Gateway model with its list price. */
export type RouteModel={id:string;inputUsdPerMTok:number;outputUsdPerMTok:number};
export type RouteConfig={tiers:Partial<Record<Tier,{version:number;dailyCapUsd:number;model:RouteModel;fallback:RouteModel|null}>>};
/** Tier routing: the admin's per-tier models, and how to get a provider for one (stand-in fake while calls are off). */
export type ZoeRouting={config:RouteConfig;providerFor:(model:RouteModel)=>ZoeProvider|null;classifier?:TierClassifier};
export type Seal=(plain:{memberBlock:string;response:string|null;
 /** A malformed judge verdict, first 200 characters, redacted. */judgeMalformed?:string})=>string|null;

const guardEvent=(v:FieldVerdict):ZoeEvent=>({name:`zoe.guard.output_${v.field}`,outcome:v.outcome==='pass'?'allow':v.outcome==='flag'?'recorded':'block',
 reason:v.outcome==='pass'?'no_category_matched':v.outcome==='flag'?'flagged_for_doctor':'blocked_category_matched',rule:'zoe.output_guard',ruleVersion:OUTPUT_GUARD_VERSION,actor:'system',
 attributes:{'noreon.zoe.guard.name':`output_${v.field}`,'noreon.zoe.guard.field':v.field,'noreon.zoe.guard.categories':v.categories.join(',').slice(0,128)||'none'}});

// Member and reply text is data: escaped so it cannot close or forge a tag (Fable Z-F6).
// Control and bidirectional-override characters are removed first (warm replies guard layer 1).
const esc=(t:string)=>t.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/gu,'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
// The conversation in time order (oldest first): member messages, Zoe's answers, doctor replies.
const block=(messages:ZoeJob['messages'],replies:ZoeJob['replies'],answers:ZoeJob['answers']=[])=>{
 const turns=[...messages.map((m,i)=>({ago:m.minutesAgo,order:i,text:`<message seq="${m.seq}" minutes_ago="${m.minutesAgo}">${esc(m.text)}</message>`})),
  ...answers.map((a,i)=>({ago:a.minutesAgo,order:1000+i,text:`<zoe_answer minutes_ago="${a.minutesAgo}">${esc(a.body)}</zoe_answer>`})),
  ...replies.map((r,i)=>({ago:r.minutesAgo,order:2000+i,text:`<doctor_reply minutes_ago="${r.minutesAgo}">${esc(r.body)}</doctor_reply>`}))];
 turns.sort((a,b)=>b.ago-a.ago||a.order-b.order);
 return ['<member_messages>',...turns.map(t=>t.text),'</member_messages>'].join('\n');
};

/** The intake state for a red flag: stopped, with the doctor summary (ending red_flag) and the alert's RF ids. */
function escalation(sheet:SymptomSheet|null,record:IntakeRecord,hits:readonly RedFlagHit[],lang:ReplyLanguage,id:string|null,startedSeq:number,latestReading:{systolic:number;diastolic:number;minutesAgo:number}|null,activeLang?:ReplyLanguage):IntakeFinish{
 const r:IntakeRecord={...structuredClone(record),redFlags:mergeHits(record.redFlags,hits)};
 const all=r.redFlags;
 if(!sheet)return {id,sheetId:'none',sheetVersion:0,startedSeq,language:lang,state:'escalated',record:r,summary:null,answerSource:'fixed',alertRedFlags:redFlagIds(all)};
 return {id,sheetId:sheet.id,sheetVersion:sheet.version,startedSeq,language:activeLang??lang,state:'escalated',record:r,
  summary:buildSummary(sheet,r,{ending:'red_flag',language:lang,latestReading}),answerSource:'fixed',alertRedFlags:redFlagIds(all)};
}

/**
 * A message that is EXACTLY a short, resolved, past physical symptom: "yesterday I had chest pain, it passed" and its few fixed variants in en, ru and hy (Armen's QA, 3 Nov). A whitelist
 * (Astra): any other clause, negation, extra word or unrecognised content ("it never went away", "I swallowed poison", a long message) matches nothing and keeps the crisis wording.
 * Wording only.
 */
const PAST_SYM=[
 /^(?:(?:yesterday|last night|last week|earlier(?: today)?|\d+ days? ago|a few days ago)[,.]? (?:i (?:had|felt|got)|there was|my) (?:a |some )?(?:chest pain|chest tightness|chest pressure|pain in my chest|tightness in my chest|pressure in my chest|heart pain)|i (?:had|felt|got) (?:a |some )?(?:chest pain|chest tightness|chest pressure) (?:yesterday|last night|last week|earlier(?: today)?|\d+ days? ago|a few days ago))[,.;]? (?:but )?(?:it|that) (?:passed|went away|stopped|is gone|has gone|was gone)[.!]?$/u,
 /^(?:(?:вчера|на прошлой неделе|ночью|ранее|несколько дней назад)[,.]? (?:у меня )?(?:болела грудь|была боль в груди|давило в груди|болело сердце|болело в груди)|(?:у меня )?(?:болела грудь|была боль в груди|давило в груди|болело сердце|болело в груди) (?:вчера|на прошлой неделе|ночью|ранее|несколько дней назад))[,.;]? (?:но )?(?:уже )?(?:всё |все )?(?:прошло|прошла)[.!]?$/u,
 /^(?:(?:երեկ|անցյալ շաբաթ|մի քանի օր առաջ)[,.։]? (?:կրծքավանդակումս|կրծքավանդակիս|կրծքիս) ցավ (?:եմ ունեցել|ունեի)|(?:կրծքավանդակումս|կրծքավանդակիս|կրծքիս) ցավ (?:եմ ունեցել|ունեի) (?:երեկ|անցյալ շաբաթ|մի քանի օր առաջ))[,.։;]? (?:բայց )?(?:անցավ|անցել է)[.։!]?$/u,
];
export const resolvedPastSymptom=(raw:string)=>{const t=normaliseText(raw).replaceAll('’',"'").replace(/\s+/gu,' ').trim();return PAST_SYM.some(re=>re.test(t));};

/** Runs one claimed job to a finished run. Never throws for a guard or provider outcome. */
export async function runZoeJob(input:z.input<typeof zoeJobSchema>|ZoeJob,deps:{
 /** Tests: the run's time budget (default RUN_BUDGET_MS / RETRY_CUTOFF_MS). */timeBudget?:{budgetMs:number;cutoffMs:number};provider:ZoeProvider|null;ports:ZoePorts;seal:Seal;env?:Record<string,string|undefined>;now?:()=>number;routing?:ZoeRouting;
 /** The caller allows direct answers (the sweep: only with a real model). The job's database switch must agree. */
 directAnswers?:boolean;
 /** The reply judge (reply-check.ts). Absent: the judge tier's model from the routing, else the stand-in judge for a local speaker. Null: no judge (every member text is blocked). */
 judge?:ZoeProvider|null;
 /** Free-mode speed settings (free-mode-speed.ts). Absent: the shipped default with the environment's overrides. */
 freeSpeed?:FreeSpeed;
 /** The free-mode answer style (free-mode-style.ts); absent: NOREON_ZOE_FREE_STYLE, else the coach style. */
 freeStyle?:FreeStyle;
 /** Tests and evals: the topic check's model (topic.ts). Absent: the low tier's model, else the stand-in for a local speaker. Null: no check. */
 topicCheck?:ZoeProvider|null;
 /** The second check on a model-only emergency (urgent-check.ts). Absent: the medium tier's model (Sonnet). Null: none (the 103 goes out, fail safe). */
 urgencyCheck?:ZoeProvider|null}):Promise<{outcome:string;reason:string}>{
 const parsed=zoeJobSchema.parse(input);
 const originalLatest=parsed.messages.find(m=>m.seq===parsed.messageSeq)??parsed.messages.at(-1)!;
 const originalUnanswered=parsed.messages.filter(m=>m===originalLatest||m.seq>(parsed.conversation?.answeredThroughSeq??-1));
 // A carer's reading is a separate question, never this member's saved clinical facts. Uncertainty keeps the original job.
 const originalUrgentAges=parsed.answers.filter(a=>isUrgentAnswer(a.body)).map(a=>a.minutesAgo);
 const originalUrgentAge=originalUrgentAges.length?Math.min(...originalUrgentAges):parsed.memberClear?.sinceMinutes??parsed.urgentSinceMinutes??Infinity;
 const originalDoctorClosed=memberClearOn(deps.env??process.env)&&parsed.replies.some(r=>r.minutesAgo<originalUrgentAge);
 const originalWindow=!originalDoctorClosed&&urgentWindowOpen(parsed.answers,'',parsed.memberClear?.sinceMinutes??parsed.urgentSinceMinutes,parsed.messages.filter(m=>m!==originalLatest),parsed.memberClear?.throughSeq??parsed.urgentThroughSeq);
 const originalMonitored=memberClearOn(deps.env??process.env)&&!originalDoctorClosed&&!!parsed.memberClear?.startedAt
  &&parsed.memberClear.sinceMinutes!==null&&parsed.memberClear.sinceMinutes<=MONITORED_MIN;
 // The legacy database projection ends its window on any normal answer. Keep its cautious path until it can preserve this state.
 const thirdPartyBp=(!originalWindow||memberClearOn(deps.env??process.env))&&parsed.healthAnswers===true&&deps.directAnswers===true&&parsed.intake?.enabled===true&&!parsed.intake.active
  &&!parsed.urgentWindowUnavailable&&thirdPartyBpOnly(originalUnanswered.map(m=>m.text));
 const scoped:ZoeJob=thirdPartyBp?{...parsed,messages:originalUnanswered,answers:[],replies:[],health:null,memberRecord:null,topic:undefined,
  urgentSinceMinutes:null,urgentOpenedBy:null,urgentThroughSeq:null,memberClear:undefined,selfHarmTodayMinutes:null,
  intake:parsed.intake?{...parsed.intake,latestReading:null}:undefined}:parsed;
 const job={...scoped,health:spendLabFloors(scoped.health,scoped.answers,scoped.replies,scoped.messages.map(m=>m.text))};
 // A coming-days result (soonFloor) needs the health route even for "hello", and a critical CK its statin sentence on every fixed same-day text.
 const labSoon=soonFloor(job.health),withStatinLine=(t:string,l:ReplyLanguage)=>job.health?.labs.some(statinLab)?`${t} ${STATIN_PAUSE_LINE[l]}`:t;
 // The member's app is the new chat (provider.ts): no sections and no cards. A message that came by Telegram keeps its cards. The source cannot tell
 // /patient/zoe from /patient/chat (both are the app), so with the switch on every app message counts as the new chat.
 const chatV2=chatV2On(deps.env??process.env)&&job.viaTelegram!==true;
 const memberClearing=memberClearOn(deps.env??process.env);
 const clearContext=memberClearing?job.memberClear:undefined;
 // Cleared alarm history must not become a new model emergency. The full record and same-day floors stay intact.
 const modelHealth=clearContext?.suppressStoredReading&&job.health?{...job.health,bpWeek:null,bpReported:[]}:job.health;
 const modelWindow=clearContext?.clearThroughSeq!=null?{...job,health:modelHealth,
  messages:job.messages.filter(m=>m.seq>clearContext.clearThroughSeq!||m.seq===job.messageSeq),
  answers:job.answers.filter(a=>clearContext.clearSinceMinutes!=null&&a.minutesAgo<clearContext.clearSinceMinutes&&!isUrgentAnswer(a.body)),
  replies:job.replies.filter(r=>clearContext.clearSinceMinutes!=null&&r.minutesAgo<clearContext.clearSinceMinutes)}:job;
 // Saved questionnaire data or a later explicit chat answer closes an old data clarification. Safety checks still read job.
 // An injection attempt that already got its reply stays out of what the model reads (it is still on the record for the doctor), so it cannot steer a later answer and
 // does not silence Zoe for every message after it (Armen's QA, 3 Nov: one "ignore your rules" test left the next twenty messages with only the summary line).
 const answeredThrough=job.conversation?.answeredThroughSeq??0;
 const answeredInjection=(m:{seq:number;text:string})=>m.seq!==job.messageSeq&&m.seq<=answeredThrough&&classifyScope(m.text).injection;
 const modelJob={...modelWindow,messages:modelWindow.messages.filter(m=>!answeredInjection(m)),answers:modelWindow.answers.map(a=>({...a,body:dropAnsweredQuestions(a.body,{
  record:job.memberRecord,health:modelHealth,medicines:job.topic?.profile?.medicines,
  memberTexts:modelWindow.messages.filter(m=>m.minutesAgo<=a.minutesAgo).map(m=>m.text),
 })||'[Earlier data clarification resolved.]'}))};
 const clearNote=clearContext?.clearThroughSeq!=null?'\n<member_cleared_alarm>The member ended the previous repeated 103 advice. Earlier alarm messages and the cleared BP are historical, not evidence of a current emergency. Assess new messages and new readings independently.</member_cleared_alarm>':'';
 // Keep the member's original alert pending without repeating or cancelling it for someone else's question.
 let alarmConversation=thirdPartyBp&&(originalWindow||originalMonitored);
 let alarmSnapshot:AlarmTrigger|undefined;
 let confirmedStoredSymptom=false;
 const urgentAges=job.answers.filter(a=>isUrgentAnswer(a.body)).map(a=>a.minutesAgo);
 const newestUrgentAgo=urgentAges.length?Math.min(...urgentAges):clearContext?.sinceMinutes??job.urgentSinceMinutes??null;
 const doctorClosedAlarm=memberClearing&&newestUrgentAgo!==null&&job.replies.some(r=>r.minutesAgo<newestUrgentAgo);
 const alarmOpen=memberClearing&&!doctorClosedAlarm&&!job.urgentWindowUnavailable&&urgentWindowOpen(job.answers,job.messages.find(m=>m.seq===job.messageSeq)?.text??'',clearContext?clearContext.sinceMinutes:job.urgentSinceMinutes,job.messages.filter(m=>m.seq!==job.messageSeq),clearContext?.throughSeq??job.urgentThroughSeq);
 // The monitored day after an alert, acute window open or closed: a later model emergency cannot rest on it (urgent-check.ts).
 // A member's or doctor's clear ends it at once: the stored window then has no start until a new urgent text.
 const recentAlert=memberClearing&&newestUrgentAgo!==null&&newestUrgentAgo<=MONITORED_MIN&&(!clearContext||!!clearContext.startedAt);
 const now=deps.now??(()=>performance.now());
 // The run's time budget (Fable PR2 F2; fits #326's deadlines: at least 140 s on the cron; the webhook admits a second
 // run only with RUN_WORST_MS left): past the cut-off no further attempt, fallback, retry or structured draft starts;
 // each speaker call gets what is left after the judge's share (5 to 20 s), the judge the rest (3 to 10 s).
 const runStart=now(),timeBudget=deps.timeBudget?{...deps.timeBudget}:{budgetMs:RUN_BUDGET_MS,cutoffMs:RETRY_CUTOFF_MS};
 let callMaxMs=CALL_TIMEOUT_MAX_MS;
 let budgetNoted=false;
 const late=(what:string)=>{const over=now()-runStart>timeBudget.cutoffMs;if(over&&!budgetNoted){budgetNoted=true;
  events.push({name:'zoe.budget',outcome:'block',reason:'retry_skipped_time_budget',rule:'zoe.time_budget',ruleVersion:TIME_BUDGET_VERSION,actor:'system',attributes:{'noreon.zoe.budget.skipped':what,'noreon.zoe.budget.elapsed_ms':Math.round(now()-runStart)}});}
  return over;};
 const left=()=>timeBudget.budgetMs-(now()-runStart);
 const callTimeout=()=>Math.max(MIN_CALL_MS,Math.min(callMaxMs,left()-JUDGE_TIMEOUT_MS));
 const judgeTimeout=()=>Math.max(JUDGE_MIN_MS,Math.min(JUDGE_TIMEOUT_MS,left()));
 const events:ZoeEvent[]=[];
 // The why record (why.ts): every event of the run, the member data it had, the prompt and the rationale, kept as the run goes.
 const trail:ZoeEvent[]=[],takeEvents=()=>{const e=events.splice(0);trail.push(...e);return e;};
 const runAt=new Date();
 const seen=(extra:Omit<Parameters<typeof whyData>[0],'messages'|'health'>={},clean:(t:string)=>string=t=>t)=>{
  const data=whyData({messages:modelJob.messages,health:modelHealth,...extra},runAt).map(d=>({...d,value:d.value&&clean(d.value)}));return {data,doubts:whyDataDoubts(data,modelHealth)};};
 let whySeen=seen({reading:job.intake?.latestReading}),whyPrompt:string|null=null;
 const rationale:{asked:boolean;why:ModelWhy|null;model:string|null;missing:string|null}={asked:false,why:null,model:null,missing:null};
 // Free mode (health-answer.ts): the switch on the job and a caller with a real model.
 // It needs the symptom red flags on (they run with the intake switch; Astra ZH-04): otherwise the paths as before.
 const freeMode=job.healthAnswers===true&&deps.directAnswers===true&&job.intake?.enabled===true;
 // Spec §11: in free mode the crisis text also names the emotional support line (STAGING: hours to verify before go-live).
 const crisisText=(l:ReplyLanguage)=>freeMode?`${CRISIS_TEXT[l]} ${CRISIS_LINE_TEXT[l]}`:CRISIS_TEXT[l];
 // Free mode's 103 message carries the dataset's safety steps (extra rules 8-10); otherwise the text as before.
 const latest=job.messages.find(m=>m.seq===job.messageSeq)??job.messages.at(-1)!;
 const pde5Nitrate=pde5NitrateContext(latest.text,{earlier:job.messages.filter(m=>m.seq<latest.seq).map(m=>m.text),
  medicines:[...(job.topic?.profile?.medicines??[]).map(m=>m.name),modelHealth?.plan?.medicationName??'',...(job.memberRecord?.ldl?.therapies??[]).map(m=>m.name)]});
 // A medicine question on the urgent route gets an explicit no first (lead 19 Oct 21:45; dataset S029; spec §9), in both modes.
 // Free mode (Armen msg 167, lead 19:15): the usual-medicines line except with chest or back pain or bleeding, and low-sugar first aid when the conversation is about low sugar.
 const trainingPause=(text:string,l:ReplyLanguage)=>freeMode&&trainingAfterFaint(job.messages.map(m=>m.text),latest.text)?`${text} ${NO_TRAINING_LINE[l]}`:text;
 const urgentText=(l:ReplyLanguage)=>{
  if(!freeMode)return mentionsMedicine(latest.text)?URGENT_MEDICINE_TEXT[l]:URGENT_TEXT[l];
  const text=trainingPause(urgentStepsText(l,job.messages.map(m=>m.text),mentionsMedicine(latest.text)),l);
  return pde5Nitrate?`${text}\n\n${PDE5_NITRATE_CATEGORICAL[l][0]}.`:text;};
 // The redacted input and output sealed for this run, kept so a malformed judge verdict can be added at the finish.
 let sealInput:{memberBlock:string;response:string|null}|null=null,judgeMalformedSample:string|undefined;
 const seal=(p:{memberBlock:string;response:string|null})=>{sealInput=p;return deps.seal(p);};
 let provider=deps.provider;
 // The run's one reply judge, picked when the path reserves (budget) and the only judge it may call: never a
 // model that may speak in this run (pickJudge, Codex RJ-2); fail closed when none differs.
 let runJudge:ZoeProvider|null=null;
 // judgeTier 'low' (free mode's fast judge, free-mode-speed.ts) tries the low tier's model first, then the medium tier's as before.
 // The high tier's model is the last candidate: a medium-tier speaker shares its model and fallback with the judge's tier, so
 // no judge was left and every such health reply became the careful line (31 of 31 medium-tier eval turns; 26 of 596 turns).
 const pickRunJudge=(p:ZoeProvider,fb:ZoeProvider|null,judgeTier:'medium'|'low'='medium'):ZoeProvider|null=>{
  const med=deps.routing?.config.tiers.medium,low=judgeTier==='low'?deps.routing?.config.tiers.low:undefined,high=deps.routing?.config.tiers.high;
  const r=deps.routing;
  const candidates=deps.judge!==undefined?[deps.judge]:r?[low?r.providerFor(low.model):null,med?r.providerFor(med.model):null,low?.fallback?r.providerFor(low.fallback):null,med?.fallback?r.providerFor(med.fallback):null,high?r.providerFor(high.model):null]:[p.local?createFakeJudge():null];
  return pickJudge([p,fb],candidates);
 };
 // The judge's reasoning effort for this run (free mode only; otherwise the model's default).
 let judgeEffort:Effort|null=null;
 // The health judge's rubric: the coach style's, or the one before C1 (free-mode-style.ts).
 let healthRubric:'health'|'health_base'|'health_coach_first'='health';
 // The judge never sees an identifier: member and doctor names and the redaction rules, as for the speaker (Codex RJ-1).
 const judgeNames=knownNames(job);
 const forJudge=(t:string)=>redactText(t,{nameTokens:judgeNames}).text;
 // Codex F5: one reservation covers every permitted attempt (the speaker's retries and fallback, an extra
 // schema retry where the path has one, and the judge when the path may send member text), at the pre-call estimate.
 const budget=(p:ZoeProvider,fb:ZoeProvider|null,tokens:{inputTokens:number;outputTokens:number},extra:number,maxReplyChars:number|null,judgeCalls=1,extraUsd=0,judgeTier:'medium'|'low'='medium')=>{
  const one=Math.max(costUsd(p.pricing,tokens),fb?costUsd(fb.pricing,tokens):0);
  runJudge=maxReplyChars===null?null:pickRunJudge(p,fb,judgeTier);
  return {estimate:PROVIDER_ATTEMPTS*costUsd(p.pricing,tokens)+(fb?costUsd(fb.pricing,tokens):0)+extra*one+extraUsd+(runJudge&&maxReplyChars!==null?judgeCalls*JUDGE_ATTEMPTS*judgeBudget(runJudge,forJudge(latest.text),maxReplyChars):0),
   local:p.local&&(!fb||fb.local)&&(!runJudge||runJudge.local),judgeModel:runJudge?.requestModel??null};
 };
 // The reply check on a member text (rail 2): seven hard patterns on the model's words, then the run's judge on the complete text.
 const replyCheck=async(_speaker:ZoeProvider,modelText:string,fullText:string,lang:ReplyLanguage,memberTexts:readonly string[],path:'chat'|'intake'|'answer'|'health',context?:string,retryOutage=false)=>{
  const tooLong=alarmConversation&&fullText.length>(path==='health'?HEALTH_ANSWER_MAX_CHARS:ANSWER_MAX_CHARS);
  const rc:Awaited<ReturnType<typeof checkMemberReply>>=tooLong?{ok:false,reasons:['alarm.warning_length'],patterns:[],verdict:null,judge:null,usage:{inputTokens:0,outputTokens:0},costUsd:0,latencyMs:0}:await checkMemberReply({...(context?{context:forJudge(context)}:{}),modelText,fullText:forJudge(fullText),memberText:forJudge(latest.text),memberTexts,language:lang,judge:runJudge,now,path,redact:forJudge,...(path==='health'?{rubric:healthRubric}:{}),...(judgeEffort?{effort:judgeEffort}:{}),...(retryOutage?{retryOutage}:{}),
   // Each attempt gets its share of what is left; a retry only while the judge's floor still fits.
   timeoutFor:a=>a===1||left()>=JUDGE_MIN_MS?judgeTimeout():null});
  if(rc.malformedSample!==undefined)judgeMalformedSample??=rc.malformedSample;
  events.push({name:'zoe.guard.reply_check',outcome:rc.ok?'allow':'block',reason:rc.ok?'reply_check_passed':rc.reasons[0]!,rule:'zoe.reply_check',ruleVersion:REPLY_CHECK_VERSION,actor:rc.verdict?'ai':'system',
   attributes:{'noreon.zoe.guard.name':'reply_check','noreon.zoe.reply_check.reasons':rc.reasons.join(',').slice(0,128)||'none','noreon.zoe.reply_check.malformed':rc.malformed??'none','noreon.zoe.reply_check.attempts':rc.attempts??0,'noreon.zoe.reply_check.patterns':rc.patterns.join(',')||'none',
    'gen_ai.request.model':rc.judge?.model??'none','gen_ai.provider.name':rc.judge?.provider??'none','gen_ai.usage.input_tokens':rc.usage.inputTokens,'gen_ai.usage.output_tokens':rc.usage.outputTokens,
    'noreon.zoe.cost_usd':rc.costUsd,'noreon.zoe.latency_ms':rc.latencyMs}});
  return rc;
 };
 const route:{tier:'none'|Tier;tierReason:string;fallbackUsed:boolean}={tier:'none',tierReason:'not_routed',fallbackUsed:false};
 // Suspected injection anywhere in the unanswered messages (Codex review F2), recorded on the run whatever the outcome (F3).
 let injectionSeen=false;
 const base=()=>({summary:null,draft:null,answer:null,language:null,guardReasons:[] as string[],redactionCount:0,usage:null,costUsd:0,latencyMs:null,provider:provider?.providerName??'none',model:provider?.requestModel??'none',sealed:null,...route,injectionDetected:injectionSeen});
 // The warm receipt's language, set once the scope classifier knows it.
 let receiptLanguage:ReplyLanguage|null=null;
 // A suspected injection gets the polite fixed deflection instead of the receipt (guard layer 1).
 // Self-harm words (the placeholder list's entries with no RF id): the warmer crisis text (lead 18 Oct, QA R10).
 let selfHarmFollowUp=false;
 const crisisWindowSince=clearContext?.sinceMinutes??job.urgentSinceMinutes;
 const crisisWindowAnswers=crisisWindowSince!=null?job.answers.filter(a=>a.minutesAgo<=crisisWindowSince)
  :job.answers.slice(job.answers.findLastIndex(a=>!isUrgentAnswer(a.body))+1);
 const crisis=()=>selfHarmFollowUp||job.messages.some(m=>selfHarmLevel(m.text)!=='none')
  // A plan/means/goodbye also chooses crisis wording when an escalation is already required (including a physical red flag).
  ||selfHarmPlanPhrase(job.messages.filter(m=>m===latest||m.seq>(job.conversation?.answeredThroughSeq??-1)).map(m=>m.text).join('\n'))
  ||urgentWindowOpen(job.answers,'',clearContext?.sinceMinutes??job.urgentSinceMinutes,job.messages.filter(m=>m!==latest),clearContext?.throughSeq??job.urgentThroughSeq)
   &&crisisWindowAnswers.some(a=>Object.values(CRISIS_TEXT).some(t=>a.body.startsWith(t)));
 // What keeps the called-103 answer out (urgent-followup.ts): a medicine question, low sugar anywhere in the chat, or glucose/diabetes words in the other messages.
 const calledBlockers=()=>({context:job.messages.filter(m=>m!==latest).map(m=>m.text),medicine:mentionsMedicine(latest.text),sugar:lowSugar(job.messages.map(m=>m.text)),pde5:pde5Nitrate});
 // The WORDING of an urgent text after a crisis: the crisis text (with the hotline line) whenever crisis() says so, except for a message that is itself a physical urgent match (`own`)
 // and positively describes a resolved past symptom ("yesterday I had chest pain, it passed", Armen's QA, 3 Nov) with nothing in the newest or unanswered messages that could be
 // a crisis. Wording only: crisis() alone still decides the forward, the summary and the alert reason (zoe_self_harm).
 const crisisWording=(own=false)=>crisis()&&!(own&&resolvedPastSymptom(latest.text)&&!selfHarmFollowUp
  &&!job.messages.filter(m=>m===latest||m.seq>(job.conversation?.answeredThroughSeq??-1)).some(m=>selfHarmLevel(m.text)!=='none'||selfHarmPlanPhrase(m.text)));
 const escalationText=(l:ReplyLanguage)=>crisisWording(true)?crisisText(l):urgentText(l);
 let abuseSeen=false;
 // The newest message's topic once healthTurn decided it (topic.ts); every later finish carries it.
 let topicRec:TopicRecord|null=null;
 const receiptFor=(outcome:RunOutcome)=>!receiptLanguage||!job.conversation?.enabled||outcome==='chatted'||outcome.startsWith('intake_')?null
  :injectionSeen?{text:deflectionText(receiptLanguage,firstName(job.displayName)),language:receiptLanguage,kind:'deflection'as const}
  // A complaint or frustration ("Nobody answers me", "you are useless") gets sorry-for-the-wait, never silence; a
  // second receipt in a row a short follow-up line (QA 18 Oct C01, C02, S06).
  :{text:receiptText(receiptLanguage,{firstName:firstName(job.displayName),doctorName:job.conversation.doctorName,greeted:startsWithGreeting(latest.text),
    complaint:abuseSeen||COMPLAINT.test(latest.text.toLowerCase()),worried:WORRIED.test(latest.text.toLowerCase()),followUp:isReceipt(job.answers.at(-1)?.body),
    // A short reply to Zoe's own question is an answer, never something to thank for (Lead 19 Oct).
    question:isQuestion(latest.text)||(/[?՞？]/u.test(job.answers.at(-1)?.body??'')&&shortReply(latest.text)),
    advice:ADVICE_ASK.test(normaliseText(latest.text)),safetyLine:SAFETY_LINE[receiptLanguage]}),language:receiptLanguage,kind:'receipt'as const};
 // Abuse limits (guard layer 4): repeated injection attempts or this member's daily spend stop model calls for them; fixed texts only.
 const throttle=!job.conversation?.enabled?null:job.conversation.injectionsLast24h>=INJECTION_THROTTLE?'member_throttled_injection'
  :job.conversation.memberSpentTodayUsd>=(job.conversation.memberDailyCapUsd??MEMBER_DAILY_CAP_USD)?'member_spend_cap_reached':null;
 if(throttle)events.push({name:'zoe.guard.member_limit',outcome:'block',reason:throttle,rule:'zoe.member_limits',ruleVersion:CONVERSATION_VERSION,actor:'system',
  attributes:{'noreon.zoe.guard.name':'member_limit','noreon.zoe.member.injections_24h':job.conversation!.injectionsLast24h,'noreon.zoe.member.spent_today_usd':job.conversation!.memberSpentTodayUsd}});
 // Task 14: "I never had a stroke" is the member's statement, stored and flagged for the doctor. Nothing about urgency reads it.
 const corrections=questionnaireCorrections(latest,job.topic?.profile?.conditions??[]);
 // Reuse the existing fixed handoff and safety wording. An unreadable script cannot establish reassurance.
 const unreadableLanguage=!!job.conversation?.enabled&&/\p{L}/u.test(latest.text)&&!classifyScope(latest.text).replyLanguage;
 const languageForward=(urgency:'doctor_soon'|'same_day'='doctor_soon'):Partial<FinishInput>=>{
  const language=job.conversation?.locale??'hy';
  return {receipt:{text:closingText(language,null),language,kind:'receipt'},
   summary:'Message language could not be read. Care team review is needed. See the conversation.',
   health:{urgency,modelUrgency:'none',forward:'auto',forwardReason:urgency==='same_day'?'same_day':'zoe_could_not_answer'}};
 };
 // OpenAI Decisions API (decisions.ts). One call per run, shared by the shadow trace line and the three switchable effects. The finish waits for it
 // (its own 1.5 s timeout bounds the wait) so the trace line is not lost on a fast run, except on an urgent exit, which is never delayed.
 const dflags=decisionsFlags(deps.env??process.env);
 let decisionsP:Promise<DecisionsResult>|null=null,decisionsRes:DecisionsResult|null=null,decisionsCurrent:CurrentDecision|null=null,decisionsTraced=false;
 const decisionsEffects:string[]=[];
 let decisionsTopicVeto=false;
 const finish=async(outcome:RunOutcome,reason:string,extra:Partial<FinishInput>={})=>{
  if(decisionsP&&outcome!=='intake_escalated'&&!reason.startsWith('urgent'))await decisionsP;
  if(decisionsRes&&decisionsCurrent&&!decisionsTraced){decisionsTraced=true;events.push(decisionsTraceEvent(decisionsRes,decisionsCurrent,decisionsEffects));}
  // Last guard: no enabled conversation with real letters may disappear at a language exit.
  if(outcome==='discarded'&&reason==='language_not_supported'&&job.conversation?.enabled&&/\p{L}/u.test(latest.text)){
   outcome='summary_only';reason='language_unreadable_forwarded';extra={...extra,...languageForward()};
  }
  if(outcome==='intake_escalated'||extra.health?.urgency==='emergency')alarmConversation=false;
  if(alarmConversation){
   events.push({name:'zoe.urgent.conversation',outcome:'recorded',reason:'alarm_conversation_continues',rule:'zoe.alarm_conversation',ruleVersion:ALARM_CONVERSATION_VERSION,actor:'system',
    attributes:{'noreon.zoe.alarm.started_at':clearContext?.startedAt??'unknown','noreon.zoe.alarm.response':reason}});
  }
  if(memberClearing&&(outcome==='intake_escalated'||extra.health?.urgency==='emergency'||outcome==='discarded'&&reason==='urgent_route_no_model_call')){
   const texts=job.messages.filter(m=>m.seq===job.messageSeq||m.seq>(job.conversation?.answeredThroughSeq??-1)).map(m=>m.text);
   const hits=textRedFlags(texts,{intakeActive:!!job.intake?.active,storedReadingNeedsText:alarmOpen||isSymptomNowQuestion(job.answers.at(-1)?.body),latestReading:clearContext?.suppressStoredReading?null:job.intake?.latestReading,readingContextTexts:texts});
   const words=texts.flatMap(t=>stagingMatches(t));
   const records=extra.intake?.record.redFlags??[];
   alarmSnapshot={rules:[...new Set([...words.flatMap(w=>[w.id,...(w.redFlag?[w.redFlag]:[])]),...hits.flatMap(h=>[h.id,...(h.rf?[h.rf]:[])]),...records.flatMap(h=>[h.id,...(h.rf?[h.rf]:[])]),...(confirmedStoredSymptom?['bp_crisis_reading','RF-03']:[]),...(events.some(e=>e.reason==='alarm_problem_worsening')?['problem_worsening']:[])])].slice(0,40),
    messageHash:alarmMessageHash(texts.join('\n')),symptoms:[...new Set(texts.flatMap(alarmSymptoms))],symptom:alarmSymptom(texts.find(t=>assertedAlarmSymptom(t))??(confirmedStoredSymptom?'':latest.text)),
    reading:(hits.some(h=>h.id==='bp_crisis_reading')||confirmedStoredSymptom)&&job.intake?.latestReading?{systolic:job.intake.latestReading.systolic,diastolic:job.intake.latestReading.diastolic,id:clearContext?.readingId??null,version:clearContext?.readingVersion??null,measuredAt:clearContext?.readingMeasuredAt??null}:null};
   alarmSnapshot.kind=alarmSnapshot.reading?'saved_reading':alarmSnapshot.rules.length?'symptom_words':'urgency_check';
   events.push({name:'zoe.urgent.trigger',outcome:'recorded',reason:'trigger_snapshot_captured',rule:'zoe.alarm_conversation',ruleVersion:ALARM_CONVERSATION_VERSION,actor:'system',attributes:{'noreon.zoe.alarm.rules':alarmSnapshot.rules.join(',').slice(0,128)||'none'}});
  }
  // A malformed judge verdict's first 200 characters go into the sealed (encrypted) run record, never the trace.
  if(judgeMalformedSample!==undefined&&extra.sealed!==undefined&&sealInput)extra={...extra,sealed:deps.seal({...sealInput,judgeMalformed:judgeMalformedSample})};
  // The abuse staff flag rides on every finish, wherever the run ends (it no longer ends the run).
  const guardReasons=abuseSeen?[...new Set([...(extra.guardReasons??[]),'staff_flag.abusive'])].slice(0,20):extra.guardReasons;
  // Spec v1 §14: every free-mode run logs the urgency, the triggers, the rule-book versions and the model (ids and codes only).
  if(freeMode){
   const urgentReason=/^urgent|red_flag/u.test(reason)||outcome==='intake_escalated';
   const triggers=[...new Set([...events.flatMap(e=>[e.attributes['noreon.zoe.urgent.red_flags'],e.attributes['noreon.zoe.red_flags.hits']]).filter((x):x is string=>typeof x==='string'&&x!=='none'&&x!==''),
    ...(guardReasons??[]),...(extra.health&&extra.health.forwardReason!=='none'?[`forward.${extra.health.forwardReason}`]:[])])].join(',').slice(0,256)||'none';
   events.push({name:'zoe.audit',outcome:'recorded',reason:'free_mode_run',rule:'zoe.audit',ruleVersion:FREE_MODE_CONFIG_VERSION,actor:'system',attributes:{
    'noreon.zoe.audit.urgency':extra.health?.urgency??(urgentReason?'emergency':'none'),'noreon.zoe.audit.triggers':triggers,
    'noreon.zoe.audit.rule_book':`${FREE_MODE_CONFIG_VERSION}+${STAGING_LEXICON_VERSION}+${SYMPTOM_RED_FLAGS_VERSION}`.slice(0,128),
    'noreon.zoe.audit.model':(extra.provider??provider?.providerName??'none')==='none'?'none':`${provider?.requestModel??'none'}`.slice(0,80)}});
  }
  const input:FinishInput={...base(),receipt:receiptFor(outcome),...(topicRec?{topic:topicRec}:{}),...extra,...(guardReasons?{guardReasons}:{}),outcome,reason,events:[...events],...(alarmSnapshot?{alarmTrigger:alarmSnapshot}:{}),...(memberClearOn(deps.env??process.env)?{memberClearEnabled:true}:{})};
  const urgentPublication=outcome==='intake_escalated'||outcome==='discarded'&&['urgent_route_no_model_call','urgent_health_answer_model','urgent_health_answer_red_flag_yes'].includes(reason);
  // Once per alert: on the first full 103 text only, never on the refusal or driving text, a repeat in the open window, or the
  // self-harm crisis text, which is not a "did you call 103" case.
  if(memberClearing&&urgentPublication&&!alarmOpen&&input.answer&&input.language&&!input.answer.endsWith(URGENT_CHECK_IN[input.language])&&!input.answer.startsWith(CRISIS_TEXT[input.language]))
   input.answer+=`\n\n${URGENT_CHECK_IN[input.language]}`;
  // Provenance is display evidence, not triage. Keep the 103-first publication byte for byte unchanged.
  const reported=[...ownBpReadings(job.messages.map(m=>m.text)),...(job.health?.bpReported??[])];
  if(input.summary)input.summary=labelBpQuotes(input.summary,'en',reported);
  if(!urgentPublication&&outcome!=='intake_escalated'&&input.health?.urgency!=='emergency'){
   if(input.answer)input.answer=labelBpQuotes(input.answer,input.language??'en',reported);
   if(input.receipt)input.receipt={...input.receipt,text:labelBpQuotes(input.receipt.text,input.receipt.language,reported)};
  }
  // Task 14: on every path, the urgent ones too, while the run is still started. A statement that cannot be saved never touches the run; the doctor still has the conversation.
  if(corrections.length&&deps.ports.recordStatements)await deps.ports.recordStatements(job.runId,corrections).catch(()=>console.error(`Zoe member statement not saved for run ${job.runId}`));
  const r=await deps.ports.finish(job.runId,input);
  // Publish urgent advice first. The save uses the same message/index key and triggers as the normal path,
  // but a slow or failed observation write must never hold up the 103 reply or Telegram dispatch.
  if(r.ok&&input.answer&&(outcome==='intake_escalated'||outcome==='discarded'&&reason.startsWith('urgent_'))&&deps.ports.saveTypedBp){
   const save=deps.ports.saveTypedBp;
   const readings=bpTypedSaves(job.messages.filter(m=>m===latest||m.seq>(job.conversation?.answeredThroughSeq??-1)));
   if(readings.length){
    const persist=async()=>{for(const {seq,index,systolic,diastolic} of readings){
     try{await save(job.runId,{seq,index,systolic,diastolic});}catch{/* The urgent reply is already published. */}
    }};
    if(deps.ports.afterReply)deps.ports.afterReply(persist);else void persist();
   }
  }
  // After the answer is safely recorded: a record that cannot be built or saved never touches the run.
  if(r.ok&&deps.ports.recordWhy)try{await deps.ports.recordWhy(job.runId,zoeWhySchema.parse({...buildZoeWhy({at:new Date(),outcome,reason,answer:input.answer,draft:input.draft,receipt:input.receipt??null,language:input.language,
   modelWords:outcome==='answered'&&reason!=='health_answer_pde5_nitrate_fixed'||input.chat?.source==='model'||input.intake?.answerSource==='model',health:input.health??null,toDoctor:!!input.intake?.summary||!!input.summary&&(outcome==='summary_only'||outcome==='draft_blocked'),events:[...trail,...input.events],
   provider:input.provider,model:input.model,tier:input.tier,fallbackUsed:input.fallbackUsed,config:ZOE_CONFIG_VERSION,prompt:whyPrompt,...whySeen,rationale})}));}catch{/* The run has no record; the read says it is missing. */}
  return {outcome:r.outcome??outcome,reason};
 };
 const memberSpendCap=(lang:ReplyLanguage,extra:Partial<FinishInput>={})=>finish('summary_only','member_spend_cap_reached',{
  ...extra,summary:null,receipt:{text:(chatV2?MEMBER_SPEND_CAP_LINE_CHAT_V2:MEMBER_SPEND_CAP_LINE)[lang],language:lang,kind:'receipt'},
  health:{urgency:'none',modelUrgency:'none',forward:'none',forwardReason:'none'}});

 // 1. Urgent words first: a match never waits for, or depends on, a model (principle 1).
 const urgent=urgentDecision(latest.text,deps.env);
 events.push({name:'zoe.guard.urgent_match',outcome:urgent.outcome==='escalate'?'escalate':urgent.outcome==='skipped'?'skipped':'allow',reason:urgent.reason,rule:urgent.rule,ruleVersion:urgent.ruleVersion,actor:'system',
  attributes:{...urgent.attributes,'noreon.zoe.guard.name':'urgent_match'}});
 // Use the existing language detector. A short/unknown follow-up keeps the latest
 // answer's language before falling back to the chat locale. The broad latinArmenian
 // heuristic treats unknown English words such as "cancel" as Armenian.
 const newestOf=(list:typeof job.answers)=>list.reduce<(typeof job.answers)[number]|undefined>((last,a)=>!last||a.minutesAgo<=last.minutesAgo?a:last,undefined);
 const langOf=(a:(typeof job.answers)[number]|undefined)=>a?classifyScope(a.body).replyLanguage:null;
 // The conversation's language comes from ordinary turns: a 103 text in a relative's language does not move it (review R-01). With nothing else, that text is the conversation.
 const newestAnswer=newestOf(job.answers),previousLang=langOf(newestOf(job.answers.filter(a=>!isUrgentAnswer(a.body)))??newestAnswer);
 // Khikar, 4 Nov: ordinary replies and fixed lines are in the language of the latest message (scope.ts replyLanguageOf); only a short Latin-letter acknowledgement keeps the last answer's.
 const conversationLang=(detected:ReplyLanguage)=>replyLanguageOf(latest.text,detected,previousLang);
 // A 103 or crisis text is in the language of the message that raised it, whatever the conversation's (coordinator 2 Nov: a relative typing in Russian in
 // an English chat must be able to read it), and an explicit request for a language wins as for any reply (Astra LANG-03). Only a Latin-letter message with no language
 // of its own (an acknowledgement such as "ok", one word) keeps the language of Zoe's newest answer; Russian or Armenian letters, even in "спасибо", count.
 const urgentLang=(fallback:ReplyLanguage|null|undefined):ReplyLanguage=>{
  const asked=requestedLanguage(latest.text);if(asked)return asked;
  const sc=classifyScope(latest.text,{previous:previousLang,locale:job.conversation?.locale});
  const latinOnly=!/[\p{Script=Armenian}\p{Script=Cyrillic}]/u.test(latest.text);
  const acknowledgement=latinOnly&&(replyToAsk(latest.text)!==null||!!chatIntent(latest.text)?.classes.every(c=>SMALL_TALK.has(c)));
  const ambiguous=acknowledgement||sc.language==='other'||sc.language==='en'&&((latest.text.match(/[\p{L}]+/gu)??[]).length<=1||latinArmenian(latest.text));
  const newestLang=langOf(newestAnswer);
  return (ambiguous?newestLang??fallback:null)??sc.replyLanguage??newestLang??fallback??'hy';
 };
 // Ordinary fixed lines (the same-day line, a clarifying question) follow the same policy.
 const safetyLang=(fallback:ReplyLanguage|null|undefined):ReplyLanguage=>conversationLang(urgentLang(fallback));
 // Urgent words during an active symptom intake also end it (red flag), so the doctor gets the summary.
 const urgentIntake=()=>{const ik0=job.intake?.enabled?job.intake:null;const s0=ik0?.active?sheetById(ik0.active.sheetId,ik0.active.sheetVersion):undefined;
  if(!ik0?.active||!s0)return null;const lang=urgentLang(ik0.active.language);
  return finish('intake_escalated','urgent_words_intake_stopped',{answer:crisisWording(true)?crisisText(lang):urgentText(lang),language:lang,intake:escalation(s0,ik0.active.record,[{id:'urgent_words',rf:null,source:'text'}],lang,ik0.active.id,ik0.active.startedSeq,ik0.latestReading,ik0.active.language)});};
 // Outside an intake, the urgent text in the member's message language (RU too), the warmer crisis text for
 // self-harm words (QA R10, RU urgent locale); zoe_run_finish shows it in the app and sends it on Telegram, with
 // the zoe.urgent template as the fallback. STAGING wording pending Armen's sign-off (P41b).
 const urgentRoute=(reason:string)=>{const lang=urgentLang(job.conversation?.locale);
  // A refusal, a wait plan or a driving question after the 103 text gets its fixed answer (S100; urgent-followup.ts), never the same text again.
  // Fable FB-03: only on a follow-up inside the 103 window, and a medicine question keeps its explicit no (urgentText).
  const followUp=reason==='urgent_in_window_no_model_call'&&(memberClearing||!mentionsMedicine(latest.text))?urgentFollowUp(latest.text,lang,memberClearing,calledBlockers()):null;
  // Fable FB-01 (spec §10.2, §15): a refusal of 103 (the S100 reply) and self-harm go to the doctor automatically. zoe_run_finish
  // records the forward, audits it and raises the care alert with that reason (every urgent route raises one); the summary says what happened.
  const selfHarm=crisis(),wording=crisisWording(reason==='urgent_route_no_model_call'),change=!selfHarm&&urgentMedicineChange(latest.text,mentionsMedicine)&&urgentWindowOpen(job.answers,'',clearContext?.sinceMinutes??job.urgentSinceMinutes,job.messages.filter(m=>m!==latest),clearContext?.throughSeq??job.urgentThroughSeq);
  const fr:ForwardReason|null=selfHarm?'self_harm':change?'stopped_medicine':followUp===S100_TEXT[lang]?'refused_103':null;
  // The called-103 lead-in comes first and the ordinary urgent text follows it whole (condition-specific guidance such as the adrenaline pen or the nitrate warning stays).
  const calledLead=followUp!==null&&Object.values(CALLED_EAT_DRINK_TEXT).includes(followUp);
  const text=selfHarm&&wording?crisisText(lang):selfHarm?urgentText(lang):followUp?(calledLead?`${followUp} ${urgentText(lang)}`:trainingPause(followUp,lang)):urgentText(lang);
  return finish('discarded',reason,{answer:change?`${text} ${HANDOFF_NEXT[lang].meanwhile}`:text,language:lang,
   ...(fr?{health:{urgency:'emergency',modelUrgency:'none',forward:'auto',forwardReason:fr},summary:fr==='stopped_medicine'
    ?'The member proposed stopping, changing or skipping medicines during the 103 window. Zoe retained the urgent advice and added the existing medicine-change caution. Sent to the doctor automatically; see the conversation.'
    :URGENT_FORWARD_SUMMARY[fr]}:{})});};
 const sameAlarmReading=!recentCrisisReading(job.intake?.latestReading)||!!clearContext?.trigger?.reading&&clearContext.trigger.reading.id===clearContext.readingId&&clearContext.trigger.reading.version===clearContext.readingVersion&&clearContext.trigger.reading.systolic===job.intake?.latestReading?.systolic&&clearContext.trigger.reading.diastolic===job.intake?.latestReading?.diastolic;
 const sameAlarmMessage=latest.seq<=(clearContext?.throughSeq??job.urgentThroughSeq??-1);
 // Text equality is not message identity: fresh urgent wording always gets full guidance.
 const identicalAlarm=alarmOpen&&sameAlarmReading&&(urgent.outcome!=='escalate'||sameAlarmMessage)&&!!clearContext?.trigger&&clearContext.trigger.messageHash===alarmMessageHash(job.messages.filter(m=>m.seq===job.messageSeq||m.seq>(job.conversation?.answeredThroughSeq??-1)).map(m=>m.text).join('\n'))&&!urgentProblemContinues(latest.text);
 // Armen, 2 Nov (Task 8) sent thoughts of self-harm without a plan down a separate "today" receipt route (reason same_day_floor_self_harm), without 103. Armen's safety audit of 4 Nov
 // (S0-4, the newest instruction) supersedes it: on ANY red flag, passive thoughts included, the member FIRST gets the fixed 103 message (the crisis route: crisis text, 103 first, the hotline
 // after it, delivered as an urgent message with the urgent window and the care alert). The old branch is gone, so a passive message takes the ordinary urgent route below.
 const selfHarmBatch=job.messages.filter(m=>m===latest||m.seq>(job.conversation?.answeredThroughSeq??-1)).map(m=>m.text).join('\n');
 // Replies that went out before 4 Nov (the old "today" text, no 103) still have their 24 hours: a plan said after that reply, no doctor reply since, is read with it: the crisis text, even if
 // the first message has left the window.
 const lastDoctorReply=Math.min(Infinity,...job.replies.map(r=>r.minutesAgo));
 // The database's marker, not the newest ten answers; an older job without it reads the answers as before.
 const todayInAnswers=job.answers.filter(a=>a.minutesAgo>=0&&Object.values(SELF_HARM_TODAY_TEXT).some(x=>a.body.startsWith(x))).map(a=>a.minutesAgo);
 const selfHarmTodayAgo=job.selfHarmTodayMinutes!==undefined?job.selfHarmTodayMinutes:todayInAnswers.length?Math.min(...todayInAnswers):null;
 if(selfHarmPlanPhrase(selfHarmBatch)&&selfHarmTodayAgo!==null&&selfHarmTodayAgo<=24*60&&selfHarmTodayAgo<lastDoctorReply){
  selfHarmFollowUp=true;
  return urgentIntake()??urgentRoute('urgent_route_no_model_call');
 }
 if(urgent.outcome==='escalate'&&!identicalAlarm)return urgentIntake()??urgentRoute('urgent_route_no_model_call');
 // ZOE_DESIGN §3.1 (Fable Z-F1): no drafting while the urgent list is empty or unsigned. Today only
 // the fictional test list makes the check run; without it nothing reaches a model.
 if(urgent.outcome==='skipped'&&!unreadableLanguage)return finish('discarded','urgent_check_unavailable');
 // Fable F-1 (#211): the model sees the whole window, so urgent words in ANY earlier message of the
 // window also stop the run before routing, reservation or a model call.
 // Only messages Zoe has not answered yet (Gohar on prod 20 Oct 22:53; Astra Z103-04): an answered one already got its 103 text,
 // and the 103 window carries it on with its own exits («Զանգեցի 103»); re-reading it here repeated the 103 text to every exit and
 // would reopen a window the doctor cleared or that expired.
 const unansweredBatch=job.messages.filter(m=>m===latest||m.seq>(job.conversation?.answeredThroughSeq??-1));
 const earlier=unansweredBatch.filter(m=>m!==latest).map(m=>urgentDecision(m.text,deps.env)).find(d=>d.outcome==='escalate');
 if(earlier){
  events.push({name:'zoe.guard.urgent_window',outcome:'escalate',reason:'urgent_words_earlier_in_window',rule:earlier.rule,ruleVersion:earlier.ruleVersion,actor:'system',attributes:{...earlier.attributes,'noreon.zoe.guard.name':'urgent_window'}});
  return urgentIntake()??urgentRoute(memberClearing?'urgent_route_no_model_call':'urgent_in_window_no_model_call');
 }
 // Codex A2-1: a combination split across the messages Zoe has not answered yet ("My glucose is 25." then "I keep vomiting.";
 // a BP of 190/120 then "my vision is blurred") is the same emergency. The list runs once more over those messages only, joined
 // by newlines. Only the combination rules count there (the synthetic entries: BP with a target-organ symptom, and the groups that
 // are meant to be said apart, such as a high sugar and vomiting): an ordinary entry's words drawn from different messages
 // («սրտ» in one, «ցավ» in another) are not a match. Never over answered history.
 // Astra #384 R2: not when a message corrects an earlier one ("Sorry, I mistyped: my glucose is 5") or speaks of someone else
 // ("My mother has glucose 25"): the facts may not belong to one person now. Each message on its own was checked above.
 const batchMixed=unansweredBatch.some(m=>BATCH_CORRECTION.test(normaliseText(m.text))||BATCH_OTHER_PERSON.test(normaliseText(m.text)));
 const batchCombos=unansweredBatch.length>1&&!batchMixed&&stagingPlaceholderActive(deps.env??process.env)&&deps.env?.NOREON_ZOE_TEST_LEXICON!=='true'
  ?stagingMatches(unansweredBatch.map(m=>m.text).join('\n')).filter(e=>e.all.length===0&&!e.selfHarm&&!e.oneMessage):[];
 if(batchCombos.length){
  events.push({name:'zoe.guard.urgent_window',outcome:'escalate',reason:'urgent_combination_across_unanswered',rule:'zoe.urgent_staging_placeholder',ruleVersion:STAGING_LEXICON_VERSION,actor:'system',
   attributes:{'noreon.zoe.guard.name':'urgent_window','noreon.zoe.urgent.red_flags':[...new Set(batchCombos.map(e=>e.redFlag).filter((f):f is NonNullable<typeof f>=>!!f))].sort().join(','),
    'noreon.zoe.urgent.entries':batchCombos.length,'noreon.zoe.urgent.batch_messages':unansweredBatch.length}});
  return urgentIntake()??urgentRoute('urgent_route_no_model_call');
 }
 const windowSince=clearContext?clearContext.sinceMinutes:job.urgentSinceMinutes;
 // The persistent 103 window (urgent-window.ts): after Zoe's urgent text, every follow-up repeats it until the danger has passed.
 // A window opened only by a model's emergency (urgent-check.ts, Armen 20 Oct): a correction or a new topic gets one question
 // about the key red flags instead (after the red-flag rules below), then normal handling; a fixed rule's window as before.
 let windowExit:'correction'|'new_topic'|null=null;
 // Gohar on prod, 21 Oct 21:35: «Շրթունքներս ուռել են» got the 103 text, then «Զանգել եմ» closed the window as it should, but the
 // model read the emergency in the window, the second check confirmed it, and the 103 text went out again. When this message is the
 // member saying help was called or has come, inside an open 103 window, the model's emergency is not sent as the 103 text again.
 // Only a window a fixed rule opened (Astra #385): a model-opened window keeps its own exits and the second check.
 const helpReached=job.urgentOpenedBy!=='model'&&dangerPassed(latest.text)&&urgentWindowOpen(job.answers,'',job.urgentWindowUnavailable?undefined:windowSince,job.messages.filter(m=>m!==latest),job.urgentThroughSeq);
 const repeatWindow=()=>{
 if(!doctorClosedAlarm&&urgentWindowOpen(job.answers,latest.text,job.urgentWindowUnavailable?undefined:windowSince,job.messages.filter(m=>m!==latest),job.urgentThroughSeq)){
  const lang0=urgentLang(job.conversation?.locale);
  windowExit=freeMode&&!job.doctorMode&&!job.urgentWindowUnavailable&&job.urgentOpenedBy==='model'&&!job.intake?.active&&!mentionsMedicine(latest.text)
   ?modelWindowExit(latest.text,urgentFollowUp(latest.text,lang0,false,calledBlockers())!==null,job.messages.filter(m=>m!==latest).map(m=>m.text)):null;
  events.push({name:'zoe.guard.urgent_window',outcome:windowExit?'allow':'escalate',reason:windowExit?`model_window_${windowExit}`:'urgent_text_window_open',rule:'zoe.urgent_window',ruleVersion:URGENT_WINDOW_VERSION,actor:'system',
   attributes:{'noreon.zoe.guard.name':'urgent_window','noreon.zoe.urgent_window.opened_by':job.urgentOpenedBy??'unknown'}});
  if(!windowExit)return urgentIntake()??urgentRoute('urgent_in_window_no_model_call');
 }
 // Astra UW-2 round 3: the window could not be read, so an open window cannot be ruled out: no answer and no receipt of
 // Zoe's own; the message waits for the doctor (as with no provider).
 if(job.urgentWindowUnavailable){
  events.push({name:'zoe.guard.urgent_window',outcome:'block',reason:'urgent_window_unavailable',rule:'zoe.urgent_window',ruleVersion:URGENT_WINDOW_VERSION,actor:'system',attributes:{'noreon.zoe.guard.name':'urgent_window'}});
  return finish('no_output','urgent_window_unavailable',{receipt:null});
 }

  return null;
 };
 if(!memberClearing){const repeat=repeatWindow();if(repeat)return repeat;}

 // 1b. Symptom red flags (only while the intake switch is on): deterministic, every message of the
 // window not already escalated, before any model. Red always wins: the intake stops, the member
 // gets the urgent text, the care team an alert. Nothing a model says can clear one.
 const ik=job.intake?.enabled?job.intake:null;
 // Resuming an expired intake (Lead 19 Oct, Armen's live test: «Առավոտյան» answered the onset question the next
 // evening and was handled as a new symptom). The member's next message after an expired intake, short and not a
 // question, a conversational message or a new symptom: within RESUME_MAX_IDLE_MIN of their last intake message the
 // intake goes on with its record (a new row, the old one already reached the doctor); later it starts again warmly.
 const rs=ik&&!ik.active?ik.resumable??null:null;
 const rsSheet=rs?sheetById(rs.sheetId,rs.sheetVersion)??null:null;
 // Only on evidence that the reply answers the pending question (fitsPending; Codex review R2). A pending red-flag
 // question always resumes, at any age, so a "yes" escalates as it would have in the intake (Codex review R1).
 const lastZoe=job.answers.at(-1)?.body??null;
 const fits=!!rs&&!!rsSheet&&shortReply(latest.text)&&!isQuestion(latest.text)&&!chatIntent(latest.text)
  &&!startingSheet(latest.text,{thirdParty:classifyScope(latest.text).thirdPartyPossible,registered:ik!.registered})&&fitsPending(rsSheet,rs.record,latest.text,lastZoe);
 const pendingRedFlag=fits&&lastAskedQuestions(rsSheet!,rs!.record,lastZoe).some(q=>!!q.redFlagIfYes);
 const resumeKind:'resume'|'restart'|null=fits?(pendingRedFlag||rs!.idleMinutes<=RESUME_MAX_IDLE_MIN?'resume':'restart'):null;
 if(resumeKind)events.push({name:'zoe.intake.resume',outcome:'allow',reason:resumeKind==='resume'?'expired_intake_resumed':'expired_intake_restarted',rule:'zoe.symptom_intake',ruleVersion:INTAKE_VERSION,actor:'system',
  attributes:{'noreon.zoe.intake.sheet':rs!.sheetId,'noreon.zoe.intake.idle_minutes':rs!.idleMinutes}});
 const ikActive:(Omit<ActiveIntake,'id'>&{id:string|null})|null=ik?.active??(resumeKind==='resume'&&rs?{id:null,sheetId:rs.sheetId,sheetVersion:rs.sheetVersion,startedSeq:rs.startedSeq,language:rs.language,record:rs.record}:null);
 const activeSheet=ikActive?sheetById(ikActive.sheetId,ikActive.sheetVersion)??null:null;
 // Unanswered worsening must win before clarification, explanation, clearing or an ordinary answer.
 if(alarmOpen&&unansweredBatch.some(m=>!memberClearPhrase(m.text)&&urgentProblemContinues(m.text)&&!plainSettledChest(m.text))){
  events.push({name:'zoe.urgent.new_information',outcome:'escalate',reason:'alarm_problem_worsening',rule:'zoe.alarm_conversation',ruleVersion:ALARM_CONVERSATION_VERSION,actor:'system',attributes:{}});
  return urgentIntake()??urgentRoute('urgent_route_no_model_call');
 }

 // The pending one-question pattern applies to the unanswered batch, including a yes sent just before a new question.
 const nowAnswer=isSymptomNowQuestion(lastZoe)?unansweredBatch.find(m=>replyToAsk(m.text)==='yes'):undefined;
 const currentSymptom=unansweredBatch.find(m=>m.seq>(ik?.redFlagsAfterSeq??-1)&&assertedAlarmSymptom(m.text));
 if(memberClearing&&!job.doctorMode&&nowAnswer
  &&recentCrisisReading(ik?.latestReading)&&!clearContext?.suppressStoredReading
  &&!job.replies.some(r=>r.minutesAgo<=(job.answers.at(-1)?.minutesAgo??0))){
  confirmedStoredSymptom=true;
  events.push({name:'zoe.urgent.symptom_now',outcome:'escalate',reason:'current_symptom_confirmed',rule:'zoe.alarm_conversation',ruleVersion:ALARM_CONVERSATION_VERSION,actor:'system',attributes:{'noreon.zoe.alarm.question':'symptom_now','noreon.zoe.alarm.message_seq':nowAnswer.seq}});
  return urgentIntake()??urgentRoute('urgent_route_no_model_call');
 }
 if(ik){
  // Messages Zoe has already answered were checked when they came (Gohar 20 Oct 22:53: her answered 103 message re-escalated
  // «Զանգեցի 103»); the newest message is always checked.
  const texts=job.messages.filter(m=>m.seq>ik.redFlagsAfterSeq&&(m===latest||m.seq>(job.conversation?.answeredThroughSeq??-1))).map(m=>m.text);
  // The stored-reading rule reads the symptom from what Zoe has not answered yet (#377 F1); the newest message is always among them.
  const hits=textRedFlags(texts,{intakeActive:!!activeSheet,storedReadingNeedsText:memberClearing&&(alarmOpen||isSymptomNowQuestion(lastZoe)),latestReading:clearContext?.suppressStoredReading?null:ik.latestReading,readingContextTexts:texts,
   symptomContextTexts:job.messages.filter(m=>m.seq>ik.redFlagsAfterSeq).map(m=>m.text)}).filter(h=>h.id!=='bp_crisis'||!bpCrisisNotCurrent(texts));
  // The now-question's Latin-letter aliases follow the same stored-reading rule as its other forms.
  if(memberClearing&&currentSymptom&&recentCrisisReading(ik.latestReading)&&!clearContext?.suppressStoredReading&&!hits.some(h=>h.id==='bp_crisis_reading')){
   confirmedStoredSymptom=true;
   hits.push({id:'bp_crisis_reading',rf:'RF-03',source:'reading'});
  }
  // One of the rule's symptoms with the member's newest current reading, said in this message or the one Zoe asked after; the reading
  // may be typed and unsaved. Any symptom: 103, before the re-measure step. A history, a quotation or someone else's number is not it.
  const bpNow=clearContext?.suppressStoredReading?null:bpCurrentVeryHigh(job.messages,ik.latestReading);
  if(freeMode&&!hits.length&&bpNow&&unansweredBatch.some(m=>bpSymptomAsserted(m.text)))hits.push({id:'bp_crisis_reading',rf:'RF-03',source:'reading'});
  events.push({name:'zoe.guard.symptom_red_flags',outcome:hits.length?'escalate':'allow',reason:hits.length?'symptom_red_flag_matched':'no_symptom_red_flag',rule:'zoe.symptom_red_flags',ruleVersion:SYMPTOM_RED_FLAGS_VERSION,actor:'system',
   attributes:{'noreon.zoe.guard.name':'symptom_red_flags','noreon.zoe.red_flags.hits':hits.map(h=>h.id).join(',').slice(0,128)||'none','noreon.zoe.urgent.red_flags':redFlagIds(hits).join(',')||'none'}});
  const knownReading=alarmOpen&&clearContext?.trigger?.reading&&clearContext.trigger.reading.id===clearContext.readingId&&clearContext.trigger.reading.version===clearContext.readingVersion&&clearContext.trigger.reading.systolic===ik.latestReading?.systolic&&clearContext.trigger.reading.diastolic===ik.latestReading?.diastolic;
  const recordedSymptoms=clearContext?.trigger?.symptoms??[clearContext?.trigger?.symptom];
  const knownSymptoms=unansweredBatch.flatMap(m=>alarmSymptoms(m.text)).every(s=>recordedSymptoms.includes(s));
  const repeated=identicalAlarm&&(sameAlarmMessage||hits.every(h=>h.id==='bp_crisis_reading'))||knownReading&&hits.every(h=>h.id==='bp_crisis_reading')&&knownSymptoms&&!urgentProblemContinues(latest.text);
  const askNow=!knownReading&&memberClearing&&!job.doctorMode&&!currentSymptom&&hits.every(h=>h.id==='bp_crisis_reading')&&recentCrisisReading(ik.latestReading)&&!clearContext?.suppressStoredReading&&!!alarmSymptom(latest.text)&&generalSymptomQuestion(latest.text)&&(!ikActive||!activeSheet||alarmOpen||answerRedFlags(activeSheet,ikActive.record).length===0);
  if(askNow){
   const lang=urgentLang(job.conversation?.locale);
   alarmConversation=alarmOpen;
   events.push({name:'zoe.urgent.symptom_now',outcome:'recorded',reason:'general_question_not_current_symptom',rule:'zoe.alarm_conversation',ruleVersion:ALARM_CONVERSATION_VERSION,actor:'system',attributes:{'noreon.zoe.alarm.question':'symptom_now'}});
   // Keep the question last, as in the existing one-question pattern.
   const text=SYMPTOM_NOW_QUESTION[lang];
   return finish('summary_only','stored_crisis_symptom_now_question',{receipt:{text,language:lang,kind:'receipt'}});
  }
  if(hits.length&&!repeated){
   // Someone else's red flag with no intake open: the 103 path and the alert, but no intake row for the member (Fable F13).
   const sheet=activeSheet??startingSheet(latest.text,{thirdParty:classifyScope(latest.text).thirdPartyPossible,registered:ik.registered});
   const lang=urgentLang(ikActive?.language);
   return finish('intake_escalated','symptom_red_flag_no_model_call',{answer:escalationText(lang),language:lang,
    intake:escalation(sheet,ikActive?.record??emptyRecord(),hits,lang,ikActive?.id??null,ikActive?.startedSeq??latest.seq,ik.latestReading,ikActive?.language)});
  }
 }

 if(memberClearing&&!ik){
  const hits=textRedFlags(unansweredBatch.map(m=>m.text),{intakeActive:false});
  events.push({name:'zoe.guard.symptom_red_flags',outcome:hits.length?'escalate':'allow',reason:hits.length?'symptom_red_flag_matched':'no_symptom_red_flag',rule:'zoe.symptom_red_flags',ruleVersion:SYMPTOM_RED_FLAGS_VERSION,actor:'system',
   attributes:{'noreon.zoe.red_flags.hits':hits.map(h=>h.id).join(',').slice(0,128)||'none','noreon.zoe.urgent.red_flags':redFlagIds(hits).join(',')||'none'}});
  if(hits.length&&(!identicalAlarm||!sameAlarmMessage))return urgentRoute('urgent_route_no_model_call');
 }

 if(memberClearing){
  if(ik&&activeSheet&&ikActive){
   const record:IntakeRecord=structuredClone(ikActive.record);
   const direct=memberAsks(latest.text)?null:directAnswer(activeSheet,record,latest.text,lastZoe);
   if(direct)record.answers[direct.id]={value:direct.value,seq:latest.seq};
   const yes=yesToRedFlag(activeSheet,record,latest.text,lastZoe);
   const hits=[...answerRedFlags(activeSheet,record),...(yes?[yes]:[])];
   // Old stored findings do not veto an explicit clear; a fresh positive answer always does.
   if(hits.length&&(yes||direct?.value==='yes'&&activeSheet.questions.some(q=>q.id===direct.id&&q.redFlagIfYes))){
    const lang=urgentLang(ikActive.language);
    return finish('intake_escalated','intake_red_flag_answer_no_model_call',{answer:escalationText(lang),language:lang,
     intake:escalation(activeSheet,record,hits,lang,ikActive.id,ikActive.startedSeq,ik.latestReading)});
   }
  }
  if(freeMode&&lastZoe&&!pendingAsk(lastZoe)&&endsWithQuestion(lastZoe)&&replyToAsk(latest.text)==='yes'){
   const lastQ=lastZoe.trim().split(/(?<=[.։!])\s+/u).at(-1)??'';
   const hits=textRedFlags([lastQ],{intakeActive:true,latestReading:null});
   if(hits.length)return urgentRoute('urgent_route_no_model_call');
  }
 }

 // With the switch on, both deterministic guards have run on this message before any clear or repeat.
 if(memberClearing){
  const open=!doctorClosedAlarm&&(urgentWindowOpen(job.answers,'',job.urgentWindowUnavailable?undefined:windowSince,job.messages.filter(m=>m!==latest),job.urgentThroughSeq)||recentAlert&&(clearContext?.sinceMinutes??0)<=MONITORED_MIN);
  const clearVeto=unansweredBatch.some(m=>!memberClearPhrase(m.text)&&urgentProblemContinues(m.text)||vetoesReadingClear(m.text)||mentionsUrgentWords(m.text));
  const clearReason=clearVeto?null:memberClearPhrase(latest.text)??clearContext?.readingClearReason??null;
  // Feeling better does not resolve a recorded exertional faint; the original Level 1 concern remains.
  const faintAlarm=clearContext?.trigger?.rules.includes('fainting')||textRedFlags(job.messages.filter(m=>m.seq<latest.seq).map(m=>m.text),{intakeActive:false}).some(h=>h.id==='fainting');
  const canClear=!(clearReason==='feels_well'&&faintAlarm);
  if(open&&clearReason&&canClear&&clearContext?.startedAt&&!job.urgentWindowUnavailable){
   const lang=urgentLang(job.conversation?.locale);
   // A stored crisis value is not a fresh symptom. Disputing it suppresses that stored value on later turns.
   events.push({name:'zoe.urgent.member_clear_requested',outcome:'recorded',reason:clearReason,rule:'zoe.member_clear',ruleVersion:MEMBER_CLEAR_VERSION,actor:'system',
    attributes:{'noreon.zoe.member_clear.member_id':job.memberId,'noreon.zoe.member_clear.message_seq':latest.seq}});
   return finish('summary_only','member_cleared_urgent_window',{
    summary:`The member ended Zoe's repeated 103 advice (${clearReason}). Care alerts and safety holds remain for doctor review. See the member message and the recorded clear time.`,
    receipt:{text:MEMBER_CLEAR_TEXT[lang],language:lang,kind:'receipt'},
    memberClear:{startedAt:clearContext.startedAt,readingId:clearContext.readingId,readingVersion:clearContext.readingVersion,reason:clearReason}});
  }
  // A doctor's reply ends the repeat, not a plain refusal of 103 still inside the 120 minutes. Timed from the answers: a doctor's reply empties the stored window.
  if(doctorClosedAlarm&&!job.doctorMode&&!job.urgentWindowUnavailable&&refuses103(latest.text)&&urgentWindowOpen(job.answers,latest.text,newestUrgentAgo,job.messages.filter(m=>m!==latest),clearContext?.throughSeq??job.urgentThroughSeq))
   return urgentRoute('urgent_in_window_no_model_call');
  if(!alarmOpen){const repeat=repeatWindow();if(repeat)return repeat;}
 }

 // The numbers of a blood pressure reading are the one BP check's (bp-chat.ts, below): no same-day floor before a repeat. Doctor mode
 // keeps the floor: the doctor has the conversation and Zoe says only the fixed safety lines. So does a member who asks for the doctor.
 const bpKeepsFloor=job.doctorMode===true||asksForDoctor(latest.text);
 // A statin may be named anywhere on record, not only in the message with the sign (Task 15): the whole window, the LDL record, the member's medicines.
 const statinContext=[...job.messages.map(m=>m.text),...(job.memberRecord?.ldl?.therapies??[]).map(t=>t.name),...(job.topic?.profile?.medicines??[]).map(m=>m.name)];
 const floorOf=(texts:readonly string[],data:Parameters<typeof sameDayFloor>[1],context:readonly string[]|false=statinContext)=>!thirdPartyBp&&sameDayFloor(texts,data,context,{bp:bpKeepsFloor});
 // Codex A2-2: the deterministic same-day minimum (sameDayFloor: the Level 2 lab and symptom floors) is
 // known here, before every exit that would otherwise skip it (doctor mode, a forward request, the member limits, a message with
 // no supported language). When it fires on an exit, the member still gets the fixed same-day line (no model) and the run records
 // the urgency as same-day; zoe_run_finish lets this line through in doctor mode (reason prefix same_day_floor_). Free mode only,
 // the mode in which Zoe answers the member herself.
 const sameDayEarly=freeMode&&floorOf(unansweredBatch.map(m=>m.text),job.health);
 // Urgent checks above scan all language lists over the entire text, independent of reply language.
 // Do this before intake, doctor mode, read-in-full or any model call can consume unreadable letters.
 if(unreadableLanguage)
  return finish('summary_only','language_unreadable_forwarded',languageForward(sameDayEarly?'same_day':'doctor_soon'));
 // The visible fixed warning records the exact saved value. Missing provenance, a changed
 // value or a newer save cannot inherit an earlier warning, including a backdated reading.
 const savedReading=job.health?.bpWeek?.latest,latestReading=job.intake?.latestReading;
 const savedReadingFloor=!!job.health&&floorOf([],{...job.health,labs:[],plan:null});
 const savedReadingLine=savedReading?`${savedReading.systolic}/${savedReading.diastolic} mmHg.`:null;
 const savedAfterMeasurement=clearContext?.readingSavedAt&&clearContext.readingMeasuredAt
  ?(Date.parse(clearContext.readingSavedAt)-Date.parse(clearContext.readingMeasuredAt))/60_000:Infinity;
 const readingAge=(latestReading?.minutesAgo??-1)-Math.max(0,savedAfterMeasurement);
 const savedReadingWarned=savedReadingFloor&&!!savedReading&&!!latestReading
  &&savedReading.systolic===latestReading.systolic&&savedReading.diastolic===latestReading.diastolic
  &&readingAge>=0&&!floorOf(unansweredBatch.map(m=>m.text),null)
  &&job.answers.some(a=>a.minutesAgo<readingAge&&a.minutesAgo<Math.min(Infinity,...job.replies.map(r=>r.minutesAgo))
   &&Object.values(SAME_DAY_LINE).some(line=>a.body.includes(`${line}\n${savedReadingLine}`)));
 // Once per matter (Task 1): the sign was already answered with the same-day advice and no doctor has replied since. The floor stays; its sentence is not said again.
 const unansweredSeqs=new Set(unansweredBatch.map(m=>m.seq));
 const statinWarned=sameDayEarly&&!floorOf(unansweredBatch.map(m=>m.text),job.health,false)
  &&floorOf(job.messages.filter(m=>!unansweredSeqs.has(m.seq)).map(m=>m.text),null,statinContext)
  &&job.answers.some(a=>a.minutesAgo<Math.min(Infinity,...job.replies.map(r=>r.minutesAgo))&&a.minutesAgo<=MEMORY_WARNING_HOURS*60&&hasSameDayWarning(a.body));
 const sameDayExit=(exit:string,extra:Partial<FinishInput>={},forward:Forward='auto',forwardReason:ForwardReason='same_day')=>{
  const lang=safetyLang(job.conversation?.locale),doctorName=job.conversation?.doctorName??job.intake?.doctorName??null;
  events.push({name:'zoe.health_answer.same_day_floor',outcome:'escalate',reason:`same_day_floor_${exit}`,rule:'zoe.health_answer',ruleVersion:HEALTH_ANSWER_VERSION,actor:'system',
   attributes:{'noreon.zoe.guard.name':'same_day_floor','noreon.zoe.same_day.exit':exit.slice(0,60)}});
  const text=withStatinLine(forward==='member_request'||forward==='member_yes'?`${SAME_DAY_LINE[lang]} ${sentLine(lang,doctorName,'same_day')}`:carefulLine(lang,doctorName,'same_day'),lang);
  return finish('summary_only',`same_day_floor_${exit}`.slice(0,80),{...extra,summary:'A fixed same-day rule matched the member\'s message (a reading or result at the same-day level). Zoe sent the fixed same-day line and no model text. See the conversation.',
   receipt:{text,language:lang,kind:'receipt'},health:{urgency:'same_day',modelUrgency:'none',forward,forwardReason}});};

 const bpStoredSince=clearContext?.readingId?readingAge:job.intake?.latestReading?.minutesAgo;
 // The one BP check on this turn (lib/clinical/rules/bp-check.ts), in fixed words and with no model. A symptom took the 103 route above.
 if(freeMode&&!thirdPartyBp&&!bpKeepsFloor&&!alarmOpen&&!hasThirdPartyBpReading(unansweredBatch.map(m=>m.text))){
  const answered=job.conversation?.answeredThroughSeq??-1;
  const bp=bpChatTurn({unanswered:unansweredBatch,earlier:job.messages.filter(m=>m!==latest&&m.seq<=answered),stored:clearContext?.suppressStoredReading?null:job.intake?.latestReading,
   told:job.answers,storedSinceMinutes:bpStoredSince,openAlert:(job.topic?.profile?.openAlerts.length??0)>0});
  if(bp){
   const lang=safetyLang(job.conversation?.locale);
   events.push({name:'zoe.bp_check',outcome:bp.step==='remeasure'?'recorded':'escalate',reason:bp.step,rule:'clinical.bp_one_rule',ruleVersion:BP_CHECK_VERSION,actor:'system',attributes:{'noreon.zoe.bp.source':bp.source}});
   const reading=`${bp.reading.systolic}/${bp.reading.diastolic}`;
   // A typed reading is saved at once, as the member's own: the save leaves the doctor's quiet note or raises the alert, and only
   // then does a reply say the doctor has it (Gohar's QA 267). No port (a practice or eval run) saves nothing and keeps the wording.
   // Every unanswered very high reading goes in order (a first one and its repeat in one batch keep both). The reply may say the
   // doctor has it only when the one it answers was saved AND its note or alert row exists. Not saved (another person, a past
   // day, a failed save): the repeat request and the doctor's summary stand, with no claim.
   let bpSaved=true;
   if(bp.source==='typed'&&deps.ports.saveTypedBp){
    bpSaved=false;
    for(const x of bp.saves??[]){
     const res=await deps.ports.saveTypedBp(job.runId,{seq:x.seq,index:x.index,systolic:x.systolic,diastolic:x.diastolic}).catch(()=>({saved:false,notified:false}));
     if(x.latest)bpSaved=res.saved&&res.notified;
     events.push({name:'zoe.bp_save',outcome:res.saved?'recorded':'failed',reason:!res.saved?'typed_reading_not_saved':res.notified?'typed_reading_saved':'typed_reading_saved_no_note',rule:'clinical.bp_one_rule',ruleVersion:BP_CHECK_VERSION,actor:'system',attributes:{'noreon.zoe.bp.source':'typed'}});
    }
    if(!(bp.saves??[]).length)events.push({name:'zoe.bp_save',outcome:'skipped',reason:'typed_reading_not_own_now',rule:'clinical.bp_one_rule',ruleVersion:BP_CHECK_VERSION,actor:'system',attributes:{'noreon.zoe.bp.source':'typed'}});
   }
   const quietNoteLine=bp.quietNote?`\n\n${bpSaved?passedToDoctorLine(lang,job.conversation?.doctorName??job.intake?.doctorName??null):bpCareTeamLine(lang)}`:'';
   // Another same-day matter in the turn (BP-01) keeps its level and its forward; the repeat step goes with it.
   if(sameDayEarly&&bp.step!=='doctor_today')return finish('summary_only','same_day_floor_bp_and_other',{summary:`A same-day matter with a very high reading of ${reading}. See the conversation.`,
    receipt:{text:withStatinLine(`${SAME_DAY_LINE[lang]} ${autoLine(lang,job.conversation?.doctorName??job.intake?.doctorName??null,'same_day')}${bp.step==='remeasure'?`\n\n${bpRemeasureLine(lang,bp.reading)}`:''}`,lang),language:lang,kind:'receipt'},
    health:{urgency:'same_day',modelUrgency:'none',forward:'auto',forwardReason:'same_day'}});
   if(bp.step==='doctor_today')return finish('summary_only','same_day_floor_bp_repeat',{summary:`A repeat reading of ${reading} is still very high, with no symptoms reported. Zoe told the member this needs a doctor today. See the conversation.`,
    receipt:{text:withStatinLine(bpSaved?bpTodayLine(lang,true):`${bpTodayLine(lang,false)} ${bpCareTeamLine(lang)}`,lang),language:lang,kind:'receipt'},health:{urgency:'same_day',modelUrgency:'none',forward:'auto',forwardReason:'same_day'}});
   if(bp.step==='doctor_48h')return finish('summary_only','bp_repeat_doctor_soon',{summary:`A repeat reading of ${reading} is still in the very high range, with no symptoms reported. Zoe told the member a doctor needs to see them ${BP_SOON.en}. See the conversation.`,
    receipt:{text:bpSaved?bpSoonLine(lang,true):`${bpSoonLine(lang,false)} ${bpCareTeamLine(lang)}`,language:lang,kind:'receipt'},health:{urgency:'doctor_soon',modelUrgency:'none',forward:'auto',forwardReason:'bp_repeat_high'}});
   // A coming-days matter that is not the BP (an unreviewed critical lab, or chest pain said to be past) keeps its floor and forward beside the repeat step (Astra MERGE-01).
   const chestSoon=unansweredBatch.some(m=>chestPastOrStableNotNow(m.text));
   if(chestSoon&&!labSoon)return finish('summary_only','bp_remeasure_chest_soon',{summary:'Chest pain was described as past or stable, and a very high reading is awaiting its repeat. Zoe asked for the repeat and said a doctor should see the chest matter in the coming days. See the conversation.',
    receipt:{text:`${bpRemeasureLine(lang,bp.reading)}\n\n${DOCTOR_SOON_LINE[lang]}${quietNoteLine}`,language:lang,kind:'receipt'},
    health:{urgency:'doctor_soon',modelUrgency:'none',forward:'auto',forwardReason:'coming_days'}});
   if(labSoon)return finish('summary_only','bp_remeasure_lab_soon',{summary:'A coming-days laboratory result is still awaiting review, with a very high reading awaiting its repeat. See the conversation.',
    receipt:{text:`${bpRemeasureLine(lang,bp.reading)}\n\n${autoLine(lang,job.conversation?.doctorName??job.intake?.doctorName??null,'doctor_soon')}`,language:lang,kind:'receipt'},
    health:{urgency:'doctor_soon',modelUrgency:'none',forward:'auto',forwardReason:'critical_lab'}});
   return finish('summary_only','bp_remeasure',{receipt:{text:`${bpRemeasureLine(lang,bp.reading)}${quietNoteLine}`,language:lang,kind:'receipt'},
    ...(bp.quietNote?{summary:`Very high reading of ${reading}, repeat pending. Zoe asked the member to rest and measure again.`,health:{urgency:'doctor_soon',modelUrgency:'none',forward:'auto',forwardReason:'bp_repeat_pending'}}:{})});
  }
 }

 // Zoe asked for a repeat and it has not come: the model and the judge are told, so neither warns again or falls back to the careful line.
 const bpPending=freeMode&&!job.doctorMode&&!clearContext?.suppressStoredReading&&bpAwaitingRepeat(job.messages,job.intake?.latestReading,job.answers,bpStoredSince);
 // The replay: a thanks after the 48-hour line got the model correcting it up to today. The rule's level stands until something new comes.
 const bpGiven=freeMode&&!job.doctorMode&&bpLevelGiven(job.answers);

 // Past the acute window or after "I called 103": the alert is remembered. The event also keeps the stored window from ending at this answer, so a clear still works.
 if(recentAlert&&!alarmOpen&&!doctorClosedAlarm){
  alarmConversation=true;
  events.push({name:'zoe.guard.urgent_window',outcome:'allow',reason:'alarm_monitored_after_safety_checks',rule:'zoe.alarm_conversation',ruleVersion:ALARM_CONVERSATION_VERSION,actor:'system',attributes:{'noreon.zoe.urgent_window.opened_by':clearContext?.openedBy??job.urgentOpenedBy??'unknown'}});
 }
 // Only a lone message that answers no open question of Zoe's: "ok" may be a yes.
 if(recentAlert&&!alarmOpen&&!doctorClosedAlarm&&unansweredBatch.length===1&&!ik?.active&&urgentAcknowledgement(latest.text)&&(!endsWithQuestion(lastZoe??'')||isUrgentAnswer(lastZoe??''))){
  const lang=safetyLang(job.conversation?.locale);
  return finish('summary_only','urgent_alarm_acknowledged',{receipt:{text:URGENT_ACK[lang],language:lang,kind:'receipt'}});
 }
 if(alarmOpen){
  if(crisis())return urgentRoute('urgent_in_window_no_model_call');
  if(urgentMedicineChange(latest.text,mentionsMedicine))return urgentRoute('urgent_in_window_no_model_call');
  const lang=urgentLang(job.conversation?.locale);
  // A closed, clinically settled past episode is not a bare refusal such as "I feel fine".
  const followUp=plainSettledChest(latest.text)?null:urgentFollowUp(latest.text,lang,true,calledBlockers());
  // Refusal is explained and forwarded once per alert, using the answers already saved for this window.
  if(followUp===S100_TEXT[lang]){
   const newestFull=job.answers.findLastIndex(a=>isUrgentAnswer(a.body)&&![...Object.values(S100_TEXT),...Object.values(DRIVE_TEXT)].some(t=>a.body.startsWith(t)));
   const refused=clearContext?.refused103??job.answers.slice(newestFull+1).some(a=>a.minutesAgo<=(windowSince??0)&&Object.values(S100_TEXT).some(t=>a.body.startsWith(t)));
   if(!refused)return urgentRoute('urgent_in_window_no_model_call');
  }else if(followUp||freeMode&&trainingAfterFaint(job.messages.map(m=>m.text),latest.text))return urgentRoute('urgent_in_window_no_model_call');
  alarmConversation=true;
  events.push({name:'zoe.guard.urgent_window',outcome:'allow',reason:'alarm_conversation_after_safety_checks',rule:'zoe.alarm_conversation',ruleVersion:ALARM_CONVERSATION_VERSION,actor:'system',attributes:{'noreon.zoe.urgent_window.opened_by':clearContext?.openedBy??job.urgentOpenedBy??'unknown'}});
  if(followUp===S100_TEXT[lang]||urgentAcknowledgement(latest.text))
   return finish('summary_only','urgent_alarm_acknowledged',{receipt:{text:URGENT_ACK[lang],language:lang,kind:'receipt'}});
  if(takesSomethingNow(latest.text,mentionsMedicine))
   return finish('summary_only','urgent_alarm_take_now',{receipt:{text:URGENT_TAKE_NOW[lang],language:lang,kind:'receipt'}});
  if(disputesSymptomAnswer(latest.text)){
   events.push({name:'zoe.urgent.answer_disputed',outcome:'recorded',reason:'symptom_answer_disputed',rule:'zoe.alarm_conversation',ruleVersion:ALARM_CONVERSATION_VERSION,actor:'system',attributes:{'noreon.zoe.alarm.message_seq':latest.seq}});
   return finish('summary_only','urgent_alarm_answer_disputed',{summary:'The member disputes a recorded symptom answer. The original answer remains unchanged. Review the member message and the alarm trigger record.',
    receipt:{text:DISPUTE_NOTED[lang],language:lang,kind:'receipt'},health:{urgency:'none',modelUrgency:'none',forward:'auto',forwardReason:'symptom_answer_disputed'}});
  }
  if(asksAlarmWhy(latest.text)){
   events.push({name:'zoe.urgent.explanation',outcome:'recorded',reason:clearContext?.trigger?'recorded_trigger_used':'trigger_record_unavailable',rule:'zoe.alarm_conversation',ruleVersion:ALARM_CONVERSATION_VERSION,actor:'system',attributes:{}});
   return finish('summary_only','urgent_alarm_explained',{receipt:{text:alarmExplanation(clearContext?.trigger,clearContext?.openedBy??job.urgentOpenedBy,lang),language:lang,kind:'receipt'}});
  }
 }

 // 1b'. The one question after a model-only 103 window (urgent-check.ts): the red-flag rules above found nothing in the
 // correction or new topic, so Zoe asks about the key red flags once; a "yes" takes the no-model urgent route next turn.
 if(windowExit){
  const lang=urgentLang(job.conversation?.locale);
  return finish('summary_only','urgent_window_model_red_flag_question',{summary:`The member wrote again after Zoe's model-decided 103 advice (${windowExit==='correction'?'a correction':'a new topic'}). No danger sign in the message; Zoe asked about the key red flags once. See the conversation.`,
   receipt:{text:RED_FLAG_QUESTION_TEXT[lang],language:lang,kind:'receipt'}});
 }
 // 1b''. An unclear or misspelt key symptom word (Armen 20 Oct addendum): one clarifying question before any model, after the
 // red-flag rules, never twice in a row. Free mode only (Zoe answers there herself).
 const unclear0=freeMode&&!job.doctorMode&&!ik?.active&&!isClarifyText(job.answers.at(-1)?.body)?unclearSymptom(latest.text):null;
 const unclear=unclear0&&clarifyAlone(latest.text,unclear0.word)?unclear0:null;
 if(unclear){
  const lang=safetyLang(job.conversation?.locale);
  events.push({name:'zoe.guard.unclear_symptom',outcome:'block',reason:'unclear_symptom_word_clarify',rule:'zoe.urgent_check',ruleVersion:URGENT_CHECK_VERSION,actor:'system',
   attributes:{'noreon.zoe.guard.name':'unclear_symptom','noreon.zoe.unclear.meanings':unclear.meanings.join(',')}});
  return finish('summary_only','unclear_symptom_word_clarify',{summary:'The member used an unclear symptom word; Zoe asked one clarifying question before answering. See the conversation.',
   receipt:{text:clarifyText(unclear,lang),language:lang,kind:'receipt'}});
 }
 // BMI is arithmetic, not a risk score. Every urgent, red-flag, BP and alarm check above has had its turn.
 // A symptom or another clinical floor still belongs to the normal health flow; this step only answers the BMI request.
 const bmiText=unansweredBatch.map(m=>m.text).join('\n'),bmiAsk=job.answers.at(-1);
 const bmiFollowUp=!!bmiAsk&&pendingBmi(bmiAsk.body)&&!job.replies.some(r=>r.minutesAgo<=bmiAsk.minutesAgo)&&bmiMeasurementReply(bmiText);
 if(freeMode&&!job.doctorMode&&!ik?.active&&!alarmConversation&&!alarmOpen&&!sameDayEarly&&!labSoon&&!asksForDoctor(latest.text)
  &&(bmiRequest(bmiText)||bmiFollowUp)){
  const lang=safetyLang(job.conversation?.locale);
  const bmiExchange=[bmiText];
  if(bmiFollowUp){
   // Use only the existing claim window. Walk paired member/answer turns back to the request;
   // any other message, answer or doctor reply ends the uninterrupted pending exchange.
   let answerIndex=job.answers.length-1,nextAgo=unansweredBatch[0]!.minutesAgo;
   for(const m of job.messages.filter(m=>m.seq<unansweredBatch[0]!.seq).reverse()){
    const answer=job.answers[answerIndex--];
    if(!answer||!pendingBmi(answer.body)||answer.minutesAgo<nextAgo||answer.minutesAgo>m.minutesAgo
     ||(job.answers[answerIndex]?.minutesAgo??Infinity)<m.minutesAgo
     ||job.replies.some(r=>r.minutesAgo>=nextAgo&&r.minutesAgo<=m.minutesAgo))break;
    const request=bmiRequest(m.text);
    if(!request&&!bmiMeasurementReply(m.text))break;
    bmiExchange.unshift(m.text);
    if(request)break;
    nextAgo=m.minutesAgo;
   }
  }
  events.push({name:'zoe.bmi_request',outcome:'recorded',reason:'bmi_request',rule:'zoe.bmi_request',ruleVersion:BMI_REQUEST_VERSION,actor:'system',attributes:{}});
  // Separate turns so a bare labelled measurement cannot consume the next turn's word as its unit.
  return finish('summary_only','bmi_request',{receipt:{text:bmiReply(lang,bmiNumbers(bmiExchange.join(';\n'),job.memberRecord?.questionnaire)),language:lang,kind:'receipt'},
   health:{urgency:'none',modelUrgency:'none',forward:'none',forwardReason:'none'}});
 }

 // 1b'''. A vague complaint on its own (Roo 3.4, "not feeling well since yesterday"): clarifying questions, the danger sign among them, once, with no model and no hand-off.
 // After the red-flag rules; never over a same-day floor (a sick day on an SGLT2 inhibitor), an open matter or an answer to Zoe's own question. Task 17: the model keeps to three in all.
 if(freeMode&&job.conversation?.enabled&&!job.doctorMode&&!ik?.active&&!sameDayEarly&&!labSoon&&!alarmConversation&&unansweredBatch.length===1&&vagueComplaint(latest.text)&&!mayBeOpen(job)&&!endsWithQuestion(job.answers.at(-1)?.body??'')&&!vagueAtRisk(job.messages.map(m=>m.text),(job.topic?.profile?.medicines??[]).map(m=>m.name))
  &&!floorOf(job.messages.map(m=>m.text),job.health,statinContext)){
  const lang=safetyLang(job.conversation.locale);
  if(!job.answers.some(a=>a.body===VAGUE_QUESTION[lang])){
   events.push({name:'zoe.guard.vague_complaint',outcome:'block',reason:'vague_complaint_clarify',rule:'zoe.urgent_check',ruleVersion:URGENT_CHECK_VERSION,actor:'system',attributes:{'noreon.zoe.guard.name':'vague_complaint'}});
   return finish('summary_only','vague_complaint_clarify',{summary:'The member described a vague complaint; Zoe asked clarifying questions before answering. See the conversation.',
    receipt:{text:VAGUE_QUESTION[lang],language:lang,kind:'receipt'},health:{urgency:'none',modelUrgency:'none',forward:'none',forwardReason:'zoe_question'}});
  }
 }

 // 1c. Doctor mode (Armen 20 Oct; 20261020082321): the doctor has replied in this conversation and continues it until they hand
 // it back to Zoe. The urgent text, the 103 window and the red flags above still answer at once (and raise their care alert);
 // nothing else does: no model call, no receipt, no chat reply, and an active intake pauses. The message waits for the doctor.
 // Per topic (Armen msg 251; lead decision 20 Oct 22:51): with the 'topic' scope a free-mode question may still be Zoe's when
 // it is clearly about something else than the doctor's matter. The check (topic.ts) runs after the reservation, in healthTurn;
 // every path that cannot get there (an intake, a member limit, a fixed chat class, no model) waits for the doctor as before.
 let doctorCheck=false;
 const holdForDoctor=(reason:string,extra:Partial<Pick<FinishInput,'usage'|'costUsd'|'latencyMs'|'redactionCount'|'sealed'>>={})=>{
  events.push({name:'zoe.guard.doctor_mode',outcome:'block',reason,rule:'zoe.doctor_mode',ruleVersion:DOCTOR_MODE_VERSION,actor:'system',
   attributes:{'noreon.zoe.guard.name':'doctor_mode','noreon.zoe.intake.paused':!!activeSheet,'noreon.zoe.doctor_mode.scope':job.doctorScope??'conversation'}});
  // Doctor mode holds Zoe's own words, never the fixed same-day line (Codex A2-2).
  if(sameDayEarly)return sameDayExit('doctor_mode',extra);
  const {usage,costUsd:spent,latencyMs,redactionCount,sealed}=extra;
  return finish('discarded','doctor_mode',{...(usage?{usage}:{}),...(spent!==undefined?{costUsd:spent}:{}),...(latencyMs!==undefined?{latencyMs}:{}),...(redactionCount!==undefined?{redactionCount}:{}),...(sealed!==undefined?{sealed}:{}),receipt:null});};
 // Opening a task is not a clinical reply or a handoff away from the doctor.
 // Only an exact, standalone request with no unresolved safety exchange can take this route.
 const task=chatTask(latest.text);
 // The new chat has no card to open, so there the words go on to Zoe like any other message.
 const taskRequest=!!task&&!chatV2&&job.memberRecord?.chatCards&&job.conversation?.enabled&&!activeSheet&&!alarmConversation
   &&!floorOf(job.messages.map(m=>m.text),job.health,statinContext)&&!hasOpenTaskWarning(job)
   &&job.messages.filter(m=>m.seq>job.conversation!.answeredThroughSeq).length===1;
 if(job.doctorMode&&!taskRequest){
  const lastZoe=job.answers.at(-1)?.body??null;
  // Astra DT-01: the answer-based red flags are deterministic safety too and still escalate here, exactly as in an intake
  // turn: a red-flag answer or a "yes" to the pending red-flag question of an active (or resumed) intake ...
  if(ik&&activeSheet&&ikActive){
   const lang=urgentLang(ikActive.language);
   const record:IntakeRecord=structuredClone(ikActive.record);
   const direct=memberAsks(latest.text)?null:directAnswer(activeSheet,record,latest.text,lastZoe);
   if(direct)record.answers[direct.id]={value:direct.value,seq:latest.seq};
   const yesFlag=yesToRedFlag(activeSheet,record,latest.text,lastZoe);
   const preHits=[...answerRedFlags(activeSheet,record),...(yesFlag?[yesFlag]:[])];
   if(preHits.length){
    record.redFlags=mergeHits(record.redFlags,preHits);
    events.push({name:'zoe.intake.answers',outcome:'escalate',reason:'intake_red_flag_answer_no_model_call',rule:'zoe.symptom_intake',ruleVersion:INTAKE_VERSION,actor:'system',
     attributes:{'noreon.zoe.red_flags.hits':preHits.map(h=>h.id).join(',').slice(0,128),'noreon.zoe.doctor_mode':true}});
    return finish('intake_escalated','intake_red_flag_answer_no_model_call',{answer:escalationText(lang),language:lang,intake:escalation(activeSheet,record,[],lang,ikActive.id,ikActive.startedSeq,ik.latestReading)});
   }
  }
  // ... and in free mode a "yes" to Zoe's own danger-sign question (healthTurn's rule; here also after a doctor reply: red wins).
  if(freeMode&&lastZoe&&!pendingAsk(lastZoe)&&endsWithQuestion(lastZoe)&&replyToAsk(latest.text)==='yes'){
   const lastQ=lastZoe.trim().split(/(?<=[.։!])\s+/u).at(-1)??'';
   const hits=textRedFlags([lastQ],{intakeActive:true,latestReading:null});
   if(hits.length){
    const lang=urgentLang(job.conversation?.locale);
    events.push({name:'zoe.health_answer.red_flag_yes',outcome:'escalate',reason:'yes_to_danger_sign_question',rule:'zoe.health_answer',ruleVersion:HEALTH_ANSWER_VERSION,actor:'system',
     attributes:{'noreon.zoe.red_flags.hits':hits.map(h=>h.id).join(',').slice(0,128),'noreon.zoe.doctor_mode':true}});
    return finish('discarded','urgent_health_answer_red_flag_yes',{summary:`The member answered yes to Zoe's danger-sign question (${hits.map(h=>h.id).join(', ')}). Urgent text sent.`,
     answer:escalationText(lang),language:lang,receipt:null,health:{urgency:'emergency',modelUrgency:'none',forward:'auto',forwardReason:'same_day'}});
   }
  }
  if(!(job.doctorScope==='topic'&&freeMode&&topicScopeOn(deps.env??process.env)&&!throttle&&!activeSheet&&!resumeKind&&job.doctorMatter))return holdForDoctor('doctor_mode_no_model_call');
  doctorCheck=true;
  events.push({name:'zoe.guard.doctor_mode',outcome:'recorded',reason:'doctor_mode_topic_check',rule:'zoe.doctor_mode',ruleVersion:DOCTOR_MODE_VERSION,actor:'system',
   attributes:{'noreon.zoe.guard.name':'doctor_mode','noreon.zoe.doctor_mode.scope':'topic'}});
 }
 // The member limits stop every model call; a same-day reading still gets its fixed line (Codex A2-2).
 if(sameDayEarly&&throttle&&!activeSheet)return sameDayExit(throttle);

 // One symptom-intake turn (always the high tier). Defined here for the run's events and finish.
 const intakeTurn=async(sheet:SymptomSheet,lang:ReplyLanguage,injection:boolean)=>{
  const ik2=job.intake!;
  // Never the same text twice in a row (lead 18 Oct): a re-asked question gets a short lead-in. It goes before the
  // question (the last paragraph), never in front of a fixed line above it (Armen's dataset eval, 19 Oct).
  const prevZoe=job.answers.at(-1)?.body.trim();
  const unrepeated=(t:string)=>{
   if(t.trim()!==prevZoe)return t;
   const cut=t.lastIndexOf('\n\n');
   return cut<0?`${CHECK_LINE[lang]} ${t}`:`${t.slice(0,cut+2)}${CHECK_LINE[lang]} ${t.slice(cut+2)}`;
  };
  const finishTurn=(outcome:RunOutcome,reason:string,extra:Partial<FinishInput>)=>finish(outcome,reason,{...extra,...(extra.answer&&outcome==='intake_asked'?{answer:unrepeated(extra.answer)}:{})});
  void ik2;const active=ikActive&&ikActive.sheetId===sheet.id?ikActive:null;
  const startedSeq=active?.startedSeq??latest.seq;
  const record:IntakeRecord=structuredClone(active?.record??emptyRecord());
  const firstTurn=!active;
  const window=job.messages.filter(m=>m.seq>=startedSeq);
  const base={id:active?.id??null,sheetId:sheet.id,sheetVersion:sheet.version,startedSeq,language:lang};
  // `lead`: a fixed line before the closing text (a medicine question on the last turn gets its explicit no; Astra #354 R1).
  const ending=(e:IntakeEnding,state:'completed'|'stopped',reason:string,extra:Partial<FinishInput>={},lead?:string)=>{
   const summary=buildSummary(sheet,record,{ending:e,language:lang,latestReading:ik2.latestReading});
   return finish('intake_completed',reason,{...extra,summary:runSummaryLine(summary),answer:`${lead?`${lead}\n\n`:''}${closingText(lang,ik2.doctorName)}`,language:lang,intake:{...base,state,record,summary,answerSource:'fixed',alertRedFlags:null}});
  };
  // While active, the summary the doctor gets if the member stops replying (the claim expires it after 12 hours).
  const provisional=()=>buildSummary(sheet,record,{ending:'expired',language:lang,latestReading:ik2.latestReading});
  // A rest phrase in a breath or fatigue intake: the at-rest red-flag question goes next on every path (restRedFlagQuestion, #306).
  const restQ=restRedFlagQuestion(sheet,record,latest.text);
  // The one fallback (Zoe redesign PR2, lead decision 18 Oct 20:58): the neutral line, which asks nothing, so a
  // pending question is never repeated; nothing is marked as asked, so a bare "yes" or "no" next is not read as
  // an answer to it. A second fallback in a row ends the intake as partially answered for the doctor. The one
  // exception is #306's at-rest red-flag question after a rest phrase: it is asked, as on every other path.
  let turnCounted=false;
  const neutralTurn=(reason:string,extra:Partial<FinishInput>={})=>{
   // The turn cap holds on every path, the fallback included (Fable F5).
   if(intakeComplete(sheet,record))return ending(record.turns>=MAX_INTAKE_TURNS?'turn_limit':'complete','completed','intake_complete',extra);
   if(restQ&&!record.answers[restQ.id]){
    noteAsked(record,[restQ.id]);if(!turnCounted)record.turns++;
    return finishTurn('intake_asked',reason,{...extra,answer:firstTurn?`${openerText(lang)}\n\n${restQ.ask[lang]}`:restQ.ask[lang],language:lang,intake:{...base,state:'active',record,summary:provisional(),answerSource:'sheet',alertRedFlags:null}});
   }
   if(!firstTurn&&wasNeutral(job.answers.at(-1)?.body))return ending('partial','completed',`${reason}_partial`,extra);
   if(!turnCounted)record.turns++;
   record.lastAsked=[];
   return finish('intake_asked',reason,{...extra,answer:firstTurn?`${openerText(lang)}\n\n${NEUTRAL_LINE[lang]}`:NEUTRAL_LINE[lang],language:lang,intake:{...base,state:'active',record,summary:provisional(),answerSource:'fixed',alertRedFlags:null}});
  };
  events.push({name:'zoe.intake.turn',outcome:'recorded',reason:firstTurn?'intake_started':'intake_continued',rule:'zoe.symptom_intake',ruleVersion:INTAKE_VERSION,actor:'system',
   attributes:{'noreon.zoe.intake.sheet':sheet.id,'noreon.zoe.intake.sheet_version':sheet.version,'noreon.zoe.intake.sheet_status':sheet.status,'noreon.zoe.intake.turn':record.turns+1,'noreon.zoe.intake.answered':Object.keys(record.answers).length}});
  // The member stops: deterministic, no model call.
  if(!firstTurn&&memberStops(latest.text))return ending('member_stopped','stopped','intake_member_stopped');
  // A plain "yes", "no" or number to the last question is recorded in code, and a "yes" to a red-flag
  // question escalates before any model (Fable F1, F3). The model cannot change these answers.
  const lastZoe=job.answers.at(-1)?.body??null;
  // A question or request instead of an answer (memberAsks) is never recorded as one.
  const asks=!firstTurn&&memberAsks(latest.text);
  const direct=firstTurn||asks?null:directAnswer(sheet,record,latest.text,lastZoe);
  if(direct)record.answers[direct.id]={value:direct.value,seq:latest.seq};
  const yesFlag=firstTurn?null:yesToRedFlag(sheet,record,latest.text,lastZoe);
  const preHits=[...answerRedFlags(sheet,record),...(yesFlag?[yesFlag]:[])];
  if(preHits.length){
   record.redFlags=mergeHits(record.redFlags,preHits);
   events.push({name:'zoe.intake.answers',outcome:'escalate',reason:'intake_red_flag_answer_no_model_call',rule:'zoe.symptom_intake',ruleVersion:INTAKE_VERSION,actor:'system',
    attributes:{'noreon.zoe.red_flags.hits':preHits.map(h=>h.id).join(',').slice(0,128)}});
   const urgentL=urgentLang(lang);
   return finish('intake_escalated','intake_red_flag_answer_no_model_call',{answer:escalationText(urgentL),language:urgentL,intake:escalation(sheet,record,[],urgentL,active?.id??null,startedSeq,ik2.latestReading)});
  }
  // The member asked something: noted for the doctor, the fixed reply, then the pending question again. No model.
  if(asks){
   record.memberAsked=[...(record.memberAsked??[]),{text:latest.text.trim().slice(0,300),seq:latest.seq}].slice(-5);
   record.turns++;
   if(record.turns>=MAX_INTAKE_TURNS)return ending('turn_limit','completed','intake_complete',{},mentionsMedicine(latest.text)?ASKED_MEDICINE_TEXT[lang]:undefined);
   const q=askedReply(sheet,record,lang,lastZoe,restQ,latest.text);
   noteAsked(record,q.asked,false);
   events.push({name:'zoe.intake.member_asked',outcome:'recorded',reason:'member_question_noted',rule:'zoe.symptom_intake',ruleVersion:INTAKE_VERSION,actor:'system',attributes:{'noreon.zoe.intake.member_asked':record.memberAsked.length}});
   return finishTurn('intake_asked','intake_member_question_noted',{answer:q.text,language:lang,intake:{...base,state:'active',record,summary:provisional(),answerSource:'fixed',alertRedFlags:null}});
  }
  // A greeting or thanks mid-intake ("Hey", "Hello"): a short warm line and the pending question, no model,
  // and no miss counted (Khikar's live transcript 18 Oct).
  const social=!firstTurn&&!direct?chatIntent(latest.text,{names:nameTokens(job.displayName)}):null;
  if(social&&['greeting','thanks','how_are_you','farewell'].includes(social.primary)){
   record.turns++;
   if(record.turns>=MAX_INTAKE_TURNS)return ending('turn_limit','completed','intake_complete');
   const q=greetingReply(sheet,record,lang,lastZoe,restQ);noteAsked(record,q.asked,false);
   return finish('intake_asked','intake_greeting_pending_question',{answer:q.text,language:lang,intake:{...base,state:'active',record,summary:provisional(),answerSource:'fixed',alertRedFlags:null}});
  }
  // Instructions in the text: the model is not called; the sheet asks its own next question.
  if(injection)return neutralTurn('intake_injection_neutral_line');
  // Always the strongest tier, with its fallback, caps and the database's call permission.
  route.tier='high';route.tierReason='symptom_intake';
  const tierCfg=deps.routing?.config.tiers.high;
  events.push({name:'zoe.route.tier',outcome:'recorded',reason:'symptom_intake_high_tier',rule:'zoe.routing',ruleVersion:ROUTING_VERSION,actor:'system',attributes:{'noreon.zoe.tier':'high','noreon.zoe.tier_base':'high',
   ...(tierCfg?{'noreon.zoe.route.model':tierCfg.model.id,'noreon.zoe.route.fallback':tierCfg.fallback?.id??'none','noreon.zoe.route.config_version':tierCfg.version}:{})}});
  let fallback:ZoeProvider|null=null;
  if(deps.routing){
   if(!tierCfg)return neutralTurn('intake_tier_not_configured_neutral_line');
   provider=deps.routing.providerFor(tierCfg.model);
   fallback=tierCfg.fallback?deps.routing.providerFor(tierCfg.fallback):null;
  }
  const own=knownNames(job);
  const redacted=modelJob.messages.map(m=>({seq:m.seq,text:redactText(m.text,{nameTokens:own}).text,minutesAgo:m.minutesAgo}));
  const memberBlock=`${block(redacted,modelJob.replies.map(r=>({...r,body:redactText(r.body,{nameTokens:own}).text})),modelJob.answers.map(a=>({...a,body:redactText(a.body,{nameTokens:own}).text})))}\n${intakeDataBlock(sheet,record,lang)}`;
  if(!provider)return neutralTurn('intake_provider_unavailable_neutral_line');
  if(throttle)return neutralTurn(`intake_${throttle}_neutral_line`);
  const callTokens={inputTokens:approxTokens(INTAKE_SYSTEM_PROMPT)+approxTokens(memberBlock),outputTokens:MAX_OUTPUT_TOKENS};
  // The longest intake text a member can see: the opener plus the reply schema's maximum.
  // One retry of an unusable turn (PR2) and a judge call for each of the two texts.
  const b=budget(provider,fallback,callTokens,1,Math.max(...(['en','hy','ru']as const).map(l=>openerText(l).length))+2+1200,2);
  const reserved=await deps.ports.reserve(job.runId,b.estimate,b.local,takeEvents(),{tier:'high',model:provider.requestModel,judgeModel:b.judgeModel});
  if(!reserved.ok)return neutralTurn(`intake_${reserved.code}_neutral_line`);
  let result:ProviderResult|null=null,latencyMs=0,spentUsd=0;const usage={inputTokens:0,outputTokens:0};
  const call=async(p:ZoeProvider,attempt:number,isFallback:boolean)=>{
   const started=now();let r:ProviderResult;
   whyPrompt=INTAKE_VERSION;
   try{r=await p.complete({timeoutMs:callTimeout(),purpose:'symptom_intake',promptVersion:INTAKE_VERSION,system:INTAKE_SYSTEM_PROMPT,memberBlock,replyLanguage:lang,maxOutputTokens:MAX_OUTPUT_TOKENS});}
   catch{r={kind:'error',errorClass:'unavailable',usage:null};}
   const ms=Math.round(now()-started);latencyMs+=ms;
   const u=r.usage??{inputTokens:0,outputTokens:0};usage.inputTokens+=u.inputTokens;usage.outputTokens+=u.outputTokens;
   const cost=costUsd(p.pricing,r.usage??callTokens);spentUsd+=cost;
   events.push({name:'zoe.provider.call',outcome:r.kind==='ok'?'allow':r.kind==='refusal'?'block':'failed',reason:r.kind==='ok'?'completed':r.kind==='refusal'?'provider_refusal':`provider_${r.errorClass}`,
    rule:'zoe.provider',ruleVersion:INTAKE_VERSION,actor:'ai',attributes:{'gen_ai.operation.name':'chat','gen_ai.provider.name':p.providerName,'gen_ai.request.model':p.requestModel,'gen_ai.request.max_tokens':MAX_OUTPUT_TOKENS,
     ...(r.kind!=='error'?{'gen_ai.response.model':r.responseModel,'gen_ai.response.id':r.responseId,'gen_ai.response.finish_reasons':r.finishReason}:{'error.type':r.errorClass}),
     'gen_ai.usage.input_tokens':u.inputTokens,'gen_ai.usage.output_tokens':u.outputTokens,'noreon.zoe.purpose':'symptom_intake','noreon.zoe.attempt':attempt,'noreon.zoe.latency_ms':ms,'noreon.zoe.cost_usd':cost,
     'noreon.zoe.region':p.region,'noreon.zoe.tier':'high','noreon.zoe.fallback_used':isFallback,'noreon.zoe.config_version':ZOE_CONFIG_VERSION.slice(0,128)}});
   return r;
  };
  for(let attempt=1;attempt<=PROVIDER_ATTEMPTS;attempt++){if(late('provider_attempt'))break;result=await call(provider,attempt,false);if(result.kind!=='error'||result.errorClass==='rate_limited')break;}
  if(fallback&&result?.kind==='error'&&!late('provider_fallback')){provider=fallback;route.fallbackUsed=true;result=await call(fallback,PROVIDER_ATTEMPTS+1,true);}
  // Totals at the moment of each return, so a later retry's cost is never dropped (Codex RJ-3).
  const common=()=>({usage,costUsd:spentUsd,latencyMs});
  if(!result||result.kind!=='ok')return neutralTurn(result?.kind==='refusal'?'intake_provider_refusal_neutral_line':`intake_provider_${result?.errorClass??'unavailable'}_neutral_line`,{...common(),sealed:seal({memberBlock,response:null})});
  const parseIntake=(raw:string)=>{let j:unknown;try{j=JSON.parse(raw);}catch{j=undefined;}const v=intakeOutputSchema.safeParse(j);
   events.push({name:'zoe.guard.output_schema',outcome:v.success?'allow':'block',reason:v.success?'schema_valid':'schema_invalid',rule:'zoe.intake_output_schema',ruleVersion:INTAKE_VERSION,actor:'system',attributes:{'noreon.zoe.guard.name':'output_schema'}});
   return v.success?v.data:null;};
  // One retry on the same model when its turn cannot be used (invalid output, a structural block or the reply
  // check), then the neutral line (Fable PR2; DECISION "retries once, then falls back to one neutral line").
  let retried=false;
  const retry=async()=>{if(retried||late('intake_retry'))return null;retried=true;const again=await call(provider!,PROVIDER_ATTEMPTS+2,route.fallbackUsed);return again.kind==='ok'?again:null;};
  let parsedOut=parseIntake(result.raw);
  if(!parsedOut){const again=await retry();if(again){result=again;parsedOut=parseIntake(again.raw);}}
  let sealed=seal({memberBlock,response:redactText(result.raw,{nameTokens:own}).text});
  if(!parsedOut)return neutralTurn('intake_schema_invalid_neutral_line',{...common(),sealed,guardReasons:['schema_invalid']});
  const out=parsedOut;
  // Answers: only the sheet's questions, allowed values, the member's own words. A later answer wins.
  // After the neutral line nothing was asked: a bare reply in the newest message is not read as any answer (Codex PR2 F1).
  const afterNeutral=wasNeutral(lastZoe);
  const proposed=afterNeutral?out.answers.filter(a=>!(bareReply(a.quote)&&bareReply(latest.text))):out.answers;
  const {accepted,rejected,suspected}=acceptAnswers(sheet,proposed,window,{lastAsked:record.lastAsked??[],latestSeq:latest.seq,startedSeq});
  // The code-read reply wins for its question, except that a grounded red-flag "yes" is never overridden by a
  // bare "no" in the same message ("No, that was before. Now I struggle to get air."; Codex F1, 18 Oct): red wins.
  const redYes=(id:string,a:{value:unknown})=>a.value==='yes'&&!!sheet.questions.find(q=>q.id===id)?.redFlagIfYes;
  for(const [id,a] of Object.entries(accepted))if((id!==direct?.id||redYes(id,a))&&(!record.answers[id]||record.answers[id]!.seq<=a.seq||redYes(id,a)))record.answers[id]=a;
  record.turns++;turnCounted=true;
  // Red flags after the model: a red-flag answer "yes", or the model's suspicion. It can add, never clear.
  // The model's suspicion alone (QA S03: "my heart is beating fast" escalated on turn 1) first asks the sheet's
  // own red-flag question; a "yes" to it escalates in code. With no red-flag question left, it escalates.
  // A rest phrase in a breath or fatigue intake asks the at-rest question the same way, whatever the model read.
  const restOpen=restQ&&!record.answers[restQ.id]?restQ:null;
  const suspectOnly=(out.red_flag_suspected||suspected.length>0||!!restOpen)&&answerRedFlags(sheet,record).length===0;
  const rfAll=suspectOnly?openRedFlagQuestions(sheet,record):[];
  // The question the model thought was a "yes" goes first; the at-rest question when a rest phrase asked for it.
  const first=restOpen&&!out.red_flag_suspected&&!suspected.length?[restOpen.id]:suspected;
  const rfOpen=[...rfAll.filter(q=>first.includes(q.id)),...rfAll.filter(q=>!first.includes(q.id))];
  if(rfOpen.length){
   const q=rfOpen[0]!;noteAsked(record,[q.id]);
   const byRest=!!restOpen&&!out.red_flag_suspected&&!suspected.length;
   events.push({name:'zoe.intake.answers',outcome:'recorded',reason:byRest?'rest_phrase_red_flag_question_asked':'model_suspected_red_flag_question_asked',rule:'zoe.symptom_intake',ruleVersion:INTAKE_VERSION,actor:'system',attributes:{'noreon.zoe.intake.red_flag_question':q.id}});
   return finishTurn('intake_asked',byRest?'intake_rest_phrase_red_flag_question':'intake_model_suspected_red_flag_question',{...common(),sealed,guardReasons:rejected.map(r=>`answer.${r}`).slice(0,20),answer:firstTurn?`${openerText(lang)}\n\n${q.ask[lang]}`:q.ask[lang],language:lang,
    intake:{...base,state:'active',record,summary:provisional(),answerSource:'sheet',alertRedFlags:null}});
  }
  // With no red-flag question left to ask, the model's suspicion (or its unasked "yes") escalates.
  const after:RedFlagHit[]=[...answerRedFlags(sheet,record),...(out.red_flag_suspected||suspected.length?[{id:'model_suspected',rf:null,source:'model'as const}]:[])];
  events.push({name:'zoe.intake.answers',outcome:after.length?'escalate':'recorded',reason:after.length?'intake_red_flag_after_model':'answers_recorded',rule:'zoe.symptom_intake',ruleVersion:INTAKE_VERSION,actor:'system',
   attributes:{'noreon.zoe.intake.accepted':Object.keys(accepted).length,'noreon.zoe.intake.rejected':rejected.length,'noreon.zoe.intake.rejected_reasons':rejected.join(',').slice(0,128)||'none',
    'noreon.zoe.red_flags.hits':after.map(h=>h.id).join(',').slice(0,128)||'none','noreon.zoe.intake.member_stopped':out.member_stopped,'noreon.zoe.intake.about_someone_else':out.about_someone_else}});
  const guardReasons=rejected.map(r=>`answer.${r}`).slice(0,20);
  if(after.length){
   record.redFlags=mergeHits(record.redFlags,after);
   const urgentL=urgentLang(lang);
   return finish('intake_escalated','intake_red_flag_after_model',{...common(),sealed,guardReasons,answer:escalationText(urgentL),language:urgentL,intake:escalation(sheet,record,[],urgentL,active?.id??null,startedSeq,ik2.latestReading)});
  }
  // The model never ends an intake (lead cross-check 18 Oct): stopping is memberStops in code (above), and
  // "someone else's symptom" ends it only when the deterministic third-party rule agrees on the newest message.
  if(out.about_someone_else&&classifyScope(latest.text).thirdPartyPossible)return ending('about_someone_else','stopped','intake_about_someone_else',{...common(),sealed,guardReasons});
  if(intakeComplete(sheet,record))return ending(record.turns>=MAX_INTAKE_TURNS?'turn_limit':'complete','completed','intake_complete',{...common(),sealed,guardReasons});
  // The member-visible text: structure first (checkReply), then the reply check. Its answers and red flags
  // above came from the first usable output; a retry only rewrites the question.
  let judgeUsage={inputTokens:0,outputTokens:0},judgeCost=0,judgeMs=0;const blockedBy:string[]=[];
  const vet=async(o:typeof out)=>{
   const reply=checkReply(sheet,o,record,{memberTexts:job.messages.map(m=>m.text),replyLanguage:lang});
   events.push({name:'zoe.guard.output_intake',outcome:reply.ok?'allow':'block',reason:reply.ok?'no_category_matched':'blocked_category_matched',rule:'zoe.output_guard',ruleVersion:OUTPUT_GUARD_VERSION,actor:'system',
    attributes:{'noreon.zoe.guard.name':'output_intake','noreon.zoe.guard.field':'intake','noreon.zoe.guard.categories':reply.ok?'none':reply.reasons.join(',').slice(0,128)}});
   if(!reply.ok){blockedBy.push(...reply.reasons);return null;}
   const full=firstTurn?`${openerText(lang)}\n\n${reply.text}`:reply.text;
   const rc=await replyCheck(provider!,reply.text,full,lang,job.messages.map(m=>m.text),'intake');
   judgeUsage={inputTokens:judgeUsage.inputTokens+rc.usage.inputTokens,outputTokens:judgeUsage.outputTokens+rc.usage.outputTokens};judgeCost+=rc.costUsd;judgeMs+=rc.latencyMs;
   if(!rc.ok){blockedBy.push(...rc.reasons);return null;}
   return {asked:reply.asked,full};
  };
  let ok=await vet(out);
  // The sealed record keeps the retry's output when the retry is the text that went out (Fable PR2 F3).
  if(!ok){const again=await retry();const o2=again?parseIntake(again.raw):null;if(o2){ok=await vet(o2);if(ok&&again)sealed=seal({memberBlock,response:redactText(again.raw,{nameTokens:own}).text});}}
  const checked=()=>({usage:{inputTokens:usage.inputTokens+judgeUsage.inputTokens,outputTokens:usage.outputTokens+judgeUsage.outputTokens},costUsd:spentUsd+judgeCost,latencyMs:latencyMs+judgeMs});
  if(!ok)return neutralTurn(blockedBy.some(r=>r.startsWith('judge.')||r.startsWith('pattern.'))?'intake_reply_check_blocked_neutral_line':'intake_reply_blocked_neutral_line',{...checked(),sealed,guardReasons:[...new Set([...guardReasons,...blockedBy])].slice(0,20)});
  noteAsked(record,ok.asked);
  return finishTurn('intake_asked','intake_reply_passed_guards',{...checked(),sealed,guardReasons,answer:ok.full,language:lang,
   intake:{...base,state:'active',record,summary:provisional(),answerSource:'model',alertRedFlags:null}});
 };

 // One conversational reply (the low tier). Fixed wording whenever the model cannot be used or its text fails a guard.
 const chatTurn=async(intent:ChatIntent,lang:ReplyLanguage,injection:boolean,fixedOnly=false)=>{
  const name=firstName(job.displayName);
  const done=(source:'model'|'fixed',text:string,reason:string,extra:Partial<FinishInput>={})=>finish('chatted',reason,{...extra,answer:text,language:lang,
   summary:`Zoe replied herself to a conversational message (${intent.classes.join(', ').replaceAll('_',' ')}).`,chat:{kind:intent.primary,source}});
  // Never the same text twice in a row (QA 18 Oct X03): the short "I'm here" line instead of a repeat.
  const lastZoe=job.answers.at(-1)?.body.trim();
  const fixed=(reason:string,extra:Partial<FinishInput>={})=>{const t=fillName(chatFallback(intent.primary,lang,chatV2),name);
   const again=AGAIN[intent.primary]?.[lang];
   return done('fixed',t===lastZoe?fillName(again??REPEAT_TEXT[lang],name):t,t===lastZoe?`${reason}_rephrased`:reason,extra);};
  // The stand-in's text never reaches a member: without a real model (the sweep's caller rule) the fixed wording goes.
  if(injection)return done('fixed',deflectionText(lang,name),'chat_injection_fixed_wording');
  if(throttle==='member_spend_cap_reached')return memberSpendCap(lang);
  if(throttle)return fixed(`chat_${throttle}_fixed_wording`);
  if(fixedOnly||FIXED_ONLY.has(intent.primary))return fixed('chat_fixed_wording_class');
  if(deps.directAnswers!==true)return fixed('chat_stand_in_fixed_wording');
  route.tier='low';route.tierReason='conversational';
  const tierCfg=deps.routing?.config.tiers.low;
  events.push({name:'zoe.route.tier',outcome:'recorded',reason:'conversational_low_tier',rule:'zoe.routing',ruleVersion:ROUTING_VERSION,actor:'system',attributes:{'noreon.zoe.tier':'low','noreon.zoe.tier_base':'low',
   ...(tierCfg?{'noreon.zoe.route.model':tierCfg.model.id,'noreon.zoe.route.fallback':tierCfg.fallback?.id??'none','noreon.zoe.route.config_version':tierCfg.version}:{})}});
  let fallback:ZoeProvider|null=null;
  if(deps.routing){
   if(!tierCfg)return fixed('chat_tier_not_configured_fixed_wording');
   provider=deps.routing.providerFor(tierCfg.model);
   fallback=tierCfg.fallback?deps.routing.providerFor(tierCfg.fallback):null;
  }
  if(!provider)return fixed('chat_provider_unavailable_fixed_wording');
  // The member's and the doctor's names are both redacted (Codex review F4).
  const own=knownNames(job);
  // Only what the reply needs (guard layer 2): the unanswered messages and Zoe's last two texts; no doctor
  // replies, no names, no records.
  const open=job.messages.filter(m=>m.seq>(job.conversation?.answeredThroughSeq??0));
  const memberBlock=`${block(open.map(m=>({seq:m.seq,text:redactText(m.text,{nameTokens:own}).text,minutesAgo:m.minutesAgo})),
   [],job.answers.slice(-2).map(a=>({...a,body:redactText(a.body,{nameTokens:own}).text})))}\n<chat_kind>${intent.classes.join(',')}</chat_kind>`;
  const system=chatSystemPrompt(lang,chatV2);
  const callTokens={inputTokens:approxTokens(system)+approxTokens(memberBlock),outputTokens:400};
  // The chat schema's maximum reply plus room for the member's name.
  const b=budget(provider,fallback,callTokens,1,2000+80);
  const reserved=await deps.ports.reserve(job.runId,b.estimate,b.local,takeEvents(),{tier:'low',model:provider.requestModel,judgeModel:b.judgeModel});
  if(!reserved.ok)return reserved.code==='member_spend_cap_reached'?memberSpendCap(lang):fixed(`chat_${reserved.code}_fixed_wording`);
  let result:ProviderResult|null=null,latencyMs=0,spentUsd=0;const usage={inputTokens:0,outputTokens:0};
  const call=async(p:ZoeProvider,attempt:number,isFallback:boolean)=>{
   const started=now();let r:ProviderResult;
   whyPrompt=CONVERSATION_VERSION;
   try{r=await p.complete({timeoutMs:callTimeout(),purpose:'conversation',promptVersion:CONVERSATION_VERSION,system,memberBlock,replyLanguage:lang,maxOutputTokens:400});}
   catch{r={kind:'error',errorClass:'unavailable',usage:null};}
   const ms=Math.round(now()-started);latencyMs+=ms;
   const u=r.usage??{inputTokens:0,outputTokens:0};usage.inputTokens+=u.inputTokens;usage.outputTokens+=u.outputTokens;
   const cost=costUsd(p.pricing,r.usage??callTokens);spentUsd+=cost;
   events.push({name:'zoe.provider.call',outcome:r.kind==='ok'?'allow':r.kind==='refusal'?'block':'failed',reason:r.kind==='ok'?'completed':r.kind==='refusal'?'provider_refusal':`provider_${r.errorClass}`,
    rule:'zoe.provider',ruleVersion:CONVERSATION_VERSION,actor:'ai',attributes:{'gen_ai.operation.name':'chat','gen_ai.provider.name':p.providerName,'gen_ai.request.model':p.requestModel,'gen_ai.request.max_tokens':400,
     ...(r.kind!=='error'?{'gen_ai.response.model':r.responseModel,'gen_ai.response.id':r.responseId,'gen_ai.response.finish_reasons':r.finishReason}:{'error.type':r.errorClass}),
     'gen_ai.usage.input_tokens':u.inputTokens,'gen_ai.usage.output_tokens':u.outputTokens,'noreon.zoe.purpose':'conversation','noreon.zoe.attempt':attempt,'noreon.zoe.latency_ms':ms,'noreon.zoe.cost_usd':cost,
     'noreon.zoe.region':p.region,'noreon.zoe.tier':'low','noreon.zoe.fallback_used':isFallback,'noreon.zoe.config_version':ZOE_CONFIG_VERSION.slice(0,128)}});
   return r;
  };
  for(let attempt=1;attempt<=PROVIDER_ATTEMPTS;attempt++){if(late('provider_attempt'))break;result=await call(provider,attempt,false);if(result.kind!=='error'||result.errorClass==='rate_limited')break;}
  if(fallback&&result?.kind==='error'&&!late('provider_fallback')){provider=fallback;route.fallbackUsed=true;result=await call(fallback,PROVIDER_ATTEMPTS+1,true);}
  // Totals at the moment of each return, so a later retry's cost is never dropped (Codex RJ-3).
  const common=()=>({usage,costUsd:spentUsd,latencyMs});
  if(!result||result.kind!=='ok')return fixed(result?.kind==='refusal'?'chat_provider_refusal_fixed_wording':`chat_provider_${result?.errorClass??'unavailable'}_fixed_wording`,{...common(),sealed:seal({memberBlock,response:null})});
  const parseChat=(raw:string)=>{let j:unknown;try{j=JSON.parse(raw);}catch{j=undefined;}return chatOutputSchema.safeParse(j);};
  // One retry on the same model when the output is not the schema (QA 18 Oct: chat_schema_invalid fell back too often).
  if(!parseChat(result.raw).success&&!late('schema_retry')){const again=await call(provider,PROVIDER_ATTEMPTS+2,route.fallbackUsed);if(again.kind==='ok')result=again;}
  const sealed=seal({memberBlock,response:redactText(result.raw,{nameTokens:own}).text});
  const parsed=parseChat(result.raw);
  events.push({name:'zoe.guard.output_schema',outcome:parsed.success?'allow':'block',reason:parsed.success?'schema_valid':'schema_invalid',rule:'zoe.chat_output_schema',ruleVersion:CONVERSATION_VERSION,actor:'system',attributes:{'noreon.zoe.guard.name':'output_schema'}});
  if(!parsed.success)return fixed('chat_schema_invalid_fixed_wording',{...common(),sealed,guardReasons:['schema_invalid']});
  // The voice guide is applied, not enforced by refusal: "!" becomes ".", dashes become commas, emoji go.
  const reply=voiceClean(parsed.data.reply);
  const reasons:string[]=[];
  if(parsed.data.language!==lang)reasons.push('chat.wrong_language');
  if(parsed.data.category==='other'||!intent.classes.includes(parsed.data.category))reasons.push('chat.category_mismatch');
  if(fillName(reply,name).trim()===lastZoe)reasons.push('chat.repeats_last_reply');
  // Only the [NAME] placeholder, at most once; any other bracketed text could be a forged placeholder.
  if((reply.match(/\[NAME\]/g)??[]).length>1||/\[(?!NAME\])[^\]]*\]/u.test(reply))reasons.push('chat.placeholder');
  const verdict=guardField('chat',reply.replaceAll('[NAME]',' '),{memberTexts:job.messages.map(m=>m.text),replyLanguage:lang,sheetWording:chatExemptPhrases(lang,chatV2)});
  events.push(guardEvent(verdict));
  // Structure only (PR2): whether the words are safe is the reply check's job, just below.
  if(verdict.outcome==='block')reasons.push(...verdict.blocking.map(c=>`chat.${c}`));
  if(reasons.length)return fixed('chat_reply_blocked_fixed_wording',{...common(),sealed,guardReasons:[...new Set(reasons)]});
  const rc=await replyCheck(provider,reply,fillName(reply,name),lang,open.map(m=>m.text),'chat');
  usage.inputTokens+=rc.usage.inputTokens;usage.outputTokens+=rc.usage.outputTokens;
  const checked={usage,costUsd:spentUsd+rc.costUsd,latencyMs:latencyMs+rc.latencyMs};
  if(!rc.ok)return fixed('chat_reply_check_blocked_fixed_wording',{...checked,sealed,guardReasons:rc.reasons});
  return done('model',fillName(reply,name),'chat_reply_passed_guards',{...checked,sealed});
 };

 // Decisions: the redacted window, sent once, and only after the database says this run's text may go to that provider (ports.authorizeClassifier: consent now,
 // the provider's own data agreement or staging mode, daily and member caps; nothing recorded). Never on a run with too many identifiers to send. The three
 // effects ask at the routing site, after the fixed emergency exits; the shadow line asks after the reservation if no effect has.
 const startDecisions=()=>{
  if(decisionsP||!dflags.any)return decisionsP;
  const env=deps.env??process.env;
  if(deps.directAnswers!==true||realCallsBasis(env)===null||!job.conversation?.enabled||!deps.ports.authorizeClassifier)return null;
  const own=knownNames(job),red=job.messages.map(m=>redactText(m.text,{nameTokens:own}));
  if(red.some(r=>r.count>MAX_REDACTIONS_PER_MESSAGE))return null;
  const authorize=deps.ports.authorizeClassifier;
  decisionsP=(async():Promise<DecisionsResult>=>{
   const t0=Date.now();
   const a=await Promise.race([authorize(job.runId).catch(()=>null),new Promise<null>(r=>setTimeout(()=>r(null),DECISIONS_TIMEOUT_MS))]);
   if(!a?.ok)return {ok:false,reason:'not_authorized',latencyMs:Date.now()-t0};
   return askDecisions(red.map(r=>r.text),env);
  })().then(r=>{decisionsRes=r;return r;});
  return decisionsP;
 };
 const decisionsAnswer=async()=>{const p=dflags.effects?startDecisions():null;const r=p?await p:null;return r&&r.ok?r.verdict:null;};

 // 2. Scope classifier, language, injection and the read-in-full rule.
 // Armenian in Latin letters from a member whose app language is Armenian is Armenian (QA 18 Oct S08, L05).
 const routingScope=(text:string)=>{const sc=classifyScope(text,{previous:previousLang,locale:job.conversation?.locale});
  return job.conversation?.enabled&&job.conversation.locale==='hy'&&sc.language==='en'&&latinArmenian(text)?{...sc,language:'hy-Latn'as const,replyLanguage:'hy'as const}:sc;};
 const ruleScope=routingScope(latest.text);
 const detectedScope=ruleScope;
 const scope=detectedScope.replyLanguage?{...detectedScope,replyLanguage:conversationLang(detectedScope.replyLanguage)}:detectedScope;
 const scopeOutcome=scope.readInFull||scope.scope!=='in'||!scope.replyLanguage?'block':scope.injection?'recorded':'allow';
 events.push({name:'zoe.guard.scope',outcome:scopeOutcome,reason:scope.readInFull?`read_in_full_${scope.readInFull}`:scope.scope==='abuse'?'abusive_staff_flag':scope.scope==='out'?`off_scope_${scope.offScopeTopic}`:!scope.replyLanguage?`language_${scope.language.toLowerCase()}_not_supported`:scope.injection?'injection_suspected_summary_only':'in_scope',
  rule:'zoe.scope_classifier',ruleVersion:SCOPE_VERSION,actor:'system',attributes:{'noreon.zoe.guard.name':'scope','noreon.zoe.language':scope.language,'noreon.zoe.scope':scope.scope,'noreon.zoe.injection_suspected':scope.injection,'noreon.zoe.third_party_possible':scope.thirdPartyPossible}});
 // An active symptom intake gets the first look after the red flags (quality review C-2): an answer such as
 // "when the weather changes" or "how much does it cost" is not discarded as off-scope, and a long or
 // pasted message is handled with the sheet's own wording (no model).
 const unansweredInjection=job.messages.filter(m=>m!==latest&&m.seq>(job.conversation?.answeredThroughSeq??0)).some(m=>classifyScope(m.text).injection);
 injectionSeen=scope.injection||unansweredInjection;
 if(injectionSeen)events.push({name:'zoe.guard.injection',outcome:'block',reason:job.conversation?.enabled?'injection_deflected':'injection_summary_only',rule:'zoe.scope_classifier',ruleVersion:SCOPE_VERSION,actor:'system',
  attributes:{'noreon.zoe.guard.name':'injection','noreon.zoe.injection.latest':scope.injection,'noreon.zoe.member.injections_24h':job.conversation?.injectionsLast24h??0}});
 // Abuse is a flag for staff, not a drop (Zoe redesign PR2, lead decision 18 Oct 20:58): the message takes its
 // ordinary path, so it is answered and the doctor sees it, and every finish carries the staff flag, an active
 // intake's included (Codex PR2 F3).
 if(scope.scope==='abuse')abuseSeen=true;
 if(ik&&activeSheet&&!alarmConversation)return intakeTurn(activeSheet,scope.replyLanguage??ikActive!.language,injectionSeen||!!scope.readInFull);
 // Away too long to go on: Zoe says so warmly and asks the sheet's first question again (fixed wording, no model).
 if(ik&&resumeKind==='restart'&&rsSheet&&!injectionSeen&&!scope.readInFull){
  const lang=scope.replyLanguage??rs!.language;const record=emptyRecord();const q=sheetQuestionsText(rsSheet,record,lang);noteAsked(record,q.asked,false);record.turns=1;
  return finish('intake_asked','expired_intake_restarted',{answer:`${RESTART_LINE[lang]} ${q.text}`,language:lang,
   intake:{id:null,sheetId:rsSheet.id,sheetVersion:rsSheet.version,startedSeq:latest.seq,language:lang,state:'active',record,
    summary:buildSummary(rsSheet,record,{ending:'expired',language:lang,latestReading:ik.latestReading}),answerSource:'sheet',alertRedFlags:null}});
 }
 receiptLanguage=scope.replyLanguage;
 // Astra #384 R6: a pasted panel with a same-day value (potassium 6.3) keeps the fixed same-day line; the panel still never reaches a model.
 if(scope.readInFull)return sameDayEarly&&!activeSheet?sameDayExit(`read_in_full_${scope.readInFull}`):finish('discarded',`read_in_full_${scope.readInFull}`);
 // Doctor mode: only a model-written free answer can be Zoe's, and only after the check.
 if(doctorCheck&&(injectionSeen||!scope.replyLanguage))return holdForDoctor('doctor_mode_no_model_call');
 // A reading alone ("190/120") has no language, but a same-day reading is never dropped (Codex A2-2).
 if(sameDayEarly&&!scope.replyLanguage&&!activeSheet)return sameDayExit('language_not_supported');
 // An open intake takes answers with no letters ("6", "150/90", an emoji) in its own language (Fable F3).
 // "?", "👍", "...": small talk in the member's app language, fixed wording (QA 18 Oct X04, Z01).
 if(!scope.replyLanguage&&!activeSheet&&job.conversation?.enabled&&noLetters(latest.text)){
  const cls=/[?？]/u.test(latest.text)?'greeting':'farewell';
  return chatTurn({classes:[cls],primary:cls},job.conversation.locale??'hy',false,true);
 }
 // A reading with no words ("128/82") has no language of its own, but it is a message to Zoe: she answers in the language of the
 // member's last words here, else their app language (conversation suite, en-numbers-only). Unreadable letters take the fixed receipt and forward above.
 const numbersLanguage=freeMode&&!scope.replyLanguage&&!activeSheet&&/\p{N}/u.test(latest.text)&&!/\p{L}/u.test(latest.text)
  ?previousLang??[...job.messages].reverse().map(m=>routingScope(m.text).replyLanguage).find(l=>!!l)??job.conversation?.locale??'hy':null;
 receiptLanguage??=numbersLanguage;
 if(!scope.replyLanguage&&!activeSheet&&!numbersLanguage)return finish('discarded','language_not_supported');
 // Off-topic messages (prices, weather) are no longer dropped (PR2): they take the ordinary path, the model
 // answers within its rules or drafts for the doctor, behind the reply check. The topic stays in the trace.
 let replyLanguage=scope.replyLanguage??numbersLanguage??ik!.active!.language;

 // 2a. Symptom intake: an active intake continues; a symptom in the newest message starts one
 // (deterministic; never for someone else's symptom). Otherwise the ordinary path below.
 if(ik){
  // Distress ("I'm tired of all this") is not the fatigue sheet: Zoe checks in first (QA 18 Oct E02).
  const distress=!!job.conversation?.enabled&&chatIntent(latest.text,{names:nameTokens(job.displayName)})?.primary==='distress';
  // No fresh intake right after an escalation (QA round 2 S03: the opener restarted at turn 3); the doctor has the summary.
  // Free mode starts no new intake (dataset Rule 4: no questions before an urgent message; the model asks what it needs);
  // an active intake goes on, and the symptom red flags above run either way.
  const sheet=activeSheet??(distress||freeMode||ik.redFlagsAfterSeq>0?null:startingSheet(latest.text,{thirdParty:scope.thirdPartyPossible,registered:ik.registered}));
  if(sheet)return intakeTurn(sheet,replyLanguage,injectionSeen);
 }

 // 2a'. Conversational replies (greetings, thanks, a feeling; conversation.ts): when the switch is on, the newest
 // message is conversational and every other unanswered message is conversational or positively empty ("test",
 // only punctuation or emoji). A new message supersedes the pending doctor draft and this run re-drafts the whole
 // window, so anything else earlier in the window, known or not ("I have a rash", "warfarin"), keeps the doctor
 // path (Codex review ZG-1). Decided in code, before any model.
 const conv=job.conversation?.enabled?job.conversation:null;
 // Positively empty: a test line, or no letters at all. Never a guess from a rule list (an unknown word may be a
 // symptom or a medicine the rules do not know).
 const emptyLine=(t:string)=>noLetters(t)||/^\s*(?:test(?:ing)?(?: message)?|ping|тест|թեստ)[\s.!?]*$/iu.test(t);
 const names=[...nameTokens(job.displayName),...nameTokens(conv?.doctorName)];
 const open=conv?job.messages.filter(m=>m.seq>conv.answeredThroughSeq):[];
 const intents=open.map(m=>chatIntent(m.text,{names}));
 const latestChat=conv&&open.at(-1)?.seq===latest.seq?intents.at(-1)??null:null;
 // Free mode keeps two fixed classes (FIXED_ONLY): the honest "I am an AI, not a person or doctor" and the distress check-in.
 // Closed-vocabulary small talk uses the short low-tier path too, except while a clinical
 // question or safety hand-off remains open. `all` still protects unanswered complaints.
 const freeChat=freeMode&&throttle!=='member_throttled_injection'&&!injectionSeen&&(sameDayEarly||labSoon||mayBeOpen(job)||sameDayFloor(job.messages.map(m=>m.text),job.health)||doctorCheck||job.answers.some(a=>SAFETY_CARRY.test(a.body))
  ||endsWithQuestion(job.answers.at(-1)?.body??''));
 if(doctorCheck&&conv&&!!latestChat&&FIXED_ONLY.has(latestChat.primary))return holdForDoctor('doctor_mode_no_model_call');
 if(conv&&scope.replyLanguage&&(!freeChat||!!latestChat&&FIXED_ONLY.has(latestChat.primary))){
  const all=!!latestChat&&open.every((m,i)=>!!intents[i]||emptyLine(m.text));
  events.push({name:'zoe.route.conversational',outcome:all?'allow':'skipped',reason:all?'conversational_only':open.length?'not_conversational':'nothing_unanswered',rule:'zoe.conversation',ruleVersion:CONVERSATION_VERSION,actor:'system',
   attributes:{'noreon.zoe.guard.name':'conversational','noreon.zoe.chat.classes':all?[...new Set(intents.flatMap(i=>i?.classes??[]))].join(','):'none','noreon.zoe.chat.unanswered':open.length}});
  // A short Latin-letter greeting ("hey", "hi", "privet") says little about the language: Zoe answers in the
  // member's app language (lead 18 Oct). Longer or non-Latin messages keep the language they were written in.
  const shortLatin=/^[\p{Script=Latin}\p{N}\p{P}\s]+$/u.test(latest.text)&&latest.text.trim().split(/\s+/u).length<=3;
  if(all)return chatTurn(latestChat!,shortLatin&&conv.locale&&!previousLang?conv.locale:scope.replyLanguage,injectionSeen);
 }

 // Exact task messages use the same vocabulary as the suggestion row and card intent.
 // All urgent/intake/scope guards above still win. Exact phrases contain no identifiers.
 // This path needs neither model configuration nor a model reservation.
 if(taskRequest&&!doctorCheck&&!injectionSeen)
  return finish('chatted','task_request_no_model',{tier:'none',tierReason:'task_request_no_model',redactionCount:0,
   answer:TASK_REPLY[replyLanguage],language:replyLanguage,summary:'The member requested a task card.',chat:{kind:'capabilities',source:'fixed'}});

 // 2b. Risk tier, from fixed rules and the scope classifier only; the answering model never routes
 // itself. Unsure goes one tier up. The window counts unless a new topic is established below. When the newest message is only small talk,
 // the scope signals (language, injection, third party) come from the newest message with content: "hey" in Latin
 // letters must not lift a logistics question a tier (lead 18 Oct). A real health question keeps its own signals.
 const contentMessage=latestChat?open.filter((m,i)=>!intents[i]&&!emptyLine(m.text)).at(-1):undefined;
 const routeScope=contentMessage?routingScope(contentMessage.text):scope;
 // An answered symptom must not price an independent app or general-health question for 12 hours.
 // Keep the whole window for an open assessment, a safety hand-off, a reference back or a short
 // follow-up. Unknown content still routes up. The pre-model safety checks keep the whole window.
 const previousTurns=timeline(job).filter(t=>!(t.who==='member'&&t.seq===latest.seq));
 const currentTopic=topicRules(latest,previousTurns,{breakAfterSeq:job.topic?.breakAfterSeq??null,
  prevMemberSeq:[...previousTurns].reverse().find(t=>t.who==='member')?.seq??null});
 const independentRules=freeMode&&topicScopeOn(deps.env??process.env)&&!sameDayEarly&&!!conv&&conv.answeredThroughSeq>0&&open.at(-1)?.seq===latest.seq&&isQuestion(latest.text)
  &&'decided' in currentTopic&&currentTopic.decided.topic==='new'
  &&!floorOf(job.messages.map(m=>m.text),null)
  &&textRedFlags(job.messages.map(m=>m.text),{intakeActive:false,latestReading:null}).length===0
  &&!previousTurns.some(t=>t.who!=='member'&&SAFETY_CARRY.test(t.text))
  &&!endsWithQuestion(previousTurns.at(-1)?.text??'');
 const independentQuestion=independentRules;
 const rulesTopic:'new'|'same'|'undecided'='decided' in currentTopic?(currentTopic.decided.topic==='new'?'new':'same'):'undecided';
 let decision=routeTier((independentQuestion?open:job.messages).map(m=>m.text),routeScope,deps.routing?.classifier);
 // Small talk stays cheap unless a same-day matter or a saved-reading floor requires the strong health route.
 if(freeMode&&latestChat&&open.length===1&&latestChat.classes.every(c=>SMALL_TALK.has(c))
  &&(sameDayEarly||labSoon||sameDayFloor([],job.health)||mayBeOpen(job))&&decision.tier!=='high')
  decision={...decision,tier:'high',reason:'small_talk_open_matter'};
 // What today's code decided, for the Decisions trace line, before any switchable effect on the tier.
 decisionsCurrent={tier:decision.tier,base:decision.base,language:ruleScope.language,replyLanguage:ruleScope.replyLanguage,topic:rulesTopic==='new'?'new':rulesTopic==='same'?'same':'undecided'};
 route.tier=decision.tier;route.tierReason=decision.reason;
 const tierCfg=deps.routing?.config.tiers[decision.tier];
 events.push({name:'zoe.route.tier',outcome:'recorded',reason:decision.reason,rule:'zoe.routing',ruleVersion:ROUTING_VERSION,actor:'system',attributes:{
  'noreon.zoe.tier':decision.tier,'noreon.zoe.tier_base':decision.base,'noreon.zoe.tier_rules':decision.rules.join(',').slice(0,128)||'none','noreon.zoe.tier_unsure':decision.unsure.join(',').slice(0,128)||'none',
  ...(decision.classifier?{'noreon.zoe.classifier.tier':decision.classifier.tier??'none','noreon.zoe.classifier.confidence':decision.classifier.confidence}:{}),
  ...(tierCfg?{'noreon.zoe.route.model':tierCfg.model.id,'noreon.zoe.route.fallback':tierCfg.fallback?.id??'none','noreon.zoe.route.config_version':tierCfg.version}:{})}});
 let fallback:ZoeProvider|null=null;
 if(deps.routing){
  if(!tierCfg)return finish('no_output','tier_not_configured');
  provider=deps.routing.providerFor(tierCfg.model);
  fallback=tierCfg.fallback?deps.routing.providerFor(tierCfg.fallback):null;
 }
 // Decisions effects (switches language, topic, route), applied as late as possible: only when the run is about to use a model, after every fixed exit (a doctor
 // request, a "yes", a medicine answer, a same-day or emergency line), so those never send text to Decisions and never wait for it. One verdict feeds all three,
 // and each can only make Zoe more careful or fix English into Armenian in Latin letters. Returns the new language and providers when something changed.
 let lateDone=false;
 const lateDecisions=async():Promise<{lang:typeof replyLanguage;provider:ZoeProvider|null;fallback:ZoeProvider|null}|null>=>{
  if(lateDone||!dflags.effects)return null;
  lateDone=true;
  const dv=await decisionsAnswer();
  if(!dv)return null;
  let next=decision,lang=replyLanguage;
  const raise=(t:TierDecision,reason:string)=>{if(tierRank(t.tier)>tierRank(next.tier))next={...t,reason};};
  // Topic: a rule-made "new question" is vetoed by a confident "same matter": the whole window counts, so the tier cannot be lower than the window's.
  if(dflags.topic&&independentRules&&'decided' in currentTopic&&currentTopic.decided.source==='rules'&&topicKeepsWindow('new',dv)){
   decisionsTopicVeto=true;decisionsEffects.push('topic_kept_window');
   raise(routeTier(job.messages.map(m=>m.text),routeScope,deps.routing?.classifier),'decisions_topic_kept_window');
  }
  // Language: English becomes Armenian in Latin letters, only for a member with Armenian in the chat and only on a confident answer; the unsure-language tier-up
  // that today's detection gives hy-Latn applies.
  if(dflags.language&&scope.language==='en'&&replyLanguage==='en'&&languageToLatinArmenian('en',dv)
   &&(job.conversation?.locale==='hy'||previousLang==='hy'||job.messages.some(m=>m!==latest&&classifyScope(m.text).replyLanguage==='hy'))){
   const rl=conversationLang('hy');
   if(rl==='hy'){
    lang=rl;replyLanguage=rl;decisionsEffects.push('language_hy_latn');
    raise(routeTier((decisionsTopicVeto||!independentQuestion?job.messages:open).map(m=>m.text),{...routeScope,language:'hy-Latn' as const},deps.routing?.classifier),'decisions_language_unsure');
   }
  }
  // Route: raise only.
  if(dflags.route){
   const up=raiseRoute(next.tier,dv);
   if(up.raised){next={...next,tier:up.tier,reason:'decisions_route_raise'};decisionsEffects.push('route_raised');}
  }
  if(next.tier!==decision.tier){
   const cfg=deps.routing?.config.tiers[next.tier];
   const raisedProvider=cfg?deps.routing?.providerFor(cfg.model)??null:null;
   // A tier that is not configured or whose provider is unavailable is not applied: the run goes on with today's tier and provider (never worse for a classifier's answer).
   if(deps.routing&&(!cfg||!raisedProvider)){decisionsEffects.push('raise_not_applied_no_provider');return {lang,provider,fallback};}
   decision=next;route.tier=decision.tier;route.tierReason=decision.reason;
   if(deps.routing&&cfg){provider=raisedProvider;fallback=cfg.fallback?deps.routing.providerFor(cfg.fallback):null;}
   events.push({name:'zoe.route.tier',outcome:'recorded',reason:decision.reason,rule:'zoe.routing',ruleVersion:ROUTING_VERSION,actor:'system',attributes:{
    'noreon.zoe.tier':decision.tier,'noreon.zoe.tier_base':decision.base,'noreon.zoe.tier_rules':decision.rules.join(',').slice(0,128)||'none','noreon.zoe.tier_unsure':decision.unsure.join(',').slice(0,128)||'none',
    ...(cfg?{'noreon.zoe.route.model':cfg.model.id,'noreon.zoe.route.fallback':cfg.fallback?.id??'none','noreon.zoe.route.config_version':cfg.version}:{})}});
  }
  return {lang,provider,fallback};
 };

 // 3. Redaction (pseudonymised, not identifier-free; §4.2).
 // Member and doctor names on every route, as in free mode (Astra ZH-06).
 const own=knownNames(job);
 const redacted=modelJob.messages.map(m=>({...m,r:redactText(m.text,{nameTokens:own})}));
 const replies=modelJob.replies.map(r=>({...r,body:redactText(r.body,{nameTokens:own}).text}));
 const answers=modelJob.answers.map(a=>({...a,body:redactText(a.body,{nameTokens:own}).text}));
 const count=redacted.reduce((n,m)=>n+m.r.count,0);
 const worst=Math.max(...redacted.map(m=>m.r.count));
 const cats=[...new Set(redacted.flatMap(m=>m.r.categories))].sort();
 events.push({name:'zoe.guard.redaction',outcome:worst>MAX_REDACTIONS_PER_MESSAGE?'block':count?'redact':'allow',reason:worst>MAX_REDACTIONS_PER_MESSAGE?'too_many_identifiers_read_in_full':count?'identifiers_redacted':'nothing_to_redact',
  rule:'zoe.redaction',ruleVersion:REDACTION_VERSION,actor:'system',attributes:{'noreon.zoe.guard.name':'redaction','noreon.zoe.redaction.count':count,'noreon.zoe.redaction.categories':cats.join(',')||'none'}});
 if(worst>MAX_REDACTIONS_PER_MESSAGE)return sameDayEarly&&!activeSheet?sameDayExit('too_many_identifiers_read_in_full',{redactionCount:count}):finish('discarded','too_many_identifiers_read_in_full',{redactionCount:count});
 const memberBlock=block(redacted.map(m=>({seq:m.seq,text:m.r.text,minutesAgo:m.minutesAgo})),replies,answers);
 // Decisions shadow line: the call starts after the reservation for a real model call succeeded (consent, database permission and spend cap all passed), unless a
 // switchable effect already started it earlier (see startDecisions). Never on the deterministic urgent exits, which return earlier. Only the redacted window is sent.
 const shadowDecisions=(local:boolean)=>{
  if(local||!dflags.any)return;
  startDecisions();
 };

 // One free-mode turn (health-answer.ts). Never a cold receipt: on any problem the warm fixed line, and the doctor gets it.
 const healthTurn=async(p:ZoeProvider|null,fb:ZoeProvider|null)=>{
  let lang=replyLanguage;
  const doctorName=job.conversation?.doctorName??job.intake?.doctorName??null;
  // Consent and medicine actions always read the original last line. Context cleanup must not expose an earlier consent question.
  const lastAnswer=job.answers.at(-1)??null,lastZoe=lastAnswer?.body??null;
  const contextLastZoe=modelJob.answers.at(-1)?.body??null;
  const unanswered=job.messages.filter(m=>m.seq>(job.conversation?.answeredThroughSeq??0));
  // Zoe's question is still the open one only when it is her newest text, no doctor reply came after it, and the newest
  // member message is the only one since (Astra ZH-05).
  // Ordered by message seq, not rounded minutes (Astra round 2): the newest member message must be the only one after the
  // last answered seq; a doctor reply in the same minute or later closes the question too (conservative).
  const askOpen=!!lastAnswer&&pendingAsk(lastZoe)&&!job.replies.some(r=>r.minutesAgo<=lastAnswer.minutesAgo)&&unanswered.length===1&&unanswered[0]===latest;
  const health=(urgency:Urgency,modelUrgency:Urgency,forward:Forward,forwardReason:ForwardReason)=>({urgency,modelUrgency,forward,forwardReason});
  const fixedLine=(text:string)=>({text,language:lang,kind:'receipt'as const});
  // Armen's fixed answers this message calls for (health-answer.ts): a floor on the sent reply, the first thing on the held path, a note to the model.
  const memberTexts=job.messages.map(m=>m.text);
  const guidanceContext={earlier:memberTexts.filter(t=>t!==latest.text),said:job.answers.map(a=>a.body),medicines:(job.topic?.profile?.medicines??[]).map(m=>m.name),
   bp:job.topic?.profile?.bpDiagnosed==='treated'||job.topic?.profile?.bpDiagnosed==='untreated',mentionsMedicine};
  const guidanceAll=guidanceFound(latest.text,guidanceContext),guidance=guidanceTopics(latest.text,guidanceContext),yellow=!thirdPartyBp&&guidanceAll.includes('pregnancy_ace');
  // A side effect on a statin at doctor_soon is the doctor's call: no "do not stop" and no "do not change" from the app, on the sent or the held path.
  const statinSideEffect=(u:Urgency)=>guidanceAll.includes('stop_statin')&&floorSkips('stop_statin',u,latest.text);
  // Armen's answer 7: praise for a member-entered result needs a published plan and a goal on record.
  const planAndGoal=!!job.health?.plan&&!!job.memberRecord?.ldl?.goal;
  const guidanceNote=`${guidance.length?`\n<known_guidance>${esc(guidance.map(g=>GUIDANCE_LINES[g][lang]).join(' '))}</known_guidance>`:''}${planAndGoal?'\n<plan_and_goal_on_record/>':''}`;
  // The member asks for the doctor, or says yes to Zoe's question: sent, confirmed, no model (lead 20:12).
  const ask=askOpen?replyToAsk(latest.text):null;
  if(!thirdPartyBp&&(asksForDoctor(latest.text)||ask==='yes')){
   const why:Forward=ask==='yes'?'member_yes':'member_request';
   events.push({name:'zoe.health_answer.forward',outcome:'allow',reason:`forward_${why}`,rule:'zoe.health_answer',ruleVersion:HEALTH_ANSWER_VERSION,actor:'system',attributes:{'noreon.zoe.health_answer.forward':why}});
   // A forward request with a same-day reading in it keeps the same-day line and urgency (Codex A2-2).
   if(sameDayEarly)return sameDayExit(`forward_${why}`,{redactionCount:count},why,why);
   // A same-day matter Zoe already answered keeps its 103 line and gets no reply-time promise.
   const doctorAgo=Math.min(Infinity,...job.replies.map(r=>r.minutesAgo));
   const toldToday=job.answers.some(a=>a.minutesAgo<doctorAgo&&Object.values(SAME_DAY_LINE).some(x=>a.body.includes(x)));
   return finish('summary_only',`health_forward_${why}`,{redactionCount:count,summary:`The member asked for the doctor${why==='member_yes'?' (yes to Zoe\'s question)':''}. See the conversation.`,
    receipt:fixedLine(sentLine(lang,doctorName,toldToday?'same_day':'none')),health:health('none','none',why,why)});
  }
  // "I called 103, can I drink coffee?": the fixed answer (urgent-followup.ts), through the urgent route so the care team is told; never the generic careful line.
  if(!thirdPartyBp&&calledAndAsksToEatOrDrink(latest.text,calledBlockers()))return urgentRoute('urgent_in_window_no_model_call');
  const declined=ask==='no';
  // The answer to Zoe's own question about a medicine (chat-record.ts): no model. Every urgent, red-flag and same-day check came first; a floor goes to the model.
  const medicineAsk=!!lastAnswer&&unanswered.length===1&&unanswered[0]===latest&&!job.replies.some(r=>r.minutesAgo<=lastAnswer.minutesAgo)&&!sameDayEarly?pendingMedicines(lastZoe):null;
  if(medicineAsk&&(replyToAsk(latest.text)==='yes'||saysAdd(latest.text))){
   const r=await (deps.ports.addMedicines?.(job.runId,medicineAsk)??Promise.resolve({status:'unavailable'})).catch(()=>({status:'unavailable'}));
   const added=r.status==='added',list=medicineAsk.map(m=>`${m.name}, ${m.dose??'dose not given'}`).join('; ');
   events.push({name:'zoe.record.medicine',outcome:added?'recorded':'failed',reason:`medicine_${r.status}`.slice(0,64),rule:'zoe.chat_record',ruleVersion:CHAT_RECORD_VERSION,actor:'system',attributes:{'noreon.zoe.record.medicines':medicineAsk.length}});
   return finish('summary_only',added?'member_medicine_added':'member_medicine_not_saved',{redactionCount:count,summary:redactContacts(`The member says they take: ${list}. ${added?'Added to their own list as their statement, for you to check. No dose was changed or suggested.':'It could not be saved to their list; see the conversation.'}`).slice(0,3900),
    receipt:fixedLine((added?MEDICINE_ADDED:MEDICINE_NOT_SAVED)[lang]),health:health('none','none','auto','member_statement')});
  }
  if(medicineAsk&&replyToAsk(latest.text)==='no')return finish('chatted','member_medicine_declined',{tier:'none',tierReason:'member_medicine_declined',redactionCount:count,answer:MEDICINE_NOT_ADDED[lang],language:lang,summary:'The member chose not to add the medicine to their list.',chat:{kind:'capabilities',source:'fixed'}});
  // A yes to Zoe's own danger-sign question (her newest text ends with a question about a red-flag symptom) is a red-flag
  // answer, never consent: the no-model urgent route (Fable F2; the intake's redFlagIfYes rule, in free mode).
  if(lastAnswer&&!askOpen&&endsWithQuestion(lastZoe??'')&&replyToAsk(latest.text)==='yes'){
   const lastQ=(lastZoe??'').trim().split(/(?<=[.։!])\s+/u).at(-1)??'';
   const hits=textRedFlags([lastQ],{intakeActive:true,latestReading:null});
   if(hits.length){
    events.push({name:'zoe.health_answer.red_flag_yes',outcome:'escalate',reason:'yes_to_danger_sign_question',rule:'zoe.health_answer',ruleVersion:HEALTH_ANSWER_VERSION,actor:'system',
     attributes:{'noreon.zoe.red_flags.hits':hits.map(h=>h.id).join(',').slice(0,128)}});
    return finish('discarded','urgent_health_answer_red_flag_yes',{redactionCount:count,summary:`The member answered yes to Zoe's danger-sign question (${hits.map(h=>h.id).join(', ')}). Urgent text sent.`,
     answer:escalationText(urgentLang(lang)),language:urgentLang(lang),receipt:null,health:health('emergency','none','auto','same_day')});
   }
  }
  // Hard floors, known before any call so every fallback keeps them (Astra ZH-03): BP of 180/120 or more and triglycerides
  // of 10 or more are at least same-day (dataset S005, S020). Other symptoms may be self-care when the dataset says so
  // (S036, lead 20:58): the model chooses, the judge checks the urgency against the picture.
  // Topic scope's rules (topic.ts), here so the floors and the careful line can read them before the topic step.
  const turns=timeline(modelJob).filter(t=>!(t.who==='member'&&t.seq===latest.seq));
  const tp=job.topic;
  const startSeq=tp?.breakAfterSeq!=null||tp?.startSeq!=null?Math.max(tp.startSeq??0,tp.breakAfterSeq!=null?tp.breakAfterSeq+1:0):null;
  const rules=topicRules(latest,turns,{breakAfterSeq:tp?.breakAfterSeq??null,prevMemberSeq:[...turns].reverse().find(t=>t.who==='member')?.seq??null});
  // Whether the newest message continues the matter (Astra ZCT-01): the topic step's decision once made (a safety carry
  // keeps the turns for context, it does not make a new question same-day); before it, only the rules' own "same".
  let topicNow:TopicKind|null=null;
  const continues=()=>topicNow!==null?topicNow!=='new':'decided' in rules&&rules.decided.topic==='same';
  // Past/recurring chest symptoms absent now have a coming-days floor (Armen, 2 Nov), like the same-day floor on the unanswered
  // messages. A later message keeps it only as that matter's next step (the topic's decision, or its heart results), so an
  // unrelated question is answered as usual and is not held for the doctor (Fable F1).
  const chestNow=unanswered.some(m=>chestPastOrStableNotNow(m.text)),chestEarlier=job.messages.some(m=>chestPastOrStableNotNow(m.text));
  const chestMatter=()=>chestNow||chestEarlier&&(continues()||unanswered.some(m=>chestResults(m.text)));
  const sameDayNow=floorOf(unanswered.map(m=>m.text),job.health,statinContext);
  const floorNow=():Urgency=>thirdPartyBp?'same_day':sameDayNow?'same_day':chestMatter()||labSoon?'doctor_soon':'none';
  // The fixed coming-days sentence is shown once; later messages of the matter keep the level without repeating it.
  const chestSaid=()=>floorNow()==='doctor_soon'&&chestMatter()&&job.answers.some(a=>Object.values(DOCTOR_SOON_LINE).some(x=>a.body.includes(x)));
  // The careful line cannot read the conversation, so it keeps "today" when any message in the window met a floor
  // (Armen-100 x5 S056#5); the model's own minimum stays on the unanswered messages, so a corrected reading is not
  // forced to same-day (Astra FW-02).
  const sameDayWindow=floorOf(job.messages.map(m=>m.text),job.health,statinContext);
  const carefulFloor=():Urgency=>sameDayWindow?'same_day':floorNow();
  // The health run's own budget (HEALTH_RUN_BUDGET_MS), unless a test set one.
  if(!deps.timeBudget){timeBudget.budgetMs=HEALTH_RUN_BUDGET_MS;timeBudget.cutoffMs=HEALTH_RUN_BUDGET_MS-JUDGE_TIMEOUT_MS-MIN_CALL_MS;callMaxMs=HEALTH_CALL_TIMEOUT_MAX_MS;}
  // The member's data; the doctor's plan text is redacted like the messages (no names reach a model).
  const cleanData=(t:string)=>redactText(t,{nameTokens:[...own,...nameTokens(doctorName)].filter(x=>!/^(dr|doctor)$/iu.test(x))}).text;
  // Explicit personal measurements only, after the urgent, red-flag, BP and alarm routes. Never fill a missing number from the record.
  const messageMeasurements=bmiMessageNumbers(latest.text,job.messages.filter(m=>m.seq<latest.seq).map(m=>m.text));
  const messageBmi=messageMeasurements?.height!=null&&messageMeasurements.weight!=null?bmi({
   'q2.height':{fieldId:'q2.height',value:messageMeasurements.height,source:'manual',answeredAt:''},
   'q2.weight':{fieldId:'q2.weight',value:messageMeasurements.weight,source:'manual',answeredAt:''},
  })?.toFixed(1):null;
  const computedLine=messageBmi?`<computed_from_message>BMI ${messageBmi} from height ${messageMeasurements!.height} cm and weight ${messageMeasurements!.weight} kg (computed by the app)</computed_from_message>`:'';
  // The introduction is decided from the whole window: a new topic takes her earlier answers out of the block, not out of the chat.
  const tail=()=>`${thirdPartyBp?'\n<third_party_reading>This reading belongs to someone else. Answer for that person only. No symptoms were reported. Advise their doctor today and conditional 103 for danger signs. Do not instruct the member about their own medicines or repeat their earlier alert. Do not forward this reading to the member\'s doctor. The member\'s record is not this person\'s record. Set urgency no higher than same_day.</third_party_reading>':''}${alarmConversation?'\n<open_alarm>The earlier urgent concern still has an open warning. Answer the newest question on its own evidence. The full warning was already given. Do not add a reminder. Do not invent a new reason or repeat the emergency instructions unless new urgent information appears. Set urgency from the newest messages alone: an ordinary question about something else (food, a medicine, how to do something) is never "emergency", and it is answered fully now, never put off until later. If the newest message says the earlier message was a mistake, that earlier message is not evidence of a current emergency.</open_alarm>':''}${savedReadingWarned||statinWarned?'\n<same_day_warning_given/>':savedReadingFloor?'\n<saved_reading_warning_due>The app adds the same-day sentence and the saved reading to your reply. Do not duplicate them.</saved_reading_warning_due>':''}${bpPending?'\n<bp_repeat_pending>Zoe has asked the member to rest and measure again, and the app handles the new numbers. Do not repeat that step or its warning signs. A very high reading waiting for its repeat is not by itself same_day: set the urgency from anything else in the message. Answer the newest message briefly.</bp_repeat_pending>':''}${bpGiven?'\n<bp_level_given>The app has told the member how soon to see a doctor for this reading and has sent it to the doctor. That level stands: do not change, correct or repeat it, and do not set a higher urgency for the reading. Answer the newest message briefly.</bp_level_given>':''}${clearNote}${job.answers.length?'':'\n<introduction_due/>'}${declined?'\n<member_declined_forward/>':''}${floorNow()!=='none'?`\n<minimum_urgency>${floorNow()}</minimum_urgency>`:''}`;
  // A summary the member asks for sees every turn and the questionnaire, whatever the topic step says (chat-record.ts). Its data never reaches the judge otherwise.
  const summaryAsk=asksForSummary(latest.text)&&carefulFloor()==='none',summaryData=summaryAsk?questionnaireBlock(job.memberRecord?.questionnaire):'';
  // Monika 558: asked to keep it from the doctor, Zoe says the truth and it goes to the doctor all the same.
  const withhold=asksToWithhold(latest.text);
  const summaryTail=summaryAsk?`\n${summaryData?`${summaryData}\n`:''}${SUMMARY_NOTE}`:'';
  // The whole window, as before topic scope: the reservation's estimate (an upper bound), and the model's input when scope is off.
  const recordTarget=zoeLdlTargetOn(deps.env??process.env),recordBlock=memberRecordBlock(job.memberRecord,{target:recordTarget,clean:cleanData}),recordLine=recordBlock?`\n${recordBlock}`:'';
  let block2=`${memberBlock}\n${healthDataBlock(modelHealth,cleanData)}${recordLine}${summaryTail}${tail()}${guidanceNote}${computedLine?`\n${computedLine}`:''}`;
  let summaryMessages=memberBlock;
  // The current topic's earlier turns (topic.ts), the whole window until the topic step below narrows them.
  let kept={member:modelJob.messages.filter(m=>m.seq!==latest.seq).map(m=>m.text),answers:modelJob.answers.map(a=>a.body),replies:modelJob.replies.map(r=>r.body)};
  // Coach-first: what the model's window remembers (conversation-memory.ts), read once the topic step knows what fell out of the block.
  let memory:ConversationMemory|null=null;
  // The judge's context (Astra ZH-02): the minimum urgency, the member's data and the earlier messages, bounded; redacted by replyCheck.
  // Keep the recent member messages and medicine list ahead of long plans and record blocks inside the bound.
  // Topic scope: only the current topic's turns (Zoe's previous text and the doctor's reply only when they are in it).
  const judgeContext=(reply:string)=>{const prevZoe=kept.answers.at(-1),lastDoctor=kept.replies.at(-1);
   return [`Minimum urgency required by the app: ${floorNow()}${floorNow()==='doctor_soon'&&chestMatter()?` (${CHEST_NOT_NOW_CONTEXT})`:''}.`,`Plan and goal on record: ${planAndGoal?'yes':'no'}.`,activityPermissionLine(modelHealth),
   ...(computedLine?[computedLine]:[]),
   ...(bpPending?['The app has already asked the member to rest and repeat a very high reading, and it handles the new numbers. This reply need not repeat that, and needs no same-day advice for that reading alone.']:[]),
   ...(bpGiven?['The app has already told the member how soon to see a doctor for this reading and sent it to the doctor. This reply need not repeat that or raise it.']:[]),
   ...kept.member.slice(summaryAsk?-12:-4).map(t=>`Earlier member message: ${t.slice(0,250)}`),
   ...(reportedLine(job.topic?.profile,reply,cleanData)?[reportedLine(job.topic?.profile,reply,cleanData)]:[]),
   ...(statinWarned?['The fixed same-day warning for this matter was already delivered. An ordinary follow-up need not repeat it or the 103 warning. Keep the floor; new urgent information still needs full advice.']:[]),
   ...(chestSaid()?['The fixed sentence "in the coming days" for these chest symptoms was already delivered. A follow-up need not repeat it. Keep the floor; new urgent information still needs full advice.']:[]),
   ...(savedReadingWarned?['The fixed same-day warning for this saved reading was already delivered. An ordinary follow-up need not repeat it or the 103 warning. Keep the floor; new urgent information still needs full advice.']:[]),
   ...(alarmConversation?['The full 103 warning for the earlier concern was already delivered. An ordinary follow-up need not repeat it or ask about it. Judge urgency from the newest message alone: an ordinary question about something else is answered fully and is never "emergency". If the newest message says the earlier message was a mistake, that message is not evidence of a current emergency. New urgent information still needs full advice.']:[]),
   // Only inside the topic: the line lets a short follow-up through; across a topic break it read as a step down from an older level.
   ...(memory&&prevZoe&&memoryContext(memory)?[memoryContext(memory)]:[]),...(prevZoe?[`Zoe's previous message: ${prevZoe.slice(-700)}`]:[]),
   ...(lastDoctor?[`The doctor's newest reply: ${lastDoctor.slice(0,300)}`]:[]),
   ...(recordBlock?[recordBlock]:[]),...(summaryData?[summaryData]:[]),
   healthDataBlock(modelHealth)].join('\n').slice(0,JUDGE_CONTEXT_MAX_CHARS);};
  const callTokens={inputTokens:approxTokens(HEALTH_SYSTEM_PROMPT)+approxTokens(block2),outputTokens:HEALTH_MAX_OUTPUT_TOKENS};
  const fixedSummary='The member wrote to Zoe; Zoe could not answer safely, so it waits for the doctor. See the conversation.';
  // The answer style (C1): the prompt and the judge's rubric together; NOREON_ZOE_FREE_STYLE=base rolls both back.
  // Coach-first drops back to the coach style once the model has said emergency and the second check lowered it: that flow stays as it was.
  let style=deps.freeStyle??freeStyle(deps.env??process.env);
  const setStyle=(s:FreeStyle)=>{style=s;healthRubric=s==='base'?'health_base':s==='coach-first'?'health_coach_first':'health';};
  setStyle(style);
  // When Zoe cannot answer: the warm line, and the doctor gets it (zoe_could_not_answer is on the automatic list).
  // Astra C1-R1: once any text in this run was held because its urgency was too low (the judge's urgency_understated, or the
  // model below the app's floor), the careful line retains that floor (or "today" for a judge's understatement), whatever a regeneration or a judge failure did
  // after it (S067#5: a diabetic foot ulcer held as doctor_soon got a receipt with no same-day instruction). Never lower.
  let understated:Urgency='none',selfSourced=false;
  // Same-day eval 23 Oct (R067, R078, R056): a careful line after Zoe already gave the same-day line in this topic keeps it,
  // unless the doctor replied since (the doctor's word then stands). Only the app's own sentence counts, never the model's words.
  const lastDoctorAgo=Math.min(Infinity,...job.replies.map(r=>r.minutesAgo));
  const saidToday=()=>continues()&&job.answers.some(a=>a.minutesAgo<lastDoctorAgo&&kept.answers.includes(a.body)&&Object.values(SAME_DAY_LINE).some(x=>a.body.includes(x)));
  // afterAlert: a second check on the newest message alone lowered the emergency, so the old alarm's reading does not set the level.
  const careful=(reason:string,extra:Partial<FinishInput>,afterAlert=false)=>{
   if(thirdPartyBp)return finish('summary_only',reason,{...extra,summary:null,answer:null,receipt:fixedLine(SAME_DAY_LINE[lang]),health:health('same_day',extra.health?.modelUrgency??'none','none','none')});
   const u=atLeast(afterAlert?atLeast(extra.health?.urgency??'none',floorNow()):atLeast(atLeast(extra.health?.urgency??'none',carefulFloor()),atLeast(understated,saidToday()?'same_day':'none')),yellow?'doctor_soon':'none');
   // A spend refusal is availability, not a clinical handoff. Known same-day floors still win.
   if(reason==='member_spend_cap_reached'&&u==='none')return memberSpendCap(lang,extra);
   // The doctor's summary says it was sent (the careful line forwards it), never the model's "not sent" (final-2 bug).
   const summary=extra.summary?extra.summary.replace(/\nDoctor: [^\n]*$/u,'')+'\nDoctor: sent (Zoe could not answer safely and gave the member the careful line)':fixedSummary;
   // Fable FB-02: a held self-harm answer still gives the support line (the app's text) and keeps self_harm as the forward reason.
   const selfHarm=extra.health?.forwardReason==='self_harm';
   // Suites-1: a proposed medicine or remedy is answered with the neutral "nothing extra or new" line first (lead 20 Oct 03:29).
   // Astra C1-R2: a member who says they will (or asks whether to) stop a medicine gets "do not stop it on your own" instead,
   // which counters the stop (S010, S059, M04: "nothing extra" did not).
   // Not at the same-day level: there the doctor decides about the medicines today (Zoe spec v2 Appendix A).
   const belowSameDay=(x:Urgency)=>x!=='same_day'&&x!=='emergency';
   // Zoe's own safety-net warnings are not reported facts (S010). Only member turns supply the medicine exceptions.
   const newestAnswer=job.answers.reduce<(typeof job.answers)[number]|undefined>((last,a)=>!last||a.minutesAgo<=last.minutesAgo?a:last,undefined);
   const repeatedCareful=floorNow()==='none'&&!selfHarm&&newestAnswer&&newestAnswer.minutesAgo<=360&&newestAnswer.minutesAgo<lastDoctorAgo&&isCarefulAnswer(newestAnswer.body);
   const lead=selfSourced?`${SELF_SOURCED_MEDICINE_LINE[lang]} `:u!=='same_day'&&stopsMedicine(latest.text,kept.member.slice(-4),mentionsMedicine)?`${STOP_MEDICINE_LINE[lang]} `:proposesSomething(latest.text,mentionsMedicine)?`${(belowSameDay(u)||repeatedCareful?NOTHING_NEW_NO_103_LINE:NOTHING_NEW_LINE)[lang]} `:'';
   // Doctor mode: the careful line is Zoe's text too, so it goes only on a topic the check gave to Zoe.
   if(doctorCheck&&topicRec?.owner!=='zoe')return holdForDoctor('doctor_mode_held',extra);
   // Armen msg 581: the message is only about the app and so is this topic, and nothing the rules hold open, so no hand-off. Every safety check came first;
   // the model's own doctor_soon or above, an unanswered question of Zoe's or an urgent run keep the line below. When in doubt it is health.
   // Zoe's own ask-again line is not such a question: a second failure in a row stays that line (Fable AQ-03).
   const modelLevel=extra.health?.modelUrgency??'none';
   if(u==='none'&&!lead&&!selfHarm&&!selfSourced&&!alarmConversation&&job.urgentSinceMinutes==null&&!scope.thirdPartyPossible&&!doctorCheck&&atLeast(modelLevel,'doctor_soon')!==modelLevel
    &&(!endsWithQuestion(contextLastZoe??'')||Object.values(ASK_AGAIN_LINE).includes((contextLastZoe??'').trim()))&&plainAppQuestion(latest.text)&&[...unanswered.map(m=>m.text),...kept.member.slice(-4)].every(t=>plainAppQuestion(t)||smallTalk(t))){
    events.push({name:'zoe.health_answer.no_handoff',outcome:'recorded',reason:'no_health_content',rule:'zoe.app_question',ruleVersion:APP_QUESTION_VERSION,actor:'system',attributes:{'noreon.zoe.health_answer.held_as':reason.slice(0,64)}});
    return finish('summary_only',reason,{...extra,summary:null,receipt:fixedLine(ASK_AGAIN_LINE[lang]),health:health('none',modelLevel,'none','none')});
   }
   // Only the classified pair's wording failure gets fixed advice. Urgent routes and
   // regeneration already ran; other holds retain their existing careful path.
   if(pde5Nitrate&&extra.guardReasons?.every(r=>r==='health.pde5_nitrate_missing_warning')&&extra.guardReasons.length&&!selfHarm&&!selfSourced&&u!=='emergency'){
    const warning=u==='same_day'?withStatinLine(SAME_DAY_LINE[lang],lang):u==='doctor_soon'?DOCTOR_SOON_LINE[lang]:'';
    const forwardReason=extra.health?.forwardReason??'treatment_decision';
    return finish('answered','health_answer_pde5_nitrate_fixed',{...extra,
     summary:renderDoctorSummary({asked:'The member asked about a PDE5 inhibitor and a nitrate. Zoe gave the fixed warning never to combine them and to ask the doctor before taking either. See the conversation.'},u,'auto',forwardReason),
     answer:composeHealthAnswer([warning,pde5NitrateReply(lang)].filter(Boolean).join('\n\n'),lang,'auto',doctorName,false,u),language:lang,receipt:null,
     health:health(u,extra.health?.modelUrgency??'none','auto',forwardReason)});
   }
   const baseLine=bpPending&&u==='none'?bpWaitingLine(lang):repeatedCareful?CAREFUL_FOLLOW_UP[lang]:carefulLine(lang,doctorName,u);
   const line=u==='same_day'?withStatinLine(baseLine,lang):baseLine;
   // Armen's fixed answer first; with none, safe advice until the doctor replies. Same-day has its own wording about medicines; the careful line stays because the rules send this to the doctor.
   const sideEffect=statinSideEffect(u);
   const held=selfSourced||selfHarm||!belowSameDay(u)?[]:guidance.filter(g=>!floorSkips(g,u,latest.text));
   const stopLead=lead===`${STOP_MEDICINE_LINE[lang]} `;
   // Astra C1-R2: a stop keeps "do not stop it on your own" whatever else is answered; the statin line already opens with it.
   const opening=held.length?`${stopLead&&!sideEffect&&!held.includes('stop_statin')?lead:''}${held.map(g=>GUIDANCE_LINES[g][lang]).join(' ')} `:(sideEffect&&stopLead?'':lead)||(sideEffect||selfSourced||selfHarm||!belowSameDay(u)||repeatedCareful||hasInterim(line)||!interimFits(memberTexts)?'':`${INTERIM_LINE[lang]} `);
   return finish('summary_only',reason,{...extra,summary,receipt:fixedLine(opening+(selfHarm?`${line} ${CRISIS_LINE_TEXT[urgentLang(lang)]}`:line)),
    health:{...(extra.health??health(u,'none','auto','zoe_could_not_answer')),urgency:u}});};
  // A plain request to log a dose or a reading, while a card can do it: logistics, not a health answer, so no model and no hold. Every
  // urgent, red-flag and same-day exit came first; a floor, an open question of Zoe's or an unanswered earlier message goes to the model.
  if(job.memberRecord?.chatCards&&plainLoggingRequest(latest.text)&&carefulFloor()==='none'&&!doctorCheck&&unanswered.length===1&&!endsWithQuestion(contextLastZoe??''))
   return finish('chatted','logging_request_no_model',{tier:'none',tierReason:'logging_request_no_model',redactionCount:count,answer:(chatV2?LOGGING_LINE_CHAT_V2:LOGGING_LINE)[lang],language:lang,summary:`The member asked to log a dose or a reading; Zoe ${chatV2?'said the new chat cannot save it yet':'pointed to the card'}.`,chat:{kind:'capabilities',source:'fixed'}});
  // A current floor keeps its timing line (coming days through careful()); a historical window floor alone is not a handoff.
  const unavailable=(extra:Partial<FinishInput>={})=>floorNow()==='same_day'?sameDayExit('availability',extra):floorNow()==='doctor_soon'?careful('member_spend_cap_reached',extra):memberSpendCap(lang,extra);
  if(throttle==='member_spend_cap_reached')return unavailable({redactionCount:count});
  // Decisions effects: here, after every fixed exit above.
  if(dflags.effects){const x=await lateDecisions();if(x){p=x.provider;fb=x.fallback;lang=x.lang;}}
  if(!p)return careful('health_answer_provider_unavailable',{redactionCount:count});
  const chatCards=job.memberRecord?.chatCards===true&&!chatV2;
  // Speed settings (free-mode-speed.ts): how fast the same checks run, never which.
  const speed=deps.freeSpeed??freeSpeed(deps.env??process.env);
  judgeEffort=speed.judgeEffort;
  // Split: the doctor's summary is a second call on the speaker's model or a tier's model from the same provider (the
  // launch gate checks the speaker's provider; another provider's model is never used for it).
  const sumModel=speed.split&&speed.summaryTier!=='speaker'?deps.routing?.config.tiers[speed.summaryTier]?.model:undefined;
  const sumCandidate=sumModel&&deps.routing?deps.routing.providerFor(sumModel):null;
  const sumProvider:ZoeProvider|null=!speed.split?null:sumCandidate&&sumCandidate.local===p.local&&sumCandidate.requestModel.split('/')[0]===p.requestModel.split('/')[0]?sumCandidate:p;
  // The why rationale rides on the summary call, so the reply prompt, the reply call and the judge stay as they are (why.ts).
  const wantWhy=!!sumProvider&&zoeWhyModelOn(deps.env??process.env);
  // Both outputs are English. The plain 60-word summary needs less room than summary plus rationale.
  const sumMaxOutputTokens=wantWhy?HEALTH_SUMMARY_MAX_OUTPUT_TOKENS:600;
  whySeen=seen({record:job.memberRecord,recordTarget},cleanData);
  const sumPrompt=wantWhy?HEALTH_SUMMARY_WHY_PROMPT:HEALTH_SUMMARY_PROMPT;
  const sumTokens={inputTokens:approxTokens(sumPrompt)+approxTokens(block2)+approxTokens('x'.repeat(HEALTH_ANSWER_MAX_CHARS))+(wantWhy?approxTokens(whySourcesBlock(whySeen.data)):0),outputTokens:sumMaxOutputTokens};
  // One schema retry and one regenerate after a held text (lead 20:11), each with a judge call.
  // The reservation stays conservative; only the final reply now needs a summary.
  // Fast endpoint (free-mode-speed.ts): the same model, at FAST_PRICE_MULTIPLIER times its price in every estimate and charge.
  const fastFor=(q:ZoeProvider)=>speed.fast&&!q.local&&fastAvailable(q.requestModel);
  const priceOf=(q:ZoeProvider,fast:boolean)=>fast?{...q.pricing,inputUsdPerMTok:q.pricing.inputUsdPerMTok*FAST_PRICE_MULTIPLIER,outputUsdPerMTok:q.pricing.outputUsdPerMTok*FAST_PRICE_MULTIPLIER}:q.pricing;
  let fastFailed=false;
  // Astra ZS-03: the fast premium on every permitted call that may go to a fast endpoint, primary or fallback, with the same
  // shape as budget(): the primary's attempts, the fallback's one call, and the schema retry and regenerate on either.
  const premium=(q:ZoeProvider|null)=>q&&fastFor(q)?(FAST_PRICE_MULTIPLIER-1)*costUsd(q.pricing,callTokens):0;
  const fastPremium=PROVIDER_ATTEMPTS*premium(p)+premium(fb)+4*Math.max(premium(p),premium(fb));
  // Topic scope (topic.ts): the rules first; the check (the low tier's model, else the stand-in for a local speaker) only when
  // they cannot tell, and always in doctor mode (whose matter is the newest message about?). Its call is in the reservation.
  const scoped=topicScopeOn(deps.env??process.env);
  const lowTier=deps.routing?.config.tiers.low;
  const tc:ZoeProvider|null=!scoped||!('ask' in rules)&&!doctorCheck||summaryAsk&&!doctorCheck?null:deps.topicCheck!==undefined?deps.topicCheck:lowTier&&deps.routing?deps.routing.providerFor(lowTier.model):p.local?createFakeProvider():null;
  // An injection in the doctor's matter messages never reaches the topic classifier either (it decides whether Zoe may answer during a doctor takeover).
  const matterForCheck=doctorCheck&&job.doctorMatter?{...job.doctorMatter,messages:job.doctorMatter.messages.filter(m=>!classifyScope(m.text).injection)}:null;
  const checkBlock=tc?topicCheckBlock(turns,latest,matterForCheck,cleanData):'';
  const checkTokens={inputTokens:approxTokens(TOPIC_CHECK_PROMPT)+approxTokens(checkBlock),outputTokens:TOPIC_CHECK_MAX_OUTPUT_TOKENS};
  // The second check on a model-only emergency (urgent-check.ts): the medium tier's model (Sonnet), known before the reservation.
  const medCheck=deps.routing?.config.tiers.medium;
  const checker:ZoeProvider|null=deps.urgencyCheck!==undefined?deps.urgencyCheck:deps.routing?(medCheck?deps.routing.providerFor(medCheck.model):null):p.local?p:null;
  // After a recent alert, only what Zoe has not answered yet: the earlier alert must not confirm itself. Deterministic hits keep the whole picture.
  const unansweredOnly=recentAlert&&urgent.outcome!=='escalate'&&!textRedFlags(unanswered.map(m=>m.text),{intakeActive:false}).length;
  // Only the bounded food-question or closed settled-chest gate may skip confirmation of an earlier alert.
  // Settled chest words can still match a symptom sheet; their full absence guards have already passed in the gate.
  const alertAlreadyGivenCheck=()=>unansweredOnly&&unanswered.every(m=>plainRequestAfterAlert(m.text)&&(!assertedAlarmSymptom(normaliseText(m.text))||plainSettledChest(m.text)));
  let alertAlreadyGiven=false;
  // The speaker's view after an alert with no new sign: only the unanswered messages, with a note that the 103 advice was already given for
  // the earlier concern. A model that still sees that concern or Zoe's 103 text keeps answering it (Armen, 3 Nov), and a rewrite has no time left.
  const alertView=()=>block2.replace(/<member_messages>[\s\S]*?<\/member_messages>/u,()=>`${block(redacted.filter(m=>unanswered.some(u=>u.seq===m.seq)).map(m=>({seq:m.seq,text:m.r.text,minutesAgo:m.minutesAgo})),[],[])}\n<alert_already_given>The member had an urgent concern earlier in this chat. The 103 advice was already given and the doctor was told. Answer only the messages above.</alert_already_given>`);
  // The member's earlier words stay, because "it's spreading to my jaw" needs them (Fable); Zoe's own 103 text does not, and the note stops them confirming themselves.
  const urgencyBlock=()=>unansweredOnly?`<alert_already_given>The 103 advice was already given for the earlier messages. Confirm an emergency only for new or worse information in the unanswered messages, read in the light of the earlier ones. Politeness, thanks or a question about something else is not new information.</alert_already_given>\n${block(redacted.map(m=>({seq:m.seq,text:m.r.text,minutesAgo:m.minutesAgo})),[],[])}\n<unanswered_from_seq>${Math.min(...unanswered.map(m=>m.seq))}</unanswered_from_seq>`:block2;
  const urgencyTokens={inputTokens:approxTokens(URGENCY_CHECK_PROMPT)+approxTokens(block2),outputTokens:URGENCY_CHECK_MAX_OUTPUT_TOKENS};
  // One schema retry, one regenerate after a held text, one after a repeat and one after a not-confirmed emergency, plus the topic and urgency checks.
  const b=budget(p,fb,callTokens,4,HEALTH_ANSWER_MAX_CHARS+JUDGE_CONTEXT_MAX_CHARS,3,(sumProvider?4*costUsd(sumProvider.pricing,sumTokens):0)+fastPremium+(tc?costUsd(tc.pricing,checkTokens):0)+(checker?costUsd(checker.pricing,urgencyTokens):0),speed.judgeTier);
  const reserved=await deps.ports.reserve(job.runId,b.estimate,b.local&&(!tc||tc.local)&&(!checker||checker.local),takeEvents(),{tier:decision.tier,model:p.requestModel,judgeModel:b.judgeModel});
  if(!reserved.ok)return SPEND_CAP_CODES.has(reserved.code)?unavailable({redactionCount:count}):careful(reserved.code,{redactionCount:count});
  shadowDecisions(b.local&&(!tc||tc.local)&&(!checker||checker.local));
  let sp:ZoeProvider=p;let result:ProviderResult|null=null,latencyMs=0,spentUsd=0;const usage={inputTokens:0,outputTokens:0};
  {
   let verdict:Awaited<ReturnType<typeof runTopicCheck>>['verdict']=null;
   if(tc){
    const r=await runTopicCheck(tc,checkBlock,{timeoutMs:Math.max(1_000,Math.min(TOPIC_CHECK_TIMEOUT_MS,left()-MIN_CALL_MS-JUDGE_TIMEOUT_MS)),now});
    verdict=r.verdict;latencyMs+=r.latencyMs;
    const u=r.result?.usage??{inputTokens:0,outputTokens:0};usage.inputTokens+=u.inputTokens;usage.outputTokens+=u.outputTokens;
    const cost=costUsd(tc.pricing,r.result?.usage??checkTokens);spentUsd+=cost;
    const k=r.result?.kind??'error';
    events.push({name:'zoe.provider.call',outcome:k==='ok'?(verdict?'allow':'failed'):k==='refusal'?'block':'failed',reason:k==='ok'?(verdict?'completed':'topic_check_schema_invalid'):k==='refusal'?'provider_refusal':`provider_${r.result?.kind==='error'?r.result.errorClass:'unavailable'}`,
     rule:'zoe.provider',ruleVersion:TOPIC_VERSION,actor:'ai',attributes:{'gen_ai.operation.name':'chat','gen_ai.provider.name':tc.providerName,'gen_ai.request.model':tc.requestModel,'gen_ai.request.max_tokens':TOPIC_CHECK_MAX_OUTPUT_TOKENS,
      'gen_ai.usage.input_tokens':u.inputTokens,'gen_ai.usage.output_tokens':u.outputTokens,'noreon.zoe.purpose':'topic_check','noreon.zoe.latency_ms':r.latencyMs,'noreon.zoe.cost_usd':cost,'noreon.zoe.region':tc.region}});
   }
   // Doctor mode: whose is the newest message? The member's divider counts as a new topic; otherwise the check's view. Zoe answers
   // a clearly different matter (the check says "no", or a new topic that is not clearly the doctor's), so a handoff never strands
   // routine questions. A continuation of the doctor's own topic stays with the doctor unless the check clearly says it is not
   // theirs: an unsure or failed check on the same topic waits (doctor takeover, Armen 20 Oct; e2e telegram/doctor.spec.ts).
   const divider='decided' in rules&&rules.decided.source==='divider';
   const topic:TopicKind=!scoped||summaryAsk&&!doctorCheck?'refers_back':doctorCheck?(divider?'new':verdict?.topic??'same'):'decided' in rules?(decisionsTopicVeto&&rules.decided.source==='rules'&&rules.decided.topic==='new'?'refers_back':rules.decided.topic):verdict?.topic??rules.fallback;
   const source:TopicSource=!scoped?'rules':'decided' in rules&&(!doctorCheck||divider)?(decisionsTopicVeto&&rules.decided.source==='rules'&&rules.decided.topic==='new'?'classifier':rules.decided.source):verdict?'classifier':'check_failed';
   const doctorTopic:DoctorTopic|null=doctorCheck?verdict?.doctor_matter??null:null;
   const zoeAnswers=!doctorCheck||doctorTopic==='no'||doctorTopic!=='yes'&&topic==='new';
   topicNow=topic;
   let keptTurns=topicTurns(turns,latest.minutesAgo,topic,startSeq);
   // Safety state always carries over (Armen and Khikar, 20 Oct): an open same-day or emergency matter in the last hours (a
   // reading at a same-day floor, a red-flag text, or Zoe's own 103 or "today" advice) is never scoped away, whatever the
   // check said (G2 S020: "which symptoms mean I go at once?" two minutes after a same-day triglyceride answer).
   let safetyCarry=false;
   if(scoped&&topic!=='refers_back'){
    const recent=turns.filter(x=>x.minutesAgo-latest.minutesAgo<=TOPIC_MAX_GAP_MIN&&!keptTurns.includes(x));
    const texts=recent.filter(x=>x.who==='member').map(x=>x.text);
    if(recent.length&&(floorOf(texts,null)||textRedFlags(texts,{intakeActive:false,latestReading:null}).length>0||recent.some(x=>x.who!=='member'&&SAFETY_CARRY.test(x.text)))){
     safetyCarry=true;keptTurns=topicTurns(turns,latest.minutesAgo,'same',null);}
   }
   topicRec={topic,source,startSeq:topicStartFor(topic,keptTurns,latest.seq,startSeq,turns),owner:zoeAnswers?'zoe':'doctor',doctorTopic,kept:keptTurns.length,dropped:turns.length-keptTurns.length};
   events.push({name:'zoe.topic',outcome:'recorded',reason:`topic_${topic}_${source}`,rule:'zoe.topic',ruleVersion:TOPIC_VERSION,actor:source==='classifier'?'ai':'system',
    attributes:{'noreon.zoe.topic':topic,'noreon.zoe.topic.source':source,'noreon.zoe.topic.rule':('decided' in rules?rules.decided.reason:rules.reason).slice(0,64),
     'noreon.zoe.topic.gap_minutes':('decided' in rules?rules.decided.gapMinutes:rules.gapMinutes)??-1,'noreon.zoe.topic.kept':keptTurns.length,'noreon.zoe.topic.dropped':turns.length-keptTurns.length,
     'noreon.zoe.topic.owner':topicRec.owner,'noreon.zoe.topic.doctor_matter':doctorTopic??'none','noreon.zoe.topic.safety_carry':safetyCarry}});
   if(!zoeAnswers)return holdForDoctor('doctor_mode_doctor_topic',{usage,costUsd:spentUsd,latencyMs,redactionCount:count});
   if(scoped){
    const keep=new Set(keptTurns.map(t=>t.order));
    kept={member:keptTurns.filter(t=>t.who==='member').map(t=>t.text),answers:keptTurns.filter(t=>t.who==='zoe').map(t=>t.text),replies:keptTurns.filter(t=>t.who==='doctor').map(t=>t.text)};
    const scopedBlock=block(redacted.filter((m,i)=>m.seq===latest.seq||keep.has(i)).map(m=>({seq:m.seq,text:m.r.text,minutesAgo:m.minutesAgo})),
     replies.filter((_,i)=>keep.has(2000+i)),answers.filter((_,i)=>keep.has(1000+i)));
    block2=`${scopedBlock}\n${healthDataBlock(modelHealth,cleanData)}${recordLine}\n${healthSummaryBlock(job.topic?.profile,cleanData,job.memberRecord?.disputed)}${summaryTail}${tail()}${guidanceNote}${computedLine?`\n${computedLine}`:''}`;
    summaryMessages=scopedBlock;
    whySeen=seen({profile:job.topic?.profile??null,record:job.memberRecord,recordTarget},cleanData);
   }
   if(style==='coach-first'){
    memory=conversationMemory(modelJob,latest.seq,{dropped:modelJob.messages.filter(m=>m.seq!==latest.seq&&!kept.member.includes(m.text)).map(m=>m.text),conditions:modelJob.topic?.profile?.conditions??[]});
    const mb=memoryBlock(memory,{clean:cleanData,esc,latest:latest.text});
    if(mb)block2=`${block2}\n${mb}`;
    events.push({name:'zoe.memory',outcome:'recorded',reason:mb?'memory_given':'nothing_to_remember',rule:'zoe.memory',ruleVersion:MEMORY_VERSION,actor:'system',attributes:{'noreon.zoe.memory.same_day':memory.said.sameDay,'noreon.zoe.memory.doctor_soon':memory.said.doctorSoon,'noreon.zoe.memory.objections':memory.objections.length,'noreon.zoe.memory.corrections':memory.corrections.length,'noreon.zoe.memory.promises':memory.promises.length}});
   }
  }
  const speedAttrs={'noreon.zoe.free_speed':`${FREE_SPEED_VERSION}:${speed.split?'split':'one'}${speed.fast?'+fast':''}:${speed.replyEffort??'default'}:${speed.judgeTier}/${speed.judgeEffort??'default'}:${speed.summaryTier}/${speed.summaryEffort??'default'}`,
   'noreon.zoe.free_style':`${FREE_STYLE_VERSION}:${style}`};
  const call=async(q:ZoeProvider,attempt:number,isFallback:boolean,feedback?:string,memberView?:string)=>{
   const started=now();let r:ProviderResult;const fast=fastFor(q)&&!fastFailed;
   whyPrompt=`${HEALTH_ANSWER_VERSION}:${style}`;
   try{r=await q.complete({timeoutMs:callTimeout(),purpose:'health_answer',promptVersion:whyPrompt,system:healthReplyPrompt(style,speed.split,scoped,chatCards,chatV2),memberBlock:feedback?`${memberView??(alertAlreadyGivenCheck()?alertView():block2)}\n${feedback}`:(alertAlreadyGivenCheck()?alertView():block2),replyLanguage:lang,maxOutputTokens:HEALTH_MAX_OUTPUT_TOKENS,
    ...(speed.replyEffort?{effort:speed.replyEffort}:{}),...(fast?{fast:true}:{})});}
   catch{r={kind:'error',errorClass:'unavailable',usage:null};}
   // A fast-endpoint error (its own rate limit, an outage): later calls use the standard endpoint.
   if(fast&&r.kind==='error')fastFailed=true;
   const ms=Math.round(now()-started);latencyMs+=ms;
   const u=r.usage??{inputTokens:0,outputTokens:0};usage.inputTokens+=u.inputTokens;usage.outputTokens+=u.outputTokens;
   const cost=costUsd(priceOf(q,fast),r.usage??callTokens);spentUsd+=cost;
   events.push({name:'zoe.provider.call',outcome:r.kind==='ok'?'allow':r.kind==='refusal'?'block':'failed',reason:r.kind==='ok'?'completed':r.kind==='refusal'?'provider_refusal':`provider_${r.errorClass}`,
    rule:'zoe.provider',ruleVersion:HEALTH_ANSWER_VERSION,actor:'ai',attributes:{'gen_ai.operation.name':'chat','gen_ai.provider.name':q.providerName,'gen_ai.request.model':q.requestModel,'gen_ai.request.max_tokens':HEALTH_MAX_OUTPUT_TOKENS,
     ...(r.kind!=='error'?{'gen_ai.response.model':r.responseModel,'gen_ai.response.id':r.responseId,'gen_ai.response.finish_reasons':r.finishReason}:{'error.type':r.errorClass}),
     'gen_ai.usage.input_tokens':u.inputTokens,'gen_ai.usage.output_tokens':u.outputTokens,'noreon.zoe.purpose':'health_answer','noreon.zoe.attempt':attempt,'noreon.zoe.latency_ms':ms,'noreon.zoe.cost_usd':cost,
     'noreon.zoe.region':q.region,'noreon.zoe.tier':decision.tier,'noreon.zoe.fallback_used':isFallback,'noreon.zoe.fast':fast,'noreon.zoe.config_version':ZOE_CONFIG_VERSION.slice(0,128),...speedAttrs}});
   return r;
  };
  // With a fallback, a timeout goes straight to it (a second call on the slow model would use its time; Astra F3: without one, the usual retry).
  for(let attempt=1;attempt<=PROVIDER_ATTEMPTS;attempt++){if(late('provider_attempt'))break;const wasFast=fastFor(sp)&&!fastFailed;result=await call(sp,attempt,false);
   // A failed fast call is retried once on the standard endpoint (its rate limit is the fast endpoint's own); otherwise as before.
   if(result.kind!=='error'||(!wasFast&&(result.errorClass==='rate_limited'||(result.errorClass==='timeout'&&fb))))break;}
  if(fb&&result?.kind==='error'&&!late('provider_fallback')){sp=fb;provider=fb;route.fallbackUsed=true;result=await call(fb,PROVIDER_ATTEMPTS+1,true);}
  const common=()=>({redactionCount:count,usage,costUsd:spentUsd,latencyMs});
  if(!result||result.kind!=='ok')return careful(result?.kind==='refusal'?'health_answer_provider_refusal':`health_answer_provider_${result?.errorClass??'unavailable'}`,{...common(),sealed:seal({memberBlock:block2,response:null})});
  // Deterministic repair before any retry (final-2: 10 of 12 schema failures were a cut-off first answer followed by a complete
  // one in the same output, or a ```json fence): the raw text, then without a fence, then from each {"reply" start, newest first.
  type Parsed={success:true;data:Omit<HealthOutput,'summary'>&{summary?:unknown}}|{success:false};
  const parse=(raw:string):Parsed=>{const tail=style==='coach-first',r=speed.split?repairHealthJson(raw,healthReplySchema,tail):repairHealthJson(raw,healthOutputSchema,tail);return r.success?{success:true,data:r.data as Extract<Parsed,{success:true}>['data']}:{success:false};};
  if(!parse(result.raw).success&&!late('schema_retry')){const again=await call(sp,PROVIDER_ATTEMPTS+2,route.fallbackUsed);if(again.kind==='ok')result=again;}
  let sealed=seal({memberBlock:block2,response:redactText(result.raw,{nameTokens:own}).text});
  const ctx={memberTexts:job.messages.map(m=>m.text),replyLanguage:lang};
  let judgeUsage={inputTokens:0,outputTokens:0},judgeCost=0,judgeMs=0;
  const sumUsage={inputTokens:0,outputTokens:0};let sumCost=0,sumMs=0;
  const checked=()=>({redactionCount:count,usage:{inputTokens:usage.inputTokens+judgeUsage.inputTokens+sumUsage.inputTokens,outputTokens:usage.outputTokens+judgeUsage.outputTokens+sumUsage.outputTokens},
   costUsd:spentUsd+judgeCost+sumCost,latencyMs:latencyMs+judgeMs+sumMs});
  // Split: the doctor's summary of the final reply, written by its own short call. Null when it
  // fails, times out or does not parse: the doctor then reads the "summary unavailable" marker and the conversation.
  // Track started summaries so an emergency can stop one at its deadline before the run finishes.
  const liveSummaries=new Set<AbortController>(),summaryCalls:Promise<unknown>[]=[];
  // Only the newest summary call's rationale counts (a regenerated reply has its own). Held by the guard or unreadable: the record says it is missing.
  let whyCalls=0;
  const noteWhy=(r:ProviderResult)=>{
   if(r.kind!=='ok'){rationale.missing=r.kind==='refusal'?'summary_refused':r.errorClass==='timeout'?'summary_late':'summary_failed';return;}
   const w=readModelWhy(r.raw);
   if(!w){rationale.missing='not_in_output';return;}
   if(guardField('summary',[...w.signs,...w.doubts,w.doctor].join('\n'),ctx).outcome==='block'){rationale.missing='guard_blocked';return;}
   const clean=(t:string)=>redactContacts(cleanData(t));
   rationale.why={...w,signs:w.signs.map(clean),doubts:w.doubts.map(clean),doctor:clean(w.doctor)};rationale.missing=null;
  };
  const summaryCall=async(reply:string,urgency:Urgency,forward:string,messages:string):Promise<DoctorSummary|null>=>{
   if(!sumProvider)return null;
   const mine=++whyCalls;
   if(wantWhy)Object.assign(rationale,{asked:true,why:null,model:sumProvider.requestModel,missing:'summary_late'});
   const started=now();let r:ProviderResult;
   // Astra ZS-02: a hard deadline of its own, whatever the provider does; on the deadline or a stop the call is aborted and
   // charged at its estimate (ZS-01: a call that started is never free), and a late result is ignored.
   const abort=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
   const limit=Math.max(MIN_CALL_MS,Math.min(SUMMARY_TIMEOUT_MS,left()));
   const stopped=new Promise<ProviderResult>(res=>{const stop=()=>res({kind:'error',errorClass:'timeout',usage:null});timer=setTimeout(()=>{abort.abort();},limit);abort.signal.addEventListener('abort',stop,{once:true});});
   const request=sumProvider.complete({timeoutMs:limit,signal:abort.signal,purpose:'health_summary',promptVersion:wantWhy?`${HEALTH_ANSWER_VERSION}+${ZOE_WHY_VERSION}`:HEALTH_ANSWER_VERSION,system:sumPrompt,
    memberBlock:`${wantWhy?block2:`${messages}\n${healthDataBlock(modelHealth,cleanData)}`}\n${zoeReplyBlock(reply,urgency,forward)}${wantWhy?`\n${whySourcesBlock(whySeen.data)}`:''}`,replyLanguage:lang,maxOutputTokens:sumMaxOutputTokens,...(speed.summaryEffort?{effort:speed.summaryEffort}:{})})
    .catch(():ProviderResult=>({kind:'error',errorClass:'unavailable',usage:null}));
   liveSummaries.add(abort);
   try{r=await Promise.race([request,stopped]);}finally{clearTimeout(timer);liveSummaries.delete(abort);}
   if(r.kind==='error'&&!abort.signal.aborted)abort.abort();
   const ms=Math.round(now()-started);sumMs+=ms;
   const u=r.usage??{inputTokens:0,outputTokens:0};sumUsage.inputTokens+=u.inputTokens;sumUsage.outputTokens+=u.outputTokens;
   const cost=costUsd(sumProvider.pricing,r.usage??sumTokens);sumCost+=cost;
   const parsed=r.kind==='ok'?repairSummary(r.raw):null;
   if(wantWhy&&mine===whyCalls)noteWhy(r);
   events.push({name:'zoe.provider.call',outcome:r.kind==='ok'?'allow':r.kind==='refusal'?'block':'failed',reason:r.kind==='ok'?(parsed?'completed':'summary_schema_invalid'):r.kind==='refusal'?'provider_refusal':`provider_${r.errorClass}`,
    rule:'zoe.provider',ruleVersion:HEALTH_ANSWER_VERSION,actor:'ai',attributes:{'gen_ai.operation.name':'chat','gen_ai.provider.name':sumProvider.providerName,'gen_ai.request.model':sumProvider.requestModel,'gen_ai.request.max_tokens':sumMaxOutputTokens,
     ...(r.kind!=='error'?{'gen_ai.response.model':r.responseModel,'gen_ai.response.id':r.responseId,'gen_ai.response.finish_reasons':r.finishReason}:{'error.type':r.errorClass}),
     'gen_ai.usage.input_tokens':u.inputTokens,'gen_ai.usage.output_tokens':u.outputTokens,'noreon.zoe.purpose':'health_summary','noreon.zoe.latency_ms':ms,'noreon.zoe.cost_usd':cost,
     'noreon.zoe.region':sumProvider.region,'noreon.zoe.tier':decision.tier,'noreon.zoe.config_version':ZOE_CONFIG_VERSION.slice(0,128),...speedAttrs}});
   return parsed;
  };
  // Before the run finishes: stop the summary calls nobody waits for any more; each is then charged (ZS-01) and leaves no timer.
  const settleSummaries=async()=>{for(const a of [...liveSummaries])a.abort();await Promise.all(summaryCalls);};
  type H=NonNullable<FinishInput['health']>;
  // Summarise only the final exchange. A held text replaced by a regeneration never needs a
  // doctor-summary call. Emergencies still wait at most URGENT_SUMMARY_WAIT_MS, then take the marker.
  let repeatRetried=false;
  type Vetted={kind:'send';full:string;summary:()=>Promise<string>;health:H}|{kind:'urgent';summary:()=>Promise<string>;health:H}|{kind:'schema'}|{kind:'held';summary:()=>Promise<string>;reasons:string[];health:H};
  // One model output through the floors, the structural checks and the light judge.
  // opts (after a not-confirmed emergency): the check's level as the minimum, and no 103 from this text (held instead).
  let heldAskDone=false;
  const vet=async(raw:string,opts?:{floor:Urgency;noEmergency:true}):Promise<Vetted>=>{
   const floor=floorNow(),minU=opts?.floor??floor;
   const parsed=parse(raw);
   events.push({name:'zoe.guard.output_schema',outcome:parsed.success?'allow':'block',reason:parsed.success?'schema_valid':'schema_invalid',rule:'zoe.health_output_schema',ruleVersion:HEALTH_ANSWER_VERSION,actor:'system',attributes:{'noreon.zoe.guard.name':'output_schema'}});
   if(!parsed.success)return {kind:'schema'};
   // Pregnancy on an ACE inhibitor is Armen's own yellow flag: at least doctor_soon and sent automatically, whatever the model chose. Never lowers a level or replaces another reason.
   const candidate=thirdPartyBp?{...parsed.data,urgency:parsed.data.urgency==='emergency'?'same_day' as const:parsed.data.urgency,forward:'none' as const,forward_reason:'none' as const}:parsed.data;
   const out=yellow?{...candidate,urgency:atLeast(parsed.data.urgency,'doctor_soon'),forward:'auto'as const,forward_reason:parsed.data.forward_reason==='none'?'pregnancy_on_medicine'as const:parsed.data.forward_reason}:candidate;
   // A rejected candidate may identify an unsupervised medicine. Keep that caution if a retry drops the reason (S061).
   if(out.forward_reason==='self_sourced_medicine')selfSourced=true;
   // Armen, 2 Nov (Task 8): a self-harm reason from the model is never below today.
   const selfHarmModel=out.forward_reason==='self_harm',urgency=atLeast(atLeast(out.urgency,minU),selfHarmModel?'same_day':'none');
   const fwd=thirdPartyBp?{forward:'none' as const,reason:'none' as ForwardReason}:decideForward(out,urgency,declined,style,medicineNoteDue(latest.text,kept.member.slice(-4),mentionsMedicine,job.topic?.profile?.conditions)?'stopped_medicine':floor==='doctor_soon'&&labSoon?'critical_lab':null);
   if(pde5Nitrate){fwd.forward='auto';if(fwd.reason==='none')fwd.reason='treatment_decision';}
   const h=health(urgency,out.urgency,fwd.forward,fwd.reason);
   const reply=freeVoiceClean(out.reply);
   // Before the summary call, so the doctor's summary and the why record carry the final decision, not the one this corrects
   // (Astra WHY-02). An emergency or a level below the floor never sends these words, and keeps its own hand-off.
   if(urgency!=='emergency'&&atLeast(out.urgency,minU)===out.urgency){
    // The ask line never follows the model's own question (Fable F2): the member's answer then goes to the model with it.
    if(fwd.forward==='asked'&&endsWithQuestion(reply)){fwd.forward='none';fwd.reason='none';h.forward='none';h.forwardReason='none';}
    // Astra ZA-01: an answer that ends with Zoe's own question (for example a danger-sign question) is an open assessment, never
    // "answered by Zoe" in the doctor's inbox; recorded on the run.
    if(fwd.forward==='none'&&endsWithQuestion(reply)){fwd.reason='zoe_question';h.forwardReason='zoe_question';}
    // The doctor gets a correction and anything the member wanted kept from them. Never the level: only who sees it.
    if(fwd.forward!=='auto'&&(withhold||corrections.length)){fwd.forward='auto';fwd.reason=withhold?'withhold_request':'member_statement';h.forward='auto';h.forwardReason=fwd.reason;}
   }
   // Armen 2 Nov (nurse-first.ts): the reason is what the database reads to give the assigned nurse a task; the doctor's route stays.
   if(nurseFirst({forward:fwd.forward,reason:fwd.reason,urgency,declined,sameDayMatter:alarmConversation||carefulFloor()==='same_day'||mayBeOpen(job),newTexts:unanswered.map(m=>m.text),texts:job.messages.map(m=>m.text),env:deps.env??process.env})){fwd.reason=MILD_SIDE_EFFECT_REASON;h.forwardReason=MILD_SIDE_EFFECT_REASON;}
   // A carer's reading never opens a task for this member's doctor, including withholding and interaction overrides.
   if(thirdPartyBp){fwd.forward='none';fwd.reason='none';h.forward='none';h.forwardReason='none';}
   // The doctor's summary: the model's (split: the summary call's), when the staff-field guard lets it through.
   const sUrgency:Urgency=urgency==='emergency'?'emergency':urgency,sForward=urgency==='emergency'?'auto':fwd.forward,sReason=fwd.reason;
   // A text the doctor receives is summed up from the whole window and the record, not only this topic's turns (Monika 558).
   const toDoctor=sForward!=='none'?`${memberBlock}\n${healthSummaryBlock(job.topic?.profile,cleanData,job.memberRecord?.disputed)}`:summaryMessages;
   let savedSummary:Promise<string>|undefined;
   const summary=()=>savedSummary??=makeSummary();
   const makeSummary=()=>{
    const sumObj:Promise<DoctorSummary|null>=speed.split?summaryCall(out.reply,sUrgency,sForward,toDoctor):Promise.resolve((out.summary as DoctorSummary|undefined)??null);
    summaryCalls.push(sumObj);
    return sumObj.then(s=>{
     const disputed=memory?.corrections.some(c=>c.condition)?'\nThe member disputes a condition on their questionnaire: see the conversation.':'';
     const stated=`${withhold?'\nThe member asked to keep this from the doctor; Zoe told them the care team sees this chat.':''}${corrections.map(c=>`\nThe member says, about their questionnaire: "${c.words}". Their statement, to check; the urgency rules are unchanged.`).join('')}`;
     const rendered=`${renderDoctorSummary(s??{asked:SUMMARY_UNAVAILABLE},sUrgency,sForward,sReason)}${disputed}${stated}`;
     const sv=guardField('summary',rendered,ctx);
     return (sv.outcome==='block'?renderDoctorSummary({asked:'See the conversation (summary withheld by the staff-field guard).'},urgency,fwd.forward,fwd.reason):redactContacts(rendered)).slice(0,3900);
    });
   };
   events.push({name:'zoe.health_answer.urgency',outcome:urgency==='emergency'?'escalate':'recorded',reason:urgency!==out.urgency?'urgency_raised_by_floor':urgency==='emergency'?'model_emergency_urgent_route':'model_urgency',
    rule:'zoe.health_answer',ruleVersion:HEALTH_ANSWER_VERSION,actor:'system',attributes:{'noreon.zoe.health_answer.urgency':urgency,'noreon.zoe.health_answer.model_urgency':out.urgency,'noreon.zoe.health_answer.forward':fwd.forward,'noreon.zoe.health_answer.forward_reason':fwd.reason}});
   // Classification goes through the existing emergency confirmation/103 path first.
   // Its fixed text needs no model warning or wording retry, and cannot fall into careful().
   if(urgency==='emergency'&&opts?.noEmergency)return {kind:'held',summary,reasons:['urgency_check.still_emergency'],health:{...h,urgency:minU}};
   if(urgency==='emergency')return {kind:'urgent',summary,health:health('emergency',out.urgency,'auto',fwd.reason==='none'?'same_day':fwd.reason)};
   const interactionReasons=guardPde5NitrateReply(reply,lang,pde5Nitrate);
   if(interactionReasons.length){
    events.push({name:'zoe.guard.output_health',outcome:'block',reason:'blocked_category_matched',rule:'zoe.pde5_nitrate',ruleVersion:PDE5_NITRATE_VERSION,actor:'system',
     attributes:{'noreon.zoe.guard.name':'output_health','noreon.zoe.guard.categories':interactionReasons.join(',')}});
    return {kind:'held',summary,reasons:interactionReasons,health:h};
   }
   // The model's own level below the floor: its words would say the wrong thing (Astra ZH-01); regenerate, never send.
   if(atLeast(out.urgency,minU)!==out.urgency){understated=atLeast(understated,minU);return {kind:'held',summary,reasons:[`floor.below_${minU}`],health:h};}
   // A known floor opens with the fixed timing sentence, whatever the model wrote (Astra round 2; chest not-now, 2 Nov).
   // Astra Z360-01: the support line is the app's own fixed text after the model's words (the contact guard keeps numbers out of the model's).
   // The check's other direction (conversation-memory.ts): a repeat is held once like any text; the next text goes on as it is, never the careful line.
   // A saved reading still owed its fixed warning also needs the model's renewed safety advice.
   const repeats=memory&&!(savedReadingFloor&&!savedReadingWarned)?repeatFindings(reply,memory,job.answers.map(a=>a.body),urgency,latest.text):[];
   // A place the new chat does not have (app-question.ts) is held the same way: one regenerate, and the text goes on through the other checks.
   const sections=chatV2?missingSections(reply):[];
   if((repeats.length||sections.length)&&!repeatRetried&&!opts&&!late('repeat_regenerate')){repeatRetried=true;
    if(repeats.length)events.push({name:'zoe.guard.repeat',outcome:'block',reason:repeats[0]!,rule:'zoe.memory',ruleVersion:MEMORY_VERSION,actor:'system',attributes:{'noreon.zoe.guard.name':'repeat','noreon.zoe.repeat.findings':repeats.join(',')}});
    if(sections.length)events.push({name:'zoe.guard.section',outcome:'block',reason:sections[0]!,rule:'zoe.app_question',ruleVersion:APP_QUESTION_VERSION,actor:'system',attributes:{'noreon.zoe.guard.name':'section'}});
    return {kind:'held',summary,reasons:[...repeats,...sections],health:h};}
   // The member was told this went to the doctor, in this same matter, and the doctor has not answered since: the doctor still gets it, the
   // line is not repeated. A forward for another reason, or in another topic, says so (Astra MEM-05).
   const forwardShown=fwd.forward==='auto'&&(urgency==='same_day'||urgency==='doctor_soon')&&SAME_MATTER_FORWARD.has(fwd.reason)&&(memory?.said.forwarded??0)>0&&kept.answers.some(a=>autoLine(lang,doctorName,urgency)===a.trim().split('\n').at(-1)?.trim())?'none':fwd.forward;
   // The floor remains same-day; only its already-delivered sentence is omitted.
   const onceOnly=style==='coach-first'&&(savedReadingWarned||statinWarned)||chestSaid()&&!selfHarmModel;
   const fixedWarning=floor==='doctor_soon'&&!selfHarmModel?DOCTOR_SOON_LINE[lang]:style==='coach-first'&&savedReadingFloor&&!floorOf(unanswered.map(m=>m.text),null)?`${SAME_DAY_LINE[lang]}\n${savedReadingLine}`:SAME_DAY_LINE[lang];
   // The coming-days line is for the chest matter (a coming-days result has no fixed sentence) and never sits above a reply the model raised to today.
   const floorLine=!thirdPartyBp&&(floor==='same_day'||floor==='doctor_soon'&&chestMatter()&&urgency==='doctor_soon');
   const composed=composeHealthAnswer((floorLine||selfHarmModel)&&!onceOnly?`${withStatinLine(fixedWarning,lang)}\n\n${reply}`:reply,lang,withhold?'none':forwardShown,doctorName,declined,urgency);
   // Medicines named in chat: the last line, so a yes can read them back. Never at the same-day level, never in a reply that asks anything itself, and never about someone else's tablets.
   const offerable=offerableMedicines(out.medicines_named,{memberTexts:job.messages.map(m=>m.text),listed:[...(job.topic?.profile?.medicines??[]).map(m=>m.name),job.health?.plan?.medicationName??'',...(job.memberRecord?.ldl?.therapies??[]).map(t=>t.name)].filter(x=>x.trim()),earlierAnswers:job.answers.map(a=>a.body)});
   const offered=job.memberRecord?.medicineList&&urgency!=='same_day'&&!/[?՞？]/u.test(reply)&&fwd.forward!=='asked'&&!classifyScope(latest.text).thirdPartyPossible?offerable:[];
   const spoken=fwd.reason==='self_harm'?`${composed}\n\n${CRISIS_LINE_TEXT[urgentLang(lang)]}`:composed;
   const full=spoken;
   // Structure only here: language, length, code. Links and contact details are a hard pattern in the reply check.
   const reasons:string[]=[];
   if(thirdPartyBp&&thirdPartyOwnInstruction(reply))reasons.push('health.third_party_own_instruction');
   // The floor: a fixed answer the reply does not carry goes first; an automatic forward below same-day ends with safe advice unless something already gives it. The judge reads the model's words only.
   const fixedFirst=thirdPartyBp||urgency==='same_day'?[]:guidance.filter(g=>!guidanceSaid(g,reply)&&!floorSkips(g,urgency,latest.text)).map(g=>GUIDANCE_LINES[g][lang]);
   const interim=fwd.forward==='auto'&&urgency!=='same_day'&&fwd.reason!=='self_harm'&&fwd.reason!=='self_sourced_medicine'&&!selfSourced&&!statinSideEffect(urgency)&&!hasInterim(`${fixedFirst.join(' ')} ${full}`)&&interimFits(memberTexts)?INTERIM_LINE[lang]:'';
   // The honest line about the doctor follows the advice, and the medicine question stays the very last line, so a yes can read it back.
   const sent=[fixedFirst.join('\n'),full,interim,withhold&&!thirdPartyBp?WITHHOLD_LINE[lang]:'',offered.length?medicineAskLine(lang,offered):''].filter(Boolean).join('\n\n');
   if(out.language!==lang)reasons.push('health.wrong_language');
   if(sent.length>HEALTH_ANSWER_MAX_CHARS)reasons.push('health.length');
   const pv=patternVerdict('draft',reply,ctx);
   for(const c of pv.categories)if(c==='wrong_language'||c==='code')reasons.push(`health.${c}`);
   if(RAW_REPLY_JSON.test(reply))reasons.push('health.raw_json');
   if(messageBmi&&!bmiReplyHasValue(reply,messageBmi))reasons.push('health.missing_computed_bmi');
   // A summary states nothing nobody said; a promise of secrecy is never true here. Each is held like any text: one regenerate, then the careful line.
   if(summaryAsk&&inventedNegatives(reply,[...job.messages.map(m=>m.text),healthDataBlock(modelHealth),healthSummaryBlock(job.topic?.profile),...questionnaireAnswers(job.memberRecord?.questionnaire)]).length)reasons.push('health.invented_negative');
   if(withhold&&promisesSecrecy(reply))reasons.push('health.secrecy_promise');
   events.push({name:'zoe.guard.output_health',outcome:reasons.length?'block':'allow',reason:reasons.length?'blocked_category_matched':'no_category_matched',rule:'zoe.output_guard',ruleVersion:OUTPUT_GUARD_VERSION,actor:'system',
    attributes:{'noreon.zoe.guard.name':'output_health','noreon.zoe.guard.field':'health','noreon.zoe.guard.categories':(reasons.join(',')||'none').slice(0,128)}});
   if(reasons.length)return {kind:'held',summary,reasons,health:h};
   // A reply that asks for what the record already holds gets one regenerate with the reason; the second text goes on to the judge
   // whatever it asks. Never on a same-day answer, which must not wait, and only with time left for it.
   // Armen 544: never "no medications on record" when that is not true: not with one on the list or the plan, and not right after the member named one.
   const noneClaim=saysNoMedicines(reply)&&(!!job.topic?.profile?.medicines.length||!!job.health?.plan?.medicationName.trim()||job.messages.some(m=>namesDrug(m.text))||offerable.length>0)?['medicine_list' as const]:[];
   const known=heldAskDone||urgency==='same_day'?[]:[...asksForHeldData(reply,{health:job.health&&{...job.health,labs:job.health.labs.filter(l=>l.reviewed)},record:job.memberRecord,medicines:job.topic?.profile?.medicines,memberTexts:job.messages.map(m=>m.text)}),...noneClaim];
   if(known.length&&!late('known_data_regenerate')){heldAskDone=true;
    events.push({name:'zoe.health_answer.asks_known_data',outcome:'recorded',reason:'reply_asks_for_held_data',rule:'zoe.member_record',ruleVersion:MEMBER_RECORD_VERSION,actor:'system',attributes:{'noreon.zoe.health_answer.asks_known_data':known.join(',')}});
    return {kind:'held',summary,reasons:known.map(k=>`known_data.${k}`),health:h};}
   // Coach-first, below same-day: the judge reads Zoe's words without the app's own forward line (it held 8 of 545 eval turns
   // as a "claim" about the doctor, a line that is true), and a judge outage gets its one retry.
   // Same-day too (conversation suite: 4 replay turns held for the app's own line): the app's sentence stays in what it reads, the forward line does not.
   const quiet=style==='coach-first'&&urgency!=='same_day';
   const noForwardLine=composeHealthAnswer(floorLine&&!onceOnly?`${fixedWarning}\n\n${reply}`:reply,lang,'none',doctorName);
   const rc=await replyCheck(sp,reply,style==='coach-first'?(fwd.reason==='self_harm'?`${noForwardLine}\n\n${CRISIS_LINE_TEXT[urgentLang(lang)]}`:noForwardLine):spoken,lang,job.messages.map(m=>m.text),'health',judgeContext(reply),quiet);
   judgeUsage={inputTokens:judgeUsage.inputTokens+rc.usage.inputTokens,outputTokens:judgeUsage.outputTokens+rc.usage.outputTokens};judgeCost+=rc.costUsd;judgeMs+=rc.latencyMs;
   if(!rc.ok){if(rc.reasons.includes('judge.urgency_understated'))understated='same_day';return {kind:'held',summary,reasons:rc.reasons,health:h};}
   return {kind:'send',full:sent,summary,health:h};
  };
  let v=await vet(result.raw);
  // One regenerate when the text was held for its words (lead 20:11), never after a judge outage: the model is told
  // which rule codes held it, and the new text goes through every check again.
  // A hold for repeating and a safety hold have one regenerate each, in either order (Astra MEM-03). A repeat never ends in the careful line.
  let lastRaw=result.raw,safetyRegenerated=false;
  while(v.kind==='held'){
   const held=v,soft=held.reasons.every(r=>/^(?:repeat|section)\./u.test(r)),placed=held.reasons.some(r=>r.startsWith('section.'));
   const stop=held.reasons.some(r=>/^judge\.(?:unavailable|malformed|timeout|server_error|rate_limited|refusal)$/u.test(r))||!soft&&safetyRegenerated||late('health_regenerate');
   // Out of time on a repeat: the text goes on as it is, through the rest of the checks.
   if(stop&&soft){v=await vet(lastRaw);break;}
   if(stop)break;
   if(!soft)safetyRegenerated=true;
   const feedback=soft?`<previous_reply_held>Your previous reply was not sent: ${placed?'it sends the member to a section that does not exist in this app. Everything happens here in this chat, as the app facts say; answer here. ':''}${held.reasons.some(r=>r.startsWith('repeat.'))?`it repeats what you already told this member (${held.reasons.join(', ').slice(0,120)}). Write only what is new and what they asked, as <conversation_memory> says. `:''}Keep the same urgency level.</previous_reply_held>`
    :`<previous_reply_held>Your previous reply was not sent; the safety check found: ${held.reasons.join(', ').slice(0,200)}. ${held.reasons.some(r=>r.startsWith('known_data.'))?'The member\'s data above already holds this: use it and do not ask for it. ':''}${held.reasons.includes('known_data.medicine_list')?'The member has named a medicine or has one on record: do not say their list is empty. ':''}${held.reasons.includes('health.invented_negative')?'Write only what was said or recorded; leave out what is not there. ':''}${held.reasons.includes('health.missing_computed_bmi')?'State the BMI in <computed_from_message>, the height and weight used, and the usual adult range, then answer every other reading or value in one short line each. ':''}Write the reply again, keeping every rule.</previous_reply_held>`;
   const again=await call(sp,PROVIDER_ATTEMPTS+3,route.fallbackUsed,feedback);
   // A repeat is never worth the careful line: when its regenerate fails, the held text goes on through the other checks (Astra MEM-03).
   if(again.kind!=='ok'){if(soft)v=await vet(lastRaw);break;}
   // Astra round 3: a malformed regeneration keeps the held answer's safety metadata (urgency, self_harm) for the careful path.
   const next=await vet(again.raw);
   if(next.kind==='schema'){if(soft)v=await vet(lastRaw);break;}
   lastRaw=again.raw;v=next;
   sealed=seal({memberBlock:block2,response:redactText(again.raw,{nameTokens:own}).text});
  }
  // The held-data regenerate did not happen or did not hold: the first text was never judged unsafe, so it goes on to the judge (Astra ZMR-01).
  if(v.kind==='held'&&v.reasons.every(r=>r.startsWith('known_data.')))v=await vet(result.raw);
  if(v.kind==='schema'){await settleSummaries();return careful('health_answer_schema_invalid',{...checked(),sealed,guardReasons:['schema_invalid']});}
  // The second check (urgent-check.ts; Armen and Khikar 20 Oct): a model-only emergency (no fixed list or red flag got here)
  // goes out only when a short check by the medium tier's model confirms it. Not confirmed: Zoe answers at the confirmed level
  // (one regenerate with the check's level as its minimum; still an emergency, held or late: the careful line at that level).
  // A missing checker, a failed or malformed check, or no time left confirms it (fail safe).
  if(v.kind==='urgent'){
   const started=now();let verdict=readUrgencyVerdict(null),why='no_checker',r:ProviderResult|null=null;
   alertAlreadyGiven=alertAlreadyGivenCheck();
   // Help already called or arrived (helpReached): no second check; Zoe answers at same day at least (the doctor is told), never the 103 text again.
   if(helpReached){verdict={...verdict,confirmed:false,urgency:'same_day'};why='help_reached';}
   else if(alertAlreadyGiven){verdict={...verdict,confirmed:false,urgency:'none'};why='alert_already_given';}
   else if(checker&&!late('urgency_check')){
    try{r=await checker.complete({timeoutMs:Math.max(MIN_CALL_MS,Math.min(URGENCY_CHECK_TIMEOUT_MS,left()-JUDGE_MIN_MS)),purpose:'urgency_check',promptVersion:URGENT_CHECK_VERSION,system:URGENCY_CHECK_PROMPT,memberBlock:urgencyBlock(),replyLanguage:lang,maxOutputTokens:URGENCY_CHECK_MAX_OUTPUT_TOKENS});}
    catch{r={kind:'error',errorClass:'unavailable',usage:null};}
    verdict=readUrgencyVerdict(r.kind==='ok'?r.raw:null);why=r.kind!=='ok'?`check_${r.kind==='error'?r.errorClass:'refusal'}`:verdict.malformed?'check_malformed':verdict.confirmed?'confirmed':'not_confirmed';
    const u=r.usage??{inputTokens:0,outputTokens:0},ms=Math.round(now()-started),cost=costUsd(checker.pricing,r.usage??urgencyTokens);
    usage.inputTokens+=u.inputTokens;usage.outputTokens+=u.outputTokens;spentUsd+=cost;latencyMs+=ms;
    events.push({name:'zoe.provider.call',outcome:r.kind==='ok'?'allow':r.kind==='refusal'?'block':'failed',reason:r.kind==='ok'?'completed':r.kind==='refusal'?'provider_refusal':`provider_${r.errorClass}`,
     rule:'zoe.provider',ruleVersion:URGENT_CHECK_VERSION,actor:'ai',attributes:{'gen_ai.operation.name':'chat','gen_ai.provider.name':checker.providerName,'gen_ai.request.model':checker.requestModel,'gen_ai.request.max_tokens':URGENCY_CHECK_MAX_OUTPUT_TOKENS,
      ...(r.kind!=='error'?{'gen_ai.response.model':r.responseModel,'gen_ai.response.id':r.responseId,'gen_ai.response.finish_reasons':r.finishReason}:{'error.type':r.errorClass}),
      'gen_ai.usage.input_tokens':u.inputTokens,'gen_ai.usage.output_tokens':u.outputTokens,'noreon.zoe.purpose':'urgency_check','noreon.zoe.latency_ms':ms,'noreon.zoe.cost_usd':cost,'noreon.zoe.region':checker.region,'noreon.zoe.tier':decision.tier}});
   }else if(checker)why='check_skipped_time_budget';
   events.push({name:'zoe.health_answer.urgency_check',outcome:verdict.confirmed?'escalate':'allow',reason:why,rule:'zoe.urgent_check',ruleVersion:URGENT_CHECK_VERSION,actor:alertAlreadyGiven||verdict.malformed?'system':'ai',
    attributes:{'noreon.zoe.urgency_check.confirmed':verdict.confirmed,'noreon.zoe.urgency_check.level':verdict.urgency,'gen_ai.request.model':checker?.requestModel??'none'}});
   if(!verdict.confirmed){
    const level=atLeast(verdict.urgency,floorNow());
    if(style==='coach-first')setStyle('coach');
    await settleSummaries();
    const notConfirmed=(reason:string,extra:Partial<FinishInput>={})=>careful(reason,{...checked(),sealed,...extra,health:{urgency:level,modelUrgency:'emergency',forward:'auto',forwardReason:'zoe_could_not_answer'}},unansweredOnly);
    if(late('urgency_check_regenerate'))return notConfirmed('health_answer_emergency_not_confirmed');
    // After an alert with no new sign the rewrite sees the member's words and the note, not Zoe's own 103 text it would answer again;
    // one more attempt when the first still came back as an emergency, held or empty (the careful line stays the last resort).
    const rewrite=async(more:string,view?:string)=>{
     const again=await call(sp,PROVIDER_ATTEMPTS+4,route.fallbackUsed,helpReached?HELP_REACHED_NOTE:unansweredOnly?`${ALERT_ALREADY_GIVEN_NOTE}\n${notConfirmedNote(level)}${more}`:notConfirmedNote(level),alertAlreadyGiven?view:undefined);
     if(again.kind!=='ok')return {again,v2:null};
     sealed=seal({memberBlock:block2,response:redactText(again.raw,{nameTokens:own}).text});
     return {again,v2:await vet(again.raw,{floor:level,noEmergency:true})};
    };
    let tried=await rewrite('');
    if(alertAlreadyGiven&&(!tried.v2||tried.v2.kind!=='send')&&tried.v2?.kind!=='schema'&&!late('urgency_check_regenerate'))tried=await rewrite('\n<previous_reply_held>Your previous reply was not sent. Answer only the newest question, in plain words, without any 103 or emergency wording.</previous_reply_held>',
     `${block(redacted.filter(m=>unanswered.some(u=>u.seq===m.seq)).map(m=>({seq:m.seq,text:m.r.text,minutesAgo:m.minutesAgo})),[],[])}\n<alert_already_given>The member's earlier concern was already handled with the 103 advice. Answer only these messages.</alert_already_given>`);
    const v2=tried.v2;
    if(!v2)return notConfirmed('health_answer_emergency_not_confirmed');
    if(v2.kind==='schema'){await settleSummaries();return notConfirmed('health_answer_emergency_not_confirmed',{guardReasons:['schema_invalid']});}
    const summary2=await v2.summary();await settleSummaries();
    if(v2.kind!=='send')return notConfirmed('health_answer_emergency_not_confirmed',{summary:summary2,guardReasons:v2.kind==='held'?v2.reasons:[]});
    return finish('answered','health_answer_emergency_not_confirmed',{...checked(),sealed,summary:summary2,answer:v2.full,language:lang,health:{...v2.health,modelUrgency:'emergency'},receipt:null});
   }
   // The 103 text must not wait for a slow summary: at most URGENT_SUMMARY_WAIT_MS, then the marker.
   const marker=renderDoctorSummary({asked:SUMMARY_UNAVAILABLE},'emergency','auto',v.health.forwardReason);
   let timer:ReturnType<typeof setTimeout>|undefined;
   const summary=speed.split?await Promise.race([v.summary(),new Promise<string>(res=>{timer=setTimeout(()=>res(marker),URGENT_SUMMARY_WAIT_MS);})]).finally(()=>clearTimeout(timer)):await v.summary();
   await settleSummaries();
   return finish('discarded','urgent_health_answer_model',{...checked(),sealed,summary,answer:crisisWording(true)?crisisText(urgentLang(lang)):urgentText(urgentLang(lang)),language:urgentLang(lang),receipt:null,health:v.health});
  }
  // The summary first, then the totals (ZS-01: a summary slower than the judge is counted).
  const summary=await v.summary();await settleSummaries();
  if(v.kind==='held')return careful(v.reasons.some(r=>r.startsWith('health.'))?'health_answer_blocked_by_guard':'health_answer_blocked_by_reply_check',
   {...checked(),sealed,summary,guardReasons:v.reasons,health:{...v.health,forward:'auto',forwardReason:v.health.forwardReason==='self_harm'||pde5Nitrate&&v.reasons.every(r=>r==='health.pde5_nitrate_missing_warning')?v.health.forwardReason:'zoe_could_not_answer'}});
  return finish('answered','health_answer_passed_guards',{...checked(),sealed,summary,answer:v.full,language:lang,health:v.health,receipt:null});
 };

 if(doctorCheck&&(!provider||injectionSeen))return holdForDoctor('doctor_mode_no_model_call');
 // 4. Provider availability and spend (K7). The database decides; a real provider is refused there.
 // Free mode with no provider still answers with the warm line that keeps a known urgency (Astra round 2, ZH-03).
 if(!provider&&freeMode&&!throttle&&!injectionSeen){
  // N3: the route decision is recorded on the no-provider path too (the careful line follows).
  events.push({name:'zoe.route.health_answer',outcome:'allow',reason:'free_mode_no_provider',rule:'zoe.health_answer',ruleVersion:HEALTH_ANSWER_VERSION,actor:'system',attributes:{'noreon.zoe.guard.name':'health_answer','noreon.zoe.health_answer.allowed':true}});
  return healthTurn(null,null);
 }
 // Keep the doctor's request and danger-sign answers in healthTurn ahead of the member-cap exit.
 if(throttle==='member_spend_cap_reached'&&!injectionSeen)return freeMode?healthTurn(null,null):memberSpendCap(replyLanguage,{redactionCount:count});
 if(!provider)return finish('no_output','provider_unavailable',{redactionCount:count});
 if(throttle)return finish('no_output',throttle,{redactionCount:count});
 // A suspected injection in the newest message or in an earlier message that has not been answered yet (Codex review F2): summary only. One that already got its reply is out of the
 // model's window (modelJob) and no longer decides the purpose.
 const purpose=injectionSeen?'summary_only':'intake_draft';
 // 4a. Free mode (health-answer.ts): everything that got this far (no urgent words, no red flag, no intake turn, no
 // injection) is answered by Zoe herself. Off: the paths below exactly as before.
 events.push({name:'zoe.route.health_answer',outcome:freeMode&&purpose==='intake_draft'?'allow':'skipped',reason:!freeMode?(job.healthAnswers===true&&job.intake?.enabled!==true?'symptom_red_flags_off':'health_answers_off'):purpose!=='intake_draft'?'injection_suspected':'free_mode',
  rule:'zoe.health_answer',ruleVersion:HEALTH_ANSWER_VERSION,actor:'system',attributes:{'noreon.zoe.guard.name':'health_answer','noreon.zoe.health_answer.allowed':freeMode&&purpose==='intake_draft'}});
 if(freeMode&&purpose==='intake_draft')return healthTurn(provider!,fallback);
 // Direct answers: decided here by fixed rules, before any model is called; the model can only decline.
 const onlyLow=decision.rules.length>0&&decision.rules.every(id=>id==='logistics'||id==='app_help');
 if(dflags.effects)await lateDecisions();
 const directAllowed=deps.directAnswers===true&&job.directAnswers&&purpose==='intake_draft'&&decision.tier==='low'&&decision.unsure.length===0&&onlyLow&&!scope.thirdPartyPossible;
 events.push({name:'zoe.route.direct_answer',outcome:directAllowed?'allow':'skipped',reason:directAllowed?'low_tier_logistics_only':!job.directAnswers||deps.directAnswers!==true?'direct_answers_off':decision.tier!=='low'||!onlyLow?'not_logistics':'route_unsure',
  rule:'zoe.direct_answer',ruleVersion:ROUTING_VERSION,actor:'system',attributes:{'noreon.zoe.guard.name':'direct_answer','noreon.zoe.direct_answer.allowed':directAllowed}});
 // Structured reply drafts: a second, small call for a health question that goes to the doctor (reply-draft.ts).
 const rd=job.replyDraft?.enabled&&deps.ports.recordReplyDraft&&purpose==='intake_draft'&&!directAllowed?job.replyDraft:null;
 const rdItems=rd?planItems(rd.plan):[];
 // The model's copy of the plan is redacted like the messages; the quotes in the draft come from rdItems, unredacted, by code.
 const rdBlock=rd?`${memberBlock}\n${planBlock(rdItems.map(i=>({...i,text:redactText(i.text,{nameTokens:own}).text})))}`:'';
 const system=systemPrompt(chatV2);
 const callTokens={inputTokens:approxTokens(system)+approxTokens(memberBlock)+(rd?approxTokens(REPLY_DRAFT_SYSTEM_PROMPT)+approxTokens(rdBlock):0),outputTokens:MAX_OUTPUT_TOKENS};
 // The reservation covers whichever of the two models costs more; it is local only when both are. The reply-draft call is one more attempt.
 const b=budget(provider,fallback,callTokens,rd?2:1,directAllowed?ANSWER_MAX_CHARS:null);
 const reserved=await deps.ports.reserve(job.runId,b.estimate,b.local,takeEvents(),{tier:decision.tier,model:provider.requestModel,judgeModel:b.judgeModel});
 if(!reserved.ok)return reserved.code==='member_spend_cap_reached'?memberSpendCap(replyLanguage,{redactionCount:count}):finish('no_output',reserved.code,{redactionCount:count});
 shadowDecisions(b.local);
 if(rd?.plan)whySeen=seen({planPublishedAt:rd.plan.publishedAt});

 // 5. Provider call, bounded retries on transient errors; a refusal is final (K03). If the tier
 // model still fails, its fallback gets one call.
 let result:ProviderResult|null=null,latencyMs=0,spentUsd=0;const usage={inputTokens:0,outputTokens:0};
 const call=async(p:ZoeProvider,attempt:number,isFallback:boolean,draft=false)=>{
  const started=now();let r:ProviderResult;
  whyPrompt=draft?REPLY_DRAFT_PROMPT_VERSION:PROMPT_VERSION;
  try{r=await p.complete(draft?{timeoutMs:callTimeout(),purpose:'reply_draft',promptVersion:REPLY_DRAFT_PROMPT_VERSION,system:REPLY_DRAFT_SYSTEM_PROMPT,memberBlock:rdBlock,replyLanguage,maxOutputTokens:MAX_OUTPUT_TOKENS}
   :{timeoutMs:callTimeout(),purpose,promptVersion:PROMPT_VERSION,system,memberBlock,replyLanguage,maxOutputTokens:MAX_OUTPUT_TOKENS,directAnswerAllowed:directAllowed});}
  catch{r={kind:'error',errorClass:'unavailable',usage:null};}
  const ms=Math.round(now()-started);latencyMs+=ms;
  const u=r.usage??{inputTokens:0,outputTokens:0};usage.inputTokens+=u.inputTokens;usage.outputTokens+=u.outputTokens;
  const cost=costUsd(p.pricing,r.usage??callTokens);spentUsd+=cost;
  events.push({name:'zoe.provider.call',outcome:r.kind==='ok'?'allow':r.kind==='refusal'?'block':'failed',reason:r.kind==='ok'?'completed':r.kind==='refusal'?'provider_refusal':`provider_${r.errorClass}`,
   rule:'zoe.provider',ruleVersion:PROMPT_VERSION,actor:'ai',attributes:{
    'gen_ai.operation.name':'chat','gen_ai.provider.name':p.providerName,'gen_ai.request.model':p.requestModel,'gen_ai.request.max_tokens':MAX_OUTPUT_TOKENS,
    ...(r.kind!=='error'?{'gen_ai.response.model':r.responseModel,'gen_ai.response.id':r.responseId,'gen_ai.response.finish_reasons':r.finishReason}:{'error.type':r.errorClass}),
    'gen_ai.usage.input_tokens':u.inputTokens,'gen_ai.usage.output_tokens':u.outputTokens,
    'noreon.zoe.purpose':draft?'reply_draft':purpose,'noreon.zoe.attempt':attempt,'noreon.zoe.latency_ms':ms,'noreon.zoe.cost_usd':cost,'noreon.zoe.region':p.region,
    'noreon.zoe.tier':decision.tier,'noreon.zoe.fallback_used':isFallback,'noreon.zoe.config_version':ZOE_CONFIG_VERSION.slice(0,128)}});
  return r;
 };
 for(let attempt=1;attempt<=PROVIDER_ATTEMPTS;attempt++){
  if(late('provider_attempt'))break;
  result=await call(provider,attempt,false);
  if(result.kind!=='error'||result.errorClass==='rate_limited')break;
 }
 if(fallback&&result?.kind==='error'&&!late('provider_fallback')){
  provider=fallback;route.fallbackUsed=true;
  result=await call(fallback,PROVIDER_ATTEMPTS+1,true);
 }
 // Totals at the moment of each return, so the schema retry's cost is never dropped (Codex RJ-3).
 const common=()=>({redactionCount:count,usage,costUsd:spentUsd,latencyMs});
 if(!result||result.kind==='error')return finish('no_output',`provider_${result?.errorClass??'unavailable'}`,{...common(),sealed:seal({memberBlock,response:null})});
 if(result.kind==='refusal')return finish('no_output','provider_refusal',{...common(),sealed:seal({memberBlock,response:null})});

 // One retry on the same model when the output is not valid JSON of the schema (QA 18 Oct: logistics fell to the doctor line).
 if(guardDraftOutput(result.raw,{memberTexts:[],replyLanguage},{draftsAllowed:true}).schema==='invalid'&&!late('schema_retry')){const again=await call(provider,PROVIDER_ATTEMPTS+2,route.fallbackUsed);if(again.kind==='ok')result=again;}
 // 6. Output guards. The raw response is stored only in redacted, sealed form.
 const memberTexts=[...job.messages.map(m=>m.text),...redacted.map(m=>m.r.text)];
 const verdict=guardDraftOutput(result.raw,{memberTexts,replyLanguage},{draftsAllowed:purpose==='intake_draft',directAllowed});
 const sealed=seal({memberBlock,response:redactText(result.raw,{nameTokens:own}).text});
 events.push({name:'zoe.guard.output_schema',outcome:verdict.schema==='valid'?'allow':'block',reason:verdict.schema==='valid'?'schema_valid':'schema_invalid',rule:'zoe.output_schema',ruleVersion:OUTPUT_GUARD_VERSION,actor:'system',attributes:{'noreon.zoe.guard.name':'output_schema'}});
 if(verdict.schema==='invalid')return finish('no_output','schema_invalid',{...common(),sealed,guardReasons:verdict.reasons});
 for(const v of [verdict.summary!,...verdict.missingInfo,...(verdict.draft?[verdict.draft]:[]),...(verdict.answer?[verdict.answer]:[])])events.push(guardEvent(v));
 const summary=verdict.summaryForDoctor;
 if(verdict.answerForMember&&summary){
  const rc=await replyCheck(provider,verdict.answerForMember,verdict.answerForMember,replyLanguage,job.messages.map(m=>m.text),'answer');
  usage.inputTokens+=rc.usage.inputTokens;usage.outputTokens+=rc.usage.outputTokens;
  const checked={...common(),costUsd:spentUsd+rc.costUsd,latencyMs:latencyMs+rc.latencyMs};
  if(!rc.ok)return finish('summary_only','direct_answer_blocked_by_reply_check',{...checked,sealed,summary,guardReasons:[...verdict.reasons,...rc.reasons]});
  return finish('answered','direct_answer_passed_guards',{...checked,sealed,summary,answer:verdict.answerForMember,language:replyLanguage,guardReasons:verdict.reasons});
 }
 // A direct answer that was not allowed or failed a guard is never sent: the doctor gets the summary.
 if(verdict.output?.direct_answer&&!verdict.draftForDoctor&&summary)return finish('summary_only',directAllowed?'direct_answer_blocked_by_guard':'direct_answer_not_allowed',{...common(),sealed,summary,guardReasons:verdict.reasons});
 // A health question for the doctor: the structured draft, when it passes, replaces the free draft (or the lack of one).
 const toDoctor=!!summary&&!verdict.answerForMember&&!verdict.output?.direct_answer&&(!!verdict.draftForDoctor||verdict.draft?.outcome==='block'
  ||verdict.output?.no_draft_reason_code==='needs_doctor'||verdict.output?.no_draft_reason_code==='insufficient_information');
 if(rd&&toDoctor&&!late('reply_draft')){
  const r=await call(provider,PROVIDER_ATTEMPTS+3,route.fallbackUsed,true);
  const assembled=r.kind==='ok'?assembleReplyDraft(r.raw,{items:rdItems,plan:rd.plan,replyLanguage,memberTexts,guard:{memberTexts,replyLanguage}}):{ok:false as const,reasons:[r.kind==='refusal'?'reply_draft.provider_refusal':`reply_draft.provider_${r.errorClass}`]};
  // A low-tier question (logistics, the app) keeps the free draft unless the structured one quotes the plan ("When are my next tests?").
  const useful=assembled.ok&&(decision.tier!=='low'||assembled.record.quoted.length>0);
  const stored=assembled.ok&&useful?await deps.ports.recordReplyDraft!(job.runId,assembled.record).catch(()=>({ok:false})):null;
  events.push({name:'zoe.reply_draft',outcome:assembled.ok&&stored?.ok?'allow':'block',reason:!assembled.ok?assembled.reasons[0]!.slice(0,80):!useful?'reply_draft.low_tier_no_plan_item':stored?.ok?'structured_draft_passed_guards':'reply_draft.not_recorded',rule:'zoe.reply_draft',ruleVersion:REPLY_DRAFT_VERSION,actor:'system',
   attributes:{'noreon.zoe.guard.name':'reply_draft','noreon.zoe.reply_draft.reasons':assembled.ok?'none':assembled.reasons.join(',').slice(0,128),'noreon.zoe.reply_draft.items':assembled.ok?assembled.record.quoted.length:0,
    'noreon.zoe.reply_draft.needs_judgement':assembled.ok?assembled.record.needsJudgement:true,'noreon.zoe.reply_draft.acknowledgement':assembled.ok?assembled.record.acknowledgementId:'none','noreon.zoe.reply_draft.plan':rd.plan?'published':'none'}});
  const sealedBoth=r.kind==='ok'?deps.seal({memberBlock:rdBlock,response:`${redactText(result.raw,{nameTokens:own}).text}\n<reply_draft_response>\n${redactText(r.raw,{nameTokens:own}).text}`}):sealed;
  if(assembled.ok&&stored?.ok)return finish('draft_proposed','structured_draft_passed_guards',{...common(),sealed:sealedBoth,summary,draft:assembled.body,guardReasons:verdict.reasons});
 }
 if(verdict.draftForDoctor&&summary)return finish('draft_proposed','draft_passed_guards',{...common(),sealed,summary,draft:verdict.draftForDoctor,guardReasons:verdict.reasons});
 if(!summary)return finish('no_output','summary_blocked',{...common(),sealed,guardReasons:verdict.reasons});
 if(verdict.draft?.outcome==='block')return finish('draft_blocked','draft_discarded_by_guard',{...common(),sealed,summary,guardReasons:verdict.reasons});
 return finish('summary_only',purpose==='summary_only'?'injection_suspected_summary_only':`no_draft_${verdict.output?.no_draft_reason_code??'given'}`,{...common(),sealed,summary,guardReasons:verdict.reasons});
}
