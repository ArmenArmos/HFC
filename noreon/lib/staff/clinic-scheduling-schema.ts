import {z} from 'zod';

// Validate the raw value before trimming: newline/header injection must not turn
// into an apparently valid mailbox. Empty is an explicit unconfigured setting.
export const schedulingEmailSchema=z.string().max(1024)
 .refine(value=>!/[\r\n]/.test(value))
 .transform(value=>value.trim()||null)
 .pipe(z.email().max(254).nullable());
const revisionSchema=z.union([z.number(),z.string().regex(/^\d+$/).transform(Number)])
 .pipe(z.number().int().min(0).max(2147483647));
const settingInput=z.object({expectedRevision:revisionSchema,requestId:z.uuid(),email:schedulingEmailSchema});
export const clinicSchedulingInputSchema=settingInput.extend({clinicId:z.uuid()});
export const copySchedulingInputSchema=settingInput;
export const copySchedulingResultSchema=z.object({email:z.email().max(254).nullable(),revision:z.number().int().min(0).max(2147483647)});
export const clinicSchedulingResultSchema=copySchedulingResultSchema.extend({id:z.uuid()});
export const realClinicRowSchema=z.object({id:z.uuid(),name:z.string(),address:z.string(),active:z.boolean(),schedulingEmail:z.email().max(254).nullable(),schedulingRevision:z.number().int().min(0).max(2147483647)});
export type SchedulingFeedback='saved'|'invalid'|'stale'|'access'|'rejected'|'unknown';
export type SchedulingActionState={ok:boolean;feedback?:SchedulingFeedback;outcomeUnknown?:boolean;email?:string|null;revision?:number};
