import type {ClinicalSnapshot} from '@/lib/patient-care/clinical-case-repository';
import {st,type StaffLocale} from '@/lib/staff/staff-locale-copy';
export function ClinicalSummary({review,locale}:{review:NonNullable<ClinicalSnapshot['review']>;locale:StaffLocale}){
 const t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru),urgency=review.engine.urgency;
 return <section className="space-y-2" data-clinical-summary="">
  <h4 className="text-body1 font-semibold">{t('Clinical recommendations you are approving','Կլինիկական առաջարկություններ, որոնք հաստատում եք','Клинические рекомендации, которые вы утверждаете')}</h4>
  <p>{t('Urgency','Հրատապություն','Срочность')}: {urgency==='green'?t('Green','Կանաչ','Зелёная'):urgency==='yellow'?t('Yellow','Դեղին','Жёлтая'):t('Orange','Նարնջագույն','Оранжевая')}</p>
  {review.engine.tests.length?<ul>{review.engine.tests.map(test=><li key={test.id}>{test.title}</li>)}</ul>:<p>{t('No additional tests recommended by this review.','Այս վերանայմամբ լրացուցիչ հետազոտություններ չեն առաջարկվում։','По этой проверке дополнительные исследования не рекомендованы.')}</p>}
 </section>;
}
