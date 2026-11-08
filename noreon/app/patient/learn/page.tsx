import { clinicalLocale } from "@/lib/locale";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BookOpen, CheckCircle2 } from "lucide-react";
import { PatientShell } from "@/components/patient/patient-shell";
import { CareSection, IconTile, RowLink, copy } from "@/components/patient-care/common";
import { requireRegisteredForRender } from "@/lib/patient/render-data";
import { lessonLocale, lessonsShowDrafts, visibleLessons } from "@/lib/lessons/catalogue";
import { readLessonProgress } from "@/lib/lessons/server";
import type { LessonTopic } from "@/lib/lessons/content";

export const metadata: Metadata = { title: "Noreon · Lessons" };
export const dynamic = "force-dynamic";

const TOPICS: readonly [LessonTopic, string, string, string][] = [
  ["hypertension", "Blood pressure", "Զարկերակային ճնշում", "Артериальное давление"],
  ["home-bp", "Measuring at home", "Տնային չափումներ", "Измерения дома"],
  ["salt", "Salt", "Աղ", "Соль"],
  ["diabetes", "Type 2 diabetes", "2-րդ տիպի դիաբետ", "Диабет 2 типа"],
  ["low-sugar", "Low sugar", "Ցածր շաքար", "Низкая глюкоза"],
  ["high-sugar", "High sugar", "Բարձր շաքար", "Высокая глюкоза"],
  ["lipids", "Cholesterol", "Խոլեստերին", "Холестерин"],
  ["activity", "Moving more", "Շարժում", "Больше движения"],
  ["weight", "Weight and food", "Քաշ և սնունդ", "Вес и питание"],
  ["medicines", "Medicines", "Դեղեր", "Лекарства"],
  ["emergency", "Emergencies", "Շտապ դեպքեր", "Неотложные ситуации"],
];

/** Short lessons (Armen's item 6). Real members see approved lessons only; staging also shows drafts. */
export default async function LearnPage() {
  const { profile } = await requireRegisteredForRender();
  const l = profile.locale, ll = lessonLocale(clinicalLocale(l));
  const showDrafts = lessonsShowDrafts();
  const lessons = visibleLessons(showDrafts);
  if (lessons.length === 0) notFound();
  const progress = await readLessonProgress();
  const done = new Set(progress?.done.map((d) => d.lessonId) ?? []);
  const doneCount = lessons.filter((x) => done.has(x.id)).length;
  return (
    <PatientShell locale={l}>
      <div className="space-y-5" data-learn-page>
        <header className="flex items-start gap-3">
          <IconTile icon={BookOpen} />
          <div>
            <h1 className="text-h1">{copy(l, "One-minute lessons", "Մեկ րոպեանոց դասեր", "Уроки за одну минуту")}</h1>
            <p className="mt-1 text-body2 text-muted-foreground">
              {copy(l, "Short, plain reads about your heart, blood pressure, sugar and medicines. General information, not advice for you personally: your doctor's plan comes first.",
                "Կարճ և պարզ նյութեր ձեր սրտի, ճնշման, շաքարի և դեղերի մասին։ Ընդհանուր տեղեկություն է, ոչ անհատական խորհուրդ. առաջնայինը ձեր բժշկի պլանն է։", "Короткие и понятные материалы о вашем сердце, давлении, глюкозе и лекарствах. Это общая информация, а не индивидуальная рекомендация: следуйте плану вашего врача.")}
            </p>
            {progress && <p className="mt-2 text-caption text-muted-foreground" data-learn-progress>{copy(l, `${doneCount} of ${lessons.length} done`, `${doneCount}-ը ${lessons.length}-ից ավարտված է`, `Завершено ${doneCount} из ${lessons.length}`)}</p>}
          </div>
        </header>
        {TOPICS.map(([topic, en, hy, ru]) => {
          const inTopic = lessons.filter((x) => x.topic === topic);
          if (inTopic.length === 0) return null;
          return (
            <CareSection key={topic} title={copy(l, en, hy, ru)}>
              <div className="-mx-3 -my-2">
                {inTopic.map((x) => (
                  <RowLink key={x.id} href={`/patient/learn/${x.id}`} icon={done.has(x.id) ? CheckCircle2 : BookOpen}
                    detail={<>{copy(l, "1 minute", "1 րոպե", "1 минута")}{done.has(x.id) && <> · {copy(l, "Done", "Ավարտված", "Завершено")}</>}</>}>
                    {x.title[ll]}
                  </RowLink>
                ))}
              </div>
            </CareSection>
          );
        })}
      </div>
    </PatientShell>
  );
}
