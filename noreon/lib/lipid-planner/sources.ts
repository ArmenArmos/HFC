/**
 * The references the lipid planner may cite: short names only, no quotations and no page numbers. Each one was read by a
 * reviewer in output/specialist-review-2026-10-30/ (`read` says where). Anything a review marked as recalled from memory
 * is not here. The prototype's passages are placeholders and are not used.
 */
export const LIPID_SOURCES = {
  esc2019_s6: { short: "ESC/EAS 2019 §6", read: "BRIEF.review.md section 3" },
  esc2019_s95: { short: "ESC/EAS 2019 §9.5", read: "BRIEF.review.md section 4; FABLE_REPORT.md section 2(b)" },
  esc2019_t13: { short: "ESC/EAS 2019 Table 13", read: "BRIEF.review.md sections 4, 6 and 7" },
  esc2025: { short: "ESC/EAS 2025 update", read: "BRIEF.review.md section 4; FABLE_REPORT.md section 2(b)" },
  acc2026_s34: { short: "ACC/AHA 2026 §3.4", read: "BRIEF.review.md section 7; FABLE_REPORT.md section 3" },
  acc2026_s35: { short: "ACC/AHA 2026 §3.5", read: "BRIEF.review.md section 4; FABLE_REPORT.md section 2(b)" },
  acc2026_s426: { short: "ACC/AHA 2026 §4.2.6", read: "BRIEF.review.md sections 3 and 5; FABLE_REPORT.md section 2(a)" },
  acc2026_s4211: { short: "ACC/AHA 2026 §4.2.11", read: "FABLE_REPORT.md section 3" },
  acc2026_s51: { short: "ACC/AHA 2026 §5.1", read: "BRIEF.review.md sections 6 and 7; FABLE_REPORT.md section 3" },
  acc2025_acs: { short: "ACC/AHA ACS 2025", read: "BRIEF.review.md section 4" },
  aha2021_stroke: { short: "AHA/ASA stroke 2021 §4.3", read: "BRIEF.review.md sections 4 and 5" },
} as const;
export type LipidSourceId = keyof typeof LIPID_SOURCES;
