import { redirect } from "next/navigation";
import { memberChatOnlyEnabled } from "@/lib/patient/member-chat-config";
import { requireRegistered } from "@/lib/patient/repository";
import { PatientShell } from "@/components/patient/patient-shell";
import { Questionnaire } from "@/components/patient/questionnaire";
import { tx } from "@/lib/patient/copy";
import { QuestionnaireIntro } from "@/components/patient/questionnaire-intro";
import { QuestionnaireAnswers } from "@/components/patient/questionnaire-answers";
export default async function Questions({ searchParams }: { searchParams: Promise<{ changed?: string; start?: string; edit?: string; view?: string }> }) {
  const { profile, assessment } = await requireRegistered();
  const { changed, start, edit, view } = await searchParams;
  if (memberChatOnlyEnabled() && view !== "classic") redirect("/patient/zoe?card=questionnaire");
  // The intro shows once, before the first answer: the profile (q1) is filled at sign-up, so any
  // other saved answer means the member has started and goes straight back to their question.
  const notStarted = !assessment.completedAt && !Object.keys(assessment.answers).some((id) => !id.startsWith("q1."));
  if (notStarted && start !== "1")
    return (
      <PatientShell locale={profile.locale} navigation={false} emergency>
        <QuestionnaireIntro locale={profile.locale} />
      </PatientShell>
    );
  // A completed questionnaire opens as a read-only summary (QA 175). Changing answers stays
  // allowed after completion (the save path accepts it); the edit link opens the form at the start.
  const editing = edit === "1" || changed === "1";
  if (assessment.completedAt && !editing)
    return (
      <PatientShell locale={profile.locale}>
        <QuestionnaireAnswers answers={assessment.answers} locale={profile.locale} />
      </PatientShell>
    );
  return (
    <PatientShell locale={profile.locale} navigation={false} emergency>
      {changed === "1" && (
        <p role="status" className="mx-auto mb-4 max-w-lg rounded-md border bg-card p-3 text-body2">
          {tx(profile.locale, "Ձեր փոփոխությունը պահպանվել է։ Noreon-ի խնամքի թիմը տեղեկանում է դրա մասին։", "Your change was saved. The Noreon care team is told about it.", "Ваше изменение сохранено. Медицинская команда Noreon получит уведомление.")}
        </p>
      )}
      <Questionnaire key={assessment.id} initial={assessment} locale={profile.locale} startAtFirst={edit === "1"} />
    </PatientShell>
  );
}
