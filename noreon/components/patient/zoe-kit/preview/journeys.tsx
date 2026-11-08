"use client";
import { CalendarDays, ClipboardList, FlaskConical, HeartPulse, ListChecks, Map as MapIcon, Pill } from "lucide-react";
import { CORE_QUESTIONS } from "@/lib/clinical/seed/questions";
import { NONE, localized, type AssessmentField } from "@/lib/clinical/types";
import { BP, CHIP, MESSAGE, RESULTS, SIDE, SIDE_EFFECT, SIDE_EFFECTS, TITLE, VISIT, sideEffectMessage, type SideEffect } from "@/lib/zoe-chat-actions/copy";
import { ASK_REASONS, MEDICINE_ASK_COPY, type AskReason } from "@/lib/member-medicines/ask-copy";
import type { MemberLdl } from "@/lib/ldl/schema";
import { BpEntry, MultiSelect, NumberEntry, Primary, QuickReplies, SingleSelect, SlotPicker, TextThenConfirm, UndoRow, type BpValue, type SlotDay } from "../answers";
import { Band, Card, EmergencyCard, GoalCard, LineChart, PlanCard, ResultCard, Rows, SummaryCard, Tag, WhereCard } from "../cards";
import { MemberBubble, Typing } from "../thread";
import { KIT, t, type KitLocale, type Line } from "../copy";
import type { Ctx, Journey, Voice } from "./conversation";

/**
 * The preview's nine journeys (DESIGN.md §6) with demo data. Fictional member, doctor and nurse; fictional values.
 * Wording reused from live screens is imported from where it lives (the questionnaire, #402's cards, the medicine
 * ask, the LDL goal card). Lines marked SIGN_OFF are new member-facing clinical wording and need clinician
 * sign-off before any of it reaches a real member; the preview labels itself as demo.
 */
const c = (hy: string, en: string, ru: string): Line => ({ hy, en, ru });
/** New member-facing clinical wording: Armen or Yesayi sign off before it is used outside this preview. */
const SIGN_OFF = (hy: string, en: string, ru: string): Line => c(hy, en, ru);
const say = (...lines: Line[]) => (x: Ctx) => lines.map(line => t(x.l, line));

const DOCTOR: Voice = { kind: "doctor", name: c("Բժ. Անի Պետրոսյան", "Dr. Ani Petrosyan", "Д-р Ани Петросян"), initials: c("ԱՊ", "AP", "АП"), role: c("սրտաբան", "cardiologist", "кардиолог") };
const NURSE: Voice = { kind: "nurse", name: c("Նարինե", "Narine", "Нарине"), initials: c("Ն", "N", "Н"), role: c("բուժքույր", "nurse", "медсестра") };
const DOCTOR_NAME = DOCTOR.name;
const TODAY = c("Այսօր", "Today", "Сегодня");
const UNIT = c("մմոլ/լ", "mmol/L", "ммоль/л");

// ---------- 1. Health questionnaire: the questionnaire's own questions, wording and bounds unchanged ----------
const field = (id: string): AssessmentField => {
  for (const q of CORE_QUESTIONS) for (const f of q.fields) if (f.id === id) return f;
  throw new Error(`Preview question ${id} is missing`);
};
const topic = (id: string) => (x: Ctx) => {
  const n = CORE_QUESTIONS.find(q => q.fields.some(f => f.id === id))!.index;
  return t(x.l, c(`Թեմա ${n}/${CORE_QUESTIONS.length}`, `Topic ${n} of ${CORE_QUESTIONS.length}`, `Тема ${n} из ${CORE_QUESTIONS.length}`));
};
const label = (id: string, l: KitLocale) => localized(field(id).label, l);
const options = (id: string, l: KitLocale) => (field(id).options ?? []).map(o => ({ value: o.value, label: localized(o.label, l) }));
const QUESTIONS = ["q1.age", "q1.sex", "q5.diagnosed", "q5.last_reading", "q6.conditions"];
// A string summary answer is the question the member chose to change: after it, back to a new summary.
const backToSummary = (next: string) => (_: unknown, x: Ctx) => (typeof x.answers.summary === "string" ? "summary" : next);
const said = (x: Ctx, id: string) => String(x.answers[`said:${id}`] ?? "");

