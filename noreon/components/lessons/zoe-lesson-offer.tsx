import type { PatientLocale } from "@/lib/patient/copy";
import { clinicalLocale } from "@/lib/locale";
import type { ZoeThread } from "@/lib/zoe/app-chat-contracts";
import { lessonLocale } from "@/lib/lessons/catalogue";
import { lessonOfferForToday } from "@/lib/lessons/server";
import { LessonOfferCard } from "./lesson-controls";

/**
 * The lesson hook on Zoe's screen: at most one offer a day, matched on the member's own recent
 * messages (never Zoe's or a doctor's words) and their care plan. Rendered in a Suspense boundary
 * so the chat never waits for it; no model is called.
 */
export async function ZoeLessonOffer({ thread, locale }: { thread: ZoeThread; locale: PatientLocale }) {
  const offer = await lessonOfferForToday(thread.messages);
  if (!offer) return null;
  return <LessonOfferCard lessonId={offer.lesson.id} title={offer.lesson.title[lessonLocale(clinicalLocale(locale))]} draft={offer.draft} locale={locale} />;
}
