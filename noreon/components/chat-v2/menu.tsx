"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { saveLanguagePreference } from "@/app/patient/account/locale-actions";
import { unsubscribeMemberPush } from "@/lib/member-push/client";
import { signOut } from "@/app/patient/actions";
import { tx, type PatientLocale } from "@/lib/patient/copy";

export function ChatMenu({ locale: l, revision, onLocale, onClose, onSignedOut, disabled = false, onBusy, onMedicines, onResults, onMessage, onPlan, onVisit, onConsult, onQuestions, previousChat = false, overview = false }: {
  locale: PatientLocale; revision: number; onLocale: (locale: PatientLocale, revision: number) => void;
  onClose: () => void; onSignedOut: () => void;
  disabled?: boolean;
  /** Keep questionnaire writes locked even if this dialog closes during the request. */
  onBusy?: (busy: boolean) => void;
  /** V3: opens the medicines block in the thread. */
  onMedicines?: () => void;
  onResults?: () => void;
  onMessage?: () => void;
  /** The read-only overview, only with the draft Zoe switch on. */
  overview?: boolean;
  onPlan?: () => void;
  onVisit?: () => void;
  onConsult?: () => void;
  onQuestions?: () => void;
  /** V3: a visible way back to the previous chat page. */
  previousChat?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const box = dialog.current;
    box?.showModal();
    box?.focus({ preventScroll: true });
    return () => { box?.close(); previous?.focus({ preventScroll: true }); };
  }, []);
  async function language(next: PatientLocale) {
    if (next === l || busy || disabled) return;
    onBusy?.(true);
    setBusy(true); setError(false);
    try {
      const result = await saveLanguagePreference({ locale: next, expectedLocale: l, expectedRevision: revision });
      if (result.ok) onLocale(next, result.revision);
      else setError(true);
    } catch { setError(true); }
    setBusy(false);
    onBusy?.(false);
  }
  return <dialog ref={dialog} tabIndex={-1} className="cv2-menu" aria-label={tx(l, "Մենյու", "Menu", "Меню")} onCancel={onClose}
    onClick={event => { if (event.target === dialog.current && event.clientY < dialog.current.getBoundingClientRect().top) onClose(); }}>
    <button type="button" className="cv2-close" onClick={onClose} aria-label={tx(l, "Փակել", "Close", "Закрыть")}>×</button>
    <h2>{tx(l, "Լեզու", "Language", "Язык")}</h2>
    <div className="cv2-languages">{([['hy', 'Հայերեն'], ['en', 'English'], ['ru', 'Русский']] as const).map(([id, label]) =>
      <button type="button" key={id} aria-pressed={id === l} disabled={busy || disabled} onClick={() => void language(id)}>{label}</button>)}</div>
    {onResults && <button type="button" data-menu-results disabled={busy || disabled} onClick={() => { onResults(); onClose(); }}>{tx(l, "Իմ արդյունքները", "My results", "Мои результаты")}</button>}
    {onMessage && <button type="button" data-menu-message disabled={busy || disabled} onClick={() => { onMessage(); onClose(); }}>{tx(l, "Գրել իմ բժշկին", "Message my doctor", "Написать моему врачу")}</button>}
    {overview && <Link className="cv2-menu-link" href="/patient/chat/overview">{tx(l, "Իմ ամփոփումը", "My overview", "Мой обзор")}</Link>}
    {onPlan && <button type="button" data-menu-plan disabled={busy || disabled} onClick={() => { onPlan(); onClose(); }}>{tx(l, "Իմ պլանը", "My plan", "Мой план")}</button>}
    {onConsult && <button type="button" data-menu-consult disabled={busy || disabled} onClick={() => { onConsult(); onClose(); }}>{tx(l,"Խնդրել խորհրդատվություն","Request a consultation","Запросить консультацию")}</button>}
    {onQuestions && <button type="button" data-menu-questions disabled={busy || disabled} onClick={() => { onQuestions(); onClose(); }}>{tx(l,"Իմ հարցերը բժշկին","My questions for my doctor","Мои вопросы врачу")}</button>}
    {onVisit && <button type="button" data-menu-visit disabled={busy || disabled} onClick={() => { onVisit(); onClose(); }}>{tx(l,"Իմ այցը","My visit","Мой визит")}</button>}
    {onMedicines && <button type="button" data-menu-medicines disabled={busy || disabled} onClick={() => { onMedicines(); onClose(); }}>{tx(l, "Իմ դեղերը", "My medicines", "Мои лекарства")}</button>}
    {previousChat && <a className="cv2-previous" data-menu-previous href="/patient/zoe?view=classic">{tx(l, "Նախորդ էջը", "Previous chat page", "Прежняя страница чата")}</a>}
    <button type="button" disabled={busy || disabled} onClick={async () => {
      if (busy || disabled) return;
      onBusy?.(true);
      setBusy(true); setError(false);
      try { await unsubscribeMemberPush(); if ((await signOut()).ok) { onSignedOut(); onClose(); } else setError(true); }
      catch { setError(true); }
      setBusy(false);
      onBusy?.(false);
    }}>{tx(l, "Դուրս գալ", "Sign out", "Выйти")}</button>
    {error && <p role="alert">{tx(l, "Չհաջողվեց պահպանել։ Փորձեք նորից։", "Could not save. Try again.", "Не удалось сохранить. Попробуйте снова.")}</p>}
  </dialog>;
}
