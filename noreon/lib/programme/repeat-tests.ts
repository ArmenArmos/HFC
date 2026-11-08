/**
 * Repeat-test intervals as the decision tree states them (NRN-CLIN-ALG-001 v1.1, paragraph numbers
 * as extracted from docs/clinical/NRN-CLIN-ALG-001-decision-tree-v1.1.docx). These are conditional
 * on the doctor's own findings and treatment, so the app lists them for the doctor and never
 * schedules or orders anything from them. Where none applies, the doctor decides (Armen C12 open).
 * The lab catalogue (NRN-LAB-CAT-001) has no repeat intervals.
 */
import type { Locale } from "@/lib/locale";
export type RepeatTestRule = { id: string; source: string; when: Record<Locale, string>; repeat: Record<Locale, string> };
export const REPEAT_TEST_RULES: RepeatTestRule[] = [
  {
    id: "lipids-after-therapy",
    source: "DT v1.1 P531–533 (EAS 2025 Table 4)",
    when: { en: "LDL-C above target, lipid-lowering therapy started or changed", hy: "LDL-C-ն թիրախից բարձր է, լիպիդ իջեցնող թերապիան սկսվել կամ փոխվել է", ru: "ХС-ЛПНП выше целевого, гиполипидемическая терапия начата или изменена" },
    repeat: { en: "Reassess after 4–6 weeks", hy: "Վերագնահատում 4–6 շաբաթ անց", ru: "Повторная оценка через 4–6 недель" },
  },
  {
    id: "kidney-yearly",
    source: "DT v1.1 P543–545 (2024 HTN §7)",
    when: { en: "eGFR below 60 or ACR 3 or above (CKD)", hy: "eGFR <60 կամ ACR ≥3 (ՔԵՀ)", ru: "СКФ <60 или альбумин/креатинин ≥3 (ХБП)" },
    repeat: { en: "eGFR and ACR at least yearly", hy: "eGFR + ACR առնվազն տարեկան", ru: "СКФ и альбумин/креатинин не реже раза в год" },
  },
  {
    id: "ras-blocker-k-creatinine",
    source: "DT v1.1 P582–584 (2024 HTN §9)",
    when: { en: "RAS blocker planned", hy: "ՌԱՍ-բլոկատոր պլանավորվում է", ru: "Планируется блокатор РАС" },
    repeat: { en: "K⁺ and creatinine at baseline, repeat after 2–4 weeks", hy: "K⁺/կրեատինին՝ ելակետային, կրկնություն 2–4 շաբաթ անց", ru: "K⁺ и креатинин исходно, повторить через 2–4 недели" },
  },
];
