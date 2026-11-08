import Link from "next/link";
import type { Route } from "next";
import { FlaskConical } from "lucide-react";
import { Status, stamp } from "@/components/patient-care/common";
import { st, type StaffLocale } from "@/lib/staff/staff-locale-copy";
import { calendarDate } from "@/lib/staff/yerevan-time";
import { formatMmol, formatPercent } from "@/lib/ldl/status";
import { closeLdlResponse } from "@/lib/ldl/response-actions";
import type { DoctorLdlResponse } from "@/lib/ldl/response-schema";

const button = "inline-flex min-h-11 items-center rounded-md px-4 text-body2 font-medium focus-visible:outline-2 focus-visible:outline-ring";
type T = (en: string, hy: string, ru: string) => string;

/** Below the threshold with the reduction judged and short: one part of the goal, not "at goal". */
const onePart = (i: DoctorLdlResponse) => i.status === "at_goal" && i.facts.reduction.state === "not_met";
function statusLabel(i: DoctorLdlResponse, t: T) {
  const s = i.status;
  if (onePart(i)) return t("One part of the goal met", "Նպատակի մի մասը կատարված է", "Одна часть цели выполнена");
  return s === "above_goal" ? t("Above goal", "Նպատակից բարձր", "Выше цели") : s === "at_goal" ? t("At goal", "Նպատակին հասել է", "Цель достигнута") : t("Not assessable", "Հնարավոր չէ գնահատել", "Нельзя оценить");
}

/**
 * The guideline next step as text (pending Armen/Yesayi, C9 and C12). It names options, never a selected medicine:
 * the doctor decides and records any change on the member page.
 */
function nextStep(i: DoctorLdlResponse, t: T) {
  const facts = i.facts, pct = `${facts.adherenceThresholdPct}%`;
  const options = t("Guideline next step: consider adding ezetimibe or raising the statin dose. You decide.", "Ուղեցույցի հաջորդ քայլը՝ դիտարկել էզետիմիբի ավելացումը կամ ստատինի դեղաչափի բարձրացումը։ Որոշում եք դուք։", "Следующий шаг по рекомендациям: рассмотреть добавление эзетимиба или повышение дозы статина. Решение за вами.");
  if (facts.nextStep === "step_up" && facts.adherenceThresholdPct === null) return <><p className="text-body2 font-medium">{t("Above goal: review adherence and treatment together.", "Նպատակից բարձր է. միասին վերանայեք դեղերի ընդունումն ու բուժումը։", "Выше цели: оцените приверженность и лечение вместе.")}</p><p className="text-body2">{options}</p></>;
  if (facts.nextStep === "step_up") return <><p className="text-body2 font-medium">{t(`Adherence ${pct} or more: consider stepping up treatment.`, `Ընդունումը ${pct} կամ ավելի է. դիտարկեք բուժման ուժեղացումը։`, `Приверженность ${pct} или выше: рассмотрите усиление терапии.`)}</p><p className="text-body2">{options}</p></>;
  if (facts.nextStep === "adherence_first") return <><p className="text-body2 font-medium">{t(`Adherence below ${pct}: adherence support first.`, `Ընդունումը ${pct}-ից ցածր է. նախ աջակցեք դեղերի ընդունմանը։`, `Приверженность ниже ${pct}: сначала поддержка приверженности.`)}</p><p className="text-body2 text-muted-foreground">{options}</p></>;
  if (facts.nextStep === "adherence_unknown") return <><p className="text-body2 font-medium">{t("No lipid medicine on the dose log, so adherence is not known: check it with the member first.", "Դեղերի գրանցամատյանում լիպիդիջեցնող դեղ չկա, ընդունումը հայտնի չէ. նախ ստուգեք անդամի հետ։", "В журнале приёма нет липидснижающего препарата, приверженность неизвестна: сначала уточните у участника.")}</p><p className="text-body2 text-muted-foreground">{options}</p></>;
  if (i.status === "not_assessable") return <p className="text-body2">{t("No goal is set, so the result cannot be compared. Set the goal on the member page.", "Նպատակը սահմանված չէ, արդյունքը հնարավոր չէ համեմատել։ Սահմանեք նպատակը անդամի էջում։", "Цель не установлена, результат нельзя сравнить. Установите цель на странице участника.")}</p>;
  if (onePart(i)) return <p className="text-body2">{t("Below the threshold, the reduction is not reached. Decide the next step and tell the member.", "Շեմից ցածր է, նվազումը չի հասել նպատակին։ Որոշեք հաջորդ քայլը և տեղեկացրեք անդամին։", "Ниже порога, снижение не достигнуто. Решите следующий шаг и сообщите участнику.")}</p>;
  return <p className="text-body2">{t("Below the goal. Tell the member and decide when to test again.", "Նպատակից ցածր է։ Տեղեկացրեք անդամին և որոշեք, թե երբ կրկնել անալիզը։", "Ниже цели. Сообщите участнику и решите, когда повторить анализ.")}</p>;
}

