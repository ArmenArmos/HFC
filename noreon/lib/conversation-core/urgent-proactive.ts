import "server-only";
import { z } from "zod";
import { audit, canonicalHash, type ApprovedSchedule, type ConversationId, type CoreContext, type CoreState, type EpisodeId, type MemberId, type ProactiveInstanceId, type UrgentEpisode } from "./contracts";

/**
 * Minimal urgent and proactive invariants. There is no classifier, timer or
 * scheduler here and no clinical wording: triggers, guidance text and schedules
 * are injected approved inputs, and fixtures use conspicuously fictional ones.
 */

/** Approved urgent configuration: trigger IDs with versions, and exact guidance per locale. */
export type UrgentConfig = {
  triggers: ReadonlyMap<string, { version: string }>;
  guidance: ReadonlyMap<string, { contentId: string; version: string; text: string }>;
};

const CALL_103 = { kind: "call", number: "103" } as const;

/**
 * Guidance and the Call 103 action are fixed before the escalation is attempted,
 * so neither a failed escalation enqueue, a missing assignment nor a pending
 * doctor reply can withhold them. Missing approved guidance yields an explicit
 * unavailable state, never substitute text. Routine prompts stop for the episode.
 */
export function raiseUrgent(
  state: CoreState, ctx: CoreContext, input: { conversationId: ConversationId; triggerId: string; locale: string },
  config: UrgentConfig | undefined, enqueueEscalation: (episodeId: EpisodeId) => string,
): { ok: true; episode: UrgentEpisode } | { ok: false; code: "conversation_unknown" | "trigger_not_approved" } {
  const conversation = state.conversations.get(input.conversationId);
  if (!conversation) return { ok: false, code: "conversation_unknown" };
  const trigger = config?.triggers.get(input.triggerId);
  if (config && !trigger) {
    audit(state, ctx, "urgent.raise", "denied", { conversationId: conversation.id, code: "trigger_not_approved" });
    return { ok: false, code: "trigger_not_approved" };
  }
  const approved = config?.guidance.get(input.locale);
  const id = ctx.newId("episode") as EpisodeId;
  const episode: UrgentEpisode = {
    id, conversationId: conversation.id, memberId: conversation.memberId, triggerId: input.triggerId, triggerVersion: trigger?.version ?? null, startedAt: ctx.now(),
    guidance: approved ? { kind: "approved", contentId: approved.contentId, version: approved.version, locale: input.locale, text: approved.text }
      : { kind: "unavailable", locale: input.locale, reason: config ? "locale_not_approved" : "configuration_missing" },
    call103: CALL_103, escalation: { state: "enqueue_failed" }, routineStopped: true,
  };
  state.urgentEpisodes.set(id, episode);
  conversation.urgentEpisodeId = id;
  let cancelled = 0;
  for (const instance of state.proactive.values())
    if (instance.memberId === conversation.memberId && instance.state === "pending") { instance.state = "cancelled_urgent"; cancelled++; }
  audit(state, ctx, "urgent.raise", "recorded", { episodeId: id, guidance: episode.guidance.kind, proactiveCancelled: cancelled });

  try {
    episode.escalation = { state: "enqueued", ref: enqueueEscalation(id) };
    state.tasks.push({ kind: "urgent_escalation", conversationId: conversation.id, createdAt: ctx.now(), episodeId: id });
  } catch {
    episode.escalation = { state: "enqueue_failed" };
  }
  audit(state, ctx, "urgent.escalation", episode.escalation.state === "enqueued" ? "recorded" : "denied", { episodeId: id, state: episode.escalation.state });
  return { ok: true, episode };
}

/** What a surface may show. Escalation status is only enqueue status; nothing implies dispatch or acknowledgement. */
export function urgentView(episode: UrgentEpisode) {
  return {
    guidance: episode.guidance.kind === "approved" ? { text: episode.guidance.text, contentId: episode.guidance.contentId, version: episode.guidance.version } : { unavailable: true as const },
    primaryAction: episode.call103,
    routineQuestionsStopped: episode.routineStopped,
    escalationStatus: episode.escalation.state,
  };
}

const proactiveSchema = z.strictObject({
  scheduleId: z.string().min(1).max(120),
  version: z.number().int().min(1),
  planVersion: z.string().min(1).max(120),
  approvedBy: z.string().min(1).max(200),
  questions: z.array(z.strictObject({ questionId: z.string().min(1).max(120), contentId: z.string().min(1).max(120), contentVersion: z.string().min(1).max(40) })).min(1).max(50),
  /** Explicit approved send times; the core computes no frequency. */
  slots: z.array(z.number().int().nonnegative()).min(1).max(500),
  quietHours: z.strictObject({ startMinute: z.number().int().min(0).max(1439), endMinute: z.number().int().min(0).max(1439), utcOffsetMinutes: z.number().int().min(-840).max(840) }),
  maxPromptsPerQuestion: z.number().int().min(1).max(500),
});
const scheduleKey = (memberId: MemberId, scheduleId: string) => JSON.stringify([memberId, scheduleId]);
const activeEpisode = (state: CoreState, memberId: MemberId) => [...state.conversations.values()].some(c => c.memberId === memberId && c.urgentEpisodeId);

