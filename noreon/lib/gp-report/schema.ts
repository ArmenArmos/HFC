import {z} from 'zod';

/** The rows doctor_gp_report_source returns. Every row keeps its own dates so the
 * report can cite each value with its source and time. */
const instant=z.string().min(1);
const nullableInstant=instant.nullable();
const reading=z.object({id:z.string(),systolic:z.number().int(),diastolic:z.number().int(),pulse:z.number().int().nullable(),measuredAt:instant});

export const gpReportSourceSchema=z.object({
 resultEntries:z.array(z.object({field:z.enum(['score2_percent','potassium','ecg_lvh','ecg_ischaemia','echo_done','ahi']),number:z.number().finite().nullable(),finding:z.enum(['yes','no']).nullable(),observedOn:z.iso.date(),enteredAt:instant,enteredByName:z.string()})).default([]),
 profile:z.object({name:z.string().nullable(),birthDate:z.string().nullable(),biologicalSex:z.string().nullable()}).nullable(),
 assessment:z.object({answers:z.record(z.string(),z.unknown()),assessmentDate:z.string().nullable(),algorithmVersion:z.string().nullable(),completedAt:nullableInstant,urgentRule:z.string().nullable(),updatedAt:nullableInstant}).nullable(),
 homeReadings:z.array(reading.extend({recordedAt:instant})),
 deviceReadings:z.array(reading.extend({receivedAt:instant,transport:z.string()})),
 visitObservations:z.array(z.object({id:z.string(),visitId:z.string(),field:z.string().nullable(),state:z.string().nullable(),value:z.unknown(),unit:z.string().nullable(),observedAt:nullableInstant,recordedAt:instant,actorName:z.string().nullable(),clinic:z.string().nullable()})),
 labResults:z.array(z.object({id:z.string(),marker:z.string(),value:z.number(),unit:z.string(),referenceLow:z.number().nullable(),referenceHigh:z.number().nullable(),referenceText:z.string().nullable(),collectedAt:instant,receivedAt:nullableInstant,source:z.enum(['clinic','laboratory','member']),sourceLabel:z.string().nullable(),reviewedAt:nullableInstant,reviewedBy:z.string().nullable(),sourceReportId:z.string().nullable()})),
 /** Clinic lab PDF values read by AI. Only 'verified' and 'corrected' rows (checked by the assigned
  * doctor) carry a value; 'unverified' rows carry the test name only. */
 clinicLabValues:z.array(z.object({id:z.string(),fileId:z.string(),status:z.enum(['verified','corrected','unverified']),testName:z.string(),catalogueRef:z.string().nullable(),
  value:z.number().nullable(),valueText:z.string().nullable(),unit:z.string().nullable(),referenceLow:z.number().nullable(),referenceHigh:z.number().nullable(),referenceText:z.string().nullable(),
  collectedOn:z.string().nullable(),attachedAt:instant,clinic:z.string().nullable(),reviewedAt:nullableInstant,reviewedBy:z.string().nullable()})
  // Fail closed: an unchecked row that carries a value is refused, so it can never be printed.
  .refine(v=>v.status!=='unverified'||(v.value===null&&v.valueText===null&&v.unit===null&&v.reviewedAt===null))
  .refine(v=>v.status==='unverified'||(v.reviewedAt!==null&&(v.value!==null||v.valueText!==null))))
  .default([]),
 sourceReports:z.array(z.object({id:z.string(),state:z.string(),uploadedAt:instant,confirmedAt:nullableInstant,reportDate:z.string().nullable(),laboratory:z.string().nullable()})),
 clinicDocuments:z.array(z.object({id:z.string(),attachedAt:instant,clinic:z.string().nullable()})),
 tests:z.array(z.object({id:z.string(),title:z.string(),status:z.enum(['ordered','collected','cancelled']),orderedAt:nullableInstant,dueAt:nullableInstant,source:z.string()})),
 plans:z.array(z.object({planId:z.string(),version:z.number().int().nullable(),clinician:z.string().nullable(),publishedAt:instant,instructions:z.string().nullable(),active:z.boolean(),retiredAt:nullableInstant,changeSummary:z.string().nullable()})),
 medications:z.array(z.object({id:z.string(),planId:z.string().nullable(),name:z.string(),dose:z.string().nullable(),instructions:z.string().nullable(),times:z.array(z.string()).nullable(),startDate:z.string().nullable(),endDate:z.string().nullable(),active:z.boolean(),effectiveAt:nullableInstant})),
 alerts:z.array(z.object({id:z.string(),source:z.string(),reasonCode:z.string(),redFlags:z.array(z.string()).nullable(),ruleId:z.string(),ruleVersion:z.string(),state:z.enum(['open','acknowledged','resolved']),createdAt:instant,lastSeenAt:nullableInstant,acknowledgedAt:nullableInstant,resolvedAt:nullableInstant,resolution:z.string().nullable()})),
 consultation:z.object({decision:z.string().nullable(),completedAt:z.string().nullable(),arrangement:z.object({holdSince:nullableInstant,scheduledAt:nullableInstant,channel:z.string().nullable()}).nullable()}).nullable(),
});
export type GpReportSource=z.infer<typeof gpReportSourceSchema>;

export const gpReportVersionMetaSchema=z.object({version:z.number().int().positive(),approvedAt:instant,approvedByName:z.string(),contentSha256:z.string(),sourceToken:z.string().optional()});
export type GpReportVersionMeta=z.infer<typeof gpReportVersionMetaSchema>;

export const gpReportReadSchema=z.discriminatedUnion('enabled',[
 z.object({enabled:z.literal(false)}),
 z.object({enabled:z.literal(true),memberId:z.uuid(),token:z.string().regex(/^[0-9a-f]{32}$/),readAt:instant,source:gpReportSourceSchema,doctorName:z.string().nullable(),versions:z.array(gpReportVersionMetaSchema)}),
]);
export type GpReportRead=z.infer<typeof gpReportReadSchema>;
