import {copy} from "@/components/patient-care/common";
import {LessonBody,draftNotice} from "./lesson-body";
import {DraftBadge,LessonDoneButton} from "./lesson-controls";
import type {Lesson} from "@/lib/lessons/content";
import type {PatientLocale} from "@/lib/patient/copy";
import type {markLessonDone} from "@/app/patient/learn/actions";
/** Shared fixed lesson. Editorial markers are reserved for explicit staff preview; safety guidance and sources always remain. */
export function LessonContent({lesson,locale:l,done,saveAction,staffPreview=false}:{embedded?:boolean;staffPreview?:boolean;lesson:Lesson;locale:PatientLocale;done:boolean|null;saveAction?:typeof markLessonDone}) {
  const ll=l;
  return (
      <article className="space-y-5" data-lesson={lesson.id} lang={ll}>
        <header className="space-y-2">
          <p className="text-caption text-muted-foreground">{copy(l, "One-minute lesson", "Մեկ րոպեանոց դաս", "Урок за одну минуту")}{staffPreview && lesson.status === "draft" && <> · <DraftBadge locale={l} /></>}</p>
          <h1 className="text-h1">{lesson.title[ll]}</h1>
        </header>
        {staffPreview && lesson.status === "draft" && <p className="rounded-lg bg-[var(--status-warning-bg)] p-3 text-body2">{draftNotice(l)}</p>}
        <LessonBody lines={lesson.body[ll]} />
        <p className="max-w-2xl text-body2 text-muted-foreground">
          {copy(l, "General information, not advice for you personally. Do not change your medicines because of a lesson: your doctor's plan comes first. For urgent symptoms, call 103.",
            "Սա ընդհանուր տեղեկություն է, ոչ անհատական խորհուրդ։ Դասի պատճառով մի փոխեք ձեր դեղերը. առաջնայինը ձեր բժշկի պլանն է։ Շտապ ախտանիշների դեպքում զանգահարեք 103։", "Это общая информация, а не индивидуальная рекомендация. Не меняйте лекарства на основании урока: следуйте плану вашего врача. При неотложных симптомах позвоните 103.")}
        </p>
        {done!==null && <LessonDoneButton lessonId={lesson.id} done={done} locale={l} saveAction={saveAction} />}
        <details className="max-w-2xl rounded-xl border px-4 py-3">
          <summary className="min-h-11 cursor-pointer content-center text-body2 font-semibold">{copy(l, "Sources", "Աղբյուրներ", "Источники")}</summary>
          <ul className="mt-2 space-y-2 text-caption">
            {lesson.sources.map((s) => <li key={s.url}><a href={s.url} target="_blank" rel="noreferrer" className="break-words underline underline-offset-4">{s.label}</a></li>)}
          </ul>
        </details>
      </article>
  );
}
