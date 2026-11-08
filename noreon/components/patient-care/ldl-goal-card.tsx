import {memberInstruction} from '@/lib/text-language';
import {memberStaffName} from "@/lib/member-staff-name.mjs";
import { Target } from "lucide-react";
import type { PatientLocale } from "@/lib/patient/copy";
import type { MemberLdl } from "@/lib/ldl/schema";
import { armeniaDate } from "@/lib/patient-care/model";
import { assessLdl, formatMmol, formatPercent, ldlOnePartMet, ldlReductionShown } from "@/lib/ldl/status";
import { CareLink, IconTile, Status, copy, stamp } from "./common";
import { LdlVisitAccept } from "./ldl-visit-accept";

/**
 * The member's LDL goal (dark: ldl_goal_settings). Nothing unless the doctor has started the LDL record; then
 * "your doctor is setting your goal", with no number, until the doctor sets it. The status comes from
 * lib/ldl/status.ts; this card only words it. Clinical wording pending Armen/Yesayi and Tatevik (hy).
 */
export function LdlGoalCard({ data, locale: l, compact = false, embedded = false, prototype = false }: { data: MemberLdl | undefined; locale: PatientLocale; compact?: boolean; /** Inside Zoe's card, which has the title and the frame: the body only. */ embedded?: boolean; prototype?: boolean }) {
  if (!data || !data.enabled || !data.inPathway) return null;
  const day = (d: string) => stamp(`${d}T12:00:00+04:00`, l, false);
  const unit = copy(l, "mmol/L", "մմոլ/լ", "ммоль/л");
  const title = copy(l, "Your LDL cholesterol goal", "Ձեր ՑԽԼ խոլեստերինի նպատակը", "Ваша цель по холестерину ЛПНП");
  const goal = data.goal;
  const doctorName = memberStaffName(goal?.doctorName);
  const setBy = goal && <p className="mt-1 text-caption text-muted-foreground">
    {doctorName ? copy(l, `Set by ${doctorName}, ${stamp(goal.setAt, l, false)}`, `Սահմանել է՝ ${doctorName}, ${stamp(goal.setAt, l, false)}`, `Установлено: ${doctorName}, ${stamp(goal.setAt, l, false)}`)
      : copy(l, `Set by your doctor, ${stamp(goal.setAt, l, false)}`, `Սահմանել է ձեր բժիշկը, ${stamp(goal.setAt, l, false)}`, `Установлено вашим врачом, ${stamp(goal.setAt, l, false)}`)}
  </p>;
  const body = <>
      {data.withDoctor && <WithDoctor doctorName={data.withDoctor.doctorName} l={l} />}
      {!goal ? (
        <div className="space-y-1">
          <p className="text-body1 font-semibold">{copy(l, "Your doctor is setting your goal", "Ձեր բժիշկը սահմանում է ձեր նպատակը", "Ваш врач устанавливает вашу цель")}</p>
          <p className="text-body2 text-muted-foreground">{copy(l, "Your goal will show here once your doctor has set it.", "Նպատակը կհայտնվի այստեղ, երբ ձեր բժիշկը սահմանի այն։", "Цель появится здесь, когда ваш врач её установит.")}</p>
          {data.retest && <NextTest retest={data.retest} l={l} day={day} />}
        </div>
      ) : <GoalBody data={data} goal={goal} l={l} unit={unit} day={day} compact={compact} prototype={prototype} />}
  </>;
  if (embedded) return <div className="space-y-3" data-ldl-goal>{setBy}{body}</div>;
  return (
    <section aria-labelledby="ldl-goal-title" className="journey-card space-y-3 rounded-2xl border border-border/70 bg-card p-5 shadow-sm sm:p-6" data-ldl-goal>
      <header className="flex items-start gap-3">
        <IconTile icon={Target} />
        <div className="min-w-0">
          <h2 id="ldl-goal-title" className="text-h2">{title}</h2>
          {setBy}
        </div>
      </header>
      {body}
    </section>
  );
}

