import { StaffNavigation } from "./navigation";
import { Inbox } from "@/components/notifications/inbox";
import Link from "next/link";
import type { StaffIdentity } from "@/lib/staff/types";
import { signOut } from "@/lib/staff/actions";

export function StaffShell({
  identity,
  children,
}: {
  identity: StaffIdentity;
  children: React.ReactNode;
}) {
  const admin = identity.role === "admin";
  const nurse = identity.role === "nurse";
  return (
    <div className="min-h-screen bg-muted/30 lg:grid lg:grid-cols-[220px_minmax(0,1fr)]">
      <a
        href="#staff-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:bg-background focus:p-4"
      >
        Skip to content
      </a>
      <aside className="border-b bg-background lg:sticky lg:top-0 lg:h-screen lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between px-6 pb-2 pt-6 lg:pb-6 lg:pt-8">
          <Link
            href={admin ? "/staff/backoffice" : nurse ? "/staff/nurse" : "/staff/doctor"}
            className="text-h2 font-semibold tracking-tight"
          >
            Noreon
          </Link>
          <span className="rounded-md bg-surface-subtle-teal px-2 py-1 text-caption text-brand-teal lg:hidden">
            {admin ? "Operations" : "Clinical"}
          </span>
        </div>
        <p className="hidden px-6 text-caption text-muted-foreground lg:block">
          {admin ? "Backoffice" : nurse ? "Nurse workspace" : "Doctor workspace"}
        </p>
        <StaffNavigation admin={admin} nurse={nurse} />
        <p className="absolute bottom-6 hidden px-6 text-caption text-muted-foreground lg:block">
          Demo environment
        </p>
      </aside>
      <div className="min-w-0">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-background px-5 py-3 lg:px-9">
          <p className="text-body2 font-medium">
            {admin ? "Noreon operations" : "Clinical workspace"}
            <span className="ml-3 rounded-md bg-muted px-2 py-1 text-caption text-muted-foreground">
              Demo
            </span>
          </p>
          <div className="flex items-center gap-3">
            <Inbox staff compact />
            <span className="hidden text-caption text-muted-foreground sm:inline">
              {identity.name}
            </span>
            <form action={signOut}>
              <button className="min-h-11 rounded-md px-3 text-body2 hover:bg-muted">
                Sign out
              </button>
            </form>
          </div>
        </header>
        <main
          id="staff-content"
          className="mx-auto max-w-7xl px-5 py-7 lg:px-9 lg:py-9"
        >
          {children}
        </main>
      </div>
    </div>
  );
}

export function SectionCard({
  title,
  detail,
  children,
}: {
  title: string;
  detail?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border bg-background p-6 shadow-sm">
      <div className="mb-5">
        <h2 className="text-h3 font-semibold">{title}</h2>
        {detail && (
          <p className="mt-1 text-body2 text-muted-foreground">{detail}</p>
        )}
      </div>
      {children}
    </section>
  );
}

export const fieldClass =
  "w-full min-h-11 rounded-md border bg-background px-3 py-2 text-body2 outline-none focus-visible:ring-2 focus-visible:ring-ring";
export const buttonClass =
  "inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 py-2 text-body2 font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-ring";
