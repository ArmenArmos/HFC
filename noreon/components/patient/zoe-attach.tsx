"use client";
import { useRef, useState } from "react";
import { Camera, Paperclip } from "lucide-react";
import { tx, type PatientLocale } from "@/lib/patient/copy";

/**
 * Attach a report from the chat: the same upload as the earlier-results page, whose content check and lab reading stay the
 * record. The line says saved, not read. Nothing about the file enters the conversation.
 */
export function ZoeAttach({ locale: l, onSaved, camera = false, disabled = false }: { locale: PatientLocale; onSaved?: (name: string, duplicate: boolean, id?: string) => void; camera?: boolean; disabled?: boolean }) {
  const picker = useRef<HTMLInputElement>(null);
  const cameraPicker = useRef<HTMLInputElement>(null);
  const sending = useRef(false);
  const [state, setState] = useState<"idle" | "busy" | "saved" | "duplicate" | "too-large" | "invalid" | "failed">("idle");
  const line = state === "saved" ? tx(l, "Ձեր ֆայլը պահված է։ Այն դեռ կարդացված չէ։", "Your file is saved. It has not been read yet.", "Ваш файл сохранён. Он ещё не прочитан.")
    : state === "duplicate" ? tx(l, "Այս ֆայլն արդեն ունենք։", "We already have this file.", "Этот файл у нас уже есть.")
    : state === "too-large" ? tx(l, "Ֆայլը չափազանց մեծ է։ Ուղարկեք մինչև 4 ՄԲ PDF կամ լուսանկար։", "This file is too large. Send a PDF or photo up to 4 MB.", "Файл слишком большой. Отправьте PDF или фото до 4 МБ.")
    : state === "invalid" ? tx(l, "Այս ֆայլը չենք կարող ընդունել։ Ուղարկեք PDF, JPG կամ PNG։", "We cannot take this file. Send a PDF, JPG or PNG.", "Мы не можем принять этот файл. Отправьте PDF, JPG или PNG.")
    : state === "failed" ? tx(l, "Չհաջողվեց պահել ձեր ֆայլը։ Կրկին փորձեք։", "We could not save your file. Try again.", "Не удалось сохранить ваш файл. Попробуйте снова.") : null;
  const send = async (file: File) => {
    if (sending.current || disabled) return;
    sending.current = true;
    setState("busy");
    try {
      const r = await fetch("/patient/progress/earlier/upload", { method: "PUT", credentials: "same-origin", headers: { "x-file-name": encodeURIComponent(file.name.slice(0, 150)) }, body: file });
      const { status, id } = await r.json() as { status?: string; id?: string };
      if (status === "stored" || status === "duplicate") onSaved?.(file.name, status === "duplicate", id);
      setState(status === "stored" ? "saved" : status === "duplicate" || status === "too-large" || status === "invalid" ? status : "failed");
    } catch { setState("failed"); }
    sending.current = false;
    if (picker.current) picker.current.value = "";
    if (cameraPicker.current) cameraPicker.current.value = "";
  };
  return (
    <>
      <input ref={picker} type="file" accept="application/pdf,image/jpeg,image/png" className="sr-only" tabIndex={-1} aria-hidden data-zoe-attach-input onChange={e => { const f = e.target.files?.[0]; if (f) void send(f); }} />
      {camera && <>
        <input ref={cameraPicker} type="file" accept="image/jpeg,image/png" capture="environment" className="sr-only" tabIndex={-1} aria-hidden data-zoe-camera-input onChange={e => { const f = e.target.files?.[0]; if (f) void send(f); }} />
        <button type="button" disabled={disabled || state === "busy"} aria-label={tx(l, "Լուսանկարել", "Take a photo", "Сделать фото")} data-zoe-camera onClick={() => cameraPicker.current?.click()}><Camera size={20} aria-hidden /></button>
      </>}
      <button type="button" className="inline-flex min-h-12 min-w-12 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50" disabled={disabled || state === "busy"} aria-busy={state === "busy"} aria-label={tx(l, "Կցել ֆայլ", "Attach a file", "Прикрепить файл")} onClick={() => picker.current?.click()} data-zoe-attach>
        <Paperclip className="size-5" aria-hidden />
      </button>
      {camera && state === "busy" && <p role="status">{tx(l, "Պահվում է…", "Saving…", "Сохраняем…")}</p>}
      {line && <p role="status" className="order-last basis-full text-caption" data-zoe-attach-status={state}>{line}</p>}
    </>
  );
}
