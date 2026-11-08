import { LanguagePreference } from "@/components/patient/language-preference";
import {readMemberSuggestionState} from '@/lib/chat/suggestion-read';
import {isMemberCardTarget} from "@/lib/zoe-chat-actions/everyday-contract";
import {MemberHelpContent} from '@/components/patient-care/member-help-content';
import { getPatientState } from "@/lib/patient/repository";
import { patientIdentity } from "@/lib/patient/auth";
import { parseLocale } from "@/lib/locale";
import { dateInArmenia } from "@/lib/patient/validation";
import { ZoeQuestionnaire, ZoeQuestionnaireOnboarding } from "@/components/patient/zoe-questionnaire";
import { cookies } from "next/headers";
import { ZOE_PROMPT_LATER_COOKIE } from "@/lib/zoe/consent-prompt";
import { redirect } from "next/navigation";
import { memberChatOnlyEnabled, memberChatDestination, newChatHome } from "@/lib/patient/member-chat-config";
import { zoeChatHop } from "@/lib/patient/entry-routes";
import { patientPresentation } from "@/lib/patient/presentation";
import { MemberHomeContent } from "@/components/patient/member-home-content";
import {ReportsContent} from "@/components/reports/member-reports-content";
import ProgressContent from "@/components/patient-care/member-progress-content";
import CareContent from "@/components/patient-care/member-care-content";
import ResultsContent from "@/components/patient-care/member-results-content";
import { CareRefresh } from "@/components/patient-care/controls";
import type { Metadata } from "next";
import { zoeChatKitEnabled } from "@/lib/patient/zoe-chat-design-preview";
import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import type { Route } from "next";
import { PatientShell } from "@/components/patient/patient-shell";
import { copy } from "@/components/patient-care/common";
import { ZoeChat } from "@/components/patient/zoe-chat";
import { ZoeQuickActions } from "@/components/patient/zoe-quick-actions";
import { requireRegisteredForRender } from "@/lib/patient/render-data";
import { reportsEnabled } from "@/lib/reports/enabled";
import { readTelegramLink } from "@/lib/telegram-runtime/member";
import { telegramBotUsername } from "@/lib/telegram-runtime/config";
import { readIntakeState } from "@/lib/zoe/app-chat";
import { doctorChannel, zoeEmergencyCardEnabled, zoeEmergencyCheck } from "@/lib/zoe/member-screen";
import { readZoeAccess } from "./chat-access";
import { readZoePrompt } from "@/lib/zoe/member";
import { ZoeChatConsent } from "@/components/patient/zoe-chat-consent";
import type { ZoeThread } from "@/lib/zoe/app-chat-contracts";
import { ZoeLessonOffer } from "@/components/lessons/zoe-lesson-offer";
import { readZoeCards } from "@/lib/zoe-chat-actions/server";
import { NO_CARDS } from "@/lib/zoe-chat-actions/registry";

export const metadata: Metadata = { title: "Zoe" };
export const dynamic = "force-dynamic";

const button =
  "inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg border border-primary bg-primary px-4 text-body2 font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/**
 * Zoe, chat first (Khikar, 18 Oct 22:57): a compact header, the thread and the composer, like a
 * messaging app. Emergency 103 is the shell's header pill only; Zoe's urgent replies and the urgent
 * screen on red flags are unchanged. About Zoe and the common questions live on Help.
 * With the app chat on (conversation_policy.app_chat_enabled) this is the member's one conversation
 * with their care team, the same one as in Telegram; a member with no clinical case yet is enrolled by
 * their first message. Otherwise one short line says why, with one action (chat-access.ts).
 * Neither calls a model from this page.
 */
