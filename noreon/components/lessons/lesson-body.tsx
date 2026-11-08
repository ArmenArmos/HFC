import type { ReactNode } from "react";
import type { PatientLocale } from "@/lib/patient/copy";
import { copy } from "@/components/patient-care/common";

/** Paragraphs, with runs of "- " lines as one list. Lesson text is fixed content, never model output. */
export function LessonBody({ lines }: { lines: readonly string[] }) {
  const out: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) out.push(<ul key={`l${out.length}`} className="list-disc space-y-1.5 pl-5">{list.map((item, i) => <li key={i}>{item}</li>)}</ul>);
    list = [];
  };
  for (const line of lines) {
    if (line.startsWith("- ")) { list.push(line.slice(2)); continue; }
    flush();
    out.push(<p key={`p${out.length}`}>{line}</p>);
  }
  flush();
  return <div className="max-w-2xl space-y-3 text-body1" data-lesson-body>{out}</div>;
}

export const draftNotice = (l: PatientLocale) => copy(l,
  "Staging: drafts are shown for clinical review. Members see a lesson only after a Noreon doctor approves it.",
  "Փորձնական միջավայր. սևագրերը ցույց են տրվում կլինիկական ստուգման համար։ Անդամները դասը տեսնում են միայն Նորեոն Հելթի բժշկի հաստատումից հետո։", "Тестовая среда: черновики показаны для клинической проверки. Участники видят урок только после одобрения врача Нореон Хелс.");
