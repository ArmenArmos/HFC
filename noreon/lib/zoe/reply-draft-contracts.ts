import {z} from 'zod';

/** The assigned doctor's view of Zoe's structured reply drafts (zoe_reply_drafts_for_doctor). */
export const zoeReplyDraftsSchema=z.object({ok:z.literal(true),drafts:z.array(z.object({runId:z.uuid(),draftId:z.uuid().nullable(),messageSeq:z.number().int(),version:z.string(),
 planId:z.uuid().nullable(),planPublishedAt:z.string().nullable(),planCurrent:z.boolean(),asked:z.string(),acknowledgement:z.string(),acknowledgementId:z.string(),
 quoted:z.array(z.object({id:z.string(),kind:z.enum(['instruction','explanation','next_step','medicine']),text:z.string()})),
 doctorDecides:z.array(z.string()),outsidePlan:z.boolean(),needsJudgement:z.boolean(),judgementReasons:z.array(z.string()),createdAt:z.string()}))});
/** The action's result: the list, or null when the pipeline is off. */
export const zoeReplyDraftsListSchema=zoeReplyDraftsSchema.shape.drafts.nullable();
export type ZoeReplyDraftView=z.infer<typeof zoeReplyDraftsSchema>['drafts'][number];

export const planItemKindLabel:Record<ZoeReplyDraftView['quoted'][number]['kind'],string>={
 instruction:'Care instructions',explanation:'Explanation',next_step:'Next step',medicine:'Medicine',
};
export const judgementReasonText:Record<string,string>={
 outside_plan:'the member asks for something the published plan does not settle',doctor_decides:'Zoe listed points only you can decide',
 medicine_quoted:'the draft quotes the medicine line of the plan',medicine_question:'the member asks about a medicine',
 no_published_plan:'the member has no published plan yet',no_plan_item_chosen:'no plan item answers the question',
};
