import {z} from 'zod';
export const taskKinds={'contact-followup':'Contact follow-up','evidence-collection':'Evidence collection','booking-coordination':'Booking coordination','doctor-referral':'Doctor referral'} as const;
export const taskStatuses={open:'Open','awaiting-member':'Awaiting member','awaiting-doctor':'Awaiting doctor',completed:'Completed',cancelled:'Cancelled'} as const;
const kind=z.enum(['contact-followup','evidence-collection','booking-coordination','doctor-referral']);
const status=z.enum(['open','awaiting-member','awaiting-doctor','completed','cancelled']);
const details=z.object({title:z.string().trim().min(1).max(160),instructions:z.string().trim().min(1).max(2000),dueAt:z.iso.datetime({offset:true}).nullable()}).strict();
const note=z.object({note:z.string().trim().min(1).max(2000)}).strict();
const base={caseId:z.uuid(),taskId:z.uuid(),requestId:z.uuid()};
export const coordinationCommandSchema=z.discriminatedUnion('operation',[
 z.object({...base,revision:z.literal(0),operation:z.literal('create'),input:details.extend({kind,ownerId:z.uuid(),sourceConversationId:z.uuid().optional()}).strict()}).strict(),
 z.object({...base,revision:z.number().int().positive(),operation:z.literal('edit'),input:details}).strict(),
 z.object({...base,revision:z.number().int().positive(),operation:z.literal('reassign'),input:z.object({ownerId:z.uuid()}).strict()}).strict(),
 z.object({...base,revision:z.number().int().positive(),operation:z.literal('contact'),input:note.extend({outcome:z.enum(['contact-attempted','reached','unreachable'])}).strict()}).strict(),
 ...(['await-member','reopen'] as const).map(operation=>z.object({...base,revision:z.number().int().positive(),operation:z.literal(operation),input:z.object({}).strict()}).strict()),
 ...(['complete','refer','resolve','cancel'] as const).map(operation=>z.object({...base,revision:z.number().int().positive(),operation:z.literal(operation),input:note}).strict()),
]);
export type CoordinationCommand=z.infer<typeof coordinationCommandSchema>;
const ownerSchema=z.object({id:z.uuid(),name:z.string(),role:z.enum(['doctor','nurse'])});
export const cursorSchema=z.object({createdAt:z.iso.datetime({offset:true}),id:z.uuid()});
export const taskFilterSchema=z.enum(['active','all','open','awaiting-member','awaiting-doctor','completed','cancelled','reassign']);
export const taskSchema=z.object({id:z.uuid(),caseId:z.uuid(),origin:z.enum(['nurse_handoff','doctor_handover','zoe_side_effect']).nullable().optional(),sourceConversationId:z.uuid().nullable().optional(),memberName:z.string().nullable(),kind,title:z.string(),instructions:z.string(),dueAt:z.string().nullable(),creatorId:z.uuid(),ownerId:z.uuid(),ownerName:z.string(),status,revision:z.number().int().positive(),createdAt:z.string(),updatedAt:z.string(),needsReassignment:z.boolean(),eligibleOwners:z.array(ownerSchema)});
export const taskEventSchema=z.object({id:z.number(),revision:z.number(),request_id:z.uuid(),actor_id:z.uuid(),actor_name:z.string(),actor_role:z.string(),operation:z.string(),old_status:z.string().nullable(),new_status:z.string(),old_owner_id:z.uuid().nullable(),new_owner_id:z.uuid(),note:z.string(),care_note_id:z.uuid().nullable(),detail:z.object({input:z.record(z.string(),z.unknown())}).passthrough(),created_at:z.string()});
export const taskSnapshotSchema=taskSchema.extend({events:z.array(taskEventSchema)});
export const memberOptionsSchema=z.array(z.object({id:z.uuid(),name:z.string().nullable(),owners:z.array(ownerSchema)}));
export type CoordinationTask=z.infer<typeof taskSchema>;
export type CoordinationSnapshot=z.infer<typeof taskSnapshotSchema>;
export type CoordinationMember=z.infer<typeof memberOptionsSchema>[number];
export type CoordinationActor={id:string;role:'admin'|'doctor'|'nurse'};
export type CoordinationResult={ok:true;id:string;revision:number;status:CoordinationTask['status']}|{ok:false;error:string;uncertain?:boolean};

export const taskPageSchema=z.object({tasks:z.array(taskSchema),nextCursor:cursorSchema.nullable()});
export const memberPageSchema=z.object({members:memberOptionsSchema,nextCursor:cursorSchema.nullable()});
export type CoordinationTaskPage=z.infer<typeof taskPageSchema>;
export type CoordinationMemberPage=z.infer<typeof memberPageSchema>;
export type CoordinationCursor=z.infer<typeof cursorSchema>;
