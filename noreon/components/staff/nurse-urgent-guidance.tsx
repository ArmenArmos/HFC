import {BP_NURSE_GUIDANCE} from '@/lib/clinical/rules/bp-words';
import {clinicalLocale} from '@/lib/locale';
import {st,type StaffLocale} from '@/lib/staff/staff-locale-copy';

export function nurseUrgentWords(locale:StaffLocale){
 return {emergency:locale==='ru'?'Для срочной медицинской помощи звоните 103.':clinicalLocale(locale)==='en'?'In an emergency, call 103.':'Շտապ դեպքում զանգահարեք 103։',guidance:st(locale,'Guidance','Ուղեցույց','Рекомендации')};
}

export function NurseUrgentLine({locale}:{locale:StaffLocale}){
 const words=nurseUrgentWords(locale);
 return <div data-nurse-urgent-line className="sticky top-0 z-20 mb-4 border-b bg-background px-3">
  <a href="#nurse-urgent-guidance" className="flex min-h-11 items-center py-2 text-body2 text-muted-foreground hover:underline underline-offset-4">
   <span>{words.emergency}{' '}
    <span className="underline">{words.guidance}</span>
   </span>
  </a>
 </div>;
}

/** The protocol-draft-1 safety wording: 20261018170600_nurse_visit_flow, the BP line as updated by 20261103001428_bp_one_rule.
 * Keep the full instructions in normal flow so the pinned line never covers the composer.
 * Russian clinical copy retains the approved Armenian, as on the visit checklist. */
export function NurseUrgentGuidance({locale}:{locale:StaffLocale}){
 const english=clinicalLocale(locale)==='en';
 return <aside id="nurse-urgent-guidance" tabIndex={-1} className="mt-4 scroll-mt-20 space-y-3 rounded-xl border bg-card p-4">
  <h2 className="text-h3">{st(locale,'Urgent guidance','Շտապ ուղեցույց','Экстренные рекомендации')}</h2>
  <div lang={clinicalLocale(locale)} className="space-y-3 text-body2">
   <p>{english?'Ask about chest pain, severe breathlessness, new neurological symptoms, confusion or sudden worsening of vision. If any is present, get urgent medical help now (call 103). Do not wait for tests or the app.':'Հարցրեք կրծքավանդակի ցավի, ծանր շնչահեղձության, նոր նյարդաբանական ախտանիշների, գիտակցության խանգարման կամ տեսողության սուր վատացման մասին։ Դրանցից որևէ մեկի դեպքում անմիջապես կազմակերպեք շտապ բժշկական օգնություն (103)։ Մի սպասեք հետազոտություններին կամ հավելվածին։'}</p>
   <p>{BP_NURSE_GUIDANCE[english?'en':'hy']}</p>
  </div>
 </aside>;
}