type On = Extract<MemberLdl, { inPathway: true }>;
function GoalBody({ data, goal, l, unit, day, compact, prototype }: { data: On; goal: NonNullable<On["goal"]>; l: PatientLocale; unit: string; day: (d: string) => string; compact: boolean; prototype: boolean }) {
  const a = assessLdl({ goal, observations: prototype
    ? data.observations.filter(row => row.memberVisible && row.on <= armeniaDate(new Date()))
    : data.observations });
  const threshold = formatMmol(goal.thresholdMmol);
  const latest = a.latest;
  const pct = a.reduction.state === "met" || a.reduction.state === "not_met" ? a.reduction : null;
  return (
    <div className={prototype ? "ms-ldl-facts" : "space-y-3"} data-ldl-facts={prototype || undefined}>
      <p className={prototype ? "ms-ldl-target text-body1" : "text-body1"}>
        {copy(l, `Your goal: below ${threshold} ${unit}`, `Ձեր նպատակը՝ ${threshold} ${unit}-ից ցածր`, `Ваша цель: ниже ${threshold} ${unit}`)}
        {ldlReductionShown(goal, a) && <span className="block text-body2 text-muted-foreground">
          {copy(l, `and at least ${goal.reductionPct}% lower than before treatment`, `և բուժումից առաջվա մակարդակից առնվազն ${goal.reductionPct}%-ով ցածր`, `и как минимум на ${goal.reductionPct}% ниже, чем до лечения`)}
        </span>}
      </p>
      {(!prototype && a.status === "not_assessable") || !latest ? (
        <div className="space-y-1">
          <Status>{copy(l, "No result to compare yet", "Համեմատելու արդյունք դեռ չկա", "Пока нет результата для сравнения")}</Status>
          <p className="text-body2 text-muted-foreground">{copy(l, "An LDL blood test will show how close you are to your goal.", "ՑԽԼ խոլեստերինի արյան անալիզը ցույց կտա, թե որքան մոտ եք ձեր նպատակին։", "Анализ крови на ЛПНП покажет, насколько вы близки к цели.")}</p>
        </div>
      ) : (
        <div className={prototype ? "ms-ldl-latest space-y-2" : "space-y-2"}>
          <p className="text-body1">
            <span className="text-h2 font-semibold">{formatMmol(latest.mmol, goal.thresholdMmol)}</span> {unit}
            <span className="block text-caption text-muted-foreground">{copy(l, `Latest result, ${day(latest.on)}`, `Վերջին արդյունքը, ${day(latest.on)}`, `Последний результат, ${day(latest.on)}`)}</span>
          </p>
          {!prototype && (ldlOnePartMet(a) ? <>
            <Status tone="attention">{copy(l, "One part of your goal is met", "Ձեր նպատակի մի մասը կատարված է", "Одна часть цели выполнена")}</Status>
            <p className="text-body2">{copy(l, `Your latest result is below ${threshold} ${unit}. The drop since before treatment is not there yet. Your care team uses it to plan the next step with you.`, `Ձեր վերջին արդյունքը ${threshold} ${unit}-ից ցածր է։ Բուժումից առաջվա համեմատ նվազումը դեռ բավարար չէ։ Ձեր բուժթիմը դրա հիման վրա ձեզ հետ կպլանավորի հաջորդ քայլը։`, `Ваш последний результат ниже ${threshold} ${unit}. Снижения по сравнению с уровнем до лечения пока недостаточно. Ваша команда учтёт это при планировании следующего шага.`)}</p>
          </> : a.status === "at_goal" ? <>
            <Status tone="complete">{copy(l, "Below your goal", "Ձեր նպատակից ցածր է", "Ниже вашей цели")}</Status>
            <p className="text-body2">{copy(l, "Your latest result is below your goal.", "Ձեր վերջին արդյունքը նպատակից ցածր է։", "Ваш последний результат ниже цели.")}</p>
          </> : <>
            <Status tone="attention">{copy(l, "Above your goal", "Ձեր նպատակից բարձր է", "Выше вашей цели")}</Status>
            <p className="text-body2">{copy(l, "Your latest result is above your goal. Your care team uses it to plan the next step with you.", "Ձեր վերջին արդյունքը նպատակից բարձր է։ Ձեր բուժթիմը դրա հիման վրա ձեզ հետ կպլանավորի հաջորդ քայլը։", "Ваш последний результат выше цели. Ваша команда по уходу использует его, чтобы спланировать с вами следующий шаг.")}</p>
          </>)}
          {pct && pct.percent > 0 && <p className="text-body2 text-muted-foreground">
            {copy(l, `${formatPercent(pct.percent, pct.requiredPct)}% lower than before treatment`, `Բուժումից առաջվանից ${formatPercent(pct.percent, pct.requiredPct)}%-ով ցածր`, `На ${formatPercent(pct.percent, pct.requiredPct)}% ниже, чем до лечения`)}
          </p>}
        </div>
      )}
      {prototype && goal.baseline.kind === "unknown" && <p className="text-body2 text-muted-foreground">
        {copy(l, "Your before-treatment baseline is not recorded. A reduction cannot be shown yet.", "Բուժումից առաջվա ելակետը գրանցված չէ։ Նվազումը դեռ հնարավոր չէ ցույց տալ։", "Исходный уровень до лечения не записан. Снижение пока нельзя показать.")}
      </p>}
      {prototype && goal.baseline.kind === "on_treatment" && <p className="text-body2 text-muted-foreground">
        {copy(l, "Your recorded baseline was measured during treatment. A before-treatment reduction cannot be shown.", "Գրանցված ելակետը չափվել է բուժման ընթացքում։ Բուժումից առաջվա համեմատ նվազումը հնարավոր չէ ցույց տալ։", "Записанный исходный уровень измерен во время лечения. Снижение относительно уровня до лечения показать нельзя.")}
      </p>}
      {data.retest ? <NextTest retest={data.retest} l={l} day={day} />
        : goal.nextTestOn && <p className="text-body2">{copy(l, `Next LDL test: ${day(goal.nextTestOn)}`, `Հաջորդ ՑԽԼ անալիզը՝ ${day(goal.nextTestOn)}`, `Следующий анализ на ЛПНП: ${day(goal.nextTestOn)}`)}</p>}
      {!compact && a.newest && a.newest !== latest && !a.newest.counts && <p className="text-caption text-muted-foreground">
        {copy(l, "Values you add yourself show in your charts. Your goal is compared with results from the clinic or checked by your doctor.", "Ձեր ավելացրած արժեքները երևում են գրաֆիկներում։ Նպատակի հետ համեմատվում են կլինիկայի կամ ձեր բժշկի ստուգած արդյունքները։", "Добавленные вами значения видны на графиках. С целью сравниваются результаты из клиники или проверенные вашим врачом.")}
      </p>}
      {compact && <CareLink href="/patient/progress">{copy(l, "See my progress", "Տեսնել իմ առաջընթացը", "Посмотреть мой прогресс")}</CareLink>}
    </div>
  );
}

