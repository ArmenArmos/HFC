import {z} from 'zod';
const count = z.number().int().nonnegative().safe();
export const realOperationsSummarySchema = z.object({
  asOf:z.iso.datetime({offset:true}),
  cases:z.object({total:count,doctorAssigned:count,doctorUnassigned:count,nurseAssigned:count,nurseUnassigned:count})
    .refine(c=>c.total===c.doctorAssigned+c.doctorUnassigned && c.total===c.nurseAssigned+c.nurseUnassigned),
  bookings:z.object({total:count,requested:count,providerProposed:count,confirmed:count,changePending:count,cancelled:count})
    .refine(b=>b.total===b.requested+b.providerProposed+b.confirmed+b.changePending+b.cancelled),
  coordination:z.object({total:count,open:count,awaitingMember:count,awaitingDoctor:count,completed:count,cancelled:count,needsReassignment:count})
    .refine(t=>t.total===t.open+t.awaitingMember+t.awaitingDoctor+t.completed+t.cancelled && t.needsReassignment<=t.open+t.awaitingMember+t.awaitingDoctor),
});
export type RealOperationsSummary = z.infer<typeof realOperationsSummarySchema>;
export type RealOperationsSummaryView = {status:'available';summary:RealOperationsSummary}|{status:'unavailable'};
export async function readRealOperationsSummary(read:()=>PromiseLike<{data:unknown;error:unknown}>):Promise<RealOperationsSummaryView> {
  try {
    const result=await read();
    if(result.error) return {status:'unavailable'};
    const parsed=realOperationsSummarySchema.safeParse(result.data);
    return parsed.success?{status:'available',summary:parsed.data}:{status:'unavailable'};
  } catch {return {status:'unavailable'};}
}
