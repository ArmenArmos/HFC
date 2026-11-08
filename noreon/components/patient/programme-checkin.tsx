"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Phone } from "lucide-react";
import { tx, type PatientLocale } from "@/lib/patient/copy";
import type { CheckinResult, Feeling, MedicineAnswer } from "@/lib/programme/schema";

type Option<T extends string> = { value: T; en: string; hy: string; ru: string };
const FEELINGS: Option<Feeling>[] = [
  { value: "better", en: "Better", hy: "Ավելի լավ", ru: "Лучше" },
  { value: "same", en: "About the same", hy: "Մոտավորապես նույնը", ru: "Примерно так же" },
  { value: "worse", en: "Worse", hy: "Ավելի վատ", ru: "Хуже" },
];
const MEDICINES: Option<MedicineAnswer>[] = [
  { value: "all", en: "I took them as planned", hy: "Ընդունել եմ ըստ ծրագրի", ru: "Принимаю по плану" },
  { value: "missed_some", en: "I missed a few", hy: "Մի քանիսը բաց եմ թողել", ru: "Пропущено несколько приёмов" },
  { value: "missed_many", en: "I missed many", hy: "Շատերն եմ բաց թողել", ru: "Пропущено много приёмов" },
  { value: "no_medicines", en: "I have no medicines in my plan", hy: "Իմ ծրագրում դեղեր չկան", ru: "В моём плане нет лекарств" },
  { value: "not_sure", en: "I am not sure", hy: "Վստահ չեմ", ru: "Не уверен(а)" },
];

/**
 * Three short questions for the doctor's review. Answers are the member's own report and are read
 * at the review, not in real time, so the form says where to go when unwell now.
 */
