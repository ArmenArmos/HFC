"use client";
import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FilePicker } from "@/components/patient/file-picker";
import { copy } from "@/components/patient-care/common";
import type { PatientLocale } from "@/lib/patient/copy";
import { MEMBER_UPLOAD_MAX_BYTES, yerevanToday } from "@/lib/member-history/measures";

const messages = {
  stored: ["Saved. Your doctor can open it.", "Պահպանված է։ Ձեր բժիշկը կարող է բացել այն։", "Сохранено. Ваш врач может открыть файл."],
  duplicate: ["You already added this file.", "Այս ֆայլն արդեն ավելացրել եք։", "Вы уже добавили этот файл."],
  invalid: ["Choose a PDF, JPEG or PNG file and check the date.", "Ընտրեք PDF, JPEG կամ PNG ֆայլ և ստուգեք ամսաթիվը։", "Выберите файл PDF, JPEG или PNG и проверьте дату."],
  "unsupported": ["Choose a PDF, JPG or PNG file.", "Ընտրեք PDF, JPG կամ PNG ֆայլ։", "Выберите файл PDF, JPG или PNG."],
  "too-large": ["This file is larger than 4 MB. Try a smaller scan or a photo.", "Ֆայլը 4 ՄԲ-ից մեծ է։ Փորձեք ավելի փոքր սկան կամ լուսանկար։", "Размер файла больше 4 МБ. Попробуйте скан меньшего размера или фото."],
  limit: ["You have reached 50 files. Remove one to add another.", "Դուք հասել եք 50 ֆայլի։ Հեռացրեք մեկը՝ նորն ավելացնելու համար։", "У вас уже 50 файлов. Удалите один, чтобы добавить новый."],
  access: ["Sign in again to add files.", "Մուտք գործեք կրկին՝ ֆայլեր ավելացնելու համար։", "Войдите снова, чтобы добавить файлы."],
  unavailable: ["Couldn’t save the file. Try again.", "Չհաջողվեց պահպանել ֆայլը։ Փորձեք կրկին։", "Не удалось сохранить файл. Попробуйте ещё раз."],
  "photo-format": ["This photo format cannot be opened here. Take the photo as JPEG, or send a screenshot of it.", "Լուսանկարի այս ձևաչափն այստեղ հնարավոր չէ բացել։ Լուսանկարեք JPEG ձևաչափով կամ ուղարկեք դրա սքրինշոթը։", "Этот формат фото здесь не открывается. Сделайте фото в формате JPEG или отправьте его снимок экрана."],
  "rate-limited": ["You have added many files in the last hour. Try again later.", "Վերջին ժամում շատ ֆայլեր եք ավելացրել։ Փորձեք ավելի ուշ։", "За последний час вы добавили много файлов. Попробуйте позже."],
} as const;
type Status = keyof typeof messages;

/**
 * Photos are redrawn as JPEG no wider than 2000 px: smaller uploads and no camera location data. The canvas is
 * painted white first: JPEG has no transparency, and a transparent PNG (a page saved from a PDF or a screenshot)
 * would otherwise turn black, text and all (live test 18 Oct, job 653a0f8c read as unreadable).
 * A photo the browser cannot decode (HEIC outside Safari) is reported, not sent.
 */
export async function prepare(file: File): Promise<Blob | "undecodable"> {
  if (!file.type.startsWith("image/") && !/\.(heic|heif)$/i.test(file.name)) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext("2d");
    if (!context) return file.type === "image/jpeg" || file.type === "image/png" ? file : "undecodable";
    context.fillStyle = "white"; // image data, not a brand colour
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    return blob ?? file;
  } catch {
    return file.type === "image/jpeg" || file.type === "image/png" ? file : "undecodable";
  }
}

