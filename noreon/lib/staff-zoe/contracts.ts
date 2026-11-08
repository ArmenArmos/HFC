import {z} from 'zod';
import {doctorUploadOverrideSchema} from '@/lib/staff/doctor-upload-overrides';
import type {Locale} from '@/lib/locale';

/**
 * Doctor Zoe (phase 1B). The shapes every part agrees on. Read-only: a tool reads, code builds the facts and the
 * cards from what it read, and the model only chooses which facts answer the question. The model never writes a fact,
 * a card, a line or a date. Unknown stays "not known": a tool with nothing recorded returns no facts and says why.
 */
export const STAFF_ZOE_VERSION='staff-zoe-1';
export const STAFF_ZOE_PROMPT_VERSION='staff-zoe-prompt-6';

/** The fixed decline line, en, hy, ru. */
export const DECLINED=['I read the record. Causes, tests, medicines, doses and clearance are yours to decide.','Ես կարդում եմ գրառումը։ Պատճառները, թեստերը, դեղերը, դեղաչափերը և թույլտվությունը դուք եք որոշում։','Я читаю запись. Причины, анализы, препараты, дозы и допуск решаете вы.']as const;

export const MODEL_TOOLS=['overview','bp','labs','ldl','plan','adherence','open_items','visits','member_messages','zoe_why']as const;
/**
 * Every read. lipid_plan is a card for the doctor and nothing else: it comes with the LDL record, code writes it, and it is
 * never in the prompt, the model's record or `need`, so unsigned rules and their dates cannot reach a model.
 */
export const TOOLS=[...MODEL_TOOLS,'lipid_plan']as const;
export type ToolId=typeof TOOLS[number];
export type StaffZoeRole='doctor'|'nurse';
/** Same lists as _staff_zoe_tool_allowed, which is the enforcement. A nurse reads what the nurse's own pages show. */
export const ROLE_TOOLS:Readonly<Record<StaffZoeRole,readonly ToolId[]>>={
 doctor:MODEL_TOOLS,
 nurse:['overview','bp','plan','adherence','open_items','visits','member_messages'],
};
/** Doctor summaries include attributed conversation quotes as evidence. Saved Zoe rationale is read only when asked for. */
export const SUMMARY_TOOLS:readonly ToolId[]=['overview','bp','labs','ldl','plan','adherence','open_items','visits','member_messages'];

export const INTENTS=['summary','bp','labs','ldl','plan','adherence','open_items','messages']as const;
export type Intent=typeof INTENTS[number];

/**
 * ok: facts below. none: read, nothing recorded. off: the feature is switched off. unavailable: the read failed, so
 * nothing can be said either way. not_permitted: this role does not read it. not_built: the read does not exist yet.
 * Only "ok" carries values; every other state reads as not known, and the card says which.
 */
export const TOOL_STATES=['ok','none','off','unavailable','not_permitted','not_built']as const;
export type ToolState=typeof TOOL_STATES[number];
export const FACT_MARKS=['reviewed','not_reviewed','member_reported','doctor_set']as const;
export type FactMark=typeof FACT_MARKS[number];

const factId=z.string().regex(/^[a-z_]{2,20}\.\d{1,3}$/);
export const factSchema=z.strictObject({id:factId,label:z.string().min(1).max(200),value:z.string().min(1).max(500),
 /** The date the value belongs to (YYYY-MM-DD); null when the record has none. */date:z.iso.date().nullable(),
 urgent:z.boolean().optional(),
 /** Clinic lab source for the doctor chat review action. Older saved facts omit it. */
 fileId:z.uuid().optional(),
 /** Code-written alert display only. Older saved facts have no structured card. */
 alertCard:z.strictObject({symptom:z.string(),onset:z.string(),severity:z.string(),source:z.string(),next:z.string(),count:z.number().int().positive(),owner:z.string().optional(),escalation:z.string().optional(),acknowledgement:z.string().optional(),recordedAction:z.string().optional()}).optional(),
 mark:z.enum(FACT_MARKS).nullable(),href:z.string().startsWith('/staff/real/').max(200).nullable(),
 /** The lab value this fact is about, by code. Null: none, or not a name the code knows. */analyte:z.string().max(40).nullable().default(null)});
export type Fact=z.infer<typeof factSchema>;
/** Verbatim source text. Data: never a source of a number, never followed, only shown as a quote. */
export const quoteSchema=z.strictObject({id:factId,text:z.string().min(1).max(1200),date:z.iso.date().nullable(),
 /** Present only on nurse-authored evidence; old saved member quotes need no new field. */nurseName:z.string().optional(),
 /** Actual Zoe reply, still untrusted quoted text. */zoe:z.literal(true).optional(),
 /** Original timestamp for the rolling 24-hour quote window. Old saved quotes have only a date. */at:z.iso.datetime({offset:true}).optional(),
 /** The scope classifier saw instructions in it: the card says so. */flagged:z.boolean()});
