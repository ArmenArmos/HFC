import { pick, type Locale } from "@/lib/locale";
import type { ServiceWorkflow } from "@/lib/service-workflow/types";
import { bookingResultsReceived } from "@/lib/service-workflow/reconciliation";
import { bookingTimestampText } from "@/lib/real-booking/display-time";
import { testById } from "@/lib/clinical/seed/tests";
import { ChevronDown } from "lucide-react";

/** Historical fictional bookings retain their original status; they are not new requests. */
export function LegacyBookingHistory({ workflow, locale }: { workflow: ServiceWorkflow; locale: Locale }) {
  const requests = workflow.bookingRequests ?? [];
  const bookings = workflow.bookings.filter(booking => !requests.some(request => booking.id === request.bookingId || booking.id.startsWith(`demo-request-${request.id}-`)));
  if (!bookings.length) return null;
  return <section className="w-full space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-5"><h2 className="text-h3">{pick(locale, {hy: "Նախկին փորձնական ամրագրումները", en: "Earlier demo bookings", ru: "Прежние демонстрационные записи"})}</h2><p className="text-caption text-muted-foreground">{pick(locale, {hy: "Երևանի ժամով", en: "Yerevan time", ru: "Время Еревана"})} (UTC+4)</p></div>
    {bookings.map(booking => {
      const tests = booking.testIds.map(id => testById(id)?.name[locale] ?? booking.testSnapshots?.find(test => test.id === id)?.title ?? id);
      const received = bookingResultsReceived(workflow, booking);
      const status = booking.status === "cancelled" ? pick(locale, {hy: "Չեղարկված է", en: "Cancelled", ru: "Отменено"}) : received ? pick(locale, {hy: "Արդյունքները ստացված են", en: "Results received", ru: "Результаты получены"}) : pick(locale, {hy: "Նախկին փորձնական ամրագրում", en: "Existing demo booking", ru: "Существующая демонстрационная запись"});
      return <article key={booking.id} className="journey-card w-full">
        <div className="flex flex-wrap items-start justify-between gap-2"><p className="text-body2 font-semibold">{bookingTimestampText(booking.at, locale)}</p><span className={`rounded-md px-2 py-1 text-caption font-medium ${received ? "bg-surface-subtle-teal text-primary" : "bg-muted text-foreground"}`}>{status}</span></div>
        <h3 className="text-body1 font-medium">{tests.length === 1 ? tests[0] : pick(locale, {hy: `${tests.length} հետազոտություն`, en: `${tests.length} tests`, ru: `${tests.length} исследований`})}</h3>
        <details className="group border-t pt-2"><summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 py-3 text-body2 font-medium text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden"><span>{pick(locale, {hy: "Տեսնել մանրամասները", en: "View details", ru: "Посмотреть подробности"})}</span><ChevronDown className="size-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden /></summary><div className="space-y-3 pb-2">
          {tests.length > 1 && <ul className="divide-y text-body2">{tests.map((test, index) => <li className="py-2" key={booking.testIds[index]}>{test}</li>)}</ul>}
          <dl className="space-y-3 text-body2"><div><dt className="text-caption text-muted-foreground">{pick(locale, {hy: "Վայրը", en: "Location", ru: "Место"})}</dt><dd className="break-words">{booking.address || (pick(locale, {hy: "Հասցեն հաստատված չէ", en: "Address not confirmed", ru: "Адрес не подтверждён"}))}</dd></div>{booking.providerPreparation && <div><dt className="text-caption text-muted-foreground">{pick(locale, {hy: "Գրանցված նախապատրաստումը", en: "Recorded preparation", ru: "Записанная подготовка"})}</dt><dd className="whitespace-pre-wrap break-words">{booking.providerPreparation.instructions}</dd></div>}</dl>
        </div></details>
      </article>;
    })}
  </section>;
}
