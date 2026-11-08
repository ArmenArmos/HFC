import { localized } from "@/lib/clinical/types";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PatientDocumentLanguage } from "@/components/patient/document-language";
import { patientIdentity } from "@/lib/patient/auth";
import { requireRegistered } from "@/lib/patient/repository";
import { ruleById } from "@/lib/clinical/rules/rules";
import { tx } from "@/lib/patient/copy";
import { careAlertMemberStatus } from "@/lib/care-alerts/member";
import { reviewableAnswer, urgentAnswerReviewEnabled } from "@/lib/care-alerts/urgent-review";
import { reviewUrgentAnswer } from "@/lib/care-alerts/member-actions";

export const dynamic = "force-dynamic";

/**
 * "I answered this by mistake": the member looks at the one answer that fired the red flag
 * and may change it. Off by default (NOREON_URGENT_ANSWER_REVIEW_ENABLED) until the clinical
 * decision (PENDING_QUESTIONS P18); open only while care-team alerts are on, because the change
 * is recorded and the care team is alerted either way. WORDING AWAITING SIGN-OFF (P19).
 */
export default async function UrgentReview({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (!urgentAnswerReviewEnabled()) notFound();
  const { profile, assessment } = await requireRegistered();
  const rule = assessment.urgentRule ? ruleById(assessment.urgentRule) : null;
  if (!rule || rule.urgency !== "red") redirect("/patient/questions");
  const status = await careAlertMemberStatus();
  const review = reviewableAnswer(rule, assessment.answers);
  if (!status?.alertsEnabled || !review) redirect("/patient/urgent");
  const l = profile.locale;
  const t = (v: { hy: string; en?: string; ru?: string }) => localized(v, l);
  const { error } = await searchParams;
  const account = (await patientIdentity())?.userId;
  const errorText =
    error === "unchanged" ? tx(l, "Ընտրեք այլ պատասխան կամ վերադարձեք։", "Choose a different answer, or go back.", "Выберите другой ответ или вернитесь назад.")
    : error === "conflict" ? tx(l, "Ձեր պատասխանները փոխվել են մեկ այլ էկրանում։ Թարմացրեք էջը և փորձեք կրկին։", "Your answers changed on another screen. Reload and try again.", "Ваши ответы изменились на другом экране. Обновите страницу и попробуйте снова.")
    : error === "account" ? tx(l, "Այս դիտարկիչում մուտք է գործվել այլ հաշիվ։ Ոչինչ չի պահպանվել։", "Another account is signed in on this browser. Nothing was saved.", "В этом браузере выполнен вход в другой аккаунт. Ничего не сохранено.")
    : error ? tx(l, "Չհաջողվեց պահպանել։ Փորձեք կրկին կամ զանգահարեք 103։", "That did not save. Try again, or call 103.", "Не удалось сохранить. Попробуйте снова или позвоните 103.")
    : null;
  return (
    <main lang={l} className="min-h-dvh bg-[var(--marker-out-fg)] px-4 py-8 text-foreground sm:px-6 sm:py-12">
      <PatientDocumentLanguage locale={l} />
      <div className="mx-auto max-w-lg space-y-6 rounded-xl bg-card p-6 sm:p-8">
        <a
          href="tel:103"
          className="emergency-call flex min-h-14 w-full items-center justify-center rounded-md px-5 py-3"
        >
          {tx(l, "Եթե վատ եք զգում, զանգահարեք 103", "If you feel unwell, call 103", "Если вы плохо себя чувствуете, позвоните 103")}
        </a>
        <h1 className="text-h1">{tx(l, "Ստուգեք այս պատասխանը", "Check this answer", "Проверьте этот ответ")}</h1>
        <p className="text-body1">
          {tx(
            l,
            "Եթե այս պատասխանը սխալմամբ եք ընտրել, կարող եք փոխել այն։ Նորեոն Հելթի խնամքի թիմը կտեղեկանա ցանկացած փոփոխության մասին։",
            "If you chose this answer by mistake, you can change it. The Noreon care team is told about any change.",
            "Если вы выбрали этот ответ по ошибке, вы можете изменить его. Медицинская команда Нореон Хелс узнает о любом изменении.",
          )}
        </p>
        {errorText && <p role="alert" className="text-body2 text-destructive">{errorText}</p>}
        <form action={reviewUrgentAnswer} className="space-y-4">
          <input type="hidden" name="account" value={account} />
          <input type="hidden" name="fieldId" value={review.field.id} />
          <fieldset className="space-y-3">
            <legend className="text-body1 font-semibold">{t(review.field.label)}</legend>
            {review.field.options.map((o) => (
              <label key={o.value} className="flex min-h-11 items-center gap-3 rounded-md border px-4 text-body1">
                <input type="radio" name="value" value={o.value} defaultChecked={review.value === o.value} required />
                {t(o.label)}
              </label>
            ))}
          </fieldset>
          <button className="inline-flex min-h-11 items-center rounded-md border px-4 text-body2 font-medium focus-visible:outline-2 focus-visible:outline-ring">
            {tx(l, "Պահպանել իմ պատասխանը", "Save my answer", "Сохранить мой ответ")}
          </button>
        </form>
        <Link href="/patient/urgent" className="inline-flex min-h-11 items-center text-body2 underline underline-offset-4">
          {tx(l, "Վերադառնալ կարևոր տեղեկությանը", "Back to the important information", "Вернуться к важной информации")}
        </Link>
      </div>
    </main>
  );
}
