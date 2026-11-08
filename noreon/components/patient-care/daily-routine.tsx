import { Activity, Bell, Pill, ShieldCheck } from 'lucide-react';
import {memberInstruction} from '@/lib/text-language';
import type { PatientLocale } from '@/lib/patient/copy';
import type { ReminderOccurrence } from '@/lib/patient-care/reminders';
import type { Medication } from '@/lib/patient-care/types';
import { formatMemberDate } from '@/lib/patient/date-format';
import { CareLink, copy, Status, stamp } from './common';
import { DoseButtons } from './controls';

/** Display grouping never changes the guarded order, dose time or revision. */
const orderKey = (m: Medication) => JSON.stringify([m.id, m.planId, m.originatingPlanId, m.effectiveAt, m.name, m.dose, m.instructions, m.times, m.startDate, m.endDate, m.active]);
export function groupRoutine(occurrences: ReminderOccurrence[]) {
  const groups: {key: string; rows: ReminderOccurrence[]}[] = [];
  const index = new Map<string, typeof groups[number]>();
  for (const r of occurrences) {
    const m = r.dose?.medication;
    const key = r.kind === 'blood-pressure' ? 'blood-pressure' : m
      ? orderKey(m)
      : r.id;
    const group = index.get(key);
    if (group) group.rows.push(r);
    else { const next = {key, rows: [r]}; groups.push(next); index.set(key, next); }
  }
  return groups;
}
function occurrenceLabel(r: ReminderOccurrence, l: PatientLocale) {
  return r.status === 'completed' ? copy(l, r.kind === 'medication' ? 'Reported taken' : 'Recorded', r.kind === 'medication' ? 'Գրանցված է՝ ընդունված' : 'Գրանցված', r.kind === 'medication' ? "Отмечено как принято" : "Записано")
    : r.status === 'skipped' ? copy(l, 'Reported skipped', 'Գրանցված է՝ բաց թողնված', "Отмечено как пропущено")
    : r.status === 'due' ? copy(l, r.kind === 'blood-pressure' ? 'Reminder due' : 'Due', r.kind === 'blood-pressure' ? 'Հիշեցման ժամը հասել է' : 'Ժամը հասել է', r.kind === 'blood-pressure' ? "Время напоминания наступило" : "Время наступило") : copy(l, r.kind === 'blood-pressure' ? 'Reminder later' : 'Upcoming', r.kind === 'blood-pressure' ? 'Հիշեցումն ավելի ուշ' : 'Առաջիկա', r.kind === 'blood-pressure' ? "Напоминание позже" : "Предстоит");
}
const time = (value: string, l: PatientLocale) => formatMemberDate(value, l, {hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZone:'Asia/Yerevan'});
const day = (value: string) => formatMemberDate(value, 'en', {year:'numeric',month:'2-digit',day:'2-digit',timeZone:'Asia/Yerevan'});

