"use client";
import {bpUnit} from '@/lib/bp-unit';
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock } from "lucide-react";
import type { ConfirmResult, DoctorCheckpoint, DoctorMember } from "@/lib/programme/schema";
import { REPEAT_TEST_RULES } from "@/lib/programme/repeat-tests";
import { formatMemberDate } from "@/lib/patient/date-format";

import { pick, type Locale } from "@/lib/locale";
type Ready = Extract<DoctorMember, { enabled: true }>;
const KIND = {
  week4_review: { en: "Week-4 review", hy: "4-րդ շաբաթվա վերանայում", ru: "Проверка на 4-й неделе" },
  month3: { en: "Month-3 checkpoint", hy: "3-րդ ամսվա ստուգում", ru: "Проверка на 3-м месяце" },
  month6: { en: "Month-6 checkpoint and handover", hy: "6-րդ ամսվա ստուգում և փոխանցում", ru: "Проверка на 6-м месяце и передача врачу" },
} as const satisfies Record<string, Record<Locale, string>>;
const FEELING = { better: { en: "Better", hy: "Ավելի լավ", ru: "Лучше" }, same: { en: "About the same", hy: "Մոտավորապես նույնը", ru: "Примерно так же" }, worse: { en: "Worse", hy: "Ավելի վատ", ru: "Хуже" } } as const satisfies Record<string, Record<Locale, string>>;
const MEDICINES = {
  all: { en: "Took them as planned", hy: "Ընդունել է ըստ ծրագրի", ru: "Приём по плану лечения" }, missed_some: { en: "Missed a few", hy: "Մի քանիսը բաց է թողել", ru: "Несколько приёмов пропущено" },
  missed_many: { en: "Missed many", hy: "Շատերը բաց է թողել", ru: "Много приёмов пропущено" }, no_medicines: { en: "No medicines in the plan", hy: "Ծրագրում դեղեր չկան", ru: "В плане лечения нет лекарств" }, not_sure: { en: "Not sure", hy: "Վստահ չէ", ru: "Нет уверенности" },
} as const satisfies Record<string, Record<Locale, string>>;
// Deterministic Armenian names: server and browser ICU data differ, so Intl would not hydrate.
const DATE = { timeZone: "Asia/Yerevan", day: "numeric", month: "short", year: "numeric" } as const;
const day = (d: string, l: Locale) => formatMemberDate(`${d}T12:00:00+04:00`, l, DATE);
const instant = (d: string, l: Locale) => formatMemberDate(d, l, DATE);

/**
 * The assigned doctor's programme panel: the three checkpoints with dates, the member's check-in,
 * recorded readings and medicine ticks since the last review, and the two ways to close a review:
 * keep the current plan (with an optional note for the member) or publish a new version.
 */
