/** Draft HY/EN/RU; member choices are fixed text and take the ordinary chat safety path. */
const c=(en:string,hy:string,ru:string)=>({en,hy,ru});
export const CONSULT={
 request:c('Request a consultation','Խնդրել խորհրդատվություն','Запросить консультацию'),
 gate:c('A planned question, or something acute right now?','Պլանային հա՞րց, թե՞ սուր գանգատ հենց հիմա','Плановый вопрос или что-то острое прямо сейчас?'),
 planned:c('A planned question','Պլանային հարց','Плановый вопрос'),acute:c('Something acute right now','Սուր գանգատ հենց հիմա','Что-то острое прямо сейчас'),
 plannedMessage:c('I would like to arrange a planned consultation with my doctor.','Կցանկանայի պլանային խորհրդատվություն կազմակերպել իմ բժշկի հետ։','Я хочу записаться на плановую консультацию к своему врачу.'),
 acuteMessage:c('I have an acute symptom right now. I need help with what to do next.','Հենց հիմա սուր գանգատ ունեմ։ Օգնության կարիք ունեմ՝ հասկանալու հաջորդ քայլը։','У меня сейчас острая жалоба. Мне нужна помощь, чтобы понять, что делать дальше.'),
 gateReply:c('Your message is in your conversation. You can describe what is happening there.','Ձեր հաղորդագրությունը զրույցում է։ Այնտեղ կարող եք նկարագրել՝ ինչ է կատարվում։','Ваше сообщение в переписке. Вы можете описать там, что происходит.'),
 plannedReply:c('Your consultation request is in your conversation with your doctor. A time has not been booked yet.','Խորհրդատվության ձեր հարցումը ձեր բժշկի հետ զրույցում է։ Ժամ դեռ ամրագրված չէ։','Ваш запрос на консультацию в переписке с врачом. Время пока не забронировано.'),
 title:c('Your questions for your doctor','Ձեր հարցերը ձեր բժշկին','Ваши вопросы врачу'),
 offer:c('Add my questions','Ավելացնել իմ հարցերը','Добавить мои вопросы'),
 symptoms:c('What you are noticing','Ինչ եք նկատում','Что вы замечаете'),medicines:c('Your medicines','Ձեր դեղերը','Ваши лекарства'),results:c('Your tests and results','Ձեր հետազոտություններն ու արդյունքները','Ваши анализы и результаты'),
 send:c('Send to my doctor','Ուղարկել իմ բժշկին','Отправить моему врачу'),
 sent:c('Your questions are sent to your doctor in this conversation.','Ձեր հարցերն այս զրույցում ուղարկված են ձեր բժշկին։','Ваши вопросы отправлены врачу в этой переписке.'),
};

export function consultQuestionsText(locale:'hy'|'en'|'ru',groups:readonly {label:'symptoms'|'medicines'|'results';text:string}[]):string{
 return [CONSULT.title[locale],...groups.filter(g=>g.text.trim()).map(g=>`${CONSULT[g.label][locale]}:\n${g.text.trim()}`)].join('\n\n');
}