/** `hasPlan`: a published care plan exists; without one the empty state does not point to it (Gohar D-003). */
export function RoutineCheckIns({occurrences, locale:l, hasPlan}: {occurrences: ReminderOccurrence[]; locale: PatientLocale; hasPlan: boolean}) {
  const groups = groupRoutine(occurrences);
  const slots = new Map<number, ReminderOccurrence[]>();
  for (const row of occurrences) {
    const at = Date.parse(row.reminderAt), rows = slots.get(at);
    if (rows) rows.push(row); else slots.set(at, [row]);
  }
  const orderedSlots = [...slots.entries()].sort(([a],[b])=>a-b);
  const shownInstructions = new Set<string>();
  return groups.length ? <div className="space-y-4">
    <div className="divide-y divide-border/70">{orderedSlots.map(([at, rows]) => <section key={at} className="grid grid-cols-[3rem_minmax(0,1fr)] gap-3 py-4 first:pt-0 last:pb-0" aria-label={time(rows[0].reminderAt,l)}>
      <div className="border-r border-border pr-2"><p className="text-caption font-semibold tabular-nums text-brand-navy">{time(rows[0].reminderAt,l)}</p></div>
      <div className="min-w-0 space-y-4">{rows.map(r => {
        const medication = r.dose?.medication, bp = r.kind === 'blood-pressure';
        const showInstructions = !!medication && !shownInstructions.has(orderKey(medication));
        if (medication) shownInstructions.add(orderKey(medication));
        return <article key={r.id} className="min-w-0 space-y-2">
          <div className="flex items-start gap-2">
            <span className="mt-0.5 text-brand-navy">{bp ? <Activity className="size-4" aria-hidden/> : <Pill className="size-4" aria-hidden/>}</span>
            <div className="min-w-0 flex-1"><h3 className="break-words text-body2 font-semibold">{bp ? copy(l,'Blood pressure','Արյան ճնշում', "Артериальное давление") : medication?.name ?? copy(l,'Medicine check-in','Դեղի ընդունման գրառում', "Отметка о приёме лекарства")}</h3>
              {(medication || r.status === 'upcoming') && <p className="mt-1 break-words text-caption text-muted-foreground">{medication?.dose}{r.status === 'upcoming' && <span className="inline-block whitespace-nowrap">{medication ? ' · ' : ''}{occurrenceLabel(r,l)}</span>}</p>}
            </div>
            {bp && r.status !== 'completed' && <CareLink href="/patient/measurements/new" icon={Activity}>{copy(l,'Record','Գրանցել', "Записать")}<span className="sr-only"> {copy(l,'blood pressure','արյան ճնշումը', "артериальное давление")}</span></CareLink>}
          </div>
          {medication && showInstructions && <section className="rounded-lg bg-muted/50 p-3">
            <h4 className="flex items-start gap-1.5 text-caption font-semibold"><ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden/>{copy(l,'Prescription instructions','Դեղի ընդունման ցուցումներ', "Указания по приёму лекарства")}</h4>
            <p className="mt-1 whitespace-pre-wrap break-words text-caption text-muted-foreground">{memberInstruction(medication.instructions,l,[medication.name])}</p>
          </section>}
          {r.status !== 'upcoming' && <div className="flex flex-wrap items-center gap-2"><Status tone={r.status === 'completed' ? 'complete' : r.status === 'due' ? 'due' : 'neutral'}>{occurrenceLabel(r,l)}</Status></div>}
          {r.dose && Date.parse(r.reminderAt) !== Date.parse(r.dueAt) && <p className="text-caption text-muted-foreground">{copy(l,'Recorded dose time','Գրանցված ընդունման ժամը', "Записанное время приёма")} · {day(r.reminderAt) === day(r.dueAt) ? time(r.dueAt,l) : stamp(r.dueAt,l)}</p>}
          {r.dose && <DoseButtons compact hideUpcomingNotice dose={r.dose} locale={l}/>}
        </article>;
      })}</div>
    </section>)}</div>
    {groups.some(group=>group.rows.some(r=>r.dose?.status === 'upcoming')) && <p className="text-caption text-muted-foreground">{copy(l,'Medicine check-ins open at the scheduled dose times. You can record blood pressure at any time.','Դեղերի ընդունումը կարող եք նշել նշանակված ժամերին։ Արյան ճնշումը կարող եք գրանցել ցանկացած պահի։', "Отмечать приём лекарств можно в назначенное время. Записывать артериальное давление можно в любое время.")}</p>}

  </div> : <p className="py-3 text-body2 text-muted-foreground">{hasPlan ? copy(l,'No check-ins scheduled today. Your care plan has your medicine instructions.','Այսօր գրառումներ նախատեսված չեն։ Դեղերի ցուցումները ձեր խնամքի պլանում են։', "На сегодня отметки не запланированы. Указания по приёму лекарств есть в вашем плане лечения.") : copy(l,'No check-ins scheduled today.','Այսօր գրառումներ նախատեսված չեն։', "На сегодня отметки не запланированы.")}</p>;
}

export function DailyRoutine({occurrences, locale:l, compact=false, hasPlan}: {occurrences:ReminderOccurrence[]; locale:PatientLocale; compact?:boolean; hasPlan:boolean}) {
  return <section id="daily-routine" className="journey-card space-y-4">
    <header className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="flex items-center gap-2 text-body1 font-semibold"><Bell className="size-5 text-brand-navy" aria-hidden/>{copy(l,compact?'Today’s check-ins':'Your daily routine',compact?'Այսօրվա գրառումները':'Ձեր ամենօրյա առօրյան', compact ? "Сегодняшние отметки" : "Ваш распорядок дня")}</h2>
      <span className="text-caption text-muted-foreground">{occurrences.length ? `${stamp(occurrences[0].reminderAt,l,false)} · ` : ''}{copy(l,'Armenia time','Հայաստանի ժամանակ', "Время Армении")}</span>
    </header>
    <RoutineCheckIns occurrences={occurrences} locale={l} hasPlan={hasPlan}/>
    <div className="flex flex-wrap gap-2 border-t pt-4">
      <CareLink href="/patient/account/reminders" icon={Bell}>{copy(l,'Reminder times','Հիշեցումների ժամերը', "Время напоминаний")}</CareLink>
      <CareLink href="/patient/health/monitor" icon={Activity}>{copy(l,'BP monitor','Ճնշման սարք', "Тонометр")}</CareLink>
    </div>
  </section>;
}