export function ProgrammeCheckin({
  checkpointId,
  locale: l,
  submit,
}: {
  checkpointId: string;
  locale: PatientLocale;
  submit: (input: unknown) => Promise<CheckinResult>;
}) {
  const t = (en: string, hy: string, ru: string) => tx(l, hy, en, ru);
  const [feeling, setFeeling] = useState<Feeling | null>(null);
  const [medicines, setMedicines] = useState<MedicineAnswer | null>(null);
  const [note, setNote] = useState("");
  const [submissionId] = useState(() => crypto.randomUUID());
  const [status, setStatus] = useState<CheckinResult["status"] | "missing" | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const send = () => {
    if (!feeling || !medicines) return setStatus("missing");
    start(async () => {
      const result = await submit({ checkpointId, feeling, medicines, note: note.trim() || undefined, submissionId });
      setStatus(result.status);
      if (result.status === "saved" || result.status === "already" || result.status === "closed") router.refresh();
    });
  };
  const message: Partial<Record<NonNullable<typeof status>, string>> = {
    missing: t("Choose an answer for the first two questions.", "Ընտրեք պատասխան առաջին երկու հարցերի համար։", "Выберите ответы на первые два вопроса."),
    saved: t("Thank you. Your doctor will see your answers at the review.", "Շնորհակալություն։ Ձեր բժիշկը կտեսնի ձեր պատասխանները վերանայման ժամանակ։", "Спасибо. Ваш врач увидит ответы во время планового пересмотра."),
    already: t("Your answers were already saved.", "Ձեր պատասխաններն արդեն պահպանված են։", "Ваши ответы уже сохранены."),
    closed: t("This check-in has closed.", "Այս ստուգումն արդեն փակված է։", "Этот опрос уже закрыт."),
    off: t("Check-ins are not available right now.", "Ստուգումներն այս պահին հասանելի չեն։", "Опросы сейчас недоступны."),
    access: t("Sign in again to send your answers.", "Կրկին մուտք գործեք՝ պատասխաններն ուղարկելու համար։", "Войдите снова, чтобы отправить ответы."),
    invalid: t("Check your answers and try again.", "Ստուգեք ձեր պատասխանները և կրկին փորձեք։", "Проверьте ответы и попробуйте снова."),
    "outcome-unknown": t("We could not confirm that your answers were saved. Try again: they will not be saved twice.", "Չհաջողվեց հաստատել, որ ձեր պատասխանները պահպանվել են։ Կրկին փորձեք․ դրանք երկու անգամ չեն պահպանվի։", "Не удалось подтвердить сохранение ответов. Попробуйте снова: они не будут сохранены дважды."),
  };
  const group = <T extends string>(name: string, legend: string, options: Option<T>[], value: T | null, set: (v: T) => void) => (
    <fieldset className="space-y-2">
      <legend className="text-body2 font-semibold">{legend}</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((o) => (
          <label key={o.value} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border bg-background px-3 py-2 text-body2 has-[:checked]:border-primary has-[:checked]:bg-muted has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring">
            <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => set(o.value)} className="size-4 accent-[var(--action-primary-bg)]" />
            <span>{t(o.en, o.hy, o.ru)}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
  if (status === "saved" || status === "already")
    return <p role="status" className="rounded-lg bg-muted p-3 text-body2">{message[status]}</p>;
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      {group(`feeling-${checkpointId}`, t("1. How do you feel since your plan started?", "1. Ինչպե՞ս եք ձեզ զգում ծրագրի մեկնարկից ի վեր։", "1. Как вы себя чувствуете с начала выполнения плана?"), FEELINGS, feeling, setFeeling)}
      {feeling === "worse" && (
        <div className="space-y-3 rounded-lg border border-destructive/40 p-3">
          <p className="flex items-start gap-2 text-body2">
            <Phone className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
            <span>
              {t("Your doctor reads these answers at the review, not straight away. If you feel very unwell now, call 103.", "Ձեր բժիշկը կարդում է այս պատասխանները վերանայման ժամանակ, ոչ անմիջապես։ Եթե հիմա ձեզ շատ վատ եք զգում, զանգահարեք 103։", "Ваш врач читает эти ответы во время планового пересмотра, а не сразу. Если сейчас вам очень плохо, позвоните 103.")}
            </span>
          </p>
          <a href="tel:103" className="emergency-call flex min-h-11 w-full items-center justify-center rounded-md px-4 py-2">
            {t("Call 103", "Զանգահարել 103", "Позвонить 103")}
          </a>
        </div>
      )}
      {group(`medicines-${checkpointId}`, t("2. Taking your medicines", "2. Դեղերի ընդունումը", "2. Приём лекарств"), MEDICINES, medicines, setMedicines)}
      <div className="space-y-2">
        <label htmlFor={`note-${checkpointId}`} className="text-body2 font-semibold">
          {t("3. Anything you want your doctor to know (optional)", "3. Ինչ-որ բան, որ ցանկանում եք, որ ձեր բժիշկն իմանա (ըստ ցանկության)", "3. Что ещё вы хотите сообщить врачу (необязательно)")}
        </label>
        <textarea id={`note-${checkpointId}`} value={note} maxLength={500} rows={3} onChange={(e) => setNote(e.target.value)}
          className="w-full rounded-lg border bg-background px-3 py-2 text-body2 focus-visible:outline-2 focus-visible:outline-ring" />
        <p className="text-caption text-muted-foreground">{t("Read at the review, not in real time.", "Կարդացվում է վերանայման ժամանակ, ոչ իրական ժամանակում։", "Врач прочитает во время планового пересмотра, а не в реальном времени.")}</p>
      </div>
      {status && message[status] && <p role="alert" className="text-body2">{message[status]}</p>}
      <button type="submit" disabled={pending}
        className="inline-flex min-h-11 items-center justify-center rounded-lg border border-primary bg-primary px-4 py-2 text-body2 font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
        {pending ? t("Sending…", "Ուղարկվում է…", "Отправляется…") : t("Send my answers to my doctor", "Ուղարկել պատասխաններս բժշկին", "Отправить ответы врачу")}
      </button>
    </form>
  );
}
