"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Phone, ShieldAlert } from "lucide-react";
import type { PatientLocale } from "@/lib/patient/copy";
import { formatMemberDate } from "@/lib/patient/date-format";
import { SAFETY_COPY, type Pair } from "@/lib/member-safety/contract";
import { CareLink, copy } from "./common";

/**
 * DT P342: the 30-day chest-pain safety card on Home. Wording is an unapproved placeholder
 * (SAFETY_COPY). The member can only hide it for today; the database brings it back
 * tomorrow until the 30 days pass or the doctor clears it.
 */
export function ChestPainSafetyCard({
  card,
  locale: l,
  hide,
}: {
  card: { id: string; expiresAt: string };
  locale: PatientLocale;
  hide: (holdId: string) => Promise<{ ok: boolean }>;
}) {
  const t = (p: Pair) => p[l];
  const c = SAFETY_COPY.card;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState(false);
  // expiresAt is Yerevan midnight after the last day, so the shown date is the last full day.
  const until = formatMemberDate(Date.parse(card.expiresAt) - 1, l, { timeZone: "Asia/Yerevan", dateStyle: "long" });
  return (
    <section
      aria-labelledby="chest-pain-safety-title"
      data-safety-card="chest-pain"
      className="journey-card space-y-4 rounded-2xl border border-destructive/40 bg-card p-5 shadow-sm sm:p-6"
    >
      <header className="flex items-start gap-3">
        <ShieldAlert className="mt-0.5 size-6 shrink-0 text-destructive" aria-hidden />
        <div className="min-w-0 space-y-1">
          <p className="text-caption text-muted-foreground">{copy(l, c.label.en, c.label.hy, "Карточка безопасности при боли в груди")}</p>
          <h2 id="chest-pain-safety-title" className="text-h3">{copy(l, c.title.en, c.title.hy, "Если боль в груди вернётся")}</h2>
        </div>
      </header>
      <p className="text-body2">{t(c.intro)}</p>
      <div className="space-y-2">
        <p className="text-body2 font-semibold">{t(c.callIf)}</p>
        <ul className="list-disc space-y-1 pl-5 text-body2">
          {c.signs.map((sign) => (
            <li key={sign.en}>{t(sign)}</li>
          ))}
        </ul>
        <p className="text-body2 font-semibold">{t(c.call103Now)}</p>
      </div>
      <CareLink href="tel:103" icon={Phone} variant="emergency-pill">
        {copy(l, c.call103.en, c.call103.hy, "Позвонить по номеру 103")}
      </CareLink>
      <p className="text-body2">{t(c.otherwise)}</p>
      <p className="text-caption text-muted-foreground">{copy(l, c.until.en, c.until.hy, "Эта карточка останется до {date}, если ваш врач не скажет, что её можно убрать.").replace("{date}", until)}</p>
      <div className="flex flex-wrap items-center gap-3 border-t pt-3">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setFailed(false);
              const result = await hide(card.id).catch(() => ({ ok: false }));
              if (result.ok) router.refresh();
              else setFailed(true);
            })
          }
          className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border bg-background px-4 py-2 text-body2 font-semibold hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60"
        >
          {pending ? copy(l, c.hiding.en, c.hiding.hy, "Скрывается…") : copy(l, c.hide.en, c.hide.hy, "Скрыть на сегодня")}
        </button>
        {failed && (
          <p role="alert" className="text-body2 text-destructive">
            {copy(l, c.hideFailed.en, c.hideFailed.hy, "Не удалось скрыть карточку. Попробуйте ещё раз.")}
          </p>
        )}
      </div>
    </section>
  );
}
