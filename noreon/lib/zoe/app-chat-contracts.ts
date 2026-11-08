import {suggestionStateSchema} from '@/lib/chat/suggestions';
import {z} from 'zod';
import {nurseReplyViewSchema} from '@/lib/nurse-chat/contracts';

/**
 * The member app's Zoe chat (Khikar, 17 Oct 22:48): one conversation per member across the app
 * and Telegram. Pure contracts and the thread layout, shared by the server and the client.
 *
 * The app sends into the same conversation as Telegram (conversation_receive) and reads it back
 * with conversation_member_thread. What answers is the Telegram path unchanged: the fixed
 * acknowledgement, care-alert screening, the Zoe sweep (a draft for the doctor, or for logistics and
 * app help only Zoe's own guarded answer) and the doctor's approval. Nothing here can reach a model.
 */

/** Same size cap as a Telegram text message (UTF-16 code units, like the database counts). */
export const ZOE_CHAT_MAX=4096;

export const memberNoticeSchema=z.strictObject({id:z.uuid(),text:z.string(),at:z.iso.datetime({offset:true}),closed:z.boolean()});
export const memberNoticesSchema=z.strictObject({notices:z.array(memberNoticeSchema),firstUnseen:z.uuid().nullable()});

export const threadSchema=z.union([
 z.strictObject({ok:z.literal(false),code:z.enum(['unavailable','not_eligible'])}),
 z.strictObject({ok:z.literal(true),version:z.number().int().nonnegative(),ack:z.string().nullable(),
  // Zoe answers every message herself (conversational replies on, 20261018121002 §8), and the newest
  // member message whose Zoe run has finished: after it no Zoe text is coming.
  zoeReplies:z.boolean(),settledSeq:z.number().int().nonnegative(),
  // Authoritative alarm and screening gate; absent on pre-migration servers means no suggestions.
  suggestionSafety:z.boolean().optional(),
  suggestionState:suggestionStateSchema.nullable().optional(),
  // Public screening context refreshed by the polling GET, absent on a raw database thread.
  emergencyCheck:z.object({env:z.record(z.string(),z.string()),intake:z.object({enabled:z.boolean(),active:z.boolean()}).nullable()}).nullable().optional(),
  messages:z.array(z.strictObject({seq:z.number().int(),text:z.string(),at:z.string(),channel:z.enum(['app','telegram']),requestId:z.uuid().nullable()})),
  replies:z.array(z.strictObject({id:z.uuid(),text:z.string(),at:z.string(),doctorName:z.string()})),
  nurseReplies:z.array(nurseReplyViewSchema).optional(),
  notices:z.array(memberNoticeSchema).optional(),
  firstUnseenNotice:z.uuid().nullable().optional(),
  // Zoe's own answers (logistics and app help, approved wording), from either channel.
  answers:z.array(z.strictObject({id:z.uuid(),text:z.string(),at:z.string()})),
  // The member's "New question" dividers (20261021070207), only when there is one: after this message seq a new question starts.
  breaks:z.array(z.strictObject({afterSeq:z.number().int().nonnegative(),at:z.string()})).optional()}),
]);
export type ZoeThread=Extract<z.infer<typeof threadSchema>,{ok:true}>;

export type ChatItem=
 /** The member's "New question" divider (the doctor's view draws it too). */
 |{kind:'divider';key:string}
 |{kind:'member';key:string;text:string;at:string;channel:'app'|'telegram';requestId:string|null}
 /** The plain "Sent to your care team." status (text is always null: the app never shows the Telegram ack). */
 |{kind:'ack';key:string;text:null}
 /** Zoe is answering: "Zoe is writing" until her run settles or the wait ends. */
 |{kind:'pending';key:string}
 |{kind:'reply';key:string;text:string;at:string;doctorName:string}
 |{kind:'nurse';key:string;text:string;at:string;senderName:string}
 |{kind:'answer';key:string;text:string;at:string}
 |{kind:'notice';key:string;text:string;at:string;closed:boolean};

/**
 * One chronological thread: the member's messages from both channels, Zoe's own answers and the
 * doctor's approved replies at their time. After the newest run of member messages, unless an answer
 * or reply follows: "Zoe is writing" while that message's Zoe run is not settled and within the wait,
 * then the plain status "Sent to your care team.". Khikar, 18 Oct 23:56: the app never shows the
 * Telegram acknowledgement (thread.ack, staging wording with a STAGING label and a 103 line); Telegram
 * still sends it. settledSeq comes from zoe_runs whether or not conversational replies are on; with no
 * run at all (sweep off), the wait ends the status the same way.
 */
/** How long the app shows "Zoe is writing" before the plain status. */
export const ZOE_REPLY_WAIT_MS=3*60_000;

