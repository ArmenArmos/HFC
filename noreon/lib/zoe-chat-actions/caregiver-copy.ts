/**
 * Copy for the caregiver and consents cards and the caregiver invitation card (WP F). Armenian first, then English and
 * Russian. UNAPPROVED v1, like the rest of the chat card copy. The consent statements themselves live in
 * lib/consents/copy.ts, versioned, because their hash is stored with each decision.
 */
type L={hy:string;en:string;ru:string};
const c=(hy:string,en:string,ru:string):L=>({hy,en,ru});

export const CAREGIVER={
 title:c('Մարդիկ, ովքեր օգնում են ձեզ','People who help you','Люди, которые вам помогают'),
 lead:c('Կարող եք թույլ տալ մինչև երեք մտերիմի օգնել ձեզ։ Ինքներդ եք ընտրում, թե ինչ կարող է անել յուրաքանչյուրը։','You can allow up to three people close to you to help. You choose what each of them can do.','Вы можете разрешить до трёх близким людям помогать вам. Вы сами выбираете, что может делать каждый.'),
 none:c('Դեռ ոչ ոքի չեք հրավիրել։','You have not invited anyone yet.','Вы пока никого не пригласили.'),
 add:c('Հրավիրել մեկին','Invite someone','Пригласить человека'),
 name:c('Անուն','Name','Имя'),
 relationship:c('Ով է նա ձեզ համար','Who they are to you','Кем он вам приходится'),
 phone:c('Հեռախոսահամար՝ երկրի կոդով','Phone number with country code','Номер телефона с кодом страны'),
 phoneHint:c('Նա պետք է մուտք գործի հենց այս համարով։','They must sign in with this exact number.','Этот человек должен войти именно с этим номером.'),
 scopes:c('Ինչ կարող է նա անել','What they can do','Что этот человек может делать'),
 review:c('Ստուգել և հաստատել','Review and confirm','Проверить и подтвердить'),
 confirmLead:c('Ահա թե ինչ եք թույլ տալիս։ Կարդացեք և հաստատեք։','This is what you are allowing. Read it and confirm.','Вот что вы разрешаете. Прочитайте и подтвердите.'),
 confirmInvite:c('Հաստատել և ուղարկել հրավերը','Confirm and send the invitation','Подтвердить и отправить приглашение'),
 back:c('Վերադառնալ և փոխել','Go back and change','Вернуться и изменить'),
 invited:c('Հրավերն ուղարկված է։ Այն կսկսի գործել, երբ նա մուտք գործի իր հեռախոսահամարով և ընդունի այն։','The invitation is sent. It starts working when they sign in with their phone number and accept it.','Приглашение отправлено. Оно начнёт действовать, когда этот человек войдёт со своим номером и примет его.'),
 status:{pending:c('Սպասում է ընդունման','Waiting to be accepted','Ожидает принятия'),active:c('Գործում է','Active','Действует'),revoked:c('Հետ է վերցված','Withdrawn','Отозвано'),declined:c('Մերժված է','Declined','Отклонено'),
  expired:c('Ժամկետն անցել է, 14 օրում չի ընդունվել','Expired, not accepted within 14 days','Срок истёк, не принято за 14 дней')} as Record<'pending'|'active'|'revoked'|'declined'|'expired',L>,
 change:c('Փոխել թույլտվությունները','Change permissions','Изменить разрешения'),
 saveScopes:c('Հաստատել նոր թույլտվությունները','Confirm the new permissions','Подтвердить новые разрешения'),
 scopesSaved:c('Թույլտվությունները թարմացված են։','Permissions updated.','Разрешения обновлены.'),
 revoke:c('Հետ վերցնել թույլտվությունը','Withdraw permission','Отозвать разрешение'),
 revokeConfirm:c('Համոզվա՞ծ եք։ Նա անմիջապես կկորցնի մուտքը։','Are you sure? They lose access straight away.','Вы уверены? Этот человек сразу потеряет доступ.'),
 revokeYes:c('Այո, հետ վերցնել','Yes, withdraw','Да, отозвать'),
 revoked:c('Թույլտվությունը հետ է վերցված։','Permission withdrawn.','Разрешение отозвано.'),
 pickScope:c('Ընտրեք առնվազն մեկ թույլտվություն։','Choose at least one permission.','Выберите хотя бы одно разрешение.'),
 badPhone:c('Ստուգեք համարը։ Սկսեք + նշանով և երկրի կոդով։','Check the number. Start with + and the country code.','Проверьте номер. Начните с + и кода страны.'),
 badName:c('Գրեք անունը։','Enter their name.','Введите имя.'),
 limit:c('Արդեն երեք մարդ ունեք։ Նախ հետ վերցրեք մեկի թույլտվությունը։','You already have three people. Withdraw one first.','У вас уже три человека. Сначала отзовите одно разрешение.'),
 duplicate:c('Այս համարն արդեն հրավիրված է։','This number is already invited.','Этот номер уже приглашён.'),
 ownPhone:c('Սա ձեր սեփական համարն է։','This is your own number.','Это ваш собственный номер.'),
 phoneEnds:(tail:string)=>c(`Համարն ավարտվում է ${tail}-ով`,`Number ends in ${tail}`,`Номер заканчивается на ${tail}`),
};

