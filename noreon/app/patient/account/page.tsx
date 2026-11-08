import { MemberScreen } from "@/components/patient-care/member-screens";
import { memberScreensPrototypeEnabled } from "@/lib/patient/member-screens-config";
import { Bell, ShieldCheck, ClipboardList, FileHeart, Files, Phone, PhoneCall, MessageSquare, Send, UserRound, Users, ChevronDown, CircleDashed } from "lucide-react";
import { RowLink, Status } from "@/components/patient-care/common";
import { requireRegisteredForRender } from "@/lib/patient/render-data";
import { PatientShell } from "@/components/patient/patient-shell";
import { LanguagePreference } from "@/components/patient/language-preference";
import { SignOutButton } from "@/components/patient/sign-out-button";
import { PwaInstall } from "@/components/patient/pwa-install";
import { tx } from "@/lib/patient/copy";
import { telegramEnabled } from "@/lib/telegram-runtime/config";
import { TextSizePreference } from "@/components/patient/text-size-preference";
import { WhenWeReply } from "@/components/patient/when-we-reply";
import { readMemberContactStatus, readMemberTextSize } from "@/lib/patient/member-preferences";
import type { MemberContactStatus } from "@/lib/patient/member-preferences-contract";
import { ZoeConsents } from "@/components/patient/zoe-consents";
import { readZoeConsents, type ZoeConsentView } from "@/lib/zoe/member";
export default async function Account({ searchParams = Promise.resolve({}) }: { searchParams?: Promise<{ view?: string }> } = {}) {
  const prototype = memberScreensPrototypeEnabled() && (await searchParams).view !== "classic";
  const { profile, assessment } = await requireRegisteredForRender(), l = profile.locale;
  const textSize = await readMemberTextSize();
  // Shown for orientation only; the contact page is where it changes. A failed read hides the line.
  let contact: MemberContactStatus | null = null;
  try { contact = await readMemberContactStatus(); } catch { contact = null; }
  // My consents: the Zoe switches, whatever the Telegram link. Null (Zoe off, or nothing to show) keeps the placeholder line.
  let zoe: ZoeConsentView | null = null;
  try { zoe = await readZoeConsents(); } catch { zoe = null; }
  return <PatientShell locale={l}><MemberScreen enabled={prototype} locale={l} classicHref="/patient/account?view=classic"><div className={prototype ? "ms-support ms-account space-y-6" : "space-y-6"}>
    <header className="flex items-center gap-3">
      <span className="journey-avatar" aria-hidden>{profile.name.split(/\s+/).filter(Boolean).map(n=>n[0]).slice(0,2).join("")}</span>
      <div className="min-w-0"><h1 className="break-words text-h1">{profile.name}</h1><p className="mt-1 text-caption text-muted-foreground">{tx(l,"Ձեր տվյալներն ու նախընտրությունները","Your details and preferences","Ваши данные и предпочтения")}</p></div>
    </header>
    {/* Privacy and consents near the top (lead 18 Oct 16:09: the Zoe switch was hard to find). */}
    {zoe && <div className="journey-card !p-1"><RowLink narrowIconAbove={prototype} href="#my-consents" icon={ShieldCheck} detail={tx(l,"Zoe-ն և ձեր համաձայնությունները","Zoe and your consents", "Zoe и ваши согласия")}>{tx(l,"Գաղտնիություն և համաձայնություններ","Privacy & consents","Конфиденциальность и согласия")}</RowLink></div>}
    {/* Prototype Me (pair 16): one card per setting, the most used first. */}
    <LanguagePreference locale={l} revision={assessment.revision} />
    <div id="text-size" className="journey-card scroll-mt-20"><TextSizePreference locale={l} value={textSize} /></div>
    <section className="journey-card space-y-3" aria-labelledby="reach-title">
      <header><h2 id="reach-title" className="text-h2">{tx(l,"Ինչպես կապվենք ձեզ հետ","How we reach you","Как мы связываемся с вами")}</h2>
        {contact && <p className="text-body2 text-muted-foreground">{tx(l,"Հիմա՝ ","Now: ","Сейчас: ")}<strong className="font-semibold text-foreground">{contact.contactChannel === "phone" ? tx(l,"հեռախոսազանգ","a phone call","телефонный звонок") : "Telegram"}</strong></p>}
      </header>
      <div className="divide-y border-t border-border/70">
        <RowLink narrowIconAbove={prototype} href="/patient/account/contact" icon={PhoneCall} detail={tx(l,"Telegram կամ զանգ, հարմար ժամեր, հետզանգ","Telegram or a call, best times, callback", "Telegram или звонок, удобное время, обратный звонок")}>{tx(l,"Կապ և հետզանգ","Contact and callback","Связь и обратный звонок")}</RowLink>
        <RowLink narrowIconAbove={prototype} href="/patient/account/messages" icon={MessageSquare}>{tx(l,"Կապի կարգավորումներ","Message preferences","Настройки сообщений")}</RowLink>
        {telegramEnabled() && <RowLink narrowIconAbove={prototype} href="/patient/account/telegram" icon={Send} detail={tx(l,"Բժշկի պատասխանները Telegram-ում","Doctor replies in Telegram","Ответы врача в Telegram")}>Telegram</RowLink>}
      </div>
    </section>
    <section className="journey-card space-y-3" aria-labelledby="reminders-title">
      <h2 id="reminders-title" className="text-h2">{tx(l,"Հիշեցումներ","Reminders","Напоминания")}</h2>
      <div className="divide-y border-t border-border/70">
        <RowLink narrowIconAbove={prototype} href="/patient/account/reminders" icon={Bell} detail={tx(l,"Դեղերի և ճնշման հիշեցումներ","Medicine and blood-pressure reminders","Напоминания о лекарствах и измерении давления")}>{tx(l,"Կարգավորել հիշեցումները","Set my reminders","Настроить напоминания")}</RowLink>
      </div>
    </section>
    {zoe && <div id="my-consents" className="scroll-mt-20"><ZoeConsents locale={l} initial={{ readsMessages: zoe.readsMessages, scheduledQuestions: zoe.scheduledQuestions }} canGrant={zoe.canGrant} directAnswers={zoe.directAnswers} headingId="my-consents-title" title={tx(l,"Իմ համաձայնությունները","My consents","Мои согласия")} /></div>}
    <section className="journey-card space-y-3">
      <header className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-h2">{tx(l,"Ձեր առողջության պրոֆիլը","Your health profile","Ваш профиль здоровья")}</h2><Status tone={assessment.completedAt ? "complete" : "neutral"}>{assessment.completedAt ? tx(l,"Լրացված է","Complete","Заполнено") : tx(l,"Լրացվում է","In progress","Заполняется")}</Status></header>
      <div className="divide-y">
        <RowLink narrowIconAbove={prototype} href="/patient/profile?view=classic" icon={UserRound}>{tx(l,"Փոխել տվյալները","Edit my details","Изменить мои данные")}</RowLink>
        <RowLink narrowIconAbove={prototype} href="/patient/questions" icon={ClipboardList} detail={assessment.completedAt ? tx(l,"Հարցաշարը լրացված է։","Questionnaire complete.","Анкета заполнена.") : tx(l,"Շարունակեք ձեր հարցաշարը։","Continue your questionnaire.","Продолжите заполнение анкеты.")}>{tx(l,"Առողջության հարցեր","Health questions","Вопросы о здоровье")}</RowLink>
        <RowLink narrowIconAbove={prototype} href="/patient/reports" icon={Files}>{tx(l,"Փաստաթղթեր","Your reports","Ваши документы")}</RowLink>
        <RowLink narrowIconAbove={prototype} href="/patient/health/profile" icon={FileHeart}>{tx(l,"Առողջության ամփոփում","Health summary","Сводка о здоровье")}</RowLink>
      </div>
    </section>
    <section className="journey-card space-y-3">
      <h2 className="text-h2">{tx(l,"Խնամքի թիմ","Care team","Медицинская команда")}</h2>
      <div className="divide-y"><RowLink narrowIconAbove={prototype} href="/patient/team?section=contact" icon={Users}>{tx(l,"Կապվել խնամքի թիմի հետ","Contact your care team","Связаться с медицинской командой")}</RowLink>
      <RowLink narrowIconAbove={prototype} href="/patient/help" icon={Phone}>{tx(l,"Օգնություն","Get help","Получить помощь")}</RowLink></div>
    </section>
    <details className="group rounded-xl border border-border/70 px-4">
      <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 py-3 text-caption font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden"><CircleDashed className="size-5 shrink-0" aria-hidden /><span className="min-w-0 flex-1">{tx(l,"Դեռ անհասանելի կարգավորումներ","Settings not available yet","Настройки пока недоступны")}</span><ChevronDown className="size-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden /></summary>
      <div className="divide-y">{[
        [tx(l,"Zoe-ի կարգավորումներ","Zoe preferences","Настройки Zoe"),tx(l,"Աջակցությունն ու հանգիստ ժամերը՝ շուտով։","Coaching and quiet hours are coming soon.","Поддержка и часы тишины скоро появятся.")],
        ...(zoe ? [] : [[tx(l,"Իմ համաձայնությունները","My consents","Мои согласия"),tx(l,"Լրացուցիչ կառավարումը դեռ հասանելի չէ։ Ձեր առկա ընտրությունները չեն փոխվում։","Additional controls are not available yet. Your existing choices remain in place.","Дополнительные настройки пока недоступны. Ваши текущие настройки сохраняются.")]]),
        [tx(l,"Ով կարող է տեսնել իմ տվյալները","Who can see my data","Кто может видеть мои данные"),tx(l,"Ընտանիքի հետ կիսվելը դեռ հասանելի չէ։","Family sharing is not available yet.","Доступ для семьи пока недоступен.")],
      ].map(([title,detail])=><div key={title} aria-disabled="true" className="space-y-1 py-3"><h2 className="text-body2 font-medium">{title}</h2><p className="text-caption text-muted-foreground">{detail}</p></div>)}</div>
    </details>
    <WhenWeReply locale={l}/>
    <PwaInstall locale={l}/>
    <div className="border-t pt-5"><SignOutButton locale={l}/></div>
  </div></MemberScreen></PatientShell>;
}
