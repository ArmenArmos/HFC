import { MemberScreen } from "@/components/patient-care/member-screens";
import { memberScreensPrototypeEnabled } from "@/lib/patient/member-screens-config";
import { requireRegistered } from "@/lib/patient/repository";
import { PatientShell } from "@/components/patient/patient-shell";
import { MeasurementEntryDialog } from "@/components/patient/measurement-entry-dialog";
import { CareLink, IconTile } from "@/components/patient-care/common";
import { ArrowLeft, HeartPulse } from "lucide-react";
import { tx } from "@/lib/patient/copy";
export default async function NewMeasurement({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const prototype = memberScreensPrototypeEnabled() && (await searchParams).view !== "classic";
  const { profile } = await requireRegistered();
  return (
    <PatientShell locale={profile.locale}>
      <MemberScreen enabled={prototype} locale={profile.locale} classicHref="/patient/measurements/new?view=classic">
      <div className="mx-auto max-w-lg space-y-5">
        <CareLink href="/patient/health" icon={ArrowLeft}>
          {tx(profile.locale, "Վերադառնալ «Ճնշում»", "Back to Pressure", "Вернуться к давлению")}
        </CareLink>
        <section className="journey-card space-y-6 rounded-2xl border border-border/70 bg-card p-5 shadow-sm sm:p-6">
          <header>
            <div className="flex items-center gap-3">
              <IconTile icon={HeartPulse} />
              <h1 className="text-h1">
                {tx(profile.locale, "Գրանցեք ձեր ճնշումը։", "Record your blood pressure.", "Запишите ваше давление.")}
              </h1>
            </div>
            <p className="mt-3 text-body2 text-muted-foreground">
              {tx(profile.locale, "Մուտքագրեք ձեր սարքի ցույց տված արդյունքը։", "Enter the reading shown on your monitor.", "Введите измерение, которое показывает ваш тонометр.")}
            </p>
          </header>

        </section>
      </div>
      <MeasurementEntryDialog prototype={prototype} classicHref="/patient/measurements/new?view=classic" locale={profile.locale} />
      </MemberScreen>
    </PatientShell>
  );
}
