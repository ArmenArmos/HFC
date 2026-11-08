import{z}from'zod';

/** Shapes returned by the pilot_* database functions. The database enforces every
 * rule; these schemas only refuse a response the screens do not expect. */
const uuid=z.uuid(),instant=z.iso.datetime({offset:true}),day=z.iso.date();
export const priceSources=['staging-placeholder','partner-approved'] as const;
export type PriceSource=typeof priceSources[number];
export const paymentStatuses=['pending','paid','failed','refunded','waived'] as const;
export type PaymentStatus=typeof paymentStatuses[number];

const priceSchema=z.strictObject({id:uuid,priceAmd:z.number().int().nonnegative(),source:z.enum(priceSources),effectiveFrom:instant,recordedAt:instant,recordedBy:z.string(),reason:z.string()});
export const adminCatalogTestSchema=z.strictObject({id:uuid,testKey:z.string(),partnerCode:z.string(),nameEn:z.string(),nameHy:z.string(),includedInPackage:z.boolean(),
 activeFrom:day,activeUntil:day.nullable(),revision:z.number().int().positive(),active:z.boolean(),currentPrice:priceSchema.nullable(),prices:z.array(priceSchema)});
export const adminCatalogSchema=z.strictObject({asOf:instant,tests:z.array(adminCatalogTestSchema)});
export const memberCatalogSchema=z.strictObject({asOf:instant,tests:z.array(z.strictObject({testKey:z.string(),nameEn:z.string(),nameHy:z.string(),
 includedInPackage:z.boolean(),priceAmd:z.number().int().nonnegative().nullable(),priceSource:z.enum(priceSources).nullable()}))});
export type AdminCatalogTest=z.infer<typeof adminCatalogTestSchema>;
export type MemberCatalog=z.infer<typeof memberCatalogSchema>;

export const paymentLineSchema=z.strictObject({testKey:z.string(),partnerCode:z.string(),nameEn:z.string(),nameHy:z.string(),includedInPackage:z.boolean(),
 priceAmd:z.number().int().nonnegative(),chargedAmd:z.number().int().nonnegative(),priceId:uuid,priceSource:z.enum(priceSources)});
const eventSchema=z.strictObject({kind:z.enum(['created','status','reference']),fromStatus:z.enum(paymentStatuses).nullable(),toStatus:z.enum(paymentStatuses).nullable(),
 actorKind:z.enum(['admin','provider']),actorName:z.string(),reason:z.string().nullable(),providerReference:z.string().nullable(),at:instant});
const paymentBase={id:uuid,memberId:uuid,bookingKind:z.enum(['test-request','appointment']),bookingId:uuid,amountAmd:z.number().int().nonnegative(),currency:z.literal('AMD'),
 lines:z.array(paymentLineSchema),priceBasis:z.enum(priceSources),status:z.enum(paymentStatuses),revision:z.number().int().positive(),createdAt:instant,updatedAt:instant};
export const memberPaymentSchema=z.strictObject(paymentBase);
export const adminPaymentSchema=z.strictObject({...paymentBase,provider:z.string(),providerReference:z.string().nullable(),events:z.array(eventSchema)});
export const memberPaymentsSchema=z.strictObject({payments:z.array(memberPaymentSchema)});
export const adminPaymentsSchema=z.strictObject({asOf:instant,bookings:z.array(z.strictObject({
 bookingKind:z.enum(['test-request','appointment']),bookingId:uuid,bookingStatus:z.string(),bookedAt:instant,memberId:uuid,memberName:z.string(),
 payment:adminPaymentSchema.nullable(),
 preview:z.strictObject({lines:z.array(paymentLineSchema),unpriced:z.array(z.strictObject({testKey:z.string().nullable(),title:z.string().nullable()})),totalAmd:z.number().int().nonnegative(),priceBasis:z.enum(priceSources)}).nullable()}))});
export type MemberPayment=z.infer<typeof memberPaymentSchema>;
export type AdminPayment=z.infer<typeof adminPaymentSchema>;
export type AdminPayments=z.infer<typeof adminPaymentsSchema>;
export type PaymentLine=z.infer<typeof paymentLineSchema>;

const n=z.number().int().nonnegative();
export const gmOverviewSchema=z.strictObject({asOf:instant,from:day,to:day,
 enrolled:z.strictObject({total:n,inRange:n}),booked:z.strictObject({members:n,testRequests:n,appointments:n}),cancelled:n,
 visits:z.strictObject({recorded:n,members:n}),results:z.strictObject({receivedMembers:n,releasedMembers:n}),
 bp:z.strictObject({manualReadings:n,deviceReadings:n,membersWithReadings:n}),awaitingReply:n,
 payments:z.strictObject({pending:n,paid:n,failed:n,refunded:n,waived:n,paidAmd:n,staging:n}),
 unassignedMembers:n,doctors:z.array(z.strictObject({name:z.string(),assignedMembers:n,awaitingReply:n}))});
export type GmOverview=z.infer<typeof gmOverviewSchema>;

const text=(max:number)=>z.string().trim().min(1).max(max);
const base={submissionId:uuid};
const testFields={partnerCode:z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/),nameEn:text(200),nameHy:text(200),includedInPackage:z.boolean(),
 activeFrom:day,activeUntil:day.nullable(),reason:text(500)};
export const pilotCommandSchema=z.discriminatedUnion('action',[
 z.strictObject({...base,action:z.literal('create-test'),testKey:z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,63}$/),...testFields,
  priceAmd:z.number().int().min(0).max(10_000_000).nullable(),priceSource:z.enum(priceSources)}),
 z.strictObject({...base,action:z.literal('update-test'),testId:uuid,revision:z.number().int().positive(),...testFields}),
 z.strictObject({...base,action:z.literal('set-price'),testId:uuid,priceAmd:z.number().int().min(0).max(10_000_000),priceSource:z.enum(priceSources),effectiveFrom:instant.nullable(),reason:text(500)}),
 z.strictObject({...base,action:z.literal('create-payment'),bookingKind:z.enum(['test-request','appointment']),bookingId:uuid}),
 z.strictObject({...base,action:z.literal('set-reference'),paymentId:uuid,revision:z.number().int().positive(),provider:z.string().regex(/^[a-z0-9-]{1,40}$/),reference:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/),reason:text(500).nullable()}),
 z.strictObject({...base,action:z.literal('set-status'),paymentId:uuid,revision:z.number().int().positive(),status:z.enum(paymentStatuses),reason:text(500),reference:z.string().trim().max(200).nullable()}),
]);
export type PilotCommand=z.infer<typeof pilotCommandSchema>;
export const pilotResultSchema=z.object({status:z.enum(['saved','invalid','stale','access','unavailable','conflict','exists','unchanged','unpriced','not-found','booking-cancelled','converted','nothing-to-pay']),
 replayed:z.boolean().optional(),paymentId:uuid.optional(),testId:uuid.optional(),current:z.string().optional(),unpriced:z.array(z.object({testKey:z.string().nullable(),title:z.string().nullable()})).optional()});
export type PilotResult=z.infer<typeof pilotResultSchema>|{status:'disabled'|'outcome-unknown'};
