"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { completeAssessment } from "@/app/patient/actions";
import {
  activeFields,
  assessmentProgress,
  fieldComplete,
  mergeAnswers,
  inputConsistencyIssue,
  QuestionnaireInputError,
  type InputConsistencyIssue,
} from "@/lib/patient/questionnaire";
import { saveQuestionnaireAnswers } from "@/lib/patient/answer-transport";
import { openQuestionnaireSession, clearQuestionnaireSession, reopenSavedQuestionnaire, startQuestionnaireAtFirst } from "@/lib/patient/questionnaire-session";
import { firesEmergency } from "@/lib/clinical/rules/rules";
import { UNKNOWN, type Answers } from "@/lib/clinical/types";
import type { AssessmentDraft } from "@/lib/patient/types";
import { safeRequest } from "@/lib/patient/transport";
import { tx, type PatientLocale } from "@/lib/patient/copy";
import { Button } from "@/components/ui/button";
import { type Entry } from "./question-field";
type HistoryNavigationEvent = Event & {
  navigationType: string;
  destination: { key: string; url: string };
};
type HistoryNavigation = EventTarget & {
  traverseTo: (key: string) => { finished: Promise<unknown> };
};

export type QuestionnaireOptions = {
  initial: AssessmentDraft;
  locale: PatientLocale;
  startAtFirst?: boolean;
  onComplete?: () => void;
  onLater?: () => void;
  /** Chat owns scrolling and confirms typed answers explicitly. */
  contained?: boolean;
  /** A confirmed language-only save from this chat, never a refreshed answer snapshot. */
  externalRevision?: number;
};