const questionnaire: Journey = {
  key: "questionnaire",
  chip: c("Առողջության հարցեր", "Health questions", "Вопросы о здоровье"),
  steps: [
    {
      id: "q1.age", at: "10:00", progress: topic("q1.age"),
      say: x => [...(typeof x.answers.summary === "string" ? [] : [t(x.l, c("Հիմա մի քանի հարց ձեր առողջության մասին։ Ամեն մեկը մեկ հպում է, և հարցնում եմ միայն այն, ինչը վերաբերում է ձեզ։", "Now some questions about your health. One tap each, and I only ask what applies to you.", "Теперь несколько вопросов о вашем здоровье. По одному касанию на каждый, и я спрашиваю только то, что касается вас."))]), label("q1.age", x.l)],
      ask: (x, act) => { const f = field("q1.age"); return <NumberEntry locale={x.l} label={label("q1.age", x.l)} unit={localized(f.unit!, x.l)} min={f.min!} max={f.max!} taps={[35, 52, 65, 74]} onAnswer={(v, s) => act.answer(s, v)} />; },
      next: (v, x) => backToSummary("q1.sex")(v, x),
    },
    {
      id: "q1.sex", at: "10:00", progress: topic("q1.sex"), say: x => [label("q1.sex", x.l)],
      ask: (x, act) => <QuickReplies label={label("q1.sex", x.l)} options={options("q1.sex", x.l)} onAnswer={(v, s) => act.answer(s, v)} />,
      next: (v, x) => backToSummary("q5.diagnosed")(v, x),
    },
    {
      id: "q5.diagnosed", at: "10:01", progress: topic("q5.diagnosed"), say: x => [label("q5.diagnosed", x.l)],
      ask: (x, act) => <SingleSelect locale={x.l} legend={label("q5.diagnosed", x.l)} options={options("q5.diagnosed", x.l)} onAnswer={(v, s) => act.answer(s, v)} />,
      next: (v, x) => backToSummary("q5.last_reading")(v, x),
    },
    {
      id: "q5.last_reading", at: "10:01", progress: topic("q5.last_reading"), say: x => [label("q5.last_reading", x.l)],
      ask: (x, act) => <BpEntry locale={x.l} intro={<p className="zk-plain">{localized(field("q5.last_reading").help!, x.l)}</p>}
        unknown={{ label: t(x.l, KIT.dontRemember), said: t(x.l, KIT.dontRemember) }} onAnswer={(v, s) => act.answer(s, v)} />,
      next: (v, x) => backToSummary("q6.conditions")(v, x),
    },
    {
      id: "q6.conditions", at: "10:02", progress: topic("q6.conditions"), say: x => [label("q6.conditions", x.l)],
      ask: (x, act) => {
        const all = options("q6.conditions", x.l);
        return <MultiSelect locale={x.l} legend={label("q6.conditions", x.l)} options={all.filter(o => o.value !== NONE)} none={all.find(o => o.value === NONE)}
          onAnswer={(v, s) => act.answer(s, v)} />;
      },
      next: () => "summary",
    },
    {
      id: "summary", at: "10:03", writes: true,
      say: say(c("Առայժմ այսքանը։ Ահա թե ինչ կփոխանցեմ ձեր խնամքի թիմին։", "That is all for now. This is what I will pass to your care team.", "Пока это всё. Вот что я передам вашей медицинской команде.")),
      ask: (x, act) => <Summary x={x} sent={null} onSend={() => act.answer(null)} onChange={key => { void act.revisit(`${t(x.l, KIT.changeAnswer)}: ${label(key, x.l)}`, key); }} />,
      // Changing an answer closes this summary as it was; a new one follows the re-asked question.
      keep: x => x.answers.summary ? <Summary x={x} sent={null} /> : <Summary x={x} sent={t(x.l, c("Ուղարկված է ձեր խնամքի թիմին, 29.10, 10:03", "Sent to your care team, 29.10, 10:03", "Отправлено вашей медицинской команде, 29.10, 10:03"))} />,
      next: () => "thanks",
    },
    {
      id: "thanks", at: "10:03",
      say: say(c("Շնորհակալ եմ։ Ձեր պատասխաններն այժմ ձեր խնամքի թիմի մոտ են։ Հաջորդ քայլի մասին կգրեմ այստեղ։", "Thank you. Your care team has your answers now. I will tell you the next step here.", "Спасибо. Ваши ответы теперь у вашей медицинской команды. О следующем шаге я напишу здесь.")),
      next: () => null,
    },
  ],
};
function Summary({ x, sent, onSend, onChange }: { x: Ctx; sent: string | null; onSend?: () => Promise<string | null>; onChange?: (key: string) => void }) {
  const all = QUESTIONS.map(id => ({ key: id, label: label(id, x.l), value: said(x, id) }));
  return (
    <SummaryCard locale={x.l} icon={ClipboardList} title={t(x.l, c("Ինչ եմ փոխանցում", "What I pass on", "Что я передаю"))}
      rows={all.slice(0, 3).map(a => ({ label: a.label, value: a.value }))} all={all} sent={sent} asOf="29.10, 10:03"
      send={t(x.l, c("Ուղարկել խնամքի թիմին", "Send to my care team", "Отправить медицинской команде"))}
      closed={!onSend} onSend={onSend ?? (() => undefined)} onChange={onChange ?? (() => undefined)} />
  );
}