export default async function ZoePage({ searchParams = Promise.resolve({}) }: { searchParams?: Promise<{ view?: string; card?: string; section?: string }> } = {}) {
  const params = await searchParams;
  // The new chat is the member chat when V3 is on; the page below stays for deep links and ?view=classic.
  if (newChatHome(params)) {
    // Only a member the chat would draw goes there; the rest stay on this page (see lib/patient/entry-routes.ts).
    const entry = await getPatientState({ coherentProfile: true });
    const hop = zoeChatHop({ registered: !!entry.profile && entry.consentAccepted && !!entry.assessment, urgent: !!entry.assessment && patientPresentation(entry.assessment).urgent },
      { chatV2: true, v3: true, emergencyCard: zoeEmergencyCardEnabled() }, params);
    if (hop) redirect(hop as Route);
  }
  const chatOnly = memberChatOnlyEnabled() && params.view !== "classic";
  // Intake is available before Zoe message consent and case enrolment. The same forms own
  // consent, clinical answers and urgent stops; no AI conversation starts before those gates.
  if (chatOnly) {
    const state = await getPatientState({ coherentProfile: true });
    const l = state.profile?.locale ?? parseLocale((await cookies()).get("noreon_locale")?.value, "hy");
    const incomplete = !state.profile || !state.consentAccepted || !state.assessment;
    if (incomplete || !state.assessment?.completedAt) {
      if (state.assessment && patientPresentation(state.assessment).urgent) redirect("/patient/urgent");
      const prompt = incomplete ? await readZoePrompt().catch(() => null) : null;
      return <PatientShell locale={l} memberName={state.profile?.name}>
        <div className="mx-auto max-w-2xl space-y-4" data-zoe-page data-chat-only-page>
          <header className="border-b py-2" data-zoe-header><h1 className="text-h3">Zoe</h1><p className="text-caption text-muted-foreground">{copy(l, "AI assistant, not a doctor", "ԱԲ օգնական, ոչ բժիշկ", "ИИ-помощник, не врач")}</p></header>
          <div data-member-chat-thread><section data-zoe-thread aria-label={copy(l, "Your health questions", "Ձեր առողջության հարցերը", "Ваши вопросы о здоровье")}>
            {params.card==='help'?<div className="member-chat-card" data-member-chat-card="help"><MemberHelpContent locale={l} contact={{mode:'none'}} signedIn={false} signingUp/></div>
              :params.card==='account'&&params.section==='language'&&state.assessment?<div className="member-chat-card" data-member-chat-card="language"><LanguagePreference embedded locale={l} revision={state.assessment.revision}/></div>
              :(isMemberCardTarget(params.card)||["progress","results","reports","care"].includes(params.card??""))&&<p role="status" className="member-chat-card text-body2">{copy(l,'Finish your health questions here before opening this card.','Այս քարտը բացելուց առաջ այստեղ ավարտեք առողջության հարցերը։','Прежде чем открыть эту карточку, завершите здесь вопросы о здоровье.')}</p>}
            <div className="member-chat-card" data-member-chat-card data-chat-intake>
              {incomplete ? <ZoeQuestionnaireOnboarding expectedRevision={state.assessment?.revision ?? -1} today={dateInArmenia()} initialLocale={l} languageCard={params.card==='account'&&params.section==='language'&&!state.assessment} zoeStatement={prompt?.due} zoeDirectAnswers={prompt?.directAnswers} draftKey={(await patientIdentity())?.userId} memberChatV2={process.env.NOREON_MEMBER_CHAT_V2 === "true"} />
                : <ZoeQuestionnaire key={state.assessment!.id} initial={state.assessment!} locale={l} />}
            </div>
          </section></div>
        </div>
      </PatientShell>;
    }
  }
  const { profile, assessment } = await requireRegisteredForRender();
  if (chatOnly) {
    const destination = memberChatDestination({ enabled: true, complete: !!assessment.completedAt, ...patientPresentation(assessment) });
    if (destination && destination !== "/patient/zoe") redirect(destination);
  }
  let selectedCard = !chatOnly ? null : params.card === "progress" ? <ProgressContent embedded searchParams={Promise.resolve({})} />
    : params.card === "reports" ? <ReportsContent embedded />
    : params.card === "questionnaire" ? <div className="member-chat-card" data-member-chat-card><ZoeQuestionnaire initial={assessment} locale={profile.locale} startAtFirst /></div>
    : params.card === "care" ? <CareContent embedded /> : params.card === "results" ? <ResultsContent embedded /> : null;
  const l = profile.locale;
  const access = await readZoeAccess();
  const thread: ZoeThread | null = access.kind === "chat" ? access.thread : null;
  // Zoe is off for this member: never decided, or agreed only to an outdated wording, and a grant of the
  // wording this app shows is possible (the Home card's rule). A member who turned Zoe off chose so; the
  // switch for them is in Me, Privacy & consents.
  const prompt = thread || chatOnly ? await readZoePrompt().catch(() => null) : null;
  const zoeOff = thread && prompt?.zoeScreen ? prompt : null;
  const homeConsent = chatOnly && !!prompt?.due && !(await cookies()).has(ZOE_PROMPT_LATER_COOKIE);
  const intro = chatOnly ? <MemberHomeContent chat promptForChat={prompt} searchParams={Promise.resolve({})} /> : null;
  const emergencyCheck = thread && zoeEmergencyCardEnabled() ? zoeEmergencyCheck(await readIntakeState().catch(() => null)) : null;
  const upload = reportsEnabled();
  // Zoe's action cards (conversation_policy.zoe_chat_actions_enabled): read with the thread; off or unreadable, none.
  const cards = thread ? await readZoeCards() : NO_CARDS;
  if (thread && chatOnly && cards.enabled) thread.suggestionState = await readMemberSuggestionState(thread);
  if (chatOnly && isMemberCardTarget(params.card) && (!thread || !cards.enabled)) selectedCard = <div role="status" className="space-y-3 rounded-2xl border border-border bg-card p-4">
    <p>{copy(l, "This card is unavailable. You can use the previous pages.", "Այս քարտն անհասանելի է։ Կարող եք օգտվել նախորդ էջերից։", "Эта карточка недоступна. Вы можете воспользоваться прежними страницами.")}</p>
    <Link href="/patient/dashboard?view=classic" className={button}>{copy(l, "Open the previous page", "Բացել նախորդ էջը", "Открыть прежнюю страницу")}</Link>
  </div>;
  let off: ReactNode = null;
  if (access.kind === "blocked") {
    const doctor = access.reason === "chat_off" ? doctorChannel(await readTelegramLink().catch(() => null), telegramBotUsername()) : null;
    // One line and one action per reason (lead, 18 Oct 23:15), never the old information page.
    const [line, action] =
      access.reason === "staff_account"
        ? [copy(l, "You are signed in with a staff account. Zoe chat is for members.", "Դուք մուտք եք գործել աշխատակցի հաշվով։ Zoe-ի զրույցը անդամների համար է։", "Вы вошли с учётной записью сотрудника. Чат с Zoe предназначен для участников."),
           { href: "/staff", label: copy(l, "Open the staff workspace", "Բացել աշխատակցի էջը", "Открыть рабочее пространство сотрудника"), external: false }]
        : access.reason === "read_failed"
          ? [copy(l, "Your chat did not load. Try again in a moment.", "Զրույցը չբեռնվեց։ Մի պահից նորից փորձեք։", "Ваш чат не загрузился. Попробуйте снова чуть позже."),
             { href: "/patient/zoe", label: copy(l, "Try again", "Կրկին փորձել", "Попробуйте снова"), external: false }]
          : doctor?.mode === "telegram"
            ? [copy(l, "Chat in the app is not on yet. Write to your care team in Telegram.", "Հավելվածում զրույցը դեռ միացված չէ։ Գրեք ձեր խնամքի թիմին Telegram-ում։", "Чат в приложении ещё не включён. Напишите вашей медицинской команде в Telegram."),
               { href: doctor.href, label: copy(l, "Open the Telegram chat", "Բացել Telegram զրույցը", "Открыть чат в Telegram"), external: true }]
            : doctor?.mode === "connect"
              ? [copy(l, "Chat in the app is not on yet. Connect Telegram to write to your care team.", "Հավելվածում զրույցը դեռ միացված չէ։ Միացրեք Telegram-ը՝ ձեր խնամքի թիմին գրելու համար։", "Чат в приложении ещё не включён. Подключите Telegram, чтобы написать вашей медицинской команде."),
                 { href: doctor.href, label: copy(l, "Connect Telegram", "Միացնել Telegram-ը", "Подключить Telegram"), external: false }]
              : access.reason === "not_eligible"
                ? [copy(l, "This account cannot chat with Zoe. Staff accounts and unconfirmed phone numbers cannot write to the care team.", "Այս հաշվից հնարավոր չէ զրուցել Zoe-ի հետ։ Աշխատակցի հաշիվները և չհաստատված հեռախոսահամարները չեն կարող գրել խնամքի թիմին։", "С этой учётной записи нельзя общаться с Zoe. С учётных записей сотрудников и с неподтверждёнными номерами телефона нельзя писать медицинской команде."),
                   { href: "/patient/team?section=contact", label: copy(l, "Contact Noreon", "Կապվել Noreon-ի հետ", "Связаться с Noreon"), external: false }]
              : [copy(l, "Chat with Zoe is not on for your account yet. Contact Noreon if you need help.", "Zoe-ի հետ զրույցը դեռ միացված չէ ձեր հաշվի համար։ Օգնության համար կապվեք Noreon-ի հետ։", "Чат с Zoe ещё не включён для вашей учётной записи. Свяжитесь с Noreon, если вам нужна помощь."),
                 { href: "/patient/team?section=contact", label: copy(l, "Contact Noreon", "Կապվել Noreon-ի հետ", "Связаться с Noreon"), external: false }];
    off = (
      <div className="space-y-4" data-zoe-off={access.reason}>
        <div className="flex flex-wrap items-center gap-3">
          <p className="min-w-0 flex-1 basis-56 text-body2">{line}</p>
          {action.external ? (
            <a href={action.href} target="_blank" rel="noreferrer" className={button}>{action.label}</a>
          ) : (
            <Link href={action.href as Route} className={button}>{action.label}</Link>
          )}
        </div>
        {!chatOnly && access.reason !== "staff_account" && <ZoeQuickActions locale={l} upload={upload} />}
      </div>
    );
  }
  return (
    <PatientShell locale={l} memberName={profile.name}>
      {chatOnly && <CareRefresh />}
      <div className="mx-auto max-w-2xl space-y-4" data-zoe-page data-chat-only-page={chatOnly || undefined}>
        {/* Sticky under the app header (globals.css --journey-sticky-top), so the page scrolling to the newest
            message never hides who the member is talking to. */}
        {!chatOnly && <header className="sticky z-10 -mx-1 flex items-center gap-3 border-b bg-[var(--noreon-gray-100)] px-1 py-2" data-zoe-header>
          <span className="journey-orb !size-10" aria-hidden />
          <div className="min-w-0 flex-1">
            <h1 className="text-h3">Zoe</h1>
            {/* Redesign rail 3: fixed UI text, never model output. */}
            <p className="text-caption text-muted-foreground" data-zoe-rail>
              {copy(l, "AI assistant, not a doctor", "ԱԲ օգնական, ոչ բժիշկ", "ИИ-помощник, не врач")}
            </p>
          </div>
          <Link href="/patient/help#about-zoe" className="inline-flex min-h-11 items-center px-2 text-body2 font-semibold text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
            {copy(l, "About Zoe", "Zoe-ի մասին", "О Zoe")}
          </Link>
        </header>}
        {/* Short lessons (Armen's item 6): at most one offer a day; never blocks the chat. */}
        {!chatOnly && thread && <Suspense fallback={null}><ZoeLessonOffer thread={thread} locale={l} /></Suspense>}
        {thread ? (
          <ZoeChat memberName={profile.name} accountSection={params.section === "reminders" || params.section === "language" || params.section === "text-size" || params.section === "privacy" ? params.section : undefined} chatOnly={chatOnly} intro={intro} selectedCard={selectedCard} cardKey={params.card} emergencyCheck={emergencyCheck} locale={l} initial={thread} upload={upload} cards={cards} kit={zoeChatKitEnabled()} consent={zoeOff && !homeConsent ? <ZoeChatConsent locale={l} directAnswers={zoeOff.directAnswers} /> : null} />
        ) : (
          <div className="member-chat-off space-y-4">{intro}{off}{selectedCard}</div>
        )}
      </div>
    </PatientShell>
  );
}
