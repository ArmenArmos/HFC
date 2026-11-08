import { pick, type Locale } from '@/lib/locale';

/**
 * Plain staff wording for delivery states. Accepted never means read; unknown is
 * never resent; held always says why nothing was sent. These are Telegram states: with the
 * member app chat on (conversation_policy.app_chat_enabled), an approved reply is released to
 * the member's app thread when they read it while its context is still current, or once
 * Telegram carried it; a release is never withdrawn (conversation_app_releases).
 */
export type DeliveryState='queued'|'held'|'sending'|'accepted_by_provider'|'definitely_failed'|'unknown';
export type DeliveryTone='neutral'|'complete'|'attention';

export const deliveryLabel:Record<DeliveryState,{label:string;tone:DeliveryTone;detail:string}>={
 queued:{label:'Approved, waiting to send',tone:'neutral',detail:'It will be sent to the member’s Telegram shortly.'},
 sending:{label:'Sending',tone:'neutral',detail:'Telegram has not answered yet. It is not sent again while we wait.'},
 accepted_by_provider:{label:'Sent',tone:'complete',detail:'Telegram accepted the message. This does not confirm the member has read it.'},
 definitely_failed:{label:'Not sent',tone:'attention',detail:'It was not delivered. Contact the member another way if it matters.'},
 unknown:{label:'Unknown',tone:'attention',detail:'We can’t confirm it arrived. It will not be resent automatically.'},
 held:{label:'Held',tone:'attention',detail:'Nothing was sent.'},
};

const holdReasons:Record<string,string>={
 newer_member_message:'The member wrote again after you approved. Review the new message and approve a new reply. Nothing was sent to Telegram. If the member opened the app chat before this, they may have read it there.',
 route_policy_missing:'The member has no active Telegram connection, or sending is switched off. Nothing was sent to Telegram. When the member app chat is on, the member reads the reply there while it is still current.',
 route_unavailable:'The member has no active Telegram connection, or sending is switched off. Nothing was sent to Telegram. When the member app chat is on, the member reads the reply there while it is still current.',
 endpoint_unlinked:'The member disconnected Telegram. Nothing was sent to Telegram. If the member opened the app chat before this, they may have read it there.',
 endpoint_relinked:'The member connected a different Telegram account. Nothing was sent to Telegram. If the member opened the app chat before this, they may have read it there. Write and approve a new reply. The approved text stays on the conversation page.',
 stale_context:'The member’s information changed after approval. Nothing was sent to Telegram. If the member opened the app chat before this, they may have read it there. Review it, then write and approve a new reply.',
 approval_authority_lapsed:'The approving session ended before sending. Nothing was sent. Write and approve a new reply. The approved text stays on the conversation page.',
 member_over_intake_limit:'The member sent more messages than the intake limit allows, and those messages were not saved. Nothing was sent to Telegram. If the member opened the app chat before this, they may have read it there. Contact the member, then write a new reply.',
 member_sent_unsupported_media:'The member sent a photo, voice message, location or other non-text message that Noreon cannot read. Nothing was sent to Telegram. If the member opened the app chat before this, they may have read it there. Contact the member, then write a new reply.',
 template_unapproved:'The automatic message wording is not approved yet. Nothing was sent.',
 template_changed:'The automatic message wording changed after it was queued. Nothing was sent.',
};
export const holdReason=(reason:string|null)=>reason&&holdReasons[reason]?holdReasons[reason]:deliveryLabel.held.detail;
export const deliveryDetail=(state:DeliveryState,reason:string|null)=>state==='held'?holdReason(reason):deliveryLabel[state].detail;

