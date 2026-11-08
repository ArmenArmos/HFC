import {z} from 'zod';

export const memberSearchCursorSchema=z.strictObject({createdAt:z.iso.datetime({offset:true}),id:z.uuid()});
export const memberSearchInputSchema=z.strictObject({
 query:z.string().max(100).refine(value=>!/[\u0000-\u001f\u007f]/.test(value)).transform(value=>value.trim()).refine(value=>{
  if(!value)return true;
  if(/^[0-9\s()+.\-]+$/.test(value))return value.replace(/\D/g,'').length>=4&&value.replace(/\D/g,'').length<=15;
  return [...value].length>=2;
 }),
 cursor:memberSearchCursorSchema.nullable(),
});
export const memberIdentityFields={
 name:z.string().nullable(),birthDate:z.iso.date().nullable().optional(),birthYear:z.number().int().nullable().optional(),phoneLast4:z.string().regex(/^[0-9]{4}$/).nullable().optional(),shortId:z.string().nullable().optional(),
};
export const memberSearchRowSchema=z.strictObject({
 id:z.uuid(),...memberIdentityFields,revision:z.number().int().nonnegative(),doctorId:z.uuid().nullable(),nurseId:z.uuid().nullable(),createdAt:z.iso.datetime({offset:true}),
 // Added by the app from staff_test_account_flags, never by the search function.
 testAccount:z.boolean().optional(),
 bookingCounts:z.strictObject({requested:z.number().int().nonnegative(),providerProposed:z.number().int().nonnegative(),confirmed:z.number().int().nonnegative(),changePending:z.number().int().nonnegative()}),
});
export const memberSearchPageSchema=z.strictObject({rows:z.array(memberSearchRowSchema).max(50),hasMore:z.boolean(),nextCursor:memberSearchCursorSchema.nullable()}).superRefine((page,ctx)=>{
 const last=page.rows.at(-1);
 if(page.hasMore?(!last||!page.nextCursor||page.nextCursor.id!==last.id||page.nextCursor.createdAt!==last.createdAt):page.nextCursor!==null)ctx.addIssue({code:'custom',message:'Inconsistent paging boundary'});
 if(new Set(page.rows.map(row=>row.id)).size!==page.rows.length)ctx.addIssue({code:'custom',message:'Duplicate member'});
});
export type MemberSearchInput=z.infer<typeof memberSearchInputSchema>;
export type MemberSearchRow=z.infer<typeof memberSearchRowSchema>;
export type MemberSearchPage=z.infer<typeof memberSearchPageSchema>;
export type MemberSearchResult={ok:true;page:MemberSearchPage}|{ok:false;reason:'invalid'|'unavailable'};

export const staffMemberIdentitySchema=z.strictObject({id:z.uuid(),...memberIdentityFields});
export const staffMemberIdentitiesSchema=z.array(staffMemberIdentitySchema).max(50);
export const staffMemberIdentityIdsSchema=z.array(z.uuid()).max(50);
export type StaffMemberIdentity=z.infer<typeof staffMemberIdentitySchema>;
