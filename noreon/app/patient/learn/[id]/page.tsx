import {LessonContent} from "@/components/lessons/lesson-content";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PatientShell } from "@/components/patient/patient-shell";
import { CareLink, copy } from "@/components/patient-care/common";
import { requireRegisteredForRender } from "@/lib/patient/render-data";
import { findLesson, lessonsShowDrafts } from "@/lib/lessons/catalogue";
import { readLessonProgress } from "@/lib/lessons/server";


export const metadata: Metadata = { title: "Noreon · Lesson" };
export const dynamic = "force-dynamic";

export default async function LessonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { profile } = await requireRegisteredForRender();
  const lesson = findLesson(id, lessonsShowDrafts());
  if (!lesson) notFound();
  const l = profile.locale;
  const progress = await readLessonProgress();
  const done = !!progress?.done.some((d) => d.lessonId === lesson.id);
  return (
    <PatientShell locale={l}>
      <CareLink href="/patient/learn" icon={ArrowLeft}>{copy(l, "All lessons", "Բոլոր դասերը", "Все уроки")}</CareLink>
      <LessonContent lesson={lesson} locale={l} done={progress?done:null}/>
    </PatientShell>
  );
}
