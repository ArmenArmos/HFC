"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { bpVeryHigh } from "@/lib/clinical/rules/bp-check";
import { offlineFailure, type Outbox } from "@/lib/offline/outbox";
import { memberOutbox } from "@/components/patient/member-outbox";
import { checkBp, type BpField } from "./bp-entry-values";
import type { BpStep } from "@/lib/clinical/rules/bp-check";
import { recordBpFromCard, recordRepeatFromCard } from "@/lib/zoe-chat-actions/actions";
import type { CardActionResult, ValidCard, ZoeCard } from "@/lib/zoe-chat-actions/registry";
import { COMMON, MESSAGE, say, type CardLocale } from "@/lib/zoe-chat-actions/copy";
import { CARD_REPLY_LOST } from "@/lib/zoe-chat-actions/thread-events";

export type BpCard = Extract<ValidCard, { kind: "bp" }>;
export type ReadingFormCard = BpCard | Extract<ValidCard, { kind: "repeat" }>;
export const runCardAction = async (op: () => Promise<CardActionResult>): Promise<CardActionResult | null> => {
  try { return await op(); }
  catch (error) {
    if (String((error as { digest?: unknown })?.digest ?? "").startsWith("NEXT_REDIRECT")) throw error;
    window.dispatchEvent(new Event(CARD_REPLY_LOST));
    return null;
  }
};
export function cardProblem(l: CardLocale, r: CardActionResult | null): string | null {
  if (r?.status === "ok") return null;
  if (r === null) return say(l, COMMON.unconfirmed);
  if (r.status === "signed_out") return "signed_out";
  if (r.status === "stale") return say(l, COMMON.staleInChat);
  if (r.status === "busy") return say(l, MESSAGE.busy);
  if (r.status === "closed") return say(l, COMMON.closed);
  if (r.status === "rate_limited") return say(l, COMMON.rateLimited);
  return say(l, COMMON.saveFailed);
}

export const BP_ROWS: { field: BpField; label: Record<CardLocale, string>; unit: Record<CardLocale, string> }[] = [
  { field: "systolic", label: { hy: "Վերին թիվ", en: "Top", ru: "Верхнее" }, unit: { hy: "mmHg", en: "mmHg", ru: "mmHg" } },
  { field: "diastolic", label: { hy: "Ստորին թիվ", en: "Bottom", ru: "Нижнее" }, unit: { hy: "mmHg", en: "mmHg", ru: "mmHg" } },
  { field: "pulse", label: { hy: "Զարկ", en: "Pulse", ru: "Пульс" }, unit: { hy: "զարկ/րոպե", en: "beats/min", ru: "уд/мин" } },
];
/** One save path for both chat presentations. Card identity owns the retry ID and measured time. */
export function useBpCard(card: ReadingFormCard, l: CardLocale, onCard: (card: ZoeCard) => void, onRefused?: () => void) {
  const typed = card.kind === "bp" ? card.snapshot.typed : undefined;
  // The numbers the member typed in the chat, ready to check and save.
  const [values, updateValues] = useState<Record<BpField, string>>({ systolic: typed ? String(typed.systolic) : "", diastolic: typed ? String(typed.diastolic) : "", pulse: typed?.pulse ? String(typed.pulse) : "" });
  const [photoConfirmed, setPhotoConfirmed] = useState(false);
  const setValues: typeof updateValues = next => { setPhotoConfirmed(false); updateValues(next); };
  const fillFromPhoto = (reading: { systolic: number; diastolic: number; pulse: number | null }) => {
    updateValues({ systolic: String(reading.systolic), diastolic: String(reading.diastolic), pulse: reading.pulse === null ? "" : String(reading.pulse) });
    setPhotoConfirmed(true);
    measuredAt.current = new Date().toISOString();
  };
  // One submission per card: a retry sends the same id and time, so it replays instead of saving twice.
  const [submission, setSubmission] = useState(() => crypto.randomUUID());
  const measuredAt = useRef<string | null>(null);
  // WP R: a reading confirmed offline waits in the outbox (same submission id and measured time) until the browser is
  // online; a very high one (the rules' bpVeryHigh) says at once that it has not reached the care team and to call 103.
  const [queued, setQueued] = useState<{ veryHigh: boolean } | null>(null);
  useEffect(() => {
    if (card.state === "done") return;
    let active = true;
    void memberOutbox().then(outbox => outbox?.pending("bp_reading") ?? []).then(items => {
      const mine = items.map(item => bpOutboxPayload(item.payload)).find(p => p?.cardId === card.id);
      if (!active || !mine) return;
      setSubmission(mine.submissionId);
      measuredAt.current = mine.measuredAt;
      updateValues({ systolic: String(mine.systolic), diastolic: String(mine.diastolic), pulse: mine.pulse === null ? "" : String(mine.pulse) });
      setQueued({ veryHigh: bpVeryHigh(mine) });
    });
    return () => { active = false; };
  }, [card.id, card.state]);
  const sending = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const [submitted, setSubmitted] = useState(false);
  const check = checkBp(values);
  const saved = card.outcome.bp as { systolic: number; diastolic: number; pulse: number | null; bp?: BpStep } | undefined;
  const save = () => {
    if (!check.ok || sending.current) return;
    sending.current = true;
    measuredAt.current ??= typed?.measuredAt ?? new Date().toISOString();
    const entry = { systolic: check.systolic, diastolic: check.diastolic, pulse: check.pulse ?? null, photoConfirmed, measuredAt: measuredAt.current };
    const payload: BpOutboxPayload = { cardId: card.id, repeat: card.kind === "repeat", submissionId: submission, ...entry };
    const queue = () => {
      setError(null);
      setQueued({ veryHigh: bpVeryHigh(entry) });
      void memberOutbox().then(outbox => outbox ? outbox.queue("bp_reading", submission, payload) : false)
        .then(ok => { if (!ok) { setQueued(null); setError(say(l, COMMON.saveFailed)); } });
      onRefused?.();
      sending.current = false;
    };
    if (typeof navigator !== "undefined" && navigator.onLine === false) { queue(); return; }
    start(async () => {
      setError(null);
      let lost: unknown = null;
      const r = await runCardAction(async () => {
        try { return await (card.kind === "repeat" ? recordRepeatFromCard : recordBpFromCard)({ cardId: card.id, submissionId: submission, ...entry }); }
        catch (failure) { lost = failure; throw failure; }
      });
      if (r === null && offlineFailure(lost)) { queue(); return; }
      setQueued(null);
      if (r?.card) onCard(r.card);
      if (r?.status === "ok" && r.next) onCard(r.next);
      if (r?.status !== "ok") setError(r?.status === "stale" ? say(l, COMMON.staleInChat) : cardProblem(l, r));
      // A definite no, unlike a lost reply (null), which may still turn out saved.
      if (r && r.status !== "ok") onRefused?.();
      sending.current = false;
    });
  };
  return { values, setValues, fillFromPhoto, photoConfirmed, check, saved, error, busy, submitted, setSubmitted, save, queued: card.state === "done" ? null : queued };
}

