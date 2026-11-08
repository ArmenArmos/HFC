import {memberStaffName} from "@/lib/member-staff-name.mjs";
import { MessageSquareText } from "lucide-react";
import { clinicalLocale } from "@/lib/locale";
import type { PatientLocale } from "@/lib/patient/copy";
import type { MemberFirstNote } from "@/lib/first-note/schema";
import { IconTile, copy, stamp } from "./common";

/** Home: the assigned doctor's first note, "what I see and what comes next", until the care plan is published. */
export function FirstNoteCard({ note, locale: l }: { note: MemberFirstNote | undefined; locale: PatientLocale }) {
  if (!note) return null;
  const doctorName = memberStaffName(note.doctorName);
  return (
    <section aria-labelledby="first-note-home" className="journey-card space-y-3 rounded-2xl border border-border/70 bg-card p-5 shadow-sm sm:p-6" data-first-note>
      <header className="flex items-start gap-3">
        <IconTile icon={MessageSquareText} />
        <div className="min-w-0">
          <h2 id="first-note-home" className="text-h2">
            {doctorName ? copy(l, `A note from ${doctorName}`, `Գրառում՝ ${doctorName}`, `Сообщение от ${doctorName}`) : copy(l, "A note from your doctor", "Գրառում ձեր բժշկից", "Сообщение от вашего врача")}
          </h2>
          <p className="mt-1 text-caption text-muted-foreground">{stamp(note.approvedAt, l, false)}</p>
        </div>
      </header>
      <p lang={clinicalLocale(l)} className="whitespace-pre-wrap break-words text-body1">{clinicalLocale(l) === "hy" ? note.textHy : note.textEn}</p>
    </section>
  );
}
