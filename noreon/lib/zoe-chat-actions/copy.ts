import {isUnverifiedBp,unverifiedBpLabel} from "@/lib/patient/bp-provenance";
import {NEXT_STEP} from './next-step-copy';
import {memberDoctorLabel,memberStaffName} from "@/lib/member-staff-name.mjs";
import {CONSULT} from './consult-copy';
import {LABS} from './labs-copy';
import type {CardKind} from './registry';
import {CAREGIVER,CARING,CONSENTS,INVITATION} from './caregiver-copy';

/**
 * Zoe chat card copy. Armenian is primary, then English and Russian. UNAPPROVED v1: Armenian and Russian wording for
 * Tatevik, the side-effect list and the BP and side-effect lines for Armen. Lines reused from screens that already
 * carry approved or reviewed wording (the BP week entry, the BP form, the medicine ask) are taken from there.
 * scripts/check-zoe-chat-actions.ts enforces: every locale has every line; no exclamation mark, emoji or em dash.
 */
export const ZOE_CARD_COPY_VERSION='zoe-chat-cards-v1-unapproved';
export type CardLocale='hy'|'en'|'ru';
type L={hy:string;en:string;ru:string};
const c=(hy:string,en:string,ru:string):L=>({hy,en,ru});
export const say=(l:CardLocale,line:L)=>line[l];

/** The chips under the thread; each opens its card in the thread. */
export const CHIP:Record<CardKind,L>={
 review:NEXT_STEP.review,next_step:NEXT_STEP.title,tests_needed:NEXT_STEP.tests,
 sams:c('Անվտանգության հարցեր','Safety questions','Вопросы безопасности'),
 prep:{en:"Prepare for your lab",hy:"Պատրաստվեք ձեր հետազոտությանը",ru:"Подготовьтесь к анализам"},fasting:{en:"Before your lab",hy:"Հետազոտությունից առաջ",ru:"Перед анализами"},
 consult_questions:CONSULT.title,symptom_gate:CONSULT.gate,document:LABS.document,
 medicines:c('Իմ դեղերը','My medicines','Мои лекарства'),
 profile:c('Ինչպես կապվել ինձ հետ','How to reach me','Как со мной связаться'),
 account:c('Իմ տվյալներն ու կարգավորումները','My details and settings','Мои данные и настройки'),
 dose:c('Նշել այսօրվա դեղերը','Log today’s medicine','Отметить лекарства на сегодня'),
 bp:c('Գրանցել ճնշումը','Record blood pressure','Записать давление'),
 results:c('Իմ վերջին արդյունքները','My latest results','Мои последние результаты'),
 plan:c('Իմ պլանը','My plan','Мой план'),
 visit:c('Իմ այցը','My visit','Мой визит'),
 side_effect:c('Հայտնել կողմնակի ազդեցության մասին','Report a side effect','Сообщить о побочном эффекте'),
 message:c('Գրել խնամքի թիմին','Message my care team','Написать медицинской команде'),
 ldl:c('Իմ ՑԽԼ նպատակը','My LDL goal','Моя цель по ЛПНП'),
 ask:c('Զոյան արագ հարց ունի','Zoe has a quick question','У Зои есть короткий вопрос'),
 menu:c('Ինչ կարող եմ անել','What I can do','Что я могу сделать'),
 repeat:c('Կրկնել չափումը','Repeat the reading','Повторить измерение'),
 red_flags:c('Անվտանգության հարցեր','Safety questions','Вопросы безопасности'),
 caregiver:c('Մարդիկ, ովքեր օգնում են ինձ','People who help me','Люди, которые мне помогают'),
 consents:c('Իմ համաձայնությունները','My consents','Мои согласия'),
};
export const TITLE:Record<CardKind,L>={
 review:NEXT_STEP.review,next_step:NEXT_STEP.title,tests_needed:NEXT_STEP.tests,
 sams:c('Անվտանգության հարցեր','Safety questions','Вопросы безопасности'),
 prep:{en:"Prepare for your lab",hy:"Պատրաստվեք ձեր հետազոտությանը",ru:"Подготовьтесь к анализам"},fasting:{en:"Before your lab",hy:"Հետազոտությունից առաջ",ru:"Перед анализами"},
 consult_questions:CONSULT.title,symptom_gate:CONSULT.gate,document:LABS.document,
 medicines:c('Ձեր դեղերը','Your medicines','Ваши лекарства'),
 profile:c('Ինչպե՞ս կապվենք ձեզ հետ','How should we reach you?','Как с вами связаться?'),
 account:c('Ձեր տվյալներն ու կարգավորումները','Your details and settings','Ваши данные и настройки'),
 dose:c('Այսօրվա դեղերը','Today’s medicines','Лекарства на сегодня'),
 bp:c('Ճնշման չափում','Blood pressure reading','Измерение давления'),
 results:c('Ձեր վերջին արդյունքները','Your latest results','Ваши последние результаты'),
 plan:c('Ձեր պլանը','Your plan','Ваш план'),
 visit:c('Ձեր այցը','Your visit','Ваш визит'),
 side_effect:c('Ի՞նչ եք նկատում','What are you noticing?','Что вы замечаете?'),
 message:c('Գրել ձեր խնամքի թիմին','Message your care team','Написать вашей медицинской команде'),
 ldl:c('Ձեր ՑԽԼ խոլեստերինի նպատակը','Your LDL cholesterol goal','Ваша цель по холестерину ЛПНП'),
 ask:c('Զոյան արագ հարց ունի','Zoe has a quick question','У Зои есть короткий вопрос'),
 menu:c('Ի՞նչ կցանկանայիք անել','What would you like to do?','Что вы хотите сделать?'),
 repeat:c('Կրկնենք չափումը','Let’s repeat the reading','Повторим измерение'),
 red_flags:c('Մի քանի հարց անվտանգության համար','A few safety questions','Несколько вопросов для безопасности'),
 caregiver:CAREGIVER.title,
 consents:CONSENTS.title,
};
export {CAREGIVER,CARING,CONSENTS,INVITATION};

