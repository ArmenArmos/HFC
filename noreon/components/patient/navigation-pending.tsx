"use client";

import { useLinkStatus } from "next/link";
import { LoaderCircle, type LucideIcon } from "lucide-react";
import { tx, type PatientLocale } from "@/lib/patient/copy";

function PendingStatus({ label, locale }: { label: string; locale: PatientLocale }) {
  return <span role="status" className="sr-only">{tx(locale, `Բացվում է՝ ${label}`, `Opening ${label}`, `Открывается: ${label}`)}</span>;
}

// Each instance must remain a descendant of its Link. Keep the icon/orb slot
// and label dimensions unchanged while the destination is being fetched.
export function MainNavigationContent({ label, locale, Icon, zoe }: {
  label: string;
  locale: PatientLocale;
  Icon: LucideIcon;
  zoe: boolean;
}) {
  const { pending } = useLinkStatus();
  return <>
    <span className={zoe ? "journey-orb relative" : "relative inline-flex size-5 shrink-0"} aria-hidden>
      {!zoe && <Icon className={`size-5 ${pending ? "invisible" : ""}`} />}
      {pending && <LoaderCircle className="absolute inset-0 m-auto size-5 motion-safe:animate-spin" />}
    </span>
    <span>{label}{pending && <PendingStatus label={label} locale={locale} />}</span>
  </>;
}

export function ProgressNavigationLabel({ label, locale }: { label: string; locale: PatientLocale }) {
  const { pending } = useLinkStatus();
  return <span className={pending ? "opacity-60 motion-safe:animate-pulse" : undefined}>
    {label}{pending && <PendingStatus label={label} locale={locale} />}
  </span>;
}
