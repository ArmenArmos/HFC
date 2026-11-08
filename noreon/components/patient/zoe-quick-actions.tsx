import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";
import { CalendarDays, FileUp, HeartPulse } from "lucide-react";
import { tx, type PatientLocale } from "@/lib/patient/copy";

export const zoeChip =
  "inline-flex min-h-12 shrink-0 items-center gap-2 rounded-full border border-border bg-background px-4 text-body2 font-semibold text-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/**
 * Small quick-action chips on the Zoe screen: book a visit, upload results, record blood pressure, and any extra chip.
 * With Zoe's action cards on (cards), the visit and BP chips open cards in the thread instead (the caller's chips);
 * each card links to its page, which stays as it is.
 */
export function ZoeQuickActions({ locale: l, upload, children, cards = false }: { locale: PatientLocale; upload: boolean; children?: ReactNode; cards?: boolean }) {
  return (
    <nav aria-label={tx(l, "Արագ գործողություններ", "Quick actions", "Быстрые действия")} className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0" data-zoe-quick-actions>
      <div className="flex gap-2 pb-1 sm:flex-wrap">
        {!cards && <Link href={"/patient/service" as Route} className={zoeChip}>
          <CalendarDays className="size-4 shrink-0" aria-hidden />
          {tx(l, "Ամրագրել այց", "Book a visit", "Записаться на визит")}
        </Link>}
        {!cards && <Link href={"/patient/measurements/new" as Route} className={zoeChip}>
          <HeartPulse className="size-4 shrink-0" aria-hidden />
          {tx(l, "Գրանցել ճնշումը", "Record blood pressure", "Записать давление")}
        </Link>}
        {upload && !cards && (
          <Link href={"/patient/reports" as Route} className={zoeChip}>
            <FileUp className="size-4 shrink-0" aria-hidden />
            {tx(l, "Վերբեռնել արդյունքները", "Upload results", "Загрузить результаты")}
          </Link>
        )}
        {children}
      </div>
    </nav>
  );
}
