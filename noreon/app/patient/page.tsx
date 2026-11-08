import { cookies } from "next/headers";
import { testSigninEntryEnabled } from "@/lib/telegram-auth/test-signin";
import { realRegistrationReady } from "@/lib/deployment";
import { redirect } from "next/navigation";
import { patientIdentity } from "@/lib/patient/auth";
import { PhoneEntry } from "@/components/patient/phone-entry";
import { tx } from "@/lib/patient/copy";
import { phoneCodePolicy } from "@/lib/patient/phone-code-policy";
import { captchaSiteKey } from "@/lib/captcha";
import { continuePath } from "@/lib/patient/continue-path";
import type { Route } from "next";
import { parseLocale } from "@/lib/locale";
import { noreonName } from "@/lib/brand";
export default async function PatientEntry({ searchParams }: { searchParams?: Promise<{ locale?: string | string[]; next?: string | string[]; link?: string | string[]; view?: string | string[] }> }) {
  const params = await searchParams;
  // ?next= is only ever one of the allowed member pages (an expired Telegram link continues there).
  const next = continuePath(params?.next);
  if (await patientIdentity()) redirect((next ?? (params?.view === "classic" ? "/patient/dashboard?view=classic" : "/patient/dashboard")) as Route);
  const requestedLocale = params?.locale;
  const savedLocale = (await cookies()).get("noreon_locale")?.value;
  const locale = parseLocale(requestedLocale, parseLocale(savedLocale, "hy"));
  if (!realRegistrationReady(process.env) && !testSigninEntryEnabled(process.env)) return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-6 px-6 py-12">
      <p className="text-caption text-brand-teal">{noreonName(locale)}</p>
      <h1 className="text-h1">{tx(locale,"Գրանցումը՝ շուտով","Registration opens soon", "Регистрация скоро откроется")}</h1>
      <p className="text-body1">{tx(locale,"Հեռախոսահամարի հաստատումը նախապատրաստվում է։ Գրանցումը դեռ բաց չէ։","Phone verification is being prepared. Registration is not open yet.", "Подтверждение номера телефона готовится. Регистрация пока не открыта.")}</p>
      <a className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 py-2 text-body2 font-medium text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" href="mailto:info@noreon.health">{tx(locale,"Կապվել Նորեոն Հելթի հետ","Contact Noreon", "Связаться с Нореон Хелс")}</a>
    </main>
  );
  return <PhoneEntry initialLocale={locale} delivery={phoneCodePolicy(process.env)?.delivery ?? "sms"} siteKey={captchaSiteKey()} next={next} linkExpired={params?.link === "expired"} />;
}
