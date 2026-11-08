import {z} from 'zod';
import {zoeRunsSchema,type ZoeRunView} from '@/lib/zoe/contracts';
import {symptomIntakesSchema,type SymptomIntakeView} from '@/lib/zoe/symptoms/contracts';
import {traceEventSchema,type TraceEvent} from '@/lib/conversation-trace/contracts';

/** Admin read-only conversation oversight (admin_conversation_list / admin_conversation_read). */
export const adminConversationFilters=['needs_reply','intake_active','urgent_today']as const;
export type AdminConversationFilter=typeof adminConversationFilters[number];
export const parseAdminConversationFilter=(value:unknown):AdminConversationFilter|null=>
 typeof value==='string'&&(adminConversationFilters as readonly string[]).includes(value)?value as AdminConversationFilter:null;
export const adminConversationFilterLabel:Record<AdminConversationFilter,string>={needs_reply:'Needs reply',intake_active:'Zoe intake active',urgent_today:'Urgent today'};

const id=z.uuid().transform(value=>value.toLowerCase());
const channel=z.enum(['telegram','app']);
export const adminConversationListSchema=z.strictObject({ok:z.literal(true),enabled:z.boolean(),items:z.array(z.strictObject({
 memberId:id,memberName:z.string(),doctorName:z.string().nullable(),lastActivityAt:z.string().nullable(),lastMemberMessageAt:z.string().nullable(),
 channel:channel.nullable(),needsReply:z.boolean(),intakeActive:z.boolean(),urgentToday:z.boolean(),
}))});
export type AdminConversationList=z.infer<typeof adminConversationListSchema>;

const runSchema=zoeRunsSchema.shape.runs.element;
const intakeSchema=symptomIntakesSchema.shape.intakes.element;
/** One unreadable row (for example a run outcome added by a later migration) is dropped, not the whole page. */
const tolerant=<T,>(schema:z.ZodType<T>)=>z.array(z.unknown()).transform(rows=>rows.flatMap(row=>{const r=schema.safeParse(row);return r.success?[r.data]:[];}));

export const adminConversationReadSchema=z.union([
 z.strictObject({ok:z.literal(false),code:z.enum(['disabled','not_found'])}),
 z.strictObject({ok:z.literal(true),memberId:id,asOf:z.string(),memberName:z.string(),doctorName:z.string().nullable(),conversationId:id.nullable(),
  window:z.strictObject({before:z.string().nullable(),from:z.string().nullable(),olderBefore:z.string().nullable()}),
  messages:z.array(z.strictObject({seq:z.number().int(),text:z.string(),at:z.string(),channel})),
  zoeAnswers:z.array(z.strictObject({id,kind:z.string(),text:z.string(),at:z.string(),messageSeq:z.number().int(),telegramState:z.string().nullable(),heldReason:z.string().nullable()})),
  replies:z.array(z.strictObject({approvalId:id,text:z.string(),at:z.string(),doctorName:z.string(),deliveryState:z.string().nullable(),deliveryReason:z.string().nullable()})),
  drafts:z.array(z.strictObject({id,state:z.enum(['pending','approved','rejected','info_requested','superseded']),createdAt:z.string(),contextVersion:z.number().int(),revisions:z.number().int(),
   latest:z.strictObject({revision:z.number().int(),text:z.string(),summary:z.string(),authorKind:z.enum(['staff','ai_assistant']),authorName:z.string().nullable(),at:z.string()}).nullable()})),
  zoeRunsTotal:z.number().int(),zoeRuns:tolerant<ZoeRunView>(runSchema),
  intakesTotal:z.number().int(),intakes:tolerant<SymptomIntakeView>(intakeSchema),
  traceTotal:z.number().int(),trace:tolerant<TraceEvent>(traceEventSchema),
 }),
]);
/** An older-page cursor from the database: an ISO timestamp, nothing else. */
export const parseBeforeCursor=(value:unknown)=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}[T ][0-9:.]+([+-]\d{2}(:?\d{2})?|Z)$/.test(value)&&!Number.isNaN(Date.parse(value.replace(' ','T')))?value:null;
export type AdminConversationRead=z.infer<typeof adminConversationReadSchema>;
export type AdminConversation=Extract<AdminConversationRead,{ok:true}>;

/** One time-ordered thread: what the member wrote, what Zoe answered, what the doctor approved. */
export type ThreadItem=
 |{kind:'member';key:string;at:string;text:string;channel:'telegram'|'app';seq:number}
 |{kind:'zoe';key:string;at:string;text:string;answerKind:string;messageSeq:number;telegramState:string|null;heldReason:string|null}
 |{kind:'doctor';key:string;at:string;text:string;doctorName:string;deliveryState:string|null;deliveryReason:string|null};
export function adminThread(view:AdminConversation):ThreadItem[]{
 const items:ThreadItem[]=[
  ...view.messages.map(m=>({kind:'member'as const,key:`m${m.seq}`,at:m.at,text:m.text,channel:m.channel,seq:m.seq})),
  ...view.zoeAnswers.map(a=>({kind:'zoe'as const,key:`z${a.id}`,at:a.at,text:a.text,answerKind:a.kind,messageSeq:a.messageSeq,telegramState:a.telegramState,heldReason:a.heldReason})),
  ...view.replies.map(r=>({kind:'doctor'as const,key:`d${r.approvalId}`,at:r.at,text:r.text,doctorName:r.doctorName,deliveryState:r.deliveryState,deliveryReason:r.deliveryReason})),
 ];
 return items.sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)||a.key.localeCompare(b.key));
}

export const zoeAnswerKindLabel=(kind:string)=>({answer:'Zoe answer',intake:'Zoe intake question',urgent:'Zoe urgent advice',chat:'Zoe chat reply',receipt:'Zoe receipt',deflection:'Zoe hand-off to the doctor'} as Record<string,string>)[kind]??`Zoe (${kind.replace(/[_.-]+/g,' ')})`;
export const deliveryStateLabel=(state:string|null)=>state===null?'Not queued':({queued:'Queued',held:'Held',sending:'Sending',accepted_by_provider:'Delivered to Telegram',definitely_failed:'Not delivered',unknown:'Delivery unknown'} as Record<string,string>)[state]??state;
export const draftStateLabel:Record<AdminConversation['drafts'][number]['state'],string>={pending:'Waiting for the doctor',approved:'Approved',rejected:'Rejected',info_requested:'More information requested',superseded:'Replaced by a newer draft'};