// ---------- 2. Booking tests and visits ----------
const DAYS = (l: KitLocale): SlotDay[] => {
  const wd = { hy: ["Երկ", "Երք", "Չրք", "Հնգ", "Ուրբ"], en: ["Mon", "Tue", "Wed", "Thu", "Fri"], ru: ["Пн", "Вт", "Ср", "Чт", "Пт"] }[l];
  const times = [["08:00", "08:30", "09:30"], ["08:30", "10:00"], [], ["08:00", "09:00", "09:30", "11:00"], ["08:30"]];
  return [3, 4, 5, 6, 7].map((d, i) => ({ key: `11-${d}`, weekday: wd[i], day: String(d), slots: times[i].map(at => ({ id: `${d}-${at}`, at })) }));
};
const NOV = c("նոյեմբերի", "Nov", "нояб.");
const slotLabel = (l: KitLocale) => (d: SlotDay, s: { at: string }) => l === "en" ? `${d.weekday} ${d.day} Nov, ${s.at}` : `${d.weekday}, ${d.day} ${t(l, NOV)}, ${s.at}`;
const booking: Journey = {
  key: "booking",
  chip: c("Ամրագրել անալիզները", "Book my tests", "Записаться на анализы"),
  steps: [
    {
      id: "tests", at: "11:20",
      say: say(c("Ձեր բժիշկն ընտրել է արյան երկու անալիզ։ Բուժքույրը կարող է նմուշը վերցնել տանը, կամ կարող եք գնալ կլինիկա։", "Your doctor chose two blood tests. A nurse can take the sample at home, or you can go to the clinic.", "Ваш врач выбрал два анализа крови. Медсестра может взять кровь дома, или вы можете прийти в клинику.")),
      card: x => (
        <Card locale={x.l} icon={FlaskConical} title={t(x.l, c("Ձեր անալիզները", "Your tests", "Ваши анализы"))} asOf="29.10, 11:20">
          <Rows rows={[
            { label: t(x.l, c("Լիպիդային պրոֆիլ", "Lipid profile", "Липидный профиль")), value: t(x.l, c("Խոլեստերին, այդ թվում ՑԽԼ", "Cholesterol, including LDL", "Холестерин, включая ЛПНП")) },
            { label: t(x.l, c("Երիկամներ և կալիում", "Kidneys and potassium", "Почки и калий")), value: t(x.l, c("Ստուգում նոր դեղից առաջ", "A check before a new medicine", "Проверка перед новым лекарством")) },
          ]} />
        </Card>
      ),
      ask: (x, act) => <QuickReplies label={t(x.l, c("Որտե՞ղ", "Where?", "Где?"))} options={[{ value: "home", label: t(x.l, VISIT.home) }, { value: "clinic", label: t(x.l, VISIT.clinic) }]} onAnswer={(v, s) => act.answer(s, v)} />,
    },
    {
      id: "slots", at: "11:21", writes: true,
      say: say(c("Ընտրեք ձեզ հարմար ժամը։ Նախորդ օրը կգրեմ, թե ինչ պատրաստել։", "Choose a time that suits you. I will tell you what to prepare the day before.", "Выберите удобное время. Накануне я напишу, как подготовиться.")),
      ask: (x, act) => <SlotPicker locale={x.l} days={DAYS(x.l)} label={slotLabel(x.l)} onAnswer={(v, s) => act.answer(s, v)} />,
    },
    {
      id: "booked", at: "11:21",
      say: say(c("Ամրագրված է։ Մեկ օր առաջ կհիշեցնեմ։", "Booked. I will remind you the day before.", "Записано. Я напомню за день.")),
      card: x => (
        <Card locale={x.l} icon={CalendarDays} title={t(x.l, c("Ձեր այցը", "Your visit", "Ваш визит"))} tone="ok" tag={<Tag tone="ok">{t(x.l, VISIT.confirmed)}</Tag>} asOf="29.10, 11:21">
          <Rows rows={[
            { label: t(x.l, c("Երբ", "When", "Когда")), value: said(x, "slots") },
            { label: t(x.l, c("Որտեղ", "Where", "Где")), value: t(x.l, x.answers.tests === "clinic" ? VISIT.clinic : VISIT.home) },
            { label: t(x.l, c("Ով", "Who", "Кто")), value: t(x.l, c("Բուժքույր Նարինե", "Nurse Narine", "Медсестра Нарине")) },
          ]} />
          <a className="zk-link" href="#change">{t(x.l, VISIT.change)}</a>
        </Card>
      ),
    },
    {
      id: "proposed", at: "16:40", day: c("Վաղը", "Tomorrow", "Завтра"),
      say: say(c("Կլինիկան խնդրում է տեղափոխել ձեր այցը։ Նոր ժամը հարմա՞ր է։", "The clinic asked to move your visit. Does the new time work for you?", "Клиника просит перенести ваш визит. Новое время вам подходит?")),
      card: x => (
        <Card locale={x.l} icon={CalendarDays} title={t(x.l, c("Նոր ժամ", "New time", "Новое время"))} tone="action" asOf="30.10, 16:40">
          <Rows rows={[
            { label: t(x.l, c("Եղել է", "Was", "Было")), value: slotLabel(x.l)(DAYS(x.l)[0], { at: "08:30" }) },
            { label: t(x.l, c("Առաջարկվում է", "Proposed", "Предложено")), value: slotLabel(x.l)(DAYS(x.l)[1], { at: "10:00" }) },
          ]} />
        </Card>
      ),
      ask: (x, act) => <QuickReplies label={t(x.l, VISIT.accept)} options={[{ value: "yes", label: t(x.l, VISIT.accept) }, { value: "no", label: t(x.l, c("Ընտրել ուրիշը", "Choose another", "Выбрать другое")) }]}
        onAnswer={(v, s) => act.answer(s, v, v === "yes" ? "accepted" : "slots")} />,
    },
    { id: "accepted", at: "16:41", say: say(VISIT.accepted), next: () => null },
  ],
};