export const COMMON={
 quickActions:c('Արագ գործողություններ','Quick actions','Быстрые действия'),
 card:c('Զոյայի քարտ','Zoe card','Карточка Зои'),
 asShown:(t:string)=>c(`Ցույց է տրված ${t}-ի դրությամբ`,`As shown at ${t}`,`Данные на ${t}`),
 seeCurrent:c('Տեսնել ներկա վիճակը','See current','Посмотреть текущие данные'),
 showCurrent:c('Թարմացնել','Refresh','Обновить'),
 back:c('Հետ','Go back','Назад'),
 offer:c('Կարող եմ դա անել այստեղ՝','I can do this here:','Я могу сделать это здесь:'),
 visitHeld:c('Ձեր խնամքի թիմը կկապվի ձեզ հետ նախքան այցի ամրագրումը։','Your care team will contact you before booking.','Ваша медицинская команда свяжется с вами до записи на визит.'),
 openFailed:c('Չհաջողվեց բացել։ Կրկին փորձեք։','We could not open this. Try again.','Не удалось открыть. Попробуйте снова.'),
 rateLimited:c('Կարճ ժամանակում շատ քարտ եք բացել։ Մի քանի րոպե սպասեք։','You opened many cards in a short time. Wait a few minutes.','Вы открыли много карточек за короткое время. Подождите несколько минут.'),
 saveFailed:c('Չհաջողվեց պահել։ Կրկին փորձեք։','We could not save this. Try again.','Не удалось сохранить. Попробуйте снова.'),
 // A lost reply: it may have been saved. The retry replays, so it never saves twice.
 unconfirmed:c('Չհաջողվեց հաստատել պահպանումը։ Կրկին փորձեք, այն երկու անգամ չի պահվի։','We could not confirm this was saved. Try again, it will not be saved twice.','Не удалось подтвердить сохранение. Попробуйте снова, дважды это не сохранится.'),
 stale:c('Սա փոխվել է քարտը ցույց տալուց հետո։ Տեսեք ներկա վիճակը։','This changed after the card was shown. See the current record.','Это изменилось после того, как карточка была показана. Посмотрите текущие данные.'),
 staleInChat:c('Սա փոխվել է քարտը ցույց տալուց հետո։ Կարող եք ներկա վիճակը տեսնել այստեղ՝ զրույցում։','This changed after the card was shown. You can see the current record here in the chat.','Это изменилось после того, как карточка была показана. Текущие данные можно посмотреть здесь, в чате.'),
 closed:c('Այս քարտն արդեն փակված է։','This card is already closed.','Эта карточка уже закрыта.'),
 unreadable:c('Այս քարտը հնարավոր չէ ցույց տալ։','This card cannot be shown.','Эту карточку невозможно показать.'),
 retry:c('Կրկին փորձել','Try again','Попробуйте снова'),
};

export const DOSE={
 change:c('Փոխել','Change','Изменить'),
 changeToTaken:c('Փոխել՝ ընդունված','Change to taken','Изменить на «Принято»'),
 changeToMissed:c('Փոխել՝ բաց թողնված','Change to skipped','Изменить на «Пропущено»'),
 empty:c('Այսօրվա համար նշելու դեղ չկա։','There is no medicine to log for today.','На сегодня нет лекарств для отметки.'),
 off:c('Դեղերի նշումը այստեղ դեռ միացված չէ։','Logging medicines is not on here yet.','Отметка лекарств здесь пока не включена.'),
 taken:c('Ընդունված է','Taken','Принято'),
 skipped:c('Բաց է թողնված','Missed','Пропущено'),
 later:(t:string)=>c(`Կարելի է նշել ${t}-ից մեկ ժամ առաջ`,`You can log it from an hour before ${t}`,`Можно отметить за час до ${t}`),
 laterPlan:(t:string)=>c(`Կարելի է նշել ${t}-ից`,`You can log it from ${t}`,`Можно отметить с ${t}`),
 markTaken:c('Նշել՝ ընդունված','Mark as taken','Отметить как принятое'),
 markMissed:c('Նշել՝ բաց թողնված','Mark as missed','Отметить как пропущенное'),
 confirmTaken:(what:string)=>c(`Նշել որպես ընդունված՝ ${what}`,`Mark as taken: ${what}`,`Отметить как принятое: ${what}`),
 confirmMissed:(what:string)=>c(`Նշել որպես բաց թողնված՝ ${what}`,`Mark as missed: ${what}`,`Отметить как пропущенное: ${what}`),
 yes:c('Այո, նշել','Yes, mark it','Да, отметить'),
 notDue:c('Այս դեղաչափը դեռ հնարավոր չէ նշել։','This dose cannot be logged yet.','Эту дозу пока нельзя отметить.'),
 doneTaken:c('Նշված է՝ ընդունված։','Logged as taken.','Отмечено как принятое.'),
 doneMissed:c('Նշված է՝ բաց թողնված։','Logged as missed.','Отмечено как пропущенное.'),
};

/** Telegram has no form: a side effect is chosen, and anything else is simply typed, and Zoe reads it first. */
export const TG_WRITE={
 message:c('Գրեք այստեղ, թե ինչ եք ուզում, որ ձեր խնամքի թիմն իմանա։ Զոյան առաջինը կկարդա այն։','Write here what you want your care team to know. Zoe reads it first.','Напишите здесь, что должна знать ваша медицинская команда. Зоя прочитает это первой.'),
 other:c('Գրեք այստեղ, թե ինչ եք նկատում։','Write here what you are noticing.','Напишите здесь, что вы замечаете.'),
 sent:c('Ուղարկված է։','Sent.','Отправлено.'),
};
export const NOTICE={redo:c('Խմբագրված կամ փոխանցված հաղորդագրությունները չեմ կարդում։ Խնդրում եմ գրել այն որպես նոր հաղորդագրություն։','I do not read edited or forwarded messages. Please send it as a new message.','Я не читаю изменённые или пересланные сообщения. Пожалуйста, отправьте его новым сообщением.'),answer:c('Պատասխանել Զոյային','Answer Zoe','Ответить Зое')};

/** Lines only Telegram needs: a button press has no page to fall back on. */
export const TELEGRAM={
 notLinked:c('Այս զրույցն այլևս կապված չէ ձեր Նորեոն Հելթ հաշվին։','This chat is no longer connected to your Noreon account.','Этот чат больше не связан с вашим аккаунтом Нореон Хелс.'),
 expired:c('Այս կոճակն այլևս չի գործում։ Կրկին գրեք Զոյային այստեղ։','This button no longer works. Write to Zoe here again.','Эта кнопка больше не работает. Снова напишите Зое здесь.'),
 unavailable:c('Սա հիմա հասանելի չէ։','This is not available right now.','Сейчас это недоступно.'),
};

