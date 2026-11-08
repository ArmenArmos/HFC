"use client";

import {
  FinalCta,
  Privacy,
  Science,
} from "@/components/marketing/home/sections-closing";
import {
  Audience,
  Hero,
  Reality,
} from "@/components/marketing/home/sections-opening";
import {
  CardiovascularFocus,
  Dashboards,
  Zoe,
} from "@/components/marketing/home/sections-product";
import {
  ActionGap,
  HowItWorks,
} from "@/components/marketing/home/sections-system";

/**
 * The public homepage.
 *
 * Its audience is business and government first: insurers, employers, benefits
 * and health leaders, ministries and public-health agencies. Its second
 * audience is the member who was given access by one of them, which is why the
 * member experience is shown underneath the argument rather than beside it.
 *
 * The positioning is deliberate and it is not "early detection". Detection is
 * one step of six; the differentiation is everything that happens after a risk
 * is found, which is what the action gap section exists to establish before a
 * single screen of software appears. The order of the sections is the argument,
 * in three movements:
 *
 *   the problem   hero -> audience -> reality
 *   the system    how it works -> action gap -> dashboards -> focus -> Zoe
 *   the warrant   science -> insights -> privacy -> close
 *
 * Three rules hold across every section, and they are the ones to check a
 * change against:
 *
 * - No outcome claim. There is no Noreon result to quote, so the page quotes
 *   none: no return on investment, no saving, no reduced hospitalisation. Every
 *   figure on the page belongs to somebody else and carries a marker back to
 *   `sources.tsx`.
 * - Every dashboard and chart is labelled illustrative, on its own surface.
 * - Nothing overstates what the machinery does. The pill box supports a routine
 *   rather than proving a dose was swallowed, Zoe explains and nudges rather
 *   than diagnosing, and the protocols are designed with specialists and
 *   monitored by them rather than each report being signed off by a doctor.
 *
 * The grounds carry the three movements: the problem closes on navy, the system
 * runs on the light ground and ends on navy with Zoe, and the warrant alternates
 * back down to the navy close. Navy is the brand's authority colour, so it is
 * spent four times on this page and never as decoration.
 *
 * The page is composed here and written in `home/`, one file per movement,
 * because eleven sections in one file is a file nobody opens twice.
 */
export function Landing() {
  return (
    <>
      <Hero />
      <Audience />
      <Reality />
      <HowItWorks />
      <ActionGap />
      <Dashboards />
      <CardiovascularFocus />
      <Zoe />
      <Science />
      {/* <Insights /> */}
      <Privacy />
      <FinalCta />
    </>
  );
}
