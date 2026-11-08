import {memberDocumentSchema} from '@/lib/doctor-completion/document-schema';
import {nextStepSnapshot,testsNeededSnapshot} from './next-step';
import {z} from 'zod';
import {memberLdlSchema} from '@/lib/ldl/schema';
import {careQueueMemberTaskSchema} from '@/lib/care-queue/contracts';
import {documentSnapshot,labAppointmentSnapshot,symptomGateSnapshot,consultQuestionsSnapshot} from './labs-contract';
import {planDetailsSchema} from './plan';
import {EVERYDAY_VIEWS} from './everyday-contract';
import {livingVisitSnapshot} from './living-visit';
import {caregiverCardSnapshot} from '@/lib/caregivers/schema';
import {consentsCardSnapshot} from '@/lib/consents/schema';
export {findLivingVisit} from './living-visit';

/**
 * Zoe chat action cards (founders, 29 Oct 2026: chat-first). The member's common tasks as cards Zoe posts in the
 * thread, each reusing the feature's own server action and permissions. The pages stay the record and the accessible
 * route; a card links to its page ("See current") until it moves to "Show current in chat", which posts a fresh card.
 *
 * A card is an immutable snapshot of what the member saw when it was posted (zoe_chat_cards, Fable report 2.4b), and
 * what they did on it is recorded once per item. Pure: shared by the server and the client.
 *
 * Adding a card (the LDL goal card from the ldl-goal lane): add the kind to CARD_KINDS and SNAPSHOTS here, its chip
 * and copy in copy.ts, a snapshot builder in server.ts, a renderer in components/patient/zoe-cards, optional intent
 * words in intent.ts, and the kind to the zoe_chat_cards check in a new migration.
 */
export const CARD_KINDS=['dose','bp','results','plan','visit','side_effect','message','ldl','ask','menu','medicines','account','repeat','red_flags','profile','document','prep','fasting','symptom_gate','consult_questions','sams','next_step','tests_needed','review','caregiver','consents']as const;
export type CardKind=typeof CARD_KINDS[number];
/** App-only PR 7 blocks; hidden from classic reads when V3 is off. */
export const V3_LAB_CARD_KINDS:readonly CardKind[]=['document','prep','fasting','symptom_gate','consult_questions'];
/** App-only continuation blocks, hidden when V3 is off. */
export const V3_NEXT_STEP_KINDS:readonly CardKind[]=['next_step','tests_needed','review'];
/** WP F: the member's caregivers and consents, opened from the menu or typed words in the new chat only (no chip, no Telegram). */
export const MEMBER_SETTINGS_KINDS:readonly CardKind[]=['caregiver','consents'];
/** What the chat's chips open; the menu lists these, it is not one of them. */
export const CHIP_KINDS=CARD_KINDS.filter((k):k is Exclude<CardKind,'menu'|'ask'|'repeat'|'red_flags'|'profile'|'document'|'prep'|'fasting'|'symptom_gate'|'consult_questions'|'sams'|'next_step'|'tests_needed'|'review'|'caregiver'|'consents'>=>k!=='menu'&&k!=='ask'&&k!=='repeat'&&k!=='red_flags'&&k!=='profile'&&k!=='document'&&k!=='prep'&&k!=='fasting'&&k!=='symptom_gate'&&k!=='consult_questions'&&k!=='sams'&&!V3_NEXT_STEP_KINDS.includes(k)&&!MEMBER_SETTINGS_KINDS.includes(k));
/** Posted by the blood pressure flow after a reading, never opened from the browser. */
export const FLOW_KINDS:readonly CardKind[]=['repeat','red_flags','sams'];
export const isCardKind=(v:unknown):v is CardKind=>typeof v==='string'&&(CARD_KINDS as readonly string[]).includes(v);
/** The kinds that also render in Telegram (lib/zoe-chat-actions/telegram.ts); the others stay app cards for now. */
export const TELEGRAM_CARD_KINDS:readonly CardKind[]=['dose','bp','results','plan','ldl','visit','side_effect','message','ask','menu'];
/** The tasks /menu offers on Telegram: one button each, within the limit of eight a card may arm. */
export const TELEGRAM_MENU_KINDS=TELEGRAM_CARD_KINDS.filter(k=>k!=='menu'&&k!=='ask').slice(0,8);
/** What a Telegram button may do; the database's zoe_chat_card_intents check holds the same list. */
export const CARD_BUTTON_ACTIONS=['dose_taken','dose_skipped','bp_save','open_card','show_current','visit_accept','ldl_visit_accept','ask_reason','side_effect_pick']as const;
export type CardButtonAction=typeof CARD_BUTTON_ACTIONS[number];

