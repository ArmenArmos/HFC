import {z} from 'zod';
/** Programme rhythm (dark): week-4 review, month 3, month 6. The database decides the switch,
 * the dates (Yerevan calendar days from the settings row) and who may read or act. */
const uuid=z.uuid(),instant=z.iso.datetime({offset:true}),day=z.iso.date();
export const checkpointKinds=['week4_review','month3','month6'] as const;
export const feelings=['better','same','worse'] as const;
export const medicineAnswers=['all','missed_some','missed_many','no_medicines','not_sure'] as const;
export type CheckpointKind=(typeof checkpointKinds)[number];
export type Feeling=(typeof feelings)[number];
export type MedicineAnswer=(typeof medicineAnswers)[number];

const checkinSchema=z.strictObject({feeling:z.enum(feelings),medicines:z.enum(medicineAnswers),note:z.string().max(500).nullable(),submittedAt:instant});
const checkpointBase={
 id:uuid.nullable(),kind:z.enum(checkpointKinds),dueOn:day,state:z.enum(['scheduled','open','completed']),
 openedAt:instant.nullable(),completedAt:instant.nullable(),outcome:z.enum(['confirmed','republished']).nullable(),
 doctorNote:z.string().max(1000).nullable(),checkin:checkinSchema.nullable(),
};
export const memberCheckpointSchema=z.strictObject(checkpointBase);
export const memberTimelineSchema=z.discriminatedUnion('enabled',[
 z.strictObject({version:z.literal('programme-v1'),enabled:z.literal(false)}),
 z.strictObject({version:z.literal('programme-v1'),enabled:z.literal(true),today:day,schedulePending:z.boolean(),opensDaysBefore:z.number().int().min(0).max(14),
  startedAt:instant.nullable(),checkpoints:z.array(memberCheckpointSchema).max(3)}),
]);
export type MemberTimeline=z.infer<typeof memberTimelineSchema>;
export type MemberCheckpoint=z.infer<typeof memberCheckpointSchema>;

export const doctorCheckpointSchema=z.strictObject({...checkpointBase,completedByName:z.string().max(200).nullable(),outcomePlanVersion:z.number().int().positive().nullable()});
export const doctorMemberSchema=z.discriminatedUnion('enabled',[
 z.strictObject({version:z.literal('programme-member-v1'),enabled:z.literal(false)}),
 z.strictObject({version:z.literal('programme-member-v1'),enabled:z.literal(true),today:day,schedulePending:z.boolean(),startedAt:instant.nullable(),since:instant.nullable(),
  offsets:z.strictObject({week4Review:z.string(),month3:z.string(),month6:z.string(),opensDaysBefore:z.number().int()}),
  currentPlan:z.strictObject({planId:uuid,version:z.number().int().positive(),publishedAt:instant}).nullable(),
  checkpoints:z.array(doctorCheckpointSchema).max(3),
  readings:z.strictObject({count:z.number().int(),first:instant.nullable(),last:instant.nullable(),
   last7:z.strictObject({count:z.number().int(),systolic:z.number().nullable(),diastolic:z.number().nullable()})}),
  doses:z.strictObject({taken:z.number().int(),skipped:z.number().int()}),
  gpReport:z.strictObject({version:z.number().int().positive(),approvedAt:instant}).nullable()}),
]);
export type DoctorMember=z.infer<typeof doctorMemberSchema>;
export type DoctorCheckpoint=z.infer<typeof doctorCheckpointSchema>;

export const doctorQueueSchema=z.strictObject({version:z.literal('programme-queue-v1'),enabled:z.boolean(),today:day.optional(),
 items:z.array(z.strictObject({checkpointId:uuid,memberId:uuid,memberName:z.string().max(500).nullable(),kind:z.enum(checkpointKinds),dueOn:day,openedAt:instant,checkinAt:instant.nullable()}))});
export type DoctorQueue=z.infer<typeof doctorQueueSchema>;

export const checkinCommandSchema=z.strictObject({checkpointId:uuid,feeling:z.enum(feelings),medicines:z.enum(medicineAnswers),note:z.string().max(500).optional(),submissionId:uuid});
export const confirmCommandSchema=z.strictObject({memberId:uuid,checkpointId:uuid,note:z.string().max(1000).optional(),submissionId:uuid});
export type CheckinCommand=z.infer<typeof checkinCommandSchema>;
export type ConfirmCommand=z.infer<typeof confirmCommandSchema>;
export type CheckinResult={status:'saved'|'already'|'closed'|'off'|'access'|'invalid'|'outcome-unknown'};
export type ConfirmResult={status:'confirmed'|'closed'|'no_plan'|'off'|'access'|'invalid'|'outcome-unknown'};
