"use client";
import Link, { useLinkStatus } from "next/link";
import type { Route } from "next";
import { LoaderCircle, type LucideIcon } from "lucide-react";

import { pick, type Locale } from "@/lib/locale";

export type SidebarLink = { label: string; href: string; Icon: LucideIcon; active: boolean };

function NavigationLabel({ label, Icon, locale }: { label: string; Icon: LucideIcon; locale: Locale }) {
  const { pending } = useLinkStatus();
  return <>
    {pending ? <LoaderCircle className="size-5 shrink-0 motion-safe:animate-spin" aria-hidden /> : <Icon className="size-5 shrink-0" aria-hidden />}
    {label}
    {pending && <span role="status" className="sr-only">{pick(locale, {hy: `Բացվում է՝ ${label}`, en: `Opening ${label}`, ru: `Открывается: ${label}`})}</span>}
  </>;
}

/** The sidebar link list shared by the staff backoffice and the clinic portal. `grid` is the
 * phone layout with icon over label in `columns` columns (every link visible at 375 px); otherwise
 * links scroll in one row on phones. From lg up both become a vertical list with icon beside label. */
export function SidebarNav({ links, label, grid = false, columns = 2, hy = false, locale = hy ? "hy" : "en" }: { links: readonly SidebarLink[]; label: string; grid?: boolean; columns?: 2 | 3; hy?: boolean; locale?: Locale }) {
  return (
    <nav aria-label={label} className={grid ? `grid ${columns === 3 ? "grid-cols-3" : "grid-cols-2"} gap-1 p-3 lg:flex lg:flex-col lg:p-5` : "flex gap-1 overflow-x-auto p-3 lg:flex-col lg:p-5"}>
      {links.map(({ label: text, href, Icon, active }) => {
        // Native fragment navigation emits hashchange even when the chat is already open.
        const NavigationLink = href.includes('#') ? 'a' : Link;
        return <NavigationLink
          key={href}
          href={href as Route}
          aria-current={active ? "page" : undefined}
          className={`flex min-h-12 items-center rounded-lg text-body2 font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring ${grid ? "min-w-0 flex-col justify-center gap-1 px-2 py-2 text-center lg:flex-row lg:justify-start lg:gap-3 lg:px-4 lg:text-left" : "shrink-0 gap-3 px-4"} ${active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
        >
          <NavigationLabel label={text} Icon={Icon} locale={locale} />
        </NavigationLink>;
      })}
    </nav>
  );
}
