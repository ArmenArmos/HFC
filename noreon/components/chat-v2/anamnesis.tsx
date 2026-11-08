"use client";
import { Fragment, useEffect, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { QuestionField } from "@/components/patient/question-field";
import { useQuestionnaire } from "@/components/patient/use-questionnaire";
import { ZoeEmergencyCard } from "@/components/patient/zoe-emergency-card";
import { fieldComplete, skipWording, typedAnswerEntries } from "@/lib/patient/questionnaire";
import { questionnaireEntries } from "@/lib/patient/questionnaire-session";
import { localized, UNKNOWN, type AssessmentField, type Answers } from "@/lib/clinical/types";
import type { AssessmentDraft } from "@/lib/patient/types";
import { tx, type PatientLocale } from "@/lib/patient/copy";
import { ANAMNESIS, say } from "@/lib/zoe-chat-actions/copy";

export function answerText(field: AssessmentField, answers: Answers, locale: PatientLocale) {
  const entries = questionnaireEntries(field.id, answers);
  if (field.kind === "blood-pressure") entries.sort((a, b) => Number(b.fieldId.endsWith(".systolic")) - Number(a.fieldId.endsWith(".systolic")));
  if (entries.length > 0 && entries.every(entry => entry.value === UNKNOWN)) return skipWording(field, locale);
  return entries.map(({ value }) => {
    if (value === UNKNOWN) return skipWording(field, locale);
    const label = (value: string) => {
      const option = field.options?.find(option => option.value === value);
      return option ? localized(option.label, locale) : value;
    };
    if (typeof value === "number" && field.openMax && value >= field.max!) return `${field.max}+`;
    return Array.isArray(value) ? value.map(label).join(", ") : typeof value === "string" ? label(value) : String(value);
  }).join(" / ") + (field.unit && !entries.some(entry => entry.value === UNKNOWN) ? ` ${localized(field.unit, locale)}` : "");
}

/** form: an open form from Zoe. Like a 103 card, what the member just asked for stays below the open question. */
export type QuestionnaireTurn = { key: string; at: string; node: ReactNode; emergency?: boolean; form?: boolean };

// Later is a choice about this device's chat, not a health answer, so it stays out of the save path.
const laterKey = (id: string) => `noreon.questions.later.${id}`;
const noChanges = () => () => {};
function readLater(id: string) {
  try { return window.localStorage.getItem(laterKey(id)) ?? ""; } catch { return ""; }
}
function keepLater(id: string, at: string | null) {
  try {
    if (at) window.localStorage.setItem(laterKey(id), at);
    else window.localStorage.removeItem(laterKey(id));
  } catch {
    // Private mode or storage full: Later still holds until this page closes.
  }
}

/** Staging opt-in copy pending language approval. Questions and answer labels come from the clinical seed. */
export function Anamnesis({ initial, locale, emergencyCard, onTurn, onAction, threadTurns = [], revision, onState, onComplete, disabled = false, fillRef, refreshOnComplete = false, showProgress = false }: {
  initial: AssessmentDraft; locale: PatientLocale; emergencyCard: boolean; onTurn: () => void; threadTurns?: QuestionnaireTurn[];
  /** The member acted here, so the chat follows to the end even if they had scrolled up. */
  onAction?: () => void;
  onComplete?: () => void;
  revision?: number; onState?: (revision: number, pending: boolean) => void; disabled?: boolean;
  /** Set while a question is open, so a plain answer typed in the chat box fills it. */
  fillRef?: RefObject<((text: string) => boolean) | null>;
  refreshOnComplete?: boolean;
  /** V3: a thin bar over the open question. */
  showProgress?: boolean;
}) {
  const router = useRouter();
  // Null until this browser has been read, so the server never paints a question a member paused.
  const savedLater = useSyncExternalStore(noChanges, () => readLater(initial.id), () => null);
  const [chosen, setMode] = useState<"offer" | "active" | "paused" | "complete" | null>(null);
  const mode = chosen ?? (initial.completedAt ? "complete" : savedLater ? "paused"
    : Object.keys(initial.answers).some(id => !id.startsWith("q1.")) ? "active" : "offer");
  const [openedAt] = useState(() => new Date().toISOString());
  const [modeAt, setModeAt] = useState(initial.completedAt ?? openedAt);
  const [choices, setChoices] = useState<QuestionnaireTurn[]>([]);
  const recordChoice = (label: string, at = new Date().toISOString()) => {
    setModeAt(at);
    setChoices(previous => [...previous, { key: `choice-${previous.length}`, at,
      node: <article className="cv2-msg cv2-me"><p className="cv2-say">{label}</p></article> }]);
  };
  const state = useQuestionnaire({ initial, locale, contained: true, externalRevision: revision,
    onComplete: () => { setMode("complete"); setModeAt(new Date().toISOString()); onComplete?.(); if (refreshOnComplete) router.refresh(); }, onLater: () => { keepLater(initial.id, new Date().toISOString()); setMode("paused"); recordChoice(later); },
  });
  const { field, fields, answers, entries, questionInSection, urgent, queue, busy, status, error, errorHref } = state;
  useEffect(() => { onState?.(state.revision, queue.pending || busy); }, [state.revision, queue.pending, busy, onState]);
  const yes = tx(locale, "Այո, պատասխանել հիմա", "Yes, answer now", "Да, ответить сейчас");
  const later = tx(locale, "Ավելի ուշ", "Later", "Позже");
  const resume = tx(locale, "Շարունակել իմ հարցերը", "Continue my questions", "Продолжить мои вопросы");
  const history = fields.filter(f => fieldComplete(f, answers) && (mode !== "active" || urgent || f.id !== field.id));
  const previous = fields.slice(0, fields.findIndex(f => f.id === field.id)).filter(f => fieldComplete(f, answers)).at(-1);
  // Notify the thread's existing follower, never force a reader away from older messages.
  useEffect(() => { onTurn(); }, [field.id, mode, choices.length, urgent?.id, onTurn]);
  useEffect(() => {
    // Guidance is visible immediately. The full route needs the recorded flag, so keep
    // guidance and retry here until the existing queue has saved it successfully.
    if (urgent && !emergencyCard && status === "saved" && !queue.pending) router.replace("/patient/urgent");
  }, [urgent, emergencyCard, status, queue, router]);
  const canAnswer = mode === "active" && savedLater !== null && !urgent && !disabled && !busy && status !== "conflict" && queue.failure === undefined;
  useEffect(() => {
    if (!fillRef) return;
    fillRef.current = canAnswer ? text => {
      const typed = typedAnswerEntries(field, text, answers, locale);
      if (!typed) return false;
      state.change(typed);
      void state.save(typed, true);
      return true;
    } : null;
    return () => { fillRef.current = null; };
  });
  const choose = (label: string, next: "active" | "paused") => {
    if (savedLater && !chosen) recordChoice(later, savedLater);
    keepLater(initial.id, next === "paused" ? new Date().toISOString() : null);
    recordChoice(label);
    setMode(next);
  };
  const retry = <button type="button" disabled={disabled || busy} onClick={() => void queue.retry()}>
    {tx(locale, "Կրկին պահել պատասխանները", "Retry saving answers", "Повторить сохранение ответов")}
  </button>;
  const turns: QuestionnaireTurn[] = [...threadTurns, ...choices];
  const firstAnswerAt = Object.values(answers).filter(answer => !answer.fieldId.startsWith("q1.")).map(answer => answer.answeredAt).sort()[0];
  // A restored offer precedes its first saved answer. No second persistence path for health data.
  const offerAt = [firstAnswerAt, savedLater || undefined, openedAt].filter(at => at !== undefined).sort()[0];
  if (!initial.completedAt) turns.push({ key: "offer", at: offerAt, node: <article className="cv2-msg cv2-zoe">
      <p className="cv2-from"><i className="cv2-orb" aria-hidden />Zoe</p>
      <p className="cv2-say">{tx(locale, "Կցանկանա՞ք հիմա պատասխանել առողջության մասին մի քանի հարցի։", "Would you like to answer a few health questions now?", "Хотите сейчас ответить на несколько вопросов о здоровье?")}</p>
      {mode === "offer" && savedLater !== null && !urgent && <div className="cv2-question-actions">
        <button type="button" onClick={() => choose(yes, "active")}>{yes}</button>
        <button type="button" onClick={() => choose(later, "paused")}>{later}</button>
      </div>}
    </article> });
  // No second persistence path: saved answers already prove the member said yes.
  if (firstAnswerAt && !chosen && !initial.completedAt) turns.push({ key: "saved-yes", at: offerAt, node: <article className="cv2-msg cv2-me"><p className="cv2-say">{yes}</p></article> });
  for (const question of history) {
    const at = questionnaireEntries(question.id, answers).map(entry => answers[entry.fieldId].answeredAt).sort().at(-1)!;
    turns.push({ key: `answer-${question.id}`, at, node: <Fragment key={question.id}>
      <article className="cv2-msg cv2-zoe"><p className="cv2-from"><i className="cv2-orb" aria-hidden />Zoe</p><p className="cv2-say">{localized(question.label, locale)}</p></article>
      <article className="cv2-msg cv2-me" data-answer-id={question.id}><p className="cv2-say">{answerText(question, answers, locale)}</p></article>
    </Fragment> });
  }
  const controls = urgent ? <div className="cv2-question-urgent" data-questionnaire-urgent>
      <p className="cv2-say">{localized(urgent.reason, locale)}</p>
      {urgent.nextStep && <p>{localized(urgent.nextStep, locale)}</p>}
      <ZoeEmergencyCard locale={locale} request={null} contained />
      {error && <p role="alert">{error}</p>}
      {error && errorHref && <button type="button" className="cv2-link" onClick={() => window.location.assign(errorHref.href)}>{errorHref.label}</button>}
      {status === "conflict" ? state.recoveryControls : queue.failure !== undefined ? retry : null}
    </div> : mode === "complete" ? <article className="cv2-msg cv2-zoe"><p className="cv2-say" role="status">{tx(locale, "Ձեր հարցաշարն ավարտված է։", "Your questionnaire is complete.", "Ваша анкета завершена.")}</p></article>
      : mode === "paused" ? <article className="cv2-msg cv2-zoe"><p className="cv2-say">{tx(locale, "Կարող եք շարունակել ձեր հարցերն այստեղ։", "You can continue your questions here.", "Вы можете продолжить отвечать на вопросы здесь.")}</p><div className="cv2-question-actions"><button type="button" onClick={() => choose(resume, "active")}>{resume}</button></div></article>
      : mode === "active" && savedLater !== null ? <article className="cv2-msg cv2-zoe" data-question-id={field.id}>
        <p className="cv2-from"><i className="cv2-orb" aria-hidden />Zoe</p>
        {showProgress && <div className="cv2-progress" role="progressbar" aria-label={say(locale, ANAMNESIS.progress)} aria-valuemin={0} aria-valuemax={10} aria-valuenow={field.topic.index - 1}><i style={{ width: `${(field.topic.index - 1) * 10}%` }} /></div>}
        <p className="cv2-time">{tx(locale, `Բաժին ${field.topic.index}՝ 10-ից`, `Section ${field.topic.index} of 10`, `Раздел ${field.topic.index} из 10`)}</p>
        {field.topic.index === 2 && questionInSection === 1 && <p className="cv2-time">{tx(locale, "Ձեր տվյալները բաժին 1-ն էին։ Յուրաքանչյուր բաժին կարող է ներառել մի քանի հարց։", "Your profile was section 1. Each section may include several questions.", "Ваш профиль был первым разделом. В каждом разделе может быть несколько вопросов.")}</p>}
        <div className="cv2-question">
          <h3>{localized(field.label, locale)}</h3>
          {field.help && <p>{localized(field.help, locale)}</p>}
          <form onSubmit={event => { event.preventDefault(); onAction?.(); if (!disabled) void state.next(); }} noValidate>
            <QuestionField key={field.id} field={field} entries={entries} locale={locale} compact
              disabled={disabled || busy || status === "conflict" || status === "error"}
              onChange={state.change} onSave={state.save} />
            {error && <p role="alert">{error}</p>}
            {status === "conflict" ? state.recoveryControls : queue.failure !== undefined ? retry :
              (field.kind !== "single" || fieldComplete(field, answers) || error) && <button type="submit" className="cv2-confirm" disabled={disabled || busy}>
                {tx(locale, "Հաստատել պատասխանը", "Confirm answer", "Подтвердить ответ")}
              </button>}
          </form>
          {(busy || queue.pending && queue.failure === undefined) && <p className="cv2-time" role="status">{tx(locale, "Պահվում է…", "Saving…", "Сохраняется…")}</p>}
          <div className="cv2-question-actions">
            {previous && <button type="button" disabled={disabled || busy || status === "error" || status === "conflict"} onClick={() => state.go(previous.id)}>{tx(locale, "Փոխել վերջին պատասխանը", "Change my last answer", "Изменить последний ответ")}</button>}
            <button type="button" disabled={disabled || busy || status === "conflict"} onClick={() => void state.later()}>{later}</button>
          </div>
        </div>
      </article> : null;
  if (mode === "paused" && !chosen) turns.push({ key: "saved-later", at: savedLater!, node: <article className="cv2-msg cv2-me"><p className="cv2-say">{later}</p></article> });
  // What the member can act on next stays at the end, so it is never left above newer messages.
  // Red still wins: an emergency typed while this question is open keeps its 103 card below the question.
  const openAt = [modeAt, state.fieldOpenedAt].sort().at(-1)!;
  const emergencyAt = turns.filter(turn => (turn.emergency || turn.form) && turn.at > openAt).map(turn => turn.at).sort()[0];
  const lastAt = [openAt, ...turns.map(turn => turn.at).filter(at => !emergencyAt || at < emergencyAt)].sort().at(-1)!;
  if (controls) turns.push({ key: "current-question", at: urgent ? Object.values(answers).map(answer => answer.answeredAt).sort().at(-1)! : mode === "active" || mode === "paused" ? lastAt : modeAt, node: controls });
  turns.sort((a, b) => a.at.localeCompare(b.at));
  return <div className="cv2-anamnesis" data-chat-anamnesis onClick={event => { if (event.target instanceof Element && event.target.closest("button")) onAction?.(); }}>{turns.map(turn => <Fragment key={turn.key}>{turn.node}</Fragment>)}</div>;
}
