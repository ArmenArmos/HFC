import {st,type StaffLocale} from '@/lib/staff/staff-locale-copy';
import type {NurseHandoff} from './handoffs';

export function handoffTopicLabel(locale:StaffLocale,topic:NurseHandoff['topic']){
 const t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru);
 return {
  'blood-pressure':t('Blood pressure','Արյան ճնշում','Артериальное давление'),
  'side-effect':t('Side effect','Կողմնակի ազդեցություն','Побочный эффект'),
  adherence:t('Taking medicines','Դեղերի ընդունում','Приём лекарств'),symptom:t('Symptom','Ախտանիշ','Симптом'),
  'member-request':t('Member request','Անդամի հարցում','Запрос участника'),other:t('Other','Այլ','Другое'),
 }[topic];
}

export function handoffStateLabel(locale:StaffLocale,state:'sent'|'working'|'answered'|'closed'){
 const t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru);
 return {
  sent:t('Sent to the doctor','Ուղարկված է բժշկին','Отправлено врачу'),
  working:t('The doctor is working on it','Բժիշկը զբաղվում է դրանով','Врач занимается этим'),
  answered:t('The doctor answered','Բժիշկը պատասխանել է','Врач ответил'),
  closed:t('Closed','Փակված է','Закрыто'),
 }[state];
}

/** Legacy wording stays byte for byte; v2 only changes instructions that referred to reloading. */
export function nurseHandoffCopy(locale:StaffLocale){
 const t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru);
 const explanation=t('This creates a linked task for the responsible doctor. It does not change urgent care or medicine instructions.','Սա ստեղծում է կապակցված առաջադրանք պատասխանատու բժշկի համար։ Այն չի փոխում շտապ օգնության կամ դեղերի հրահանգները։','Это создаёт связанную задачу ответственному врачу. Указания по экстренной помощи и лекарствам не меняются.');
 return {
  introduction:t('Choose a message and record what the doctor needs to review. ','Ընտրեք հաղորդագրություն և գրանցեք, թե բժիշկն ինչ պետք է վերանայի։ ','Выберите сообщение и запишите, что нужно рассмотреть врачу. ')+explanation,
  savedLegacy:t('Your handoff is saved for the responsible doctor. Its task state is shown below.','Ձեր փոխանցումը պահպանված է պատասխանատու բժշկի համար։ Առաջադրանքի վիճակը ցուցադրված է ներքևում։','Передача сохранена для ответственного врача. Состояние задачи показано ниже.'),
  alreadyExistsLegacy:t('This message already has a handoff. Reload to check its task state.','Այս հաղորդագրությունն արդեն փոխանցված է։ Թարմացրեք՝ առաջադրանքի վիճակը ստուգելու համար։','Это сообщение уже передано. Обновите страницу для проверки задачи.'),
  refusedLegacy:t('The handoff was refused. Reload the conversation and check your access before trying again.','Փոխանցումը մերժված է։ Նորից փորձելուց առաջ թարմացրեք զրույցը և ստուգեք հասանելիությունը։','Передача отклонена. Обновите разговор и проверьте доступ перед повторной попыткой.'),
  unknown:t('The result is unknown. Check or retry this exact handoff before creating another.','Արդյունքը հայտնի չէ։ Նոր փոխանցում ստեղծելուց առաջ ստուգեք կամ կրկնեք հենց այս փոխանցումը։','Результат неизвестен. Проверьте или повторите эту же передачу перед созданием новой.'),
  observation:t('Your observation for the doctor','Ձեր դիտարկումը բժշկի համար','Ваше наблюдение для врача'),
  retry:t('Check or retry this handoff','Ստուգել կամ կրկնել այս փոխանցումը','Проверить или повторить передачу'),
  explanation,
  hint:t('Press a message to hand it over to the doctor.','Սեղմեք հաղորդագրությունը՝ այն բժշկին փոխանցելու համար։','Нажмите на сообщение, чтобы передать его врачу.'),
  handOver:t('Hand over','Փոխանցել','Передать'),
  action:t('Hand over to doctor','Փոխանցել բժշկին','Передать врачу'),
  handedOver:t('Handed over','Փոխանցված է','Передано'),
  chooseTopic:t('Choose a topic above','Ընտրեք թեման վերևում','Выберите тему выше'),
  note:t('Note for the doctor','Նշում բժշկի համար','Заметка для врача'),
  close:t('Close note for the doctor','Փակել բժշկի համար նշումը','Закрыть заметку для врача'),
  saved:t('Your handoff is saved for the responsible doctor. We will check its task state again automatically.','Ձեր փոխանցումը պահպանված է պատասխանատու բժշկի համար։ Մենք ինքնաշխատ կրկին կստուգենք առաջադրանքի վիճակը։','Передача сохранена для ответственного врача. Мы автоматически проверим состояние задачи ещё раз.'),
  alreadyExists:t('This message already has a handoff. Its task state will be checked automatically.','Այս հաղորդագրությունն արդեն փոխանցված է։ Առաջադրանքի վիճակն ինքնաշխատ կստուգվի։','Это сообщение уже передано. Состояние задачи будет проверено автоматически.'),
  refused:t('The handoff was refused. Check your access before trying again.','Փոխանցումը մերժված է։ Նորից փորձելուց առաջ ստուգեք հասանելիությունը։','Передача отклонена. Проверьте доступ перед повторной попыткой.'),
 };
}
