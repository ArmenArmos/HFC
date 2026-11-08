"use client";

import { useEffect } from "react";
import type { PatientLocale } from "@/lib/patient/copy";

/** Keep the static public layout free of session reads; own language only while mounted. */
export function PatientDocumentLanguage({ locale }: { locale: PatientLocale }) {
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.lang;
    root.lang = locale;
    return () => { root.lang = previous; };
  }, [locale]);
  return null;
}