export const BP={
 // The BP week entry's guidance (components/bp-week/week-entry.tsx).
 guide:c('Նախ մի քանի րոպե հանգիստ նստեք։ Մուտքագրեք ձեր սարքի ցույց տված արդյունքը։','Sit quietly for a few minutes first. Enter the reading shown on your monitor.','Сначала спокойно посидите несколько минут. Введите измерение, которое показывает ваш тонометр.'),
 week:(day:number,days:number,evening:boolean)=>c(`Ճնշման շաբաթ՝ օր ${day}/${days}, ${evening?'երեկոյան':'առավոտյան'} չափում`,`Your BP week: day ${day} of ${days}, ${evening?'evening':'morning'} reading`,`Неделя давления: день ${day} из ${days}, ${evening?'вечернее':'утреннее'} измерение`),
 weekProgress:(saved:number,expected:number)=>c(`${saved}/${expected} չափում պահված է`,`${saved} of ${expected} readings saved`,`Сохранено измерений: ${saved} из ${expected}`),
 now:c('Չափման ժամը՝ հիմա։','Measured: now.','Время измерения: сейчас.'),
 otherTime:c('Այլ ժամի համար բացեք ամբողջական ձևը','For another time, open the full form','Для другого времени откройте полную форму'),
 review:c('Ստուգել','Check reading','Проверить'),
 measured:(t:string)=>c(`Չափման ժամը՝ ${t}։`,`Measured: ${t}.`,`Время измерения: ${t}.`),
 confirm:(v:string,t?:string)=>c(`Պահել՝ ${v}, չափված ${t??'հիմա'}`,`Save: ${v}, measured ${t??'now'}`,`Сохранить: ${v}, измерено ${t??'сейчас'}`),
 pulse:(p:number)=>c(`զարկ ${p}`,`pulse ${p}`,`пульс ${p}`),
 yes:c('Այո, պահել','Yes, save it','Да, сохранить'),
 saved:(v:string)=>c(`Պահված է՝ ${v}։`,`Saved: ${v}.`,`Сохранено: ${v}.`),
 last:(v:string,t:string)=>c(`Վերջին պահված չափումը՝ ${v}, ${t}`,`Last saved reading: ${v}, ${t}`,`Последнее сохранённое измерение: ${v}, ${t}`),
 // Telegram has no form: the numbers come as a message, and go through Zoe like any other.
 typeHere:c('Գրեք երկու թիվն այստեղ՝ վերինը, հետո ստորինը, օրինակ՝ 135/85։ Ես ցույց կտամ դրանք, որ պահեք։','Write the two numbers here, upper then lower, like 135/85. I will show them back for you to save.','Напишите здесь два числа, сначала верхнее, потом нижнее, например 135/85. Я покажу их, чтобы вы сохранили.'),
 confirmLine:(v:string)=>c(`Պահե՞լ՝ ${v}։`,`Save this reading: ${v}?`,`Сохранить измерение: ${v}?`),
 done:c('Պահված է։','Saved.','Сохранено.'),
 // The BP form's line (components/patient/measurement-form.tsx).
 noNotify:c('Այս փուլում չափումը պահպանվում է պատմության մեջ։ Այն բժշկին ավտոմատ ծանուցում չի ուղարկում։','At this stage, the reading is saved in your history. It does not automatically notify a doctor.','На этом этапе измерение сохраняется в вашей истории. Врач не получает автоматическое уведомление.'),
 worried:c('Եթե այս չափումը ձեզ անհանգստացնում է, գրեք Զոյային այստեղ։','If this reading worries you, write to Zoe here.','Если это измерение вас беспокоит, напишите Зое здесь.'),
};

/**
 * The blood pressure flow (V3). DRAFT for Armen and Yesayi. "Sudden severe headache or dizziness" and the fainting
 * question need Armen's yes; OUT_OF_HOURS Armenian is the build prompt's text verbatim, its en and ru are drafts.
 */
export const FLOW={
 thanks:c('Շնորհակալություն, պահված է։','Thank you, this is saved.','Спасибо, сохранено.'),
 checking:c('Եկեք մի փոքր էլ ստուգենք։','Let’s check a little more.','Давайте проверим ещё немного.'),
 nurse48:c('Ձեր բուժքույրը սա կտեսնի 48 ժամվա ընթացքում։','Your nurse will look at this within 48 hours.','Ваша медсестра посмотрит это в течение 48 часов.'),
 doctor48:c('Ձեր բժիշկը սա կտեսնի 48 ժամվա ընթացքում։','Your doctor will look at this within 48 hours.','Ваш врач посмотрит это в течение 48 часов.'),
 doctorToday:c('Ձեր բժիշկը սա կդիտարկի այսօր։','Your doctor will review this today.','Ваш врач посмотрит это сегодня.'),
 nurseToday:c('Ձեր բուժքույրը սա կդիտարկի այսօր։','Your nurse will review this today.','Ваша медсестра посмотрит это сегодня.'),
 noDouble:c('Մի՛ ընդունեք կրկնակի կամ չնշանակված դեղաչափ։','Don’t take a double or unprescribed dose.','Не принимайте двойную или не назначенную дозу.'),
 notSent:c('Սա ավտոմատ չի փոխանցվել ձեր խնամքի թիմին։ Եթե ուզում եք, գրեք այստեղ, և ես կօգնեմ գրել նրանց։','This did not go to your care team automatically. If you like, write here and I can help you write to them.','Это не передано вашей медицинской команде автоматически. Если хотите, напишите здесь, и я помогу написать им.'),
 call103:c('Խնդրում ենք հիմա զանգահարել 103։','Please call 103 now.','Пожалуйста, позвоните 103 сейчас.'),
 clinicClosed:c('Պոլիկլինիկան հիմա փակ է։ Եթե այս պահին վատ եք զգում, մի՛ սպասեք աշխատանքային ժամերին՝ անմիջապես զանգահարեք 103։','The clinic is closed now. If you feel unwell now, don’t wait for working hours: call 103 straight away.','Поликлиника сейчас закрыта. Если вы плохо себя чувствуете, не ждите начала рабочего дня: сразу звоните 103.'),
 outOfHours:c('Պոլիկլինիկայի բուժքույրը Ձեր տվյալը կտեսնի առավոտյան՝ աշխատանքային ժամի մեկնարկին։ Եթե այս պահին ունեք վատ ինքնազգացողություն, մի՛ սպասեք առավոտյան զանգին՝ անմիջապես զանգահարեք 1-03։','The clinic nurse will see your reading in the morning, when working hours begin. If you feel unwell now, don’t wait for a morning call: call 103 straight away.','Медсестра поликлиники увидит ваши данные утром, в начале рабочего дня. Если вы плохо себя чувствуете сейчас, не ждите утреннего звонка: сразу звоните 103.'),
 sent:c('Ուղարկված է','Sent','Отправлено'),
 seenNurse:c('Բուժքույրը տեսել է','Seen by nurse','Просмотрено медсестрой'),
 seenDoctor:c('Բժիշկը տեսել է','Seen by doctor','Просмотрено врачом'),
 answered:c('Պատասխանված է','Answered','Отвечено'),
 within:(h:number)=>c(`${h} ժամվա ընթացքում`,`within ${h} hours`,`в течение ${h} ч`),
 repeatWhy:c('Առաջին չափումը բարձր է։ Երկրորդը ցույց կտա՝ այն պահպանվո՞ւմ է։','The first reading is high. A second one shows if it stays that way.','Первое измерение высокое. Второе покажет, сохраняется ли это.'),
 techRest:c('Հանգիստ նստեք 5 րոպե','Rest seated for 5 minutes','Посидите спокойно 5 минут'),
 techArm:c('Թևը պահեք սրտի մակարդակին','Keep your arm at heart level','Держите руку на уровне сердца'),
 techTwo:c('Երկու չափում՝ 1-2 րոպե ընդմիջումով','Two readings, 1 to 2 minutes apart','Два измерения с перерывом 1-2 минуты'),
 wait:(s:number)=>c(`${s} վայրկյան`,`${s} seconds`,`${s} секунд`),
 skipWait:c('Չսպասել','Skip the wait','Не ждать'),
 enterSecond:c('Մուտքագրեք երկրորդ չափումը','Enter your second reading','Введите второе измерение'),
 yes:c('Այո','Yes','Да'),
 no:c('Ոչ','No','Нет'),
 progress:(n:number,of:number)=>c(`Հարց ${n}՝ ${of}-ից`,`Question ${n} of ${of}`,`Вопрос ${n} из ${of}`),
 allNo:c('Այս պահին դրանցից ոչ մեկը չունեմ։','I have none of these right now.','Сейчас у меня ничего из этого нет.'),
 composerLocked:c('Նախ պատասխանեք վերևի հարցին','Answer the question above first','Сначала ответьте на вопрос выше'),
 stripAnswer:(n:number)=>n===1?c('Պատասխանեք 1 անվտանգության հարցի','Answer 1 safety question','Ответьте на 1 вопрос безопасности'):c(`Պատասխանեք ${n} անվտանգության հարցի`,`Answer ${n} safety questions`,`Ответьте на вопросы безопасности: ${n}`),
 stripRepeat:c('Կրկնեք չափումը','Repeat your reading','Повторите измерение'),
 zoneGreen:c('Կանաչ գոտի','Green zone','Зелёная зона'),
 zoneYellow:c('Դեղին գոտի','Yellow zone','Жёлтая зона'),
 zoneOrange:c('Նարնջագույն գոտի','Orange zone','Оранжевая зона'),
 zoneRed:c('Կարմիր գոտի','Red zone','Красная зона'),
 zoneRedAction:c('Զանգահարեք 103','Call 103','Позвоните 103'),
};
/**
 * WP T: a saved reading against the member's own home target (lib/clinical/rules/personal-bp.ts). DRAFT for Armen and
 * Yesayi, unapproved wording. The numbers are the target, never a judgement made in a component.
 */
