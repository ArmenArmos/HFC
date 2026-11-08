import type {Locale} from '@/lib/locale';
import {st,type StaffLocale} from './staff-locale-copy';
export const outcomeLabels = {
  en: { measurement: "Measurement", evidence: "Evidence note", "contact-attempted": "Contact attempted", reached: "Reached", unreachable: "Unreachable", "refer-doctor": "Refer to doctor" },
  hy: { measurement: "Չափում", evidence: "Տվյալների նշում", "contact-attempted": "Կապի փորձ", reached: "Կապը հաստատվել է", unreachable: "Կապ չի հաստատվել", "refer-doctor": "Ուղղել բժշկին" },
  ru: { measurement: "Измерение", evidence: "Заметка о данных", "contact-attempted": "Попытка связаться", reached: "Связь установлена", unreachable: "Связаться не удалось", "refer-doctor": "Направить к врачу" },
} satisfies Record<Locale,Record<'measurement'|'evidence'|'contact-attempted'|'reached'|'unreachable'|'refer-doctor',string>>;

export function careNoteKindLabel(locale:StaffLocale,kind:string){
 const key=kind as keyof typeof outcomeLabels.en;
 return st(locale,outcomeLabels.en[key]??kind,outcomeLabels.hy[key]??kind,outcomeLabels.ru[key]??kind);
}