/** At twelve rows a card, how far "more" goes in the chat. */
export const RESULT_PAGES=20;
const iso=z.string().min(1).max(40);
const text=(max:number)=>z.string().max(max);

export const doseSnapshot=z.strictObject({v:z.literal(1),v3:z.literal(true).optional(),enabled:z.boolean(),date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
 slots:z.array(z.strictObject({medicineId:z.uuid(),name:text(4000),dose:text(4000).nullable(),dueAt:iso,time:z.string().regex(/^\d{2}:\d{2}$/),
  status:z.enum(['taken','skipped','due','upcoming']),revision:z.number().int().min(0),
  // A dose from the published plan, with its plan; absent on a self-reported medicine and on cards from before plan doses.
  planId:z.uuid().optional()})).max(24)});
const bpReading=z.strictObject({systolic:z.number().int(),diastolic:z.number().int(),pulse:z.number().int().nullable(),measuredAt:iso,entrySource:z.enum(['patient_text_entry','patient_voice_confirmed','patient_photo_confirmed','caregiver_reported']).nullable().optional()});
export const bpWeekSlot=z.strictObject({weekId:z.uuid(),date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),slot:z.enum(['morning','evening']),time:z.string().regex(/^\d{2}:\d{2}$/),day:z.number().int().min(1),days:z.number().int().min(1),saved:z.number().int().min(0),expected:z.number().int().min(0)});
const follows=z.strictObject({cardId:z.uuid(),item:z.string().min(1).max(100)});
/** Persisted provenance for follow-up forms, read identically on every device. */
export type BpFlowContext={follows?:z.infer<typeof follows>;week?:z.infer<typeof bpWeekSlot>|null;episodeId?:string};
export const bpSnapshot=z.strictObject({v:z.literal(1),
 // The member's BP week slot due now, when one is: the reading then counts for the week, as on the BP week page.
 week:bpWeekSlot.nullable(),
 // The newest saved reading, so "Show current in chat" shows the record. Absent on older cards and when it could not be read.
 latest:bpReading.nullable().optional(),
 // Numbers the member typed in a message that was only a reading (Telegram has no form): shown back, saved on one press.
 typed:bpReading.optional()});
export const resultsSnapshot=z.strictObject({v:z.literal(1),documents:z.array(memberDocumentSchema).optional(),available:z.boolean(),publishedAt:iso.nullable(),
 rows:z.array(z.strictObject({name:text(160),value:text(200),unit:text(60).nullable(),reference:text(160).nullable(),at:iso.nullable()})).max(12),more:z.number().int().min(0),
 // Which twelve: 0 is the first card, and each "more" posts the next one in the chat. Absent on older cards.
 page:z.number().int().min(0).max(RESULT_PAGES-1).optional(),
 // Past the last page "more" reaches: never dropped quietly, the card counts them.
 older:z.number().int().min(1).optional()});
/** The key one dose slot is claimed and recorded under, on either channel. */
export const doseItem=(slot:{medicineId:string;dueAt:string})=>`dose:${slot.medicineId}:${Date.parse(slot.dueAt)}`;
export const planSnapshot=z.strictObject({v:z.literal(1),available:z.boolean(),v3:planDetailsSchema.nullable().optional(),
 plan:z.strictObject({id:z.uuid(),version:z.number().int().min(1).nullable(),clinician:text(200),publishedAt:iso,instructions:text(4000),
  medicines:z.array(z.strictObject({name:text(200),dose:text(200),times:z.array(z.string().regex(/^\d{2}:\d{2}$/)).max(8)})).max(20),acknowledged:z.boolean().optional()}).nullable()});
const visit=z.strictObject({appointmentId:z.uuid(),revision:z.number().int().min(0),status:z.enum(['notification-pending','confirmed','failed','unknown','reconciliation','cancelled']),
 startsAt:iso,endsAt:iso,mode:z.enum(['home','clinic']),location:text(1000)});
export const visitSnapshot=z.strictObject({v:z.literal(1),available:z.boolean(),living:livingVisitSnapshot.optional(),next:visit.nullable(),bookingToken:z.string().regex(/^[a-f0-9]{64}$/).optional(),
 // A time the clinic proposed, which the member can accept here (answerMemberProposal), as on the visits page.
 proposal:z.strictObject({appointmentId:z.uuid(),proposalId:z.uuid(),startsAt:iso,endsAt:iso,clinicName:text(300),clinicAddress:text(1000)}).nullable(),
 attention:z.boolean()});
