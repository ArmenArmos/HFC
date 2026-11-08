"use client";
import { BookingForm } from "@/components/real-booking/common";
import { memberBookingCommand } from "@/lib/real-booking/actions";
import type { BookingRequest } from "@/lib/real-booking/schema";
import type { PatientLocale } from "@/lib/patient/copy";

/**
 * Accepting the nurse visit an admin proposed for the LDL re-test, from the goal card (Astra LDLR-02): the same member
 * booking command as the tests page, under the LDL eligibility contract (lib/ldl/retest.ts), so a questionnaire that is
 * not complete never blocks the doctor's ordered test.
 */
export function LdlVisitAccept({ request, locale, label }: { request: { id: string; revision: number; algorithmVersion: string }; locale: PatientLocale; label: string }) {
  return <BookingForm action={memberBookingCommand} operation="accept" request={request as BookingRequest} locale={locale} label={label} />;
}