export const PERSONAL_BP={
 below:(t:string)=>c(`Սա ցածր է ձեր բժշկի սահմանած թիրախից՝ ${t}։`,`This is below the target your doctor set for you, ${t}.`,`Это ниже цели, которую поставил вам врач: ${t}.`),
 belowUsual:(t:string)=>c(`Սա ցածր է տնային սովորական թիրախից՝ ${t}։`,`This is below the usual home target of ${t}.`,`Это ниже обычной домашней цели: ${t}.`),
 above:(t:string)=>c(`Սա բարձր է ձեր բժշկի սահմանած թիրախից՝ ${t}։`,`This is above the target your doctor set for you, ${t}.`,`Это выше цели, которую поставил вам врач: ${t}.`),
 aboveUsual:(t:string)=>c(`Սա բարձր է տնային սովորական թիրախից՝ ${t}։`,`This is above the usual home target of ${t}.`,`Это выше обычной домашней цели: ${t}.`),
 alertSent:c('Սա այն մակարդակն է, որին ձեր բժիշկը խնդրել է հետևել։ Ձեր բուժքույրը կկապվի ձեզ հետ այսօր։','This is at the level your doctor asked us to watch for. Your nurse will contact you today.','Это уровень, за которым ваш врач просил следить. Ваша медсестра свяжется с вами сегодня.'),
 alertNotSent:c('Սա այն մակարդակն է, որին ձեր բժիշկը խնդրել է հետևել։ Եթե վատ եք զգում, գրեք այստեղ կամ զանգահարեք 103։','This is at the level your doctor asked us to watch for. If you feel unwell, write here or call 103.','Это уровень, за которым ваш врач просил следить. Если вам плохо, напишите здесь или позвоните 103.'),
 lowAsk:c('Եթե գլխապտույտ, թուլություն կամ ուշագնացության զգացում ունեք, գրեք ինձ այստեղ։','If you feel dizzy, weak or faint, tell me here.','Если у вас головокружение, слабость или предобморочное состояние, напишите мне здесь.'),
 explain:c('Թիրախը ձեր տնային ճնշումն է, որին ձեր բժիշկը ձգտում է ձեզ համար։ Վերին թիվը պետք է ցածր լինի առաջին թվից, ստորինը՝ երկրորդից։','Your target is the home blood pressure your doctor is aiming for with you. Your upper number should stay below the first number, and your lower number below the second.','Цель это домашнее давление, к которому ваш врач стремится вместе с вами. Верхнее число должно быть ниже первого числа цели, нижнее ниже второго.'),
 line:c('Ձեր թիրախը','Your target','Ваша цель'),
};
export const FLAG_QUESTION={
 chest_pain:c('Հիմա ունե՞ք կրծքավանդակի ցավ կամ ճնշում։','Do you have chest pain or pressure right now?','Сейчас есть боль или давление в груди?'),
 dyspnea:c('Հիմա ունե՞ք շնչահեղձություն հանգստի ժամանակ։','Are you short of breath at rest right now?','Сейчас есть одышка в покое?'),
 neuro:c('Հանկարծակի փոխվե՞լ է տեսողությունը կամ խոսքը, կամ թմրե՞լ է ձեռքը կամ ոտքը։','Has your vision or speech suddenly changed, or an arm or leg gone numb?','Внезапно изменилось зрение или речь, онемела рука или нога?'),
 headache_dizziness:c('Հիմա ունե՞ք հանկարծակի ուժեղ գլխացավ կամ գլխապտույտ։','Do you have a sudden severe headache or dizziness right now?','Сейчас есть внезапная сильная головная боль или головокружение?'),
 faint:c('Ուշագնա՞ց եք եղել, կամ քիչ էր մնում ուշագնաց լինեիք։','Did you faint or nearly faint?','Вы теряли сознание или были близки к этому?'),
};
/** The member's own words for a "yes", sent through the normal chat path. 103 does not depend on these matching anything. */
export const FLAG_MESSAGE={
 chest_pain:c('Հիմա կրծքավանդակի ցավ կամ սեղմում ունեմ։','I have chest pain or pressure right now.','У меня сейчас боль или давление в груди.'),
 dyspnea:c('Հիմա հանգստի ժամանակ շնչահեղձություն ունեմ։','I am short of breath at rest right now.','Я сейчас задыхаюсь в покое.'),
 neuro:c('Հանկարծակի փոխվել է տեսողությունս կամ խոսքս, կամ թմրել է ձեռքս կամ ոտքս։','My vision or speech suddenly changed, or an arm or leg went numb.','У меня внезапно изменилось зрение или речь, или онемела рука или нога.'),
 headache_dizziness:c('Հիմա հանկարծակի ուժեղ գլխացավ կամ գլխապտույտ ունեմ։','I have a sudden severe headache or dizziness right now.','У меня сейчас внезапная сильная головная боль или головокружение.'),
 faint:c('Ուշագնաց եմ եղել կամ քիչ էր մնում ուշագնաց լինեի։','I fainted or nearly fainted.','Я терял сознание или был близок к этому.'),
};

