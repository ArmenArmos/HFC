import { CareSection } from "@/components/patient-care/common";
import { st, type StaffLocale } from "@/lib/staff/staff-locale-copy";
import type { BpWeekRead } from "@/lib/bp-week/model";
import type { StaffMedicinesRead } from "@/lib/member-medicines/model";
import type { StaffReason } from "@/lib/member-medicines/asks";
import { BpWeekPanel } from "./bp-week-panel";
import { MedicinesAdherencePanel } from "./medicines-adherence-panel";

/**
 * D1 and D2 on the member page for the assigned nurse and doctor. The page reads both (null = the
 * read failed); each panel follows its own database switch and shows nothing while it is off.
 */
export function BpWeekMedicinesPanels({ week, medicines, reasons = [], memberId, locale, now }: { week: BpWeekRead | null; medicines: StaffMedicinesRead | null; reasons?: StaffReason[]; memberId: string; locale: StaffLocale; now: Date }) {
  const unavailable = (title: string) => <CareSection title={title}><p role="status" className="text-body2">{st(locale, "Unavailable. Reload to check.", "Անհասանելի է։ Թարմացրեք էջը՝ ստուգելու համար։", "Недоступно. Обновите страницу для проверки.")}</p></CareSection>;
  return <div className="max-w-3xl space-y-6">
    {week === null ? unavailable(st(locale, "7-day home BP week", "7-օրյա տնային ճնշման շաբաթ", "7-дневная неделя домашних измерений давления")) : week.enabled && <BpWeekPanel read={week} memberId={memberId} locale={locale} now={now} />}
    {medicines === null ? unavailable(st(locale, "Medicines and ticks", "Դեղեր և նշումներ", "Лекарства и отметки")) : medicines.enabled && <MedicinesAdherencePanel read={medicines} reasons={reasons} locale={locale} now={now} />}
  </div>;
}
