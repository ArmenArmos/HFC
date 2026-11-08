import {bpObservationCounts} from '@/lib/patient/bp-provenance';
import type { ReactNode } from "react";
import Link from "next/link";
import type { Route } from "next";
import { ArrowRight, Bell, CalendarDays, ClipboardList, FileHeart, Files, FlaskConical, HeartPulse, History, Leaf, List, MessageCircle, Pill, UserRound, type LucideIcon } from "lucide-react";
import type { PatientLocale } from "@/lib/patient/copy";
import type { Measurement } from "@/lib/patient/types";
import type { CareAction, CareData } from "@/lib/patient-care/types";
import type { JourneyAction } from "@/lib/patient-care/journey-step";
import type { ReminderPreferences } from "@/lib/patient-care/reminder-preferences";
import { homeDashboard } from "@/lib/patient-care/home-dashboard";
import { armeniaDate } from "@/lib/patient-care/model";
import { nextDateWhen, type NextDate } from "@/lib/patient-care/next-date";
import type { MemberLdl } from "@/lib/ldl/schema";
import { ldlObservations } from "@/lib/ldl/status";
import { copy, stamp } from "@/components/patient-care/common";
import { HomeJourneyStrip, HomeUnwellCard } from "@/components/patient-care/home-journey";
import type { exerciseGuidance } from "@/lib/member-safety/contract";

type Props = {
  chat?: boolean;
  locale: PatientLocale;
  greeting: string;
  date: string;
  now: Date;
  care: CareData;
  measurements: Measurement[];
  preferences: ReminderPreferences;
  next: CareAction | JourneyAction | null;
  nextDate: NextDate | null;
  ldl: MemberLdl | undefined;
  doctor: string | null | undefined;
  journeyCurrent: number;
  exercise: ReturnType<typeof exerciseGuidance>;
  notices?: ReactNode;
  details?: ReactNode;
};

function HomeLink({ href, children, className = "member-home-link" }: { href: string; children: ReactNode; className?: string }) {
  return <Link href={href as Route} className={className}>{children}</Link>;
}

