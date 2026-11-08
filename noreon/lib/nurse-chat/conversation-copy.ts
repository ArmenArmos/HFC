import {st,type StaffLocale} from '@/lib/staff/staff-locale-copy';
import type {NurseWorkspace} from './contracts';

/** Shared app-only guidance for both nurse conversation screens. */
type Route=Pick<Extract<NurseWorkspace,{ok:true}>,'memberName'|'canSend'|'telegramLinked'|'telegramSendingEnabled'>;
export function nurseConversationCopy(locale:StaffLocale,route?:Route){
 const t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru);
 const name=route?.memberName||t('This member','Այս անդամը','Этот участник');
 const appOnly=t('Your nurse replies go to the Noreon app, not to Telegram.','Ձեր՝ որպես բուժքրոջ պատասխանները հասնում են Noreon հավելված, ոչ թե Telegram։','Ваши ответы как медсестры поступают в приложение Noreon, а не в Telegram.');
 const opensApp=t('They see your reply only when they open the app.','Անդամը տեսնում է Ձեր պատասխանը միայն հավելվածը բացելիս։','Участник увидит ваш ответ, только когда откроет приложение.');
 const reason=route?.canSend===false
  ?t('Member app chat is switched off. You cannot send a nurse reply here.','Անդամի հավելվածի զրույցն անջատված է։ Այստեղ չեք կարող բուժքրոջ պատասխան ուղարկել։','Чат участника в приложении отключён. Здесь вы не можете отправить ответ медсестры.')
  :route?.telegramSendingEnabled===false
   ?t('Telegram sending is switched off.','Telegram-ով ուղարկումն անջատված է։','Отправка в Telegram отключена.')
   :route?.telegramLinked===false
    ?t(`${name} has no active Telegram connection.`,`${name}-ը Telegram-ի ակտիվ կապ չունի։`,`У ${name} нет активного подключения к Telegram.`)
    :route?.telegramLinked===true
     ?t(`${name} uses Telegram.`,`${name}-ն օգտվում է Telegram-ից։`,`${name} использует Telegram.`):'';
 const telegramHandoff=route?.telegramLinked===true&&route.telegramSendingEnabled===true;
 const handoff=t('Handoff to your responsible doctor','Փոխանցել պատասխանատու բժշկին','Передать ответственному врачу');
 const nextStep=telegramHandoff
  ?t(`If it matters now, use “${handoff}” so the doctor can approve a reply for Telegram, or contact the member another way.`,
   `Եթե հարցը հիմա է կարևոր, օգտագործեք «${handoff}» տարբերակը, որպեսզի բժիշկը կարողանա հաստատել Telegram-ով պատասխան, կամ կապվեք անդամի հետ այլ եղանակով։`,
   `Если вопрос важен сейчас, выберите «${handoff}», чтобы врач мог одобрить ответ для Telegram, или свяжитесь с участником другим способом.`)
  :t('If it matters now, contact the member another way.','Եթե հարցը հիմա է կարևոր, կապվեք անդամի հետ այլ եղանակով։','Если вопрос важен сейчас, свяжитесь с участником другим способом.');
 return {
  safety:st(locale,'You reply as the assigned nurse. The responsible doctor can read your messages. Clinical decisions stay with the doctor.','Դուք պատասխանում եք որպես կցված բուժքույր։ Պատասխանատու բժիշկը կարող է կարդալ ձեր հաղորդագրությունները։ Կլինիկական որոշումները կայացնում է բժիշկը։','Вы отвечаете как назначенная медсестра. Ответственный врач может читать ваши сообщения. Медицинские решения остаются за врачом.'),
  member:st(locale,'Member','Անդամ','Участник'),
  doctor:st(locale,'Doctor','Բժիշկ','Врач'),
  nurse:st(locale,'Nurse','Բուժքույր','Медсестра'),
  zoe:st(locale,'AI assistant','AI օգնական','ИИ-помощник'),
  staleReload:st(locale,'A new member message arrived. Reload and read it before sending your reply.','Անդամից նոր հաղորդագրություն է ստացվել։ Թարմացրեք և կարդացեք այն՝ նախքան պատասխանն ուղարկելը։','Поступило новое сообщение участника. Обновите разговор и прочитайте его перед отправкой ответа.'),
  unconfirmed:st(locale,'The reply could not be confirmed. Reload to check your access and the conversation.','Պատասխանը չհաջողվեց հաստատել։ Թարմացրեք՝ հասանելիությունն ու զրույցը ստուգելու համար։','Не удалось подтвердить ответ. Обновите страницу и проверьте доступ и разговор.'),
  saved:st(locale,'Your reply is saved in the member’s app conversation and is visible to the responsible doctor.','Ձեր պատասխանը պահպանվել է անդամի հավելվածի զրույցում և տեսանելի է պատասխանատու բժշկին։','Ваш ответ сохранён в разговоре участника в приложении и виден ответственному врачу.'),
  savedReload:st(locale,'Your reply is saved. Reload to read the updated conversation.','Ձեր պատասխանը պահպանվել է։ Թարմացրեք՝ նորացված զրույցը կարդալու համար։','Ваш ответ сохранён. Обновите страницу, чтобы прочитать разговор.'),
  unknown:st(locale,'The send result is unknown. Check or retry this exact reply before writing another.','Ուղարկման արդյունքը հայտնի չէ։ Ստուգեք կամ կրկին ուղարկեք հենց այս պատասխանը՝ նոր պատասխան գրելուց առաջ։','Результат отправки неизвестен. Проверьте или повторите этот же ответ, прежде чем писать новый.'),
  title:st(locale,'Member conversation','Անդամի զրույցը','Разговор с участником'),
  responsibleDoctor:st(locale,'Responsible doctor: ','Պատասխանատու բժիշկ՝ ','Ответственный врач: '),
  reading:st(locale,'Reading…','Կարդացվում է…','Чтение…'),
  reload:st(locale,'Reload conversation','Թարմացնել զրույցը','Обновить разговор'),
  back:st(locale,'Back to conversation','Վերադառնալ զրույցին','Вернуться к разговору'),
  denied:st(locale,'Access denied. You can read and reply only for members assigned to you.','Հասանելիությունը մերժված է։ Կարող եք կարդալ և պատասխանել միայն ձեզ կցված անդամների համար։','Доступ запрещён. Вы можете читать разговоры и отвечать только назначенным вам участникам.'),
  off:st(locale,'Nurse chat is switched off in this environment.','Բուժքրոջ զրույցն այս միջավայրում անջատված է։','Чат медсестры отключён в этой среде.'),
  unavailable:st(locale,'The conversation is unavailable. Reload to try again.','Զրույցն անհասանելի է։ Թարմացրեք՝ կրկին փորձելու համար։','Разговор недоступен. Обновите страницу для повторной попытки.'),
  missingMessages:st(locale,'Some member messages could not be read or saved and are missing from this conversation. Contact the member to check what they sent before replying.','Անդամի որոշ հաղորդագրություններ չեն կարդացվել կամ պահպանվել և բացակայում են այս զրույցից։ Պատասխանելուց առաջ կապվեք անդամի հետ՝ պարզելու, թե ինչ է ուղարկել։','Некоторые сообщения участника не удалось прочитать или сохранить, и их нет в этом разговоре. Свяжитесь с участником и уточните, что было отправлено, прежде чем отвечать.'),
  shared:st(locale,'Shared conversation','Ընդհանուր զրույց','Общий разговор'),
  empty:st(locale,'No messages yet. You can write the first message.','Հաղորդագրություններ դեռ չկան։ Կարող եք գրել առաջին հաղորդագրությունը։','Сообщений пока нет. Вы можете написать первое сообщение.'),
  readOnly:st(locale,'Reading only. Sending is unavailable while member app chat is switched off.','Միայն կարդալու համար։ Ուղարկումն անհասանելի է, քանի դեռ անդամի հավելվածի զրույցն անջատված է։','Только чтение. Отправка недоступна, пока чат участника в приложении отключён.'),
  write:st(locale,'Write a reply','Գրել պատասխան','Написать ответ'),
  yourReply:st(locale,'Your reply','Ձեր պատասխանը','Ваш ответ'),
  detail:[reason,appOnly,route?.canSend===false?'':opensApp].filter(Boolean).join(' '),
  nextStep,telegramHandoff,
  sentToApp:t('Sent to the app. Reading is not confirmed.','Ուղարկված է հավելվածին։ Կարդալը հաստատված չէ։','Отправлено в приложение. Прочтение не подтверждено.'),
  retry:st(locale,'Check or retry this reply','Ստուգել կամ կրկնել այս պատասխանը','Проверить или повторить ответ'),
  saving:st(locale,'Saving…','Պահպանվում է…','Сохранение…'),
  send:st(locale,'Send my reply','Ուղարկել իմ պատասխանը','Отправить мой ответ'),
  handoff,
 };
}
