import {
  DEFAULT_REMINDERS,
  parseReminderPreferences,
  type SavedReminderPreferences,
} from "../../../../lib/patient-care/reminder-preferences.ts";
export function reminderSnapshot(
  row: { revision: number; preferences: unknown } | null,
): SavedReminderPreferences {
  if (!row)
    return {
      revision: 0,
      preferences: parseReminderPreferences(DEFAULT_REMINDERS),
    };
  if (
    !Number.isSafeInteger(row.revision) ||
    row.revision < 0 ||
    row.revision > 2147483647
  )
    throw Error("Invalid revision");
  return {
    revision: row.revision,
    preferences: parseReminderPreferences(row.preferences),
  };
}
type Rpc = (
  name: "save_patient_reminder_preferences",
  args: {
    p_preferences: ReturnType<typeof parseReminderPreferences>;
    p_expected_revision: number;
  },
) => PromiseLike<{ data: number | null; error: unknown }>;
export async function submitReminders(
  rpc: Rpc,
  input: unknown,
  revision: number,
): Promise<
  | { status: "saved"; revision: number }
  | { status: "conflict" | "invalid" | "unavailable" }
> {
  let preferences;
  try {
    preferences = parseReminderPreferences(input);
    if (
      !Number.isSafeInteger(revision) ||
      revision < 0 ||
      revision >= 2147483647
    )
      return { status: "invalid" };
  } catch {
    return { status: "invalid" };
  }
  try {
    const result = await rpc("save_patient_reminder_preferences", {
      p_preferences: preferences,
      p_expected_revision: revision,
    });
    if (result.error) return { status: "unavailable" };
    if (result.data === -1) return { status: "conflict" };
    return result.data === revision + 1
      ? { status: "saved", revision: result.data }
      : { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}
