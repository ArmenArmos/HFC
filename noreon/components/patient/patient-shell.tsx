"use client";
import { PatientDocumentLanguage } from "./document-language";
import Link from "next/link";
import Image from "next/image";
import { useMemberChatMode } from "./member-chat-mode";
import { MemberChatMenu } from "./member-chat-menu";
import { useSearchParams } from "next/navigation";
import { usePathname } from "next/navigation";
import {
  HomeIcon,
  PhoneIcon,
  UserRoundIcon,
  ActivityIcon,
  ClipboardListIcon,
  SparklesIcon,
  LifeBuoyIcon,
} from "lucide-react";
import { patientDestination } from "@/lib/patient/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import { tx, type PatientLocale } from "@/lib/patient/copy";
import { MainNavigationContent } from "@/components/patient/navigation-pending";
import { sweepSignupDrafts } from "@/lib/patient/signup-draft";
import { zoeName } from "@/lib/brand";
type ShellProps = {
  children: ReactNode; locale?: PatientLocale; navigation?: boolean; emergency?: boolean; memberName?: string;
};

export function PatientShell(props: ShellProps) {
  return useMemberChatMode() ? <ChatAwareShell {...props} /> : <PatientShellView {...props} />;
}
function ChatAwareShell(props: ShellProps) {
  const params = useSearchParams();
  return <PatientShellView {...props} chatOnly={params.get("view") !== "classic"} />;
}
function PatientShellView({
  children,
  locale = "hy",
  navigation = true,
  emergency = navigation,
  memberName, chatOnly = false,
}: ShellProps & { chatOnly?: boolean }) {
  chatOnly = chatOnly && navigation;
  const tabs = navigation && !chatOnly;
  const path = usePathname();
  // Any member screen on this browser removes expired sign-up drafts, anyone's (privacy audit B3-8).
  useEffect(() => sweepSignupDrafts(), []);
  // Sticky bars sit right under the header. Its height changes when it wraps (Armenian up to 359px,
  // English at 320px), so measure it instead of guessing; globals.css keeps the guessed fallback.
  const shell = useRef<HTMLDivElement>(null);
  const header = useRef<HTMLElement>(null);
  const tabbar = useRef<HTMLElement>(null);
  useEffect(() => {
    const root = shell.current, bar = header.current;
    if (!root || !bar || typeof ResizeObserver === "undefined") return;
    const sync = () => {
      root.style.setProperty("--journey-sticky-top", `${bar.getBoundingClientRect().height}px`);
      if (tabbar.current) root.style.setProperty("--member-tabbar-height", `${tabbar.current.getBoundingClientRect().height}px`);
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(bar);
    if (tabbar.current) observer.observe(tabbar.current);
    return () => observer.disconnect();
  }, [tabs]);
  const links = [
    [
      "/patient/dashboard",
      tx(locale, "Գլխավոր", "Home", "Главная"),
      HomeIcon,
      "home",
    ],
    [
      "/patient/progress",
      tx(locale, "Առաջընթաց", "Progress", "Прогресс"),
      ActivityIcon,
      "progress",
    ],
    // Founder feedback 17 Oct: Zoe sits in the middle of the menu.
    ["/patient/zoe", zoeName(locale), SparklesIcon, "zoe"],
    [
      "/patient/care",
      tx(locale, "Բուժման պլան", "Care plan", "План лечения"),
      ClipboardListIcon,
      "plan",
    ],
    ["/patient/account", tx(locale, "Իմ էջը", "Me", "Мой профиль"), UserRoundIcon, "me"],
  ] as const;
  const routeDestination = patientDestination(path);
  // Help is marked on its header button (QA 104), so no tab is current there.
  const helpOpen = /^\/patient\/help(\/|$)/.test(path);
  const destination = helpOpen ? null : routeDestination === "team" ? "me" : routeDestination;
  const navigationLinks = links.map(([href, label, Icon, id]) => (
    <Link
      key={href}
      href={href}
      aria-current={destination === id ? "page" : undefined}
      className={`journey-nav-link ${destination === id ? "is-active" : ""} ${id === "zoe" ? "journey-nav-zoe" : ""}`}
    >
      <MainNavigationContent label={label} locale={locale} Icon={Icon} zoe={id === "zoe"} />
    </Link>
  ));
  return (
    <div ref={shell} lang={locale} className="member-journey min-h-dvh text-foreground" data-member-chat-only={chatOnly || undefined}>
      <PatientDocumentLanguage locale={locale} />
      <a
        href="#member-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-card focus:p-3"
      >
        {tx(locale, "Անցնել բովանդակությանը", "Skip to content", "Перейти к содержимому")}
      </a>
      <header ref={header} className="journey-header border-b bg-card">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-2 sm:px-5">
          <Link
            href={chatOnly ? "/patient/zoe" : navigation ? "/patient/dashboard" : "/patient"}
            className="inline-flex min-h-11 items-center"
            aria-label="Noreon"
          >
            {chatOnly ? <span className="member-chat-brand"><span className="member-home-orb" aria-hidden />Noreon</span> : <Image
              src="/brand/logo/noreon-wordmark-navy.svg"
              alt="Noreon"
              width={120}
              height={22}
              className="h-auto w-24 shrink-0 sm:w-28"
              priority
            />}
          </Link>
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
          {/* Khikar, 18 Oct: one tap to 103 on every everyday screen, small and outlined.
              Get help stays, quieter, so the two never read as two alarms. */}
          {emergency && (
            <a href="tel:103" className="emergency-pill">
              <PhoneIcon className="size-4" aria-hidden />
              {chatOnly ? "103" : tx(locale, "Շտապ օգնություն 103", "Emergency 103", "Скорая помощь 103")}
            </a>
          )}
          {chatOnly ? <MemberChatMenu locale={locale} name={memberName} /> : <Link
            href={navigation ? "/patient/help" : `/patient/help?locale=${locale}`}
            aria-current={helpOpen ? "page" : undefined}
            className={`journey-help ${emergency ? "journey-help-neutral" : ""} ${helpOpen ? "is-active" : ""}`}
            aria-label={emergency ? tx(locale, "Օգնություն", "Get help", "Помощь") : undefined}
          >
            {emergency ? <LifeBuoyIcon className="size-4" aria-hidden /> : <PhoneIcon className="size-4" aria-hidden />}
            <span className={emergency ? "max-sm:sr-only" : undefined}>{tx(locale, "Օգնություն", "Get help", "Помощь")}</span>
          </Link>}
          </div>
        </div>
      </header>
      <div
        data-tabbar={tabs ? "" : undefined}
        className={`mx-auto max-w-6xl ${tabs ? "lg:grid lg:grid-cols-[12rem_minmax(0,1fr)]" : ""}`}
      >
        {tabs && (
          <aside className="hidden border-r lg:block">
            <nav
              aria-label={tx(locale, "Հիմնական էջեր", "Main navigation", "Основная навигация")}
              className="sticky top-0 space-y-2 px-4 py-8"
            >
              {navigationLinks}
            </nav>
          </aside>
        )}
        <main
          id="member-content"
          tabIndex={-1}
          className="journey-main min-w-0 px-4 py-5 outline-none sm:px-6"
        >
          {children}
        </main>
      </div>
      {tabs && (
        <nav
          ref={tabbar}
          aria-label={tx(locale, "Հիմնական էջեր", "Main navigation", "Основная навигация")}
          className="journey-tabbar border-t bg-card lg:hidden"
        >
          <div className="journey-core-navigation mx-auto grid max-w-xl grid-cols-5 gap-1 px-2 py-1">
            {navigationLinks}
          </div>
        </nav>
      )}
    </div>
  );
}