export const RESULTS={
 approved:c('Բժշկի հաստատած','Doctor-approved','Подтверждены врачом'),
 published:(d:string)=>c(`Հրապարակված է՝ ${d}`,`Published ${d}`,`Опубликовано: ${d}`),
 // The results page's empty line (app/patient/results/page.tsx).
 empty:c('Այստեղ բժշկի հաստատած արդյունքներ դեռ հասանելի չեն։','No doctor-approved results available here yet.','Здесь пока нет результатов, подтверждённых врачом.'),
 reference:(r:string)=>c(`Նորմա՝ ${r}`,`Reference: ${r}`,`Норма: ${r}`),
 older:(n:number)=>c(`Եվս ${n} ավելի հին արդյունք կա հավելվածում։`,`${n} older results are in the app.`,`Ещё ${n} более старых результатов в приложении.`),
 // Longer than one Telegram message: no value is shortened, and the card says what is left out.
 cut:(n:number)=>c(`Այս քարտի ևս ${n} տող հավելվածում է։`,`${n} more lines of this card are in the app.`,`Ещё ${n} строк этой карточки в приложении.`),
 more:(n:number)=>c(`Ցույց տալ ևս ${n}-ը`,`Show ${n} more`,`Показать ещё ${n}`),
};

export const PLAN={
 approvedBy:(who:string,d:string)=>c(`Հաստատող՝ ${memberDoctorLabel(who,"hy")}, ${d}`,`Approved by ${memberDoctorLabel(who,"en")}, ${d}`,`Утверждён: ${memberDoctorLabel(who,"ru")}, ${d}`),
 version:(n:number)=>c(`Տարբերակ ${n}`,`Version ${n}`,`Версия ${n}`),
 medicines:c('Դեղեր','Medicines','Лекарства'),
 empty:c('Դուք դեռ հրապարակված պլան չունեք։','You do not have a published plan yet.','У вас пока нет опубликованного плана.'),
 readOnly:c('Պլանը փոխում է միայն ձեր բժիշկը։','Only your doctor changes your plan.','Ваш план меняет только ваш врач.'),
 // A plan longer than one Telegram message: nothing is shown as if it were complete.
 cut:c('Պլանի շարունակությունը հավելվածում է։','The rest of your plan is in the app.','Продолжение плана в приложении.'),
};

export const VISIT={
 empty:c('Առաջիկա այց չունեք։','You have no upcoming visit.','У вас нет предстоящего визита.'),
 book:c('Ամրագրել այց','Book a visit','Записаться на визит'),
 home:c('Տանը','At home','На дому'),
 clinic:c('Կլինիկայում','At the clinic','В клинике'),
 confirmed:c('Հաստատված','Confirmed','Подтверждён'),
 pending:c('Կազմակերպվում է','Being arranged','Организуется'),
 // visitSummary (lib/real-booking/visit-summary.ts).
 attention:c('Այցի գրանցումը ուշադրության կարիք ունի։ Ստուգեք պահպանված վիճակը։','Scheduling needs attention. Check the saved visit status.','Запись на визит требует внимания. Проверьте сохранённый статус визита.'),
 proposed:(when:string,clinic:string)=>c(`Կլինիկան առաջարկել է նոր ժամ՝ ${when}, ${clinic}`,`The clinic proposed a new time: ${when}, ${clinic}`,`Клиника предложила новое время: ${when}, ${clinic}`),
 accept:c('Ընդունել այս ժամը','Accept this time','Принять это время'),
 confirmAccept:(when:string)=>c(`Ընդունել առաջարկված ժամը՝ ${when}`,`Accept the proposed time: ${when}`,`Принять предложенное время: ${when}`),
 yes:c('Այո, ընդունել','Yes, accept it','Да, принять'),
 accepted:c('Ընդունված է։ Ցույց տվեք ներկա վիճակը՝ նոր ժամը տեսնելու համար։','Accepted. Show current to see the new time.','Принято. Покажите текущие данные, чтобы увидеть новое время.'),
 // Choosing a day needs a grid: that stays a screen, and Telegram says so without a link.
 changeInApp:c('Այցը ամրագրել կամ փոխել կարող եք Նորեոն Հելթ հավելվածում։','To book or change a visit, use the Noreon app.','Записаться на визит или изменить его можно в приложении Нореон Хелс.'),
 change:c('Փոխել կամ չեղարկել','Change or cancel','Изменить или отменить'),
};

