import { cookies } from "next/headers";
import { PatientShell } from "@/components/patient/patient-shell";
import { CareLink } from "@/components/patient-care/common";
import { patientIdentity } from "@/lib/patient/auth";
import { getPatientState } from "@/lib/patient/repository";
import { tx, type PatientLocale } from "@/lib/patient/copy";

import { parseLocale, isLocale } from "@/lib/locale";

async function memberLocale(): Promise<PatientLocale> {
  try {
    if (await patientIdentity()) {
      const saved = (await getPatientState()).profile?.locale;
      if (isLocale(saved)) return saved;
    }
  } catch {
    // A 404 must still render if the profile cannot be read.
  }
  return parseLocale((await cookies()).get("noreon_locale")?.value, "hy");
}

export default async function MemberNotFound() {
  const l = await memberLocale();
  return (
    <PatientShell locale={l} navigation={false}>
      <section className="mx-auto max-w-md space-y-4 py-10">
        <h1 className="text-h1">{tx(l, "Այս հասցեով էջ չկա", "There is no page at this address", "По этому адресу нет страницы")}</h1>
        <p className="text-body1 text-muted-foreground">{tx(l, "Հղումը կարող է հնացած լինել, կամ հասցեում վրիպակ է։", "The link may be out of date, or the address may have a typo in it.", "Возможно, ссылка устарела или в адресе есть опечатка.")}</p>
        <p className="text-body2 text-muted-foreground">{tx(l, "Ձեր տվյալների և արդյունքների հետ ոչինչ չի պատահել։", "Nothing has happened to your data or your results.", "С вашими данными и результатами ничего не произошло.")}</p>
        <CareLink href="/patient/dashboard">{tx(l, "Գնալ գլխավոր էջ", "Go to Home", "На главную")}</CareLink>
      </section>
    </PatientShell>
  );
}
