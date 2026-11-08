import type { ProfileInput, MeasurementInput } from "./types";

export function dateInArmenia(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Yerevan",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
export function parseBirthDate(input: string): string | null {
  if (typeof input !== "string") return null;
  const text = input.trim();
  let y: number, m: number, d: number;
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const digits = text.replace(/[/.\-]/g, "");
  if (iso) [, y, m, d] = iso.map(Number);
  else if (/^\d{8}$/.test(digits)) {
    d = Number(digits.slice(0, 2));
    m = Number(digits.slice(2, 4));
    y = Number(digits.slice(4));
  } else return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (
    y < 1900 ||
    y > 2200 ||
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== m - 1 ||
    date.getUTCDate() !== d
  )
    return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
/** Typed or pasted date of birth shown as DD/MM/YYYY (Gohar D-009): digits only, with the slash
 * added after the day and the month. `deleting` leaves off a trailing slash so Backspace can remove
 * it. A pasted "18.5.1974", "18-05-1974" or ISO "1974-05-18" becomes "18/05/1974". */
export function maskBirthInput(input: string, deleting = false): string {
  if (typeof input !== "string") return "";
  const text = input.trim();
  const iso = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/.exec(text);
  const dmy = /^(\d{1,2})[-./\s](\d{1,2})[-./\s](\d{4})$/.exec(text);
  const pad = (n: string) => n.padStart(2, "0");
  if (iso) return `${pad(iso[3])}/${pad(iso[2])}/${iso[1]}`;
  if (dmy) return `${pad(dmy[1])}/${pad(dmy[2])}/${dmy[3]}`;
  // A separator after one digit closes the day or the month, so "1/1/1990" is the 1st of January (QA a1-01).
  const padded = deleting ? text : text.replace(/^(\d)[-./\s]/, "0$1/").replace(/^(\d{2}[-./\s])(\d)[-./\s]/, "$10$2/");
  const digits = padded.replace(/\D/g, "").slice(0, 8);
  let out = digits.slice(0, 2);
  if (digits.length > 2 || (digits.length === 2 && !deleting)) out += "/";
  out += digits.slice(2, 4);
  if (digits.length > 4 || (digits.length === 4 && !deleting)) out += "/";
  return out + digits.slice(4);
}
/** Why a typed date of birth cannot be used, or null when it is a real date for ages 18–110. */
export function birthDateProblem(input: string, today = dateInArmenia()): "empty" | "invalid" | "young" | "old" | null {
  if (typeof input !== "string" || !input.trim()) return "empty";
  const date = parseBirthDate(input);
  if (!date) return "invalid";
  const age = ageOn(date, today);
  if (!(age >= 18)) return "young";
  if (age > 110) return "old";
  return null;
}
export const NAME_MIN_LENGTH = 2;
export const NAME_MAX_LENGTH = 60;
// Armenian (with the ligature և), Latin with its accented ranges, and Cyrillic letters. Explicit
// ranges rather than \p{Script=…}, which the native app's JavaScript engine may not support.
const NAME_LETTER = "A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u024F\u1E00-\u1EFF\u0400-\u0481\u048A-\u052F\u0531-\u0556\u0560-\u0588\uFB13-\uFB17";
// Accents follow a letter; U+034F (an invisible joiner) is not one of them.
const NAME_WORD = `[${NAME_LETTER}][${NAME_LETTER}\u0300-\u034E\u0350-\u036F]*`;
const NAME_LETTERS = new RegExp(`[${NAME_LETTER}]`, "g");
// Words of letters joined by one space, hyphen or apostrophe ('’ʼ and the Armenian ՚).
const NAME_PATTERN = new RegExp(`^${NAME_WORD}(?:[ '\u2019\u02BC\u055A-]${NAME_WORD})*$`);
/** The stored form of a member's name: Unicode NFC, trimmed, inner runs of spaces made one. */
export function normalizeName(input: string): string {
  return typeof input === "string" ? input.normalize("NFC").trim().replace(/\s+/g, " ") : "";
}
/** Why a member's name cannot be saved (Gohar D-001), or null when it can. The server applies
 * the same rule through validProfile, so the form's check is only for a quick, clear message. */
export function nameProblem(input: string): "empty" | "short" | "long" | "characters" | null {
  const name = normalizeName(input);
  if (!name) return "empty";
  if (name.length > NAME_MAX_LENGTH) return "long";
  if (!NAME_PATTERN.test(name)) return "characters";
  // The minimum counts letters, so one letter with accents is still too short (review R2).
  if ((name.match(NAME_LETTERS) ?? []).length < NAME_MIN_LENGTH) return "short";
  return null;
}
export function ageOn(birthDate: string, assessmentDate: string): number {
  if (!parseBirthDate(birthDate) || !parseBirthDate(assessmentDate)) return NaN;
  const [y, m, d] = birthDate.split("-").map(Number),
    [ay, am, ad] = assessmentDate.split("-").map(Number);
  return ay - y - (am < m || (am === m && ad < d) ? 1 : 0);
}
export function normalizePhone(input: string): string | null {
  if (typeof input !== "string" || input.length > 30) return null;
  let phone = input.replace(/[\s()-]/g, "");
  if (/^0\d{8}$/.test(phone)) phone = "+374" + phone.slice(1);
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) return null;
  if (phone.startsWith("+374") && !/^\+374[1-9]\d{7}$/.test(phone)) return null;
  return phone;
}
/** Members type only the 8-digit national number; "+374" is a fixed prefix in the field.
 * Typed or pasted text is reduced to at most 8 digits: a pasted "+374", "00374" or a full
 * 11-digit "374…" loses the country code, and a leading 0 (the domestic trunk prefix) is dropped. */
export function armenianNationalDigits(input: string): string {
  if (typeof input !== "string") return "";
  const raw = input.trim().slice(0, 40);
  let digits = raw.replace(/\D/g, "");
  if (raw.startsWith("+374") || raw.startsWith("+ 374")) digits = digits.slice(3);
  else if (digits.startsWith("00374")) digits = digits.slice(5);
  else if (digits.length > 8 && digits.startsWith("374")) digits = digits.slice(3);
  return digits.replace(/^0+/, "").slice(0, 8);
}
/** True for a pasted international number from another country ("+1 555…", "0044…"), which
 * must not be read as 8 Armenian digits. */
export function foreignInternationalNumber(input: string): boolean {
  if (typeof input !== "string") return false;
  const raw = input.trim();
  const digits = raw.replace(/\D/g, "");
  if (raw.startsWith("+")) return digits.length > 0 && !"374".startsWith(digits.slice(0, 3));
  if (digits.startsWith("00")) return digits.length > 2 && !"374".startsWith(digits.slice(2, 5));
  return false;
}
/** The E.164 number the server expects (+374XXXXXXXX), or null until the 8 digits are valid. */
export function armenianPhoneFromNational(national: string): string | null {
  return /^[1-9]\d{7}$/.test(national) ? normalizePhone(`+374${national}`) : null;
}
export function validProfile(
  value: unknown,
  today = dateInArmenia(),
): value is ProfileInput {
  if (!value || typeof value !== "object") return false;
  const v = value as ProfileInput;
  const age = typeof v.birthDate === "string" ? ageOn(v.birthDate, today) : NaN;
  return (
    typeof v.name === "string" &&
    nameProblem(v.name) === null &&
    /^\d{4}-\d{2}-\d{2}$/.test(v.birthDate) &&
    age >= 18 &&
    age <= 110 &&
    (v.biologicalSex === "male" || v.biologicalSex === "female") &&
    (v.locale === "hy" || v.locale === "en" || v.locale === "ru")
  );
}
export function validMeasurement(
  value: unknown,
  now = new Date(),
): value is MeasurementInput {
  if (!value || typeof value !== "object") return false;
  const v = value as MeasurementInput;
  return (
    typeof v.submissionId === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      v.submissionId,
    ) &&
    Number.isInteger(v.systolic) &&
    v.systolic >= 60 &&
    v.systolic <= 300 &&
    Number.isInteger(v.diastolic) &&
    v.diastolic >= 30 &&
    v.diastolic <= 200 &&
    v.systolic > v.diastolic &&
    (v.pulse === undefined ||
      (Number.isInteger(v.pulse) && v.pulse >= 20 && v.pulse <= 250)) &&
    typeof v.measuredAt === "string" &&
    /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v.measuredAt) &&
    Number.isFinite(Date.parse(v.measuredAt)) &&
    Date.parse(v.measuredAt) <= now.getTime() + 300000
  );
}