export const SIDE_EFFECTS=['ankle_swelling','dizziness','nausea','dry_cough','muscle_aches','headache','flushing','frequent_urination','other']as const;
export type SideEffect=typeof SIDE_EFFECTS[number];
export const SIDE_EFFECT:Record<SideEffect,L>={
 ankle_swelling:c('Կոճերի այտուց','Ankle swelling','Отёк лодыжек'),
 dizziness:c('Գլխապտույտ','Dizziness','Головокружение'),
 nausea:c('Սրտխառնոց','Nausea','Тошнота'),
 dry_cough:c('Չոր հազ','Dry cough','Сухой кашель'),
 muscle_aches:c('Մկանային ցավեր','Muscle aches','Боли в мышцах'),
 headache:c('Գլխացավ','Headache','Головная боль'),
 flushing:c('Դեմքի կարմրություն','Flushing','Покраснение лица'),
 frequent_urination:c('Հաճախամիզություն','Frequent urination','Частое мочеиспускание'),
 other:c('Այլ բան','Something else','Что-то другое'),
};
export const SIDE={
 pick:c('Ընտրեք մեկը։','Choose one.','Выберите один вариант.'),
 detail:c('Ոչ պարտադիր՝ երբ սկսվեց, որքան ուժեղ է','Optional: when it started, how strong it is','Необязательно: когда началось, насколько сильно'),
 detailOther:c('Նկարագրեք, թե ինչ եք նկատում','Describe what you are noticing','Опишите, что вы замечаете'),
 review:c('Ստուգել','Check before sending','Проверить перед отправкой'),
 confirm:c('Սա կուղարկվի ձեր խնամքի թիմին՝','This goes to your care team:','Это будет отправлено вашей медицинской команде:'),
 send:c('Ուղարկել խնամքի թիմին','Send to my care team','Отправить медицинской команде'),
 /** The message the care team receives; it goes through Zoe's safety checks like any message the member types. */
 prefix:c('Կողմնակի ազդեցություն','Side effect','Побочный эффект'),
 needDetail:c('Գրեք, թե ինչ եք նկատում։','Write what you are noticing.','Напишите, что вы замечаете.'),
};
export const MESSAGE={
 label:c('Ձեր հաղորդագրությունը','Your message','Ваше сообщение'),
 review:c('Ստուգել','Check before sending','Проверить перед отправкой'),
 confirm:c('Ուղարկե՞լ սա ձեր խնամքի թիմին։','Send this to your care team?','Отправить это вашей медицинской команде?'),
 send:c('Այո, ուղարկել','Yes, send it','Да, отправить'),
 // The composer's line after a message to the doctor (components/patient/zoe-chat.tsx).
 sent:c('Ուղարկված է ձեր բժշկին։ Պատասխանը կստանաք այստեղ։','Sent to your doctor. They will answer here.','Отправлено вашему врачу. Ответ появится здесь.'),
 // Another text from this card may still be sending (Astra review-3): only the same text, or the chat composer.
 busy:c('Այս քարտի նախորդ հաղորդագրությունը դեռ մշակվում է։ Ուղարկեք այն նույնությամբ կամ գրեք ներքևի զրույցում։','Your earlier message from this card may still be sending. Send it again as it was, or write in the chat below.','Предыдущее сообщение из этой карточки, возможно, ещё отправляется. Отправьте его снова без изменений или напишите в чате ниже.'),
 // Urgent words in the card's text: the chat's send opened the 103 screen, whether or not the message was stored.
 urgent:c('Այս հաղորդագրությունից հետո բացվեց շտապ օգնության 103 էկրանը։','This message opened the emergency 103 screen.','После этого сообщения открылся экран экстренной помощи 103.'),
 empty:c('Գրեք ձեր հաղորդագրությունը։','Write your message first.','Сначала напишите сообщение.'),
 tooLong:c('Հաղորդագրությունը չափազանց երկար է։ Կրճատեք այն։','Your message is too long. Shorten it.','Ваше сообщение слишком длинное. Сократите его.'),
};

const e=(en:string,hy:string,ru:string)=>c(hy,en,ru);
// The goal card's own lines (components/patient-care/ldl-goal-card.tsx), for Telegram. Wording pending Armen, Yesayi and Tatevik.
export const LDL={
 unit:e('mmol/L','մմոլ/լ','ммоль/л'),
 title:e('Your LDL cholesterol goal','Ձեր ՑԽԼ խոլեստերինի նպատակը','Ваша цель по холестерину ЛПНП'),
 setting:e('Your doctor is setting your goal','Ձեր բժիշկը սահմանում է ձեր նպատակը','Ваш врач устанавливает вашу цель'),
 settingBody:e('Your goal will show here once your doctor has set it.','Նպատակը կհայտնվի այստեղ, երբ ձեր բժիշկը սահմանի այն։','Цель появится здесь, когда ваш врач её установит.'),
 goal:(threshold:string,unit:string)=>e(`Your goal: below ${threshold} ${unit}`,`Ձեր նպատակը՝ ${threshold} ${unit}-ից ցածր`,`Ваша цель: ниже ${threshold} ${unit}`),
 goalPct:(pct:string)=>e(`and at least ${pct}% lower than before treatment`,`և բուժումից առաջվա մակարդակից առնվազն ${pct}%-ով ցածր`,`и как минимум на ${pct}% ниже, чем до лечения`),
 none:e('No result to compare yet','Համեմատելու արդյունք դեռ չկա','Пока нет результата для сравнения'),
 noneBody:e('An LDL blood test will show how close you are to your goal.','ՑԽԼ խոլեստերինի արյան անալիզը ցույց կտա, թե որքան մոտ եք ձեր նպատակին։','Анализ крови на ЛПНП покажет, насколько вы близки к цели.'),
 latest:(d:string)=>e(`Latest result, ${d}`,`Վերջին արդյունքը, ${d}`,`Последний результат, ${d}`),
 below:e('Below your goal','Ձեր նպատակից ցածր է','Ниже вашей цели'),
 belowBody:e('Your latest result is below your goal.','Ձեր վերջին արդյունքը նպատակից ցածր է։','Ваш последний результат ниже цели.'),
 above:e('Above your goal','Ձեր նպատակից բարձր է','Выше вашей цели'),
 aboveBody:e('Your latest result is above your goal. Your care team uses it to plan the next step with you.','Ձեր վերջին արդյունքը նպատակից բարձր է։ Ձեր բուժթիմը դրա հիման վրա ձեզ հետ կպլանավորի հաջորդ քայլը։','Ваш последний результат выше цели. Ваша команда по уходу использует его, чтобы спланировать с вами следующий шаг.'),
 lower:(pct:string)=>e(`${pct}% lower than before treatment`,`Բուժումից առաջվանից ${pct}%-ով ցածր`,`На ${pct}% ниже, чем до лечения`),
 onePart:e('One part of your goal is met','Ձեր նպատակի մի մասը կատարված է','Одна часть цели выполнена'),
 onePartBody:(threshold:string,unit:string)=>e(`Your latest result is below ${threshold} ${unit}. The drop since before treatment is not there yet. Your care team uses it to plan the next step with you.`,`Ձեր վերջին արդյունքը ${threshold} ${unit}-ից ցածր է։ Բուժումից առաջվա համեմատ նվազումը դեռ բավարար չէ։ Ձեր բուժթիմը դրա հիման վրա ձեզ հետ կպլանավորի հաջորդ քայլը։`,`Ваш последний результат ниже ${threshold} ${unit}. Снижения по сравнению с уровнем до лечения пока недостаточно. Ваша команда учтёт это при планировании следующего шага.`),
 next:(d:string)=>e(`Next LDL test: ${d}`,`Հաջորդ ՑԽԼ անալիզը՝ ${d}`,`Следующий анализ на ЛПНП: ${d}`),
 withDoctor:e('With your doctor','Ձեր բժշկի մոտ է','У вашего врача'),
 withName:(rawDoctorName:string):L=>{const doctorName=memberStaffName(rawDoctorName);return doctorName?e(`Your new cholesterol result is with ${doctorName}. They will tell you the next step.`,`Ձեր խոլեստերինի նոր արդյունքը ձեր բժշկի մոտ է (${doctorName})։ Բժիշկը ձեզ կտեղեկացնի հաջորդ քայլի մասին։`,`Ваш новый результат по холестерину у вашего врача (${doctorName}). Врач сообщит вам следующий шаг.`):LDL.withAnon;},
 withAnon:e('Your new cholesterol result is with your doctor. They will tell you the next step.','Ձեր խոլեստերինի նոր արդյունքը ձեր բժշկի մոտ է։ Բժիշկը ձեզ կտեղեկացնի հաջորդ քայլի մասին։','Ваш новый результат по холестерину у вашего врача. Врач сообщит вам следующий шаг.'),
 proposed:e('A nurse visit for your blood test is proposed','Ձեր արյան անալիզի համար առաջարկվում է բուժքրոջ այց','Вам предложен визит медсестры для анализа крови'),
 visit:(when:string)=>e(`Your blood test visit: ${when}`,`Ձեր արյան անալիզի այցը՝ ${when}`,`Ваш визит для анализа крови: ${when}`),
 due:e('Blood test due','Արյան անալիզի ժամկետն է','Пора сдать анализ крови'),
 dueBody:e('Your cholesterol blood test is still to do. Our team will call you to find a time.','Ձեր խոլեստերինի արյան անալիզը դեռ հանձնված չէ։ Մեր թիմը կզանգի ձեզ՝ հարմար ժամ գտնելու համար։','Анализ крови на холестерин ещё не сдан. Наша команда позвонит вам, чтобы выбрать время.'),
 window:(from:string,to:string)=>e(`Next LDL test: between ${from} and ${to}`,`Հաջորդ ՑԽԼ անալիզը՝ ${from}-ից ${to} ընկած ժամանակահատվածում`,`Следующий анализ на ЛПНП: с ${from} по ${to}`),
 windowBody:e('A nurse can take the blood sample at home. Our team will call you to arrange it.','Բուժքույրը կարող է արյան նմուշը վերցնել տանը։ Մեր թիմը կզանգի ձեզ՝ այն կազմակերպելու համար։','Медсестра может взять кровь на дому. Наша команда позвонит вам, чтобы договориться.'),
 prepInApp:e('The full preparation is in the Noreon app.','Ամբողջական պատրաստվելու կարգը Նորեոն Հելթ հավելվածում է։','Полная подготовка в приложении Нореон Хелс.'),
 notStarted:e('Your doctor has not started an LDL goal for you.','Ձեր բժիշկը դեռ ՑԽԼ նպատակ չի սահմանել։','Ваш врач пока не начал ведение цели по ЛПНП.'),
 accept:e('Accept this visit','Ընդունել այս այցը','Принять этот визит'),
 accepted:e('Accepted. We saved your answer.','Ընդունված է։ Ձեր պատասխանը պահված է։','Принято. Ваш ответ сохранён.'),
};

