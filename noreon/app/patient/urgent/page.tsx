import { MemberScreen } from "@/components/patient-care/member-screens";
import { memberScreensPrototypeEnabled } from "@/lib/patient/member-screens-config";
import { localized } from "@/lib/clinical/types";
import Link from "next/link";
import { PatientDocumentLanguage } from "@/components/patient/document-language";
import { requireRegistered } from "@/lib/patient/repository";
import { ruleById } from "@/lib/clinical/rules/rules";
import { tx } from "@/lib/patient/copy";
import { careAlertMemberStatus } from "@/lib/care-alerts/member";
import { reviewableAnswer, urgentAnswerReviewEnabled } from "@/lib/care-alerts/urgent-review";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function Urgent({ searchParams }: { searchParams?: Promise<{ changed?: string; view?: string }> } = {}) {
  const { profile, assessment } = await requireRegistered();
  const rule = assessment.urgentRule ? ruleById(assessment.urgentRule) : null;
  const { changed, view } = (await searchParams) ?? {};
  const prototype = memberScreensPrototypeEnabled() && view !== "classic";
  // After a correction clears the red flag, keep the confirmation on the questionnaire (Fable U5).
  if (!rule || rule.urgency !== "red") redirect(changed === "1" ? "/patient/questions?changed=1" : "/patient/questions");
  const t = (v: { hy: string; en?: string; ru?: string }) => localized(v, profile.locale);
  const l = profile.locale;
  const status = await careAlertMemberStatus();
  const canReview = urgentAnswerReviewEnabled() && status?.alertsEnabled === true && reviewableAnswer(rule, assessment.answers) !== null;
  const callAction = (
        <a
          href="tel:103"
          className="emergency-call flex min-h-16 w-full items-center justify-center rounded-md px-5 py-4"
        >
          {tx(l, "Զանգահարել 103 հիմա", "Call 103 now", "Позвонить 103 сейчас")}
        </a>
  );
  return (
    <main
      lang={l}
      className={`${prototype ? "member-journey ms-urgent " : ""}min-h-dvh bg-[var(--marker-out-fg)] px-4 py-8 text-foreground sm:px-6 sm:py-12`}
    >
      <PatientDocumentLanguage locale={l} />
      {/* Emergency guidance has no presentation-switch navigation. */}
      <MemberScreen enabled={prototype} locale={l}>
      <div className={prototype ? "ms-urgent-card mx-auto max-w-lg space-y-6 rounded-xl bg-card p-6 sm:p-8" : "mx-auto max-w-lg space-y-6 rounded-xl bg-card p-6 sm:p-8"}>
        <p className="text-h2 font-bold text-destructive">
          {tx(l, "Անհրաժեշտ է շտապ օգնություն", "Urgent care needed", "Нужна срочная медицинская помощь")}
        </p>
        {prototype && callAction}
        <h1 className="text-h1">{t(rule.reason)}</h1>
        {rule.nextStep && <p className="text-body1">{t(rule.nextStep)}</p>}
        {!prototype && callAction}
        <p className="text-body1 font-semibold">
          {tx(
            l,
            "Նստեք, մի մնացեք մենակ, մի վարեք մեքենա։",
            "Sit down. Do not stay alone. Do not drive.",
            "Сядьте. Не оставайтесь одни. Не садитесь за руль.",
          )}
        </p>
        {/* Says "alerted" only when the database confirms an alert for this red flag.
            WORDING AWAITING SIGN-OFF (PENDING_QUESTIONS P19). */}
        <p className="text-body2 text-muted-foreground">
          {status === null
            ? tx(
                l,
                "Զանգահարեք 103 հիմա։ Մի սպասեք այս ծառայությանը։",
                "Call 103 now. Do not wait for this service.",
                "Позвоните 103 сейчас. Не ждите ответа от этого сервиса.",
              )
            : status.alerted
            ? tx(
                l,
                "Մենք տեղեկացրել ենք Նորեոն Հելթի խնամքի թիմին այս պատասխանի մասին։ Շտապ օգնությունը այս ծառայության միջոցով չի կանչվել։",
                "We have told the Noreon care team about this answer. Emergency services have not been called through this service.",
                "Мы сообщили медицинской команде Нореон Хелс об этом ответе. Через этот сервис скорая помощь не была вызвана.",
              )
            : tx(
                l,
                "Բժիշկը կամ շտապ օգնությունը այս ծառայության միջոցով չեն ծանուցվել։",
                "A doctor or emergency service has not been notified through this service.",
                "Через этот сервис врач или скорая помощь не были уведомлены.",
              )}
        </p>
        {changed === "1" && (
          <p role="status" className="text-body2">
            {tx(l, "Ձեր փոփոխությունը պահպանվել է։", "Your change was saved.", "Ваше изменение сохранено.")}
          </p>
        )}
        <nav className="flex flex-wrap gap-3" aria-label={tx(l, "Այլ տարբերակներ", "Other options", "Другие варианты")}>
          <Link
            href="/patient/help"
            className="inline-flex min-h-11 items-center rounded-md border px-4 text-body2 font-medium focus-visible:outline-2 focus-visible:outline-ring"
          >
            {tx(l, "Ստանալ օգնություն", "Get help", "Получить помощь")}
          </Link>
          {canReview && (
            <Link
              href="/patient/urgent/review"
              className="inline-flex min-h-11 items-center rounded-md px-4 text-body2 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring"
            >
              {tx(l, "Սխալմամբ եմ պատասխանել", "I answered this by mistake", "Этот ответ выбран по ошибке")}
            </Link>
          )}
        </nav>
      </div>
      </MemberScreen>
    </main>
  );
}
