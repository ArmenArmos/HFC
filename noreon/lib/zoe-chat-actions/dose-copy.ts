import type {BpFlow} from './bp-flow';
const t=(en:string,hy:string,ru:string)=>({en,hy,ru});
/** Armenian is verbatim section 6; EN/RU remain draft translations. */
export const NO_TITRATION=t(
 'I cannot change your dose, prescribe an additional medicine or stop a regular medicine prescribed by your doctor. I have already sent your information and request to your nurse and doctor so they can review it and let you know. If you have acute symptoms, please call 1-03.',
 'Ես իրավունք չունեմ փոխելու Ձեր դեղաչափը, նշանակելու լրացուցիչ դեղորայք կամ դադարեցնելու բժշկի նշանակած մշտական դեղը։ Ես արդեն փոխանցել եմ Ձեր տվյալն ու հարցումը բուժքրոջը և բժշկին, որպեսզի նրանք վերանայեն և տեղեկացնեն Ձեզ։ Եթե ունեք սուր գանգատներ, խնդրում եմ զանգահարել 1-03։',
 'Я не могу менять вашу дозу, назначать дополнительное лекарство или отменять постоянное лекарство, назначенное вашим врачом. Ваши данные и просьба уже переданы вашей медсестре и врачу, чтобы они рассмотрели их и сообщили вам. При острых симптомах позвоните 1-03.',
);
/** Keep the boundary and acute-symptom sentences verbatim; vary only the notification claim. EN/RU are draft. */
export function noTitrationCopy(flow:BpFlow){
 const sent=flow.taskIds.length>0?flow.sentTo:null;
 if(sent==='physician'&&flow.nurseTask&&flow.taskIds.length>=2)return NO_TITRATION;
 const notification=sent==='physician'?t(
  'I have already sent your information and request to your doctor so they can review it and let you know.',
  'Ես արդեն փոխանցել եմ Ձեր տվյալն ու հարցումը բժշկին, որպեսզի նա վերանայի և տեղեկացնի Ձեզ։',
  'Ваши данные и просьба уже переданы вашему врачу, чтобы он рассмотрел их и сообщил вам.',
 ):sent==='nurse'?t(
  'I have already sent your information and request to your nurse so they can review it and let you know.',
  'Ես արդեն փոխանցել եմ Ձեր տվյալն ու հարցումը բուժքրոջը, որպեսզի նա վերանայի և տեղեկացնի Ձեզ։',
  'Ваши данные и просьба уже переданы вашей медсестре, чтобы она рассмотрела их и сообщила вам.',
 ):t(
  'Your information and request have not been sent yet. Please try again.',
  'Ձեր տվյալն ու հարցումը դեռ չեն փոխանցվել։ Խնդրում եմ կրկին փորձել։',
  'Ваши данные и просьба ещё не переданы. Попробуйте ещё раз.',
 );
 return {
  en:NO_TITRATION.en.replace('I have already sent your information and request to your nurse and doctor so they can review it and let you know.',notification.en),
  hy:NO_TITRATION.hy.replace('Ես արդեն փոխանցել եմ Ձեր տվյալն ու հարցումը բուժքրոջը և բժշկին, որպեսզի նրանք վերանայեն և տեղեկացնեն Ձեզ։',notification.hy),
  ru:NO_TITRATION.ru.replace('Ваши данные и просьба уже переданы вашей медсестре и врачу, чтобы они рассмотрели их и сообщили вам.',notification.ru),
 };
}
/** Draft wording, pending clinical and language approval. */
export const DOSE={
 title:t('Your medicine reminder','Ձեր դեղի հիշեցումը','Ваше напоминание о лекарстве'),
 taken:t('Took it','Ընդունել եմ','Приём отмечен'),
 skipped:t("Didn't take",'Չեմ ընդունել','Не принято'),
 recorded:t('Your answer is recorded. Your approved plan stays the same.','Ձեր պատասխանը գրանցված է։ Ձեր հաստատված պլանը մնում է նույնը։','Ваш ответ записан. Ваш утверждённый план остаётся прежним.'),
 empty:t('There is no confirmed plan dose due now.','Հիմա հաստատված պլանով ընդունման ժամ չկա։','Сейчас нет приёма по подтверждённому плану.'),
 action:(name:string,status:string)=>t(`${status==='taken'?'I took':'I did not take'} ${name}.`,`${name}՝ ${status==='taken'?'ընդունել եմ':'չեմ ընդունել'}։`,`${name}: ${status==='taken'?'приём отмечен':'приём пропущен'}.`),
};
export const BARRIER={
 title:t('What got in the way?','Ի՞նչը խանգարեց։','Что помешало?'),
 forgot:t('Forgot','Մոռացել եմ','Забылось'),
 values_normal:t('Values are normal','Արժեքները նորմալ են','Показатели в норме'),
 side_effect_or_fear:t('Side effect or fear','Կողմնակի ազդեցություն կամ վախ','Побочное действие или опасение'),
 ran_out_or_cost:t('Ran out or cost','Դեղն ավարտվել է կամ թանկ է','Закончилось лекарство или дорого'),
 noDouble:t("Don't take a double dose.",'Մի ընդունեք կրկնակի դեղաչափ։','Не принимайте двойную дозу.'),
 move:t('Would a reminder 15 minutes later help? Your prescribed time stays the same.','15 րոպե ուշ հիշեցումը կօգնի՞։ Ձեր նշանակված ժամը մնում է նույնը։','Поможет напоминание на 15 минут позже? Назначенное время остаётся прежним.'),
 keep:t('Keep my reminder time','Պահել հիշեցման ժամը','Оставить время напоминания'),
 later:t('Move my reminders 15 minutes later','Հիշեցումները տեղափոխել 15 րոպե ուշ','Напоминать на 15 минут позже'),
 moved:t('Your reminders will arrive 15 minutes after the prescribed time, during your waking hours.','Հիշեցումները կգան նշանակված ժամից 15 րոպե հետո՝ ձեր արթուն ժամերին։','Напоминания придут через 15 минут после назначенного времени, в часы бодрствования.'),
 normal:t('Your values can be normal because your medicine is working. Keep following your approved plan and discuss changes with your doctor.','Ձեր արժեքները կարող են նորմալ լինել, քանի որ դեղը գործում է։ Շարունակեք հետևել ձեր հաստատված պլանին և փոփոխությունները քննարկեք ձեր բժշկի հետ։','Показатели могут быть нормальными благодаря лекарству. Следуйте утверждённому плану и обсуждайте изменения с вашим врачом.'),
 questions:t('Answer a few safety questions about what you noticed.','Պատասխանեք անվտանգության մի քանի հարցի ձեր նկատածի մասին։','Ответьте на несколько вопросов безопасности о том, что вы заметили.'),
 logistics:t('Your coordinator received your request for help getting your medicine.','Ձեր համակարգողը ստացել է դեղը ձեռք բերելու հարցում օգնության խնդրանքը։','Ваш координатор получил просьбу помочь с получением лекарства.'),
 checked:t('Your answers are recorded. Discuss your concern with your doctor before changing your plan.','Ձեր պատասխանները գրանցված են։ Մինչև պլանը փոխելը ձեր մտահոգությունը քննարկեք ձեր բժշկի հետ։','Ваши ответы записаны. Обсудите опасения с вашим врачом перед изменением плана.'),
 safety:t('Medicine safety questions','Դեղի անվտանգության հարցեր','Вопросы безопасности лекарства'),
 musclePain:t('Have you had pain in muscles on both sides since starting your medicine?','Դեղը սկսելուց հետո երկու կողմերի մկաններում ցավ ունե՞ք։','После начала приёма лекарства болят мышцы с обеих сторон?'),
 weakness:t('Do you have marked weakness when rising from a chair or climbing stairs?','Աթոռից վեր կենալիս կամ աստիճան բարձրանալիս արտահայտված թուլություն ունե՞ք։','Есть выраженная слабость при вставании со стула или подъёме по лестнице?'),
 darkUrine:t('Is your urine dark like tea or cola?','Ձեր մեզը թեյի կամ կոլայի պես մո՞ւգ է։','Ваша моча тёмная, как чай или кола?'),
 fever:t('Do you have an unexplained fever?','Անբացատրելի ջերմություն ունե՞ք։','Есть необъяснимая температура?'),
 jaundice:t('Are your skin or eyes yellow?','Ձեր մաշկը կամ աչքերը դեղնե՞լ են։','Пожелтела кожа или глаза?'),
 rightUpperPain:t('Do you have pain in the upper right side of your abdomen?','Որովայնի վերին աջ մասում ցավ ունե՞ք։','Есть боль в правой верхней части живота?'),
 emergency:t('I have muscle symptoms with warning signs.','Ես ունեմ մկանային ախտանիշներ՝ նախազգուշական նշաններով։','У меня мышечные симптомы с тревожными признаками.'),
};
