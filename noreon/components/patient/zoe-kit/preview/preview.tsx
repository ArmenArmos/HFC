"use client";
import { useState } from "react";
import { PatientShell } from "@/components/patient/patient-shell";
import { Dock } from "../dock";
import { t, type KitLocale, type Line } from "../copy";
import { Conversation } from "./conversation";
import { JOURNEYS } from "./journeys";

const c = (hy: string, en: string, ru: string): Line => ({ hy, en, ru });
const COPY = {
  preview: c("Նախադիտում", "Preview", "Предпросмотр"),
  banner: c("Նախադիտում՝ փորձնական տվյալներով։ Այստեղ ոչինչ չի պահվում և չի ուղարկվում։ Եթե օգնություն է պետք, զանգահարեք 103։", "Preview with demo data. Nothing here is saved or sent. If you need help, call 103.", "Предпросмотр с демонстрационными данными. Здесь ничего не сохраняется и не отправляется. Если нужна помощь, звоните 103."),
  language: c("Լեզու", "Language", "Язык"),
  size: c("Տառաչափ", "Text size", "Размер текста"),
  sizes: [c("Սովորական", "Normal", "Обычный"), c("Մեծ", "Large", "Крупный"), c("Ամենամեծ", "Largest", "Самый крупный")],
  failures: c("Ցույց տալ սխալները", "Show failures", "Показать ошибки"),
  restart: c("Սկսել նորից", "Restart", "Начать заново"),
  journeys: c("Ճանապարհներ", "Journeys", "Сценарии"),
};
const LOCALES: { value: KitLocale; label: string }[] = [{ value: "hy", label: "Հայ" }, { value: "en", label: "Eng" }, { value: "ru", label: "Рус" }];
const SIZES = ["normal", "large", "xlarge"] as const;

/**
 * The preview frame: the real member shell, a small control panel (language, text size, failures, restart), one
 * journey's conversation, and the quick strip, whose chips start the journeys as they would in the chat.
 */
export function ZoeKitPreview({ initialLocale, initialJourney, initialSize }: { initialLocale: KitLocale; initialJourney?: string; initialSize?: string }) {
  const [l, setL] = useState<KitLocale>(initialLocale);
  const [journey, setJourney] = useState(JOURNEYS.find(j => j.key === initialJourney)?.key ?? JOURNEYS[0].key);
  const [size, setSize] = useState<(typeof SIZES)[number]>(SIZES.find(s => s === initialSize) ?? "normal");
  const [failures, setFailures] = useState(false);
  const [run, setRun] = useState(0);
  const current = JOURNEYS.find(j => j.key === journey)!;
  const start = (key: string) => { setJourney(key); setRun(n => n + 1); };
  return (
    <div className="contents" data-member-text-size={size}>
      <PatientShell locale={l}>
        <div className="zk mx-auto max-w-2xl" lang={l} data-zoe-kit-preview={journey}>
          <header className="flex items-center gap-3 py-2">
            <span className="journey-orb !size-10" aria-hidden />
            <div className="min-w-0 flex-1">
              <h1 className="text-h3">Zoe</h1>
              <p className="text-caption text-muted-foreground">{t(l, COPY.preview)}</p>
            </div>
          </header>
          <section className="zk-card zk-panel" data-tone="watch" aria-label={t(l, COPY.preview)}>
            <p className="zk-plain">{t(l, COPY.banner)}</p>
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t(l, COPY.language)}>
              {LOCALES.map(o => <button key={o.value} type="button" className="zk-chip" aria-pressed={l === o.value} onClick={() => { setL(o.value); setRun(n => n + 1); }}>{o.label}</button>)}
              <button type="button" className="zk-chip" aria-pressed={failures} onClick={() => { setFailures(f => !f); setRun(n => n + 1); }}>{t(l, COPY.failures)}</button>
            </div>
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t(l, COPY.size)}>
              {SIZES.map((s, i) => <button key={s} type="button" className="zk-chip" aria-pressed={size === s} onClick={() => setSize(s)}>{t(l, COPY.sizes[i])}</button>)}
              <button type="button" className="zk-chip" onClick={() => setRun(n => n + 1)}>{t(l, COPY.restart)}</button>
            </div>
          </section>
          <Conversation key={`${journey}-${l}-${run}`} journey={current} locale={l} failures={failures} />
          <Dock locale={l} label={t(l, COPY.journeys)} typing={false} chips={JOURNEYS.map(j => ({ key: j.key, label: t(l, j.chip) }))} onChip={start} />
        </div>
      </PatientShell>
    </div>
  );
}
