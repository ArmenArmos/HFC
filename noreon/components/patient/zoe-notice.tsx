"use client";
import Link from "next/link";
import type { Route } from "next";
import { signInAgain } from "./sign-in-ended";
import { tx, type PatientLocale } from "@/lib/patient/copy";
import type { Notice } from "./use-zoe-thread";
const noticeLink = "inline-flex min-h-11 items-center font-semibold text-foreground underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
/** The composer's notice for a send that was not stored. Exported for the checks. */
export function ZoeNotice({ locale: l, notice, contained = false }: { locale: PatientLocale; notice: Notice; contained?: boolean }) {
  return (
    <>
      {notice === "doctor_sent" && <p role="status" className="text-body2">{tx(l, "Ուղարկված է ձեր բժշկին։ Պատասխանը կստանաք այստեղ։", "Sent to your doctor. They will answer here.", "Отправлено вашему врачу. Ответ появится здесь.")}</p>}
      {notice === "empty" && (
        <p role="alert" className="text-body2">
          {tx(l, "Գրեք ձեր հաղորդագրությունը։", "Write your message first.", "Сначала напишите сообщение.")}
        </p>
      )}
      {notice === "too_long" && (
        <p role="alert" className="text-body2">
          {tx(l, "Հաղորդագրությունը չափազանց երկար է։ Կրճատեք այն։", "Your message is too long. Shorten it.", "Ваше сообщение слишком длинное. Сократите его.")}
        </p>
      )}
      {notice === "rate_limited" && (
        <p role="alert" className="text-body2">
          {tx(
            l,
            "Կարճ ժամանակում շատ հաղորդագրություն եք ուղարկել, և այս մեկը չուղարկվեց։ Նախորդները հասել են ձեր խնամքի թիմին։ Մի քանի րոպե սպասեք, ապա նորից գրեք։",
            "You sent many messages in a short time, so this one was not sent. Your earlier messages reached your care team. Wait a few minutes, then write again.",
            "Вы отправили много сообщений за короткое время, поэтому это сообщение не отправлено. Предыдущие сообщения поступили вашей медицинской команде. Подождите несколько минут, затем напишите снова.",
          )}
        </p>
      )}
      {notice === "unavailable" && (
        <p role="alert" className="text-body2">
          {tx(
            l,
            "Այստեղ գրելը հիմա հասանելի չէ։ Շտապ բժշկական օգնության համար զանգահարեք 103։",
            "Writing here is not available right now. For urgent medical help, call 103.",
            "Сейчас написать здесь нельзя. Для срочной медицинской помощи вызовите скорую помощь (103).",
          )}
        </p>
      )}
      {/* Permanent refusals say what to do; "Not sent. Try again." is only for a transient error. */}
      {notice === "needs_review_request" && (
        <div role="alert" className="space-y-1 text-body2" data-zoe-notice="needs_review_request">
          <p>
            {tx(
              l,
              "Նախ ուղարկեք ձեր վերանայման հարցումը, որպեսզի կարողանաք գրել ձեր խնամքի թիմին։",
              "Send your review request first to start chatting with your care team.",
              "Сначала отправьте запрос на проверку, чтобы начать переписку с вашей медицинской командой.",
            )}
          </p>
          {!contained && <Link href={"/patient/review" as Route} className={noticeLink}>
            {tx(l, "Ուղարկել վերանայման հարցումը", "Send my review request", "Отправить запрос на проверку")}
          </Link>}
        </div>
      )}
      {notice === "not_eligible" && (
        <div role="alert" className="space-y-1 text-body2" data-zoe-notice="not_eligible">
          <p>
            {tx(
              l,
              "Այս հաշվից հնարավոր չէ գրել խնամքի թիմին։ Ստուգեք, որ ձեր հեռախոսահամարը հաստատված է, կամ կապվեք Noreon-ի հետ։",
              "This account cannot write to the care team. Check that your phone number is confirmed, or contact Noreon.",
              "С этой учётной записи нельзя написать медицинской команде. Убедитесь, что ваш номер телефона подтверждён, или свяжитесь с Noreon.",
            )}
          </p>
          {!contained && <Link href={"/patient/account" as Route} className={noticeLink}>
            {tx(l, "Բացել իմ հաշիվը", "Open my account", "Открыть мою учётную запись")}
          </Link>}
        </div>
      )}
      {notice === "sign_in_again" && (
        <div role="alert" className="space-y-1 text-body2" data-zoe-notice="sign_in_again">
          <p>
            {tx(
              l,
              "Ձեր մուտքի ժամկետն ավարտվել է։ Մուտք գործեք նորից, ապա ուղարկեք հաղորդագրությունը։",
              "Your sign-in has ended. Sign in again, then send your message.",
              "Срок действия вашего входа истёк. Войдите снова, затем отправьте сообщение.",
            )}
          </p>
          <button
            type="button"
            className={noticeLink}
            onClick={() => void signInAgain(l)}
          >
            {tx(l, "Մուտք գործել նորից", "Sign in again", "Войти снова")}
          </button>
        </div>
      )}
    </>
  );
}
