import type { PatientLocale } from "@/lib/patient/copy";
import type { MemberBookingData } from "@/lib/real-booking/schema";
import { currentAppointment } from "@/lib/patient-care/journey-step";
import { termsText } from "@/lib/real-booking/display-time";
import { AppointmentStatus } from "@/components/real-booking/appointment-status";
import { MemberBookingRequest } from "@/components/real-booking/member";
import { CareLink, copy } from "./common";

/** Saved arrangements stay distinct from proposals. Home links to the action-owning visit screen. */
export function HomeVisitDetail({ data, locale: l }: { data: MemberBookingData | null; locale: PatientLocale }) {
  if (!data) return null;
  const appointment = currentAppointment(data.pilot?.appointments ?? []);
  const requests = data.requests.filter(r => !r.pilotAppointmentId && r.status !== "cancelled" && r.status !== "completed");
  if (!appointment && !requests.length) return null;
  const proposal = appointment?.portal?.proposal;
  return <section className="journey-card space-y-3" data-home-visit-detail>
    <h2 className="text-h2">{copy(l, "My tests and visits", "Իմ հետազոտություններն ու այցերը", "Мои анализы и визиты")}</h2>
    {appointment && <>
      {proposal && <div className="ms-visit-proposal space-y-2">
        <h3 className="text-h3">{copy(l, "New visit time proposed by the clinic", "Կլինիկայի առաջարկած նոր այցի ժամ", "Новое время визита, предложенное клиникой")}</h3>
        <p className="text-body2">{termsText({ ...proposal, timezone: "Asia/Yerevan", mode: "clinic", location: proposal.clinicAddress }, l)} (UTC+4)</p>
        <p className="text-body2">{proposal.clinicName} · {proposal.clinicAddress}</p>
        {proposal.note && <p className="whitespace-pre-wrap text-body2">{proposal.note}</p>}
      </div>}
      <AppointmentStatus appointment={appointment} locale={l} clinics={data.pilot?.clinics} />
    </>}
    {requests.map(request => <MemberBookingRequest key={request.id} request={request} locale={l} available={data.available} readOnly />)}
    <CareLink href="/patient/service">{copy(l, "See the details", "Տեսնել մանրամասները", "Посмотреть подробности")}</CareLink>
  </section>;
}
