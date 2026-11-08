'use client';
import { useState, useTransition } from 'react';
import { Pill, HeartPulse, Clock3, Plus, Trash2, ChevronDown, type LucideIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { saveReminderPreferences } from '@/app/patient/care/actions';
import { safeRequest } from '@/lib/patient/transport';
import type { PatientLocale } from '@/lib/patient/copy';
import type { ReminderPreferences, SavedReminderPreferences } from '@/lib/patient-care/reminders';
import { copy, IconTile } from './common';
import {SelectField} from '@/components/ui/select-field';
function ReminderSwitch({ label, icon: Icon, checked, onChange }: {
    label: string; icon: LucideIcon; checked: boolean; onChange: (checked: boolean) => void;
}) {
    return <label className="flex min-h-11 cursor-pointer items-center gap-3 text-body2 font-semibold">
        <IconTile icon={Icon} /><span className="min-w-0 flex-1">{label}</span>
        <input type="checkbox" role="switch" aria-label={label} checked={checked} onChange={e => onChange(e.target.checked)} className="peer sr-only" />
        <span aria-hidden className="flex h-7 w-12 shrink-0 items-center rounded-full bg-muted-foreground/30 p-1 transition-colors peer-checked:bg-primary peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring peer-disabled:opacity-50 peer-checked:[&>span]:translate-x-5">
            <span className="size-5 rounded-full bg-background shadow-sm transition-transform" />
        </span>
    </label>;
}
function TimeSelector({ label, value, onChange, locale }: {
    label: string; value: string; onChange: (value: string) => void; locale: PatientLocale;
}) {
    const [hour, minute] = value.split(':');
    return <div className="min-w-0 space-y-2" role="group" aria-label={`${label}: ${value}`}>
        <p className="text-body2">{label}</p>
        <div className="flex items-center gap-2">
            <SelectField required className="w-28" aria-label={`${label}${locale === 'ru' ? ': ' : ' — '}${copy(locale, 'Hour', 'Ժամ', 'Час')}`} value={hour} onValueChange={h => onChange(`${h}:${minute}`)} searchPlaceholder={copy(locale, 'Hour', 'Ժամ', 'Час')} emptyText={copy(locale, 'No matches', 'Համընկնումներ չկան', 'Совпадений нет')} options={Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0')).map(h => ({ value: h, label: h }))} />
            <span aria-hidden className="text-body2 font-semibold">:</span>
            <SelectField required className="w-28" aria-label={`${label}${locale === 'ru' ? ': ' : ' — '}${copy(locale, 'Minute', 'Րոպե', 'Минута')}`} value={minute} onValueChange={m => onChange(`${hour}:${m}`)} searchPlaceholder={copy(locale, 'Minute', 'Րոպե', 'Минута')} emptyText={copy(locale, 'No matches', 'Համընկնումներ չկան', 'Совпадений нет')} options={Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0')).map(m => ({ value: m, label: m }))} />
        </div>
    </div>;
}
export function reminderSaveError(locale: PatientLocale, reason?: string) {
    if (reason === 'unknown') return copy(locale, 'We couldn’t confirm your save. Reload settings to check whether your changes were saved.', 'Չհաջողվեց հաստատել պահպանումը։ Վերաբեռնեք կարգավորումները՝ ստուգելու փոփոխությունները։', 'Не удалось подтвердить сохранение. Обновите настройки, чтобы проверить, сохранились ли изменения.');
    if (reason === 'conflict') return copy(locale, 'Your settings or case changed. Reload this page before saving again.', 'Ձեր կարգավորումները կամ դեպքը փոխվել են։ Կրկին պահպանելուց առաջ վերաբեռնեք էջը։', 'Ваши настройки или случай изменились. Обновите страницу перед повторным сохранением.');
    if (reason === 'invalid') return copy(locale, 'Not saved. Use distinct times in HH:mm format and try again.', 'Չպահվեց։ Օգտագործեք տարբեր ժամեր՝ HH:mm ձևաչափով և փորձեք կրկին։', 'Не сохранено. Укажите разные значения времени в формате HH:mm и попробуйте снова.');
    return copy(locale, 'Your settings could not be saved. Please try again.', 'Ձեր կարգավորումները չհաջողվեց պահպանել։ Խնդրում ենք փորձեք կրկին։', 'Не удалось сохранить ваши настройки. Попробуйте снова.');
}
export function ReminderSettings({ saved, locale: l, saveAction = saveReminderPreferences, onSaved }: {
    saved: SavedReminderPreferences;
    locale: PatientLocale;
    saveAction?: typeof saveReminderPreferences;
    onSaved?: () => void;
}) {
    const router = useRouter();
    const [preferences, setPreferences] = useState<ReminderPreferences>(() => structuredClone(saved.preferences));
    const [revision, setRevision] = useState(saved.revision);
    const [pending, start] = useTransition();
    const [message, setMessage] = useState('');
    const [savedSuccessfully, setSavedSuccessfully] = useState(false);
    const [conflict, setConflict] = useState(false);
    function change<K extends keyof ReminderPreferences>(key: K, value: ReminderPreferences[K]) { setPreferences(p => ({ ...p, [key]: value })); setMessage(''); setSavedSuccessfully(false); }
    const save = () => {
      if (conflict) return;
      start(async () => {
        setMessage('');
        setSavedSuccessfully(false);
        const result = await safeRequest(() => saveAction(preferences, revision));
        if (result?.ok) {
            setRevision(result.revision);
            setSavedSuccessfully(true);
            setMessage(copy(l, 'Reminder settings saved.', 'Հիշեցումների կարգավորումները պահպանված են։', 'Настройки напоминаний сохранены.'));
            if (onSaved) onSaved(); else router.refresh();
        }
        else {
            setConflict(result == null || (!!result && 'reason' in result && result.reason === 'conflict'));
            setMessage(reminderSaveError(l, result == null ? 'unknown' : 'reason' in result ? result.reason : undefined));
        }
      });
    };
    return <section id="reminders" className="space-y-4">
 <form onSubmit={e => { e.preventDefault(); save(); }} className="space-y-5">
 <fieldset disabled={pending || conflict} className="space-y-4">
 <section className="journey-card">
 <ReminderSwitch label={copy(l, 'Medicine reminders', 'Դեղերի հիշեցումներ', 'Напоминания о лекарствах')} icon={Pill} checked={preferences.medicationEnabled} onChange={checked => change('medicationEnabled', checked)} />
 <p className="text-caption text-muted-foreground">{copy(l, 'This does not change your medicine, dose or prescribed schedule.', 'Սա չի փոխում դեղը, դեղաչափը կամ նշանակված ժամանակացույցը։', 'Это не меняет ваши лекарства, дозы или назначенное расписание.')}</p>
 {preferences.medicationEnabled && <div className="mt-4 space-y-3" role="group" aria-label={copy(l, 'Remind me about each scheduled dose', 'Հիշեցնել յուրաքանչյուր նշանակված ընդունման մասին', 'Напоминать мне о каждой запланированной дозе')}>
 <p className="text-body2">{copy(l, 'Remind me about each scheduled dose', 'Հիշեցնել յուրաքանչյուր նշանակված ընդունման մասին', 'Напоминать мне о каждой запланированной дозе')}</p>
 <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
 {([
   { value: -15, label: copy(l, '15 min before', '15 ր առաջ', 'За 15 мин'), full: copy(l, '15 minutes before', '15 րոպե առաջ', 'За 15 минут') },
   { value: 0, label: copy(l, 'At dose time', 'Ընդունման ժամին', 'Во время приёма'), full: copy(l, 'At the recorded dose time', 'Գրանցված ընդունման ժամին', 'В записанное время приёма') },
   { value: 15, label: copy(l, '15 min after', '15 ր հետո', 'Через 15 мин'), full: copy(l, '15 minutes after', '15 րոպե հետո', 'Через 15 минут') },
 ] as const).map(option => <button key={option.value} type="button" aria-label={option.full} aria-pressed={preferences.medicationOffsetMinutes === option.value} onClick={() => change('medicationOffsetMinutes', option.value)} className={`min-h-11 min-w-0 rounded-md px-2 py-2 text-caption font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50 ${preferences.medicationOffsetMinutes === option.value ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:bg-background'}`}>{option.label}</button>)}
 </div>
 </div>}
 </section>
 <section className="journey-card">
 <ReminderSwitch label={copy(l, 'Blood-pressure reminders', 'Ճնշման չափման հիշեցումներ', 'Напоминания об измерении давления')} icon={HeartPulse} checked={preferences.bpEnabled} onChange={checked => change('bpEnabled', checked)} />
 {preferences.bpEnabled && <>
 <p className="mt-3 text-caption text-muted-foreground">{copy(l, 'Choose times that fit your routine. Follow your care plan’s monitoring instructions.', 'Ընտրեք ձեր առօրյային համապատասխան ժամերը։ Հետևեք խնամքի պլանի չափման ցուցումներին։', 'Выберите удобное время. Следуйте указаниям по измерениям в вашем плане лечения.')}</p>
 <div className="my-4 space-y-4">{preferences.bpTimes.map((time, i) => <div key={i} className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3">
 <div className="min-w-0 flex-1"><TimeSelector label={`${copy(l, 'Blood-pressure reminder', 'Ճնշման հիշեցում', 'Напоминание об измерении давления')} ${i + 1}`} value={time} locale={l} onChange={value => change('bpTimes', preferences.bpTimes.map((t, j) => j === i ? value : t))} /></div>
 {preferences.bpTimes.length > 1 && <Button className="size-11 shrink-0 p-0" type="button" variant="outline" onClick={() => change('bpTimes', preferences.bpTimes.filter((_, j) => j !== i))} aria-label={`${copy(l, 'Remove reminder', 'Հեռացնել հիշեցումը', 'Удалить напоминание')} ${i + 1}`}><Trash2 className="size-4" aria-hidden /></Button>}
 </div>)}</div>
 {preferences.bpTimes.length < 4 && <Button type="button" variant="outline" className="h-auto min-h-11 whitespace-normal" onClick={() => { const next = ['12:00', '16:00', '08:00', '20:00'].find(t => !preferences.bpTimes.includes(t)); if (next)
        change('bpTimes', [...preferences.bpTimes, next]); }}><Plus className="size-4" aria-hidden />{copy(l, 'Add reminder time', 'Ավելացնել հիշեցման ժամ', 'Добавить время напоминания')}</Button>}
 </>}
 </section>
 <p className="flex items-center gap-2 text-caption text-muted-foreground"><Clock3 className="size-4 shrink-0" aria-hidden />{copy(l, 'All times use Armenia time (UTC+4).', 'Բոլոր ժամերը՝ Հայաստանի ժամանակով (UTC+4)։', 'Всё время указано по Армении (UTC+4).')}</p>
 <details className="group rounded-xl border border-border/70 px-4">
 <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 py-3 text-body2 font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
 <span>{copy(l, 'Quiet hours for Telegram reminders', 'Լուռ ժամեր Telegram-ի հիշեցումների համար', 'Тихие часы для напоминаний в Telegram')}</span><ChevronDown className="size-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden />
 </summary>
 <div className="grid gap-4 pb-4 sm:grid-cols-2">
 <p className="text-caption text-muted-foreground sm:col-span-2">{copy(l, 'No medicine or blood pressure reminders are sent to you on Telegram between these times.', 'Այս ժամերին Telegram-ով դեղերի և ճնշման հիշեցումներ չեն ուղարկվում։', 'В этот промежуток времени вам не отправляются напоминания о лекарствах или давлении в Telegram.')}</p>
 <TimeSelector label={copy(l, 'Quiet hours start', 'Լուռ ժամերի սկիզբ', 'Начало тихих часов')} value={preferences.quietStart} locale={l} onChange={value => change('quietStart', value)} />
 <TimeSelector label={copy(l, 'Quiet hours end', 'Լուռ ժամերի ավարտ', 'Конец тихих часов')} value={preferences.quietEnd} locale={l} onChange={value => change('quietEnd', value)} />
 </div></details>
 <p className="text-caption text-muted-foreground">{copy(l, 'Reminders appear while you use Noreon and, when Telegram is connected, on Telegram. SMS and WhatsApp reminders are not available yet.', 'Հիշեցումները երևում են Նորեոն Հելթը օգտագործելիս, իսկ Telegram-ը միացնելու դեպքում՝ նաև Telegram-ում։ SMS և WhatsApp հիշեցումները դեռ հասանելի չեն։', 'Напоминания появляются, пока вы используете Нореон Хелс, а при подключённом Telegram также в Telegram. Напоминания по SMS и WhatsApp пока недоступны.')}</p>
 <Button type="submit" className="h-auto min-h-12 w-full whitespace-normal sm:w-auto" disabled={pending || conflict}>{pending ? copy(l, 'Saving…', 'Պահպանվում է…', 'Сохраняется…') : copy(l, 'Save reminder settings', 'Պահպանել հիշեցումները', 'Сохранить настройки напоминаний')}</Button>
 </fieldset>
 {message && <p role={savedSuccessfully ? 'status' : 'alert'} className="rounded-lg bg-muted p-3 text-body2">{message}</p>}
 <ReminderConflictRecovery conflict={conflict} locale={l} />
 </form></section>;
}

export function ReminderConflictRecovery({conflict, locale}: {conflict: boolean; locale: PatientLocale}) {
    if (!conflict) return null;
    return <Button type="button" variant="outline" className="h-auto min-h-11 whitespace-normal" onClick={() => window.location.reload()}>{copy(locale, 'Reload settings', 'Վերբեռնել կարգավորումները', 'Обновить настройки')}</Button>;
}
