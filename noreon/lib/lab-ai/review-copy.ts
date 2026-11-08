import {st,type StaffLocale} from '@/lib/staff/staff-locale-copy';
import type {AutoAcceptReason} from './auto-accept';
import type {LabValueRow} from './doctor-schema';
/** Explain the server verdict without recomputing eligibility in the browser. */
export function labReviewReason(value:LabValueRow,reason:AutoAcceptReason|null|undefined,locale:StaffLocale):string|null{
 const t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru);
 if(reason==='identity')return t('Confirm who is on the sheet first.','Նախ հաստատեք՝ ով է նշված թերթում։','Сначала подтвердите, кому принадлежит бланк.');
 if(reason==='date')return t('Sample date is missing, future or older than the review window.','Նմուշի ամսաթիվը բացակայում է, ապագայում է կամ ստուգման ժամկետից հին է։','Дата образца отсутствует, в будущем или старше допустимого срока проверки.');
 if(reason==='plausibility'||value.checks.includes('implausible'))return t('Outside the possible range.','Հնարավոր միջակայքից դուրս է։','За пределами возможного диапазона.');
 if(reason==='attention')return t('Flagged result needs your check.','Նշված արդյունքը ձեր ստուգման կարիքն ունի։','Отмеченный результат требует вашей проверки.');
 if(value.checks.some(c=>c==='unit_missing'||c==='unit_unexpected')||(reason==='mapping'&&value.catalogueRef))return t('Unit or printed row needs your check.','Միավորը կամ տպված տողը ձեր ստուգման կարիքն ունի։','Проверьте единицу измерения или напечатанную строку.');
 if(reason==='mapping')return t('Not matched to the catalogue.','Կատալոգում համապատասխանություն չկա։','Нет соответствия в каталоге.');
 if(reason==='value')return t('Printed value needs your check.','Տպված արժեքը ձեր ստուգման կարիքն ունի։','Напечатанное значение требует вашей проверки.');
 if(reason==='checks')return t('Reading checks need your review.','Կարդալու ստուգումները ձեր վերանայման կարիքն ունեն։','Результаты проверки чтения требуют вашего внимания.');
 return null;
}
