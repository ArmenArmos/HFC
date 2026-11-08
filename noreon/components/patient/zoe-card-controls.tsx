"use client";
import {useEffect,useRef,useState,useTransition} from 'react';
import {Button} from '@/components/ui/button';
import {SignInEnded} from './sign-in-ended';
import {openZoeCard} from '@/lib/zoe-chat-actions/actions';
import {COMMON,MESSAGE,say,type CardLocale,type SideEffect} from '@/lib/zoe-chat-actions/copy';
import {CARD_REPLY_LOST,FOCUS_CHAT_CARD} from '@/lib/zoe-chat-actions/thread-events';
import type {Notice} from './use-zoe-thread';
import type {CardActionResult,CardKind,ZoeCard} from '@/lib/zoe-chat-actions/registry';
type Done=(card:ZoeCard)=>void;
type Act=CardActionResult&{send?:string};

export const run = async <T,>(op: () => Promise<T>): Promise<T | null> => { try { return await op(); } catch (error) { if (String((error as { digest?: unknown })?.digest ?? "").startsWith("NEXT_REDIRECT")) throw error; window.dispatchEvent(new Event(CARD_REPLY_LOST)); return null; } };

export const SIGNED_OUT = "signed_out";

export function problem(l: CardLocale, r: Act | null): string | null {
  if (r?.status === "ok") return null;
  if (r === null) return say(l, COMMON.unconfirmed);
  if (r.status === "signed_out") return SIGNED_OUT;
  if (r?.status === "stale") return say(l, COMMON.staleInChat);
  if (r?.status === "busy") return say(l, MESSAGE.busy);
  if (r?.status === "closed") return say(l, COMMON.closed);
  if (r?.status === "rate_limited") return say(l, COMMON.rateLimited);
  return say(l, COMMON.saveFailed);
}

export function ShowCurrent({ kind, label, page, askId, locale: l, onCard }: { kind: CardKind; label?: string; page?: number; askId?: string; locale: CardLocale; onCard: Done }) {
  const [requestId, setRequestId] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const opening = useRef(false);
  const request = useRef<string | null>(null);
  const show = () => start(async () => {
    if (opening.current) return;
    opening.current = true;
    setFailed(null);
    // A retry after a lost answer reuses the request, so it opens the same card, never a second one.
    const id = request.current ?? requestId ?? crypto.randomUUID();
    request.current = id;
    setRequestId(id);
    const r = await run(() => openZoeCard({ requestId: id, kind, sourceSeq: null, reuseCurrent: true, ...(page ? { page } : {}), ...(askId ? { askId } : {}) }));
    opening.current = false;
    if (r?.status === "ok") { request.current = null; setRequestId(null); onCard(r.card); if(kind==='visit'&&typeof window!=='undefined')window.dispatchEvent(new CustomEvent(FOCUS_CHAT_CARD,{detail:r.card.id})); }
    else setFailed(r?.status === "signed_out" ? SIGNED_OUT : say(l, r?.status === "rate_limited" ? COMMON.rateLimited : COMMON.openFailed));
  });
  return (
    <div className="space-y-2">
      <Button type="button" variant="outline" className="h-auto min-h-12 whitespace-normal" disabled={busy} aria-busy={busy} onClick={show} data-zoe-show-current={label ? undefined : true}>{label ?? say(l, COMMON.showCurrent)}</Button>
      <Problem text={failed} locale={l} />
    </div>
  );
}

export function Confirm({ locale: l, prompt, yes, busy, onYes, onBack }: { locale: CardLocale; prompt: string; yes: string; busy: boolean; onYes: () => void; onBack: () => void }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <div className="space-y-2 rounded-xl bg-muted p-3" data-zoe-confirm>
      <p ref={ref} tabIndex={-1} className="break-words text-body2 font-semibold focus-visible:outline-2 focus-visible:outline-ring">{prompt}</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="button" className="h-auto min-h-12 whitespace-normal" disabled={busy} aria-busy={busy} onClick={onYes}>{yes}</Button>
        <Button type="button" variant="outline" className="h-auto min-h-12 whitespace-normal" disabled={busy} onClick={onBack}>{say(l, COMMON.back)}</Button>
      </div>
    </div>
  );
}
export function Problem({ text, locale }: { text: string | null; locale: CardLocale }) {
  if (text === SIGNED_OUT) return <SignInEnded locale={locale} />;
  return text ? <p role="alert" className="text-body2">{text}</p> : null;
}

export const sentOf = (card: ZoeCard) => Object.entries(card.outcome).find(([k]) => k.startsWith("sent:"))?.[1] as { what?: SideEffect; urgent?: boolean } | undefined;
/** One request id per confirmed text: a retry of the same text replays it; an edited text is a new message (Astra ZCA-04). */
export function useRequestIds() {
  const ids = useRef(new Map<string, string>());
  return (text: string) => { let id = ids.current.get(text); if (!id) { id = crypto.randomUUID(); ids.current.set(text, id); } return id; };
}
export const sendNotice = (send: string | undefined): Notice => send === "needs_review_request" || send === "not_eligible" || send === "sign_in_again" || send === "unavailable" || send === "rate_limited" ? send : null;
