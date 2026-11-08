import type {NurseVisitItem} from './schema';
import {st,type StaffLocale} from '@/lib/staff/staff-locale-copy';
export type CollectionStatus='pending'|'collected'|'not-collected'|'issue';
/** Old marks remain readable without inventing a collected sample from a missing mark. */
export function collectionStatus(item:NurseVisitItem):CollectionStatus{
 if(item.mark?.collectionStatus===null)return 'pending';
 return item.mark?.collectionStatus??(!item.mark?'pending':item.mark.done?'collected':'not-collected');
}
export function collectionCounts(items:readonly NurseVisitItem[]){
 const counts={pending:0,collected:0,'not-collected':0,issue:0,total:0};
 for(const item of items)if(item.kind==='sample'){counts[collectionStatus(item)]++;counts.total++;}
 return counts;
}
export function collectionCopy(l:StaffLocale){
 const t=(en:string,hy:string,ru:string)=>st(l,en,hy,ru);
 const ruPlural=(n:number,one:string,few:string,many:string)=>{const form=new Intl.PluralRules('ru').select(n);return form==='one'?one:form==='few'?few:many;};
 return {
 title:t('Sample collection','Նմուշների վերցնում','Взятие образцов'),
 statuses:{pending:t('Pending','Սպասում է','Ожидает'),collected:t('Collected','Վերցված է','Взят'),'not-collected':t('Not collected','Չի վերցվել','Не взят'),issue:t('Issue','Խնդիր','Проблема')},
 summary:(items:readonly NurseVisitItem[])=>{const n=collectionCounts(items);return t(`${n.collected} of ${n.total} collected, ${n['not-collected']} not collected, ${n.issue} ${n.issue===1?'issue':'issues'}, ${n.pending} pending`,`${n.total}-ից ${n.collected}-ը վերցված է, ${n['not-collected']}-ը չի վերցվել, խնդիր՝ ${n.issue}, սպասում է՝ ${n.pending}`,`Взято ${n.collected} из ${n.total}, не взято: ${n['not-collected']}, с проблемой: ${n.issue}, в ожидании: ${n.pending}`);},
 confirm:t('Confirm all collected','Հաստատել՝ բոլորը վերցված են','Подтвердить взятие всех образцов'),
 explanation:(n:number)=>t(`Record ${n} pending ${n===1?'test':'tests'} as collected by you now. Marked exceptions stay unchanged. Nothing is recorded until you tap.`,`Գրանցել ${n} սպասող հետազոտության նմուշ՝ որպես ձեր կողմից հիմա վերցված։ Նշված բացառությունները չեն փոխվի։ Մինչև սեղմելը ոչինչ չի գրանցվում։`,`Записать ${n} ${ruPlural(n,'ожидающий образец как взятый','ожидающих образца как взятые','ожидающих образцов как взятые')} вами сейчас. Отмеченные исключения сохранятся. Запись появится только после нажатия.`),
 confirmFirst:t('Confirm the visit with the member first.','Նախ հաստատեք այցը անդամի հետ։','Сначала подтвердите визит с участником.'),
 reason:t('Reason (required, 1 to 300 characters)','Պատճառ (պարտադիր, 1-ից 300 նիշ)','Причина (обязательно, от 1 до 300 символов)'),
 save:t('Save collection status','Պահպանել նմուշի վիճակը','Сохранить статус взятия'),
 cancel:t('Keep current status','Պահել ընթացիկ վիճակը','Сохранить текущий статус'),
 collected:t('Mark collected','Նշել՝ վերցված է','Отметить как взятый'),
 saving:t('Saving…','Պահպանվում է…','Сохраняется…'),
 failed:t('Collection could not be saved, your reasons are kept. Check or retry.','Նմուշների տվյալները չհաջողվեց պահպանել, ձեր պատճառները պահված են։ Ստուգեք կամ կրկին փորձեք։','Не удалось сохранить взятие образцов, ваши причины сохранены в форме. Проверьте или повторите.'),
 stale:t('This visit changed. Reload collection before saving again. Your reasons are kept.','Այցը փոխվել է։ Կրկին պահպանելուց առաջ թարմացրեք նմուշների տվյալները։ Ձեր պատճառները պահված են։','Данные визита изменились. Перезагрузите данные взятия перед сохранением. Ваши причины сохранены в форме.'),
 retry:t('Check or retry','Ստուգել կամ կրկին փորձել','Проверить или повторить'),reload:t('Reload collection','Թարմացնել նմուշների տվյալները','Перезагрузить данные взятия'),
 saved:t('Collection saved.','Նմուշների տվյալները պահպանված են։','Взятие образцов сохранено.'),
 unavailable:t('Collection is unavailable for this visit. Reload to check it. Your reasons are kept.','Այս այցի նմուշների տվյալներն անհասանելի են։ Թարմացրեք՝ ստուգելու համար։ Ձեր պատճառները պահված են։','Взятие образцов для этого визита недоступно. Перезагрузите для проверки. Ваши причины сохранены в форме.'),
 pending:t('Record a final collection status for every pending test before completing the visit.','Այցն ավարտելուց առաջ գրանցեք յուրաքանչյուր սպասող հետազոտության նմուշի վերջնական վիճակը։','Перед завершением визита укажите итоговый статус взятия каждого ожидающего образца.'),
 blood:t('Blood sample','Արյան նմուշ','Образец крови'),urine:t('Urine sample','Մեզի նմուշ','Образец мочи'),
 readonly:t('This visit is read-only.','Այս այցը միայն դիտելու համար է։','Этот визит доступен только для чтения.'),
 empty:t('No lab tests are ordered for this visit.','Այս այցի համար լաբորատոր հետազոտություն նշանակված չէ։','Для этого визита лабораторные исследования не назначены.'),
 };
}