/** Onboarding blocks in the new chat (build prompt PR 6). DRAFT wording, pending Tatevik, Armen and Yesayi. */
export const PROFILE={
 lead:c('Մի քանի հարց, որ գրեմ ձեզ հարմար ժամերին։','A few things so I write when it suits you.','Несколько вопросов, чтобы я писала вам в удобное время.'),
 channel:c('Ինչպե՞ս եք նախընտրում խոսել','How do you prefer to talk','Как вам удобнее общаться'),
 text:c('Գրավոր','Text','Текст'),
 voice:c('Ձայնով','Voice','Голос'),
 wake:c('Արթնանում եմ','I wake up at','Я просыпаюсь в'),
 sleep:c('Քնում եմ','I go to sleep at','Я ложусь спать в'),
 caregiver:c('Ավելացնել մտերիմի կոնտակտ','Add someone close to you','Добавить близкого человека'),
 caregiverHint:c('Ոչ պարտադիր։ Մարդ, ում կարող ենք զանգահարել, եթե չկարողանանք կապվել ձեզ հետ։ Զոյան այս տվյալները չի կարդում։','Optional. Someone we can call if we cannot reach you. Zoe does not read these details.','Необязательно. Человек, которому мы можем позвонить, если не сможем связаться с вами. Зоя не читает эти данные.'),
 name:c('Անուն','Name','Имя'),
 phone:c('Հեռախոս','Phone','Телефон'),
 badContact:c('Գրեք անունն ու հեռախոսահամարը, կամ թողեք երկուսն էլ դատարկ։','Enter a name and a phone number, or leave both empty.','Введите имя и номер телефона или оставьте оба поля пустыми.'),
 sameTimes:c('Արթնանալու և քնելու ժամերը պետք է տարբեր լինեն։','Your wake and sleep times need to be different.','Время подъёма и сна должно отличаться.'),
 save:c('Պահել','Save this','Сохранить'),
 said:(channel:string,from:string,to:string)=>c(`${channel}, ${from}-ից ${to}`,`${channel}, ${from} to ${to}`,`${channel}, с ${from} до ${to}`),
 caregiverSaid:c('մտերիմի կոնտակտն ավելացված է','contact added','контакт добавлен'),
 reply:c('Պահված է։ Ձեր հիշեցումները կգան այս ժամերի միջև։','Saved. Your reminders will come between these times.','Сохранено. Напоминания будут приходить в это время.'),
 inChat:c('Սա պատասխանեք նոր զրույցում։','Answer this in the new chat.','Ответьте на это в новом чате.'),
};
export const MEDICINES={
 lead:c('Նշեք, թե ինչպես եք ընդունում յուրաքանչյուր դեղը։ Սա ձեր բժշկի պլանը չի փոխում։','Tell me how you take each medicine. This does not change your doctor’s plan.','Укажите, как вы принимаете каждое лекарство. Это не меняет план вашего врача.'),
 loading:c('Բեռնվում են ձեր դեղերը…','Loading your medicines…','Загружаем ваши лекарства…'),
 failed:c('Չհաջողվեց բեռնել ձեր դեղերը։','Your medicines could not be loaded.','Не удалось загрузить ваши лекарства.'),
 off:c('Ձեր դեղերի ցանկն այս պահին հասանելի չէ։','Your medicine list is unavailable right now.','Ваш список лекарств сейчас недоступен.'),
 plan:c('Ձեր բժշկի պլանից','From your doctor’s plan','Из плана вашего врача'),
 own:c('Դեղեր, որոնք նշել եք դուք','Medicines you told us about','Лекарства, которые указали вы'),
 empty:c('Ձեր ցանկը դեռ դատարկ է։','Your list is empty so far.','Ваш список пока пуст.'),
 notProvided:c('Դեռ նշված չէ','Not provided yet','Пока не указано'),
 continuous:c('Մշտապես','Ongoing','Постоянно'),
 course_stopped:c('Կուրս էր','Was a course','Был курс'),
 prn:c('Ըստ անհրաժեշտության','As needed','По необходимости'),
 statusLabel:(name:string)=>c(`Ինչպե՞ս եք ընդունում՝ ${name}`,`How you take ${name}`,`Как вы принимаете: ${name}`),
 why:c('Ինչո՞ւ դադարեցիք (ոչ պարտադիր)','Why did you stop? (optional)','Почему вы прекратили? (необязательно)'),
 valuesNormal:c('Ցուցանիշներս նորմալ էին','My numbers were normal','Показатели были в норме'),
 add:c('Ավելացնել դեղ','Add a medicine','Добавить лекарство'),
 name:c('Դեղի անունը, ինչպես տուփի վրա','Name, as on the box','Название, как на упаковке'),
 dose:c('Դեղաչափ (ոչ պարտադիր)','Dose (optional)','Доза (необязательно)'),
 time:c('Ժամ','Time','Время'),
 remove:c('Հանել','Remove','Убрать'),
 needName:c('Գրեք դեղի անունը։','Enter the medicine name.','Введите название лекарства.'),
 save:c('Պահել իմ ցանկը','Save my list','Сохранить мой список'),
 nothing:c('Ընտրեք կամ ավելացրեք առնվազն մեկ դեղ։','Choose or add at least one medicine.','Выберите или добавьте хотя бы одно лекарство.'),
 limit:c('Ձեր ցանկը լիքն է (20 դեղ)։','Your list is full (20 medicines).','В вашем списке уже 20 лекарств.'),
 added:c('Ավելացված է','Added','Добавлено'),
 stopWarning:c('Այս դեղի հիշեցումները կդադարեն։','Reminders stop for this medicine.','Напоминания об этом лекарстве прекратятся.'),
 stopYes:c('Այո, դադարեցնել հիշեցումները','Yes, stop reminders','Да, прекратить напоминания'),
 needStop:c('Հաստատեք, որ հիշեցումները պետք է դադարեն։','Confirm that reminders should stop.','Подтвердите, что напоминания нужно прекратить.'),
 stopped:c('Ավարտված կուրսեր','Courses you ended','Завершённые курсы'),
 restore:c('Վերսկսել հիշեցումները','Turn reminders back on','Вернуть напоминания'),
 restored:c('հիշեցումները վերսկսված են','reminders back on','напоминания возвращены'),
 duplicate:c('Այս դեղն արդեն ձեր ցանկում է։','This medicine is already on your list.','Это лекарство уже есть в вашем списке.'),
 stoppedReply:c('Այս դեղերի հիշեցումներն այլևս չեն գա։ Կարող եք դրանք վերսկսել մենյուի «Իմ դեղերը» բաժնից։','Reminders for these have stopped. You can turn them back on from My medicines in the menu.','Напоминаний об этих лекарствах больше не будет. Их можно вернуть в разделе «Мои лекарства» в меню.'),
 reply:c('Պահված է ձեր ցանկում։ Դեղի կամ դեղաչափի փոփոխության մասին հարցրեք ձեր բժշկին։','Saved on your list. Ask your doctor about any medicine or dose change.','Сохранено в вашем списке. Изменения лекарств или доз обсудите с вашим врачом.'),
 offer:c('Ավելացնել իմ դեղերը','Add my medicines','Добавить мои лекарства'),
};
export const ANAMNESIS={progress:c('Հարցաշարի առաջընթացը','Questionnaire progress','Прогресс анкеты')};
export const ONBOARDING={
 working:c('Պատրաստում եմ…','Getting this ready…','Готовлю…'),
 unavailable:c('Սա հիմա հասանելի չէ։','This is not available right now.','Сейчас это недоступно.'),
};

