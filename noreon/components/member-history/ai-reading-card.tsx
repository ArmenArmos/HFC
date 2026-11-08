"use client";
import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Clock, FileSearch, Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { copy } from "@/components/patient-care/common";
import type { PatientLocale } from "@/lib/patient/copy";
import { clinicalLocale } from "@/lib/locale";
import { analyteDisplayName } from "@/lib/lab-ai/analyte-names";
import { yerevanToday } from "@/lib/member-history/measures";
import { resultsCopy } from "@/lib/member-history/lab-results-copy";
import { chartValueProblem, memberEditVersion, memberIdentityVersion, type EditCommand, type IdentityCommand, type MemberCommandResult, type MemberReading, type ReadingState } from "@/lib/member-history/ai-reading";

/** review: the doctor's check of a saved reading (20261021070050); absent or not_required keeps the member's own Edit. */
export type ReadingCardItem = { documentId: string; fileName: string; state: ReadingState; jobId?: string; saved: number; charted: number; reading?: MemberReading | null; review?: "not_required" | "waiting" | "approved" };
type Answer = (input: IdentityCommand) => Promise<MemberCommandResult>;
type Edit = (input: EditCommand) => Promise<MemberCommandResult>;

const card = "journey-card scroll-mt-24 space-y-4 rounded-2xl border border-border/70 bg-card p-5 shadow-sm sm:p-6";
const POLL_MS = 8_000, POLL_FOR_MS = 6 * 60_000;

/** One card per recent upload: reading, saved (with Edit), "Is this yours?", or could not read. Never silence. */
export function ReadingCards({ locale: l, items, answer, edit }: { locale: PatientLocale; items: ReadingCardItem[]; answer: Answer; edit: Edit }) {
  const router = useRouter();
  const waiting = items.some((i) => i.state === "reading" || i.state === "slow");
  useEffect(() => {
    if (!waiting) return;
    const started = Date.now();
    const timer = setInterval(() => { if (Date.now() - started > POLL_FOR_MS) clearInterval(timer); else router.refresh(); }, POLL_MS);
    return () => clearInterval(timer);
  }, [waiting, router]);
  if (!items.length) return null;
  return <div className="space-y-4">{items.map((i) => <ReadingCard key={i.documentId} locale={l} item={i} answer={answer} edit={edit} />)}</div>;
}

function Title({ icon, children, id }: { icon: React.ReactNode; children: React.ReactNode; id: string }) {
  return <h2 id={id} className="flex items-start gap-2 text-h3">{icon}<span>{children}</span></h2>;
}

const failures: Record<string, [string, string, string]> = {
  invalid: ["Some values could not be saved. Check the numbers and the date, then try again.", "Որոշ արժեքներ հնարավոր չեղավ պահպանել։ Ստուգեք թվերը և ամսաթիվը, ապա կրկին փորձեք։", "Некоторые значения не удалось сохранить. Проверьте числа и дату, затем попробуйте ещё раз."],
  stale: ["This file changed. Reload the page.", "Այս ֆայլը փոխվել է։ Թարմացրեք էջը։", "Файл изменился. Обновите страницу."],
  unchanged: ["You already answered for this file.", "Այս ֆայլի համար արդեն պատասխանել եք։", "Вы уже ответили для этого файла."],
  disabled: ["Reading files is switched off right now. Your doctor can still open the file.", "Ֆայլերի կարդալն այս պահին անջատված է։ Ձեր բժիշկը, միևնույն է, կարող է բացել ֆայլը։", "Распознавание файлов сейчас выключено. Ваш врач по-прежнему может открыть файл."],
  access: ["Sign in again to save.", "Մուտք գործեք կրկին՝ պահպանելու համար։", "Войдите снова, чтобы сохранить."],
  unavailable: ["Couldn’t save. Try again.", "Չհաջողվեց պահպանել։ Փորձեք կրկին։", "Не удалось сохранить. Попробуйте ещё раз."],
};
const failure = (l: PatientLocale, status: string) => { const f = failures[status] ?? failures.unavailable!; return copy(l, f[0], f[1], f[2]); };
const editHref = (documentId: string) => `/patient/progress/earlier?edit=${documentId}#reading-${documentId}`;

