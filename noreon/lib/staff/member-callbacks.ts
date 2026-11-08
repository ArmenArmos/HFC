import "server-only";
import { z } from "zod";
import { requireRealAdmin } from "@/lib/staff/real-admin";
import { CALLBACK_FROM, CONTACT_CHANNELS, CONTACT_TIMES } from "@/lib/patient/member-preferences-contract";

export const callbackRowSchema = z.object({
  id: z.uuid(), memberId: z.uuid(), memberName: z.string().nullable(), phone: z.string().nullable(),
  locale: z.string(), requestedFrom: z.enum(CALLBACK_FROM), contactChannel: z.enum(CONTACT_CHANNELS),
  contactTimes: z.array(z.enum(CONTACT_TIMES)), state: z.enum(["open", "done", "cancelled"]),
  outcome: z.enum(["reached", "no_answer", "cancelled_by_member", "not_needed"]).nullable(),
  createdAt: z.string(), closedAt: z.string().nullable(), telegramLinked: z.boolean(),
});
export type CallbackRow = z.infer<typeof callbackRowSchema>;
export const CALLBACK_OUTCOMES = ["reached", "no_answer", "not_needed"] as const;

/** Open requests oldest first, then the last 7 days of closed ones. Admins only. */
export async function readCallbackQueue(): Promise<CallbackRow[]> {
  const { client } = await requireRealAdmin();
  const { data, error } = await client.rpc("staff_callback_queue");
  if (error) throw Error("Callback queue unavailable");
  return z.array(callbackRowSchema).parse(data);
}