/** A reading as the cards show it, in the app and on Telegram. */
export const bpText=(l:CardLocale,v:{systolic:number;diastolic:number;pulse:number|null;entrySource?:string|null})=>`${v.systolic}/${v.diastolic}${v.pulse?`, ${say(l,BP.pulse(v.pulse))}`:''}${isUnverifiedBp(v)?` (${unverifiedBpLabel(l)})`:''}`;

/** The text a side-effect card sends: the member's own choice and words, nothing added beyond the label. */
export function sideEffectMessage(l:CardLocale,what:SideEffect,detail:string){
 const d=detail.trim();
 return what==='other'?`${say(l,SIDE.prefix)}: ${d}`:`${say(l,SIDE.prefix)}: ${say(l,SIDE_EFFECT[what])}${d?`. ${d}`:''}`;
}

/** Every line, for the copy check. */
export function allCopy():L[]{
 const sample=[COMMON.asShown('08:00'),DOSE.later('08:00'),DOSE.laterPlan('08:00'),DOSE.confirmTaken('X, 08:00'),DOSE.confirmMissed('X, 08:00'),BP.week(2,7,true),BP.week(2,7,false),BP.weekProgress(3,28),
  BP.confirm('120/80'),BP.pulse(70),BP.saved('120/80'),BP.last('120/80','1.1, 08:00'),LDL.goal('1.4','mmol/L'),LDL.goalPct('50'),LDL.latest('1.1'),LDL.lower('40'),LDL.onePartBody('1.4','mmol/L'),LDL.next('1.1'),LDL.withName('X'),LDL.visit('1.1, 08:00'),LDL.window('1.1','2.1'),BP.confirmLine('120/80'),RESULTS.published('1.1'),RESULTS.reference('1-2'),RESULTS.more(3),RESULTS.older(3),RESULTS.cut(3),PLAN.approvedBy('X','1.1'),PLAN.version(2),
  VISIT.proposed('1.1, 08:00','X'),VISIT.confirmAccept('1.1, 08:00'),FLOW.within(4),FLOW.wait(60),PERSONAL_BP.below('130/80'),PERSONAL_BP.belowUsual('135/85'),PERSONAL_BP.above('130/80'),PERSONAL_BP.aboveUsual('135/85'),FLOW.progress(1,5),FLOW.stripAnswer(1),FLOW.stripAnswer(2),PROFILE.said('X','7:00','22:00'),MEDICINES.statusLabel('X'),CAREGIVER.phoneEnds('107'),INVITATION.lead('X'),CARING.since('1.1')];
 const fixed=[TG_WRITE,NOTICE,CHIP,TITLE,SIDE_EFFECT,COMMON,DOSE,TELEGRAM,BP,FLOW,PERSONAL_BP,FLAG_QUESTION,FLAG_MESSAGE,RESULTS,PLAN,VISIT,SIDE,MESSAGE,LDL,PROFILE,MEDICINES,ANAMNESIS,ONBOARDING,CAREGIVER,CAREGIVER.status,CONSENTS,INVITATION,CARING].flatMap(o=>Object.values(o).filter((v):v is L=>typeof v==='object'&&v!==null&&'hy'in v));
 return [...fixed,...sample];
}
export {LIVING_VISIT} from './living-visit-copy';
