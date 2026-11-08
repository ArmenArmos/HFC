import { PatientShell } from "@/components/patient/patient-shell";
import { requireRegistered } from "@/lib/patient/repository";
import { CareSection, CareLink, RowLink, IconTile, copy } from "@/components/patient-care/common";
import { ArrowLeft, Bell, HeartPulse, MonitorOff, Plus } from "lucide-react";
export default async function Monitor() {
  const { profile } = await requireRegistered();
  const l = profile.locale;
  return (
    <PatientShell locale={l}>
      <div className="space-y-5">
        <header className="flex items-center gap-3">
          <IconTile icon={HeartPulse} />
          <h1 className="text-h1">{copy(l, "Your BP monitor", "Ձեր ճնշման սարքը", "Ваш тонометр")}</h1>
        </header>
        <CareSection title={copy(l, "No monitor connected", "Սարք միացված չէ", "Тонометр не подключён")}>
          <div className="flex items-start gap-3 rounded-lg bg-muted p-4">
            <MonitorOff className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
            <p className="text-body2 text-muted-foreground">
              {copy(l, "Automatic syncing is not available yet. Enter your readings manually.", "Ավտոմատ համաժամեցումը դեռ հասանելի չէ։ Գրանցեք ձեր չափումները ձեռքով։", "Автоматическая синхронизация пока недоступна. Вводите измерения вручную.")}
            </p>
          </div>
          <CareLink href="/patient/measurements/new" variant="primary" icon={Plus}>
            {copy(l, "Record blood pressure", "Գրանցել ճնշումը", "Записать давление")}
          </CareLink>
          <div className="border-t pt-2">
            <RowLink href="/patient/account/reminders" icon={Bell}>
              {copy(l, "Change my reminders", "Փոխել իմ հիշեցումները", "Изменить напоминания")}
            </RowLink>
          </div>
        </CareSection>
        <CareLink href="/patient/health" icon={ArrowLeft}>
          {copy(l, "Back to Pressure", "Վերադառնալ «Ճնշում»", "Вернуться к разделу «Давление»")}
        </CareLink>
      </div>
    </PatientShell>
  );
}
