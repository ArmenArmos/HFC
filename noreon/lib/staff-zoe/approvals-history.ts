import {z} from 'zod';
import {yerevanInputNow,yerevanInputToInstant} from '@/lib/staff/yerevan-time';

export const approvalsDaySchema=z.enum(['today','yesterday']);
export type ApprovalsDay=z.infer<typeof approvalsDaySchema>;
const row={at:z.iso.datetime({offset:true}),memberId:z.uuid(),memberName:z.string()};
export const approvalsHistorySchema=z.object({
 ok:z.literal(true),asOf:z.iso.datetime({offset:true}),hasMore:z.boolean(),
 rows:z.array(z.discriminatedUnion('kind',[
  z.object({...row,kind:z.literal('reply'),state:z.enum(['queued','held','sending','accepted_by_provider','definitely_failed','unknown']),excerpt:z.string().refine(value=>Array.from(value).length<=80)}),
  z.object({...row,kind:z.literal('lab_review'),state:z.enum(['confirm','correct','reject'])}),
  z.object({...row,kind:z.literal('plan'),state:z.literal('published')}),
  z.object({...row,kind:z.literal('upload'),state:z.literal('approved')}),
  z.object({...row,kind:z.literal('alert'),state:z.enum(['acknowledged','resolved'])}),
 ])).max(100),
});
export type ChatApprovalsResponse={kind:'approvals_history';day:ApprovalsDay}&z.infer<typeof approvalsHistorySchema>
 |{kind:'unavailable'}|{kind:'refused'};

/** Half-open Asia/Yerevan calendar day, including month and year rollover. */
export function approvalsDayWindow(day:ApprovalsDay,now=Date.now()){
 const midnight=Date.parse(yerevanInputToInstant(`${yerevanInputNow(now).slice(0,10)}T00:00`)!);
 const since=midnight-(day==='yesterday'?86_400_000:0);
 return {p_since:new Date(since).toISOString(),p_until:new Date(since+86_400_000).toISOString()};
}
