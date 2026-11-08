import {memberInstruction} from "@/lib/text-language";
import {memberDoctorLabel} from "@/lib/member-staff-name.mjs";
import { ChevronDown, ClipboardList } from "lucide-react";
import type { CareTest } from "@/lib/patient-care/types";
import type { PatientLocale } from "@/lib/patient/copy";
import { copy, stamp, Status } from "./common";

/** One flat disclosure per order; receipt and clinician publication remain separate. */
export function TestOrders({ tests, locale: l }: {
  tests: CareTest[]; locale: PatientLocale;
}) {
  return <div className="divide-y">{tests.map(test => {
    const pending = test.status === "ordered" || test.status === "booked";
    const location = test.location ? memberInstruction(test.location, l) : copy(l, "Location not confirmed yet.", "Վայրը դեռ հաստատված չէ։", "Место пока не подтверждено.");
    const status = test.status === "ordered" ? copy(l, "To arrange", "Կազմակերպել", "Нужно организовать")
      : test.status === "booked" ? copy(l, "Booked", "Պլանավորված է", "Запись оформлена")
      : test.status === "collected" ? copy(l, "Sample collected", "Նմուշը հանձնված է", "Образец взят")
      : copy(l, "Cancelled", "Չեղարկված", "Отменено");
    return <details key={test.id} className="group py-3 first:pt-0 last:pb-0">
      <summary className="flex min-h-11 cursor-pointer list-none items-start gap-3 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
        <ClipboardList aria-hidden className="mt-1 size-5 shrink-0 text-brand-teal" />
        <div className="min-w-0 flex-1 space-y-2">
          <h3 className="break-words text-body2 font-semibold">{test.title}</h3>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2"><Status>{status}</Status>{pending && test.dueAt && <span className="text-caption text-muted-foreground">{copy(l, "Due", "Ժամկետ", "Срок")}: {stamp(test.dueAt, l)}</span>}</div>
        </div>
        <ChevronDown aria-hidden className="mt-1 size-4 shrink-0 text-muted-foreground group-open:rotate-180" />
      </summary>
      <div className="mt-4 space-y-4 border-t pt-4">
        {pending && <div className="space-y-2">
          <h4 className="text-body2 font-semibold">{copy(l, "Preparation", "Նախապատրաստում", "Подготовка")}</h4>
          <p className="text-caption font-medium">{copy(l, "Preparation needs provider confirmation", "Նախապատրաստումը ճշտեք բուժծառայություն մատուցողի հետ", "Подготовку нужно подтвердить у поставщика медицинских услуг")}</p><p className="whitespace-pre-wrap break-words text-body2 text-muted-foreground">{test.preparation ? memberInstruction(test.preparation, l) : copy(l, "Preparation has not been provided. Confirm instructions with the laboratory before your visit.", "Նախապատրաստման ցուցումներ չեն տրամադրվել։ Նախքան այցը ճշտեք լաբորատորիայից։", "Указания по подготовке не предоставлены. Уточните их в лаборатории перед визитом.")}</p>
        </div>}
        {pending && <p className="break-words text-body2">{location}</p>}
        <p className="break-words text-caption text-muted-foreground">{memberDoctorLabel(test.orderedBy,l)} · {stamp(test.orderedAt, l, false)} · {test.sourceLabel}</p>
      </div>
    </details>;
  })}</div>;
}
