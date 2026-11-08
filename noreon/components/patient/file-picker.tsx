"use client";
import type { Ref } from "react";
import { Paperclip } from "lucide-react";
import { pick, type Locale } from "@/lib/locale";
import { cn } from "@/lib/utils";

/**
 * A file input whose button and "no file" text follow the app's language (Gohar QA 102): the browser's own
 * "Choose File / no file selected" is always in the browser's language. The native input stays in the page,
 * visually hidden, so its label, form value and keyboard focus work as before.
 */
export function FilePicker({ id, locale, accept, multiple = false, disabled = false, files, inputRef, onFiles, className }: {
  id?: string;
  locale: Locale;
  accept: string;
  multiple?: boolean;
  disabled?: boolean;
  /** What is selected now, for the line next to the button. */
  files: readonly File[];
  inputRef?: Ref<HTMLInputElement>;
  onFiles: (files: File[]) => void;
  className?: string;
}) {
  const t = (en: string, hy: string, ru: string) => pick(locale, { en, hy, ru });
  const chosen = files.length === 0 ? t("No file selected", "Ֆայլ ընտրված չէ", "Файл не выбран")
    : files.length === 1 ? files[0].name
    : t(`${files.length} files selected`, `Ընտրված է ${files.length} ֆայլ`, `Выбрано файлов: ${files.length}`);
  return (
    <div className={cn("flex flex-wrap items-center gap-3 rounded-lg border border-border bg-background p-2", disabled && "bg-muted", className)}>
      <label className={cn("inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-border bg-card px-4 text-body2 font-medium focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring", disabled && "cursor-not-allowed opacity-60")}>
        <Paperclip className="size-4 shrink-0" aria-hidden />
        {multiple ? t("Choose files", "Ընտրել ֆայլեր", "Выбрать файлы") : t("Choose file", "Ընտրել ֆայլ", "Выбрать файл")}
        <input ref={inputRef} id={id} type="file" accept={accept} multiple={multiple} disabled={disabled} className="sr-only"
          onChange={(e) => onFiles(Array.from(e.target.files ?? []))} />
      </label>
      <span className="min-w-0 flex-1 break-words text-body2 text-muted-foreground" data-file-picker-chosen>{chosen}</span>
    </div>
  );
}
