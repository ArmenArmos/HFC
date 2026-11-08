import {z} from 'zod';

/**
 * WP R: realtime signals. A signal (public.realtime_signals) says only that something the recipient can read changed:
 * a kind and an opaque id, never health content. The client re-reads through the existing reads, which stay the
 * source of truth (versions, pollMayReplace); polling stays as the fallback, slower while the socket is healthy.
 * Framework-free: shared by the token route, the browser client and the checks.
 */
export const SIGNAL_KINDS=['member_thread','member_cards','staff_thread','staff_notice','care_alert','worklist','clinic_thread','caregiver_notice'] as const;
export type SignalKind=typeof SIGNAL_KINDS[number];
export const isSignalKind=(value:unknown):value is SignalKind=>typeof value==='string'&&(SIGNAL_KINDS as readonly string[]).includes(value);

/** The three session planes use different cookies (member phone session, staff, clinic portal). */
export const REALTIME_PLANES=['member','staff','clinic'] as const;
export type RealtimePlane=typeof REALTIME_PLANES[number];
export const isRealtimePlane=(value:unknown):value is RealtimePlane=>typeof value==='string'&&(REALTIME_PLANES as readonly string[]).includes(value);

/** Where the browser asks for its socket token (POST, same origin, no-store). */
export const REALTIME_TOKEN_URL='/api/realtime/token';
export const realtimeTokenSchema=z.strictObject({accessToken:z.string().min(20).max(8192),userId:z.uuid(),expiresAt:z.number().int().positive()});
export type RealtimeToken=z.infer<typeof realtimeTokenSchema>;

/** The new row Realtime delivers (postgres_changes INSERT). Only these columns exist. */
export const signalRowSchema=z.object({id:z.union([z.number(),z.string()]),recipient_user_id:z.uuid(),kind:z.string(),ref_id:z.string().nullable(),created_at:z.string()});
export type Signal={kind:SignalKind;ref:string|null};
/** A delivered row for this user, or null (another recipient, an unknown kind, a malformed row). */
export function parseSignal(row:unknown,userId:string):Signal|null{
 const parsed=signalRowSchema.safeParse(row);
 if(!parsed.success||parsed.data.recipient_user_id!==userId||!isSignalKind(parsed.data.kind))return null;
 return {kind:parsed.data.kind,ref:parsed.data.ref_id};
}

/** Kinds that show an inline notice at the top of a conversation; care alerts are urgent (role=alert). */
export const NOTICE_KINDS=['care_alert','staff_notice','worklist','caregiver_notice'] as const satisfies readonly SignalKind[];
export type NoticeKind=typeof NOTICE_KINDS[number];
export const isNoticeKind=(kind:SignalKind):kind is NoticeKind=>(NOTICE_KINDS as readonly string[]).includes(kind);
export const urgentNotice=(kind:NoticeKind)=>kind==='care_alert';

/**
 * Connection timing. A token is refreshed REFRESH_BEFORE_MS before it expires (never sooner than MIN_REFRESH_MS from
 * now); reconnects back off from BACKOFF_BASE_MS doubling to BACKOFF_MAX_MS with up to 30% jitter; signals arriving
 * within COALESCE_MS are folded into one re-read per kind and ref.
 */
export const REALTIME_TIMING={REFRESH_BEFORE_MS:90_000,MIN_REFRESH_MS:15_000,BACKOFF_BASE_MS:1_000,BACKOFF_MAX_MS:60_000,COALESCE_MS:250,TOKEN_TIMEOUT_MS:10_000} as const;
export function backoffDelay(attempt:number,random:()=>number=Math.random){
 const base=Math.min(REALTIME_TIMING.BACKOFF_MAX_MS,REALTIME_TIMING.BACKOFF_BASE_MS*2**Math.max(0,Math.min(attempt,16)));
 return Math.round(base*(1+0.3*Math.max(0,Math.min(1,random()))));
}
/** When to ask for the next token: before expiry, never in a tight loop. expiresAt is epoch seconds (Supabase). */
export function refreshDelay(expiresAtSec:number,now:number){
 return Math.max(REALTIME_TIMING.MIN_REFRESH_MS,expiresAtSec*1000-now-REALTIME_TIMING.REFRESH_BEFORE_MS);
}

/**
 * Fallback polling: the existing interval while the socket is down; relaxed while it is healthy (a signal triggers the
 * re-read, the slow poll only catches anything a signal could not carry). Never slower than RELAXED_MAX_MS.
 */
export const RELAXED_FACTOR=4,RELAXED_MAX_MS=5*60_000;
export const relaxedInterval=(baseMs:number,healthy:boolean)=>healthy?Math.min(RELAXED_MAX_MS,Math.max(baseMs,baseMs*RELAXED_FACTOR)):baseMs;
/**
 * Whether a fallback poll that ticks every baseMs reads at this tick: every tick while the socket is down (exactly the
 * existing cadence), about every relaxedInterval(baseMs) while it is healthy (half a tick of slack absorbs timer drift).
 * A read made for a signal resets lastRead, so it counts as a run; losing the socket brings the normal cadence back at
 * the next base tick.
 */
export const liveDue=(lastRead:number,now:number,baseMs:number,healthy:boolean)=>!healthy||now-lastRead>=relaxedInterval(baseMs,true)-baseMs/2;
