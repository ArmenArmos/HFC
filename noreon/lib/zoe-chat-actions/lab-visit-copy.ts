/** Draft HY/EN/RU. Preparation itself is the clinic's stored text, never generated. */
const c=(en:string,hy:string,ru:string)=>({en,hy,ru});
export const LAB_VISIT={
 prep:c('Prepare for your lab','Պատրաստվեք ձեր հետազոտությանը','Подготовьтесь к анализам'),
 fasting:c('Before your lab','Հետազոտությունից առաջ','Перед анализами'),
 read:c('I’ve read my preparation checklist','Կարդացի պատրաստման ցուցակը','Я прочитал(а) памятку по подготовке'),
 readSaid:c('I read my lab preparation checklist.','Կարդացի հետազոտության պատրաստման ցուցակը։','Я прочитал(а) памятку по подготовке к анализам.'),
 readReply:c('You can find your preparation here when you need it.','Պատրաստման ցուցումները կարող եք գտնել այստեղ, երբ պետք լինի։','Вы можете найти рекомендации по подготовке здесь, когда они понадобятся.'),
 haveNotEaten:c('I haven’t eaten','Ես չեմ կերել','Я не ел(а)'),ate:c('I ate','Ես կերել եմ','Я ел(а)'),
 ateSaid:c('I ate before my lab.','Ես կերել եմ հետազոտությունից առաջ։','Я ел(а) перед анализами.'),
 fastingSaid:c('I haven’t eaten before my lab.','Ես չեմ կերել հետազոտությունից առաջ։','Я не ел(а) перед анализами.'),
 warning:c('Eating may affect your results. The admin will rebook you.','Սնունդը կարող է ազդել ձեր արդյունքների վրա։ Համակարգողը կվերագրանցի ձեզ։','Еда может повлиять на ваши результаты. Администратор перенесёт вашу запись.'),
 fastingReply:c('Your answer is saved. Follow your clinic’s preparation instructions.','Ձեր պատասխանը պահված է։ Հետևեք ձեր կլինիկայի պատրաստման ցուցումներին։','Ваш ответ сохранён. Следуйте рекомендациям вашей клиники по подготовке.'),
 adminChange:c('Ask admin to change','Խնդրել համակարգողին փոխել','Попросить администратора изменить'),
 adminSaid:c('I asked the admin to change my lab visit.','Խնդրեցի համակարգողին փոխել իմ լաբորատոր այցը։','Я попросил(а) администратора изменить мой визит на анализы.'),
 adminReply:c('Your request is with the admin. Your visit time stays the same until a change is confirmed.','Ձեր հարցումը համակարգողի մոտ է։ Այցի ժամը մնում է նույնը մինչև փոփոխության հաստատումը։','Ваша заявка у администратора. Время визита остаётся прежним до подтверждения изменения.'),
 confirm:c('Confirm','Հաստատել','Подтвердить'),
};

/** DRAFT: visit-request wording in all three languages awaits Armen's review. */
export const VISIT_REQUEST={
 message:c('Visit request','Այցի հարցում','Заявка на визит'),
 intro:c('Choose your preferred day and time of day. The care team will confirm your time here.','Ընտրեք ձեր նախընտրած օրը և օրվա հատվածը։ Խնամքի թիմը կհաստատի ժամը այստեղ։','Выберите удобный день и время суток. Команда заботы подтвердит время здесь.'),
 day:c('Preferred day','Նախընտրած օր','Предпочтительный день'),
 chooseDay:c('Choose a day','Ընտրեք օրը','Выберите день'),
 window:c('Time of day','Օրվա հատված','Время суток'),
 morning:c('Morning','Առավոտ','Утро'),afternoon:c('Afternoon','Կեսօրից հետո','День'),evening:c('Evening','Երեկո','Вечер'),
 note:c('Note (optional, up to 200 characters)','Նշում (ըստ ցանկության, մինչև 200 նիշ)','Примечание (необязательно, до 200 символов)'),
 send:c('Send my request','Ուղարկել իմ հարցումը','Отправить мою заявку'),
 retry:c('Try sending my request again','Կրկին փորձել ուղարկել իմ հարցումը','Попробовать отправить мою заявку снова'),
 pending:c('Your request is saved on this card. Try sending it again to finish.','Ձեր հարցումը պահված է այս քարտում։ Ավարտելու համար կրկին փորձեք ուղարկել այն։','Ваша заявка сохранена в этой карточке. Попробуйте отправить её снова, чтобы завершить.'),
 sent:c('Request sent. The care team will confirm your time here.','Հարցումն ուղարկված է։ Խնամքի թիմը կհաստատի ձեր ժամը այստեղ։','Заявка отправлена. Команда заботы подтвердит время здесь.'),
 unavailable:c('Visit days could not be loaded. Try loading them again.','Չհաջողվեց բեռնել այցի օրերը։ Փորձեք կրկին բեռնել դրանք։','Не удалось загрузить дни для визита. Попробуйте загрузить их снова.'),
 reload:c('Load visit days again','Կրկին բեռնել այցի օրերը','Загрузить дни для визита снова'),
 invalid:c('Choose an available day and time of day. Keep your note to 200 characters of plain text on one line.','Ընտրեք հասանելի օր և օրվա հատված։ Նշումը գրեք մեկ տողով՝ մինչև 200 նիշ պարզ տեքստով։','Выберите доступный день и время суток. Примечание должно содержать до 200 символов обычного текста в одной строке.'),
};
