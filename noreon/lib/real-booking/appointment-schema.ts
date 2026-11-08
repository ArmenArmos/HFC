import {z} from 'zod';
import {arrangementSchema} from './schema';
const text=(max:number)=>z.string().trim().min(1).max(max);
const timestamp=z.iso.datetime({offset:true});
export const noticePurposeSchema=z.enum(['booking','change','cancellation']);
export const programItemSchema=z.strictObject({id:text(100),title:text(500),method:z.enum(['lab','clinic','home-log']),preparation:z.string().max(8000),source:z.string().max(2000)});
export const publicProgramItemSchema=programItemSchema.omit({source:true});
export const bookingProgramSchema=z.strictObject({memberId:z.uuid(),sourceToken:text(200),requirementsToken:text(200),engineVersion:text(100),items:z.array(programItemSchema).min(1).max(100)}).refine(p=>new Set(p.items.map(i=>i.id)).size===p.items.length,'Duplicate program item');
export const followUpSchema=z.strictObject({testId:text(100),owner:text(300),action:text(2000),reference:text(1000)});
export const trustedOfferSchema=z.strictObject({
 id:z.uuid(),version:text(200),source:text(200),clinicId:z.uuid(),mode:z.enum(['home','clinic']),startsAt:timestamp,endsAt:timestamp,timezone:z.literal('Asia/Yerevan'),
 clinicAddress:z.string().max(1000).nullable(),preparation:text(8000),preparationVersion:text(200),coveredTestIds:z.array(text(100)).max(100),followUps:z.array(followUpSchema).max(100),
 reservationContract:z.strictObject({version:text(200),reference:text(1000)}),
}).refine(o=>Date.parse(o.endsAt)>Date.parse(o.startsAt),'Invalid actual offer window').refine(o=>o.mode==='home'||!!o.clinicAddress?.trim(),'Clinic offer needs a trusted address');
// Optional only so browsers can recover commands recorded before this field existed.
export const appointmentSelectionSchema=z.strictObject({commandId:z.uuid(),offerId:z.uuid(),offerVersion:text(200),homeAddress:text(1000).nullable(),suggestedSetFingerprint:z.string().max(62000).optional()});
export const appointmentChangeSchema=appointmentSelectionSchema.extend({appointmentId:z.uuid(),revision:z.number().int().nonnegative().safe(),agreementSource:text(1000).nullable()});
export const appointmentCancelSchema=z.strictObject({commandId:z.uuid(),appointmentId:z.uuid(),revision:z.number().int().nonnegative().safe(),agreementSource:text(1000).nullable()});
export const appointmentRetrySchema=z.strictObject({commandId:z.uuid(),appointmentId:z.uuid(),revision:z.number().int().nonnegative().safe(),noticeId:z.uuid()});
export const arrangementDetailsSchema=z.strictObject({offerId:z.uuid(),offerVersion:text(200),clinicId:z.uuid(),mode:z.enum(['home','clinic']),startsAt:timestamp,endsAt:timestamp,timezone:z.literal('Asia/Yerevan'),location:text(1000),preparation:text(8000),preparationVersion:text(200),coveredTestIds:z.array(text(100)),followUps:z.array(followUpSchema)});
export const appointmentHistorySchema=z.strictObject({revision:z.number().int().nonnegative().safe(),createdAt:timestamp,purpose:noticePurposeSchema.optional(),program:z.array(publicProgramItemSchema),previous:arrangementDetailsSchema.nullable(),proposed:arrangementDetailsSchema,noticeState:z.enum(['pending','sending','accepted','failed','unknown','reconciliation','declined','superseded'])});
/** Clinic-portal scheduling state, from booking_portal_details (not part of the released appointment shape). */
export const portalDetailsSchema=z.strictObject({channel:z.enum(['email','portal']),noticeState:z.string(),portalRevisions:z.array(z.number().int().nonnegative().safe()),
 decline:z.strictObject({reason:z.string(),at:timestamp}).nullable(),
 proposal:z.strictObject({id:z.uuid(),startsAt:timestamp,endsAt:timestamp,note:z.string().nullable(),clinicId:z.uuid(),clinicName:z.string(),clinicAddress:z.string(),createdAt:timestamp}).nullable(),
 checkin:z.strictObject({outcome:z.enum(['arrived','no-show','completed']),at:timestamp}).nullable()});