/**
 * The doctor's Today: new LDL results after a change to treatment (the response check), above goal first. Read by the
 * page (readDoctorLdlResponses), separate from doctor_ai_inbox; nothing when empty or switched off, "unavailable" when
 * the read failed (null). Values are as the check recorded them; nothing here is computed by a model.
 */
export function LdlResponsesSection({ items, l }: { items: DoctorLdlResponse[] | null; l: StaffLocale }) {
  const t: T = (en, hy, ru) => st(l, en, hy, ru);
  if (items !== null && items.length === 0) return null;
  const day = (d: string) => calendarDate(d, l);
  const unit = t("mmol/L", "մմոլ/լ", "ммоль/л");
  return (
    <section aria-labelledby="ldl-responses" className="space-y-3 rounded-xl border bg-background p-4">
      <h2 id="ldl-responses" className="flex flex-wrap items-baseline gap-2 text-h3">{t("Waiting for you: LDL results", "Սպասում է ձեզ՝ ՑԽԼ արդյունքներ", "Ждут вас: результаты ЛПНП")}<span className="text-body2 font-normal text-muted-foreground">{items?.length ?? ""}</span></h2>
      <p className="text-body2 text-muted-foreground">{t("New LDL values you reviewed or released, checked against the member's goal by rule. The member was told the result is with you. Decide the next step, tell the member, then mark it reviewed.", "Ձեր վերանայած կամ հրապարակած ՑԽԼ նոր արժեքները՝ կանոնով համեմատված անդամի նպատակի հետ։ Անդամին ասվել է, որ արդյունքը ձեզ մոտ է։ Որոշեք հաջորդ քայլը, տեղեկացրեք անդամին, ապա նշեք որպես վերանայված։", "Новые значения ЛПНП, которые вы проверили или опубликовали, сравнены с целью участника по правилу. Участнику сообщили, что результат у вас. Решите следующий шаг, сообщите участнику и отметьте как рассмотренное.")}</p>
      {items === null ? <p role="alert" className="text-body2">{t("Unavailable. Reload to check.", "Անհասանելի է։ Թարմացրեք էջը՝ ստուգելու համար։", "Недоступно. Обновите страницу, чтобы проверить.")}</p> : (
        <ul className="divide-y">{items.map(i => {
          const facts = i.facts, thr = facts.goal?.thresholdMmol;
          return (
            <li key={i.id} className="space-y-2 py-4 first:pt-0 last:pb-0" data-ldl-response={i.status}>
              <div className="flex flex-wrap items-center gap-2">
                <FlaskConical className="size-5 shrink-0" aria-hidden />
                <span className="text-body2 font-semibold"><Link href={`/staff/real/members/${i.memberId}#ldl-goal` as Route} className="underline underline-offset-4">{i.memberName || t("Member without a name", "Անանուն անդամ", "Участник без имени")}</Link></span>
                <Status tone={i.status === "at_goal" && !onePart(i) ? "complete" : "attention"}>{statusLabel(i, t)}</Status>
                <Status>{t("Rule, no AI", "Կանոն, առանց AI", "Правило, без ИИ")}</Status>
              </div>
              <dl className="grid gap-x-4 gap-y-1 text-body2 sm:grid-cols-2">
                <div><dt className="inline text-muted-foreground">{t("LDL", "ՑԽԼ", "ЛПНП")}: </dt><dd className="inline font-semibold">{formatMmol(facts.value.mmol, thr)} {unit}</dd> <span className="text-caption text-muted-foreground">{day(facts.value.on)}</span></div>
                <div><dt className="inline text-muted-foreground">{t("Goal", "Նպատակ", "Цель")}: </dt><dd className="inline">{facts.goal ? <>&lt; {formatMmol(facts.goal.thresholdMmol)} {unit}{facts.goal.reductionPct !== null ? ` · ≥${facts.goal.reductionPct}%` : ""}</> : t("not set", "սահմանված չէ", "не установлена")}</dd></div>
                <div><dt className="inline text-muted-foreground">{t("Since previous", "Նախորդից ի վեր", "С прошлого")}: </dt><dd className="inline">{facts.previous && facts.changePct !== null
                  ? <>{facts.changePct > 0 ? "+" : facts.changePct < 0 ? "−" : ""}{formatPercent(Math.abs(facts.changePct))}% ({formatMmol(facts.previous.mmol, thr)} {unit}, {day(facts.previous.on)})</>
                  : t("no earlier value", "նախորդ արժեք չկա", "нет прошлого значения")}</dd></div>
                {facts.reduction.state === "met" || facts.reduction.state === "not_met" ? <div><dt className="inline text-muted-foreground">{t("From baseline", "Ելակետից", "От исходного")}: </dt><dd className="inline">−{formatPercent(facts.reduction.percent ?? 0, facts.reduction.requiredPct ?? undefined)}% ({facts.reduction.state === "met" ? t("met", "կատարված", "достигнуто") : t("not met", "չկատարված", "не достигнуто")})</dd></div> : null}
                <div><dt className="inline text-muted-foreground">{t(`Adherence, last ${facts.adherence?.windowDays ?? 28} days`, `Ընդունում, վերջին ${facts.adherence?.windowDays ?? 28} օր`, `Приверженность, ${facts.adherence?.windowDays ?? 28} дн.`)}: </dt><dd className="inline">{facts.adherence && facts.adherence.percent !== null
                  ? <>{formatPercent(facts.adherence.percent, facts.adherenceThresholdPct ?? undefined)}% ({t(`${facts.adherence.taken} of ${facts.adherence.expected} doses ticked taken`, `${facts.adherence.expected}-ից ${facts.adherence.taken} դեղաչափ նշված է ընդունված`, `отмечено принятых доз: ${facts.adherence.taken} из ${facts.adherence.expected}`)}; {facts.adherence.medicines.join(", ")})</>
                  : t("not known", "հայտնի չէ", "неизвестно")}</dd></div>
                <div><dt className="inline text-muted-foreground">{t("Latest ALT", "Վերջին ԱԼՏ", "Последний АЛТ")}: </dt><dd className="inline">{facts.alt ? <>{facts.alt.value} {t("U/L", "Մ/լ", "Ед/л")} ({day(facts.alt.on)})</> : t("none on record", "գրանցված չէ", "нет в записи")}</dd></div>
              </dl>
              {nextStep(i, t)}
              <p className="text-caption text-muted-foreground">{t("Checked", "Ստուգված է", "Проверено")} {stamp(i.createdAt, l)} · {facts.defaultsVersion}</p>
              <div className="flex flex-wrap items-start gap-3">
                <Link href={`/staff/real/members/${i.memberId}#ldl-goal` as Route} className={`${button} ${i.status === "above_goal" ? "bg-primary text-primary-foreground" : "border"}`}>{t("Open LDL record", "Բացել ՑԽԼ գրառումը", "Открыть запись ЛПНП")}</Link>
                <Link href={`/staff/real/conversations/${i.memberId}` as Route} className={`${button} border`}>{t("Message the member", "Գրել անդամին", "Написать участнику")}</Link>
                <details className="min-w-0 basis-full sm:basis-auto sm:flex-1"><summary className={`${button} cursor-pointer border`}>{t("Mark reviewed", "Նշել որպես վերանայված", "Отметить как рассмотренное")}</summary>
                  <form action={closeLdlResponse} className="mt-3 max-w-md space-y-3"><input type="hidden" name="responseId" value={i.id} />
                    <label className="block space-y-1 text-body2"><span className="font-medium">{t("Note (optional, staff only)", "Նշում (ըստ ցանկության, միայն աշխատակազմի համար)", "Примечание (необязательно, только для сотрудников)")}</span>
                      <textarea name="note" maxLength={500} rows={2} className="block w-full rounded-md border bg-background px-3 py-2" /></label>
                    <button className={`${button} bg-primary text-primary-foreground`}>{t("Save: reviewed", "Պահպանել՝ վերանայված", "Сохранить: рассмотрено")}</button>
                  </form></details>
              </div>
            </li>
          );
        })}</ul>)}
    </section>
  );
}
