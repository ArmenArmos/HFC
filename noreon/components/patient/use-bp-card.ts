"use client";
import { useRef, useState, useTransition } from "react";
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
  const [submission] = useState(() => crypto.randomUUID());
  const measuredAt = useRef<string | null>(null);
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
    start(async () => {
      setError(null);
      const r = await runCardAction(() => (card.kind === "repeat" ? recordRepeatFromCard : recordBpFromCard)({ cardId: card.id, submissionId: submission, ...entry }));
      if (r?.card) onCard(r.card);
      if (r?.status === "ok" && r.next) onCard(r.next);
      if (r?.status !== "ok") setError(r?.status === "stale" ? say(l, COMMON.staleInChat) : cardProblem(l, r));
      // A definite no, unlike a lost reply (null), which may still turn out saved.
      if (r && r.status !== "ok") onRefused?.();
      sending.current = false;
    });
  };
  return { values, setValues, fillFromPhoto, photoConfirmed, check, saved, error, busy, submitted, setSubmitted, save };
}
