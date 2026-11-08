import 'server-only';

/** Identifiers only: no names, times, tests or health data leave through this hook. */
export type FounderBookingNotice={appointmentId:string;revision:number;purpose:'booking'|'change'|'cancellation';status:'confirmed'|'cancelled'};
export type FounderNoticeSender=(notice:FounderBookingNotice)=>Promise<void>;
let sender:FounderNoticeSender|null=null;

/** Optional founders' Telegram notice of each confirmed booking, change or cancellation.
 * Switched off unless NOREON_BOOKING_FOUNDER_TELEGRAM_ENABLED is 'true' AND the Telegram
 * owner registers a sender. This batch registers none, so nothing is ever sent from here.
 * A failure never affects the booking: the clinic email is the confirmation. */
export function registerFounderNoticeSender(next:FounderNoticeSender|null){sender=next;}
export function founderNoticeEnabled(env:Record<string,string|undefined>=process.env){return env.NOREON_BOOKING_FOUNDER_TELEGRAM_ENABLED==='true';}
export async function notifyFounders(notice:FounderBookingNotice,env:Record<string,string|undefined>=process.env):Promise<'skipped'|'sent'|'failed'>{
 if(!founderNoticeEnabled(env)||!sender)return 'skipped';
 try{await sender(notice);return 'sent';}catch{return 'failed';}
}
