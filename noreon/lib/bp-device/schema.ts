import{z}from'zod';

/** BP monitor inventory, holding history and readings, as returned by the
 * bp_* database functions. The database enforces every rule; these schemas only
 * refuse a response that is not the shape the screens expect. */
export const bpDeviceVersion='bp-device-v1' as const;
export const bpDeviceStatuses=['in-stock','assigned','returned','lost','faulty'] as const;
export type BpDeviceStatus=typeof bpDeviceStatuses[number];
export const bpHoldReasons=['unknown-device','no-assignment','member-mismatch'] as const;
const uuid=z.uuid(),instant=z.iso.datetime({offset:true}),name=z.string().min(1).max(500),reason=z.string().min(1).max(500);
const actor=z.strictObject({name,role:z.enum(['admin','nurse'])});
export const bpAssignmentSchema=z.strictObject({
 id:uuid,deviceId:uuid,serial:z.string().min(1).max(64),model:z.string().min(1).max(120),memberId:uuid,memberName:name,
 assignedAt:instant,recordedAt:instant,assignedBy:actor,assignReason:reason.nullable(),
 endedAt:instant.nullable(),endedBy:actor.nullable(),endReason:reason.nullable(),
});
const holder=z.strictObject({assignmentId:uuid,memberId:uuid,memberName:name,since:instant});
export const bpDeviceSchema=z.strictObject({id:uuid,model:z.string().min(1).max(120),serial:z.string().min(1).max(64),status:z.enum(bpDeviceStatuses),revision:z.number().int().positive(),createdAt:instant,holder:holder.nullable(),history:z.array(bpAssignmentSchema)});
export const bpHeldReadingSchema=z.strictObject({id:uuid,serial:z.string().min(1).max(64),deviceId:uuid.nullable(),measuredAt:instant,receivedAt:instant,reason:z.enum(bpHoldReasons),claimedMember:z.strictObject({id:uuid,name}).nullable()});
export const bpInventorySchema=z.strictObject({version:z.literal(bpDeviceVersion),devices:z.array(bpDeviceSchema),held:z.array(bpHeldReadingSchema)});
export const bpReadingSchema=z.strictObject({id:uuid,systolic:z.number().int(),diastolic:z.number().int(),pulse:z.number().int().nullable(),measuredAt:instant,source:z.enum(['manual','visit','device']),entrySource:z.string().nullable().optional(),serial:z.string().min(1).max(64).nullable()});
export const bpMemberDevicesSchema=z.strictObject({
 version:z.literal(bpDeviceVersion),memberId:uuid,current:bpAssignmentSchema.nullable(),history:z.array(bpAssignmentSchema),
 available:z.array(z.strictObject({id:uuid,serial:z.string().min(1).max(64),model:z.string().min(1).max(120),status:z.enum(['in-stock','returned','assigned']),holderName:name.nullable()})),
 readings:z.array(bpReadingSchema).nullable(),
});
const base={version:z.literal(bpDeviceVersion),submissionId:uuid};
const optionalReason=reason.nullable();
export const bpDeviceCommandSchema=z.discriminatedUnion('action',[
 z.strictObject({...base,action:z.literal('register'),model:z.string().trim().min(1).max(120),serial:z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9-]{2,63}$/)}),
 z.strictObject({...base,action:z.literal('set-status'),deviceId:uuid,status:z.enum(['in-stock','returned','lost','faulty']),reason:optionalReason}),
 z.strictObject({...base,action:z.literal('assign'),deviceId:uuid,memberId:uuid,effectiveAt:instant.nullable(),reason:optionalReason}),
 z.strictObject({...base,action:z.literal('end'),deviceId:uuid,status:z.enum(['returned','lost','faulty']),reason,effectiveAt:instant.nullable()}),
 z.strictObject({...base,action:z.literal('recheck-held'),readingId:uuid}),
 z.strictObject({...base,action:z.literal('dismiss-held'),readingId:uuid,reason}),
]);
export const bpDeviceResultSchema=z.union([
 z.strictObject({status:z.literal('saved'),deviceId:uuid.optional(),reading:z.enum(['attached','dismissed']).optional(),replayed:z.boolean()}),
 z.strictObject({status:z.literal('still-held'),reason:z.enum(bpHoldReasons)}),
 z.strictObject({status:z.enum(['invalid','stale','access','unavailable','duplicate-serial','reason-required','device-unavailable','member-has-device','overlap','outcome-unknown','disabled'])}),
]);
export type BpAssignment=z.infer<typeof bpAssignmentSchema>;
export type BpDevice=z.infer<typeof bpDeviceSchema>;
export type BpHeldReading=z.infer<typeof bpHeldReadingSchema>;
export type BpInventory=z.infer<typeof bpInventorySchema>;
export type BpReading=z.infer<typeof bpReadingSchema>;
export type BpMemberDevices=z.infer<typeof bpMemberDevicesSchema>;
export type BpDeviceCommand=z.infer<typeof bpDeviceCommandSchema>;
export type BpDeviceResult=z.infer<typeof bpDeviceResultSchema>;
export type BpDeviceCommandPort=(input:BpDeviceCommand)=>Promise<BpDeviceResult>;
