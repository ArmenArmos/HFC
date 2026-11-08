import "server-only";
import { readMemberBpWeek } from "@/lib/bp-week/server";
import { memberLdl } from "@/lib/ldl/member";
import { readOwnHistory } from "@/lib/member-history/server";
import { readMemberMedicines } from "@/lib/member-medicines/server";
import { readMemberCareTeam } from "@/lib/patient-care/care-team-repository";
import { journeyStripInput } from "@/lib/patient-care/journey-strip";
import { readJourneyExtras } from "@/lib/patient-care/journey-reads";
import { getMemberLabStages } from "@/lib/patient-care/lab-stage-repository";
import { getCareData } from "@/lib/patient-care/repository";
import { getMemberBookingData } from "@/lib/real-booking/repository";
import { memberLabSummary } from "@/lib/staff/lab-stage-schema";
import { readZoeConsents } from "@/lib/zoe/member";
import type { PatientLocale } from "@/lib/patient/copy";
import { getMeasurements } from "@/lib/patient/repository";
import { buildOverview } from "./overview";
import { createClient } from "@/lib/supabase/server";
import { readMemberBpTarget, type BpTargetRpc } from "@/lib/bp-target/runtime";
import { bpTargetsEnabled } from "@/lib/clinical-review/config";

/** Each read stands alone: one that fails leaves its part unknown, and the rest of the view still opens. */
const known = <T,>(read: Promise<T>) => read.catch(() => undefined);

export async function readOverview({ locale, name, questionnaireComplete }: { locale: PatientLocale; name: string; questionnaireComplete: boolean }) {
  const [care, home, history, bpWeek, ldl, medicines, team, consents, labSamples, booking, extras] = await Promise.all([
    known(getCareData()), known(getMeasurements()), known(readOwnHistory()), known(readMemberBpWeek()), known(memberLdl()), known(readMemberMedicines()),
    known(readMemberCareTeam()), known(readZoeConsents()), known(getMemberLabStages()), known(getMemberBookingData({ summaryOnly: true })), known(readJourneyExtras()),
  ]);
  const target = bpTargetsEnabled() ? await known((async () => readMemberBpTarget((await createClient()) as unknown as BpTargetRpc))()) : null;
  const now = new Date();
  const lab = labSamples ? memberLabSummary(labSamples) : undefined;
  const strip = journeyStripInput({
    questionnaireComplete, lab, planPublished: !!care?.plan, requests: booking?.requests, appointments: booking?.pilot?.appointments,
    nurseVisit: extras?.nurseVisit, released: extras?.released,
  });
  const clinics = booking?.pilot?.clinics ?? {};
  const booked = booking?.pilot?.appointments
    .flatMap(a => a.status === "confirmed" && a.current && Date.parse(a.current.startsAt) >= now.getTime() ? [a.current] : [])
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
  return buildOverview({
    now, locale, name, questionnaireComplete,
    doctor: team?.doctor,
    consent: consents ? consents.readsMessages : undefined,
    care: care ?? null,
    home: home ?? null,
    clinicBp: history?.clinic.bp ?? null,
    bpWeek: bpWeek ?? null,
    ldl,
    bpTarget: target ? { systolic: target.homeSystolicTarget, diastolic: target.homeDiastolicTarget } : null,
    medicines: medicines ?? null,
    uploaded: history?.documents ?? null,
    released: extras?.released ?? null,
    labResultsReceived: lab === "results-received",
    visitDone: strip.visitDone === true,
    bookedVisit: booked ? { startsAt: booked.startsAt, location: booked.location, clinic: clinics[booked.clinicId] ?? null, preparation: booked.preparation } : null,
  });
}
