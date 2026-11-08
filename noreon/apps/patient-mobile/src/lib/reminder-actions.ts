import { clientFor } from "./actions";
import { abortableHistory } from "./history";
import { reminderSnapshot, submitReminders } from "./reminders";
export async function readNativeReminders(userId: string, signal: AbortSignal) {
  return abortableHistory(async () => {
    const client = await clientFor(userId, signal);
    if (signal.aborted) throw Error("Cancelled");
    const result = await client
      .from("patient_reminder_preferences")
      .select("revision,preferences")
      .abortSignal(signal)
      .maybeSingle();
    if (result.error) throw Error("Settings unavailable");
    return reminderSnapshot(result.data);
  }, signal);
}
export async function saveNativeReminders(
  userId: string,
  input: unknown,
  revision: number,
  signal: AbortSignal,
) {
  try {
    return await abortableHistory(async () => {
      const client = await clientFor(userId, signal);
      if (signal.aborted) throw Error("Cancelled");
      return submitReminders(
        (name, args) => client.rpc(name, args).abortSignal(signal),
        input,
        revision,
      );
    }, signal);
  } catch {
    return { status: "unavailable" as const };
  }
}
