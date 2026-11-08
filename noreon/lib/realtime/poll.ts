import {relaxedInterval} from './contracts';
import {ZOE_POLL,pollDue,type ZoePoll} from '@/lib/zoe/app-chat-contracts';

/* WP R: the member chat's fallback poll next to the realtime socket (staff screens use liveDue from ./contracts). */

/**
 * The member chat's tick (ZOE_POLL, 1 s) with a healthy socket: Zoe's answer, a reply or a card arrives as a signal, so
 * the pending window reads every PENDING_LIVE_MS instead of every tick and the fast and idle reads are relaxed. Without
 * a healthy socket this is exactly pollDue.
 */
export const PENDING_LIVE_MS=5_000;
export function memberPollDue(p:ZoePoll,now:number,lastRead:number,healthy:boolean){
 if(!healthy)return pollDue(p,now,lastRead);
 const since=now-lastRead;
 return (now<p.pendingUntil&&since>=PENDING_LIVE_MS)
  ||(now<p.until&&since>=relaxedInterval(ZOE_POLL.FAST_MS,true))
  ||since>=relaxedInterval(ZOE_POLL.REFRESH_MS,true);
}