export function ProgrammePanel({ data, memberId, locale: l, submissionId, confirm }: {
  data: Ready; memberId: string; locale: Locale; submissionId: string; confirm: (input: unknown) => Promise<ConfirmResult>;
}) {
  const t = (p: { en: string; hy: string; ru: string }) => pick(l, p);
  const s = (en: string, hy: string, ru: string) => pick(l, { en, hy, ru });
  const open = data.checkpoints.find((c) => c.state === "open") ?? null;
  return (
    <section id="programme" aria-labelledby="programme-title" lang={l} className="space-y-5 rounded-xl border bg-background p-4 sm:p-6">
      <header className="space-y-1">
        <h2 id="programme-title" className="flex items-center gap-2 text-h3"><CalendarClock className="size-5" aria-hidden />{s("Programme rhythm", "Ծրագրի ռիթմ", "Этапы программы")}</h2>
        <p className="text-body2 text-muted-foreground">
          {data.startedAt
            ? s(`Started with plan version 1 on ${instant(data.startedAt, l)}. Checkpoints open ${data.offsets.opensDaysBefore} days before their date.`, `Սկսվել է պլանի 1-ին տարբերակով՝ ${instant(data.startedAt, l)}։ Ստուգումները բացվում են իրենց ամսաթվից ${data.offsets.opensDaysBefore} օր առաջ։`, `Программа началась с версии 1 плана лечения ${instant(data.startedAt, l)}. Проверки открываются за ${data.offsets.opensDaysBefore} дней до назначенной даты.`)
            : s("Starts when the first care plan is published.", "Սկսվում է առաջին խնամքի պլանի հրապարակմամբ։", "Начинается после публикации первого плана лечения.")}
        </p>
        {data.schedulePending && (
          <p className="text-caption text-muted-foreground">{s("The intervals (4 weeks, 3 and 6 months) are a proposal under clinical review.", "Ժամկետները (4 շաբաթ, 3 և 6 ամիս) առաջարկ են և կլինիկական վերանայման փուլում են։", "Интервалы (4 недели, 3 и 6 месяцев) предложены и проходят клиническую проверку.")}</p>
        )}
      </header>
      {data.checkpoints.length > 0 && (
        <ol className="grid gap-2 sm:grid-cols-3">
          {data.checkpoints.map((c) => (
            <li key={c.kind} className={`rounded-lg border p-3 ${c.state === "open" ? "border-primary" : ""}`}>
              <p className="text-body2 font-semibold">{t(KIND[c.kind])}</p>
              <p className="text-caption text-muted-foreground">{day(c.dueOn, l)}</p>
              <p className="text-caption">{c.state === "completed" ? (c.outcome === "republished" ? s(`Plan version ${c.outcomePlanVersion ?? "?"} published`, `Հրապարակվել է պլանի ${c.outcomePlanVersion ?? "?"} տարբերակը`, `Опубликована версия ${c.outcomePlanVersion ?? "?"} плана лечения`) : s("Plan kept", "Պլանը պահպանվել է", "План лечения сохранён")) + (c.completedAt ? ` · ${instant(c.completedAt, l)}` : "") : c.state === "open" ? s("Open: review due", "Բաց է՝ սպասում է վերանայման", "Открыто: требуется проверка") : s("Scheduled", "Նախատեսված", "Запланировано")}</p>
            </li>
          ))}
        </ol>
      )}
      {open ? <OpenReview checkpoint={open} data={data} memberId={memberId} l={l} submissionId={submissionId} confirm={confirm} /> : null}
    </section>
  );
}

