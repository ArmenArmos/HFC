import {z} from 'zod';

/** Logistics stages for a sample a nurse recorded as collected. A stage says
 * where the sample is, never what a result means. */
export const labStageVersion='lab-stage-v1' as const;
export const labStages=['at-lab','results-received'] as const;
export type LabStage=typeof labStages[number];
const uuid=z.uuid(),revision=z.number().int().nonnegative().safe();
const instant=z.iso.datetime({offset:true});
const stage=z.enum(labStages);
const staffStage=z.strictObject({id:uuid,stage,occurredAt:instant,recordedAt:instant,actor:z.strictObject({name:z.string().min(1).max(500),role:z.enum(['nurse','doctor','system'])})});
const memberStage=z.strictObject({stage,occurredAt:instant});
function ordered(stages:{stage:LabStage}[]){return stages.length<=2&&stages.every((item,index)=>item.stage===labStages[index]);}
const sample=<T extends z.ZodType<{stage:LabStage}>>(item:T)=>z.strictObject({entryId:uuid,visitId:uuid,testId:z.string().min(1).max(100),title:z.string().min(1).max(500).nullable(),collectedAt:instant,stages:z.array(item).refine(ordered,'Stages must be recorded in order')});
export const staffLabSampleSchema=sample(staffStage);
export const staffLabReadSchema=z.strictObject({version:z.literal(labStageVersion),memberId:uuid,revision,samples:z.array(staffLabSampleSchema)});
export const memberLabSampleSchema=sample(memberStage);
export const memberLabReadSchema=z.strictObject({version:z.literal(labStageVersion),samples:z.array(memberLabSampleSchema)});
export const labStageCommandSchema=z.strictObject({version:z.literal(labStageVersion),id:uuid,submissionId:uuid,entryId:uuid,stage,occurredAt:instant});
export const labStageResultSchema=z.discriminatedUnion('status',[
 z.strictObject({status:z.literal('saved'),submissionId:uuid,stageId:uuid,revision,replayed:z.boolean()}),
 z.strictObject({status:z.literal('invalid'),issues:z.array(z.strictObject({path:z.string().max(200),message:z.string().max(500)})).min(1)}),
 z.strictObject({status:z.enum(['stale','access','unavailable','outcome-unknown'])}),
]);
export type StaffLabSample=z.infer<typeof staffLabSampleSchema>;
export type StaffLabRead=z.infer<typeof staffLabReadSchema>;
export type MemberLabSample=z.infer<typeof memberLabSampleSchema>;
export type LabStageCommand=z.infer<typeof labStageCommandSchema>;
export type LabStageResult=z.infer<typeof labStageResultSchema>;
export type LabStageCommandPort=(input:LabStageCommand)=>Promise<LabStageResult>;

/** Where one sample is now. "collected" means no later stage is recorded. */
export function currentStage(sample:{stages:{stage:LabStage}[]}):'collected'|LabStage{return sample.stages.at(-1)?.stage??'collected';}

/** Member Home summary. "at-lab" (being processed) means every sample has
 * reached the lab and at least one result is outstanding; "partial" means some
 * samples have not reached the lab yet while others have. */
export function memberLabSummary(samples:{stages:{stage:LabStage}[]}[]):'collected'|'partial'|'at-lab'|'results-received'|null{
 if(!samples.length)return null;
 const stages=samples.map(currentStage);
 if(stages.every(stage=>stage==='collected'))return 'collected';
 if(stages.includes('collected'))return 'partial';
 if(stages.includes('at-lab'))return 'at-lab';
 return 'results-received';
}