export const CONSENTS={
 title:c('Ձեր համաձայնությունները','Your consents','Ваши согласия'),
 lead:c('Այստեղ տեսնում եք, թե ինչի եք համաձայնել, և կարող եք փոխել ձեր որոշումը։','Here you see what you have agreed to, and you can change your decision.','Здесь видно, на что вы согласились, и вы можете изменить решение.'),
 granted:c('Համաձայն եք','You agreed','Вы согласились'),
 withdrawn:c('Համաձայն չեք','You did not agree','Вы не согласились'),
 notDecided:c('Դեռ չեք որոշել','Not decided yet','Ещё не решено'),
 read:c('Կարդալ ամբողջությամբ','Read in full','Прочитать полностью'),
 grant:c('Համաձայն եմ','I agree','Я согласен'),
 withdraw:c('Հետ վերցնել համաձայնությունը','Withdraw consent','Отозвать согласие'),
 confirmGrant:c('Հաստատել համաձայնությունը','Confirm consent','Подтвердить согласие'),
 confirmWithdraw:c('Հաստատել հետ վերցնելը','Confirm withdrawal','Подтвердить отзыв'),
 cancel:c('Չեղարկել','Cancel','Отмена'),
 saved:c('Ձեր որոշումը պահված է։','Your decision is saved.','Ваше решение сохранено.'),
 history:c('Որոշումների պատմություն','History of decisions','История решений'),
 noHistory:c('Դեռ որոշումներ չկան։','No decisions yet.','Решений пока нет.'),
 byVoice:c('ձայնով','by voice','голосом'),
 byTap:c('սեղմումով','by tap','нажатием'),
 draft:c('Տեքստը նախնական է և դեռ հաստատված չէ։','This wording is a draft and not yet approved.','Этот текст предварительный и ещё не утверждён.'),
};

export const INVITATION={
 title:c('Ձեզ հրավիրել են օգնելու','You are invited to help','Вас пригласили помогать'),
 lead:(name:string)=>c(`${name}-ը խնդրում է ձեզ օգնել իրեն Նորեոն Հելթի հավելվածում։`,`${name} asks you to help them in the Noreon Health app.`,`${name} просит вас помогать в приложении Нореон Хелс.`),
 someone:c('Ձեր մտերիմներից մեկը','Someone close to you','Близкий вам человек'),
 scopes:c('Դուք կկարողանաք՝','You will be able to:','Вы сможете:'),
 limits:c('Չեք տեսնի այլ բան և չեք կարող փոխել բուժումը։','You will not see anything else and cannot change treatment.','Вы не увидите ничего другого и не сможете изменить лечение.'),
 accept:c('Ընդունել հրավերը','Accept the invitation','Принять приглашение'),
 decline:c('Մերժել','Decline','Отклонить'),
 confirmAccept:c('Հաստատում եմ, որ կօգնեմ','I confirm I will help','Подтверждаю, что буду помогать'),
 accepted:c('Հրավերն ընդունված է։','Invitation accepted.','Приглашение принято.'),
 declined:c('Հրավերը մերժված է։','Invitation declined.','Приглашение отклонено.'),
 gone:c('Այս հրավերն այլևս հասանելի չէ։','This invitation is no longer available.','Это приглашение больше недоступно.'),
 failed:c('Չհաջողվեց։ Փորձեք նորից։','That did not work. Try again.','Не получилось. Попробуйте снова.'),
};

export const CARING={
 title:c('Ում եք օգնում','People you help','Кому вы помогаете'),
 none:c('Դեռ ոչ մեկին չեք օգնում։ Երբ ինչ-որ մեկը հրավիրի ձեզ, հրավերը կհայտնվի այստեղ։','You are not helping anyone yet. When someone invites you, the invitation appears here.','Вы пока никому не помогаете. Когда вас пригласят, приглашение появится здесь.'),
 since:(date:string)=>c(`Օգնում եք ${date}-ից`,`Helping since ${date}`,`Помогаете с ${date}`),
 unavailable:c('Չհաջողվեց բեռնել։ Թարմացրեք էջը։','Could not load. Reload the page.','Не удалось загрузить. Обновите страницу.'),
 disabled:c('Այս հնարավորությունը դեռ միացված չէ։','This is not turned on yet.','Эта возможность пока не включена.'),
};
