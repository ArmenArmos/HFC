import type { ReactNode } from "react";
import type { PatientLocale } from "@/lib/patient/copy";
import { PatientShell } from "@/components/patient/patient-shell";
import { CareLink, copy } from "./common";

/** The full pages and chat cards use exactly the same readers and controls. */
export function MemberPageFrame({ embedded, kind, locale, children }: {
  embedded: boolean; kind: "progress" | "care" | "results"; locale: PatientLocale; children: ReactNode;
}) {
  if (!embedded) return <PatientShell locale={locale}>{children}</PatientShell>;
  return <section className="zk ms-screen member-chat-card space-y-4" data-member-chat-card={kind}>
    {children}
    <CareLink href={`/patient/${kind}`}>{copy(locale, "Open the full page", "Բացել ամբողջ էջը", "Открыть полную страницу")}</CareLink>
  </section>;
}