export type Quote=z.infer<typeof quoteSchema>;
/** Recorded home readings for display only. Never included in the model's facts. */
const bpPointSchema=z.strictObject({measuredAt:z.iso.datetime({offset:true}),systolic:z.number().int(),diastolic:z.number().int(),slot:z.enum(['morning','evening']).optional()});
export type BpPoint=z.infer<typeof bpPointSchema>;
export const toolResultSchema=z.strictObject({identityChecks:z.array(doctorUploadOverrideSchema).optional(),tool:z.enum(TOOLS),state:z.enum(TOOL_STATES),
 /** Up to 200 P0 inbox alerts plus an incomplete-list warning; ordinary cards still cap at 40 in the fact builder. */facts:z.array(factSchema).max(201),quotes:z.array(quoteSchema).max(16),
 /** Named gaps inside an ok result ("no LDL value after the baseline"), in the reader's language. */missing:z.array(z.string().min(1).max(200)).max(8),
 href:z.string().startsWith('/staff/real/').max(200),
 /** Older saved cards have no chart. */bpSeries:z.array(bpPointSchema).optional(),
 /** All the member's messages read, beyond the quotes kept. Old saved cards have neither. */messageCount:z.number().int().nonnegative().optional(),flaggedCount:z.number().int().nonnegative().optional()});
export type ToolResult=z.infer<typeof toolResultSchema>;

/**
 * The model's whole output: ids and flags, no prose (Astra DZ-01, DZ-03). The model chooses, code writes: a free sentence
 * cannot be proved against the record, so what reaches the screen is the fact's own label and value. Strict: a text field
 * it invents fails the schema and nothing it wrote is shown.
 */
export const answerSchema=z.strictObject({
 need:z.array(z.enum(MODEL_TOOLS)).max(6),
 facts:z.array(factId).max(12),
 quotes:z.array(factId).max(6),
 /** What was asked is not in what was read. Code writes the line. */not_known:z.boolean(),
 /** The question asks for a medicine, a dose, a diagnosis or a treatment choice: code adds the fixed line. */
 declined:z.boolean(),
});
export type Answer=z.infer<typeof answerSchema>;

/** What the pane renders and the database keeps for one Zoe turn. Every line is written by code from a fact. */
export const answerContentSchema=z.strictObject({
 version:z.literal(STAFF_ZOE_VERSION),
 state:z.enum(['answered','held','no_answer','refused']),
 say:z.array(z.strictObject({text:z.string(),facts:z.array(factSchema)})),
 quotes:z.array(quoteSchema),
 notKnown:z.array(z.string()),
 declined:z.boolean(),
 notice:z.string().nullable(),
 cards:z.array(toolResultSchema),
 /** A summary also links to the full conversation. Old saved answers have none. */
 memberNotes:z.strictObject({count:z.number().int().nonnegative(),flagged:z.number().int().nonnegative(),href:z.string().startsWith('/staff/real/').max(200)}).nullable().optional(),
});
export type AnswerContent=z.infer<typeof answerContentSchema>;
/** A saved answer as history shows it. The lipid plan is never history: it is worked out on each read, behind its own switch. */
export function savedAnswer(raw:unknown):AnswerContent|null{const p=answerContentSchema.safeParse(raw);return p.success?{...p.data,cards:p.data.cards.filter(c=>c.tool!=='lipid_plan')}:null;}

export const candidateSchema=z.object({id:z.uuid(),name:z.string().nullable(),birthYear:z.number().int().nullable(),sex:z.string().nullable(),joinedOn:z.string()});
export type Candidate=z.infer<typeof candidateSchema>;
export const candidatesSchema=z.discriminatedUnion('enabled',[z.object({enabled:z.literal(false)}),z.object({enabled:z.literal(true),rows:z.array(candidateSchema).max(5),hasMore:z.boolean()})]);
export const memberRef=(id:string)=>id.slice(-8).toUpperCase();

export const conversationReadSchema=z.discriminatedUnion('enabled',[z.object({enabled:z.literal(false)}),z.object({enabled:z.literal(true),id:z.uuid(),
 member:z.object({id:z.uuid(),name:z.string().nullable(),birthYear:z.number().int().nullable(),sex:z.string().nullable()}),
 messages:z.array(z.object({seq:z.number().int(),role:z.enum(['staff','zoe']),body:z.string(),content:z.unknown(),at:z.string()}))})]);
export type ConversationRead=Extract<z.infer<typeof conversationReadSchema>,{enabled:true}>;
export const recentSchema=z.discriminatedUnion('enabled',[z.object({enabled:z.literal(false)}),z.object({enabled:z.literal(true),
 rows:z.array(z.object({id:z.uuid(),memberId:z.uuid(),name:z.string().nullable(),birthYear:z.number().int().nullable(),at:z.string()}))})]);

export const beginResultSchema=z.union([
 z.object({ok:z.literal(true),runId:z.uuid(),memberId:z.uuid(),role:z.enum(['doctor','nurse']),memberName:z.string().nullable(),tier:z.enum(['low','medium','high']),lastTools:z.array(z.enum(TOOLS)).default([]),
  history:z.array(z.object({role:z.enum(['staff','zoe']),body:z.string()}))}),
 z.object({ok:z.literal(false),code:z.string(),runId:z.uuid().optional()}),
]);
export type BeginResult=z.infer<typeof beginResultSchema>;

export const askRequestSchema=z.strictObject({conversationId:z.uuid(),submissionId:z.uuid(),text:z.string().trim().min(1).max(1000),intent:z.enum(INTENTS).nullable(),locale:z.enum(['en','hy','ru']).optional()});
export type AskRequest=z.infer<typeof askRequestSchema>;

/** One line of the answer stream. Cards arrive first, so the record is on screen before the model has finished. */
export type StreamEvent=
 |{type:'cards';cards:ToolResult[]}
 |{type:'answer';content:AnswerContent}
 |{type:'refused';code:'access'|'off'|'busy'|'replayed'|'invalid'|'unavailable'};
export type L=Locale;