/** Instance keys contain no channel, so the same plan requested from any entry point creates each prompt once. */
export function planProactive(state: CoreState, ctx: CoreContext, memberId: MemberId, input: unknown):
  { ok: true; created: ProactiveInstanceId[] } | { ok: false; code: "invalid_schedule" | "schedule_superseded" | "schedule_conflict" | "urgent_episode_active" } {
  const parsed = proactiveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid_schedule" };
  const schedule = parsed.data;
  // Every slot applies to every question; a schedule exceeding its own repeat limit is inconsistent, not trimmed.
  if (new Set(schedule.slots).size !== schedule.slots.length || schedule.slots.length > schedule.maxPromptsPerQuestion
    || new Set(schedule.questions.map(q => q.questionId)).size !== schedule.questions.length) return { ok: false, code: "invalid_schedule" };
  if (activeEpisode(state, memberId)) return { ok: false, code: "urgent_episode_active" };
  const key = scheduleKey(memberId, schedule.scheduleId);
  const active = state.activeSchedules.get(key);
  if (active !== undefined && active > schedule.version) return { ok: false, code: "schedule_superseded" };
  // The parsed schema fixes field order. Hash the complete approved input, not
  // only the subset retained for claim checks; a version cannot change content.
  const fingerprint = canonicalHash("noreon.proactive-schedule", 1, [JSON.stringify(schedule)]);
  const versionKey = JSON.stringify([memberId, schedule.scheduleId, schedule.version]);
  const existing = state.schedules.get(versionKey);
  if (existing && existing.fingerprint !== fingerprint) return { ok: false, code: "schedule_conflict" };
  if (active !== undefined && active < schedule.version)
    for (const instance of state.proactive.values())
      if (instance.memberId === memberId && instance.scheduleId === schedule.scheduleId && instance.scheduleVersion < schedule.version && instance.state === "pending") instance.state = "superseded";
  state.activeSchedules.set(key, schedule.version);
  const { scheduleId, version, planVersion, approvedBy, quietHours } = schedule;
  state.schedules.set(versionKey, { scheduleId, version, planVersion, approvedBy, quietHours, fingerprint });

  const created: ProactiveInstanceId[] = [];
  for (const question of schedule.questions)
    for (const slotAt of [...schedule.slots].sort((a, b) => a - b)) {
      const instanceKey = JSON.stringify([memberId, schedule.scheduleId, schedule.version, question.questionId, slotAt]);
      if (state.proactiveKeys.has(instanceKey)) continue;
      const id = ctx.newId("proactive") as ProactiveInstanceId;
      state.proactive.set(id, {
        id, key: instanceKey, memberId, scheduleId: schedule.scheduleId, scheduleVersion: schedule.version, planVersion: schedule.planVersion,
        questionId: question.questionId, contentId: question.contentId, contentVersion: question.contentVersion, slotAt, state: "pending",
      });
      state.proactiveKeys.set(instanceKey, id);
      created.push(id);
    }
  audit(state, ctx, "proactive.plan", "recorded", { scheduleId: schedule.scheduleId, version: schedule.version, created: created.length });
  return { ok: true, created };
}

/** An answer stops the remaining prompts for that question. Returns how many pending prompts were stopped. */
export function answerProactive(state: CoreState, ctx: CoreContext, memberId: MemberId, questionId: string): number {
  let count = 0;
  for (const instance of state.proactive.values())
    if (instance.memberId === memberId && instance.questionId === questionId && instance.state === "pending") { instance.state = "answered"; count++; }
  audit(state, ctx, "proactive.answer", "recorded", { questionId, stopped: count });
  return count;
}

const inQuietHours = (at: number, quiet: ApprovedSchedule["quietHours"]) => {
  const minute = (((Math.floor(at / 60_000) + quiet.utcOffsetMinutes) % 1440) + 1440) % 1440;
  return quiet.startMinute <= quiet.endMinute ? minute >= quiet.startMinute && minute < quiet.endMinute : minute >= quiet.startMinute || minute < quiet.endMinute;
};

/** Sender-side recheck before a prompt may be handed to any channel. */
export function claimProactive(state: CoreState, ctx: CoreContext, instanceId: ProactiveInstanceId):
  { ok: true } | { ok: false; code: "not_found" | "not_pending" | "not_due" | "quiet_hours" | "schedule_superseded" | "urgent_episode_active" } {
  const instance = state.proactive.get(instanceId);
  if (!instance) return { ok: false, code: "not_found" };
  if (instance.state !== "pending") return { ok: false, code: "not_pending" };
  if (activeEpisode(state, instance.memberId)) { instance.state = "cancelled_urgent"; return { ok: false, code: "urgent_episode_active" }; }
  if (state.activeSchedules.get(scheduleKey(instance.memberId, instance.scheduleId)) !== instance.scheduleVersion) { instance.state = "superseded"; return { ok: false, code: "schedule_superseded" }; }
  if (ctx.now() < instance.slotAt) return { ok: false, code: "not_due" };
  const schedule = state.schedules.get(JSON.stringify([instance.memberId, instance.scheduleId, instance.scheduleVersion]));
  if (!schedule) return { ok: false, code: "schedule_superseded" };
  if (inQuietHours(ctx.now(), schedule.quietHours)) return { ok: false, code: "quiet_hours" };
  instance.state = "claimed";
  audit(state, ctx, "proactive.claim", "allowed", { instanceId, questionId: instance.questionId });
  return { ok: true };
}