export function chatItems(thread:Pick<ZoeThread,'messages'|'replies'|'ack'|'answers'>&Partial<Pick<ZoeThread,'zoeReplies'|'settledSeq'|'breaks'|'nurseReplies'|'notices'>>,now=Date.now()):ChatItem[]{
 const merged=[...thread.messages.map(m=>({at:m.at,order:0,item:{kind:'member'as const,key:`m${m.seq}`,text:m.text,at:m.at,channel:m.channel,requestId:m.requestId}})),
  ...thread.replies.map(r=>({at:r.at,order:1,item:{kind:'reply'as const,key:`r${r.id}`,text:r.text,at:r.at,doctorName:r.doctorName}})),
  ...(thread.nurseReplies??[]).map(r=>({at:r.at,order:1,item:{kind:'nurse'as const,key:`n${r.id}`,text:r.text,at:r.at,senderName:r.senderName}})),
  ...(thread.notices??[]).map(n=>({at:n.at,order:2,item:{kind:'notice'as const,key:`N${n.id}`,text:n.text,at:n.at,closed:n.closed}})),
  ...thread.answers.map(a=>({at:a.at,order:1,item:{kind:'answer'as const,key:`z${a.id}`,text:a.text,at:a.at}}))]
  .sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)||a.order-b.order);
 const seqOf=new Map(thread.messages.map(m=>[`m${m.seq}`,m.seq]));
 const out:ChatItem[]=[];
 merged.forEach(({item},i)=>{
  out.push(item);
  const next=merged.slice(i+1).find(x=>x.item.kind!=='notice')?.item;
  if(item.kind!=='member'||next?.kind==='member')return;
  // Only after the newest run of member messages (Khikar 18 Oct 16:24: never after every message).
  if(merged.slice(i+1).some(x=>x.item.kind==='member'))return;
  // Zoe's text or a released doctor reply answered the run (Codex follow-up F6).
  if(next?.kind==='answer'||next?.kind==='reply'||next?.kind==='nurse')return;
  const settled=(seqOf.get(item.key)??0)<=(thread.settledSeq??0);
  if(!settled&&now-Date.parse(item.at)<ZOE_REPLY_WAIT_MS)out.push({kind:'pending',key:`p${item.key}`});
  else out.push({kind:'ack',key:`a${item.key}`,text:null});
 });
 return withDividers(out,thread.breaks??[],seqOf);
}

/**
 * The "New question" dividers: each just before the first member message after it, or at the end while the member has not
 * written the new question yet. Exported for the checks.
 */
export function withDividers(items:ChatItem[],breaks:readonly {afterSeq:number}[],seqOf:ReadonlyMap<string,number>):ChatItem[]{
 if(!breaks.length)return items;
 const out=[...items];
 for(const b of [...breaks].sort((x,y)=>y.afterSeq-x.afterSeq)){
  const i=out.findIndex(x=>x.kind==='member'&&(seqOf.get(x.key)??0)>b.afterSeq);
  const divider:ChatItem={kind:'divider',key:`d${b.afterSeq}`};
  if(i<0)out.push(divider);else out.splice(i,0,divider);
 }
 return out;
}
/** Whether "New question" would add anything: there is a message, and the newest thing is not already a divider. */
export const canStartNewQuestion=(items:readonly ChatItem[])=>items.some(x=>x.kind==='member')&&items.at(-1)?.kind!=='divider';

/**
 * Why a send was refused for good (18 Oct): the member is told what to do, never a bare "Not sent".
 * needs_review_request: no clinical case yet; not_eligible: unconfirmed phone, staff or blocked;
 * sign_in_again: the session behind the cookie ended or was signed out.
 */
export const ZOE_REFUSALS=['needs_review_request','not_eligible','sign_in_again'] as const;
export type ZoeRefusal=typeof ZOE_REFUSALS[number];

export type ZoeStoreCode='rate_limited'|'unavailable'|'invalid'|'failed'|ZoeRefusal;
/** conversation_receive's codes: permanent refusals pass through; busy and anything unknown are transient. */
export const zoeStoreCode=(code:string):ZoeStoreCode=>
 code==='rate_limited'?'rate_limited':code==='invalid_command'?'invalid':(ZOE_REFUSALS as readonly string[]).includes(code)?code as ZoeRefusal:'failed';

/** What the composer reports after a send. Only 'failed' is transient ("Not sent. Try again."). */
export type ZoeSendResult=
 |{status:'sent';thread:ZoeThread|null}
 /** Only a stored/replayed message may name the care-alert status request. */
 |{status:'urgent';request:string|null}
 |{status:'empty'|'too_long'|'rate_limited'|'unavailable'|'failed'|ZoeRefusal};

