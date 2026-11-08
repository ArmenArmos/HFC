"use client";
import { pick, type Locale } from "@/lib/locale";
import { createContext, useContext, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
type Section = "overview" | "results" | "review" | "followup" | "history" | "gp";
const Context = createContext<{
  section: Section;
  select: (s: Section) => void;
} | null>(null);
export function CaseSections({ children, doctor = true }: { children: React.ReactNode; doctor?: boolean }) {
  const [section, select] = useState<Section>("overview");
  const router = useRouter();
  // Lab values may have been confirmed in another tab. Refresh the existing
  // server reads on Evidence entry, without preparing or changing the review.
  useEffect(() => {
    if (section === "results") router.refresh();
  }, [section, router]);
  useEffect(() => {
    const sync = () => {
      const h = window.location.hash;
      if (h === "#case-history") select("history");
      else if (h === "#uploaded-reports" || h === "#report-history")
        select("results");
      else if (h.startsWith("#answer-")) select(doctor ? "results" : "overview");
      else if (h === "#monitoring") select(doctor ? "followup" : "overview");
      else if (h === "#gp-report" && doctor) select("gp");
      else if (h === "#programme") select("followup");
      else if (h === "#treatment" && doctor) select("review");
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, [doctor]);
  return (
    <Context.Provider value={{ section, select }}>{children}</Context.Provider>
  );
}
export function CaseTabs({ doctor = true, nurse = false, locale = "en", gpReport = false }: { doctor?: boolean; nurse?: boolean; locale?: Locale; gpReport?: boolean }) {
  const ctx = useContext(Context);
  if (!ctx) return null;
  const t = (en: string, hy: string, ru: string) => pick(locale, { en, hy, ru });
  const base: Array<[Section, string]> = nurse
    ? [["overview", t("Overview", "Ամփոփում", "Обзор")], ["results", t("Evidence", "Տվյալներ", "Данные")], ["followup", t("Follow-up", "Հետագա քայլեր", "Дальнейшие шаги")], ["history", t("History", "Պատմություն", "История")]]
    : doctor
    ? [
        ["overview", t("Overview", "Ամփոփում", "Обзор")],
        ["results", t("Evidence", "Տվյալներ", "Данные")],
        ["review", t("Treatment plan", "Բուժման պլան", "План лечения")],
        ["followup", t("Follow-up", "Հետագա քայլեր", "Дальнейшие шаги")],
        ["history", t("History", "Պատմություն", "История")],
      ]
    : [
        ["overview", t("Overview & bookings", "Ընդհանուր և ամրագրումներ", "Обзор и записи")],
        ["results", t("Shared reports", "Համօգտագործվող հաշվետվություններ", "Общие отчёты")],
        ["history", t("History", "Պատմություն", "История")],
      ];
  // The GP report tab exists only for the assigned doctor while its switch is on.
  const tabs: Array<[Section, string]> = gpReport && doctor && !nurse ? [...base, ["gp", t("GP report", "Բժշկի հաշվետվություն", "Отчёт для врача первичного звена")]] : base;
  return (
    <nav
      aria-label={t("Case sections", "Գործի բաժիններ", "Разделы случая")}
      className="my-6 flex flex-wrap gap-1 border-b lg:flex-nowrap lg:overflow-x-auto"
    >
      {tabs.map(([id, label]) => (
        <button
          key={id}
          type="button"
          aria-pressed={ctx.section === id}
          onClick={() => ctx.select(id)}
          className={`min-h-12 shrink-0 border-b-2 px-4 text-body2 font-medium ${ctx.section === id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:bg-muted"}`}
        >
          {label}
        </button>
      ))}
    </nav>
  );
}
export function CasePanel({
  name,
  children,
}: {
  name: Section;
  children: React.ReactNode;
}) {
  const ctx = useContext(Context);
  return (
    <div hidden={!!ctx && ctx.section !== name} className="space-y-6">
      {children}
    </div>
  );
}
export function CaseSectionButton({
  name,
  children,
}: {
  name: Section;
  children: React.ReactNode;
}) {
  const ctx = useContext(Context);
  if (!ctx) return null;
  return (
    <button
      type="button"
      onClick={() => ctx.select(name)}
      className="inline-flex min-h-11 items-center rounded-md border px-4 text-body2 font-medium hover:bg-muted"
    >
      {children}
    </button>
  );
}