/** What a queued BP save keeps (WP R): the card, the submission id and the confirmed reading with its measured time. */
export type BpOutboxPayload = { cardId: string; repeat: boolean; submissionId: string; systolic: number; diastolic: number; pulse: number | null; photoConfirmed: boolean; measuredAt: string };
export function bpOutboxPayload(value: unknown): BpOutboxPayload | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const int = (x: unknown) => typeof x === "number" && Number.isInteger(x);
  if (typeof v.cardId !== "string" || typeof v.submissionId !== "string" || typeof v.repeat !== "boolean" || !int(v.systolic) || !int(v.diastolic)
    || !(v.pulse === null || int(v.pulse)) || typeof v.photoConfirmed !== "boolean" || typeof v.measuredAt !== "string") return null;
  return { cardId: v.cardId, repeat: v.repeat, submissionId: v.submissionId, systolic: v.systolic as number, diastolic: v.diastolic as number, pulse: v.pulse as number | null, photoConfirmed: v.photoConfirmed, measuredAt: v.measuredAt };
}

/**
 * WP R: replays queued BP saves in order when the browser is online (and once on mount), through the same card actions
 * with the same submission id; the server claims the card with that id and writes patient_measurements once, so a save
 * that did arrive before the connection dropped is a replay, not a second reading. Updated cards go to onCard.
 */
export function useBpOutboxReplay(onCard: (card: ZoeCard) => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    let outbox: Outbox | null = null, active = true;
    const replay = () => {
      if (!outbox || !active || navigator.onLine === false) return;
      void outbox.replay(async item => {
        const p = bpOutboxPayload(item.payload);
        if (!p || p.submissionId !== item.id) return "drop";
        let r: CardActionResult;
        try { r = await (p.repeat ? recordRepeatFromCard : recordBpFromCard)({ cardId: p.cardId, submissionId: p.submissionId, systolic: p.systolic, diastolic: p.diastolic, pulse: p.pulse, photoConfirmed: p.photoConfirmed, measuredAt: p.measuredAt }); }
        catch { return "retry"; }
        if (r.card) onCard(r.card);
        if (r.status === "ok" && r.next) onCard(r.next);
        if (r.status === "ok") return "sent";
        return r.status === "busy" || r.status === "failed" || r.status === "unavailable" || r.status === "rate_limited" || r.status === "signed_out" ? "retry" : "drop";
      }, "bp_reading");
    };
    void memberOutbox().then(ready => { outbox = ready; replay(); });
    window.addEventListener("online", replay);
    return () => { active = false; window.removeEventListener("online", replay); };
  }, [onCard, enabled]);
}
