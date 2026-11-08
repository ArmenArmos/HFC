"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bell, MessageCircleQuestion, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CareLink } from "@/components/patient-care/common";
import type { PatientLocale } from "@/lib/patient/copy";
import { ASK_REASONS, MEDICINE_ASK_COPY, askWhen, type AskReason } from "@/lib/member-medicines/ask-copy";
import type { MedicineAsk } from "@/lib/member-medicines/asks";
import { answerMedicineAsk, askCareTeamAboutRefill, dismissMedicineAsk, type AskResult } from "@/lib/member-medicines/actions";

const run = async <T,>(op: () => Promise<T>): Promise<T | null> => { try { return await op(); } catch { return null; } };

/**
 * Zoe asks once, kindly, why a dose was skipped or not ticked (item 5). The answer leads to a reminder change,
 * refill help, or the doctor. Never medicine advice: side effects and stopping only ever go to the doctor.
 */
export function MedicineAskCard({ ask, locale: l, now }: { ask: MedicineAsk; locale: PatientLocale; now: string }) {
  const router = useRouter();
  const c = MEDICINE_ASK_COPY[l];
  const [busy, start] = useTransition();
  const [answered, setAnswered] = useState<AskReason | null>(null);
  const [refill, setRefill] = useState<"idle" | "sent" | "already">(ask.careTeamAsked ? "already" : "idle");
  const [error, setError] = useState("");
  const when = askWhen(ask.dueAt, new Date(now), l);
  const name = ask.medicine.name || "";

  const failed = (r: AskResult | null) => setError(r?.status === "closed" || r?.status === "not-found" ? c.closed : c.failed);
  const answer = (reason: AskReason) => start(async () => {
    setError("");
    const r = await run(() => answerMedicineAsk({ askId: ask.id, reason }));
    if (r?.status === "answered") setAnswered(reason); else failed(r);
  });

  return (
    <section aria-labelledby={`ask-${ask.id}`} className="space-y-4 rounded-2xl border border-border/70 bg-card p-5 shadow-sm" aria-live="polite">
      <div className="flex items-start gap-3">
        <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted"><MessageCircleQuestion className="size-5" /></span>
        <div className="min-w-0">
          <h2 id={`ask-${ask.id}`} className="text-h3">{c.title}</h2>
          <p className="mt-1 break-words text-body2">{ask.trigger === "skipped" ? c.skipped(name, when) : c.missed(name, when)}</p>
        </div>
      </div>

      {answered === null ? (
        <>
          <p className="text-body2 text-muted-foreground">{c.why}</p>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap" role="group" aria-label={c.title}>
            {ASK_REASONS.map(reason => (
              <Button key={reason} type="button" variant="outline" className="h-auto min-h-11 justify-start whitespace-normal text-left" disabled={busy} onClick={() => answer(reason)}>
                {c.reasons[reason]}
              </Button>
            ))}
          </div>
          <Button type="button" variant="ghost" className="min-h-11" disabled={busy} onClick={() => start(async () => {
            const r = await run(() => dismissMedicineAsk(ask.id));
            if (r?.status === "closed") router.refresh(); else failed(r);
          })}>{c.notNow}</Button>
        </>
      ) : answered === "forgot" ? (
        <div className="space-y-3">
          <p className="text-body2">{c.forgot.body}</p>
          <CareLink href="/patient/account/reminders" icon={Bell}>{c.forgot.action}</CareLink>
        </div>
      ) : answered === "side_effect" || answered === "decided_to_stop" ? (
        <div className="space-y-3">
          <p className="text-body2">{answered === "side_effect" ? c.doctor.sideEffect : c.doctor.stop}</p>
          <p className="text-body2">{c.doctor.noAdvice}</p>
          <p className="flex items-start gap-2 rounded-xl bg-muted p-3 text-body2"><Phone className="mt-0.5 size-4 shrink-0" aria-hidden />{c.doctor.urgent}</p>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-body2">{c.refill.body}</p>
          {answered === "cost_or_availability" && <p className="text-body2">{c.refill.cost}</p>}
          {refill === "idle"
            ? <Button type="button" className="h-auto min-h-11 whitespace-normal" disabled={busy} onClick={() => start(async () => {
              setError("");
              const r = await run(() => askCareTeamAboutRefill(ask.id));
              if (r?.status === "sent") setRefill("sent"); else if (r?.status === "already") setRefill("already"); else failed(r);
            })}>{c.refill.action}</Button>
            : <p role="status" className="text-body2 font-semibold">{refill === "sent" ? c.refill.sent : c.refill.already}</p>}
        </div>
      )}
      {error && <p role="alert" className="text-caption text-destructive">{error}</p>}
    </section>
  );
}
