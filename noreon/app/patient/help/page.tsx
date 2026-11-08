import {MemberHelpContent} from "@/components/patient-care/member-help-content";
import { MemberScreen } from "@/components/patient-care/member-screens";
import { memberScreensPrototypeEnabled } from "@/lib/patient/member-screens-config";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { PatientShell } from "@/components/patient/patient-shell";
import { copy } from "@/components/patient-care/common";
import { patientIdentity } from "@/lib/patient/auth";
import { getPatientState } from "@/lib/patient/repository";
import { memberContact } from "@/lib/patient-care/member-contact";
import type { PatientLocale } from "@/lib/patient/copy";

import { parseLocale, isLocale } from "@/lib/locale";

type HelpSearch = Promise<{ locale?: string | string[]; view?: string }>;

/** Signed-out visitors reach this page from the sign-in header, so it must not require a session. */
async function signedOutLocale(searchParams?: HelpSearch): Promise<PatientLocale> {
  const requested = (await searchParams)?.locale;
  if (isLocale(requested)) return requested;
  return parseLocale((await cookies()).get("noreon_locale")?.value, "hy");
}

export async function generateMetadata({ searchParams }: { searchParams?: HelpSearch }): Promise<Metadata> {
  const l = await signedOutLocale(searchParams);
  return { title: copy(l, "Get help", "Ստանալ օգնություն", "Получить помощь") };
}

export default async function HelpPage({ searchParams }: { searchParams?: HelpSearch }) {
  // A member part way through sign-up has a session but no profile yet; they get the signed-out view.
  // If the state read fails, still show the urgent guidance rather than an error page.
  const state = (await patientIdentity().catch(() => null)) ? await getPatientState().catch(() => null) : null;
  const signedIn = !!(state?.profile && state.consentAccepted && state.assessment);
  const l = state?.profile?.locale ?? await signedOutLocale(searchParams);
  const prototype = memberScreensPrototypeEnabled() && (await searchParams)?.view !== "classic";
  const contact = signedIn ? await memberContact() : { mode: "none" as const };
  return (
    <PatientShell locale={l} navigation={signedIn}>
      <MemberScreen enabled={prototype} locale={l} classicHref={`/patient/help?locale=${l}&view=classic`}>
      <div className={prototype ? "ms-support ms-help space-y-6" : "space-y-6"}>
        <MemberHelpContent locale={l} contact={contact} signedIn={signedIn} signingUp={!!state} />
      </div>
      </MemberScreen>
    </PatientShell>
  );
}
