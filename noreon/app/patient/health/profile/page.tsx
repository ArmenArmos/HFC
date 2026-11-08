import Link from "next/link";
import { requireRegistered } from "@/lib/patient/repository";
import { PatientShell } from "@/components/patient/patient-shell";
import { ProfileSummary } from "@/components/patient/profile-summary";
import { CareLink, copy } from "@/components/patient-care/common";
import { readMemberSafety } from "@/lib/member-safety/member";
import { exerciseGuidance } from "@/lib/member-safety/contract";
export default async function HealthProfile() {
  const { profile, assessment } = await requireRegistered(),
    l = profile.locale;
  const safety = await readMemberSafety();
  const completed = !!assessment.completedAt;
  const nextAction = (
    <div className="space-y-3 rounded-2xl border bg-card p-6">
      <p className="text-body2 text-muted-foreground">
        {completed
          ? copy(l, "Your answers are saved.", "Ձեր պատասխանները պահպանված են։", "Ваши ответы сохранены.")
          : copy(l, "Continue your questionnaire to complete your summary.", "Շարունակեք հարցաշարը՝ ամփոփումն ավարտելու համար։", "Продолжите заполнение анкеты, чтобы завершить сводку.")}
      </p>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <Link href={completed ? "/patient/dashboard" : "/patient/questions"} className="inline-flex min-h-12 items-center justify-center rounded-md bg-primary px-5 py-3 text-body2 font-medium text-primary-foreground">
          {completed
            ? copy(l, "Go to Today", "Անցնել «Այսօր» էջին", "Перейти в раздел «Сегодня»")
            : copy(l, "Continue questionnaire", "Շարունակել հարցաշարը", "Продолжить анкету")}
        </Link>
        {completed && <CareLink href="/patient/questions">
          {copy(l, "Review answers", "Վերանայել պատասխանները", "Просмотреть ответы")}
        </CareLink>}
      </div>
    </div>
  );
  return (
    <PatientShell locale={l}>
      <div className="space-y-6">
        <h1 className="text-h1">
          {copy(l, "Your health summary", "Ձեր առողջության ամփոփումը", "Ваша сводка о здоровье")}
        </h1>
        {Object.keys(assessment.answers).length > 0 ? (
          <ProfileSummary
            answers={assessment.answers}
            locale={l}
            nextAction={nextAction}
            exercise={exerciseGuidance(safety)}
          />
        ) : nextAction}
      </div>
    </PatientShell>
  );
}
