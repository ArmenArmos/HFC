"use client";
import {useState,useTransition} from 'react';
import {Button} from '@/components/ui/button';
import {ReleasedDocuments} from '@/components/patient-care/released-documents';
import {ZoeNotice} from './zoe-notice';
import {formatMemberDate} from '@/lib/patient/date-format';
import {ZOE_CHAT_MAX} from '@/lib/zoe/app-chat-contracts';
import {sendFromCard} from '@/lib/zoe-chat-actions/actions';
import {COMMON,MESSAGE,RESULTS,say,type CardLocale} from '@/lib/zoe-chat-actions/copy';
import {ShowCurrent,Confirm,Problem,problem,run,sentOf,useRequestIds,sendNotice} from './zoe-card-controls';
import type {Notice} from './use-zoe-thread';
import type {CardActionResult,ValidCard,ZoeCard} from '@/lib/zoe-chat-actions/registry';
type Done=(card:ZoeCard)=>void;
type Act=CardActionResult&{send?:string};
const day=(iso:string,locale:CardLocale)=>formatMemberDate(iso,locale,{timeZone:'Asia/Yerevan',dateStyle:'medium'});

export function ResultsBody({ card, locale: l, onCard }: { card: Extract<ValidCard, { kind: "results" }>; locale: CardLocale; onCard: Done }) {
  const s = card.snapshot;
  if (!s.available || (!s.rows.length && !s.documents?.length)) return <p className="text-body2">{say(l, RESULTS.empty)}</p>;
  return (
    <div className="space-y-2">
      <p className="text-caption font-semibold text-muted-foreground">{say(l, RESULTS.approved)}{s.publishedAt ? `. ${say(l, RESULTS.published(day(s.publishedAt, l)))}` : ""}</p>
      <dl className="divide-y">
        {s.rows.map((r, i) => (
          <div key={i} className="flex flex-wrap items-baseline justify-between gap-x-3 py-2">
            <dt className="min-w-0 break-words text-body2">{r.name}{r.at ? <span className="block text-caption text-muted-foreground" suppressHydrationWarning>{day(r.at, l)}</span> : null}</dt>
            <dd className="text-right text-body2 font-semibold tabular-nums">{r.value}{r.unit ? ` ${r.unit}` : ""}{r.reference ? <span className="block text-caption font-normal text-muted-foreground">{say(l, RESULTS.reference(r.reference))}</span> : null}</dd>
          </div>
        ))}
      </dl>
      {s.documents?.length ? <ReleasedDocuments documents={s.documents} locale={l}/> : null}
      {s.older ? <p className="text-caption text-muted-foreground">{say(l, RESULTS.older(s.older))}</p> : null}
      {s.more > 0 && <ShowCurrent kind="results" page={(s.page ?? 0) + 1} label={say(l, RESULTS.more(s.more))} locale={l} onCard={onCard} />}
    </div>
  );
}

export function MessageBody({ card, locale: l, onCard, onAct }: { card: Extract<ValidCard, { kind: "message" }>; locale: CardLocale; onCard: Done; onAct?: (id:string,on:boolean)=>void }) {
  const [text, setText] = useState("");
  const [confirm, setConfirm] = useState(false);
  const requestFor = useRequestIds();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, start] = useTransition();
  const sent = sentOf(card);
  if (sent) return <p className="text-body2" aria-live="polite">{say(l, sent.urgent ? MESSAGE.urgent : MESSAGE.sent)}</p>;
  if (card.state === "done") return <p className="text-body2">{say(l, COMMON.closed)}</p>;
  const send = () => start(async () => {
    onAct?.(card.id,true);
    setError(null); setNotice(null);
    const r = await run(() => sendFromCard({ kind: "message", cardId: card.id, requestId: requestFor(text), text })) as Act | null;
    if (r?.card) onCard(r.card);
    if (r?.status !== "ok") { onAct?.(card.id,false); const n = sendNotice(r?.send); if (n) setNotice(n); else setError(r?.send === "too_long" ? say(l, MESSAGE.tooLong) : problem(l, r)); }
  });
  return (
    <div className="space-y-3">
      {confirm ? (
        <>
          <p className="whitespace-pre-wrap break-words rounded-xl border p-3 text-body2">{text}</p>
          <Confirm locale={l} busy={busy} prompt={say(l, MESSAGE.confirm)} yes={say(l, MESSAGE.send)} onYes={send} onBack={() => setConfirm(false)} />
        </>
      ) : (
        <form className="space-y-2" noValidate onSubmit={e => { e.preventDefault(); if (!text.trim()) { setError(say(l, MESSAGE.empty)); return; } setError(null); setConfirm(true); }}>
          <label htmlFor={`${card.id}-text`} className="text-body2">{say(l, MESSAGE.label)}</label>
          <textarea id={`${card.id}-text`} aria-invalid={!!error} aria-describedby={error ? `${card.id}-message-error` : undefined} placeholder={say(l, {en:"What would you like your care team to know?",hy:"Ի՞նչ կցանկանայիք հայտնել ձեր խնամքի թիմին։",ru:"Что вы хотите сообщить вашей команде?"})} rows={3} maxLength={ZOE_CHAT_MAX} value={text} onChange={e => setText(e.target.value)}
            className="block w-full rounded-md border border-input bg-background px-3 py-2 text-body1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" />
          <Button type="submit" className="h-auto min-h-12 w-full whitespace-normal" disabled={busy}>{say(l, MESSAGE.review)}</Button>
        </form>
      )}
      <div id={`${card.id}-message-error`} className="text-destructive"><Problem text={error} locale={l} /></div>
      <div aria-live="polite"><ZoeNotice locale={l} notice={notice} /></div>
    </div>
  );
}