/** Phase 2: a new result is with the doctor. Fixed text, no value (the doctor releases the value). Pending Armen/Yesayi and Tatevik. */
function WithDoctor({ doctorName: rawDoctorName, l }: { doctorName: string | null; l: PatientLocale }) {
  const doctorName = memberStaffName(rawDoctorName);
  return (
    <div className="space-y-1 rounded-xl border border-border/70 p-3" data-ldl-with-doctor>
      <Status>{copy(l, "With your doctor", "Ձեր բժշկի մոտ է", "У вашего врача")}</Status>
      <p className="text-body2">{doctorName
        ? copy(l, `Your new cholesterol result is with ${doctorName}. They will tell you the next step.`, `Ձեր խոլեստերինի նոր արդյունքը ձեր բժշկի մոտ է (${doctorName})։ Բժիշկը ձեզ կտեղեկացնի հաջորդ քայլի մասին։`, `Ваш новый результат по холестерину у вашего врача (${doctorName}). Врач сообщит вам следующий шаг.`)
        : copy(l, "Your new cholesterol result is with your doctor. They will tell you the next step.", "Ձեր խոլեստերինի նոր արդյունքը ձեր բժշկի մոտ է։ Բժիշկը ձեզ կտեղեկացնի հաջորդ քայլի մասին։", "Ваш новый результат по холестерину у вашего врача. Врач сообщит вам следующий шаг.")}</p>
    </div>
  );
}

