import {z} from 'zod';
import {FIRST_NOTE_VERSION} from './compose';

const uuid=z.uuid(),instant=z.iso.datetime({offset:true});
const note=z.object({textEn:z.string(),textHy:z.string(),edited:z.boolean(),approvedAt:instant,byYou:z.boolean(),doctorName:z.string().nullable()});
export const doctorFirstNoteSchema=z.discriminatedUnion('enabled',[
 z.object({version:z.literal('first-note-v1'),enabled:z.literal(false)}),
 z.object({version:z.literal('first-note-v1'),enabled:z.literal(true),completedAt:instant.nullable(),dueAt:instant.nullable(),urgent:z.boolean(),planActive:z.boolean(),note:note.nullable()}),
]);
export type DoctorFirstNote=z.infer<typeof doctorFirstNoteSchema>;
export const firstNoteQueueSchema=z.object({version:z.literal('first-note-queue-v1'),enabled:z.boolean(),
 items:z.array(z.object({memberId:uuid,memberName:z.string().nullable(),doctorName:z.string().nullable(),completedAt:instant,dueAt:instant})),
 closed:z.array(z.object({memberId:uuid,memberName:z.string().nullable(),doctorName:z.string().nullable(),closedByName:z.string().nullable(),closedAt:instant,reason:z.string()}))});
export const firstNoteQueueCountSchema=z.object({version:z.literal('first-note-queue-count-v1'),enabled:z.boolean(),count:z.number().int().nonnegative()});
export type FirstNoteQueue=z.infer<typeof firstNoteQueueSchema>;
export const memberFirstNoteSchema=z.object({textEn:z.string(),textHy:z.string(),approvedAt:instant,doctorName:z.string().nullable()}).nullable();
export type MemberFirstNote=z.infer<typeof memberFirstNoteSchema>;
export const approveCommandSchema=z.strictObject({version:z.literal(FIRST_NOTE_VERSION),memberId:uuid,submissionId:uuid,
 textEn:z.string().trim().min(1).max(1500),textHy:z.string().trim().min(1).max(2000),builderVersion:z.string().regex(/^[a-z0-9.-]{1,40}$/),
 sources:z.array(z.string().regex(/^[A-Za-z0-9_.:-]{1,40}$/)).max(20),edited:z.boolean(),
 /** The questionnaire revision the text was prepared from; approval is refused once the answers changed (audit B2-3). */
 assessmentRevision:z.number().int().nonnegative()});
export type ApproveCommand=z.infer<typeof approveCommandSchema>;
export const approveStatuses=['approved','already','not-ready','urgent','plan-active','disabled','invalid','stale','unavailable','access','outcome-unknown'] as const;
export type ApproveResult={status:typeof approveStatuses[number]};
export const backlogCloseSchema=z.strictObject({memberId:uuid,reason:z.string().trim().min(1).max(500)});
export const backlogReopenSchema=z.strictObject({memberId:uuid});
export const backlogStatuses=['closed','reopened','not-overdue','already','urgent','plan-active','disabled','invalid','unavailable','access','outcome-unknown'] as const;
export type BacklogResult={status:typeof backlogStatuses[number]};
