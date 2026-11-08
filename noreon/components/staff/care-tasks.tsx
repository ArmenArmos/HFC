"use client";
import {outcomeLabels} from '@/lib/staff/care-note-copy';
import { useRef, useState, useTransition } from "react";
import { st, type StaffLocale } from "@/lib/staff/staff-locale-copy";
import { useOptionalDemoReports } from "@/components/service-workflow/reports-provider";
import { useRouter } from "next/navigation";
import { staffCareCommand, realStaffCareCommand, refreshRealCareTasks } from "@/lib/staff/nurse-actions";
import { stamp } from "@/components/patient-care/common";
import { buttonClass, fieldClass } from "./shell";
import { BpHighWarning } from "./bp-high-warning";
import {SelectField} from '@/components/ui/select-field';
export type CareNote = { id: string; actor_name: string; actor_role: string; kind: string; note: string; created_at: string };
export function CareTasks({ id, revision, native = false, notes = [], notesOnly = false, locale = "en" }: { id: string; revision: number; native?: boolean; notes?: CareNote[]; notesOnly?: boolean; locale?: StaffLocale }) {
  const t = (en: string, hy: string, ru: string) => st(locale, en, hy, ru);
  const outcomes = outcomeLabels[locale];
  const router = useRouter();
  const memory = useOptionalDemoReports();
  const [refreshRequired, setNeedsRefresh] = useState(false);
  const [confirmedRevision, setConfirmedRevision] = useState<number | null>(null);
  // router.refresh schedules a read; it does not confirm that new props arrived.
  const needsRefresh = refreshRequired && (!native || confirmedRevision === null || revision < confirmedRevision);
  const currentRevision = !native ? memory?.snapshot?.state.workspaceRevision ?? revision : revision;
  const unavailable = !native && (!memory?.loaded || !!memory.persistenceError);
  const lock = useRef(false);
  const [pending, start] = useTransition();
  const [active, setActive] = useState("");
  const [message, setMessage] = useState("");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [typed, setTyped] = useState({ systolic: "", diastolic: "" });
  function save(form: HTMLFormElement, op: "measurement" | "note") {
    if (lock.current || pending || needsRefresh || unavailable) return;
    const data = new FormData(form);
    const payload = op === "measurement" ? { submissionId: requestId, measuredAt: new Date(`${data.get("measuredAt")}+04:00`).toISOString(), systolic: Number(data.get("systolic")), diastolic: Number(data.get("diastolic")), ...(data.get("pulse") ? { pulse: Number(data.get("pulse")) } : {}) } : { kind: data.get("kind"), note: data.get("note") };
    lock.current = true;
    setMessage(""); setActive(op); setConfirmedRevision(null); setNeedsRefresh(false);
    start(async () => {
      try {
        const result = native ? await realStaffCareCommand({ id, revision, op, ...payload }) : await staffCareCommand({ caseId: id, caseRevision: currentRevision, op, ...payload });
        if (!result.ok) { setNeedsRefresh(!result.error?.startsWith("Check")); setMessage(t("Could not save. Your entries are retained.", "Չհաջողվեց պահպանել։ Մուտքագրվածը պահպանված է։", "Не удалось сохранить. Введенные данные сохранены в форме.")); return; }
        form.reset(); setRequestId(crypto.randomUUID());
        if (native) {
          setNeedsRefresh(true);
          setConfirmedRevision("revision" in result && typeof result.revision === "number" ? result.revision : revision + 1);
        }
        if (!native && memory) {
          setNeedsRefresh(true);
          try { if (!await memory.refresh()) { setMessage(t("Saved. The updated case could not load. Refresh before continuing.", "Պահպանված է։ Թարմացված գործը չբեռնվեց։ Շարունակելուց առաջ թարմացրեք։", "Сохранено. Не удалось загрузить обновленный случай. Обновите страницу перед продолжением.")); return; } }
          catch { setMessage(t("Saved. The updated case could not load. Refresh before continuing.", "Պահպանված է։ Թարմացված գործը չբեռնվեց։ Շարունակելուց առաջ թարմացրեք։", "Сохранено. Не удалось загрузить обновленный случай. Обновите страницу перед продолжением.")); return; }
          setNeedsRefresh(false);
        }
        setMessage(t("Saved.", "Պահպանված է։", "Сохранено.")); router.refresh();
      } catch { setNeedsRefresh(true); setMessage(t("The result could not be confirmed. Refresh before trying again. Your entries are retained.", "Արդյունքը չհաստատվեց։ Կրկին փորձելուց առաջ թարմացրեք։ Մուտքագրվածը պահպանված է։", "Не удалось подтвердить результат. Обновите страницу перед тем, как попробовать снова. Введенные данные сохранены в форме.")); }
      finally { lock.current = false; setActive(""); }
    });
  }
  return <section className="space-y-4 rounded-xl border bg-card p-5" lang={locale} aria-label={t("Care team tasks", "Բուժող թիմի առաջադրանքներ", "Задачи медицинской команды")}>
    <h2 className="text-h2">{notesOnly?t("Factual notes", "Փաստական նշումներ", "Фактические заметки"):t("Care team tasks", "Բուժող թիմի առաջադրանքներ", "Задачи медицинской команды")}</h2>
    <p className="text-caption text-muted-foreground">{t("Doctor and nurse access · recorded observations and contact, without changing treatment.", "Բժշկի և բուժքրոջ համար · գրանցված դիտարկումներ և կապ՝ առանց բուժումը փոխելու։", "Доступ для врача и медсестры · регистрация наблюдений и контактов без изменения лечения.")}</p>
    <div className={notesOnly?"space-y-3":"grid gap-4 lg:grid-cols-2"}>
      {!notesOnly&&<details className="rounded-lg border p-4"><summary className="min-h-11 cursor-pointer font-medium">{t("Record a measurement", "Գրանցել չափում", "Записать измерение")}</summary>
        <form className="mt-3 space-y-4" onSubmit={e => { e.preventDefault(); save(e.currentTarget, "measurement"); }}>
          <fieldset disabled={pending || needsRefresh || unavailable} className="grid gap-3 sm:grid-cols-2">
            <label className="text-body2 sm:col-span-2">{t("Measured at, Armenia time", "Չափման ժամը՝ Հայաստանի ժամով", "Время измерения, по времени Армении")}<input name="measuredAt" type="datetime-local" required className={fieldClass} /></label>
            <label className="text-body2">{t("Systolic, mmHg", "Սիստոլիկ, մմ ս.ս.", "Систолическое, мм рт. ст.")}<input name="systolic" type="number" min={60} max={300} required onChange={e => setTyped(v => ({ ...v, systolic: e.target.value }))} className={fieldClass} /></label>
            <label className="text-body2">{t("Diastolic, mmHg", "Դիաստոլիկ, մմ ս.ս.", "Диастолическое, мм рт. ст.")}<input name="diastolic" type="number" min={30} max={200} required onChange={e => setTyped(v => ({ ...v, diastolic: e.target.value }))} className={fieldClass} /></label>
            <label className="text-body2">{t("Pulse, beats/min (optional)", "Զարկերակ, զարկ/րոպե (ոչ պարտադիր)", "Пульс, уд/мин (необязательно)")}<input name="pulse" type="number" min={20} max={250} className={fieldClass} /></label>
          </fieldset>
          <BpHighWarning systolic={typed.systolic} diastolic={typed.diastolic} locale={locale} />
          <button className={buttonClass} disabled={pending || needsRefresh || unavailable} aria-busy={pending && active === "measurement"}>{pending && active === "measurement" ? t("Saving measurement…", "Չափումը պահպանվում է…", "Измерение сохраняется…") : t("Save measurement", "Պահպանել չափումը", "Сохранить измерение")}</button>
        </form>
      </details>}
      <details open={notesOnly} className="rounded-lg border p-4"><summary className="min-h-11 cursor-pointer font-medium">{t("Record evidence or contact", "Գրանցել տվյալներ կամ կապ", "Записать данные или контакт")}</summary>
        <form className="mt-3 space-y-4" onSubmit={e => { e.preventDefault(); save(e.currentTarget, "note"); }}>
          <fieldset disabled={pending || needsRefresh || unavailable} className="space-y-3">
            <label className="block text-body2">{t("Outcome", "Արդյունք", "Результат")}<SelectField name="kind" className="mt-1" options={Object.entries(outcomes).filter(([value]) => value !== "measurement").map(([value, label]) => ({ value, label }))}/></label>
            {notesOnly&&<div className="space-y-2"><p className="text-caption">{t("Add only what you observed. Edit the phrase before saving. The doctor can read your note.","Ավելացրեք միայն ձեր դիտարկածը։ Պահպանելուց առաջ խմբագրեք արտահայտությունը։ Բժիշկը կարող է կարդալ ձեր նշումը։","Добавляйте только то, что наблюдали. Отредактируйте фразу перед сохранением. Врач может прочитать заметку.")}</p><div className="flex flex-wrap gap-2">{[t("Cuff delivered, technique checked.","Ճնշման սարքը հանձնված է, չափման տեխնիկան՝ ստուգված։","Тонометр передан, техника измерения проверена."),t("Blood sample taken.","Արյան նմուշը վերցված է։","Образец крови взят."),t("Home visit.","Տնային այց։","Визит на дом."),t("Phone call.","Հեռախոսազանգ։","Телефонный звонок.")].map(phrase=><button key={phrase} type="button" className="min-h-11 rounded-md border px-3 text-body2" onClick={event=>{const input=event.currentTarget.form?.elements.namedItem('note') as HTMLTextAreaElement|null;if(input){input.value=[input.value,phrase].filter(Boolean).join(' ').slice(0,1500);input.focus();}}}>{phrase}</button>)}</div></div>}
            <label className="block text-body2">{t("Notes", "Նշումներ", "Заметки")}<textarea name="note" maxLength={1500} required className={`${fieldClass} min-h-24`} /></label>
          </fieldset>
          <p className="text-caption text-muted-foreground">{t("Recording contact does not send a message or clinically approve a result.", "Կապի գրանցումը հաղորդագրություն չի ուղարկում և արդյունքը կլինիկորեն չի հաստատում։", "Регистрация контакта не отправляет сообщение и не означает клинического утверждения результата.")}</p>
          <button className={buttonClass} disabled={pending || needsRefresh || unavailable} aria-busy={pending && active === "note"}>{pending && active === "note" ? t("Saving note…", "Նշումը պահպանվում է…", "Заметка сохраняется…") : t("Save note", "Պահպանել նշումը", "Сохранить заметку")}</button>
        </form>
      </details>
    </div>
    {message && <p role="status" className="text-body2">{message}</p>}
    {(needsRefresh || unavailable) && <div className="space-y-2"><p className="text-caption text-muted-foreground">{t("Load current evidence before recording another change.", "Նոր փոփոխություն գրանցելուց առաջ բեռնեք ընթացիկ տվյալները։", "Загрузите текущие данные перед записью следующего изменения.")}</p><button type="button" disabled={pending} className="min-h-11 rounded-md border px-4 text-body2" onClick={() => start(async () => { try { if (native) {
        const result = await refreshRealCareTasks(id);
        if (!result.ok || result.revision === undefined) { setMessage(t("The case could not load. Your entries are retained.", "Գործը չբեռնվեց։ Մուտքագրվածը պահպանված է։", "Не удалось загрузить случай. Введенные данные сохранены в форме.")); return; }
        setConfirmedRevision(result.revision);
        router.refresh();
        setMessage(t("Current evidence loaded. Check the recorded outcome before trying again.", "Ընթացիկ տվյալները բեռնված են։ Կրկին փորձելուց առաջ ստուգեք գրանցված արդյունքը։", "Текущие данные загружены. Проверьте записанный результат перед тем, как попробовать снова."));
      } else if (memory && await memory.refresh()) { router.refresh(); setNeedsRefresh(false); setMessage(t("Current evidence loaded. Check the recorded outcome before trying again.", "Ընթացիկ տվյալները բեռնված են։ Կրկին փորձելուց առաջ ստուգեք գրանցված արդյունքը։", "Текущие данные загружены. Проверьте записанный результат перед тем, как попробовать снова.")); } } catch { setMessage(t("The case could not load. Your entries are retained.", "Գործը չբեռնվեց։ Մուտքագրվածը պահպանված է։", "Не удалось загрузить случай. Введенные данные сохранены в форме.")); } })}>{t("Refresh care tasks", "Թարմացնել առաջադրանքները", "Обновить задачи медицинской команды")}</button></div>}
    <details><summary className="min-h-11 cursor-pointer text-body2">{t("Care team notes", "Բուժող թիմի նշումներ", "Заметки медицинской команды")} ({notes.length})</summary>{notes.length ? <ol className="divide-y">{notes.map(note => <li key={note.id} className="space-y-1 py-3"><p className="text-body2 font-medium">{outcomes[note.kind as keyof typeof outcomes] || note.kind}</p><p className="whitespace-pre-wrap text-body2">{note.note}</p><p className="text-caption text-muted-foreground">{note.actor_name} · {note.actor_role === "nurse" ? t("nurse", "բուժքույր", "медсестра") : note.actor_role === "doctor" ? t("doctor", "բժիշկ", "врач") : note.actor_role} · {stamp(note.created_at, locale)}</p></li>)}</ol> : <p className="text-body2 text-muted-foreground">{t("No notes recorded.", "Նշումներ գրանցված չեն։", "Заметок пока нет.")}</p>}</details>
  </section>;
}