/** Phase 2: the re-test window the doctor booked after a change to treatment, or that it is overdue. */
function NextTest({ retest, l, day }: { retest: NonNullable<On["retest"]>; l: PatientLocale; day: (d: string) => string }) {
  const q = retest.request;
  // A visit the admin arranged: the proposal to accept, or the confirmed time.
  if (q?.status === "provider-proposed" && q.proposal) return (
    <div className="space-y-2" data-ldl-retest="proposed">
      <p className="text-body2 font-semibold">{copy(l, "A nurse visit for your blood test is proposed", "Ձեր արյան անալիզի համար առաջարկվում է բուժքրոջ այց", "Вам предложен визит медсестры для анализа крови")}</p>
      <p className="text-body2">{stamp(q.proposal.startsAt, l)} · {q.proposal.provider}</p>
      <p className="text-body2 text-muted-foreground">{memberInstruction(q.proposal.preparation,l)}</p>
      <LdlVisitAccept request={q} locale={l} label={copy(l, "Accept this visit", "Ընդունել այս այցը", "Принять этот визит")} />
    </div>
  );
  if (q?.arrangement && (q.status === "confirmed" || q.status === "change-pending")) return (
    <div className="space-y-1" data-ldl-retest="confirmed">
      <p className="text-body2 font-semibold">{copy(l, `Your blood test visit: ${stamp(q.arrangement.startsAt, l)}`, `Ձեր արյան անալիզի այցը՝ ${stamp(q.arrangement.startsAt, l)}`, `Ваш визит для анализа крови: ${stamp(q.arrangement.startsAt, l)}`)}</p>
      <p className="text-body2 text-muted-foreground">{memberInstruction(q.arrangement.preparation,l)}</p>
    </div>
  );
  if (retest.overdue) return (
    <div className="space-y-1" data-ldl-retest="overdue">
      <Status tone="attention">{copy(l, "Blood test due", "Արյան անալիզի ժամկետն է", "Пора сдать анализ крови")}</Status>
      <p className="text-body2">{copy(l, "Your cholesterol blood test is still to do. Our team will call you to find a time.", "Ձեր խոլեստերինի արյան անալիզը դեռ հանձնված չէ։ Մեր թիմը կզանգի ձեզ՝ հարմար ժամ գտնելու համար։", "Анализ крови на холестерин ещё не сдан. Наша команда позвонит вам, чтобы выбрать время.")}</p>
    </div>
  );
  return (
    <p className="text-body2" data-ldl-retest="window">
      {copy(l, `Next LDL test: between ${day(retest.dueFrom)} and ${day(retest.dueTo)}`, `Հաջորդ ՑԽԼ անալիզը՝ ${day(retest.dueFrom)}-ից ${day(retest.dueTo)} ընկած ժամանակահատվածում`, `Следующий анализ на ЛПНП: с ${day(retest.dueFrom)} по ${day(retest.dueTo)}`)}
      <span className="block text-caption text-muted-foreground">{copy(l, "A nurse can take the blood sample at home. Our team will call you to arrange it.", "Բուժքույրը կարող է արյան նմուշը վերցնել տանը։ Մեր թիմը կզանգի ձեզ՝ այն կազմակերպելու համար։", "Медсестра может взять кровь на дому. Наша команда позвонит вам, чтобы договориться.")}</span>
    </p>
  );
}
