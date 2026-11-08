import { Pill } from "lucide-react";
import type { PatientLocale } from "@/lib/patient/copy";
import { CareLink, IconTile, copy } from "@/components/patient-care/common";
import { todaysDoses, type MemberMedicinesRead } from "@/lib/member-medicines/model";
import { dosesForDay } from "@/lib/patient-care/model";
import type { CareData } from "@/lib/patient-care/types";
import { MEDICINE_ASK_COPY } from "@/lib/member-medicines/ask-copy";

function homeDoseStatuses(read: Extract<MemberMedicinesRead, { enabled: true }>, care: CareData | null, now: Date) {
  const own = read.medicines.filter(m => !m.stoppedAt).flatMap(m => todaysDoses(m, now, read.medicines));
  const plan = care ? dosesForDay(care, now) : [];
  return [...own.map(d => d.status), ...plan.map(d => d.status)];
}

/** Home: today's doses ticked out of today's doses so far, both kinds. Nothing when there are none. */
export function MedicinesHomeCard({ read, care, locale: l, now, askOpen = false }: { read: MemberMedicinesRead; care: CareData | null; locale: PatientLocale; now: Date; askOpen?: boolean }) {
  if (!read.enabled) return null;
  const all = homeDoseStatuses(read, care, now);
  if (!all.length) return null;
  const ticked = all.filter(s => s === "taken" || s === "skipped").length, open = all.filter(s => s === "due").length;
  return (
    <section className="journey-card space-y-4 rounded-2xl border border-border/70 bg-card p-5 shadow-sm sm:p-6" aria-labelledby="medicines-home">
      <div className="flex items-start gap-3">
        <IconTile icon={Pill} />
        <div>
          <h2 id="medicines-home" className="text-h2">{copy(l, "Medicines today", "Այսօրվա դեղերը", "Лекарства на сегодня")}</h2>
          <p className="mt-1 text-body2 text-muted-foreground">{copy(l, `${ticked} of ${all.length} ticked`, `Նշված է ${all.length}-ից ${ticked}-ը`, `Отмечено ${ticked} из ${all.length}`)}{open > 0 ? copy(l, ` · ${open} to tick now`, ` · ${open}-ը՝ հիմա նշելու`, ` · осталось отметить сейчас: ${open}`) : ""}</p>
          {askOpen && <p className="mt-1 text-body2 font-semibold">{MEDICINE_ASK_COPY[l].title}</p>}
        </div>
      </div>
      <div className="flex flex-wrap gap-2"><CareLink href="/patient/medicines" variant={open > 0 || askOpen ? "primary" : "secondary"} icon={Pill}>{open > 0 ? copy(l, "Tick my medicines", "Նշել իմ դեղերը", "Отметить приём лекарств") : copy(l, "See my medicines", "Տեսնել իմ դեղերը", "Посмотреть мои лекарства")}</CareLink></div>
    </section>
  );
}

/** Self-loading, so Home needs one line; the switch off or an outage renders nothing. */
export async function MedicinesHome({ locale }: { locale: PatientLocale }) {
  const { readMemberMedicines, readMemberMedicineAsks } = await import("@/lib/member-medicines/server");
  const read = await readMemberMedicines();
  if (!read.enabled) return null;
  const { getCareData } = await import("@/lib/patient-care/repository");
  const [care, asks] = await Promise.all([getCareData().catch(() => null), readMemberMedicineAsks()]);
  return <MedicinesHomeCard read={read} care={care} locale={locale} now={new Date()} askOpen={asks.enabled && asks.asks.length > 0} />;
}

/** Compact Home keeps the outstanding follow-up visible without the dose dashboard. */
export async function MedicineAskHomeNotice({ care, locale: l, now }: { care: CareData; locale: PatientLocale; now: Date }) {
  const { readMemberMedicines, readMemberMedicineAsks } = await import("@/lib/member-medicines/server");
  const read = await readMemberMedicines();
  if (!read.enabled || !homeDoseStatuses(read, care, now).length) return null;
  const asks = await readMemberMedicineAsks();
  if (!asks.enabled || !asks.asks.length) return null;
  return <aside className="member-home-card" role="note" data-home-medicine-ask>
    <p className="text-body2 font-semibold">{MEDICINE_ASK_COPY[l].title}</p>
    <CareLink href="/patient/medicines">{copy(l, "See my medicines", "Տեսնել իմ դեղերը", "Посмотреть мои лекарства")}</CareLink>
  </aside>;
}

/** The entry on the care page while the feature is on. */
export async function MedicinesLink({ locale: l }: { locale: PatientLocale }) {
  const { readMemberMedicines } = await import("@/lib/member-medicines/server");
  const { RowLink } = await import("@/components/patient-care/common");
  const read = await readMemberMedicines();
  if (!read.enabled) return null;
  return <RowLink href="/patient/medicines" icon={Pill} detail={copy(l, "Your plan’s medicines and your own list, with daily ticks", "Ձեր պլանի դեղերը և ձեր սեփական ցանկը՝ օրական նշումներով", "Лекарства из вашего плана и вашего списка с ежедневными отметками")}>{copy(l, "My medicines", "Իմ դեղերը", "Мои лекарства")}</RowLink>;
}