/** Armenian staff wording for the same states (review R3 of #381). English above stays the default. */
const appMaybe='Եթե անդամը մինչ այդ բացել էր հավելվածի զրույցը, հնարավոր է՝ կարդացել է այն այնտեղ։';
const holdReasonsHy:Record<string,string>={
 newer_member_message:`Հաստատելուց հետո անդամը կրկին գրել է։ Դիտեք նոր հաղորդագրությունը և հաստատեք նոր պատասխան։ Telegram-ին ոչինչ չի ուղարկվել։ ${appMaybe}`,
 route_policy_missing:'Անդամը չունի ակտիվ Telegram կապ, կամ ուղարկումն անջատված է։ Telegram-ին ոչինչ չի ուղարկվել։ Երբ հավելվածի զրույցը միացված է, անդամը պատասխանը կարդում է այնտեղ, քանի դեռ այն արդիական է։',
 route_unavailable:'Անդամը չունի ակտիվ Telegram կապ, կամ ուղարկումն անջատված է։ Telegram-ին ոչինչ չի ուղարկվել։ Երբ հավելվածի զրույցը միացված է, անդամը պատասխանը կարդում է այնտեղ, քանի դեռ այն արդիական է։',
 endpoint_unlinked:`Անդամն անջատել է Telegram-ը։ Telegram-ին ոչինչ չի ուղարկվել։ ${appMaybe}`,
 endpoint_relinked:`Անդամը միացրել է այլ Telegram հաշիվ։ Telegram-ին ոչինչ չի ուղարկվել։ ${appMaybe} Գրեք և հաստատեք նոր պատասխան։ Հաստատված տեքստը մնում է զրույցի էջում։`,
 stale_context:`Հաստատելուց հետո անդամի տվյալները փոխվել են։ Telegram-ին ոչինչ չի ուղարկվել։ ${appMaybe} Դիտեք այն, ապա գրեք և հաստատեք նոր պատասխան։`,
 approval_authority_lapsed:'Հաստատող աշխատաշրջանն ավարտվել է մինչև ուղարկելը։ Ոչինչ չի ուղարկվել։ Գրեք և հաստատեք նոր պատասխան։ Հաստատված տեքստը մնում է զրույցի էջում։',
 member_over_intake_limit:`Անդամն ուղարկել է թույլատրվածից ավելի հաղորդագրություններ, և դրանք չեն պահպանվել։ Telegram-ին ոչինչ չի ուղարկվել։ ${appMaybe} Կապվեք անդամի հետ, ապա գրեք նոր պատասխան։`,
 member_sent_unsupported_media:`Անդամն ուղարկել է լուսանկար, ձայնային հաղորդագրություն, տեղորոշում կամ այլ ոչ տեքստային հաղորդագրություն, որը Noreon-ը չի կարող կարդալ։ Telegram-ին ոչինչ չի ուղարկվել։ ${appMaybe} Կապվեք անդամի հետ, ապա գրեք նոր պատասխան։`,
 template_unapproved:'Ավտոմատ հաղորդագրության ձևակերպումը դեռ հաստատված չէ։ Ոչինչ չի ուղարկվել։',
 template_changed:'Ավտոմատ հաղորդագրության ձևակերպումը փոխվել է հերթագրվելուց հետո։ Ոչինչ չի ուղարկվել։',
};
const appMaybeRu='Если участник до этого открыл чат в приложении, возможно, он прочитал ответ там.';
const holdReasonsRu:Record<string,string>={
 newer_member_message:`Участник написал снова после того, как вы утвердили ответ. Просмотрите новое сообщение и утвердите новый ответ. В Telegram ничего не отправлено. ${appMaybeRu}`,
 route_policy_missing:'У участника нет активного подключения к Telegram или отправка отключена. В Telegram ничего не отправлено. Если чат в приложении включён, участник может прочитать ответ там, пока он актуален.',
 route_unavailable:'У участника нет активного подключения к Telegram или отправка отключена. В Telegram ничего не отправлено. Если чат в приложении включён, участник может прочитать ответ там, пока он актуален.',
 endpoint_unlinked:`Участник отключил Telegram. В Telegram ничего не отправлено. ${appMaybeRu}`,
 endpoint_relinked:`Участник подключил другой аккаунт Telegram. В Telegram ничего не отправлено. ${appMaybeRu} Напишите и утвердите новый ответ. Утверждённый текст остаётся на странице переписки.`,
 stale_context:`Данные участника изменились после утверждения. В Telegram ничего не отправлено. ${appMaybeRu} Просмотрите данные, затем напишите и утвердите новый ответ.`,
 approval_authority_lapsed:'Сеанс, в котором был утверждён ответ, завершился до отправки. Ничего не отправлено. Напишите и утвердите новый ответ. Утверждённый текст остаётся на странице переписки.',
 member_over_intake_limit:`Участник отправил больше сообщений, чем допускает лимит приёма, и эти сообщения не были сохранены. В Telegram ничего не отправлено. ${appMaybeRu} Свяжитесь с участником, затем напишите новый ответ.`,
 member_sent_unsupported_media:`Участник отправил фотографию, голосовое сообщение, геопозицию или другое нетекстовое сообщение, которое Noreon не может прочитать. В Telegram ничего не отправлено. ${appMaybeRu} Свяжитесь с участником, затем напишите новый ответ.`,
 template_unapproved:'Текст автоматического сообщения ещё не утверждён. Ничего не отправлено.',
 template_changed:'Текст автоматического сообщения изменился после добавления в очередь. Ничего не отправлено.',
};
/** Staff reply copy. Legacy exports above keep other English surfaces unchanged. */
const replyCopy:Record<DeliveryState,Record<Locale,{label:string;detail:string}>>={
 queued:{en:{label:'Sent',detail:'Waiting for Telegram to accept it.'},hy:{label:'Ուղարկված է',detail:'Սպասում ենք, որ Telegram-ն ընդունի այն։'},ru:{label:'Отправлено',detail:'Ожидаем, когда Telegram примет сообщение.'}},
 sending:{en:{label:'Sent',detail:'Waiting for Telegram to accept it.'},hy:{label:'Ուղարկված է',detail:'Սպասում ենք, որ Telegram-ն ընդունի այն։'},ru:{label:'Отправлено',detail:'Ожидаем, когда Telegram примет сообщение.'}},
 accepted_by_provider:{en:{label:'Delivered',detail:'Telegram accepted it. This does not confirm the member has read it.'},hy:{label:'Առաքված է',detail:'Telegram-ն ընդունել է այն։ Սա չի հաստատում, որ անդամը կարդացել է այն։'},ru:{label:'Доставлено',detail:'Telegram принял сообщение. Это не подтверждает, что участник его прочитал.'}},
 definitely_failed:{en:{label:'Not delivered',detail:'Telegram did not accept the message. Nothing was sent.'},hy:{label:'Չի առաքվել',detail:'Telegram-ը չի ընդունել հաղորդագրությունը։ Ոչինչ չի ուղարկվել։'},ru:{label:'Не доставлено',detail:'Telegram не принял сообщение. Ничего не отправлено.'}},
 held:{en:{label:'Not delivered',detail:'Nothing was sent. Review the conversation and approve a new reply.'},hy:{label:'Չի առաքվել',detail:'Ոչինչ չի ուղարկվել։ Վերանայեք զրույցը և հաստատեք նոր պատասխան։'},ru:{label:'Не доставлено',detail:'Ничего не отправлено. Проверьте разговор и утвердите новый ответ.'}},
 unknown:{en:{label:'Not confirmed',detail:"We can't confirm it arrived. To avoid sending it twice, there is no retry. Contact the member another way."},hy:{label:'Հաստատված չէ',detail:'Չենք կարող հաստատել, որ այն հասել է։ Կրկնակի ուղարկումից խուսափելու համար կրկին ուղարկելու հնարավորություն չկա։ Կապվեք անդամի հետ այլ եղանակով։'},ru:{label:'Не подтверждено',detail:'Не можем подтвердить доставку. Чтобы не отправить сообщение дважды, повторная отправка недоступна. Свяжитесь с участником другим способом.'}},
};
const failureCopy:Record<string,Record<Locale,string>>={
 telegram_bot_blocked:{en:'The member blocked the bot. Nothing was sent.',hy:'Անդամն արգելափակել է բոտին։ Ոչինչ չի ուղարկվել։',ru:'Участник заблокировал бота. Ничего не отправлено.'},
 telegram_chat_not_found:{en:'The Telegram chat was not found. Nothing was sent.',hy:'Telegram-ի զրույցը չի գտնվել։ Ոչինչ չի ուղարկվել։',ru:'Чат Telegram не найден. Ничего не отправлено.'},
 telegram_message_refused:{en:'Telegram refused the message. Nothing was sent.',hy:'Telegram-ը մերժել է հաղորդագրությունը։ Ոչինչ չի ուղարկվել։',ru:'Telegram отклонил сообщение. Ничего не отправлено.'},
 telegram_timeout:{en:'Telegram did not answer in time.',hy:'Telegram-ը ժամանակին չի պատասխանել։',ru:'Telegram не ответил вовремя.'},
 not_sent_unsupported_payload:{en:'Telegram cannot carry this reply as approved. Write and approve a new reply.',hy:'Telegram-ը չի կարող փոխանցել այս պատասխանը հաստատված տեսքով։ Գրեք և հաստատեք նոր պատասխան։',ru:'Telegram не может отправить ответ в утверждённом виде. Напишите и утвердите новый ответ.'},
 'Adapter unavailable before invocation':{en:'Telegram sending was unavailable. Nothing was sent.',hy:'Telegram-ով ուղարկումն անհասանելի էր։ Ոչինչ չի ուղարկվել։',ru:'Отправка через Telegram была недоступна. Ничего не отправлено.'},
};
const authorityHold:Record<Locale,string>={en:'The approving session ended before sending. Nothing was sent. You can retry after your access and the Telegram connection are restored.',hy:'Հաստատող աշխատաշրջանն ավարտվել է մինչև ուղարկելը։ Ոչինչ չի ուղարկվել։ Հասանելիությունը և Telegram կապը վերականգնելուց հետո կարող եք կրկին փորձել։',ru:'Сеанс подтверждения завершился до отправки. Ничего не отправлено. Повторите попытку после восстановления доступа и подключения к Telegram.'};
export const deliveryLabelText=(state:DeliveryState,locale:Locale='en')=>replyCopy[state][locale].label;
export function deliveryDetailText(state:DeliveryState,reason:string|null,locale:Locale='en'){
 if(state==='held'&&reason){
  if(reason==='approval_authority_lapsed')return authorityHold[locale];
  const reasons=locale==='hy'?holdReasonsHy:locale==='ru'?holdReasonsRu:holdReasons;
  return reasons[reason]??replyCopy.held[locale].detail;
 }
 if(state==='definitely_failed'&&reason)return failureCopy[reason]?.[locale]??replyCopy.definitely_failed[locale].detail;
 return replyCopy[state][locale].detail;
}
/** The database checks route, authority and current context; client state alone never grants retry. */
export function canRetryDelivery(delivery:{state:DeliveryState;reason:string|null;can_retry?:boolean}){
 return delivery.can_retry===true&&(delivery.state==='definitely_failed'||delivery.state==='held'&&['route_unavailable','route_policy_missing','approval_authority_lapsed'].includes(delivery.reason??''));
}
export const retryLabel=(locale:Locale='en')=>pick(locale,{en:'Retry',hy:'Կրկին փորձել',ru:'Повторить'});
/** Only fixed rejection codes are rendered, never database/provider messages. */
export function approvalFailureText(code:string,locale:Locale='en'){
 if(code==='stale_context'||code==='newer_member_message')return pick(locale,{en:'Nothing was sent. The conversation changed. Your text is kept. Review the latest messages and approve a new reply.',hy:'Ոչինչ չի ուղարկվել։ Զրույցը փոխվել է։ Ձեր տեքստը պահված է։ Վերանայեք վերջին հաղորդագրությունները և հաստատեք նոր պատասխան։',ru:'Ничего не отправлено. Разговор изменился. Ваш текст сохранён. Проверьте последние сообщения и утвердите новый ответ.'});
 if(['route_unavailable','route_policy_missing','approval_authority_lapsed'].includes(code))return deliveryDetailText('held',code,locale);
 if(['stale_context','newer_member_message','endpoint_relinked','member_over_intake_limit','member_sent_unsupported_media'].includes(code))return deliveryDetailText('held',code,locale);
 if(['refused','42501','approval_access','grant_expired','authority_lapsed'].includes(code))return pick(locale,{en:'Nothing was sent. Your approval access has ended. Sign in again and review the saved reply.',hy:'Ոչինչ չի ուղարկվել։ Հաստատելու հասանելիությունն ավարտվել է։ Կրկին մուտք գործեք և ստուգեք պահպանված պատասխանը։',ru:'Ничего не отправлено. Доступ к подтверждению завершён. Войдите снова и проверьте сохранённый ответ.'});
 return pick(locale,{en:'Nothing was sent. The reply could not be approved. Your text is kept. Reload and review it before trying again.',hy:'Ոչինչ չի ուղարկվել։ Պատասխանը չհաջողվեց հաստատել։ Ձեր տեքստը պահված է։ Թարմացրեք էջը և ստուգեք այն՝ կրկին փորձելուց առաջ։',ru:'Ничего не отправлено. Не удалось утвердить ответ. Ваш текст сохранён. Обновите страницу и проверьте его перед новой попыткой.'});
}

export function retryFailureText(code:string,locale:Locale='en'){
 if(['route_unavailable','route_policy_missing','approval_authority_lapsed','stale_context','approval_access','refused'].includes(code))return approvalFailureText(code,locale);
 return pick(locale,{en:'This reply cannot be retried now. Reload the conversation to check its current status.',hy:'Այս պատասխանը հիմա կրկին ուղարկել հնարավոր չէ։ Ընթացիկ կարգավիճակը ստուգելու համար թարմացրեք զրույցը։',ru:'Сейчас повторная отправка этого ответа недоступна. Обновите разговор, чтобы проверить текущий статус.'});
}
