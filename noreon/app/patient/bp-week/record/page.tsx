import { memberScreensPrototypeEnabled } from "@/lib/patient/member-screens-config";
import "@/components/patient/zoe-kit/zoe-kit.css";
import "@/components/patient-care/member-screens.css";
import { notFound, redirect } from "next/navigation";
import { PatientShell } from "@/components/patient/patient-shell";
import { requireRegistered } from "@/lib/patient/repository";
import { readMemberBpWeek } from "@/lib/bp-week/server";
import { currentWeek, weekPhase, weekSlots, yerevanDate } from "@/lib/bp-week/model";
import { WeekEntryDialog } from "@/components/bp-week/week-entry";

export const dynamic = "force-dynamic";

/** One reading into today's morning or evening slot of the running week. */
export default async function RecordWeekReading({ searchParams }: { searchParams: Promise<{ slot?: string; view?: string }> }) {
  const { profile } = await requireRegistered();
  const { slot, view } = await searchParams;
  const prototype = memberScreensPrototypeEnabled() && view !== "classic";
  if (slot !== "morning" && slot !== "evening") notFound();
  const read = await readMemberBpWeek();
  if (!read.enabled) notFound();
  const now = new Date(), week = currentWeek(read, now);
  if (!week || weekPhase(week, now) !== "running") redirect("/patient/bp-week");
  const today = weekSlots(week, now).find(s => s.date === yerevanDate(now) && s.slot === slot);
  if (!today || today.state === "done") redirect("/patient/bp-week");
  return (
    <PatientShell locale={profile.locale}>
      <WeekEntryDialog prototype={prototype} locale={profile.locale} weekId={week.id} slot={slot} saved={today.readings.length} />
    </PatientShell>
  );
}
