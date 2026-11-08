import {z} from 'zod';
/** Numbered published plans with the doctor's "what changed" note. */
export const planVersionSchema=z.strictObject({planId:z.uuid(),version:z.number().int().positive(),publishedAt:z.iso.datetime({offset:true}),changeSummary:z.string().min(1).max(1000).nullable(),current:z.boolean()});
export const planVersionsReadSchema=z.strictObject({version:z.literal('plan-versions-v1'),versions:z.array(planVersionSchema)});
export type PlanVersion=z.infer<typeof planVersionSchema>;
