import {memberStaffName} from "@/lib/member-staff-name.mjs";
import Link from "next/link";
import { HeartHandshake, Stethoscope, Syringe } from "lucide-react";
import { requireRegistered } from "@/lib/patient/repository";
import { PatientShell } from "@/components/patient/patient-shell";
import { buttonVariants } from "@/components/ui/button";
import { tx } from "@/lib/patient/copy";
import { OnboardingSteps } from "@/components/patient/onboarding-steps";
import { readMemberCareTeam } from "@/lib/patient-care/care-team-repository";
import { readZoeConsents } from "@/lib/zoe/member";
import { realReviewEnabled } from "@/lib/patient-care/real-review-config";

/**
 * Sign-up step 6 (new): the care team. The doctor is named only when the database says who is
 * assigned (patient_care_team); a failed read names nobody and claims nothing. Roles follow the
 * existing Meet Zoe copy; no promise that a doctor reviews each answer or report (AGENTS.md).
 * Staging draft copy for Armen/Tatevik.
 */
export default async function ReadyTeam() {
  const { profile } = await requireRegistered();
  const l = profile.locale;
  const team = await readMemberCareTeam();
  const doctorName = memberStaffName(team?.doctor);
  let zoe: Awaited<ReturnType<typeof readZoeConsents>> = null;
  try { zoe = await readZoeConsents(); } catch { zoe = null; }
  // Fable #277 F3: null = no case yet (the case is made when the health questions are finished);
  // { doctor: null } = enrolled, no doctor free yet; undefined = the read failed: no claim.
  // With real review off nobody is enrolled or assigned, so no assignment is promised (Codex #277).
  const doctorState = team?.doctor ? "named" : team === undefined || !realReviewEnabled(process.env) ? "unknown" : team === null ? "after-questions" : "pending";
  return (
    <PatientShell locale={l} navigation={false}>
      <div className="mx-auto max-w-md space-y-5">
        <OnboardingSteps step={6} locale={l} />
        <header className="space-y-2">
          <h1 className="text-h1">{tx(l, "Ձեր խնամքի թիմը", "Meet your care team", "Ваша медицинская команда")}</h1>
          <p className="text-body1 text-muted-foreground">
            {tx(l, "Մարդիկ, ովքեր կօգնեն ձեզ այս ծրագրում։", "The people who will help you through the programme.", "Люди, которые помогут вам пройти программу.")}
          </p>
        </header>
        <section className="journey-card" aria-label={tx(l, "Ձեր բժիշկը", "Your doctor", "Ваш врач")} data-care-team-doctor={doctorState}>
          <div className="flex items-start gap-3">
            <span className="journey-avatar" aria-hidden><Stethoscope className="size-5" /></span>
            <div className="min-w-0 space-y-1">
              <p className="break-words text-body1 font-semibold">
                {doctorName ?? tx(l, "Ձեր բժիշկը", "Your doctor", "Ваш врач")}
                {doctorName && <span className="text-body2 font-normal text-muted-foreground"> · {tx(l, "ձեր բժիշկը", "your doctor", "ваш врач")}</span>}
              </p>
              <p className="text-body2 text-muted-foreground">
                {tx(l, "Դիտում է ձեր արդյունքները և որոշում ձեր խնամքի ծրագիրը։", "Looks at your results and decides your care plan.", "Рассматривает ваши результаты и определяет план лечения.")}
              </p>
              {doctorState === "after-questions" && (
                <p className="text-body2">{tx(l, "Ձեր բժիշկը կնշանակվի, երբ ավարտեք առողջության հարցերը։", "Your doctor is assigned once you finish the health questions.", "Вам назначат врача, когда вы заполните анкету о здоровье.")}</p>
              )}
              {doctorState === "pending" && (
                <p className="text-body2">{tx(l, "Ձեր բժիշկը շուտով կնշանակվի։", "Your doctor will be assigned shortly.", "Вам скоро назначат врача.")}</p>
              )}
            </div>
          </div>
        </section>
        <section className="journey-card" aria-label={tx(l, "Ձեր բուժքույրը", "Your nurse", "Ваша медсестра")}>
          <div className="flex items-start gap-3">
            <span className="journey-avatar" aria-hidden><Syringe className="size-5" /></span>
            <div className="min-w-0 space-y-1">
              <p className="text-body1 font-semibold">{tx(l, "Ձեր բուժքույրը", "Your nurse", "Ваша медсестра")}</p>
              <p className="text-body2 text-muted-foreground">
                {tx(l, "Վերցնում է ձեր նմուշները և օգնում գործնական հարցերում։", "Takes your samples and helps with practical things.", "Берёт образцы для анализов и помогает с практическими вопросами.")}
              </p>
            </div>
          </div>
        </section>
        <section className="journey-card" aria-labelledby="team-together-title">
          <div className="flex items-start gap-3">
            <span className="journey-avatar" aria-hidden><HeartHandshake className="size-5" /></span>
            <div className="min-w-0 space-y-1">
              <h2 id="team-together-title" className="text-body1 font-semibold">{tx(l, "Ինչպես ենք աշխատում միասին", "How we work together", "Как мы работаем вместе")}</h2>
              <p className="text-body2 text-muted-foreground">
                {tx(
                  l,
                  "Ձեր բժիշկը որոշում է ձեր խնամքի ծրագիրը։ Բուժքույրը օգնում է հետազոտություններում։",
                  "Your doctor decides your care plan. Your nurse helps with your tests.",
                  "Ваш врач определяет план лечения. Медсестра помогает вам с анализами.",
                )}
                {/* Gohar D-011: after "Continue without Zoe" the team is introduced without her. */}
                {zoe?.readsMessages === true &&
                  ` ${tx(l, "Զոյան բացատրում է հաջորդ քայլերը և ձեր հաղորդագրությունները փոխանցում թիմին։", "Zoe explains your next steps and passes your messages to the team.", "Зоя объясняет ваши следующие шаги и передаёт ваши сообщения медицинской команде.")}`}
              </p>
            </div>
          </div>
        </section>
        <p className="text-body2 text-muted-foreground">
          {tx(l, "Առողջության հարցերը հաջորդ քայլն են։ Կարող եք սկսել հիմա կամ վերադառնալ ավելի ուշ։", "Health questions are your next step. Start now or come back later.", "Ваш следующий шаг: анкета о здоровье. Начните сейчас или вернитесь позже.")}
        </p>
        <Link className={buttonVariants({ className: "h-12 w-full" })} href="/patient/questions">
          {tx(l, "Սկսել առողջության հարցերը", "Start health questions", "Начать анкету о здоровье")}
        </Link>
        <Link className={buttonVariants({ variant: "secondary", className: "h-12 w-full" })} href="/patient/dashboard">
          {tx(l, "Լրացնել ավելի ուշ", "Do this later", "Заполнить позже")}
        </Link>
      </div>
    </PatientShell>
  );
}
