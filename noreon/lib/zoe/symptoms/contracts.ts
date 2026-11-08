import {z} from 'zod';
import {symptomSummarySchema} from './summary';

/** The assigned doctor's view of a member's symptom intakes (zoe_symptom_intakes_for_doctor): the summary, never the raw record. */
export const symptomIntakesSchema=z.object({ok:z.literal(true),intakes:z.array(z.object({id:z.uuid(),sheetId:z.string(),sheetVersion:z.number().int(),
 state:z.enum(['active','completed','stopped','escalated','expired']),ending:z.string().nullable(),summary:symptomSummarySchema.nullable(),
 startedAt:z.string(),updatedAt:z.string(),finishedAt:z.string().nullable()}))});
export type SymptomIntakeView=z.infer<typeof symptomIntakesSchema>['intakes'][number];
