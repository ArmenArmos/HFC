import type { Metadata } from "next";

import { Landing } from "@/components/marketing/landing";

/** Public informational homepage. Product entry points are disabled. */
export const metadata: Metadata = {
  // The positioning line, verbatim. It is the sentence the whole page is built
  // to earn, and a search result that says something else is a search result
  // arguing with the page it opens.
  title: "Noreon | From risk detection to lasting change.",
  description:
    "Noreon is a continuous cardiovascular prevention platform connecting risk assessment, diagnostics, clinical guidance, connected devices, behaviour change and monitoring, so every detected risk can lead to sustained action and measurable progress.",
  alternates: { canonical: "/" },
  robots: { index: true, follow: true },
};

/**
 * Health content is YMYL, so Google applies elevated scrutiny. Structured data
 * that names the organisation and its medical specialty is part of how that
 * scrutiny gets satisfied.
 */
const organizationJsonLd = {
  "@context": "https://schema.org",
  "@type": "MedicalOrganization",
  name: "Noreon",
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  description:
    "Noreon connects cardiovascular risk detection, diagnostics, clinical guidance, connected devices, behaviour change and monitoring in one continuous prevention system.",
  medicalSpecialty: "PreventiveMedicine",
};

export default function LandingPage() {
  return (
    <>
      <script
        type="application/ld+json"
        // Server-rendered from a literal we control — no user input reaches this.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }}
      />
      <Landing />
    </>
  );
}