// ---------- 3. Daily dose logging and missed reasons (the medicine ask's own wording) ----------
const ask = (l: KitLocale) => MEDICINE_ASK_COPY[l];
const dose: Journey = {
  key: "dose",
  chip: CHIP.dose,
  steps: [
    {
      id: "due", at: "21:00", day: TODAY,
      say: say(c("Երեկոյան դեղահաբի ժամն է։", "Time for your evening tablet.", "Время вечерней таблетки.")),
      ask: (x, act) => (
        <Card locale={x.l} icon={Pill} title={t(x.l, c("Երեկոյան, 21:00", "Evening, 21:00", "Вечер, 21:00"))} tone="action">
          <p className="zk-plain">{t(x.l, c("Ատորվաստատին 20 մգ, 1 դեղահաբ", "Atorvastatin 20 mg, 1 tablet", "Аторвастатин 20 мг, 1 таблетка"))}</p>
          <div className="zk-actions">
            <Primary tone="ok" onClick={() => act.answer(t(x.l, c("Ընդունեցի", "I took it", "Принял(а)")), "taken", "taken")}>{t(x.l, c("Ընդունեցի", "I took it", "Принял(а)"))}</Primary>
            <Primary tone="line" onClick={() => act.answer(t(x.l, c("Բաց թողեցի", "I missed it", "Пропустил(а)")), "missed", "why")}>{t(x.l, c("Բաց թողեցի", "I missed it", "Пропустил(а)"))}</Primary>
          </div>
        </Card>
      ),
    },
    {
      id: "taken", at: "21:04",
      say: say(c("Շնորհակալ եմ։ Այս շաբաթ 7-ից 6 օր։", "Thank you. That is 6 of 7 days this week.", "Спасибо. Это 6 из 7 дней на этой неделе.")),
      lead: x => <UndoRow locale={x.l} text={t(x.l, c("Ընդունված է, 21:04", "Taken at 21:04", "Принято в 21:04"))} onUndo={() => undefined} />,
      next: () => null,
    },
    {
      id: "why", at: "21:05", say: x => [ask(x.l).why],
      ask: (x, act) => (
        <SingleSelect locale={x.l} legend={ask(x.l).why} options={ASK_REASONS.map(r => ({ value: r, label: ask(x.l).reasons[r] }))}
          onAnswer={(v, s) => act.answer(s, v)} />
      ),
      next: v => ({ forgot: "forgot", side_effect: "doctor", decided_to_stop: "doctor", cost_or_availability: "refill", ran_out: "refill" } as Record<AskReason, string>)[v as AskReason],
    },
    {
      id: "forgot", at: "21:05", say: x => [ask(x.l).forgot.body],
      ask: (x, act) => <QuickReplies label={ask(x.l).forgot.body} options={[{ value: "change", label: ask(x.l).forgot.action }, { value: "no", label: ask(x.l).notNow }]}
        onAnswer={(v, s) => act.answer(s, v, v === "change" ? "remind" : null)} />,
    },
    {
      id: "remind", at: "21:06", say: say(c("Ե՞րբ հիշեցնեմ երեկոյան դեղահաբի մասին։", "When should I remind you about the evening tablet?", "Когда напомнить о вечерней таблетке?")),
      writes: true,
      ask: (x, act) => <SingleSelect locale={x.l} legend={t(x.l, c("Երեկոյան հիշեցում", "Evening reminder", "Вечернее напоминание"))} options={["20:00", "21:00", "22:00"].map(v => ({ value: v, label: v }))}
        next={t(x.l, c("Պահել ժամը", "Save this time", "Сохранить время"))} onAnswer={(v, s) => act.answer(s, v)} />,
    },
    { id: "reminded", at: "21:06", say: x => [t(x.l, c(`Պատրաստ է։ Կհիշեցնեմ ժամը ${x.answers.remind}-ին։`, `Done. I will remind you at ${x.answers.remind}.`, `Готово. Напомню в ${x.answers.remind}.`))], next: () => null },
    {
      id: "refill", at: "21:05", say: x => [ask(x.l).refill.body],
      ask: (x, act) => <QuickReplies label={ask(x.l).refill.body} options={[{ value: "ask", label: ask(x.l).refill.action }, { value: "no", label: ask(x.l).notNow }]}
        onAnswer={(v, s) => act.answer(s, v, v === "ask" ? "refill_sent" : null)} />,
    },
    { id: "refill_sent", at: "21:06", say: x => [ask(x.l).refill.sent], next: () => null },
    { id: "doctor", at: "21:06", say: x => [x.answers.why === "decided_to_stop" ? ask(x.l).doctor.stop : ask(x.l).doctor.sideEffect, ask(x.l).doctor.urgent], next: () => null },
  ],
};

// ---------- 4. Blood pressure readings (the BP week's own wording) ----------
const bp: Journey = {
  key: "bp",
  chip: CHIP.bp,
  steps: [
    {
      id: "reading", at: "07:40", day: TODAY, writes: true,
      progress: x => t(x.l, BP.week(3, 7, false)),
      say: x => [t(x.l, c("Բարի լույս։ Առավոտյան չափման ժամն է։", "Good morning. Time for your morning reading.", "Доброе утро. Время утреннего измерения.")), t(x.l, BP.guide)],
      ask: (x, act) => <BpEntry locale={x.l} onAnswer={(v, s) => act.answer(s, v)} />,
    },
    {
      id: "saved", at: "07:41",
      lead: x => { const v = x.answers.reading as BpValue; return <UndoRow locale={x.l} text={`${t(x.l, BP.saved(`${v.systolic}/${v.diastolic}`))} ${t(x.l, BP.weekProgress(9, 28))}${x.l === "hy" ? "։" : "."}`} />; },
      say: x => [`${t(x.l, BP.noNotify)} ${t(x.l, BP.worried)}`],
      next: () => null,
    },
  ],
};

