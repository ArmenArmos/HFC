import Link from "next/link";
import { LayoutGrid, HeartPulse, FlaskConical, ListChecks } from "lucide-react";
import type { PatientLocale } from "@/lib/patient/copy";
import { copy } from "./common";
import { ProgressNavigationLabel } from "@/components/patient/navigation-pending";
export function ProgressNavigation({
  locale: l,
  active,
}: {
  locale: PatientLocale;
  active: "overview" | "pressure" | "tests" | "habits";
}) {
  const items = [
    ["overview", "/patient/progress", "Overview", "Ամփոփում", "Обзор", LayoutGrid],
    ["pressure", "/patient/health", "Pressure", "Ճնշում", "Давление", HeartPulse],
    ["tests", "/patient/results", "Tests", "Թեստեր", "Анализы", FlaskConical],
    ["habits", "/patient/progress?section=habits", "Habits", "Սովորություններ", "Привычки", ListChecks],
  ] as const;
  return (
    <nav
      aria-label={copy(l, "Progress sections", "Առաջընթացի բաժիններ", "Разделы прогресса")}
      className="journey-progress-sections flex gap-1 overflow-x-auto rounded-2xl border bg-card p-1"
    >
      {items.map(([id, href, en, hy, ru, Icon]) => (
        <Link
          key={id}
          href={href}
          aria-current={active === id ? "page" : undefined}
          aria-label={copy(l, en, hy.replace(/\u00ad/g, ""), ru)}
          className={`flex min-h-12 shrink-0 grow basis-0 items-center justify-center gap-2 rounded-xl px-2 py-2 text-center text-caption font-semibold whitespace-nowrap min-[400px]:px-3 min-[400px]:text-body2 focus-visible:outline-2 focus-visible:outline-ring ${active === id ? "bg-brand-navy text-on-inverse" : "text-foreground hover:bg-muted"}`}
        >
          <Icon aria-hidden className="hidden size-4 shrink-0 sm:block" />
          <ProgressNavigationLabel label={copy(l, en, hy, ru)} locale={l} />
        </Link>
      ))}
    </nav>
  );
}
