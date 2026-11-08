"use client";
import { pick, type Locale } from "@/lib/locale";
import { SidebarNav } from "@/components/app-shell/sidebar-nav";
import { usePathname } from "next/navigation";
import { UserX,
  LayoutDashboard,
  UsersRound,
  Stethoscope,
  Building2,
  Bell,
  ClipboardList,
  MessageSquare,
  Activity,
  MessagesSquare,
  TriangleAlert,
  CalendarClock,
  HeartPulse,
  ListChecks,
  ListTree,
  Tags,
  Wallet,
  ChartColumn,
  Siren,
  PhoneCall,
  SlidersHorizontal,
  type LucideIcon,
  ScrollText, FlaskConical, FileWarning,
  UserPlus,
  Inbox,
  Sparkles,
} from "lucide-react";
type NavLink = readonly [string, string, LucideIcon];
const LABELS = {
  "Alerts": { en: "Alerts", hy: "Ահազանգեր", ru: "Уведомления" },
  "Care queue": { en: "Care queue", hy: "Խնամքի հերթ", ru: "Очередь задач" },
  "Requests": { en: "Requests", hy: "Հարցումներ", ru: "Заявки" },
  "Nurse visits": { en: "Nurse visits", hy: "Բուժքրոջ այցեր", ru: "Визиты медсестры" },
  "Registrations": { en: "Registrations", hy: "Գրանցումներ", ru: "Регистрации" },
  "Callbacks": { en: "Callbacks", hy: "Հետադարձ զանգեր", ru: "Обратные звонки" },
  "Consultations": { en: "Consultations", hy: "Խորհրդատվություններ", ru: "Консультации" },
  "Tasks": { en: "Tasks", hy: "Առաջադրանքներ", ru: "Задачи" },
  "Doctors & nurses": { en: "Doctors & nurses", hy: "Բժիշկներ և բուժքույրեր", ru: "Врачи и медсёстры" },
  "Clinics": { en: "Clinics", hy: "Կլինիկաներ", ru: "Клиники" },
  "Visit slots": { en: "Visit slots", hy: "Այցերի ժամեր", ru: "Время для визитов" },
  "Conversations": { en: "Conversations", hy: "Զրույցներ", ru: "Переписка" },
  "Messages": { en: "Messages", hy: "Հաղորդագրություններ", ru: "Сообщения" },
  "Operations chat": { en: "Operations chat", hy: "Գործերի զրույց", ru: "Операционный чат" },
  "Operations": { en: "Operations", hy: "Գործերի կառավարում", ru: "Операции" },
  "Pilot cohort": { en: "Pilot cohort", hy: "Փորձնական խումբ", ru: "Пилотная группа" },
  "Test catalogue": { en: "Test catalogue", hy: "Հետազոտությունների կատալոգ", ru: "Каталог анализов" },
  "Payments": { en: "Payments", hy: "Վճարումներ", ru: "Платежи" },
  "BP monitors": { en: "BP monitors", hy: "Ճնշման սարքեր", ru: "Тонометры" },
  "Delivery problems": { en: "Delivery problems", hy: "Առաքման խնդիրներ", ru: "Проблемы с доставкой" },
  "Unassigned": { en: "Unassigned", hy: "Առանց կցված բժշկի", ru: "Без назначения" },
  "Trace": { en: "Trace", hy: "Որոշումների պատմություն", ru: "Трассировка" },
  "Upload checks": { en: "Upload checks", hy: "Վերբեռնումների ստուգումներ", ru: "Проверки загрузок" },
  "Activity log": { en: "Activity log", hy: "Գործողությունների մատյան", ru: "Журнал действий" },
  "Test accounts": { en: "Test accounts", hy: "Փորձնական հաշիվներ", ru: "Тестовые аккаунты" },
  "Today": { en: "Today", hy: "Այսօր", ru: "Сегодня" },
  "Ask Zoe": { en: "Ask Zoe", hy: "Հարցնել Զոյային", ru: "Спросить Зою" },
  "Visits": { en: "Visits", hy: "Այցեր", ru: "Визиты" },
  "My members": { en: "My members", hy: "Իմ անդամները", ru: "Мои участники" },
  "Replies": { en: "Replies", hy: "Պատասխաններ", ru: "Ответы" },
  "Overview": { en: "Overview", hy: "Ընդհանուր պատկեր", ru: "Обзор" },
  "Cases": { en: "Cases", hy: "Գործեր", ru: "Случаи" },
  "Care team": { en: "Care team", hy: "Խնամքի թիմ", ru: "Медицинская команда" },
  "Notifications": { en: "Notifications", hy: "Ծանուցումներ", ru: "Уведомления" },
  "My cases": { en: "My cases", hy: "Իմ գործերը", ru: "Мои случаи" },
  "AI settings": { en: "AI settings", hy: "AI կարգավորումներ", ru: "Настройки ИИ" },
} satisfies Record<string, Record<Locale, string>>;
export function StaffNavigation({ admin, nurse = false, real = false, telegram = false, bpDevices = false, trace = false, alerts = false, catalog = false, payments = false, cohort = false, consultations = false, visitSlots = true, aiSettings = false, messageOperations = false, adminConversations = false, nurseVisits = false, nurseChat = false, adminChat = false, staffZoe = false, careQueue = false, coordinator = false, locale = "en" }: { admin: boolean; nurse?: boolean; real?: boolean; telegram?: boolean; bpDevices?: boolean; trace?: boolean; alerts?: boolean; catalog?: boolean; payments?: boolean; cohort?: boolean; consultations?: boolean; visitSlots?: boolean; aiSettings?: boolean; messageOperations?: boolean; adminConversations?: boolean; nurseVisits?: boolean; nurseChat?: boolean; adminChat?: boolean; staffZoe?: boolean; careQueue?: boolean; /** A care coordinator: logistics links only, never the clinical member list. */ coordinator?: boolean; locale?: Locale }) {
  const path = usePathname();
  const hy = locale === "hy" && real && !admin;
  const baseLinks: readonly NavLink[] = real
    ? (admin
      ? ([adminChat && ["Operations chat", "/staff/real/admin-chat", Sparkles], alerts && ["Alerts", "/staff/real/alerts", Siren], careQueue && ["Care queue", "/staff/real/care-queue", ListChecks], ["Requests", "/staff/real/members", ClipboardList], nurseVisits && ["Nurse visits", "/staff/real/visits", CalendarClock], ["Registrations", "/staff/real/registrations", UserPlus], ["Callbacks", "/staff/real/callbacks", PhoneCall], consultations && ["Consultations", "/staff/real/consultations", PhoneCall], ["Tasks", "/staff/real/tasks", LayoutDashboard], ["Doctors & nurses", "/staff/real/doctors", Stethoscope], ["Clinics", "/staff/real/clinics", Building2], visitSlots && ["Visit slots", "/staff/real/booking-slots", CalendarClock], adminConversations && ["Conversations", "/staff/real/conversations", MessagesSquare], messageOperations && ["Messages", "/staff/real/messages", MessageSquare], ["Operations", "/staff/real/operations", Activity], cohort && ["Pilot cohort", "/staff/real/cohort", ChartColumn], catalog && ["Test catalogue", "/staff/real/catalog", Tags], payments && ["Payments", "/staff/real/payments", Wallet], bpDevices && ["BP monitors", "/staff/real/devices", HeartPulse], telegram && ["Delivery problems", "/staff/real/delivery-problems", TriangleAlert], telegram && ["Unassigned", "/staff/real/unassigned", UserX], trace && ["Trace", "/staff/real/trace", ListTree], ["Upload checks", "/staff/real/upload-checks", FileWarning], ["Activity log", "/staff/real/activity", ScrollText], ["Test accounts", "/staff/real/test-accounts", FlaskConical], ["Test sign-in", "/staff/real/test-signin", FlaskConical]] as (NavLink | false)[]).filter((link): link is NavLink => link !== false)
      : coordinator
      ? ([careQueue && ["Care queue", "/staff/real/care-queue", ListChecks], ["Tasks", "/staff/real/tasks", LayoutDashboard], consultations && ["Consultations", "/staff/real/consultations", PhoneCall]] as (NavLink | false)[]).filter((link): link is NavLink => link !== false)
      : [...(!nurse ? [["Today", "/staff/real/today", Inbox]] as const : []), ...(nurse && nurseVisits ? [["Visits", "/staff/real/visits", CalendarClock]] as const : []), ...(alerts ? [["Alerts", "/staff/real/alerts", Siren]] as const : []), ...(careQueue ? [["Care queue", "/staff/real/care-queue", ListChecks]] as const : []), ["My members", "/staff/real/members", UsersRound], ...(staffZoe ? [["Ask Zoe", "/staff/real/zoe", Sparkles]] as const : []), ...(nurse && nurseChat ? [["Conversations", "/staff/real/nurse-chat#today", MessagesSquare]] as const : []), ...(telegram && !nurse ? [["Replies", "/staff/real/conversations", MessagesSquare]] as const : []), ["Tasks", "/staff/real/tasks", ClipboardList]] as const)
    : admin
    ? ([
        ["Overview", "/staff/backoffice", LayoutDashboard],
        ["Cases", "/staff/backoffice/cases", ClipboardList],
        ["Care team", "/staff/backoffice/doctors", Stethoscope],
        ["Clinics", "/staff/backoffice/clinics", Building2],
        ["Notifications", "/staff/notifications", Bell],
      ] as const)
    : ([
        ["My cases", nurse ? "/staff/nurse" : "/staff/doctor", UsersRound],
        ["Notifications", "/staff/notifications", Bell],
      ] as const);
  const links: readonly NavLink[] = real && admin && aiSettings ? [...baseLinks, ["AI settings", "/staff/real/ai-settings", SlidersHorizontal]] : baseLinks;
  return (
    <SidebarNav
      label={pick(locale, { en: admin ? "Backoffice navigation" : nurse ? "Nurse navigation" : "Doctor navigation", hy: admin ? "Backoffice navigation" : real ? (nurse ? "Բուժքրոջ նավարկում" : "Բժշկի նավարկում") : nurse ? "Nurse navigation" : "Doctor navigation", ru: admin ? "Навигация административной панели" : nurse ? "Навигация медсестры" : "Навигация врача" })}
      // Doctors and nurses too: one scrolling row clipped "Replies" and hid "Tasks" at 375 (night QA F-6).
      grid={real}
      columns={admin ? 2 : 3}
      hy={hy}
      links={links.map(([label, href, Icon]) => ({
        label: pick(locale, { ...LABELS[label as keyof typeof LABELS], hy: real && !admin ? LABELS[label as keyof typeof LABELS].hy : label }),
        href,
        Icon,
        active:
          path === href.split('#')[0] || (real && (href === "/staff/real/members" || href === "/staff/real/visits" || href === "/staff/real/conversations" || href === "/staff/real/trace") && path.startsWith(`${href}/`)) || (label === "Care team" && path === "/staff/backoffice/nurses") ||
          ((label === "Cases" || label === "My cases") &&
            path.startsWith("/staff/case/")),
      }))}
    />
  );
}
