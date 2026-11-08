import Link from "next/link";
import type { Route } from "next";
import { LogOut } from "lucide-react";
import { ShellMenu } from "./shell-menu";

/** One app shell for every backoffice.noreon.health workspace (staff and clinic), so they read as one
 * product: brand and workspace in a left sidebar from lg up (on phones one row, with the links behind a Menu button), a slim header
 * with the workspace title, actions and Sign out, and one content width. Callers own the navigation. */
export function AppShell({ lang, contentId, skipLabel, menuLabel, brandHref, badge, sidebarHeader, nav, title, actions, children }: {
  lang: string;
  contentId: string;
  skipLabel: string;
  menuLabel: string;
  brandHref: string;
  /** Short workspace tag shown beside the brand on phones, where the sidebar header is hidden. */
  badge: string;
  sidebarHeader: React.ReactNode;
  nav: React.ReactNode;
  title: React.ReactNode;
  actions: React.ReactNode;
  children: React.ReactNode;
}) {
  return <div lang={lang} className="min-h-screen bg-muted/30 lg:grid lg:grid-cols-[220px_minmax(0,1fr)]">
    <a href={`#${contentId}`} className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:bg-background focus:p-4">{skipLabel}</a>
    <aside className="border-b bg-background lg:sticky lg:top-0 lg:h-screen lg:overflow-y-auto lg:border-b-0 lg:border-r">
      <ShellMenu
        label={menuLabel}
        brand={<>
          <Link href={brandHref as Route} className="text-h2 font-semibold tracking-tight">Noreon</Link>
          <span className="rounded-md bg-surface-subtle-teal px-2 py-1 text-caption text-brand-teal lg:hidden">{badge}</span>
        </>}
        sidebarHeader={<div className="hidden px-6 text-caption text-muted-foreground lg:block">{sidebarHeader}</div>}
      >{nav}</ShellMenu>
    </aside>
    <div className="min-w-0">
      <header className="flex flex-wrap items-center justify-between gap-x-3 border-b bg-background px-5 py-1 lg:gap-y-3 lg:px-9 lg:py-3">
        <div className="min-w-0 break-words text-body2 font-medium">{title}</div>
        <div className="flex flex-wrap items-center gap-3">{actions}</div>
      </header>
      <main id={contentId} className="mx-auto max-w-7xl space-y-6 px-5 py-7 lg:px-9 lg:py-9">{children}</main>
    </div>
  </div>;
}

export function ShellSignOut({ action, label }: { action: () => Promise<void>; label: string }) {
  return <form action={action}>
    <button className="inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-body2 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"><LogOut className="size-4" aria-hidden />{label}</button>
  </form>;
}
