import {bpUnit} from '@/lib/bp-unit';
import {unverifiedBpLabel} from "@/lib/patient/bp-provenance";
import type { ReactNode } from "react";
import type { Route } from "next";
import Link from "next/link";
import { Activity, AlertOctagon, AlertTriangle, ArrowLeft, Building2, CalendarDays, Check, CircleHelp, Circle, FileText, HeartPulse, House, MessageCircleQuestion, Phone, Pill, Route as RouteIcon, Target, Zap, type LucideIcon } from "lucide-react";
import { Call103 } from "@/components/patient/use-hydrated";
import { formatMemberDate } from "@/lib/patient/date-format";
import { tx, type PatientLocale } from "@/lib/patient/copy";
import type { JourneyKey, OverviewData, QuickTarget, StepState } from "@/lib/patient/overview";
import type { Urgency } from "@/lib/clinical/types";
import { OverviewBpChart } from "./overview-chart";

const THREAD = "/patient/chat";
const QUICK_HREF = { bp: `${THREAD}?card=bp`, upload: `${THREAD}?card=upload`, consult: `${THREAD}?card=consult` } as const satisfies Record<QuickTarget, Route>;

const unknownText = (l: PatientLocale) => tx(l, "Դեռ տրամադրված չէ", "Not provided yet", "Пока не указано");
const unavailableText = (l: PatientLocale) => tx(l, "Հիմա հասանելի չէ", "Not available right now", "Сейчас недоступно");
const day = (at: string, l: PatientLocale) => formatMemberDate(at.length === 10 ? `${at}T12:00:00+04:00` : at, l, { timeZone: "Asia/Yerevan", day: "numeric", month: "long", year: "numeric" });
const moment = (at: string, l: PatientLocale) => formatMemberDate(at, l, { timeZone: "Asia/Yerevan", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
const clock = (at: string, l: PatientLocale) => formatMemberDate(at, l, { timeZone: "Asia/Yerevan", hour: "2-digit", minute: "2-digit" });
const unit = (l: PatientLocale) => tx(l, "մմոլ/լ", "mmol/L", "ммоль/л");

function Card({ icon: Icon, title, id, children }: { icon: LucideIcon; title: string; id: string; children: ReactNode }) {
  return <section className="cv2-ov-card" aria-labelledby={`ov-${id}`} data-overview-section={id}>
    <h2 id={`ov-${id}`}><Icon size={17} aria-hidden />{title}</h2>
    {children}
  </section>;
}

/** Unknown is said out loud, with a way to add it in the chat. Never blank, never assumed normal. */
function Unknown({ l, what }: { l: PatientLocale; what: string }) {
  return <p className="cv2-ov-unknown"><span>{unknownText(l)}</span>
    <Link href={THREAD} aria-label={tx(l, `Ավելացնել զրույցում՝ ${what}`, `Add in chat: ${what}`, `Добавить в чате: ${what}`)}>{tx(l, "Ավելացնել", "Add", "Добавить")}</Link></p>;
}

function Row({ label, l, children }: { label: string; l: PatientLocale; children?: ReactNode }) {
  return <div className="cv2-ov-row"><dt>{label}</dt><dd data-unknown={children ? undefined : true}>{children ?? unknownText(l)}</dd></div>;
}

const ZONE: Record<Urgency, { icon: LucideIcon; label: (l: PatientLocale) => string }> = {
  green: { icon: Check, label: l => tx(l, "Կանաչ գոտի", "Green zone", "Зелёная зона") },
  yellow: { icon: Activity, label: l => tx(l, "Դեղին գոտի", "Yellow zone", "Жёлтая зона") },
  orange: { icon: AlertTriangle, label: l => tx(l, "Նարնջագույն գոտի", "Orange zone", "Оранжевая зона") },
  red: { icon: AlertOctagon, label: l => tx(l, "Կարմիր գոտի", "Red zone", "Красная зона") },
};

function ZoneChip({ zone, provisional, l }: { zone: Urgency | null; provisional: boolean; l: PatientLocale }) {
  if (!zone) return <span className="cv2-ov-chip" data-zone="none"><CircleHelp size={14} aria-hidden />{tx(l, "Գոտին դեռ հայտնի չէ", "Zone not known yet", "Зона пока неизвестна")}</span>;
  const { icon: Icon, label } = ZONE[zone];
  return <span className="cv2-ov-chip" data-zone={zone}><Icon size={14} aria-hidden />{label(l)}{provisional ? ` · ${tx(l, "դեռ հաստատված չէ", "not confirmed yet", "пока не подтверждено")}` : ""}</span>;
}

const STEP: Record<JourneyKey, (l: PatientLocale) => string> = {
  consent: l => tx(l, "Համաձայնություն", "Consent", "Согласие"),
  anamnesis: l => tx(l, "Առողջության հարցեր", "Health questions", "Вопросы о здоровье"),
  records: l => tx(l, "Փաստաթղթեր", "Records", "Документы"),
  labs: l => tx(l, "Անալիզներ", "Labs", "Анализы"),
  consult: l => tx(l, "Խորհրդատվություն", "Consult", "Консультация"),
  plan: l => tx(l, "Պլան", "Plan", "План"),
  monitoring: l => tx(l, "Հսկողություն", "Monitoring", "Наблюдение"),
};
const STEP_STATE: Record<StepState, (l: PatientLocale) => string> = {
  done: l => tx(l, "Արված է", "Done", "Готово"),
  current: l => tx(l, "Հիմա", "Now", "Сейчас"),
  next: l => tx(l, "Հաջորդը", "Next", "Далее"),
  missing: unknownText,
  unavailable: unavailableText,
};

function Journey({ data, l }: { data: OverviewData; l: PatientLocale }) {
  return <Card icon={RouteIcon} id="journey" title={tx(l, "Ձեր ուղին", "Your journey", "Ваш путь")}>
    <ol className="cv2-ov-steps">{data.journey.map(({ key, state }, i) => <li key={key} data-step={key} data-state={state} aria-current={state === "current" ? "step" : undefined}>
      <span className="cv2-ov-dot" aria-hidden>{state === "done" ? <Check size={14} /> : state === "missing" || state === "unavailable" ? <CircleHelp size={14} /> : i + 1}</span>
      <strong>{STEP[key](l)}</strong><em>{STEP_STATE[state](l)}</em>
    </li>)}</ol>
    <Link className="cv2-ov-primary" href={THREAD}>{tx(l, "Շարունակել զրույցում", "Continue in the chat", "Продолжить в чате")}</Link>
  </Card>;
}

function BloodPressure({ data, l }: { data: OverviewData; l: PatientLocale }) {
  const { last, mean, week, ranges, reported = [], counts } = data.bp;
  const hasChart = ranges[14].morning.count + ranges[14].evening.count > 0;
  const SourceIcon = last?.source === "clinic" ? Building2 : House;
  return <Card icon={HeartPulse} id="bp" title={tx(l, "Արյան ճնշում", "Blood pressure", "Артериальное давление")}>
    {last ? <>
      <p className="cv2-ov-value"><strong>{last.systolic}/{last.diastolic}</strong><small>{bpUnit(l)}</small></p>
      {last.zone && <p className="cv2-ov-chips"><ZoneChip zone={last.zone.level} provisional={last.zone.provisional} l={l} /></p>}
      <p className="cv2-ov-note"><SourceIcon size={14} aria-hidden />{last.source === "clinic" ? tx(l, "Չափվել է կլինիկայում", "Measured at the clinic", "Измерено в клинике") : tx(l, "Դուք եք գրանցել", "Entered by you", "Внесено вами")} · {moment(last.at, l)}</p>
    </> : <Unknown l={l} what={tx(l, "արյան ճնշում", "blood pressure", "артериальное давление")} />}
    {counts&&<p className="cv2-ov-note">{counts}</p>}
    {reported.length>0&&<ul className="cv2-ov-list">{reported.slice(0,3).map((r,i)=><li key={i} data-bp-provenance><strong>{r.systolic}/{r.diastolic} {bpUnit(l)}</strong><span>{unverifiedBpLabel(l)} · {moment(r.at,l)}</span></li>)}</ul>}
    <dl className="cv2-ov-rows">
      <Row l={l} label={tx(l, "7 օրվա ստուգված միջինը", "7-day verified average", "Среднее проверенных за 7 дней")}>{mean ? `${mean.systolic}/${mean.diastolic} ${bpUnit(l)}` : undefined}</Row>
      <Row l={l} label={tx(l, "Չափումների շաբաթ", "Measurement week", "Неделя измерений")}>{week ? tx(l, `Օր ${week.day}՝ ${week.days}-ից`, `Day ${week.day} of ${week.days}`, `День ${week.day} из ${week.days}`) : undefined}</Row>
    </dl>
    {hasChart && <OverviewBpChart locale={l} ranges={ranges} />}
  </Card>;
}

function Ldl({ data, l }: { data: OverviewData; l: PatientLocale }) {
  const ldl = data.ldl;
  return <Card icon={Target} id="ldl" title={tx(l, "ՑԽԼ խոլեստերին", "LDL cholesterol", "Холестерин ЛПНП")}>
    {!ldl.shown ? <p className="cv2-ov-plain" data-ldl-held>{tx(l, "Ձեր բժիշկը կդիտարկի ձեր արդյունքները", "Your doctor will review your results", "Ваш врач рассмотрит ваши результаты")}</p> : <>
      <dl className="cv2-ov-rows" data-ldl-values>
        <Row l={l} label={tx(l, "Սկզբնական", "Baseline", "Исходное значение")}>{ldl.baseline ? `${ldl.baseline.value} ${unit(l)}, ${day(ldl.baseline.on, l)}` : undefined}</Row>
        <Row l={l} label={tx(l, "Վերջին արդյունքը", "Latest result", "Последний результат")}>{ldl.current ? `${ldl.current.value} ${unit(l)}, ${day(ldl.current.on, l)}` : undefined}</Row>
        <Row l={l} label={tx(l, "Նվազեցում", "Reduction", "Снижение")}>{ldl.reduction ? `${ldl.reduction}%` : undefined}</Row>
        <Row l={l} label={tx(l, "Ձեր նպատակը", "Your goal", "Ваша цель")}>{tx(l, `${ldl.target} ${unit(l)}-ից ցածր`, `below ${ldl.target} ${unit(l)}`, `ниже ${ldl.target} ${unit(l)}`)}</Row>
      </dl>
      {!ldl.current && <Unknown l={l} what={tx(l, "ՑԽԼ արդյունք", "LDL result", "результат ЛПНП")} />}
    </>}
  </Card>;
}

const DOSE: Record<OverviewData["today"]["doses"][number]["status"], { icon: LucideIcon; label: (l: PatientLocale) => string }> = {
  taken: { icon: Check, label: l => tx(l, "Ընդունված է", "Taken", "Принято") },
  skipped: { icon: Circle, label: l => tx(l, "Բաց է թողնված", "Skipped", "Пропущено") },
  due: { icon: Pill, label: l => tx(l, "Ընդունելու ժամանակն է", "Time to take", "Пора принять") },
  upcoming: { icon: CalendarDays, label: l => tx(l, "Ավելի ուշ", "Later today", "Позже сегодня") },
};

function Today({ data, l }: { data: OverviewData; l: PatientLocale }) {
  const { doses, next, adherence } = data.today;
  return <Card icon={Pill} id="today" title={tx(l, "Այսօր", "Today", "Сегодня")}>
    {doses.length ? <ul className="cv2-ov-list">{doses.map(d => {
      const { icon: Icon, label } = DOSE[d.status];
      return <li key={d.key} data-dose={d.status}><strong>{clock(d.dueAt, l)} · {d.name}{d.dose ? `, ${d.dose}` : ""}</strong><span><Icon size={14} aria-hidden />{label(l)}</span></li>;
    })}</ul> : <Unknown l={l} what={tx(l, "դեղեր", "medicines", "лекарства")} />}
    <dl className="cv2-ov-rows">
      <Row l={l} label={tx(l, "Հաջորդ չափումը", "Next measurement", "Следующее измерение")}>{next ? `${day(next.date, l)}, ${next.time}` : undefined}</Row>
      {adherence.map(a => <Row key={a.key} l={l} label={tx(l, `${a.name}, վերջին ${a.days} օրը`, `${a.name}, last ${a.days} days`, `${a.name}, за ${a.days} дней`)}>
        {a.percent === null ? undefined : tx(l, `${a.percent}% (${a.taken}՝ ${a.expected}-ից)`, `${a.percent}% (${a.taken} of ${a.expected})`, `${a.percent}% (${a.taken} из ${a.expected})`)}
      </Row>)}
    </dl>
  </Card>;
}

function Upcoming({ data, l }: { data: OverviewData; l: PatientLocale }) {
  const { labs, visit, rechecks } = data.upcoming;
  const empty = !labs.length && !visit && !rechecks.length;
  return <Card icon={CalendarDays} id="upcoming" title={tx(l, "Առջևում", "Upcoming", "Впереди")}>
    {empty && <Unknown l={l} what={tx(l, "այց կամ անալիզներ", "a visit or tests", "визит или анализы")} />}
    {!empty && <ul className="cv2-ov-list">
      {visit && <li data-upcoming="visit"><strong>{tx(l, "Այց", "Visit", "Визит")}{visit.startsAt ? ` · ${moment(visit.startsAt, l)}` : ""}</strong>
        {visit.location && <span>{visit.location}</span>}{visit.preparation && <span>{visit.preparation}</span>}</li>}
      {labs.map(t => <li key={t.id} data-upcoming="lab"><strong>{t.title}{t.dueAt ? ` · ${day(t.dueAt, l)}` : ""}</strong>
        {t.location && <span>{t.location}</span>}
        <span>{tx(l, "Պատրաստում՝", "Preparation:", "Подготовка:")} {t.preparation ?? unknownText(l)}</span></li>)}
      {rechecks.map(r => <li key={r.key} data-upcoming="recheck"><strong>{tx(l, "Կրկնակի ՑԽԼ անալիզ", "LDL re-check", "Повторный анализ ЛПНП")}</strong>
        <span>{r.to ? `${day(r.from, l)} – ${day(r.to, l)}` : day(r.from, l)}</span></li>)}
    </ul>}
  </Card>;
}

function Documents({ data, l }: { data: OverviewData; l: PatientLocale }) {
  return <Card icon={FileText} id="documents" title={tx(l, "Փաստաթղթեր", "Documents", "Документы")}>
    {data.documents.length ? <ul className="cv2-ov-docs">{data.documents.map(d => <li key={d.key}>
      <strong>{d.name ?? tx(l, "Կլինիկայի փաստաթուղթ", "Clinic document", "Документ клиники")}</strong>
      <dl className="cv2-ov-rows">
        <Row l={l} label={tx(l, "Տեսակ", "Type", "Тип")} />
        <Row l={l} label={tx(l, "Ամսաթիվ", "Date", "Дата")}>{day(d.date, l)}</Row>
        <Row l={l} label={tx(l, "Վերբեռնել է", "Uploaded by", "Загрузил")}>{d.uploader === "you" ? tx(l, "Դուք", "You", "Вы") : d.clinic ?? tx(l, "Կլինիկա", "Clinic", "Клиника")}</Row>
        <Row l={l} label={tx(l, "Կարգավիճակ", "Status", "Статус")}>{d.released ? tx(l, "Տրամադրված է ձեզ", "Shared with you", "Доступно вам") : undefined}</Row>
      </dl>
    </li>)}</ul> : <Unknown l={l} what={tx(l, "փաստաթղթեր", "documents", "документы")} />}
  </Card>;
}

function QuickActions({ data, l }: { data: OverviewData; l: PatientLocale }) {
  const label: Record<QuickTarget, string> = {
    bp: tx(l, "Գրանցել ճնշումը", "Enter BP", "Записать давление"),
    upload: tx(l, "Վերբեռնել լուսանկար կամ PDF", "Upload photo or PDF", "Загрузить фото или PDF"),
    consult: tx(l, "Խնդրել խորհրդատվություն", "Request consult", "Запросить консультацию"),
  };
  return <Card icon={Zap} id="quick" title={tx(l, "Արագ գործողություններ", "Quick actions", "Быстрые действия")}>
    <div className="cv2-ov-actions">
      {data.quick.map(target => <Link key={target} className="cv2-ov-primary" href={QUICK_HREF[target]}>{label[target]}</Link>)}
      <Call103 size="call" className="cv2-ov-call" label={tx(l, "Զանգահարել 103", "Call 103", "Позвонить 103")}><Phone size={16} aria-hidden />{tx(l, "Զանգահարել 103", "Call 103", "Позвонить 103")}</Call103>
    </div>
  </Card>;
}

/** Read-only and separate from the thread. Every value comes from buildOverview on the server. */
export function MemberOverview({ locale: l, data }: { locale: PatientLocale; data: OverviewData }) {
  const practice = [data.doctor, data.clinic].filter(Boolean).join(" · ");
  return <main className="cv2-root cv2-overview" lang={l} data-chat-overview>
    <header className="cv2-header">
      <Link className="cv2-ov-back" href={THREAD}><ArrowLeft size={18} aria-hidden />{tx(l, "Զրույց", "Chat", "Чат")}</Link>
      <h1>{tx(l, "Իմ ամփոփումը", "My overview", "Мой обзор")}</h1>
      <Call103 size="pill" className="cv2-help" label={tx(l, "Զանգահարել 103", "Call 103", "Позвонить 103")}><Phone size={14} aria-hidden />103</Call103>
    </header>
    <div className="cv2-ov-scroll" tabIndex={0}>
      <div className="cv2-ov-content">
        <section className="cv2-ov-hello" aria-label={tx(l, "Ամփոփում", "Summary", "Сводка")}>
          <p className="cv2-ov-greeting">{data.greeting}</p>
          {practice && <p className="cv2-ov-note">{practice}</p>}
          <p className="cv2-ov-chips"><span className="cv2-ov-chip" data-plan={data.plan}>
            {data.plan === "approved" ? <Check size={14} aria-hidden /> : <CircleHelp size={14} aria-hidden />}
            {data.plan === "approved" ? tx(l, "Պլանը հաստատված է", "Plan approved", "План утверждён") : data.plan === "waiting" ? tx(l, "Սպասում է ձեր բժշկի հաստատմանը", "Waiting for your doctor's approval", "Ожидает утверждения вашим врачом") : unavailableText(l)}
          </span></p>
        </section>
        <Journey data={data} l={l} />
        <BloodPressure data={data} l={l} />
        <Ldl data={data} l={l} />
        <Today data={data} l={l} />
        <Upcoming data={data} l={l} />
        <Documents data={data} l={l} />
        <Card icon={MessageCircleQuestion} id="questions" title={tx(l, "Իմ հարցերը բժշկին", "My questions for the doctor", "Мои вопросы врачу")}>
          <p className="cv2-ov-plain">{tx(l, "Դուք դեռ հարցեր չեք պահել։", "You have no saved questions yet.", "У вас пока нет сохранённых вопросов.")}</p>
        </Card>
        <QuickActions data={data} l={l} />
      </div>
    </div>
  </main>;
}
