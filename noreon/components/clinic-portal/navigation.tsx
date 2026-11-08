"use client";
import { usePathname } from "next/navigation";
import { MessageCircle, CalendarCheck, Clock, FlaskConical, IdCard, Languages, UserCog, UsersRound, type LucideIcon } from "lucide-react";
import { pick, type Locale } from "@/lib/locale";
import { SidebarNav } from "@/components/app-shell/sidebar-nav";
import { setClinicLocale } from "@/lib/clinic-portal/locale-actions";

export type ClinicSection = "audit" | "approvals" | "chat" | "bookings" | "records" | "members" | "batches" | "hours" | "team";
const sections: Record<ClinicSection, readonly [string, string, string, LucideIcon]> = {
  audit: ["Audit log", "Գործողությունների մատյան", "Журнал действий", IdCard],
  approvals: ["Approvals", "Հաստատումներ", "Согласования", IdCard],
  chat: ["Clinic assistant", "Կլինիկայի օգնական", "Помощник клиники", MessageCircle],
  bookings: ["Bookings", "Այցեր", "Записи", CalendarCheck],
  records: ["Member records", "Անդամների քարտեր", "Карты участников", IdCard],
  members: ["Members", "Անդամներ", "Участники", UsersRound],
  batches: ["Laboratory batches", "Լաբորատոր փաթեթներ", "Пакеты лабораторных анализов", FlaskConical],
  hours: ["Hours and capacity", "Ժամեր և տարողություն", "Часы и вместимость", Clock],
  team: ["Team", "Թիմ", "Команда", UserCog],
};

/** The server decides which sections this clinic user may see; this only draws them. */
export function ClinicNavigation({ items, clinicId, locale, current, pendingCount }: { items: readonly ClinicSection[]; clinicId: string; locale: Locale; current?: ClinicSection; pendingCount?:number }) {
  return <SidebarNav
    label={pick(locale, { en: "Clinic sections", hy: "Կլինիկայի բաժիններ", ru: "Разделы клиники" })}
    grid
    hy={locale === "hy"}
    links={items.map(key => {
      const [en, hyText, ru, Icon] = sections[key];
      return { label: pick(locale, { en, hy: hyText, ru })+(key==='approvals'&&pendingCount!==undefined?` (${pendingCount})`:''), href: `/clinic/real/${key}?clinic=${clinicId}&locale=${locale}`, Icon, active: current === key };
    })}
  />;
}

/** Native forms remember the choice before hydration, then return to the explicit ?locale URL. */
export function ClinicLocaleSwitch({ clinicId, locale }: { clinicId: string; locale: Locale }) {
  const path = usePathname();
  const option = (value: Locale, label: string) => <form action={setClinicLocale}>
    <input type="hidden" name="returnTo" value={`${path}?clinic=${encodeURIComponent(clinicId)}&locale=${value}`} />
    <button type="submit" name="locale" value={value}
    lang={value}
    aria-current={locale === value ? "true" : undefined}
    className={`inline-flex min-h-11 items-center rounded-md px-3 text-body2 focus-visible:outline-2 focus-visible:outline-ring ${locale === value ? "bg-muted font-semibold" : "hover:bg-muted"}`}
  >{label}</button></form>;
  return <div role="group" className="flex items-center gap-1" aria-label={pick(locale, { en: "Language", hy: "Լեզու", ru: "Язык" })}>
    <Languages className="size-4 text-muted-foreground" aria-hidden />
    {option("en", "English")}{option("hy", "Հայերեն")}{option("ru", "Русский")}
  </div>;
}