export const sideEffectSnapshot=z.strictObject({v:z.literal(1)});
export const messageSnapshot=z.strictObject({v:z.literal(1)});
/** member_ldl_read as it was when posted, so the card says what the goal card on Progress says; data null: it could not be read. */
export const ldlSnapshot=z.strictObject({v:z.literal(1),data:memberLdlSchema.nullable()});
/** Zoe's missed-dose ask, once (it is posted by the press or the sweep that found it, never from a chip). */
export const askSnapshot=z.strictObject({v:z.literal(1),askId:z.uuid(),name:text(4000),dueAt:iso,trigger:z.enum(['skipped','missed']),v3:z.literal(true).optional()});
/** The list of tasks; a notice's own card carries its line and the one task it opens. */
export const menuSnapshot=z.strictObject({v:z.literal(1),line:text(4000).optional(),kinds:z.array(z.enum(CARD_KINDS)).max(8).optional(),
 // A notice about a missed dose: the ask its button opens, on either channel.
 askId:z.uuid().optional(),
 // App-only everyday views reuse this container; old menus and Telegram stay unchanged.
 view:z.enum(EVERYDAY_VIEWS).optional(),token:z.string().regex(/^[a-f0-9]{64}$/).optional()
}).refine(s=>!s.view||!!s.token);

export const settingsSnapshot=z.strictObject({v:z.literal(1),token:z.string().regex(/^[a-f0-9]{64}$/)});

/** The second reading. first: what the member just saved, shown on the card. */
export const repeatSnapshot=z.strictObject({v:z.literal(1),episodeId:z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/).optional(),first:z.strictObject({systolic:z.number().int(),diastolic:z.number().int()}),follows:follows.optional(),week:bpWeekSlot.nullable().optional()});
/** The safety questions for one episode: which readings they belong to, and the task key that episode uses. */
export const redFlagsSnapshot=z.strictObject({v:z.literal(1),episodeId:z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/),readingId:z.uuid().nullable(),readings:z.array(z.strictObject({sbp:z.number().int(),dbp:z.number().int()})).min(1).max(20),follows:follows.optional(),week:bpWeekSlot.nullable().optional()});
/** The communication profile, offered once after consent: the member's current quiet hours as the times they wake and sleep. No caregiver details, here or in the outcome. */
const hhmm=z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const profileSnapshot=z.strictObject({v:z.literal(1),wake:hhmm,sleep:hhmm});

export const SNAPSHOTS={review:z.strictObject({v:z.literal(1)}),next_step:nextStepSnapshot,tests_needed:testsNeededSnapshot,dose:doseSnapshot,bp:bpSnapshot,results:resultsSnapshot,plan:planSnapshot,visit:visitSnapshot,side_effect:sideEffectSnapshot,message:messageSnapshot,ldl:ldlSnapshot,ask:askSnapshot,menu:menuSnapshot,medicines:settingsSnapshot,account:settingsSnapshot,repeat:repeatSnapshot,red_flags:redFlagsSnapshot,profile:profileSnapshot,document:documentSnapshot,prep:labAppointmentSnapshot,fasting:labAppointmentSnapshot,symptom_gate:symptomGateSnapshot,consult_questions:consultQuestionsSnapshot,sams:z.strictObject({v:z.literal(1),episodeId:z.uuid()}),caregiver:caregiverCardSnapshot,consents:consentsCardSnapshot}as const satisfies Record<CardKind,z.ZodType>;
export type Snapshot<K extends CardKind>=z.infer<typeof SNAPSHOTS[K]>;

/** The page that holds the current record for each card ("See current"). */
export const CARD_PAGE:Record<CardKind,string>={review:'/patient/review',next_step:'/patient/chat',tests_needed:'/patient/service',dose:'/patient/medicines',bp:'/patient/measurements',results:'/patient/results',plan:'/patient/care',
 visit:'/patient/service',side_effect:'/patient/zoe',message:'/patient/zoe',ldl:'/patient/progress',ask:'/patient/zoe',menu:'/patient/zoe',medicines:'/patient/medicines',account:'/patient/account',repeat:'/patient/measurements',red_flags:'/patient/zoe',profile:'/patient/account',document:'/patient/progress/earlier',prep:'/patient/service',fasting:'/patient/service',symptom_gate:'/patient/zoe',consult_questions:'/patient/zoe',sams:'/patient/zoe',caregiver:'/patient/chat',consents:'/patient/chat'};

