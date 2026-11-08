import type { ReactNode } from "react";
import Link from "next/link";
import type { Route } from "next";
import { ChevronDown } from "lucide-react";
import type { PatientLocale } from "@/lib/patient/copy";
import type { CareResult } from "@/lib/patient-care/types";
import type { PublishedSourceRow } from "@/lib/patient-care/published-review";
import { resultGroups } from "@/lib/patient-care/model";
import { labRange } from "@/lib/patient-care/journey-evidence";
import { ReferenceFlag, sourceReferenceStatus } from "./result-row";
import { copy, stamp } from "./common";
import "@/components/patient/zoe-kit/zoe-kit.css";
import "./member-screens.css";

/** Opt-in presentation around the same data, notices and actions as the classic pages. */
export function MemberScreen({ enabled, locale, classicHref, children }: {
  enabled: boolean;
  locale: PatientLocale;
  classicHref?: Route;
  children: ReactNode;
}) {
  if (!enabled) return children;
  return <div className="zk ms-screen" data-member-screens-prototype>
    {children}
    {classicHref && <Link className="ms-classic" href={classicHref}>
      {copy(locale, "Open the previous view", "Բացել նախորդ տեսքը", "Открыть прежний вид")}
    </Link>}
  </div>;
}

/** Notices explaining source and chart availability remain visible before opening the charts. */
export function MemberCharts({ enabled, locale, children }: {
  enabled: boolean;
  locale: PatientLocale;
  children: ReactNode;
}) {
  if (!enabled) return children;
  return <details className="ms-charts">
    <summary>{copy(locale, "Show my charts", "Ցույց տալ իմ գրաֆիկները", "Показать мои графики")}<ChevronDown aria-hidden size={18} /></summary>
    <div className="ms-charts-body">{children}</div>
  </details>;
}

/** No local tab state: the full published plan and medicine cautions stay visible together. */
export function MemberCareSections({ plan, medicines, visits }: {
  locale: PatientLocale;
  plan: ReactNode;
  medicines: ReactNode;
  visits: ReactNode;
}) {
  return <div className="ms-care-sections">
    <div className="ms-plan">{plan}</div>
    <div className="ms-medicines">{medicines}</div>
    <div className="ms-visits">{visits}</div>
  </div>;
}

/** Current released literals take precedence, exactly as in the detailed results below.
 * No range or clinical status is inferred here; the existing result helpers supply the flags. */
export function MemberResultsGlance({ sourceRows, results, locale: l }: {
  sourceRows: PublishedSourceRow[];
  results: CareResult[];
  locale: PatientLocale;
}) {
  const rows = sourceRows.length ? sourceRows.map(row => ({
    id: row.id, name: row.source.name, value: row.source.literal || copy(l, "Value not reported", "Արժեքը նշված չէ", "Значение не указано"), unit: row.source.unit,
    date: row.reportDate, source: row.laboratory, status: sourceReferenceStatus(row.source),
  })) : resultGroups(results.filter(row => row.reviewedAt && row.reviewedBy)).map(group => {
    const row = group.at(-1)!;
    return { id: row.id, name: row.marker, value: String(row.value), unit: row.unit,
      date: stamp(row.collectedAt, l, false), source: row.sourceLabel, status: labRange(row).status };
  });
  if (!rows.length) return null;
  return <section className="ms-result-glance" data-results-glance aria-label={copy(l, "Results at a glance", "Արդյունքները՝ մեկ հայացքով", "Результаты кратко")}>
    <p className="ms-result-note text-caption text-muted-foreground">{copy(l, "Reference flags compare supplied laboratory ranges, not a diagnosis.", "Համեմատությունը տրամադրված լաբորատոր միջակայքի հետ է, ոչ թե ախտորոշում։", "Отметки показывают сравнение с предоставленными лабораторными диапазонами, а не диагноз.")}</p>
    {rows.map(row => <a key={row.id} href="#approved-results" className="ms-result-tile">
      <h2>{row.name}</h2>
      <p className="ms-result-value">{row.value}<span>{row.unit}</span></p>
      <p className="text-caption text-muted-foreground">{row.source || copy(l, "Laboratory not reported", "Լաբորատորիան նշված չէ", "Лаборатория не указана")} · {row.date || copy(l, "Date not reported", "Ամսաթիվը նշված չէ", "Дата не указана")}</p>
      <ReferenceFlag status={row.status} locale={l} />
    </a>)}
  </section>;
}
