"use client";

import { MailIcon } from "lucide-react";

import { Medallion } from "@/components/brand/medallion";
import { Eyebrow } from "@/components/brand/panel";
import { RequestAccessButton } from "@/components/marketing/request-access";
import { COPY } from "@/lib/marketing/copy";
import { useMarketingLocale } from "@/components/marketing/locale";

/** The body of the sign-in placeholder, in whichever language is selected. */
export function LoginPanel() {
  const { t } = useMarketingLocale();

  return (
    <div className="rise-group bg-card rounded-2xl border p-8 shadow-[var(--shadow-md)]">
      <Medallion tone="teal" size="lg">
        <MailIcon aria-hidden />
      </Medallion>
      <div className="mt-6">
        <Eyebrow>{t(COPY["marketing.account"])}</Eyebrow>
        <h1 className="mt-4 text-h1">{t(COPY["marketing.signIn"])}</h1>
        <p className="text-muted-foreground mt-3 text-body2 text-pretty">
          {t(COPY["marketing.signInPending"])}
        </p>
      </div>
      {/* Sign in is not wired up and the guided demonstration is internal, so
          the one thing this page can actually do for a member who cannot get in
          is take their details and send them their access. */}
      <RequestAccessButton
        intent="access"
        size="lg"
        className="press mt-8 h-12 w-full text-body1"
      >
        {t({ hy: "Ակտիվացնել հասանելիությունը", en: "Activate access" })}
      </RequestAccessButton>
    </div>
  );
}
