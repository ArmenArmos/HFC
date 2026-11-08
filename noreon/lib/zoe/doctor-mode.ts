import {z} from 'zod';

/**
 * Doctor takeover (Armen 20 Oct; 20261020082321). The doctor's reply in a member's conversation switches it to doctor mode:
 * Zoe stops writing there (the urgent/103 text, the 103 window and the red flags still answer at once) until the assigned
 * doctor hands it back to Zoe. The database decides and records it (doctor_zoe_mode, doctor_zoe_hand_back); this file only
 * parses and words it for the conversation page.
 */
export const doctorModeSchema=z.object({ok:z.literal(true),doctorMode:z.boolean(),zoeActive:z.boolean(),since:z.string().nullable(),byName:z.string().nullable(),intakePaused:z.boolean(),
 /** zoe_settings.doctor_takeover_scope (20261021070207): 'topic' = the doctor has only their topic; absent before that migration. */
 scope:z.enum(['topic','conversation']).default('conversation')});
/** The member's "New question" dividers for the conversation page (doctor_conversation_topic_breaks). */
export const topicBreaksSchema=z.object({ok:z.literal(true),breaks:z.array(z.object({afterSeq:z.number().int(),at:z.string()}))});
export type DoctorModeView=z.infer<typeof doctorModeSchema>;

const handBackResult=z.object({ok:z.literal(true),replayed:z.boolean(),notified:z.boolean().optional()});
export const handBackNotices=['handed_back','already_zoe','unavailable']as const;
export type HandBackNotice=typeof handBackNotices[number];
export const handBackNoticeText:Record<HandBackNotice,string>={
 handed_back:'Zoe is answering this member again. They were told.',
 already_zoe:'Zoe was already answering this member. Nothing changed.',
 unavailable:'That did not go through. Reload and try again.',
};
export const parseHandBackNotice=(v:unknown):HandBackNotice|null=>typeof v==='string'&&(handBackNotices as readonly string[]).includes(v)?v as HandBackNotice:null;

/** Calls doctor_zoe_hand_back once for a valid member id and says what happened. Never retries. */
export async function handBackToZoe(ports:{handBack:(memberId:string)=>Promise<unknown>},memberId:unknown):Promise<HandBackNotice>{
 const id=z.uuid().safeParse(memberId);
 if(!id.success)return 'unavailable';
 const r=handBackResult.safeParse(await ports.handBack(id.data));
 if(!r.success)return 'unavailable';
 return r.data.replayed?'already_zoe':'handed_back';
}

/**
 * The 103 window on the conversation page (20261020182719): open, since when, and whether a model alone or a fixed rule
 * opened it. The assigned doctor may clear it (doctor_zoe_clear_urgent): Zoe stops repeating the 103 text. Audited; the
 * member is sent nothing and the care alert stays for review. Never offered to members (the database refuses them).
 */
export const urgentWindowSchema=z.object({ok:z.literal(true),open:z.boolean(),since:z.string().nullable(),openedBy:z.enum(['model','rule']).nullable()});
export type UrgentWindowView=z.infer<typeof urgentWindowSchema>;
const clearResult=z.object({ok:z.literal(true),replayed:z.boolean()});
export const clearUrgentNotices=['urgent_cleared','urgent_not_open','urgent_unavailable']as const;
export type ClearUrgentNotice=typeof clearUrgentNotices[number];
export const clearUrgentNoticeText:Record<ClearUrgentNotice,string>={
 urgent_cleared:'The 103 alert is cleared. Zoe answers this member normally again; the care alert stays for review.',
 urgent_not_open:'There was no open 103 alert. Nothing changed.',
 urgent_unavailable:'That did not go through. Reload and try again.',
};
export const parseClearUrgentNotice=(v:unknown):ClearUrgentNotice|null=>typeof v==='string'&&(clearUrgentNotices as readonly string[]).includes(v)?v as ClearUrgentNotice:null;
/** Calls doctor_zoe_clear_urgent once for a valid member id and says what happened. Never retries. */
export async function clearUrgentWindow(ports:{clear:(memberId:string)=>Promise<unknown>},memberId:unknown):Promise<ClearUrgentNotice>{
 const id=z.uuid().safeParse(memberId);
 if(!id.success)return 'urgent_unavailable';
 const r=clearResult.safeParse(await ports.clear(id.data));
 if(!r.success)return 'urgent_unavailable';
 return r.data.replayed?'urgent_not_open':'urgent_cleared';
}
