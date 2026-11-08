import { MemberScreen } from "@/components/patient-care/member-screens";
import { memberScreensPrototypeEnabled } from "@/lib/patient/member-screens-config";
import { PatientDocumentLanguage } from "@/components/patient/document-language";
import { patientIdentity } from "@/lib/patient/auth";
import { getPatientState } from "@/lib/patient/repository";
import { careAlertMemberStatus } from "@/lib/care-alerts/member";
import { ZoeUrgentContent } from "./content";

export const dynamic = "force-dynamic";

/** The member's language if it can be read. No session or an unreadable profile never costs this screen: Armenian then. */
async function urgentLocale() {
  const member = await patientIdentity().catch(() => null);
  const state = member ? await getPatientState().catch(() => null) : null;
  return state?.profile?.locale ?? "hy";
}

/** How long the 103 screen waits for the alert status. Past that it opens and makes no claim either way. */
const STATUS_WAIT_MS = 1500;

/**
 * The 103 screen for words typed to Zoe that match the urgent list. It uses only the approved
 * urgent-screen wording, has no routine navigation (lead decision 17 Oct, QA M-01: 103 first,
 * plus one Get help exit). Typed text does raise a care alert (20261019222000_zoe_urgent_care_alert.sql), usually just after
 * this screen opens, so ZoeUrgentNotice says what the database says about the message that opened it (?request=) and nothing
 * before that. With no such message the screen makes no claim either way.
 */
export default async function ZoeUrgent({ searchParams }: { searchParams?: Promise<{ request?: string | string[]; view?: string }> } = {}) {
  const l = await urgentLocale();
  const { request: raw, view } = (await searchParams) ?? {};
  const prototype = memberScreensPrototypeEnabled() && view !== "classic";
  const request = typeof raw === "string" ? raw : null;
  const status = request
    ? await Promise.race([careAlertMemberStatus(request), new Promise<null>((resolve) => setTimeout(() => resolve(null), STATUS_WAIT_MS))])
    : null;
  return (
    <main
      lang={l}
      className={`${prototype ? "member-journey ms-urgent " : ""}min-h-dvh bg-[var(--marker-out-fg)] px-4 py-8 text-foreground sm:px-6 sm:py-12`}
    >
      <PatientDocumentLanguage locale={l} />
      <MemberScreen enabled={prototype} locale={l}>
        <ZoeUrgentContent locale={l} request={request} initial={status?.zoe ?? null} />
      </MemberScreen>
    </main>
  );
}