// ---------- 5. Results in plain words ----------
const results: Journey = {
  key: "results",
  chip: CHIP.results,
  steps: [
    {
      id: "back", at: "09:00", day: TODAY,
      say: say(c("Ձեր հաջորդ քայլը ձեր բժշկի հաստատած պլանն է։", "Your next step is your doctor-approved plan.", "Ваш следующий шаг: план, одобренный вашим врачом.")),
      card: x => (
        <ResultCard locale={x.l} icon={FlaskConical} title={t(x.l, c("ՑԽԼ խոլեստերին", "LDL cholesterol", "Холестерин ЛПНП"))} value="3.8" unit={t(x.l, UNIT)}
          tag={<Tag tone="watch">{t(x.l, c("Նորմայից բարձր", "Above the usual range", "Выше нормы"))}</Tag>}
          band={<Band scale={[0, 6]} range={[0, 3]} value={3.8} labels={[0, 3, 6]} />}
          plain={t(x.l, SIGN_OFF("ՑԽԼ-ն այն խոլեստերինն է, որը կուտակվում է զարկերակների պատերին։ Ձերը նորմայից բարձր է։ Ձեր բժիշկը ձեզ հետ նպատակ կսահմանի։", "LDL is the cholesterol that builds up in artery walls. Yours is above the usual range. Your doctor will set a goal with you.", "ЛПНП это холестерин, который откладывается в стенках артерий. У вас он выше нормы. Ваш врач установит с вами цель."))}
          approved={`${t(x.l, RESULTS.approved)}, 28.10`} asOf="29.10, 09:00"
          numbers={[
            { label: t(x.l, c("Ընդհանուր խոլեստերին", "Total cholesterol", "Общий холестерин")), value: `6.1 ${t(x.l, UNIT)}` },
            { label: t(x.l, c("ԲԽԼ («լավ») խոլեստերին", "HDL (good) cholesterol", "ЛПВП («хороший») холестерин")), value: `1.3 ${t(x.l, UNIT)}` },
            { label: t(x.l, c("Տրիգլիցերիդներ", "Triglycerides", "Триглицериды")), value: `1.7 ${t(x.l, UNIT)}` },
          ]} />
      ),
    },
    {
      id: "waiting", at: "09:00",
      card: x => (
        <Card locale={x.l} icon={FlaskConical} title={t(x.l, c("Երիկամների ֆունկցիա", "Kidney function", "Функция почек"))} tag={<Tag>{t(x.l, c("Դեռ պատրաստ չէ", "Not ready yet", "Пока не готово"))}</Tag>} asOf="29.10, 09:00">
          <p className="zk-plain">{t(x.l, c("Արդյունքը եկել է։ Այստեղ այն դեռ հնարավոր չէ ցույց տալ։ Երբ պատրաստ լինի, կբացատրեմ։", "Your result is in. It is not ready to show here yet. I will explain it when it is.", "Результат поступил. Здесь его пока нельзя показать. Я объясню его, когда он будет готов."))}</p>
        </Card>
      ),
      ask: (x, act) => <QuickReplies label={t(x.l, KIT.next)} options={[{ value: "mean", label: t(x.l, c("Ի՞նչ է ՑԽԼ-ն", "What is LDL?", "Что такое ЛПНП?")) }, { value: "goal", label: t(x.l, c("Ցույց տալ իմ նպատակը", "Show my goal", "Показать мою цель")) }]}
        onAnswer={(v, s) => act.answer(s, v, v === "goal" ? "goal" : "mean")} />,
    },
    {
      id: "mean", at: "09:02",
      say: say(SIGN_OFF("ՑԽԼ-ն «վատ» խոլեստերինն է։ Երբ այն երկար ժամանակ բարձր է, զարկերակներում կուտակումներ են առաջանում, և ինֆարկտի ու ինսուլտի ռիսկը մեծանում է։ Այն իջեցնելը այդ ռիսկը նվազեցնում է։", "LDL is the \"bad\" cholesterol. When it stays high for years, deposits build up in the arteries and the risk of a heart attack or stroke goes up. Lowering it lowers that risk.", "ЛПНП это «плохой» холестерин. Когда он годами остаётся высоким, в артериях образуются отложения, и риск инфаркта и инсульта растёт. Его снижение уменьшает этот риск.")),
      next: () => null,
    },
    { id: "goal", at: "09:02", card: x => <Goal x={x} data={LDL_DEMO} />, next: () => null },
  ],
};

