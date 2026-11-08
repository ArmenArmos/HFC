import {z} from 'zod';

/**
 * AI-prepared care plan draft (DESIGN: output/ai-care-plan-2026-10-18/DESIGN.md).
 * Every clinical item comes from code (rules engine, lab protocol v2 on reviewed values). The model
 * only words prose for items that already exist; a guard checks it; code assembles the draft.
 */
export const BUILDER_VERSION='ai-plan-builder-4';
export const PROMPT_VERSION='ai-plan-prompt-6';
export const AI_PLAN_LABEL={en:'Draft from plan items, check before publishing',hy:'Պլանի կետերից կազմված սևագիր, ստուգեք հրապարակելուց առաջ',ru:'Черновик составлен из пунктов плана, проверьте перед публикацией'} as const;
export const PROTOCOL_MODEL='noreon-protocol-1',PROTOCOL_PROVIDER='noreon.protocol';

export const sections=['red_flag','assessment','bp_target','lifestyle','tests','follow_up','medication_consideration','data_gap'] as const;
export type Section=typeof sections[number];
export const sourceKinds=['rule','lab','measurement','visit','protocol','questionnaire'] as const;
const short=z.string().min(1).max(400);
const pair=z.strictObject({en:z.string().min(1).max(400),hy:z.string().min(1).max(500)});
export const planItemSchema=z.strictObject({
 id:z.string().regex(/^[a-z0-9_.:-]{1,60}$/),
 section:z.enum(sections),
 /** protocol: the item follows a stated rule. needs_doctor_judgement: no rule decides it; doctor-only. */
 status:z.enum(['protocol','needs_doctor_judgement']),
 text:short,
 rationale:short,
 source:z.strictObject({kind:z.enum(sourceKinds),ref:z.string().min(1).max(80),label:z.string().min(1).max(160)}),
 timing:z.string().min(1).max(120).nullable(),
 /** Member-facing text (code wording, never the model's); null keeps the item for the doctor only. */
 member:pair.nullable(),
});
export type PlanItem=z.infer<typeof planItemSchema>;

/**
 * What the model may return: a summary for the doctor's panel, nothing else. Every member-facing word,
 * item text, value, timing and urgent instruction is code wording (Codex #280 F1, rounds 1 and 2).
 */
// 1,200 matches the ai_plan_generations.summary check. At 900, real summaries ran over and were dropped whole (eval 19 Oct: Opus's
// first answer in 5 of 12 rechecks, Haiku up to 900 in Armenian).
export const proseSchema=z.strictObject({summary:z.string().min(1).max(1200)});
export type Prose=z.infer<typeof proseSchema>;

export const labValueSchema=z.object({valueId:z.uuid(),catalogueRef:z.string().nullable(),testName:z.string(),value:z.number().nullable(),unit:z.string().nullable(),
 labFlag:z.string().nullable(),collectedOn:z.string().nullable(),attention:z.string().nullable(),status:z.enum(['unverified','auto_accepted','verified','corrected'])});
export type PlanLabValue=z.infer<typeof labValueSchema>;

export const draftShape=z.object({explanation:z.string(),instructions:z.string(),followUp:z.string(),medicationName:z.string(),medicationDose:z.string(),medicationInstructions:z.string(),medicationTimes:z.array(z.string())});
export const generationSchema=z.object({id:z.uuid(),createdAt:z.string(),mode:z.enum(['model','protocol_only']),model:z.string(),local:z.boolean(),provider:z.string().nullable(),
 responseModel:z.string().nullable(),language:z.enum(['hy','en']),evidenceToken:z.string(),labToken:z.string(),caseRevision:z.number(),promptVersion:z.string(),builderVersion:z.string(),
 guard:z.array(z.string()),draft:draftShape,items:z.array(planItemSchema),summary:z.string().nullable(),adoptedAt:z.string().nullable(),adoptedFields:z.array(z.string()).nullable(),byYou:z.boolean()});
export type PlanGeneration=z.infer<typeof generationSchema>;
export const doctorPlanReadSchema=z.discriminatedUnion('enabled',[
 z.object({version:z.literal('ai-plan-read-v1'),enabled:z.literal(false)}),
 z.object({version:z.literal('ai-plan-read-v1'),enabled:z.literal(true),attemptsToday:z.number().int(),published:z.boolean(),labToken:z.string(),labValues:z.array(labValueSchema),latest:generationSchema.nullable()}),
]);
export type DoctorPlanRead=z.infer<typeof doctorPlanReadSchema>;
export const DRAFT_FIELDS=['explanation','instructions','followUp'] as const;
export type DraftField=typeof DRAFT_FIELDS[number];