/** One controller for the page and conversation: clinical branching and the ordered queue stay together. */
export function useQuestionnaire({ initial, locale, startAtFirst = false, onComplete, onLater, contained = false, externalRevision }: QuestionnaireOptions) {
  const router = useRouter();
  const [session] = useState(() => {
    const opened = openQuestionnaireSession(initial,
      (expectedRevision, entries, expectedAnswers) => safeRequest(() => saveQuestionnaireAnswers({ expectedAssessmentId: initial.id, expectedRevision, entries, expectedAnswers })));
    if (startAtFirst) startQuestionnaireAtFirst(opened);
    else if (contained && !opened.dirty && !opened.queue.pending) {
      const fields = activeFields(opened.answers).filter(f => f.topic.id !== "q1");
      opened.go((fields.find(f => !fieldComplete(f, opened.answers)) ?? fields.at(-1)!).id);
    }
    return opened;
  });
  const queue = session.queue;
  const [answers, setAnswers] = useState(session.answers),
    [revision, setRevision] = useState(queue.revision),
    [busy, setBusy] = useState(false),
    [status, setStatus] = useState<"saved" | "unsaved" | "error" | "conflict">(
      queue.failure !== undefined ? queue.failure?.reason === "conflict" ? "conflict" : "error" : queue.pending || session.dirty ? "unsaved" : "saved",
    ),
    [error, setError] = useState(""),
    [errorHref, setErrorHref] = useState<{ href: string; label: string } | null>(null);
  useLayoutEffect(() => {
    if (externalRevision === undefined || !Number.isSafeInteger(externalRevision) ||
      externalRevision <= queue.revision || queue.pending || busy || queue.failure !== undefined) return;
    // eslint-disable-next-line react-hooks/immutability -- retained imperative save queue owns its revision
    queue.revision = externalRevision;
    // The revision belongs to the retained session as well as this render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRevision(externalRevision);
  }, [externalRevision, queue, busy, revision, status]);
  const [validationAttempt, setValidationAttempt] = useState(0);
  const [confirmReopen, setConfirmReopen] = useState(false);
  const discardNotice = useRef<HTMLParagraphElement>(null);
  const recoveryTrigger = useRef<HTMLButtonElement | null>(null);
  const returnRecoveryFocus = useRef(false);
  useEffect(() => {
    if (confirmReopen) discardNotice.current?.focus(contained ? { preventScroll: true } : undefined);
    else if (returnRecoveryFocus.current) { recoveryTrigger.current?.focus(contained ? { preventScroll: true } : undefined); returnRecoveryFocus.current=false; }
  }, [confirmReopen, contained]);
  const heading = useRef<HTMLHeadingElement>(null);
  const errorNotice = useRef<HTMLParagraphElement>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const localAnswers = useRef(session.answers);
  const dirty = useRef(session.dirty);
  const transitioning = useRef(false);
  const transitionStart = useRef<number | null>(null);
  useEffect(() => {
    const changed = () => {
      setRevision(queue.revision);
      const failure = queue.failure;
      if (failure !== undefined) {
        setStatus(failure?.reason === "conflict" ? "conflict" : "error");
        setError(failure?.reason === "conflict"
            ? tx(locale, "Մեկ այլ էջում պատասխանները փոխվել են։ Վերաբացեք պահված տարբերակը։", "Answers changed in another session. Reopen the saved version.", "Ответы изменились в другом сеансе. Откройте сохранённую версию заново.")
            : tx(locale, "Չհաջողվեց պահել։ Պատասխանները դեռ այստեղ են։ Փորձեք կրկին։", "We couldn’t save. Your answers are still here. Try again.", "Не удалось сохранить. Ваши ответы остаются здесь. Попробуйте снова."));
      } else {
        setStatus(queue.pending || dirty.current ? "unsaved" : "saved");
        setError("");
      }
    };
    const unsubscribe = queue.subscribe(changed);
    changed();
    return unsubscribe;
  }, [queue, locale]);
  const currentFieldId = useRef(session.fieldId);
  const [fieldId, setFieldId] = useState(session.fieldId);
  const [fieldOpenedAt, setFieldOpenedAt] = useState(() => new Date().toISOString());
  const fields = activeFields(answers).filter((f) => f.topic.id !== "q1"),
    field = fields.find((f) => f.id === fieldId) ?? fields[0];
  const questionInSection = fields.filter(f => f.topic.id === field.topic.id).findIndex(f => f.id === field.id) + 1;
  const [entries, setEntries] = useState<Entry[]>(session.entries);
  let pending = answers;
  try {
    if (entries.length) pending = mergeAnswers(answers, entries);
  } catch {}
  const canFinish = fields.at(-1)?.id === field.id && fields.every(f => fieldComplete(f, pending));
  const urgent = firesEmergency({ answers: pending, observations: [] });
  useLayoutEffect(() => {
    if (urgent) heading.current?.focus(contained ? { preventScroll: true } : undefined);
  }, [urgent, contained]);
  const consistencyMessage = (issue: InputConsistencyIssue) => issue === "blood-pressure-order"
    ? tx(locale, "Վերին (սիստոլիկ) ճնշումը պետք է մեծ լինի ստորինից (դիաստոլիկից)։ Ստուգեք երկու թվերը։", "Your upper (systolic) pressure must be greater than your lower (diastolic) pressure. Check both numbers.", "Верхнее (систолическое) давление должно быть выше нижнего (диастолического). Проверьте оба числа.")
    : tx(locale, "Ծխելու տարիները չեն կարող գերազանցել ձեր տարիքը։ Ստուգեք տարիները կամ ձեր ծննդյան ամսաթիվը։", "Your years of smoking cannot exceed your age. Check the years or your date of birth.", "Стаж курения не может превышать ваш возраст. Проверьте стаж или дату рождения.");
  const range = field.parts ? tx(locale,
    `Վերին թիվը՝ ${field.parts.systolic.min}-ից ${field.parts.systolic.max}, ստորինը՝ ${field.parts.diastolic.min}-ից ${field.parts.diastolic.max}։`,
    `Upper number ${field.parts.systolic.min} to ${field.parts.systolic.max}, lower number ${field.parts.diastolic.min} to ${field.parts.diastolic.max}.`,
    `Верхнее число от ${field.parts.systolic.min} до ${field.parts.systolic.max}, нижнее от ${field.parts.diastolic.min} до ${field.parts.diastolic.max}.`)
    : field.min === undefined || field.max === undefined ? ""
    : (field.step ?? 1) < 1 ? tx(locale, `Մուտքագրեք թիվ ${field.min}-ից ${field.max}, քայլը՝ ${field.step}։`, `Enter a number from ${field.min} to ${field.max}, in steps of ${field.step}.`, `Введите число от ${field.min} до ${field.max} с шагом ${field.step}.`)
    : tx(locale, `Մուտքագրեք ամբողջ թիվ ${field.min}-ից ${field.max}։`, `Enter a whole number from ${field.min} to ${field.max}.`, `Введите целое число от ${field.min} до ${field.max}.`);
  const boundsMessage = contained && range ? `${tx(locale, "Ստուգեք պատասխանը։", "Check your answer.", "Проверьте ответ.")} ${range}`
    : tx(locale, "Ստուգեք պատասխանը և նշված սահմանները։", "Check your answer and the displayed bounds.", "Проверьте ответ и указанные пределы.");
  const incompleteMessage = tx(locale, "Լրացրեք այս պատասխանը՝ շարունակելու համար։", "Complete this answer to continue.", "Заполните этот ответ, чтобы продолжить.");
  const validationMessages = [boundsMessage, incompleteMessage,
    ...(field.kind === "blood-pressure" ? [consistencyMessage("blood-pressure-order")] : field.id === "q3.years" ? [consistencyMessage("smoking-years-age")] : [])];
  function persist(next: Entry[]) {
    if (queue.failure !== undefined) return null;
    let merged: Answers;
    try { merged = session.accept(next); }
    catch (error) {
      setError(error instanceof QuestionnaireInputError ? consistencyMessage(error.issue) : boundsMessage);
      return null;
    }
    localAnswers.current = merged;
    setAnswers(merged);
    dirty.current = false;
    return merged;
  }
  function reopenSavedVersion() {
    dirty.current = false;
    reopenSavedQuestionnaire(session.id);
  }
  const recoveryControls = confirmReopen ? <section className="space-y-3 rounded-md border p-4" aria-label={tx(locale,"Վերաբացել պահված տարբերակը","Reopen saved version", "Открыть сохранённую версию заново")}>
    <p ref={discardNotice} tabIndex={-1} role="alert" className="text-body2 outline-none">{tx(locale,"Այս էջի չպահված պատասխանները կհեռացվեն։ Կբացվի վերջին պահված տարբերակը։","Any unsaved answers on this page will be discarded. The latest saved version will open.", "Несохранённые ответы на этой странице будут удалены. Откроется последняя сохранённая версия.")}</p>
    <div className="flex flex-wrap gap-3">
      <Button variant="secondary" onClick={() => {returnRecoveryFocus.current=true; setConfirmReopen(false);}}>{tx(locale,"Պահել իմ պատասխանները","Keep my answers", "Оставить мои ответы")}</Button>
      <Button onClick={reopenSavedVersion}>{tx(locale,"Հեռացնել չպահված պատասխանները և վերաբացել","Discard unsaved answers and reopen", "Удалить несохранённые ответы и открыть заново")}</Button>
    </div>
  </section> : <Button ref={recoveryTrigger} onClick={() => setConfirmReopen(true)}>{tx(locale,"Վերաբացել պահված տարբերակը","Reopen saved version", "Открыть сохранённую версию заново")}</Button>;
  const navigationRef = useRef({ status, busy, urgent, entries });
  const persistRef = useRef(persist);
  useLayoutEffect(() => {
    navigationRef.current = { status, busy, urgent, entries };
    persistRef.current = persist;
  });
  useLayoutEffect(() => {
    transitioning.current = false;
    if (transitionStart.current === null) return;
    const started = transitionStart.current;
    transitionStart.current = null;
    const frame = requestAnimationFrame(() => {
      // Browser-local timing only; no answer values or remote telemetry.
      performance.measure("noreon-questionnaire-transition", { start: started, end: performance.now() });
      const timings = performance.getEntriesByName("noreon-questionnaire-transition");
      if (timings.length > 100) performance.clearMeasures("noreon-questionnaire-transition");
    });
    return () => cancelAnimationFrame(frame);
  }, [field.id]);
  useEffect(() => {
    if (contained) return;
    const leave = (event: MouseEvent) => {
      const current = navigationRef.current;
      if (!queue.pending && !dirty.current && !current.urgent) return;
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!link) return;
      const url = new URL(link.getAttribute("href")!, window.location.href);
      if (url.origin !== window.location.origin || !url.pathname.startsWith("/patient")) return;
      // After a recorded save failure the member may leave: the failed batch stays in this tab's
      // questionnaire memory and the retry is offered on return. A red answer still opens urgent.
      if (queue.failure !== undefined && !current.busy && !current.urgent) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (queue.failure !== undefined && !current.busy) { router.push("/patient/urgent"); return; }
      if (current.busy) return;
      if (dirty.current && !persistRef.current(current.entries)) return;
      void queue.flush().then(saved => {
        if (!active || !saved) return;
        router.push(firesEmergency({ answers: localAnswers.current, observations: [] }) ? "/patient/urgent" : (url.pathname + url.search + url.hash) as Route);
      });
    };
    const navigation = (window as unknown as { navigation?: HistoryNavigation }).navigation;
    let active = true;
    let historyLeaving = false;
    let permittedDestination: string | null = null;
    let destination: { key: string; url: string } | null = null;
    const historyLeave = (event: Event) => {
      const traversal = event as HistoryNavigationEvent;
      if (traversal.navigationType !== "traverse" || !traversal.cancelable) return;
      const current = navigationRef.current;
      if (permittedDestination === traversal.destination.key && !queue.pending && !dirty.current) {
        permittedDestination = null;
        return;
      }
      if (!queue.pending && !dirty.current && queue.failure === undefined && !current.urgent) return;
      if (queue.failure !== undefined && !current.busy && !current.urgent) return;
      // The Navigation API cancels traversal before popstate and before Next can
      // unmount this in-memory draft. It preserves the browser's Back/Forward list.
      traversal.preventDefault();
      destination = traversal.destination;
      if (historyLeaving || current.busy) return;
      if (queue.failure !== undefined) { router.replace("/patient/urgent"); return; }
      if (dirty.current && !persistRef.current(current.entries)) return;
      historyLeaving = true;
      setBusy(true);
      void queue.flush().then(saved => {
        if (!active) return;
        historyLeaving = false;
        setBusy(false);
        if (!saved || dirty.current || queue.pending || !destination) return;
        if (firesEmergency({ answers: localAnswers.current, observations: [] })) {
          router.replace("/patient/urgent");
        } else {
          permittedDestination = destination.key;
          void navigation!.traverseTo(destination.key).finished.catch(() => { permittedDestination = null; });
        }
      });
    };
    const warn = (event: BeforeUnloadEvent) => {
      if (!queue.pending && !dirty.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    document.addEventListener("click", leave, true);
    window.addEventListener("beforeunload", warn);
    navigation?.addEventListener("navigate", historyLeave);
    return () => {
      active = false;
      document.removeEventListener("click", leave, true);
      window.removeEventListener("beforeunload", warn);
      navigation?.removeEventListener("navigate", historyLeave);
    };
  }, [router, queue, contained]);
  useEffect(() => {
    if (contained || !dirty.current || !entries.length || queue.failure !== undefined) return;
    try { if (!fieldComplete(field, mergeAnswers(answers, entries))) return; } catch { return; }
    const timer = setTimeout(() => {
      if (currentFieldId.current === field.id && dirty.current) persistRef.current(entries);
    }, 650);
    return () => clearTimeout(timer);
  }, [entries, field, answers, queue, contained]);
  const go = (id: string) => {
    currentFieldId.current = id;
    session.go(id);
    setFieldId(id);
    setFieldOpenedAt(new Date().toISOString());
    setEntries(session.entries);
    dirty.current = false;
    if (queue.failure === undefined) {
      setError("");
      setStatus(queue.pending ? "unsaved" : "saved");
    }
    requestAnimationFrame(() => heading.current?.focus(contained ? { preventScroll: true } : undefined));
  };
  async function next(selected?: Entry[]) {
    if (currentFieldId.current !== field.id || busy || transitioning.current || queue.failure !== undefined) return;
    setValidationAttempt(attempt => attempt + 1);
    const draft = selected ?? entries;
    const blank = draft.length === 0 || draft.every(entry => entry.value === null);
    const skipBlankWaist = field.id === "q2.waist" && field.skippable && blank;
    // The question says to leave it blank when you don't remember, and that it is recorded as unknown.
    const skipBlankPressure = contained && field.kind === "blood-pressure" && blank;
    // A save clears this message as it finishes, so half a reading stops here and saves nothing.
    if (contained && field.kind === "blood-pressure" && !blank && draft.filter(entry => entry.value !== null).length < 2) {
      setError(incompleteMessage);
      return;
    }
    const merged = skipBlankWaist
      ? persist([{ fieldId: field.id, value: UNKNOWN }])
      : skipBlankPressure
      ? persist([{ fieldId: `${field.id}.systolic`, value: UNKNOWN }, { fieldId: `${field.id}.diastolic`, value: UNKNOWN }])
      : selected || dirty.current ? persist(draft) : localAnswers.current;
    if (!merged) return;
    if (!fieldComplete(field, merged)) {
      const issue = inputConsistencyIssue(field.id, merged);
      setError(issue ? consistencyMessage(issue) : incompleteMessage);
      return;
    }
    transitioning.current = true;
    transitionStart.current = performance.now();
    if (firesEmergency({ answers: merged, observations: [] })) return;
    const all = activeFields(merged).filter(f => f.topic.id !== "q1"), index = all.findIndex(f => f.id === field.id);
    if (index < all.length - 1) { go(all[index + 1].id); return; }
    const missing = all.find(f => !fieldComplete(f, merged));
    if (missing) { go(missing.id); return; }
    setError("");
    setErrorHref(null);
    setBusy(true);
    const flushed = await queue.flush();
    if (!mounted.current) return;
    if (!flushed) { setBusy(false); transitioning.current = false; return; }
    setBusy(true);
    const result = await safeRequest(() => completeAssessment(queue.revision, session.id));
    if (!mounted.current) return;
    setBusy(false);
    transitioning.current = false;
    if (result?.ok) {
      // eslint-disable-next-line react-hooks/immutability -- completion advances the retained imperative save queue
      queue.revision = result.revision;
      setRevision(result.revision);
      clearQuestionnaireSession(session.id);
      if (onComplete) onComplete();
      else { router.replace("/patient/health/profile"); router.refresh(); }
    }
    else if (result && "reason" in result && result.reason === "incomplete") {
      // Say what is missing and where to fix it, instead of a bare failure the member cannot act on.
      if (result.missing === "profile") {
        setError(tx(locale, "Չհաջողվեց ավարտել․ ձեր ծննդյան ամսաթիվը կամ սեռը բացակայում է ձեր տվյալներից։ Ստուգեք դրանք, ապա կրկին ավարտեք։", "We couldn’t finish: your date of birth or sex is missing from your details. Check them, then finish here.", "Не удалось завершить: в ваших данных не хватает даты рождения или пола. Проверьте их и завершите здесь."));
        setErrorHref({ href: "/patient/profile", label: tx(locale, "Բացել իմ տվյալները", "Open my details", "Открыть мои данные") });
      } else {
        setError(tx(locale, "Չհաջողվեց ավարտել․ որոշ պատասխաններ բացակայում են կամ այլևս չեն վավեր։ Անցեք բաժինները «Հետ» կոճակով և ստուգեք դրանք։", "We couldn’t finish: some answers are missing or no longer count. Use Back to go through the sections and check them.", "Не удалось завершить: некоторых ответов нет или они больше не подходят. Вернитесь кнопкой «Назад» по разделам и проверьте их."));
      }
      setStatus("error");
    }
    else {
      setError(tx(locale, "Չհաջողվեց ավարտել։ Փորձեք կրկին։", "We couldn’t finish. Try again.", "Не удалось завершить. Попробуйте снова."));
      setStatus(result && "reason" in result && result.reason === "conflict" ? "conflict" : "error");
    }
  }
  async function later() {
    if (busy) return;
    if (queue.failure !== undefined) {
      // Leave without saving: the failed batch stays in memory and is retried when the member returns.
      if (!urgent && onLater) onLater();
      else router.push(urgent ? "/patient/urgent" : "/patient/dashboard");
      return;
    }
    if (!contained && dirty.current && !persist(entries)) return;
    setBusy(true);
    const saved = await queue.flush();
    if (!mounted.current) return;
    setBusy(false);
    if (!saved) return;
    if (!urgent && onLater) onLater();
    else {
      router.push(urgent ? "/patient/urgent" : "/patient/dashboard");
      router.refresh();
    }
  }
  const progress = assessmentProgress(answers);
  const change = (next: Entry[]) => {
    if (currentFieldId.current !== field.id || transitioning.current) return;
    dirty.current = true;
    session.edit(next);
    setEntries(next);
    setStatus("unsaved");
    setError("");
  };
  const save = (entries: Entry[], advance?: boolean) =>
    currentFieldId.current !== field.id ? Promise.resolve(null)
      : advance ? next(entries) : Promise.resolve(persist(entries));
  const back = () => {
    if (currentFieldId.current !== field.id) return;
    if (dirty.current && !persist(entries)) return;
    const index = fields.findIndex(f => f.id === field.id);
    if (index > 0) go(fields[index - 1].id);
    else void later();
  };
  return { answers, fields, field, fieldOpenedAt, revision: queue.revision, entries, questionInSection, canFinish, urgent, progress,
    queue, busy, status, error, errorHref, validationAttempt, validationMessages, heading, errorNotice,
    recoveryControls, next, later, change, save, back, go, persist };
}
