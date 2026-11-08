import Link from "next/link";
import type { ReactNode } from "react";
import type { Route } from "next";
import type { PatientLocale } from "@/lib/patient/copy";
import { formatMemberDate } from "@/lib/patient/date-format";
import { ArrowRight, ChevronRight, type LucideIcon } from "lucide-react";
export const copy = (l: PatientLocale, en: string, hy: string, ru: string) =>
  l === "hy" ? hy : l === "ru" ? ru : en;
export function stamp(value: string, l: PatientLocale, withTime = true) {
  return formatMemberDate(value, l, {
    timeZone: "Asia/Yerevan",
    dateStyle: "medium",
    ...(withTime ? { timeStyle: "short" as const, hourCycle: "h23" as const } : {}),
  });
}
export function CareSection({
  title,
  detail,
  children,
  id,
}: {
  title: string;
  detail?: string;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className="journey-card scroll-mt-6 space-y-5 rounded-2xl border border-border/70 bg-card p-5 shadow-sm sm:p-6">
      <header>
        <h2 className="text-h2">{title}</h2>
        {detail && (
          <p className="mt-2 max-w-2xl text-body2 text-muted-foreground">
            {detail}
          </p>
        )}
      </header>
      {children}
    </section>
  );
}
export function CareLink({
  href,
  children,
  icon: Icon = ArrowRight,
  variant = "secondary",
}: {
  href: string;
  children: ReactNode;
  icon?: LucideIcon;
  /** For tel:103 only. `emergency`: the big filled red of `.emergency-call`, urgent
   *  screens only. `emergency-pill`: the small outlined pill for everyday screens. */
  variant?: "primary" | "secondary" | "emergency" | "emergency-pill";
}) {
  if (variant === "emergency-pill")
    return (
      <Link href={href as Route} className="emergency-pill">
        <Icon className="size-4 shrink-0" aria-hidden />
        <span>{children}</span>
      </Link>
    );
  return (
    <Link
      href={href as Route}
      className={`journey-button inline-flex min-h-11 max-w-full items-center justify-center gap-2 rounded-lg border px-4 py-2 text-body2 font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${variant === "emergency" ? "emergency-call min-h-12" : variant === "primary" ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90" : "border-border bg-background text-foreground hover:bg-muted"}`}
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      <span className="min-w-0 break-words">{children}</span>
    </Link>
  );
}
export function Status({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "due" | "complete" | "attention" }) {
  return (
    <span className={`inline-flex max-w-full rounded-md px-2.5 py-1 text-caption font-semibold ${tone === "due" ? "bg-primary text-primary-foreground" : tone === "complete" ? "bg-surface-subtle-teal text-foreground" : tone === "attention" ? "bg-[var(--status-warning-bg)] text-foreground" : "bg-muted text-muted-foreground"}`}>
      {children}
    </span>
  );
}

export function IconTile({ icon: Icon }: { icon: LucideIcon }) {
  return <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface-subtle-teal text-brand-navy"><Icon className="size-5" aria-hidden /></span>;
}

export function RowLink({ href, children, detail, icon: Icon, narrowIconAbove = false }: { href: string; children: ReactNode; detail?: ReactNode; icon: LucideIcon; narrowIconAbove?: boolean }) {
  return <Link href={href as Route} className={`flex min-h-16 items-center gap-3 rounded-lg px-3 py-3 text-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${narrowIconAbove ? "max-[360px]:grid max-[360px]:grid-cols-[minmax(0,1fr)_1rem] max-[360px]:[&>span:first-child]:col-span-2" : ""}`}>
    <IconTile icon={Icon} />
    <span className="min-w-0 flex-1"><span className="block break-words text-body2 font-semibold">{children}</span>{detail && <span className="mt-1 block break-words text-caption text-muted-foreground">{detail}</span>}</span>
    <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
  </Link>;
}