/** Presentation only. Scheduling, dose counts and LDL normalization use the existing models. */
export function MemberHome({ chat = false, locale: l, greeting, date, now, care, measurements, preferences, next, nextDate, ldl, doctor, journeyCurrent, exercise, notices, details }: Props) {
  const nextHref = (href: string) => {
    const page = href.split(/[?#]/)[0];
    return chat && ["/patient/progress", "/patient/care", "/patient/results", "/patient/service"].includes(page)
      ? `/patient/zoe?card=${page === "/patient/service" ? "visit" : page.split("/").at(-1)}` : href;
  };
  const rhythm = homeDashboard(care, measurements, preferences, now);
  const latestLdl = ldl?.enabled && ldl.inPathway
    ? ldlObservations(ldl.observations).filter(row => row.memberVisible && row.counts && row.on <= armeniaDate(now)).at(-1)
    : null;
  const menu: { href: string; label: string; Icon: LucideIcon }[] = [
    { href: "/patient/progress", label: copy(l, "My results", "Իմ արդյունքները", "Мои результаты"), Icon: FlaskConical },
    { href: "/patient/care", label: copy(l, "My plan", "Իմ պլանը", "Мой план"), Icon: ClipboardList },
    { href: "/patient/medicines", label: copy(l, "My medicines", "Իմ դեղերը", "Мои лекарства"), Icon: Pill },
    { href: "/patient/bp-week", label: copy(l, "My blood pressure week", "Իմ ճնշման շաբաթը", "Моя неделя давления"), Icon: HeartPulse },
    { href: "/patient/measurements/new", label: copy(l, "Record a reading", "Գրանցել չափում", "Записать измерение"), Icon: HeartPulse },
    { href: "/patient/service", label: copy(l, "My tests and visits", "Իմ հետազոտություններն ու այցերը", "Мои анализы и визиты"), Icon: CalendarDays },
    { href: "/patient/account/reminders", label: copy(l, "My reminders", "Իմ հիշեցումները", "Мои напоминания"), Icon: Bell },
    { href: "/patient/dashboard?view=classic#daily-routine", label: copy(l, "Daily routine and wellbeing", "Առօրյան և ինքնազգացողությունը", "Распорядок дня и самочувствие"), Icon: HeartPulse },
    { href: "/patient/learn", label: exercise === "suggest"
      ? copy(l, "Food and walking tips", "Սննդի և քայլքի խորհուրդներ", "Советы по питанию и ходьбе")
      : copy(l, "Food tips", "Սննդի խորհուրդներ", "Советы по питанию"), Icon: Leaf },
    { href: "/patient/progress/earlier", label: copy(l, "Add a result or report", "Ավելացնել արդյունք կամ զեկույց", "Добавить результат или отчёт"), Icon: Files },
    { href: "/patient/results/history", label: copy(l, "My result history", "Իմ արդյունքների պատմությունը", "История моих результатов"), Icon: History },
    { href: "/patient/reports", label: copy(l, "My reports", "Իմ զեկույցները", "Мои отчёты"), Icon: Files },
    { href: "/patient/health/profile", label: copy(l, "My answers", "Իմ պատասխանները", "Мои ответы"), Icon: FileHeart },
    { href: "/patient/questions", label: copy(l, "Change my answers", "Փոխել պատասխանները", "Изменить ответы"), Icon: ClipboardList },
    { href: "/patient/team", label: copy(l, "Contact my care team", "Կապվել խնամքի թիմի հետ", "Связаться с моей командой"), Icon: MessageCircle },
    { href: "/patient/account", label: copy(l, "My details and preferences", "Իմ տվյալներն ու նախընտրությունները", "Мои данные и настройки"), Icon: UserRound },
    { href: "/patient/help", label: copy(l, "Get help", "Օգնություն", "Получить помощь"), Icon: MessageCircle },
  ];
  return <div className="member-home" data-member-home={chat ? undefined : true} data-member-chat-today={chat || undefined}>
    <header className="member-home-greeting">
      {chat && <p className="member-home-label">Zoe</p>}
      <h1>{greeting}</h1>
      <p>{date}</p>
    </header>
    {notices}
    {next && <section className="member-home-card member-home-next" aria-labelledby="member-home-next-title">
      <p className="member-home-label">{copy(l, "Your next step", "Ձեր հաջորդ քայլը", "Ваш следующий шаг")}</p>
      <h2 id="member-home-next-title">{next.title[l]}</h2>
      <p className="member-home-detail">{next.detail[l]}</p>
      {next.dueAt && <p>{stamp(next.dueAt, l)} · {copy(l, "Armenia time", "Հայաստանի ժամանակ", "Время Армении")}</p>}
      <HomeLink href={next.href === "/patient/dashboard#daily-routine" ? "/patient/medicines" : nextHref(next.href)} className="member-home-button">{next.button[l]}<ArrowRight aria-hidden /></HomeLink>
      {"secondary" in next && next.secondary && <a className="member-home-link" href={next.secondary.href} target="_blank" rel="noreferrer">{next.secondary.label[l]}</a>}
    </section>}
    {!chat && <><HomeLink href="/patient/zoe" className="member-home-chat">
      <span className="member-home-orb" aria-hidden />
      <span><strong>{copy(l, "Open Zoe", "Բացել Zoe-ն", "Открыть Zoe")}</strong><span className="member-home-muted">{copy(l, "AI assistant, not a doctor", "ԱԲ օգնական, ոչ բժիշկ", "ИИ-помощник, не врач")}</span></span>
      <ArrowRight aria-hidden />
    </HomeLink>
    <nav className="member-home-quick" aria-label={copy(l, "Quick actions", "Արագ գործողություններ", "Быстрые действия")}>
      <HomeLink href="/patient/medicines">{copy(l, "Log my dose", "Գրանցել դեղի ընդունումը", "Отметить приём")}</HomeLink>
      <HomeLink href="/patient/measurements/new">{copy(l, "Record a reading", "Գրանցել չափում", "Записать измерение")}</HomeLink>
      <HomeLink href="#member-home-menu">{copy(l, "More…", "Ավելին…", "Ещё…")}</HomeLink>
    </nav></>}
    {(rhythm.latest || latestLdl || rhythm.medicineTotal > 0) && <section aria-labelledby="member-home-snapshot-title">
      <h2 id="member-home-snapshot-title" className="member-home-section-title">{copy(l, "At a glance", "Մի հայացքով", "Кратко")}</h2>
      <p className="text-caption text-muted-foreground">{bpObservationCounts(measurements.filter(m => Date.parse(m.measuredAt) <= now.getTime()),l)}</p>
      <div className="member-home-facts">
        {rhythm.latest && <HomeLink href={chat ? "/patient/zoe?card=progress" : "/patient/health"} className="member-home-fact">
          <span className="member-home-label"><HeartPulse aria-hidden />{copy(l, "Latest blood pressure", "Վերջին ճնշումը", "Последнее давление")}</span>
          <strong>{rhythm.latest.systolic}/{rhythm.latest.diastolic}<small>mmHg</small></strong>
          <time dateTime={rhythm.latest.measuredAt}>{stamp(rhythm.latest.measuredAt, l)}</time>
        </HomeLink>}
        {latestLdl && <HomeLink href={chat ? "/patient/zoe?card=progress" : "/patient/progress"} className="member-home-fact member-home-ldl">
          <span className="member-home-label"><FlaskConical aria-hidden />{copy(l, "LDL cholesterol", "LDL խոլեստերին", "Холестерин ЛПНП")}</span>
          <strong>{latestLdl.mmol}<small>mmol/L</small></strong>
          <span>{copy(l, "Reviewed result", "Դիտարկված արդյունք", "Проверенный результат")} · <time dateTime={latestLdl.on}>{stamp(`${latestLdl.on}T12:00:00+04:00`, l, false)}</time></span>
        </HomeLink>}
        {rhythm.medicineTotal > 0 && <HomeLink href="/patient/medicines" className="member-home-fact member-home-medicine">
          <span className="member-home-label"><Pill aria-hidden />{copy(l, "Plan medicines today", "Պլանի այսօրվա դեղերը", "Лекарства по плану сегодня")}</span>
          <strong data-home-medicines>{rhythm.medicineTaken}/{rhythm.medicineTotal}</strong>
          <span>{copy(l, "Doses recorded as taken", "Որպես ընդունված գրանցված դեղաչափեր", "Дозы, отмеченные как принятые")}</span>
          <time dateTime={armeniaDate(now)}>{stamp(now.toISOString(), l, false)}</time>
        </HomeLink>}
      </div>
    </section>}
    {nextDate && <section className="member-home-card" aria-labelledby="member-home-date-title">
      <p className="member-home-label"><CalendarDays aria-hidden />{copy(l, "Coming up", "Առաջիկայում", "Предстоит")}</p>
      <h2 id="member-home-date-title">{nextDate.title[l]}</h2>
      <p>{nextDateWhen(nextDate, l, now)} · {copy(l, "Armenia time", "Հայաստանի ժամանակ", "Время Армении")}</p>
      <HomeLink href={nextDate.href}>{copy(l, "See the details", "Տեսնել մանրամասները", "Посмотреть подробности")}<ArrowRight aria-hidden /></HomeLink>
    </section>}
    {chat && details}
    {!chat && details && <details className="member-home-card member-home-details" data-member-home-details>
      <summary>{copy(l, "Your care details", "Ձեր խնամքի մանրամասները", "Подробности вашего лечения")}</summary>
      <div className="member-home-details-body">{details}</div>
    </details>}
    {doctor && <HomeLink href="/patient/team" className="member-home-team">
      <MessageCircle aria-hidden />
      <span><span className="member-home-muted">{copy(l, "Your care team", "Ձեր խնամքի թիմը", "Ваша медицинская команда")}</span><strong data-home-doctor>{doctor}</strong></span>
      <ArrowRight aria-hidden />
    </HomeLink>}
    <HomeUnwellCard locale={l} />
    {!chat && <><details id="member-home-menu" className="member-home-card member-home-menu" aria-labelledby="member-home-menu-title">
      <summary id="member-home-menu-title"><List aria-hidden />{copy(l, "Everything is here", "Ամեն ինչ այստեղ է", "Всё здесь")}</summary>
      <nav className="member-home-menu-grid" aria-label={copy(l, "All your pages", "Ձեր բոլոր էջերը", "Все ваши страницы")}>
        {menu.map(({ href, label, Icon }) => <HomeLink key={href} href={href}><Icon aria-hidden /><span>{label}</span></HomeLink>)}
      </nav>
      <details className="member-home-journey">
        <summary>{copy(l, "Where am I?", "Որտե՞ղ եմ հիմա", "На каком я этапе?")}</summary>
        <HomeJourneyStrip current={journeyCurrent} locale={l} />
      </details>
    </details>
    <HomeLink href="/patient/dashboard?view=classic">{copy(l, "Open the previous Home", "Բացել նախորդ գլխավոր էջը", "Открыть прежнюю главную")}</HomeLink></>}
  </div>;
}