export type PortalDetails=z.infer<typeof portalDetailsSchema>;
/** booking_pilot_programme_state: the visit belongs to the current requirements, or is still open
 * (not cancelled, not attended, not a confirmed visit whose time has passed). */
export const programmeVisitSchema=z.strictObject({currentProgramme:z.boolean(),open:z.boolean()});
export type ProgrammeVisit=z.infer<typeof programmeVisitSchema>;
export const appointmentSchema=z.strictObject({version:z.literal('email-pilot-v1'),id:z.uuid(),memberId:z.uuid(),revision:z.number().int().nonnegative().safe(),canStartScheduling:z.boolean().optional(),status:z.enum(['notification-pending','confirmed','failed','unknown','reconciliation','cancelled']),noticePurpose:noticePurposeSchema.optional(),program:z.array(publicProgramItemSchema),currentProgram:z.array(publicProgramItemSchema).optional(),history:z.array(appointmentHistorySchema).optional(),legacyCurrent:arrangementSchema.nullable().optional(),current:arrangementDetailsSchema.nullable(),proposed:arrangementDetailsSchema,noticeId:z.uuid(),createdAt:timestamp});
export const proposalAnswerSchema=z.strictObject({commandId:z.uuid(),proposalId:z.uuid(),accept:z.boolean()});
export const appointmentWorkspaceSchema=z.strictObject({member:z.strictObject({id:z.uuid(),name:z.string().nullable(),phone:z.string().nullable().optional()}),appointments:z.array(appointmentSchema),clinics:z.record(z.uuid(),z.string()).optional()});
export type BookingProgram=z.infer<typeof bookingProgramSchema>;
export type TrustedOffer=z.infer<typeof trustedOfferSchema>;
export type AppointmentSelection=z.infer<typeof appointmentSelectionSchema>;
export type AppointmentCancel=z.infer<typeof appointmentCancelSchema>;
export type NoticePurpose=z.infer<typeof noticePurposeSchema>;
export type Appointment=z.infer<typeof appointmentSchema>&{portal?:PortalDetails;programme?:ProgrammeVisit};
export type AppointmentWorkspace=Omit<z.infer<typeof appointmentWorkspaceSchema>,'appointments'>&{appointments:Appointment[]};
export type OfferAvailability={available:false;reason:'source-unavailable'|'configuration-unavailable'|'legacy-reconciliation'}|{available:true;offers:TrustedOffer[]};
export type PublicProgramItem=z.infer<typeof publicProgramItemSchema>;
export type PublicBookingOffer={source?:string}&Pick<TrustedOffer,'id'|'version'|'clinicId'|'mode'|'startsAt'|'endsAt'|'timezone'|'clinicAddress'|'preparation'|'preparationVersion'|'coveredTestIds'|'followUps'>&{clinicName:string};
export type PilotUnavailableReason='source-unavailable'|'configuration-unavailable'|'legacy-reconciliation'|'clinical-hold'|'profile-mismatch'|'unavailable';
export type PilotBookingData={canRecoverScheduling?:boolean;canRetryScheduling?:boolean;canChange?:boolean;canCancel?:boolean;clinics?:Record<string,string>;available:boolean;unavailableReason:PilotUnavailableReason|null;program:PublicProgramItem[];offers:PublicBookingOffer[];appointments:Appointment[]};
export type PilotActionState={ok:boolean;code?:'declined'|'unavailable'|'invalid'|'conflict'|'tests-changed'|'pending'|'failed'|'unknown'|'saved'|'arrangement-review';commandRecorded?:boolean;outcomeUnknown?:boolean};
export type PilotFormAction=(previous:PilotActionState,form:FormData)=>Promise<PilotActionState>;

export type SchedulingOutcome='confirmed'|'failed'|'unknown'|'pending'|'arrangement-review';
