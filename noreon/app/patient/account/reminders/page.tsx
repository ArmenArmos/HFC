import { Bell, ArrowLeft } from "lucide-react";
import { PatientShell } from "@/components/patient/patient-shell";
import { ReminderSettings } from "@/components/patient-care/reminder-settings";
import { CareLink, IconTile, copy } from "@/components/patient-care/common";
import { carePageData } from "@/lib/patient-care/repository";
export default async function RemindersPage() {
  const { profile, reminders } = await carePageData(), l = profile.locale;
  return <PatientShell locale={l}><div className="space-y-5">
    <header className="flex items-center gap-3"><IconTile icon={Bell} /><div><h1 className="text-h1">{copy(l, "Reminders", "Հիշեցումներ", "Напоминания")}</h1><p className="mt-1 text-body2 text-muted-foreground">{copy(l, "Your times, your routine.", "Ձեր ժամերը, ձեր առօրյան։", "Ваше время, ваш распорядок.")}</p></div></header>
    <ReminderSettings saved={reminders} locale={l} />
    <CareLink href="/patient/care" icon={ArrowLeft}>{copy(l, "Back to my care plan", "Վերադառնալ խնամքի պլանին", "Вернуться к моему плану лечения")}</CareLink>
  </div></PatientShell>;
}