// ---------- 6. LDL goal and progress: lib/ldl decides, the card words it ----------
const ldlObs = (values: [string, number][]) => values.map(([on, value], i) => ({ id: `demo-${i}`, value, unit: "mmol/L", on, source: "clinic_reviewed" as const, name: "LDL cholesterol", memberVisible: true }));
const GOAL = { version: 1, category: "high" as const, thresholdMmol: 1.8, reductionRule: true, reductionPct: 50, baseline: { kind: "pre_treatment" as const, mmol: 3.8, on: "2026-08-04", source: "lab_result" as const }, nextTestOn: "2026-12-08", setAt: "2026-08-12T10:00:00+04:00", doctorName: "Dr. Ani Petrosyan" };
const LDL_DEMO: MemberLdl = { version: "ldl-member-v1", enabled: true, inPathway: true, goal: GOAL, observations: ldlObs([["2026-08-04", 3.8], ["2026-09-15", 2.9], ["2026-10-27", 2.3]]) };
const LDL_AT_GOAL: MemberLdl = { ...LDL_DEMO, observations: ldlObs([["2026-08-04", 3.8], ["2026-09-15", 2.9], ["2026-10-27", 2.3], ["2026-12-08", 1.6]]) };
const MONTHS = { hy: ["Օգս", "Սեպ", "Հոկ", "Դեկ"], en: ["Aug", "Sep", "Oct", "Dec"], ru: ["Авг", "Сен", "Окт", "Дек"] };
const dd = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}`;
function Goal({ x, data }: { x: Ctx; data: MemberLdl }) {
  const obs = data.enabled && data.inPathway ? data.observations : [];
  const points = obs.map((o, i) => ({ label: MONTHS[x.l][i], value: Number(o.value) }));
  const goalLabel = t(x.l, c("Նպատակ 1.8", "Goal 1.8", "Цель 1.8"));
  const summary = `${points.map(p => `${p.value} ${p.label}`).join(", ")}. ${goalLabel}.`;
  return (
    <GoalCard locale={x.l} data={data} day={dd} asOf="29.10, 09:02"
      setBy={t(x.l, c(`Սահմանել է ${t("hy", DOCTOR_NAME)}, 12.08։`, `Set by ${t("en", DOCTOR_NAME)}, 12.08.`, `Установлено: ${t("ru", DOCTOR_NAME)}, 12.08.`))}
      chart={<LineChart points={points} goal={{ value: 1.8, label: goalLabel }} summary={summary} format={n => String(n)} />} />
  );
}
const goal: Journey = {
  key: "goal",
  chip: c("Իմ խոլեստերինի նպատակը", "My cholesterol goal", "Моя цель по холестерину"),
  steps: [
    {
      id: "now", at: "09:30", day: TODAY,
      say: say(c("Ահա թե որտեղ եք ձեր նպատակի ճանապարհին։", "Here is where you are with your goal.", "Вот где вы сейчас на пути к цели.")),
      card: x => <Goal x={x} data={LDL_DEMO} />,
      ask: (x, act) => <QuickReplies label={t(x.l, KIT.next)} options={[{ value: "next", label: t(x.l, c("Ի՞նչ է հաջորդը", "What happens next?", "Что дальше?")) }, { value: "at", label: t(x.l, c("Ցույց տալ «նպատակին հասած»", "Show it at goal", "Показать «цель достигнута»")) }]}
        onAnswer={(v, s) => act.answer(s, v, v === "at" ? "at" : "next")} />,
    },
    { id: "next", at: "09:31", say: say(c("Հաջորդ ՑԽԼ անալիզը 08.12-ին է։ Մեկ շաբաթ առաջ միասին կամրագրենք։", "Your next LDL test is on 08.12. We will book it together a week before.", "Следующий анализ на ЛПНП 08.12. Запишемся вместе за неделю.")), next: () => null },
    {
      id: "at", at: "10:00", day: c("Դեկտեմբերի 10", "10 December", "10 декабря"),
      say: say(SIGN_OFF("Ձեր նոր արդյունքը նպատակից ցածր է։ Սա ձեր ամիսների աշխատանքն է։", "Your new result is below your goal. This is months of your own work.", "Ваш новый результат ниже цели. Это результат ваших месяцев работы.")),
      card: x => <Goal x={x} data={LDL_AT_GOAL} />, next: () => null,
    },
  ],
};

// ---------- 7. Plan acceptance and reminders ----------
function Plan({ x, started, start }: { x: Ctx; started?: string; start?: { onStart: () => void; onExplain: () => void } }) {
  return (
    <PlanCard locale={x.l} icon={ClipboardList} title={t(x.l, c("Ձեր պլանը", "Your plan", "Ваш план"))} asOf="29.10, 12:00"
      approved={t(x.l, c(`Հաստատել է ${t("hy", DOCTOR_NAME)}, 29.10`, `Approved by ${t("en", DOCTOR_NAME)}, 29.10`, `Утвердил(а) ${t("ru", DOCTOR_NAME)}, 29.10`))}
      doses={[
        { slot: "morning", badge: t(x.l, c("Առ", "AM", "Утр")), when: t(x.l, c("Առավոտյան, 08:00, 1 դեղահաբ", "Morning, 08:00: 1 tablet", "Утром, 08:00: 1 таблетка")), what: t(x.l, c("Պերինդոպրիլ / ամլոդիպին 4 / 5 մգ, ճնշման համար", "Perindopril / amlodipine 4 / 5 mg, for blood pressure", "Периндоприл / амлодипин 4 / 5 мг, от давления")) },
        { slot: "evening", badge: t(x.l, c("Եր", "PM", "Веч")), when: t(x.l, c("Երեկոյան, 21:00, 1 դեղահաբ", "Evening, 21:00: 1 tablet", "Вечером, 21:00: 1 таблетка")), what: t(x.l, c("Ատորվաստատին 20 մգ, խոլեստերինի համար", "Atorvastatin 20 mg, for cholesterol", "Аторвастатин 20 мг, от холестерина")) },
      ]}
      goals={[
        { domain: "bp", label: t(x.l, c("Ճնշման նպատակ", "Blood pressure goal", "Цель по давлению")), value: "120–129 / 70–79" },
        { domain: "ldl", label: t(x.l, c("Խոլեստերինի նպատակ", "Cholesterol goal", "Цель по холестерину")), value: `< 1.8 ${t(x.l, UNIT)}` },
      ]}
      whyLabel={t(x.l, c("Ինչու այս պլանը", "Why this plan", "Почему этот план"))}
      why={<p>{t(x.l, SIGN_OFF("Ձեր ճնշումն ու ՑԽԼ-ն երկուսն էլ բարձր են, իսկ ընտանեկան պատմությունը ռիսկը մեծացնում է։ Առավոտյան դեղահաբը իջեցնում է ճնշումը, երեկոյանը՝ խոլեստերինը։", "Your blood pressure and LDL are both high, and your family history adds to the risk. The morning tablet lowers blood pressure, the evening one lowers cholesterol.", "И давление, и ЛПНП у вас повышены, а семейная история увеличивает риск. Утренняя таблетка снижает давление, вечерняя снижает холестерин."))}</p>}
      started={started}
      start={start && { label: t(x.l, c("Սկսել իմ պլանը", "Start my plan", "Начать мой план")), onClick: start.onStart, also: { label: t(x.l, c("Բացատրիր պարզ բառերով", "Explain it simply", "Объясни простыми словами")), onClick: start.onExplain } }} />
  );
}
const plan: Journey = {
  key: "plan",
  chip: CHIP.plan,
  steps: [
    {
      id: "ready", at: "12:00", day: TODAY,
      say: say(c("Ձեր պլանը պատրաստ է։ Ձեր բժիշկն այսօր հաստատել է այն։", "Your plan is ready. Your doctor approved it today.", "Ваш план готов. Ваш врач утвердил его сегодня.")),
      ask: (x, act) => <Plan x={x} start={{ onStart: () => act.answer(t(x.l, c("Սկսել իմ պլանը", "Start my plan", "Начать мой план")), "start", "am"), onExplain: () => act.answer(t(x.l, c("Բացատրիր պարզ բառերով", "Explain it simply", "Объясни простыми словами")), "explain", "explain") }} />,
      keep: x => <Plan x={x} started={x.answers.ready === "start" ? t(x.l, c("Սկսված է 29.10", "Started 29.10", "Начат 29.10")) : undefined} />,
    },
    {
      id: "explain", at: "12:01",
      say: say(SIGN_OFF("Օրական երկու դեղահաբ՝ մեկը առավոտյան, մեկը երեկոյան։ Առավոտյանը ճնշման համար է, երեկոյանը՝ խոլեստերինի։ Ես կհիշեցնեմ երկուսի մասին էլ, և ձեր բժիշկը կհետևի թվերին։", "Two tablets a day: one in the morning, one in the evening. The morning one is for blood pressure, the evening one for cholesterol. I remind you about both, and your doctor watches the numbers.", "Две таблетки в день: одна утром, одна вечером. Утренняя от давления, вечерняя от холестерина. Я напомню о каждой, а ваш врач следит за показателями.")),
      ask: (x, act) => <QuickReplies label={t(x.l, KIT.next)} options={[{ value: "start", label: t(x.l, c("Սկսել իմ պլանը", "Start my plan", "Начать мой план")) }, { value: "later", label: t(x.l, c("Ոչ հիմա", "Not now", "Не сейчас")) }]}
        onAnswer={(v, s) => act.answer(s, v, v === "start" ? "am" : null)} />,
    },
    {
      id: "am", at: "12:02", say: say(c("Ե՞րբ հիշեցնեմ առավոտյան դեղահաբի մասին։", "When should I remind you about the morning tablet?", "Когда напоминать об утренней таблетке?")),
      ask: (x, act) => <SingleSelect locale={x.l} legend={t(x.l, c("Առավոտյան հիշեցում", "Morning reminder", "Утреннее напоминание"))} options={["07:00", "07:45", "08:00", "08:30", "09:00"].map(v => ({ value: v, label: v }))} onAnswer={(v, s) => act.answer(s, v)} />,
    },
    {
      id: "pm", at: "12:02", say: say(c("Իսկ երեկոյանի՞։", "And the evening one?", "А о вечерней?")), writes: true,
      ask: (x, act) => <SingleSelect locale={x.l} legend={t(x.l, c("Երեկոյան հիշեցում", "Evening reminder", "Вечернее напоминание"))} options={["20:00", "21:00", "22:00"].map(v => ({ value: v, label: v }))}
        next={t(x.l, c("Պահել ժամերը", "Save these times", "Сохранить время"))} onAnswer={(v, s) => act.answer(s, v)} />,
    },
    {
      id: "set", at: "12:03",
      lead: x => <UndoRow locale={x.l} text={t(x.l, c(`Հիշեցումներ՝ ${x.answers.am} և ${x.answers.pm}`, `Reminders at ${x.answers.am} and ${x.answers.pm}`, `Напоминания в ${x.answers.am} и ${x.answers.pm}`))} />,
      say: say(c("Կհիշեցնեմ միայն այն դեպքում, եթե դեղահաբը նշված չլինի։", "I only nudge you if a tablet is not logged.", "Я напомню, только если таблетка не отмечена.")),
      next: () => null,
    },
  ],
};

// ---------- 8. Side-effect reports (#402's list, its message and the medicine ask's reply) ----------
const sideEffect: Journey = {
  key: "side",
  chip: CHIP.side_effect,
  steps: [
    {
      id: "what", at: "14:10", day: TODAY, say: x => [t(x.l, TITLE.side_effect)],
      ask: (x, act) => <SingleSelect locale={x.l} legend={t(x.l, SIDE.pick)} options={SIDE_EFFECTS.map(s => ({ value: s, label: t(x.l, SIDE_EFFECT[s]) }))} onAnswer={(v, s) => act.answer(s, v)} />,
    },
    {
      id: "detail", at: "14:11", writes: true,
      say: say(c("Ուզո՞ւմ եք ինչ-որ բան ավելացնել։ Երբ սկսվեց, որքան ուժեղ է։", "Anything to add? When it started, how strong it is.", "Хотите что-то добавить? Когда началось, насколько сильно.")),
      ask: (x, act) => {
        const what = x.answers.what as SideEffect;
        return <TextThenConfirm locale={x.l} label={t(x.l, what === "other" ? SIDE.detailOther : SIDE.detail)} optional={what !== "other"}
          compose={d => sideEffectMessage(x.l, what, d)} onAnswer={(v, s) => act.answer(s, v)} />;
      },
    },
    { id: "sent", at: "14:12", say: x => [ask(x.l).doctor.sideEffect, ask(x.l).doctor.urgent], next: () => null },
  ],
};

// ---------- 9. Messaging the team ----------
const message: Journey = {
  key: "message",
  chip: CHIP.message,
  steps: [
    {
      id: "write", at: "15:30", day: TODAY, writes: true,
      say: say(c("Ի՞նչ կուզեիք ասել ձեր խնամքի թիմին։", "What would you like to tell your care team?", "Что вы хотите сказать вашей медицинской команде?")),
      ask: (x, act) => <TextThenConfirm locale={x.l} label={t(x.l, MESSAGE.label)} compose={d => d} onAnswer={(v, s) => act.answer(s, v)} />,
    },
    { id: "sent", at: "15:31", say: x => [t(x.l, MESSAGE.sent)] },
    {
      id: "reply", at: "16:05", voice: NURSE,
      say: say(c("Բարև, կարդացի ձեր հաղորդագրությունը։ Այսօր կեսօրից հետո կզանգեմ։", "Hello, I have read your message. I will call you this afternoon.", "Здравствуйте, я прочитала ваше сообщение. Позвоню вам сегодня после обеда.")),
      next: () => null,
    },
  ],
};

// ---------- States: every primitive in each of its states, side by side ----------
const states: Journey = {
  key: "states",
  chip: c("Բոլոր վիճակները", "All states", "Все состояния"),
  steps: [
    {
      id: "gallery", at: "10:00",
      say: say(c("Ահա այն վիճակները, որոնցում կարող է լինել յուրաքանչյուր քարտ։", "These are the states every card and control can be in.", "Вот состояния, в которых может быть каждая карточка и элемент.")),
      card: x => (
        <>
          <Card locale={x.l} icon={FlaskConical} title={t(x.l, c("Բեռնվում է", "Loading", "Загрузка"))} state="loading" />
          <Typing locale={x.l} />
          <Card locale={x.l} icon={HeartPulse} title={t(x.l, c("Սխալ և կրկնում", "Error and retry", "Ошибка и повтор"))}>
            <p role="alert" className="zk-alertline">{t(x.l, KIT.saveFailed)}</p>
            <div className="zk-actions"><Primary>{t(x.l, KIT.retry)}</Primary></div>
          </Card>
          <Card locale={x.l} icon={ListChecks} title={t(x.l, c("Անհասանելի", "Disabled", "Недоступно"))}>
            <div className="zk-actions"><Primary disabled why={t(x.l, KIT.chooseOne)}>{t(x.l, KIT.next)}</Primary></div>
          </Card>
          <Card locale={x.l} icon={Pill} title={t(x.l, c("Արված է", "Done", "Готово"))} tone="ok"><UndoRow locale={x.l} text={t(x.l, c("Ընդունված է, 08:02", "Taken at 08:02", "Принято в 08:02"))} /></Card>
          <Card locale={x.l} icon={ClipboardList} title={t(x.l, c("Ձեր պլանը, տարբերակ 1", "Your plan, version 1", "Ваш план, версия 1"))} state="stale" current={{ href: "#plan" }} asOf="23.10, 12:00">
            <p className="zk-plain">{t(x.l, c("Առավոտյան, 08:00, 1 դեղահաբ", "Morning, 08:00: 1 tablet", "Утром, 08:00: 1 таблетка"))}</p>
          </Card>
          <MemberBubble locale={x.l} text={t(x.l, c("Կարո՞ղ եմ սուրճ խմել դեղից հետո", "Can I have coffee after the tablet?", "Можно пить кофе после таблетки?"))} state="sending" />
          <MemberBubble locale={x.l} text={t(x.l, c("Կարո՞ղ եմ սուրճ խմել դեղից հետո", "Can I have coffee after the tablet?", "Можно пить кофе после таблетки?"))} state="failed" onRetry={() => undefined} />
          <WhereCard locale={x.l} icon={MapIcon} title={t(x.l, c("Որտեղ եք հիմա", "Where you are", "Где вы сейчас"))} steps={[
            { state: "done", title: t(x.l, c("Հարցեր", "Questions", "Вопросы")), detail: t(x.l, c("Ուղարկված է 12.10", "Sent 12.10", "Отправлено 12.10")) },
            { state: "done", title: t(x.l, c("Անալիզներ և չափումներ", "Tests and readings", "Анализы и измерения")), detail: t(x.l, c("Ավարտված է 20.10", "Finished 20.10", "Завершено 20.10")) },
            { state: "now", title: t(x.l, c("Ձեր պլանը", "Your plan", "Ваш план")), detail: t(x.l, c("Դեղեր և հիշեցումներ", "Medicines and reminders", "Лекарства и напоминания")) },
            { state: "next", title: t(x.l, c("Ստուգում 8 շաբաթից", "Check-up at 8 weeks", "Проверка через 8 недель")), detail: t(x.l, c("Արյան անալիզ և ճնշման շաբաթ", "Blood test and a BP week", "Анализ крови и неделя давления")) },
          ]} />
          <EmergencyCard locale={x.l} focus={false}
            body={t(x.l, c("Ցույց է տրվում միայն այն ժամանակ, երբ Zoe-ի անվտանգության ստուգումները բացում են շտապ ուղին։ Այստեղ՝ որպես նմուշ։", "Shown only when Zoe's safety checks open the urgent route. Here as a sample.", "Показывается только когда проверки безопасности Zoe открывают экстренный маршрут. Здесь как образец."))} />
        </>
      ),
      next: () => null,
    },
  ],
};

export const JOURNEYS: Journey[] = [questionnaire, booking, dose, bp, results, goal, plan, sideEffect, message, states];
