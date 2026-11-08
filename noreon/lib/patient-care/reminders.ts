import { armeniaDate, dosesForDay } from './model';
import type { CareData, DueDose } from './types';
import type { Measurement } from '@/lib/patient/types';
import { parseReminderPreferences, type ReminderPreferences } from './reminder-preferences';
export { DEFAULT_REMINDERS, parseReminderPreferences, updateReminderPreferences, type ReminderPreferences, type SavedReminderPreferences } from './reminder-preferences';
export type ReminderOccurrence = {
    id: string;
    kind: 'medication' | 'blood-pressure';
    dueAt: string;
    reminderAt: string;
    status: 'upcoming' | 'due' | 'completed' | 'skipped';
    dose?: DueDose;
};
/** Times are organizational reminders, never prescriptions or measurement targets. */
export function dailyReminders(care: CareData, measurements: Measurement[], preferences: ReminderPreferences, now: Date): ReminderOccurrence[] {
    const p = parseReminderPreferences(preferences), day = armeniaDate(now), start = Date.parse(`${day}T00:00:00+04:00`), end = start + 86400000;
    const rows: ReminderOccurrence[] = [];
    if (p.medicationEnabled) {
        for (const delta of [-1, 0, 1])
            for (const dose of dosesForDay(care, new Date(now.getTime() + delta * 86400000))) {
                const due = Date.parse(dose.dueAt), reminder = due + p.medicationOffsetMinutes * 60000;
                if (!(reminder >= start && reminder < end))
                    continue;
                // dosesForDay uses its day probe's clock; derive eligibility from the actual clock.
                const doseStatus = dose.status === 'taken' ? 'taken' : dose.status === 'skipped' ? 'skipped' : due <= now.getTime() ? 'due' : 'upcoming';
                const status = doseStatus === 'taken' ? 'completed' : doseStatus === 'skipped' ? 'skipped' : reminder <= now.getTime() ? 'due' : 'upcoming';
                rows.push({ id: `medicine:${dose.medication.id}:${dose.dueAt}`, kind: 'medication', dueAt: dose.dueAt, reminderAt: new Date(reminder).toISOString(), status, dose: { ...dose, status: doseStatus } });
            }
    }
    if (p.bpEnabled)
        p.bpTimes.forEach((t, i) => {
            const due = Date.parse(`${day}T${t}:00+04:00`);
            // Start the first slot 15 minutes early. When adjacent early windows
            // overlap, split them at the midpoint; the half-open boundary assigns
            // an exact tie to the later reminder.
            const previousDue = i > 0 ? Date.parse(`${day}T${p.bpTimes[i - 1]}:00+04:00`) : null;
            const nextDue = i + 1 < p.bpTimes.length ? Date.parse(`${day}T${p.bpTimes[i + 1]}:00+04:00`) : null;
            const slotStart = previousDue === null
                ? Math.max(start, due - 15 * 60000)
                : Math.max(due - 15 * 60000, previousDue + (due - previousDue) / 2);
            const slotEnd = nextDue === null
                ? end
                : Math.max(nextDue - 15 * 60000, due + (nextDue - due) / 2);
            const done = measurements.some(m => {
                const at = Date.parse(m.measuredAt);
                return at >= slotStart && at <= due + 60 * 60000 && at < slotEnd && at <= now.getTime();
            });
            rows.push({ id: `bp:${day}:${t}`, kind: 'blood-pressure', dueAt: new Date(due).toISOString(), reminderAt: new Date(due).toISOString(), status: done ? 'completed' : due <= now.getTime() ? 'due' : 'upcoming' });
        });
    return rows.sort((a, b) => a.reminderAt.localeCompare(b.reminderAt) || a.id.localeCompare(b.id));
}
/** The hero points to the actual task; reminder timing never changes dose eligibility. */
export function nextReminderAction(rows: ReminderOccurrence[]): import('./types').CareAction | null {
    const pending = rows.filter(r => r.status === 'due' || r.status === 'upcoming');
    const next = pending.find(r => r.status === 'due') ?? pending[0];
    if (!next)
        return null;
    const pair = (en: string, hy: string, ru: string) => ({ en, hy, ru });
    return next.kind === 'medication' ? {
        id: next.id, kind: 'medication', title: pair(next.status === 'due' ? 'Your medicine reminder' : 'Your next medicine reminder', next.status === 'due' ? 'Ձեր դեղի հիշեցումը' : 'Դեղի հաջորդ հիշեցումը', next.status === 'due' ? 'Ваше напоминание о лекарстве' : 'Ваше следующее напоминание о лекарстве'),
        detail: pair(`${next.dose!.medication.name} · ${next.dose!.medication.dose}. Follow the recorded dose schedule.`, `${next.dose!.medication.name} · ${next.dose!.medication.dose}։ Հետևեք գրանցված ընդունման ժամանակացույցին։`, `${next.dose!.medication.name} · ${next.dose!.medication.dose}. Следуйте записанному расписанию приёма.`),
        dueAt: next.reminderAt, href: '/patient/dashboard#daily-routine', button: pair('Open medicine check-in', 'Բացել դեղի ընդունման գրառումը', "Отметить приём лекарства"),
    } : { id: next.id, kind: 'measurement', title: pair(next.status === 'due' ? 'Your blood-pressure reminder' : 'Your next blood-pressure reminder', next.status === 'due' ? 'Ճնշման չափման հիշեցում' : 'Ճնշման չափման հաջորդ հիշեցումը', next.status === 'due' ? 'Ваше напоминание об измерении давления' : 'Ваше следующее напоминание об измерении давления'), detail: pair('A time you chose to record a measured reading.', 'Ձեր ընտրած ժամը՝ չափված արժեքը գրանցելու համար։', "Выбранное вами время для записи измеренного значения."), dueAt: next.reminderAt, href: '/patient/measurements/new', button: pair('Record blood pressure', 'Գրանցել ճնշումը', "Записать давление") };
}