function ReadingCard({ locale: l, item, answer, edit }: { locale: PatientLocale; item: ReadingCardItem; answer: Answer; edit: Edit }) {
  const id = useId();
  const file = <p className="break-all text-caption text-muted-foreground">{item.fileName}</p>;
  const section = (children: React.ReactNode, status = false) => <section id={`reading-${item.documentId}`} className={card} aria-labelledby={id} role={status ? "status" : undefined}>{children}</section>;
  if (item.state === "reading" || item.state === "slow")
    return section(<>
      <Title id={id} icon={<Loader2 aria-hidden className={`mt-1 size-5 shrink-0 ${item.state === "reading" ? "motion-safe:animate-spin" : ""}`} />}>
        {item.state === "reading" ? copy(l, "We’re reading your results…", "Կարդում ենք ձեր արդյունքները…", "Распознаём ваши результаты…") : copy(l, "Reading is taking longer than usual", "Կարդալն ավելի երկար է տևում, քան սովորաբար", "Распознавание занимает больше времени, чем обычно")}
      </Title>
      {file}
      <p className="text-body2 text-muted-foreground">
        {item.state === "reading"
          ? copy(l, "This usually takes a few minutes. You can leave this page. The values are saved for you when it is done.", "Սովորաբար դա տևում է մի քանի րոպե։ Կարող եք լքել այս էջը։ Երբ ավարտվի, արժեքները կպահպանվեն ձեզ համար։", "Обычно это занимает несколько минут. Вы можете уйти с этой страницы. Когда распознавание завершится, значения сохранятся для вас.")
          : copy(l, "We will keep trying. Your doctor can already open the file.", "Մենք կշարունակենք փորձել։ Ձեր բժիշկն արդեն կարող է բացել ֆայլը։", "Мы продолжим попытки. Ваш врач уже может открыть файл.")}
      </p>
    </>, true);
  if (item.state === "unreadable")
    return section(<>
      <Title id={id} icon={<FileSearch aria-hidden className="mt-1 size-5 shrink-0" />}>{copy(l, "We couldn’t read this file automatically", "Չհաջողվեց ավտոմատ կարդալ այս ֆայլը", "Не удалось автоматически распознать этот файл")}</Title>
      {file}
      <p className="text-body2 text-muted-foreground">{copy(l, "Your doctor can still open it. If you have the numbers, you can add the main ones by hand below.", "Ձեր բժիշկը, միևնույն է, կարող է բացել այն։ Եթե թվերը ձեզ մոտ են, հիմնականները կարող եք ձեռքով ավելացնել ներքևում։", "Ваш врач по-прежнему может открыть файл. Если у вас есть числа, основные значения можно добавить вручную ниже.")}</p>
    </>);
  if (item.state === "not_mine")
    return section(<>
      <Title id={id} icon={<CheckCircle2 aria-hidden className="mt-1 size-5 shrink-0" />}>{copy(l, "Noted: not your results", "Նշված է․ ձեր արդյունքները չեն", "Отмечено: это не ваши результаты")}</Title>
      {file}
      <p className="text-body2 text-muted-foreground">{copy(l, "We saved no values from this file. You can remove the file below.", "Այս ֆայլից ոչ մի արժեք չենք պահպանել։ Ֆայլը կարող եք հեռացնել ներքևում։", "Мы не сохранили значения из этого файла. Вы можете удалить файл ниже.")}</p>
    </>);
  if (item.state === "identity") return section(<IdentityQuestion locale={l} item={item} id={id} answer={answer} />);
  if (item.reading) return section(<EditValues locale={l} reading={item.reading} id={id} edit={edit} />);
  if (item.reading === null)
    return section(<>
      <Title id={id} icon={<TriangleAlert aria-hidden className="mt-1 size-5 shrink-0" />}>{copy(l, "Edit values", "Խմբագրել արժեքները", "Изменить значения")}</Title>
      {file}
      <p role="alert" className="text-body2">{copy(l, "The values are unavailable right now. Reload the page to try again.", "Արժեքներն այս պահին անհասանելի են։ Թարմացրեք էջը՝ կրկին փորձելու համար։", "Значения сейчас недоступны. Обновите страницу, чтобы попробовать ещё раз.")}</p>
    </>);
  if (item.review === "waiting" || item.review === "approved") {
    const r = resultsCopy(l);
    return section(<>
      <Title id={id} icon={item.review === "waiting" ? <Clock aria-hidden className="mt-1 size-5 shrink-0" /> : <CheckCircle2 aria-hidden className="mt-1 size-5 shrink-0" />}>{item.review === "waiting" ? r.waitingTitle : r.checkedTitle}</Title>
      {file}
      {item.review === "waiting" ? <p className="text-body2 text-muted-foreground">{r.waitingBody}</p>
        : <a className="inline-flex min-h-11 items-center text-body1 font-medium underline" href="#lab-results">{r.seeResults}</a>}
    </>, item.review === "waiting");
  }
  return section(<>
    <Title id={id} icon={<CheckCircle2 aria-hidden className="mt-1 size-5 shrink-0" />}>
      {copy(l, `We read ${item.saved} ${item.saved === 1 ? "value" : "values"} from your file`, `Ձեր ֆայլից կարդացել ենք ${item.saved} արժեք`, `Из вашего файла распознано значений: ${item.saved}`)}
    </Title>
    {file}
    <p className="text-body2 text-muted-foreground">
      {copy(l, "They’re saved, marked as read by AI and not confirmed by you. Your doctor can see them. If a number is wrong, correct or remove it.", "Դրանք պահպանված են՝ նշված որպես AI-ի կարդացած և ձեր կողմից չհաստատված։ Ձեր բժիշկը կարող է տեսնել դրանք։ Եթե թիվը սխալ է, ուղղեք կամ հեռացրեք այն։", "Значения сохранены с пометкой, что они распознаны ИИ и не подтверждены вами. Ваш врач может их видеть. Если число неверное, исправьте или удалите его.")}
    </p>
    <a className="inline-flex min-h-11 items-center text-body1 font-medium underline" href={editHref(item.documentId)}>{copy(l, "Edit values", "Խմբագրել արժեքները", "Изменить значения")}</a>
  </>);
}

