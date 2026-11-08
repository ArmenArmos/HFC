import Link from "next/link";
import { tx, type PatientLocale } from "@/lib/patient/copy";
import { Call103 } from "@/components/patient/use-hydrated";
import type { CareAlertZoeStatus } from "@/lib/care-alerts/member";
import { ZoeUrgentNotice } from "./notice";

/** One source for urgent wording, call action, truthful database notice and exits, on the page and in the thread. */
export function ZoeUrgentContent({locale:l,request,initial=null,inline=false,contained=false}:{locale:PatientLocale;request:string|null;initial?:CareAlertZoeStatus|null;inline?:boolean;contained?:boolean}){
 const Heading=inline?'h2':'h1';
 return (
      <div className={inline ? "space-y-3 rounded-2xl rounded-bl-md border border-destructive bg-[var(--marker-out-bg)] px-4 py-3" : "mx-auto max-w-lg space-y-6 rounded-xl bg-card p-6 sm:p-8"} data-zoe-emergency-content>
        <Heading className={inline ? "text-body1 font-semibold text-destructive" : "text-h1 font-bold text-destructive"}>
          {tx(l, "Անհրաժեշտ է շտապ օգնություն", "Urgent care needed", "Нужна срочная медицинская помощь")}
        </Heading>
        {contained ? <Call103 size="call" className="flex min-h-12 w-full items-center justify-center rounded-md px-3 py-2 text-center">
          {tx(l, "Զանգահարել 103 հիմա", "Call 103 now", "Позвонить 103 сейчас")}
        </Call103> : <a
          href="tel:103"
          className={inline ? "emergency-call flex min-h-12 w-full items-center justify-center rounded-md px-3 py-2 text-center" : "emergency-call flex min-h-16 w-full items-center justify-center rounded-md px-5 py-4"}
        >
          {tx(l, "Զանգահարել 103 հիմա", "Call 103 now", "Позвонить 103 сейчас")}
        </a>}
        <p className="text-body1 font-semibold">
          {tx(
            l,
            "Նստեք, մի մնացեք մենակ, մի վարեք մեքենա։",
            "Sit down. Do not stay alone. Do not drive.",
            "Сядьте. Не оставайтесь одни. Не садитесь за руль.",
          )}
        </p>
        <p className="text-body2 text-muted-foreground">
          {tx(
            l,
            "Զանգահարեք 103 հիմա։ Մի սպասեք այս ծառայությանը։",
            "Call 103 now. Do not wait for this service.",
            "Позвоните 103 сейчас. Не ждите ответа от этого сервиса.",
          )}
        </p>
        {/* WORDING AWAITING SIGN-OFF (PENDING_QUESTIONS P19): the questionnaire screen's two lines, unchanged. */}
        <ZoeUrgentNotice
          request={request}
          initial={initial}
          retryUnknown={inline}
          told={tx(
            l,
            "Մենք տեղեկացրել ենք Noreon-ի խնամքի թիմին այս պատասխանի մասին։ Շտապ օգնությունը այս ծառայության միջոցով չի կանչվել։",
            "We have told the Noreon care team about this answer. Emergency services have not been called through this service.",
            "Мы сообщили медицинской команде Noreon об этом ответе. Через этот сервис скорая помощь не была вызвана.",
          )}
          notTold={tx(
            l,
            "Բժիշկը կամ շտապ օգնությունը այս ծառայության միջոցով չեն ծանուցվել։",
            "A doctor or emergency service has not been notified through this service.",
            "Через этот сервис врач или скорая помощь не были уведомлены.",
          )}
        />
        {!contained && <nav className="flex flex-wrap gap-3" aria-label={tx(l, "Այլ տարբերակներ", "Other options", "Другие варианты")}>
          <Link
            href="/patient/help"
            className="inline-flex min-h-11 items-center rounded-md border px-4 text-body2 font-medium focus-visible:outline-2 focus-visible:outline-ring"
          >
            {tx(l, "Ստանալ օգնություն", "Get help", "Получить помощь")}
          </Link>
        </nav>}
      </div>
 );
}
