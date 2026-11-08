"use client";
import { useLayoutEffect } from "react";
import { useRouter } from "next/navigation";
import { localized } from "@/lib/clinical/types";
import { fieldComplete } from "@/lib/patient/questionnaire";
import { tx } from "@/lib/patient/copy";
import { Button } from "@/components/ui/button";
import { QuestionField } from "./question-field";
import { useQuestionnaire, type QuestionnaireOptions } from "./use-questionnaire";

export function Questionnaire(options: QuestionnaireOptions) {
  const { locale } = options;
  const router = useRouter();
  const t = (v: { hy: string; en?: string; ru?: string }) => localized(v, locale);
  const { answers, field, entries, questionInSection, canFinish, urgent, progress,
    queue, busy, status, error, errorHref, validationAttempt, validationMessages, heading, errorNotice,
    recoveryControls, next, later, change, save, back, persist } = useQuestionnaire(options);
  useLayoutEffect(() => {
    if (!error || !errorNotice.current) return;
    const bounds = errorNotice.current.getBoundingClientRect();
    if (bounds.top < 0 || bounds.bottom > window.innerHeight)
      errorNotice.current.scrollIntoView({ block: "nearest" });
  }, [error, validationAttempt, errorNotice]);
  if (urgent)
    return (
      <div className="mx-auto max-w-lg space-y-6">
        <p className="text-caption text-destructive">
          {tx(locale, "Կարևոր է հիմա", "Important now", "Важно сейчас")}
        </p>
        <h1 ref={heading} tabIndex={-1} className="text-h1 outline-none">
          {t(urgent.reason)}
        </h1>
        {urgent.nextStep && <p className="text-body1">{t(urgent.nextStep)}</p>}
        <a
          href="tel:103"
          className="emergency-call flex min-h-14 w-full items-center justify-center rounded-md px-5 py-3"
        >
          {tx(locale, "Զանգահարել 103", "Call 103", "Позвонить 103")}
        </a>
        <p className="text-body2 text-muted-foreground">
          {tx(
            locale,
            "Բժիշկը կամ շտապ օգնությունը այս ծառայության միջոցով չեն ծանուցվել։",
            "A doctor or emergency service has not been notified through this service.",
            "Врач и служба скорой помощи не получили уведомление через этот сервис.",
          )}
        </p>
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        {queue.pending && queue.failure === undefined && (
          <p role="status" className="text-body2 text-muted-foreground">
            {tx(locale, "Պատասխանը պահվում է։ Զանգահարելու համար պետք չէ սպասել։", "Your answer is saving. You can call now.", "Ваш ответ сохраняется. Вы можете позвонить сейчас.")}
          </p>
        )}
        {status === "conflict" ? (
          recoveryControls
        ) : queue.failure !== undefined || (status === "unsaved" && !queue.pending) ? (
          <Button variant="secondary" disabled={busy} onClick={() => {
            if (queue.failure !== undefined) void queue.retry();
            else persist(entries);
          }}>
            {queue.failure !== undefined
              ? tx(locale, "Կրկին պահել պատասխանը", "Retry saving answer", "Повторить сохранение ответа")
              : tx(locale, "Պահել պատասխանը", "Save answer", "Сохранить ответ")}
          </Button>
        ) : null}
        <Button
          variant="secondary"
          disabled={busy || status !== "saved"}
          onClick={() => router.replace("/patient/urgent")}
        >
          {tx(
            locale,
            "Տեսնել կարևոր տեղեկությունը",
            "View important information",
            "Посмотреть важную информацию",
          )}
        </Button>
      </div>
    );
  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-caption text-brand-teal">
            {tx(locale, `Բաժին ${field.topic.index}՝ 10-ից`, `Section ${field.topic.index} of 10`, `Раздел ${field.topic.index} из 10`)} · {t(field.topic.title)}
          </p>
          <p className="text-caption text-muted-foreground">
            {tx(locale, `Հարց ${questionInSection} այս բաժնում`, `Question ${questionInSection} in this section`, `Вопрос ${questionInSection} в этом разделе`)}
          </p>
        </div>
        <span className="shrink-0 whitespace-nowrap text-caption text-muted-foreground" aria-live="polite">
          {busy || (queue.pending && queue.failure === undefined)
            ? tx(locale, "Պահվում է…", "Saving…", "Сохраняется…")
            : status === "saved"
              ? tx(locale, "Պահված է", "Saved", "Сохранено")
              : tx(locale, "Պահված չէ", "Not saved", "Не сохранено")}
        </span>
      </div>
      {field.topic.index === 2 && questionInSection === 1 && <p className="text-caption text-muted-foreground">
        {tx(locale, "Ձեր տվյալները բաժին 1-ն էին։ Յուրաքանչյուր բաժին կարող է ներառել մի քանի հարց։", "Your profile was section 1. Each section may include several questions.", "Ваш профиль был первым разделом. В каждом разделе может быть несколько вопросов.")}
      </p>}
      <div
        className="h-1 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label={tx(locale, "Ավարտված բաժիններ", "Completed sections", "Завершённые разделы")}
        aria-valuetext={tx(locale, `Ավարտված է ${progress.completedTopics} բաժին՝ 10-ից`, `${progress.completedTopics} of 10 sections complete`, `Завершено ${progress.completedTopics} из 10 разделов`)}
        aria-valuenow={progress.completedTopics}
        aria-valuemin={0}
        aria-valuemax={10}
      >
        <div
          className="h-full bg-brand-teal"
          style={{ width: `${progress.completedTopics * 10}%` }}
        />
      </div>
      <div className="rounded-2xl border border-brand-teal/30 bg-surface-subtle-teal p-4">
      <h1 ref={heading} tabIndex={-1} className="text-h2 outline-none" style={{ fontSize: "var(--text-h2-size)", lineHeight: "var(--text-h2-line)" }}>
        {t(field.label)}
      </h1>
      </div>
      {field.help && (
        <p className="text-body2 text-muted-foreground">{t(field.help)}</p>
      )}
      {field.kind === "single" && (
        <p className="text-caption text-muted-foreground">
          {tx(
            locale,
            "Ընտրեք մեկ պատասխան․ հաջորդ հարցը կբացվի ինքնաշխատ։",
            "Choose one answer to continue automatically.",
            "Выберите один ответ, чтобы автоматически перейти дальше.",
          )}
        </p>
      )}
      <div data-questionnaire-answer onKeyDown={event => {
        const target = event.target as HTMLElement;
        if (event.key === "Enter" && target.tagName === "INPUT" && target.getAttribute("type") === "number") {
          event.preventDefault();
          void next();
        }
      }}>
      <QuestionField
        key={field.id}
        field={field}
        entries={entries}
        locale={locale}
        disabled={busy || status === "conflict" || status === "error"}
        onChange={change}
        onSave={save}
      />
      </div>
      {(field.kind !== "single" || error) && <div data-questionnaire-feedback className="grid text-sm">
      {field.kind !== "single" && validationMessages.map(message => (
        <p key={message} aria-hidden="true" className="invisible col-start-1 row-start-1">{message}</p>
      ))}
      {error && (
        <p ref={errorNotice} role="alert" className="col-start-1 row-start-1 text-destructive">
          {error}
        </p>
      )}
      {error && errorHref && <a href={errorHref.href} className="col-start-1 row-start-2 underline">{errorHref.label}</a>}
      </div>}
      {status === "error" && queue.failure !== undefined && (
        <Button onClick={() => void queue.retry()} disabled={busy}>
          {tx(locale, "Կրկին պահել պատասխանները", "Retry saving answers", "Повторить сохранение ответов")}
        </Button>
      )}
      {status === "conflict" ? (
        recoveryControls
      ) : queue.failure === undefined && (field.kind !== "single" ||
        status === "error" ||
        status === "unsaved" ||
        fieldComplete(field, answers)) ? (
        <Button
          className="h-12 w-full"
          disabled={busy}
          onClick={(event) => { if (event.detail <= 1) void next(); }}
        >
          {canFinish ? busy
            ? tx(locale, "Ավարտվում է…", "Finishing…", "Завершение…")
            : status === "error" && queue.failure === undefined
            ? tx(locale, "Փորձել կրկին", "Try again", "Попробовать снова")
            : tx(locale, "Ավարտել հարցաշարը", "Finish questionnaire", "Завершить анкету")
            : tx(locale, "Շարունակել", "Continue", "Продолжить")}
        </Button>
      ) : null}
      <div className="flex flex-wrap justify-between gap-2">
        <Button
          variant="outline"
          className="h-auto min-h-11 whitespace-normal"
          disabled={busy || status === "conflict" || queue.failure !== undefined}
          onClick={(event) => {
            if (event.detail > 1) return;
            back();
          }}
        >
          {tx(locale, "Հետ", "Back", "Назад")}
        </Button>
        <Button
          variant="outline"
          className="h-auto min-h-11 whitespace-normal"
          disabled={busy || status === "conflict"}
          onClick={later}
        >
          {tx(locale, "Ավարտել ավելի ուշ", "Finish later", "Завершить позже")}
        </Button>
      </div>
    </div>
  );
}
