import { tx, type PatientLocale } from "@/lib/patient/copy";

/**
 * Entry ranges for the slider, ± and keypad (founder brief, 18 Oct 2026). They are input bounds,
 * not clinical normal ranges, and sit inside the server's own validation (lib/patient/validation.ts).
 * `mid` is only where an untouched thumb rests; it is never saved.
 */
export const BP_FIELDS = {
  systolic: { min: 60, max: 260, mid: 160, ticks: [60, 100, 140, 180, 220, 260] },
  diastolic: { min: 30, max: 160, mid: 95, ticks: [30, 60, 90, 120, 160] },
  pulse: { min: 30, max: 220, mid: 125, ticks: [30, 70, 110, 150, 220] },
} as const;
export type BpField = keyof typeof BP_FIELDS;

/**
 * "" means not set. "partial" is a number still being typed that more digits can bring into range
 * ("1" or "12" on the way to 128): not an error yet, and never saved.
 */
export type BpReading = { state: "unset" } | { state: "set"; value: number } | { state: "partial"; raw: string } | { state: "invalid"; raw: string };

export function readBp(field: BpField, raw: string): BpReading {
  if (raw === "") return { state: "unset" };
  const { min, max } = BP_FIELDS[field];
  // A monitor never shows a leading zero, so "0" or "08" is a slip, not the start of a reading.
  if (!/^[1-9]\d{0,2}$/.test(raw)) return { state: "invalid", raw };
  const value = Number(raw);
  if (value >= min && value <= max) return { state: "set", value };
  for (let k = 1; raw.length + k <= 3; k++) {
    const low = value * 10 ** k, high = low + 10 ** k - 1;
    if (high >= min && low <= max) return { state: "partial", raw };
  }
  return { state: "invalid", raw };
}

export const clampBp = (field: BpField, value: number) => Math.max(BP_FIELDS[field].min, Math.min(BP_FIELDS[field].max, Math.round(value)));

/**
 * Keypad text: digits only, at most three. A fourth digit typed first after focusing a full box starts a new one,
 * so a filled box never refuses keystrokes when the browser did not select its text on focus.
 */
export function typedBp(raw: string, previous = "", firstKeyAfterFocus = false) {
  const digits = raw.replace(/\D/g, "");
  // Only the first key after tapping a full box restarts; later extra digits (a double tap) are ignored.
  if (digits.length === 4 && previous.length === 3 && firstKeyAfterFocus) {
    // Wherever the caret was, the one digit that is not part of the old number is the new start.
    for (let i = 0; i < 4; i++) if (digits.slice(0, i) + digits.slice(i + 1) === previous) return digits[i];
  }
  return digits.slice(0, 3);
}

/** ± from an unset value starts at the thumb's resting place, so the first press is visible and in range. */
export function stepBp(field: BpField, raw: string, delta: number): string {
  const reading = readBp(field, raw);
  const from = reading.state === "set" ? reading.value
    : reading.state !== "unset" && /^\d+$/.test(reading.raw) ? Number(reading.raw)
    : BP_FIELDS[field].mid;
  return String(clampBp(field, from + delta));
}

/** Where the thumb sits: the value when set, otherwise the neutral middle. */
export function thumbBp(field: BpField, raw: string) {
  const reading = readBp(field, raw);
  return reading.state === "set" ? reading.value : BP_FIELDS[field].mid;
}

export type BpProblem = "need-both" | "order" | `range-${BpField}` | `typing-${BpField}`;
export type BpCheck = { ok: true; systolic: number; diastolic: number; pulse?: number } | { ok: false; problem: BpProblem };

/** Save is allowed only once both pressures are set by the member, in range and in order. */
export function checkBp(values: Record<BpField, string>): BpCheck {
  const s = readBp("systolic", values.systolic), d = readBp("diastolic", values.diastolic), p = readBp("pulse", values.pulse);
  if (s.state === "invalid") return { ok: false, problem: "range-systolic" };
  if (d.state === "invalid") return { ok: false, problem: "range-diastolic" };
  if (p.state === "invalid") return { ok: false, problem: "range-pulse" };
  for (const [field, reading] of [["systolic", s], ["diastolic", d], ["pulse", p]] as const) if (reading.state === "partial") return { ok: false, problem: `typing-${field}` };
  if (s.state !== "set" || d.state !== "set") return { ok: false, problem: "need-both" };
  if (s.value <= d.value) return { ok: false, problem: "order" };
  return { ok: true, systolic: s.value, diastolic: d.value, ...(p.state === "set" ? { pulse: p.value } : {}) };
}

export function bpValueText(locale: PatientLocale, field: BpField, raw: string) {
  const reading = readBp(field, raw);
  if (reading.state !== "set") return tx(locale, "Նշված չէ", "Not set", "Не указано");
  return field === "pulse"
    ? tx(locale, `${reading.value} զարկ րոպեում`, `${reading.value} beats per minute`, `${reading.value} ударов в минуту`)
    : tx(locale, `${reading.value} միլիմետր սնդիկի սյուն`, `${reading.value} millimetres of mercury`, `${reading.value} миллиметров ртутного столба`);
}

/** The one line above Save: the reading as it will be saved, or what is still needed. */
export function bpSummary(locale: PatientLocale, values: Record<BpField, string>, check = checkBp(values)) {
  if (check.ok) return `${check.systolic} / ${check.diastolic} mmHg${check.pulse === undefined ? "" : tx(locale, ` · զարկերակ ${check.pulse}`, ` · pulse ${check.pulse}`, ` · пульс ${check.pulse}`)}`;
  const range = (field: BpField, en: string, hy: string, ru: string) => tx(locale, `${hy}՝ մուտքագրեք թիվ ${BP_FIELDS[field].min}–${BP_FIELDS[field].max}։`, `${en}: enter ${BP_FIELDS[field].min} to ${BP_FIELDS[field].max}.`, `${ru}: введите число от ${BP_FIELDS[field].min} до ${BP_FIELDS[field].max}.`);
  switch (check.problem) {
    case "range-systolic": return range("systolic", "Upper number", "Վերին թիվ", "Верхнее число");
    case "range-diastolic": return range("diastolic", "Lower number", "Ստորին թիվ", "Нижнее число");
    case "range-pulse": case "typing-pulse": return range("pulse", "Pulse", "Զարկերակ", "Пульс");
    case "typing-systolic": return range("systolic", "Upper number", "Վերին թիվ", "Верхнее число");
    case "typing-diastolic": return range("diastolic", "Lower number", "Ստորին թիվ", "Нижнее число");
    case "order": return tx(locale, "Վերին թիվը պետք է մեծ լինի ստորինից։", "The upper number must be higher than the lower one.", "Верхнее число должно быть больше нижнего.");
    default: return tx(locale, "Նշեք վերին և ստորին թվերը։", "Set the upper and lower numbers.", "Укажите верхнее и нижнее числа.");
  }
}
