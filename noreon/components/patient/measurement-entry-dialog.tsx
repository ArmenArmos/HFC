"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { HeartPulse, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { IconTile } from "@/components/patient-care/common";
import { tx, type PatientLocale } from "@/lib/patient/copy";
import { BP_DRAFT, MeasurementForm, type MeasurementSave, type MeasurementReady } from "./measurement-form";
import { keepDraft } from "./tab-draft";

const CLOSE_HREF = "/patient/health";

/** The dedicated route also works when opened directly, without a prior page. */
export function MeasurementEntryDialog({ locale, title: heading, detail, closeHref = CLOSE_HREF, save, doneHref, prototype = false, classicHref }: { locale: PatientLocale; title?: string; detail?: string; closeHref?: string; save?: MeasurementSave; doneHref?: string; prototype?: boolean; classicHref?: Route }) {
  const router = useRouter();
  const formId = useId();
  const title = useRef<HTMLHeadingElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const keepEditing = useRef<HTMLButtonElement>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [ready, setReady] = useState<MeasurementReady | null>(null);
  const [open, setOpen] = useState(true);
  // Leaving used to wait for the next page's server render with the sheet still up, so on a phone a
  // tap on Close, Escape or the backdrop looked like nothing happened. Hide first, then navigate.
  useEffect(() => { router.prefetch(closeHref as typeof CLOSE_HREF); }, [router, closeHref]);
  const leave = () => { setOpen(false); router.replace(closeHref as typeof CLOSE_HREF); };
  useEffect(() => {
    if (discard) { body.current?.scrollTo({ top: 0 }); keepEditing.current?.focus(); }
  }, [discard]);
  const close = () => {
    if (busy) return;
    if (dirty) setDiscard(true);
    else leave();
  };
  return (
    <Dialog open={open} onOpenChange={open => { if (!open) close(); }}>
      <DialogContent data-member-screens-prototype={prototype || undefined} lang={locale} showCloseButton={false} initialFocus={title}
        className={`${prototype ? "zk ms-screen ms-bp-dialog " : ""}bottom-0 left-0 top-auto flex max-h-[calc(100dvh-1rem)] max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-b-none rounded-t-3xl bg-card p-0 sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:max-w-[480px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl`}>
        <header className="flex shrink-0 items-center gap-3 border-b border-border bg-card py-1.5 pl-4 pr-2 sm:pl-5">
          <IconTile icon={HeartPulse} />
          <div className="min-w-0 flex-1">
            <DialogTitle ref={title} tabIndex={-1} className="rounded-md text-h3 leading-snug outline-none">
              {heading ?? tx(locale, "Գրանցել ճնշումը", "Record blood pressure", "Записать артериальное давление")}
            </DialogTitle>
          </div>
          <Button type="button" variant="ghost" className="min-h-12 shrink-0 gap-1.5 rounded-full px-3" disabled={busy} onClick={close}>
            {tx(locale, "Փակել", "Close", "Закрыть")}<X className="size-5" aria-hidden />
          </Button>
        </header>
        <div ref={body} className="min-h-0 overflow-y-auto overscroll-y-contain px-4 pb-2 pt-2 sm:px-5">
          <DialogDescription className="mb-1 text-body2 text-muted-foreground">
            {detail ?? tx(locale, "Մուտքագրեք ձեր սարքի ցույց տված թվերը։", "Copy the numbers from your monitor.", "Введите числа, которые показывает ваш тонометр.")}
          </DialogDescription>
          {discard && <div role="alert" className="mb-4 space-y-3 rounded-xl border border-border bg-muted p-3">
            <p>{tx(locale, "Հրաժարվե՞լ չպահված չափումից։", "Discard your unsaved reading?", "Удалить несохранённое измерение?")}</p>
            <div className="flex flex-wrap gap-2">
              <Button ref={keepEditing} type="button" variant="secondary" className="h-auto min-h-11 whitespace-normal" disabled={busy} onClick={() => { if (!busy) setDiscard(false); }}>{tx(locale, "Շարունակել խմբագրումը", "Keep editing", "Продолжить редактирование")}</Button>
              <Button type="button" variant="outline" className="h-auto min-h-11 whitespace-normal" disabled={busy} onClick={() => { if (!busy) { keepDraft(BP_DRAFT, ""); leave(); } }}>{tx(locale, "Հրաժարվել և փակել", "Discard and close", "Удалить и закрыть")}</Button>
            </div>
          </div>}
          <MeasurementForm prototype={prototype} locale={locale} onDraftChange={setDirty} onBusyChange={setBusy} onReadyChange={setReady} formId={formId} externalSubmit save={save} doneHref={doneHref} />
        </div>
        <footer className="shrink-0 space-y-2 border-t border-border bg-card px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2.5 sm:px-5">
          <p id="bp-summary" aria-live="polite" className={`text-center text-body2 tabular-nums ${ready?.canSave ? "font-heading text-h3 font-bold" : ready?.problem ? "font-semibold text-destructive" : "text-muted-foreground"}`}>
            {ready?.summary ?? "\u00a0"}
          </p>
          <Button type="submit" form={formId} className="h-auto min-h-12 w-full whitespace-normal text-base" disabled={busy || !ready?.canSave}>
            {busy ? tx(locale, "Պահվում է…", "Saving…", "Сохраняется…") : tx(locale, "Պահել չափումը", "Save measurement", "Сохранить измерение")}
          </Button>
          {prototype && classicHref && <Link className="ms-classic" href={classicHref} aria-disabled={busy || undefined} tabIndex={busy ? -1 : undefined} onClick={event => { if (busy) event.preventDefault(); }}>{tx(locale, "Բացել նախորդ տեսքը", "Open the previous view", "Открыть прежний вид")}</Link>}
        </footer>
      </DialogContent>
    </Dialog>
  );
}
