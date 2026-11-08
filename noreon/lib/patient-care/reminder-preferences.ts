import { z } from "zod";
const time = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/);
const schema = z
  .object({
    medicationEnabled: z.boolean(),
    medicationOffsetMinutes: z.union([
      z.literal(-15),
      z.literal(0),
      z.literal(15),
    ]),
    bpEnabled: z.boolean(),
    bpTimes: z
      .array(time)
      .min(1)
      .max(4)
      .refine((v) => new Set(v).size === v.length, "Choose distinct times."),
    quietStart: time,
    quietEnd: time,
  })
  .strict();
export type ReminderPreferences = z.infer<typeof schema>;
export type SavedReminderPreferences = {
  revision: number;
  preferences: ReminderPreferences;
};
export const DEFAULT_REMINDERS: ReminderPreferences = {
  medicationEnabled: true,
  medicationOffsetMinutes: 0,
  bpEnabled: false,
  bpTimes: ["08:00", "20:00"],
  quietStart: "22:00",
  quietEnd: "07:00",
};
export function parseReminderPreferences(input: unknown): ReminderPreferences {
  const value = schema.parse(input);
  return { ...value, bpTimes: [...value.bpTimes].sort() };
}
export function updateReminderPreferences(
  saved: SavedReminderPreferences,
  input: unknown,
  expectedRevision: number,
): SavedReminderPreferences {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
    throw new Error("invalid");
  const preferences = parseReminderPreferences(input);
  if (saved.revision !== expectedRevision) throw new Error("conflict");
  return { revision: saved.revision + 1, preferences };
}