// Not strict: the GET route sends the parsed card back (with its 'valid' mark), and the client parses it again.
const cardBase=z.object({id:z.uuid(),requestId:z.uuid(),source:z.enum(['chip','typed']),sourceSeq:z.number().int().positive().nullable(),
 state:z.enum(['open','done']),outcome:z.record(z.string(),z.unknown()),
 // The operation each item was claimed for, before its write (zoe_chat_card_claim).
 claims:z.record(z.string(),z.strictObject({op:z.uuid(),payload:z.record(z.string(),z.unknown())})).default({}),at:z.string()});
type CardBase=z.infer<typeof cardBase>;
/** A card whose snapshot parsed for its kind; each kind carries its own snapshot type. */
export type ValidCard={[K in CardKind]:CardBase&{kind:K;snapshot:Snapshot<K>;valid:true}}[CardKind];
export type ZoeCard=ValidCard|(CardBase&{kind:string;snapshot:unknown;valid:false});
/** Acceptance belongs to the proposal shown, including receipts written before proposal-specific items. */
export const visitAcceptanceItem=(proposalId:string)=>`accepted:${proposalId}`;
export function visitProposalAccepted(card:Extract<ValidCard,{kind:'visit'}>,proposalId:string){
 return card.outcome[visitAcceptanceItem(proposalId)]!==undefined
  ||(card.outcome.accepted as {proposalId?:unknown}|undefined)?.proposalId===proposalId;
}
/** A stored card; a snapshot that does not parse makes the card unreadable (shown as such), never reinterpreted. */
export const cardSchema=cardBase.extend({kind:z.string(),snapshot:z.unknown()}).transform((c):ZoeCard=>{
 const parsed=isCardKind(c.kind)?SNAPSHOTS[c.kind].safeParse(c.snapshot):null;
 return parsed?.success?{...c,kind:c.kind,snapshot:parsed.data,valid:true}as ValidCard:{...c,valid:false};
});

export const cardsReadSchema=z.union([
 z.strictObject({ok:z.literal(true),enabled:z.literal(false)}),
 z.strictObject({ok:z.literal(true),enabled:z.literal(true),cards:z.array(cardSchema),clearedSeq:z.number().int().positive().nullable(),readingSeq:z.number().int().positive().nullable().default(null)}),
]);
/** clearedSeq: the message any card may open from; readingSeq: the wider rule, for a BP card only (_zoe_chat_reading_cleared). */
export type ZoeCards={visitStatusUnavailable?:boolean;nextStepStatus?:'unavailable'|'waiting';enabled:boolean;cards:ZoeCard[];clearedSeq:number|null;readingSeq?:number|null;
 /** The last explicit doctor/member clear. An empty emergency page never implies a clear. */emergencyClearedAt?:string|null;
 /** The member's care queue tasks for the status chip. Only read with V3 on. */tasks?:z.infer<typeof careQueueMemberTaskSchema>[]};
/** The GET route's answer (readZoeCards), parsed again on the client. */
export const zoeCardsSchema=z.object({visitStatusUnavailable:z.boolean().optional(),nextStepStatus:z.enum(['unavailable','waiting']).optional(),enabled:z.boolean(),cards:z.array(cardSchema),clearedSeq:z.number().int().positive().nullable(),readingSeq:z.number().int().positive().nullable().optional(),tasks:z.array(careQueueMemberTaskSchema).optional(),emergencyClearedAt:z.string().nullable().optional()});
export const NO_CARDS:ZoeCards=Object.freeze({enabled:false,cards:[],clearedSeq:null});

/** What a card action returns to the screen. 'stale': the record changed since the card was posted; see current. */
export const urgentHoldResult=z.strictObject({status:z.literal('held_urgent'),call103:z.boolean()});
export type CardActionResult=
 |(z.infer<typeof urgentHoldResult>&{card?:never})
 |{status:'ok';card:ZoeCard;
  /** The card the blood pressure flow posted next, so it shows without waiting for a poll. */next?:ZoeCard}
 |{status:'busy'|'stale'|'invalid'|'unavailable'|'disabled'|'rate_limited'|'not_cleared'|'failed'|'closed'|'signed_out';card?:ZoeCard};
