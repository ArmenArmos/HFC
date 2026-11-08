import "server-only";
import { z } from "zod";
import { parseSpendConfiguration } from "./spend";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import {
  fetchMessageDelivery,
  reconciliationStore,
  runMessageReconciliation,
} from "./recovery";
import type { TwilioConfig } from "./twilio";
const operator = z.string().regex(/^[A-Za-z0-9@._-]{3,100}$/);
const revision = z
  .string()
  .regex(/^\d+$/)
  .transform(Number)
  .refine(Number.isSafeInteger);
const commands = z.union([
  z.tuple([z.literal("spend-status")]),
  z.tuple([
    z.literal("spend-configure"),
    revision,
    operator,
    z
      .string()
      .min(1)
      .max(4096)
      .refine((v) => !v.includes("\0")),
  ]),
  z.tuple([z.enum(["status", "status-all"])]),
  z.tuple([
    z.enum(["status", "status-all"]),
    z.iso.datetime({ offset: true }),
    z.uuid(),
  ]),
  z.tuple([z.literal("reconcile")]),
  z.tuple([z.literal("retry"), z.uuid(), operator]),
  z.tuple([
    z.literal("acknowledge"),
    z.uuid(),
    z.string().regex(/^[0-9a-f]{32}$/),
    operator,
  ]),
  z.tuple([
    z.literal("resume"),
    revision,
    z.enum(["configuration-checked", "unknown-reviewed", "operator-reset"]),
    operator,
    z
      .string()
      .regex(/^\d+$/)
      .transform(Number)
      .pipe(z.number().int().min(1).max(10000))
      .optional(),
  ]),
]);
export function parseMessageOperation(args: string[]) {
  return commands.parse(args);
}
export function requireMessageOperations(
  env: Record<string, string | undefined>,
) {
  if (
    env.NOREON_MESSAGE_OPERATIONS_ENABLED !== "true"
  )
    throw Error("disabled");
}
export async function runMessageOperation(
  args: string[],
  db: SupabaseClient<Database>,
  config?: TwilioConfig,
  spendConfiguration?: unknown,
) {
  const command = parseMessageOperation(args),
    signal = () => AbortSignal.timeout(5000);
  if (command[0] === "spend-status") {
    const p = await db
      .from("patient_message_spend_policy")
      .select(
        "revision,enabled,currency,daily_limit_micros,sms_segment_ceiling_micros,whatsapp_message_ceiling_micros,max_sms_segments,allowed_prefixes,valid_until",
      )
      .eq("id", 1)
      .abortSignal(signal())
      .single();
    if (p.error) throw Error("storage");
    const day = new Date().toISOString().slice(0, 10);
    const totals = p.data.currency
      ? await db
          .from("patient_message_spend_totals")
          .select("reserved_micros")
          .eq("budget_day", day)
          .eq("currency", p.data.currency)
          .abortSignal(signal())
          .maybeSingle()
      : { data: null, error: null };
    if (totals.error) throw Error("storage");
    const reserved = totals.data?.reserved_micros ?? 0;
    return {
      policy: p.data,
      budgetDay: day,
      reservedMicros: reserved,
      remainingMicros: Math.max(0, p.data.daily_limit_micros - reserved),
      basis:
        "Conservative estimated reservations, not actual provider billing. No automatic refunds.",
    };
  }
  if (command[0] === "spend-configure") {
    const policy = parseSpendConfiguration(spendConfiguration);
    const r = await db
      .rpc("configure_patient_message_spend", {
        p_expected_revision: command[1],
        p_policy: policy,
        p_operator_label: command[2],
      })
      .abortSignal(signal());
    if (r.error) throw Error("storage");
    return { configured: r.data };
  }

  if (command[0] === "status" || command[0] === "status-all") {
    const control = await db
      .from("patient_message_dispatch_control")
      .select(
        "revision,budget_day,started_count,daily_limit,paused_reason,paused_at",
      )
      .eq("id", 1)
      .abortSignal(signal())
      .single();
    if (control.error) throw Error("storage");
    const attention = await db
      .rpc("patient_message_attention", {
        p_before_started_at: command[1],
        p_before_id: command[2],
        p_limit: 51,
        p_include_acknowledged: command[0] === "status-all",
      })
      .abortSignal(signal());
    if (attention.error) throw Error("storage");
    const page = attention.data.slice(0, 50),
      last = page.at(-1);
    return {
      control: control.data,
      attention: page,
      nextCursor:
        attention.data.length > 50 && last
          ? { startedAt: last.started_at, attemptId: last.attempt_id }
          : null,
    };
  }
  if (command[0] === "reconcile") {
    if (!config) throw Error("unconfigured");
    return runMessageReconciliation(reconciliationStore(db), (id, reference) =>
      fetchMessageDelivery(config, id, reference),
    );
  }
  if (command[0] === "acknowledge") {
    const r = await db
      .rpc("acknowledge_patient_message_attention", {
        p_attempt_id: command[1],
        p_expected_evidence: command[2],
        p_operator_label: command[3],
      })
      .abortSignal(signal());
    if (r.error) throw Error("storage");
    return { acknowledged: r.data };
  }
  if (command[0] === "retry") {
    const r = await db
      .rpc("retry_patient_message_submission", {
        p_attempt_id: command[1],
        p_operator_label: command[2],
      })
      .abortSignal(signal());
    if (r.error) throw Error("storage");
    return { requeued: r.data };
  }
  if (command[0] !== "resume") throw Error("invalid");
  const r = await db
    .rpc("resume_patient_message_dispatch", {
      p_expected_revision: command[1],
      p_acknowledgement: command[2],
      p_operator_label: command[3],
      p_daily_limit: command[4],
    })
    .abortSignal(signal());
  if (r.error) throw Error("storage");
  return { resumed: r.data };
}