/**
 * How the chat looks for Zoe's answer after a send (18 Oct: a member left the screen 3 s after
 * sending, the answer came 7 s later, and nothing looked again until he reopened the page). After a
 * send: every second for a minute (Zoe free mode answers in seconds, output/zoe-speed), then every 10 s for six minutes, otherwise every 30 s, and never
 * while the screen is hidden. Back in view (visible, pageshow, focus) the chat reads at once, and a
 * send still unanswered within the last half hour gets the fast windows again. A read that hangs
 * (a request frozen while a phone was locked) is aborted after 15 s so polling never stalls. Reads are
 * a GET (fetchZoeThread), not a Server Action: Next queues Server Actions one at a time.
 */
export const ZOE_POLL={TICK_MS:1_000,PENDING_FOR_MS:60_000,FAST_MS:10_000,FAST_FOR_MS:6*60_000,REFRESH_MS:30_000,RESUME_FOR_MS:30*60_000,TIMEOUT_MS:15_000} as const;
export type ZoePoll={pendingUntil:number;until:number;answered:number;sentAt:number};
export const ZOE_POLL_IDLE:ZoePoll={pendingUntil:0,until:0,answered:0,sentAt:0};
/** Answers plus doctor replies: a new one ends the wait. */
export const answeredCount=(thread:Pick<ZoeThread,'answers'|'replies'>&Partial<Pick<ZoeThread,'nurseReplies'>>)=>thread.answers.length+thread.replies.length+(thread.nurseReplies?.length??0);
export const pollAfterSend=(now:number,answered:number):ZoePoll=>({pendingUntil:now+ZOE_POLL.PENDING_FOR_MS,until:now+ZOE_POLL.FAST_FOR_MS,answered,sentAt:now});
/** A read with a new answer or reply ends the wait; otherwise nothing changes. */
export const pollAfterRead=(p:ZoePoll,answered:number):ZoePoll=>answered>p.answered?{...ZOE_POLL_IDLE,answered}:p;
/** Back in view: a recent unanswered send polls fast again. */
export const pollOnReturn=(p:ZoePoll,now:number):ZoePoll=>p.sentAt&&now-p.sentAt<ZOE_POLL.RESUME_FOR_MS?{...p,pendingUntil:now+ZOE_POLL.PENDING_FOR_MS,until:now+ZOE_POLL.FAST_FOR_MS}:p;
/** Whether a visible chat reads the thread at this tick. */
export const pollDue=(p:ZoePoll,now:number,lastRead:number)=>now<p.pendingUntil||(now<p.until&&now-lastRead>=ZOE_POLL.FAST_MS)||now-lastRead>=ZOE_POLL.REFRESH_MS;
/** The read, or null when it fails or takes longer than ms; a read that takes too long is aborted. */
export async function readWithin<T>(read:(signal:AbortSignal)=>Promise<T>,ms:number):Promise<T|null>{
 const abort=new AbortController();
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{
  return await Promise.race([read(abort.signal).catch(()=>null),new Promise<null>(resolve=>{timer=setTimeout(()=>{abort.abort();resolve(null);},ms);})]);
 }finally{clearTimeout(timer);}
}

/**
 * Whether a poll may replace the shown thread. Polls run alongside sends, so a poll that started
 * before a send finished, or that carries an older conversation version, would put back an older
 * thread (PR #281 review F2): it is dropped, and the next poll reads again.
 */
export const pollMayReplace=(next:Pick<ZoeThread,'version'>,shown:Pick<ZoeThread,'version'>,sendsAtStart:number,sendsNow:number)=>
 sendsAtStart===sendsNow&&next.version>=shown.version;

/** Where the chat polls its thread (app/api/patient/zoe/thread): a plain GET, never a Server Action. */
export const ZOE_THREAD_URL='/api/patient/zoe/thread';
/** One poll of the member's thread; null unless the answer is a valid thread. */
export async function fetchZoeThread(signal:AbortSignal,fetcher:typeof fetch=fetch):Promise<ZoeThread|null>{
 const response=await fetcher(ZOE_THREAD_URL,{cache:'no-store',credentials:'same-origin',signal});
 if(!response.ok)return null;
 const parsed=threadSchema.safeParse(await response.json());
 return parsed.success&&parsed.data.ok?parsed.data:null;
}

/** Optional notice read failures preserve the last good journal, including its unseen marker. */
export function keepThreadNotices(next:ZoeThread,shown:ZoeThread):ZoeThread{
 const merged=next.notices===undefined&&shown.notices!==undefined
  ?{...next,notices:shown.notices,firstUnseenNotice:shown.firstUnseenNotice}:next;
 // Projection fields may be appended by the server but parsed earlier by the client schema.
 // Compare field values, so top-level property order cannot cause an unchanged poll to render.
 const keys=Object.keys({...shown,...merged}) as (keyof ZoeThread)[];
 return keys.every(key=>JSON.stringify(merged[key])===JSON.stringify(shown[key]))?shown:merged;
}
