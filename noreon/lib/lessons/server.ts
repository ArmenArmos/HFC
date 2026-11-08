import "server-only";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { LESSON_ID, currentPlanMedicineNames, findLesson, lessonsShowDrafts, pickLesson, recentMemberTexts, visibleLessons } from "./catalogue";
import type { Lesson } from "./content";

type Rpc = { rpc(name: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { code?: string } | null }> };
const rpcClient = async () => (await createClient()) as unknown as Rpc;

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const readSchema = z.strictObject({
  version: z.literal("member-lessons-v1"),
  today: day,
  done: z.array(z.strictObject({ lessonId: z.string(), doneAt: z.string() })),
  offers: z.array(z.strictObject({ lessonId: z.string(), day, dismissedAt: z.string().nullable() })),
});
export type LessonProgress = z.infer<typeof readSchema>;
const offerSchema = z.union([
  z.strictObject({ status: z.enum(["offered", "already"]), lessonId: z.string(), dismissed: z.boolean() }),
  z.strictObject({ status: z.literal("invalid") }),
]);

/** The member's done lessons and recent offers. Null when unreadable: pages still show the lessons. */
export async function readLessonProgress(): Promise<LessonProgress | null> {
  try {
    const { data, error } = await (await rpcClient()).rpc("member_lessons_read");
    if (error) return null;
    const parsed = readSchema.safeParse(data);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function setLessonDone(lessonId: string, done: boolean): Promise<boolean> {
  if (!LESSON_ID.test(lessonId) || !findLesson(lessonId, lessonsShowDrafts())) return false;
  const { data, error } = await (await rpcClient()).rpc("member_lesson_done_set", { p_lesson: lessonId, p_done: done });
  return !error && (data as { status?: string } | null)?.status === "saved";
}

/** "Not now" on today's offer. True only once the database has it, so the card stays until then. */
export async function dismissLessonOffer(): Promise<boolean> {
  const { data, error } = await (await rpcClient()).rpc("member_lesson_offer_dismiss");
  const status = (data as { status?: string } | null)?.status;
  return !error && (status === "dismissed" || status === "none");
}

/**
 * The current published care plan's words Zoe may match on: its instructions and the active
 * medicines of that plan (its own and those carried forward to it, as getCareData resolves them).
 * Medicines kept from replaced plans never count.
 */
async function planWords(): Promise<string[]> {
  const client = await createClient();
  const plan = await client.from("patient_care_plans").select("id,instructions").eq("active", true).lte("published_at", new Date().toISOString()).maybeSingle();
  if (plan.error || !plan.data) return [];
  const [meds, links] = await Promise.all([
    client.from("patient_care_medications").select("id,plan_id,name,active"),
    client.from("patient_care_plan_medications").select("plan_id,medication_id").eq("plan_id", plan.data.id),
  ]);
  if (meds.error || links.error) return [plan.data.instructions].filter(Boolean);
  return [plan.data.instructions, ...currentPlanMedicineNames(plan.data.id, meds.data ?? [], links.data ?? [])].filter(Boolean);
}

export type LessonOffer = { lesson: Lesson; draft: boolean };

/**
 * Zoe's lesson offer for today, at most one a day (the database holds the day). Today's offer is
 * shown again until the member marks it done or says "Not now". With none yet, the member's own
 * recent messages and their care plan pick one (lib/lessons/catalogue.ts pickLesson)
 * and it is claimed. Any failure means no offer: the chat never waits on or breaks for a lesson.
 */
export async function lessonOfferForToday(memberMessages: readonly { text: string; at: string }[]): Promise<LessonOffer | null> {
  try {
    const showDrafts = lessonsShowDrafts();
    const lessons = visibleLessons(showDrafts);
    if (lessons.length === 0) return null;
    const progress = await readLessonProgress();
    if (!progress) return null;
    const done = new Set(progress.done.map((d) => d.lessonId));
    const today = progress.offers.find((o) => o.day === progress.today);
    const show = (id: string, dismissed: boolean) => {
      const lesson = !dismissed && !done.has(id) ? findLesson(id, showDrafts) : null;
      return lesson ? { lesson, draft: lesson.status === "draft" } : null;
    };
    if (today) return show(today.lessonId, today.dismissedAt !== null);
    const lesson = pickLesson({
      messages: recentMemberTexts(memberMessages, Date.now()),
      plan: await planWords().catch(() => []),
      done,
      offered: new Set(progress.offers.map((o) => o.lessonId)),
      lessons,
    });
    if (!lesson) return null;
    const { data, error } = await (await rpcClient()).rpc("member_lesson_offer", { p_lesson: lesson.id });
    const claimed = offerSchema.safeParse(data);
    if (error || !claimed.success || claimed.data.status === "invalid") return null;
    return show(claimed.data.lessonId, claimed.data.dismissed);
  } catch {
    return null;
  }
}
