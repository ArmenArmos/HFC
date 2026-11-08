import { redirect } from "next/navigation";
import type { Route } from "next";
import { memberChatOnlyEnabled } from "@/lib/patient/member-chat-config";
import { profileHop } from "@/lib/patient/entry-routes";
import { cookies } from "next/headers";
import { parseLocale } from "@/lib/locale";
import { getPatientState } from "@/lib/patient/repository";
import { patientIdentity } from "@/lib/patient/auth";
import { dateInArmenia } from "@/lib/patient/validation";
import { ProfileForm } from "@/components/patient/profile-form";
import { readZoePrompt } from "@/lib/zoe/member";
export default async function Profile({searchParams = Promise.resolve({})}: {searchParams?: Promise<{view?: string}>} = {}) {
  if (memberChatOnlyEnabled() && (await searchParams).view !== "classic") {
    const state = await getPatientState({ coherentProfile: true });
    redirect(profileHop({ profile: !!state.profile, consent: state.consentAccepted }, { chatOnly: true })! as Route);
  }
  const state = await getPatientState({ coherentProfile: true });
  const locale = parseLocale((await cookies()).get("noreon_locale")?.value, "hy");
  // Enrolment: the Zoe statement is shown with the consent text when a grant can be recorded.
  const zoe = !state.profile ? await readZoePrompt() : { due: false, directAnswers: false, zoeScreen: false };
  // An unfinished sign-up resumes on this device for this member (Gohar Q1).
  const draftKey = !state.profile ? (await patientIdentity())?.userId : undefined;
  return <ProfileForm profile={state.profile} expectedRevision={state.assessment?.revision ?? -1} initialLocale={locale} today={dateInArmenia()} zoeStatement={zoe.due} zoeDirectAnswers={zoe.directAnswers} draftKey={draftKey} memberChatV2={process.env.NOREON_MEMBER_CHAT_V2 === "true"} />;
}