function OpenReview({ checkpoint: c, data, memberId, l, submissionId, confirm }: {
  checkpoint: DoctorCheckpoint; data: Ready; memberId: string; l: Locale; submissionId: string; confirm: (input: unknown) => Promise<ConfirmResult>;
}) {
  const t = (p: { en: string; hy: string; ru: string }) => pick(l, p);
  const s = (en: string, hy: string, ru: string) => pick(l, { en, hy, ru });
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<ConfirmResult["status"] | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const r = data.readings;
  const messages: Record<ConfirmResult["status"], string> = {
    confirmed: s("Recorded. The member is told the plan stays the same.", "Գրանցված է։ Անդամին կտեղեկացվի, որ պլանը մնում է նույնը։", "Записано. Участник получит уведомление о том, что план лечения остаётся прежним."),
    closed: s("This checkpoint is already closed. Reload to see the outcome.", "Այս ստուգումն արդեն փակված է։ Թարմացրեք՝ արդյունքը տեսնելու համար։", "Эта проверка уже закрыта. Обновите страницу, чтобы увидеть результат."),
    no_plan: s("There is no current plan to keep. Publish a plan instead.", "Պահպանելու ընթացիկ պլան չկա։ Փոխարենը հրապարակեք պլան։", "Нет текущего плана лечения для сохранения. Опубликуйте план лечения."),
    off: s("The programme is switched off.", "Ծրագիրն անջատված է։", "Программа отключена."),
    access: s("Only the assigned doctor can close this review.", "Այս վերանայումը կարող է փակել միայն նշանակված բժիշկը։", "Только назначенный врач может закрыть эту проверку."),
    invalid: s("Check the note and try again.", "Ստուգեք նշումը և կրկին փորձեք։", "Проверьте примечание и попробуйте снова."),
    "outcome-unknown": s("We could not confirm this. Try again: it will not be recorded twice.", "Չհաջողվեց հաստատել։ Կրկին փորձեք․ այն երկու անգամ չի գրանցվի։", "Не удалось подтвердить. Попробуйте снова: повторной записи не будет."),
  };
  return (
    <div className="space-y-4 rounded-lg border border-primary p-4">
      <h3 className="text-body1 font-semibold">{t(KIND[c.kind])} · {s(`due ${day(c.dueOn, l)}`, `ժամկետը՝ ${day(c.dueOn, l)}`, `срок: ${day(c.dueOn, l)}`)}</h3>
      <dl className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg bg-muted p-3">
          <dt className="text-caption font-semibold text-muted-foreground">{s("Member check-in", "Անդամի պատասխանները", "Ответы участника")}</dt>
          {c.checkin ? (
            <dd className="space-y-1 text-body2">
              <p>{s("Feeling", "Ինքնազգացողություն", "Самочувствие")}: <strong>{t(FEELING[c.checkin.feeling])}</strong></p>
              <p>{s("Medicines (own report)", "Դեղեր (իր հաղորդմամբ)", "Лекарства (со слов участника)")}: <strong>{t(MEDICINES[c.checkin.medicines])}</strong></p>
              {c.checkin.note && <p className="whitespace-pre-wrap break-words">“{c.checkin.note}”</p>}
              <p className="text-caption text-muted-foreground">{instant(c.checkin.submittedAt, l)}</p>
            </dd>
          ) : <dd className="text-body2">{s("Not answered yet.", "Դեռ չի պատասխանել։", "Ответов пока нет.")}</dd>}
        </div>
        <div className="rounded-lg bg-muted p-3">
          <dt className="text-caption font-semibold text-muted-foreground">{s("Recorded since the last review", "Գրանցված վերջին վերանայումից ի վեր", "Записано с последней проверки")}</dt>
          <dd className="space-y-1 text-body2">
            <p>{s(`Home readings: ${r.count}`, `Տնային չափումներ՝ ${r.count}`, `Домашние измерения: ${r.count}`)}{r.first && r.last ? ` (${instant(r.first, l)} ${l === "ru" ? "-" : "–"} ${instant(r.last, l)})` : ""}</p>
            <p>{r.last7.count && r.last7.systolic !== null ? s(`Last 7 days: ${r.last7.count} readings, mean ${r.last7.systolic}/${r.last7.diastolic} ${bpUnit(l)}`, `Վերջին 7 օր՝ ${r.last7.count} չափում, միջինը ${r.last7.systolic}/${r.last7.diastolic} ${bpUnit(l)}`, `За последние 7 дней: ${r.last7.count} измерений, среднее ${r.last7.systolic}/${r.last7.diastolic} ${bpUnit(l)}`) : s("Last 7 days: no readings", "Վերջին 7 օր՝ չափումներ չկան", "За последние 7 дней: измерений нет")}</p>
            <p>{s(`Medicine ticks: ${data.doses.taken} taken, ${data.doses.skipped} skipped`, `Դեղերի նշումներ՝ ${data.doses.taken} ընդունված, ${data.doses.skipped} բաց թողնված`, `Отметки о лекарствах: принято ${data.doses.taken}, пропущено ${data.doses.skipped}`)}</p>
            <p className="text-caption text-muted-foreground">{s("Recorded values and the member's own ticks, not an assessment. Missing ticks are not counted as taken.", "Գրանցված արժեքներ և անդամի նշումներ, ոչ գնահատական։ Բացակայող նշումները չեն համարվում ընդունված։", "Записанные значения и отметки участника, без оценки. Отсутствие отметки не считается приёмом лекарства.")}</p>
          </dd>
        </div>
      </dl>
      {c.kind !== "week4_review" && (
        <div className="space-y-2">
          <p className="text-body2 font-semibold">{s("Repeat tests", "Կրկնակի հետազոտություններ", "Повторные анализы")}</p>
          <p className="text-body2 text-muted-foreground">{s("The decision tree gives repeat intervals only for these situations. Otherwise, you decide which tests to repeat and order them as usual. Nothing is ordered from this list.", "Որոշումների ծառը կրկնության ժամկետներ տալիս է միայն այս դեպքերի համար։ Մնացած դեպքերում դուք եք որոշում, թե որ հետազոտությունները կրկնել, և նշանակում եք դրանք սովորական կարգով։ Այս ցանկից ոչինչ չի նշանակվում։", "Дерево решений задаёт интервалы повторных анализов только для этих ситуаций. В остальных случаях вы решаете, какие анализы повторить, и назначаете их в обычном порядке. Из этого списка ничего не назначается.")}</p>
          <ul className="space-y-1 text-body2">
            {REPEAT_TEST_RULES.map((rule) => <li key={rule.id}><strong>{rule.when[l]}</strong>: {rule.repeat[l]} <span className="text-caption text-muted-foreground">({rule.source})</span></li>)}
          </ul>
        </div>
      )}
      {c.kind === "month6" && (
        <div className="space-y-1">
          <p className="text-body2 font-semibold">{s("Handover summary for the usual doctor", "Ամփոփում տեղամասային բժշկի համար", "Сводка для лечащего врача")}</p>
          <p className="text-body2">{data.gpReport ? s(`GP report version ${data.gpReport.version} approved on ${instant(data.gpReport.approvedAt, l)}.`, `Բժշկի հաշվետվության ${data.gpReport.version} տարբերակը հաստատվել է՝ ${instant(data.gpReport.approvedAt, l)}։`, `Версия ${data.gpReport.version} отчёта для лечащего врача утверждена ${instant(data.gpReport.approvedAt, l)}.`) : s("No GP report approved yet.", "Բժշկի հաշվետվություն դեռ չի հաստատվել։", "Утверждённого отчёта для лечащего врача пока нет.")}</p>
          <a href="#gp-report" className="text-body2 font-semibold text-primary underline">{s("Open the GP report", "Բացել բժշկի հաշվետվությունը", "Открыть отчёт для лечащего врача")}</a>
        </div>
      )}
      <div className="space-y-3 border-t pt-4">
        <p className="text-body2">{s("Close the review in one of two ways:", "Փակեք վերանայումը երկու եղանակներից մեկով՝", "Закройте проверку одним из двух способов:")}</p>
        <a href="#treatment" className="inline-flex min-h-11 items-center rounded-lg border px-4 py-2 text-body2 font-semibold hover:bg-muted">
          {s("Update the plan (new version with a “what changed” note)", "Թարմացնել պլանը (նոր տարբերակ՝ «ինչ է փոխվել» նշումով)", "Обновить план лечения (новая версия с примечанием «что изменилось»)")}
        </a>
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); start(async () => { const res = await confirm({ memberId, checkpointId: c.id, note: note.trim() || undefined, submissionId }); setStatus(res.status); if (res.status === "confirmed" || res.status === "closed") router.refresh(); }); }}>
          <label htmlFor="programme-note" className="text-body2 font-semibold">{s("Or keep the current plan. Note for the member (optional)", "Կամ պահպանել ընթացիկ պլանը։ Նշում անդամի համար (ըստ ցանկության)", "Или сохранить текущий план лечения. Примечание для участника (необязательно)")}</label>
          <textarea id="programme-note" value={note} maxLength={1000} rows={3} onChange={(e) => setNote(e.target.value)} className="w-full rounded-lg border bg-background px-3 py-2 text-body2" />
          <p className="text-caption text-muted-foreground">{data.currentPlan ? s(`Keeps plan version ${data.currentPlan.version}. The member gets a notice that the plan stays the same.`, `Պահպանում է պլանի ${data.currentPlan.version} տարբերակը։ Անդամը կստանա ծանուցում, որ պլանը մնում է նույնը։`, `Сохраняет версию ${data.currentPlan.version} плана лечения. Участник получит уведомление о том, что план лечения остаётся прежним.`) : s("No current plan.", "Ընթացիկ պլան չկա։", "Текущего плана лечения нет.")}</p>
          {status && <p role={status === "confirmed" ? "status" : "alert"} className="text-body2">{messages[status]}</p>}
          <button type="submit" disabled={pending || !data.currentPlan} className="inline-flex min-h-11 items-center rounded-lg border border-primary bg-primary px-4 py-2 text-body2 font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
            {pending ? s("Saving…", "Պահպանվում է…", "Сохраняется…") : s("Keep the current plan", "Պահպանել ընթացիկ պլանը", "Сохранить текущий план лечения")}
          </button>
        </form>
      </div>
    </div>
  );
}
