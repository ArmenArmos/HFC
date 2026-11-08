import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { parseSpendPolicy } from "./spend";
import { MessageAdmissionError, type MessageWorkerStore } from "./worker";
export async function readMessageSpendPolicy(db: SupabaseClient<Database>) {
  const r = await db
    .from("patient_message_spend_policy")
    .select(
      "revision,enabled,currency,daily_limit_micros,sms_segment_ceiling_micros,whatsapp_message_ceiling_micros,max_sms_segments,allowed_prefixes,valid_until",
    )
    .eq("id", 1)
    .abortSignal(AbortSignal.timeout(5000))
    .single();
  if (r.error) throw Error("storage");
  return parseSpendPolicy(r.data);
}
export function messageWorkerStore(
  db: SupabaseClient<Database>,
  policyRevision: number,
  availableChannels: Array<"sms" | "whatsapp"> = [],
): MessageWorkerStore {
  const signal = () => AbortSignal.timeout(5000);
  return {
    async sweep() {
      const r = await db
        .rpc("mark_stale_patient_message_submissions")
        .abortSignal(signal());
      if (r.error) throw Error("storage");
      return r.data;
    },
    async sources(after) {
      const r = await db
        .rpc("patient_plan_message_candidates", {
          p_limit: 100,
          p_after_published_at: after?.published_at,
          p_after_id: after?.plan_id,
        })
        .abortSignal(signal());
      if (r.error) throw Error("storage");
      return r.data;
    },
    async claimSource(planId) {
      const r = await db
        .rpc("claim_patient_message_source", { p_plan_id: planId })
        .abortSignal(signal());
      if (r.error) throw Error("storage");
      return r.data;
    },
    async completeSource(planId, claimToken) {
      const r = await db
        .rpc("complete_patient_message_source", {
          p_plan_id: planId,
          p_claim_token: claimToken,
        })
        .abortSignal(signal());
      if (r.error) throw Error("storage");
      return r.data;
    },
    async enqueue(planId) {
      const r = await db
        .rpc("enqueue_patient_plan_message", { p_plan_id: planId })
        .abortSignal(signal());
      if (r.error) throw Error("storage");
      return r.data;
    },
    async queued() {
      const r = await db
        .rpc("patient_message_queue_candidates", { p_limit: 25, p_available_channels: availableChannels })
        .abortSignal(signal());
      if (r.error) throw Error("storage");
      return r.data.map((row) => row.job_id);
    },
    async begin(jobId) {
      const r = await db
        .rpc("begin_patient_message_submission_budgeted", {
          p_job_id: jobId,
          p_policy_revision: policyRevision,
          p_available_channels: availableChannels,
        })
        .abortSignal(signal());
      if (r.error) {
        const reason = (
          {
            "message dispatch paused": "paused",
            "message daily limit": "daily-limit",
            "message dispatch busy": "busy",
            "message spending unconfigured": "spending-unconfigured",
            "message spending revision": "spending-revision",
            "message spending limit": "spending-limit",
            "message destination blocked": "destination-blocked",
          } as const
        )[
          r.error.message as
            | "message dispatch paused"
            | "message daily limit"
            | "message dispatch busy"
            | "message spending unconfigured"
            | "message spending revision"
            | "message spending limit"
            | "message destination blocked"
        ];
        if (reason) throw new MessageAdmissionError(reason);
        throw Error("storage");
      }
      const row = r.data[0];
      if (!row) return null;
      if (
        !["sms", "whatsapp"].includes(row.channel) ||
        !["hy", "en"].includes(row.locale)
      )
        throw Error("storage");
      return {
        attemptId: row.attempt_id,
        destination: row.destination,
        channel: row.channel as "sms" | "whatsapp",
        locale: row.locale as "hy" | "en",
      };
    },
    async finish(id, status, reference) {
      // SQL accepts null; generated PostgreSQL function-argument types omit nullability.
      const r = await db
        .rpc("finish_patient_message_submission", {
          p_attempt_id: id,
          p_status: status,
          p_provider_reference: reference!,
        })
        .abortSignal(signal());
      if (r.error) throw Error("storage");
      return r.data;
    },
    async attempt(id) {
      const r = await db
        .from("patient_message_attempts")
        .select("status,provider_reference")
        .eq("id", id)
        .abortSignal(signal())
        .maybeSingle();
      if (r.error) throw Error("storage");
      return r.data;
    },
    async record(event) {
      const r = await db
        .rpc("record_patient_message_delivery", {
          p_attempt_id: event.attemptId,
          p_reference: event.reference,
          p_status: event.status,
          p_error_code: event.errorCode ?? undefined,
        })
        .abortSignal(signal());
      if (r.error) throw Error("storage");
      return r.data;
    },
  };
}