function IdentityQuestion({ locale: l, item, id, answer }: { locale: PatientLocale; item: ReadingCardItem; id: string; answer: Answer }) {
  const router = useRouter();
  const [submissionId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function send(choice: "mine" | "not_mine") {
    if (busy || !item.jobId) return;
    setBusy(true);
    setError(null);
    const r = await answer({ version: memberIdentityVersion, submissionId, jobId: item.jobId, answer: choice }).catch((): MemberCommandResult => ({ status: "unavailable" }));
    setBusy(false);
    if (r.status === "saved" || r.status === "unchanged") router.refresh();
    else setError(failure(l, r.status));
  }
  return <>
    <Title id={id} icon={<TriangleAlert aria-hidden className="mt-1 size-5 shrink-0" />}>{copy(l, "This looks like someone else’s results. Is that right?", "Կարծես սրանք ուրիշի արդյունքներ են։ Այդպե՞ս է։", "Похоже, это чужие результаты. Верно?")}</Title>
    <p className="break-all text-caption text-muted-foreground">{item.fileName}</p>
    <p className="text-body2 text-muted-foreground">{copy(l, "The name or date of birth on the sheet is different from your profile. That can happen with a misspelling or an old document. We save the values once you tell us they are yours.", "Թերթիկի անունը կամ ծննդյան ամսաթիվը տարբերվում է ձեր պրոֆիլից։ Դա կարող է լինել տառասխալի կամ հին փաստաթղթի պատճառով։ Արժեքները կպահպանենք, երբ հաստատեք, որ դրանք ձերն են։", "Имя или дата рождения в документе отличаются от данных вашего профиля. Это бывает из-за опечатки или старого документа. Мы сохраним значения, когда вы подтвердите, что результаты ваши.")}</p>
    <div className="flex flex-wrap gap-3">
      <Button type="button" className="h-auto min-h-11 whitespace-normal" disabled={busy} onClick={() => void send("mine")}>{copy(l, "These are my results", "Սրանք իմ արդյունքներն են", "Это мои результаты")}</Button>
      <Button type="button" variant="outline" className="h-auto min-h-11 whitespace-normal" disabled={busy} onClick={() => void send("not_mine")}>{copy(l, "They are someone else’s", "Ուրիշինն են", "Это чужие результаты")}</Button>
    </div>
    {error && <p role="alert" className="text-body2">{error}</p>}
  </>;
}

/** Correct or remove saved values. Every row has the same shape: name and date, then value, unit and Remove. */
function EditValues({ locale: l, reading, id, edit }: { locale: PatientLocale; reading: MemberReading; id: string; edit: Edit }) {
  const router = useRouter();
  const job = reading.job!;
  const shown = reading.values.filter((v) => v.memberStatus !== "rejected");
  const current = (v: (typeof shown)[number]) => (v.memberStatus === "corrected" && v.memberValue !== null ? v.memberValue : v.value);
  const [submissionId] = useState(() => crypto.randomUUID());
  const [rows, setRows] = useState(() => Object.fromEntries(shown.map((v) => [v.valueId, { removed: false, text: current(v) === null ? "" : String(current(v)) }])));
  const [date, setDate] = useState(job.sampleDate && /^\d{4}-\d{2}-\d{2}$/.test(job.sampleDate) ? job.sampleDate : reading.resultDate ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bad, setBad] = useState<Set<string>>(new Set());
  const name = (v: (typeof shown)[number]) => analyteDisplayName(v.testName, clinicalLocale(l), v.catalogueRef);
  // A corrected value of a charted measure that has no date and is not charted yet needs the result date.
  const needsDate = shown.some((v) => !rows[v.valueId]?.removed && v.measure && !v.chartedSource && !v.collectedOn && v.value !== null);

  async function save() {
    if (busy) return;
    const wrong = new Set<string>();
    const edits: EditCommand["edits"] = [];
    for (const v of shown) {
      const r = rows[v.valueId]!;
      if (r.removed) { edits.push({ valueId: v.valueId, action: "remove" }); continue; }
      if (v.value === null) continue;
      const n = Number(r.text.trim().replace(",", "."));
      if (!r.text.trim() || !Number.isFinite(n) || chartValueProblem(v, n)) { wrong.add(v.valueId); continue; }
      if (n !== current(v)) edits.push({ valueId: v.valueId, action: "correct", value: n });
    }
    setBad(wrong);
    if (wrong.size) { setError(failure(l, "invalid")); return; }
    if (!edits.length) { router.push(`/patient/progress/earlier#reading-${reading.documentId}`); return; }
    setBusy(true);
    setError(null);
    const r = await edit({ version: memberEditVersion, submissionId, jobId: job.jobId, ...(date ? { measuredOn: date } : {}), edits }).catch((): MemberCommandResult => ({ status: "unavailable" }));
    setBusy(false);
    if (r.status === "saved") router.push(`/patient/progress/earlier#reading-${reading.documentId}`);
    else setError(failure(l, r.status));
  }

  return <>
    <header className="space-y-1">
      <Title id={id} icon={<CheckCircle2 aria-hidden className="mt-1 size-5 shrink-0" />}>{copy(l, "Edit values", "Խմբագրել արժեքները", "Изменить значения")}</Title>
      <p className="break-all text-caption text-muted-foreground">{reading.fileName}</p>
    </header>
    <p className="text-body2 text-muted-foreground">{copy(l, "Compare each number with your sheet. Change any that are wrong and remove any you do not want to keep.", "Համեմատեք յուրաքանչյուր թիվ ձեր թերթիկի հետ։ Ուղղեք սխալները և հեռացրեք նրանք, որոնք չեք ուզում պահել։", "Сравните каждое число с вашим документом. Исправьте неверные значения и удалите те, которые не хотите сохранять.")}</p>
    <ul className="divide-y">
      {shown.map((v) => {
        const r = rows[v.valueId]!;
        const set = (patch: Partial<typeof r>) => setRows((all) => ({ ...all, [v.valueId]: { ...r, ...patch } }));
        const status = v.memberStatus === "corrected" ? copy(l, "Corrected by you", "Ուղղել եք դուք", "Исправлено вами") : copy(l, "Read by AI, not confirmed by you", "Կարդացել է AI-ը, դուք չեք հաստատել", "Распознано ИИ, не подтверждено вами");
        return (
          <li key={v.valueId} className="space-y-2 py-3">
            <div className="min-w-0">
              <p className={`break-words text-body1 font-medium ${r.removed ? "text-muted-foreground line-through" : ""}`}>{name(v)}</p>
              <p className="text-caption text-muted-foreground">{v.collectedOn ? `${v.collectedOn} · ` : ""}{r.removed ? copy(l, "Will be removed", "Կհեռացվի", "Будет удалено") : status}</p>
            </div>
            <div className="flex items-center gap-3">
              {v.value === null ? <span className="w-28 text-body1 tabular-nums">{v.valueText}</span> : (
                <Input aria-label={`${name(v)}, ${copy(l, "value", "արժեք", "значение")}`} aria-invalid={bad.has(v.valueId) || undefined} inputMode="decimal" className="min-h-11 w-28 shrink-0 tabular-nums" value={r.text} disabled={r.removed} onChange={(e) => set({ text: e.target.value })} />
              )}
              <span className="min-w-0 flex-1 break-words text-body2 text-muted-foreground">{v.unit ?? ""}</span>
              <Button type="button" variant="outline" className="h-auto min-h-11 shrink-0" aria-pressed={r.removed} aria-label={`${r.removed ? copy(l, "Keep", "Պահել", "Оставить") : copy(l, "Remove", "Հեռացնել", "Удалить")} ${name(v)}`} onClick={() => set({ removed: !r.removed })}>
                {r.removed ? copy(l, "Keep", "Պահել", "Оставить") : copy(l, "Remove", "Հեռացնել", "Удалить")}
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
    {needsDate && (
      <div className="space-y-2">
        <label htmlFor={`${id}-date`} className="text-body2 font-medium">{copy(l, "Date of the result", "Արդյունքի ամսաթիվը", "Дата результата")}</label>
        <Input id={`${id}-date`} type="date" min="1950-01-01" max={yerevanToday()} value={date} onChange={(e) => setDate(e.target.value)} className="min-h-11 max-w-56" />
      </div>
    )}
    {error && <p role="alert" className="text-body2">{error}</p>}
    <div className="flex flex-wrap gap-3">
      <Button type="button" className="h-auto min-h-11 gap-2 whitespace-normal" disabled={busy} onClick={() => void save()}>
        <CheckCircle2 aria-hidden className="size-4" />
        {busy ? copy(l, "Saving…", "Պահպանվում է…", "Сохраняется…") : copy(l, "Save changes", "Պահպանել փոփոխությունները", "Сохранить изменения")}
      </Button>
      <a className="inline-flex min-h-11 items-center text-body1 underline" href={`/patient/progress/earlier#reading-${reading.documentId}`}>{copy(l, "Cancel", "Չեղարկել", "Отменить")}</a>
    </div>
  </>;
}