export function UploadCard({ locale: l, reading = false }: { locale: PatientLocale; reading?: boolean }) {
  const router = useRouter();
  const fileId = useId(), dateId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  async function send() {
    if (!file || busy) return;
    setBusy(true);
    setStatus(null);
    try {
      if (!["application/pdf", "image/jpeg", "image/png", "image/heic", "image/heif"].includes(file.type) && !/\.(heic|heif)$/i.test(file.name)) { setStatus("unsupported"); return; }
      const body = await prepare(file);
      if (body === "undecodable") { setStatus("photo-format"); return; }
      if (body.size > MEMBER_UPLOAD_MAX_BYTES) { setStatus("too-large"); return; }
      const response = await fetch("/patient/progress/earlier/upload", {
        method: "PUT",
        body,
        headers: { "x-file-name": encodeURIComponent(file.name), ...(date ? { "x-result-date": date } : {}) },
      });
      const result = (await response.json().catch(() => ({ status: "unavailable" }))) as { status?: string };
      const next = (result.status && result.status in messages ? result.status : "unavailable") as Status;
      setStatus(next);
      if (next === "stored") {
        setFile(null);
        setDate("");
        if (input.current) input.current.value = "";
        router.refresh();
      }
    } catch {
      setStatus("unavailable");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="journey-card space-y-4 rounded-2xl border border-border/70 bg-card p-5 shadow-sm sm:p-6" aria-labelledby={`${fileId}-title`}>
      <header className="space-y-1">
        <h2 id={`${fileId}-title`} className="text-h3">{copy(l, "Upload an earlier result", "Վերբեռնեք նախկին արդյունքը", "Загрузить прежний результат")}</h2>
        <p className="text-body2 text-muted-foreground">
          {reading
            ? copy(l, "A PDF or a photo of a lab result, up to 4 MB. We keep the file as you sent it, read the values with AI and save them for you. You can correct or remove any of them.", "Լաբորատոր արդյունքի PDF կամ լուսանկար՝ մինչև 4 ՄԲ։ Մենք պահում ենք ֆայլն այնպես, ինչպես ուղարկել եք, AI-ի միջոցով կարդում ենք արժեքները և պահպանում դրանք ձեզ համար։ Ցանկացածը կարող եք ուղղել կամ հեռացնել։", "PDF или фото результата анализа размером до 4 МБ. Мы сохраняем файл в исходном виде, распознаём значения с помощью ИИ и сохраняем их для вас. Вы можете исправить или удалить любое значение.")
            : copy(l, "A PDF or a photo of a lab result or report, up to 4 MB. We keep the file as you sent it and do not read numbers from it.", "Լաբորատոր արդյունքի կամ եզրակացության PDF կամ լուսանկար՝ մինչև 4 ՄԲ։ Մենք պահում ենք ֆայլն այնպես, ինչպես ուղարկել եք, և դրանից թվեր չենք կարդում։", "PDF или фото результата анализа или заключения размером до 4 МБ. Мы сохраняем файл в исходном виде и не считываем из него числа.")}
        </p>
      </header>
      <div className="space-y-2">
        <label htmlFor={fileId} className="text-body2 font-medium">{copy(l, "File", "Ֆայլ", "Файл")}</label>
        <FilePicker inputRef={input} id={fileId} locale={l} accept="application/pdf,image/jpeg,image/png,image/heic,image/heif" files={file ? [file] : []} onFiles={(files) => { setFile(files[0] ?? null); setStatus(null); }} />
      </div>
      <div className="space-y-2">
        <label htmlFor={dateId} className="text-body2 font-medium">{copy(l, "Date of the result (optional)", "Արդյունքի ամսաթիվը (ըստ ցանկության)", "Дата результата (необязательно)")}</label>
        <Input id={dateId} type="date" min="1950-01-01" max={yerevanToday()} value={date} onChange={(e) => setDate(e.target.value)} className="min-h-11 max-w-56" />
      </div>
      {status && <p role={status === "stored" ? "status" : "alert"} className={status === "stored" ? "text-body2" : "rounded-lg border border-destructive bg-destructive/10 p-3 text-body2 font-medium text-destructive"}>{status === "stored" && reading ? copy(l, "Saved. We’re reading it now. You’ll see how it went at the top of this page.", "Պահպանված է։ Հիմա կարդում ենք այն։ Արդյունքը կտեսնեք այս էջի վերևում։", "Сохранено. Сейчас распознаём данные. Результат появится вверху этой страницы.") : copy(l, messages[status][0], messages[status][1], messages[status][2])}</p>}
      <Button type="button" className="h-auto min-h-11 gap-2 whitespace-normal" disabled={!file || busy} onClick={() => void send()}>
        <Upload aria-hidden className="size-4" />
        {busy ? copy(l, "Uploading…", "Վերբեռնվում է…", "Загружаем…") : copy(l, "Upload file", "Վերբեռնել ֆայլը", "Загрузить файл")}
      </Button>
    </section>
  );
}
