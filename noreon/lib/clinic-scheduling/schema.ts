import{z}from'zod';
import{TEST_CATALOGUE}from'@/lib/clinical/seed/tests';
type Environment=Record<string,string|undefined>;
/** Clinic-portal scheduling (dark). The database switch clinic_scheduling_capabilities must also be on. */
export function clinicSchedulingEnabled(env:Environment=process.env){return env.NOREON_CLINIC_SCHEDULING_ENABLED==='true'&&env.NOREON_CLINIC_PORTAL_ENABLED==='true';}

/** Yerevan calendar day (UTC+4, no daylight saving) as YYYY-MM-DD. */
export const yerevanDay=(value:number|string)=>new Date((typeof value==='string'?Date.parse(value):value)+4*3600000).toISOString().slice(0,10);
const id=z.uuid(),stamp=z.iso.datetime({offset:true}),revision=z.number().int().nonnegative().safe();
export const bookingStatusSchema=z.enum(['requested','change-requested','confirmed','arrived','no-show','completed','declined','cancelled','other']);
export type ClinicBookingStatus=z.infer<typeof bookingStatusSchema>;
export const statusFilters=['requested','confirmed','arrived','no-show','declined','cancelled'] as const;
export type StatusFilter=typeof statusFilters[number];
export const clinicBookingSchema=z.strictObject({
 appointmentId:id,memberId:id.optional(),revision,reference:id,kind:z.enum(['pending','current','history']),status:bookingStatusSchema,channel:z.enum(['portal','email']),
 memberName:z.string().max(200),memberPhone:z.null(),startsAt:stamp,endsAt:stamp,previousStartsAt:stamp.nullable(),previousEndsAt:stamp.nullable(),
 tests:z.array(z.string().max(500)).max(100),
 proposal:z.strictObject({id,startsAt:stamp,endsAt:stamp,note:z.string().max(500).nullable(),createdAt:stamp}).nullable(),
 /** The clinic's latest proposal, rejected by the member, until the clinic acts on the booking again. */
 rejectedProposal:z.strictObject({id,startsAt:stamp,endsAt:stamp,rejectedAt:stamp}).nullable().default(null),
 decline:z.strictObject({reason:z.string().max(500),at:stamp}).nullable(),
});
export type ClinicBooking=z.infer<typeof clinicBookingSchema>;
export const clinicBookingsSchema=z.union([
 z.strictObject({version:z.literal('clinic-schedule-bookings-v1'),enabled:z.literal(false),bookings:z.array(z.never()).max(0)}),
 z.strictObject({version:z.literal('clinic-schedule-bookings-v1'),enabled:z.literal(true),role:z.enum(['admin','staff']),bookings:z.array(clinicBookingSchema).max(300)}),
]);
export const freeSlotsSchema=z.array(z.strictObject({key:z.string().regex(/^[a-f0-9]{64}$/),startsAt:stamp,endsAt:stamp,free:z.number().int().positive()})).max(200);
export type FreeSlot=z.infer<typeof freeSlotsSchema>[number];

const commandBase={version:z.literal('clinic-schedule-command-v1'),submissionId:id,appointmentId:id,revision};
export const scheduleCommandSchema=z.discriminatedUnion('op',[
 z.strictObject({...commandBase,op:z.literal('confirm')}),
 z.strictObject({...commandBase,op:z.literal('decline'),reason:z.string().trim().min(3).max(500)}),
 z.strictObject({...commandBase,op:z.literal('propose'),slotKey:z.string().regex(/^[a-f0-9]{64}$/),note:z.string().trim().max(500).nullable()}),
 z.strictObject({...commandBase,op:z.literal('withdraw-proposal'),proposalId:id}),
 z.strictObject({...commandBase,op:z.literal('check-in'),outcome:z.enum(['arrived','no-show'])}),
]);
export type ScheduleCommand=z.infer<typeof scheduleCommandSchema>;
export const scheduleResultSchema=z.union([
 z.strictObject({status:z.literal('saved'),booking:clinicBookingSchema.nullable()}),
 z.strictObject({status:z.enum(['invalid','stale','past','full','early','unavailable','access','conflict','disabled'])}),
]);
export type ScheduleResult=z.infer<typeof scheduleResultSchema>|{status:'unknown'};

const time=z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/);
export const hoursSchema=z.strictObject({weekday:z.number().int().min(1).max(7),opens:time,closes:time}).refine(h=>h.closes>h.opens,'Closing time must be after opening time');
export const scheduleSettingsSchema=z.strictObject({
 version:z.literal('clinic-schedule-settings-v1'),enabled:z.boolean(),canEdit:z.boolean(),clinic:z.strictObject({name:z.string(),address:z.string()}),
 schedule:z.strictObject({active:z.boolean(),slotMinutes:z.number().int(),capacity:z.number().int(),coveredTestIds:z.array(z.string()),followUpTestIds:z.array(z.string()),
  preparation:z.string(),revision:z.number().int().positive().safe(),updatedAt:stamp,hours:z.array(hoursSchema).max(7)}).nullable(),
});
export type ScheduleSettings=z.infer<typeof scheduleSettingsSchema>;
/** Tests a clinic can do at a visit: every catalogue test except home tracking. */
export const clinicTests=TEST_CATALOGUE.filter(test=>test.method!=='home_log').map(test=>({id:test.id,en:test.name.en,hy:test.name.hy}));
const testNames=new Map(TEST_CATALOGUE.flatMap(test=>[[test.name.en,test.name],[test.name.hy,test.name]] as const));
/** A booking's test title (the catalogue's English name, sealed at booking) in the clinic's language; an unknown title stays as stored (night QA F-3). */
export const clinicTestTitle=(title:string,locale:'en'|'hy')=>testNames.get(title)?.[locale]??title;
const known=new Set(clinicTests.map(test=>test.id));
export const settingsInputSchema=z.strictObject({
 expectedRevision:revision,active:z.boolean(),slotMinutes:z.number().int().min(10).max(240),capacity:z.number().int().min(1).max(50),
 coveredTestIds:z.array(z.string()).min(1).max(50).refine(ids=>ids.every(i=>known.has(i))&&new Set(ids).size===ids.length,'Choose tests from the list'),
 preparation:z.string().trim().min(1).max(2000),hours:z.array(hoursSchema).max(7).refine(h=>new Set(h.map(x=>x.weekday)).size===h.length,'One opening period per day'),
});
export type SettingsInput=z.infer<typeof settingsInputSchema>;
/** Tests the clinic does not do are arranged separately by Noreon; the database needs them listed. */
export function followUpTestIds(covered:string[]){return clinicTests.map(test=>test.id).filter(testId=>!covered.includes(testId));}
export type SettingsResult={status:'saved';settings:ScheduleSettings}|{status:'invalid'|'stale'|'address-required'|'disabled'|'unavailable'|'unknown'|'access'};

export const teamSchema=z.strictObject({version:z.literal('clinic-team-v1'),members:z.array(z.strictObject({membershipId:id,displayName:z.string(),role:z.enum(['admin','staff']),active:z.boolean(),revision:z.number().int().positive().safe(),self:z.boolean()})).max(200)});
export type ClinicTeam=z.infer<typeof teamSchema>;
export const teamCommandSchema=z.strictObject({membershipId:id,expectedRevision:z.number().int().positive().safe(),role:z.enum(['admin','staff']),active:z.boolean()});
export type TeamCommand=z.infer<typeof teamCommandSchema>;
export type TeamResult={status:'saved'|'invalid'|'self'|'stale'|'last-admin'|'noreon-only'|'unavailable'|'unknown'|'access'};
