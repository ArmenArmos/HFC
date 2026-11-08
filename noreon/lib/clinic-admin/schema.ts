import {clinicChangeRequestSchema} from './approvals-schema';
import{z}from'zod';
import{clinicBookingSchema}from'@/lib/clinic-scheduling/schema';
/** Clinic admin full access (dark behind clinic_portal_capabilities.clinic_admin_full_access). Who may
 * see which patient, and what the record holds, is decided in SQL; these schemas only parse it. */
const id=z.uuid(),stamp=z.iso.datetime({offset:true}),date=z.iso.date(),phone=z.string().regex(/^\+[0-9]{6,15}$/).nullable();
export const patientRowSchema=z.strictObject({memberId:id,name:z.string().max(200),phone,birthDate:date.nullable(),doctorName:z.string().max(200).nullable(),nurseName:z.string().max(200).nullable()});
export type ClinicPatientRow=z.infer<typeof patientRowSchema>;
export const patientsSchema=z.union([
 z.strictObject({version:z.literal('clinic-admin-patients-v1'),enabled:z.literal(false)}),
 z.strictObject({version:z.literal('clinic-admin-patients-v1'),enabled:z.literal(true),patients:z.array(patientRowSchema).max(200)}),
]);
const staff=z.strictObject({id,name:z.string().max(200),role:z.string(),clinicId:id.nullable(),clinicName:z.string().nullable(),active:z.boolean()});
const choice=z.strictObject({id,name:z.string().max(200)});
export const recordSchema=z.union([
 z.strictObject({version:z.literal('clinic-admin-record-v1'),enabled:z.literal(false)}),
 z.strictObject({version:z.literal('clinic-admin-record-v1'),enabled:z.literal(true),status:z.literal('refused')}),
 z.strictObject({version:z.literal('clinic-admin-record-v1'),enabled:z.literal(true),status:z.literal('ok'),
  member:z.strictObject({memberId:id,name:z.string().max(200),phone,birthDate:date.nullable(),sex:z.enum(['male','female']).nullable(),locale:z.enum(['hy','en']),joinedAt:stamp,updatedAt:stamp}),
  pendingRequests:z.array(clinicChangeRequestSchema).max(2).default([]),
  consents:z.array(z.strictObject({version:z.string(),acceptedAt:stamp})).max(50),
  careTeam:z.strictObject({enrolled:z.boolean(),revision:z.number().int().nonnegative().nullable(),enrolledAt:stamp.nullable(),doctor:staff.nullable(),nurse:staff.nullable(),editable:z.boolean(),
   doctors:z.array(choice).max(500),nurses:z.array(choice).max(500)}),
  // Clinical keys stay on the wire for compatibility and must be empty (audit S1-11): anything else is refused, never shown.
  assessment:z.null(),measurements:z.array(z.never()).max(0),tests:z.array(z.never()).max(0),results:z.array(z.never()).max(0),plan:z.null(),
  memberDocuments:z.array(z.never()).max(0),reports:z.array(z.never()).max(0),
  bookings:z.array(clinicBookingSchema).max(500),
  visits:z.array(z.strictObject({visitId:id,visitedAt:stamp,clinicName:z.string().nullable(),thisClinic:z.literal(true),recordedBy:z.string().max(500),role:z.string(),entries:z.array(z.never()).max(0)})).max(100),
  files:z.array(z.strictObject({fileId:id,name:z.string(),uploadedAt:stamp,batchName:z.string(),linkedAt:stamp,visitedAt:stamp.nullable()})).max(500),
  profileChanges:z.array(z.strictObject({at:stamp,by:z.string().nullable(),before:z.strictObject({name:z.string(),birthDate:date.nullable()}),after:z.strictObject({name:z.string(),birthDate:date.nullable()})})).max(20)}),
]);
export type ClinicPatientRecord=Extract<z.infer<typeof recordSchema>,{status:'ok'}>;
export const profileEditSchema=z.strictObject({submissionId:id,expected:z.strictObject({name:z.string().max(200),birthDate:date.nullable()}),name:z.string().trim().min(1).max(100),birthDate:date});
export const careTeamEditSchema=z.strictObject({submissionId:id,expectedRevision:z.number().int().nonnegative(),doctorId:id,nurseId:id.nullable()});
export const profileResultSchema=z.strictObject({status:z.enum(['committed','unchanged','stale','invalid','refused','conflict','disabled','age-changes']),changeId:id.optional()});
export const careTeamResultSchema=z.strictObject({status:z.enum(['committed','unchanged','stale','invalid','refused','rejected','not_enrolled','disabled']),revision:z.number().int().optional(),reason:z.string().optional()});
export type EditOutcome='pending'|'pending_exists'|'disabled'|'saved'|'age_changes'|'unchanged'|'stale'|'invalid'|'refused'|'unavailable'|'doctor_unavailable'|'nurse_unavailable'|'other_clinic'|'not_enrolled';
