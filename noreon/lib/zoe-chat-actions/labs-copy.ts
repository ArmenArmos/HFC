/** PR 7 HY/EN/RU draft wording, pending clinical and language review. */
const c=(en:string,hy:string,ru:string)=>({en,hy,ru});
export const LABS={
 document:c('Your document','Ձեր փաստաթուղթը','Ваш документ'),
 unknown:c('Not provided yet','Դեռ տրամադրված չէ','Пока не указано'),
 type:c('Document type','Փաստաթղթի տեսակը','Тип документа'),
 date:c('Study date','Հետազոտության ամսաթիվը','Дата исследования'),
 uploaded:c('Uploaded by','Վերբեռնել է','Кто загрузил'),
 notRead:c('Saved, not read','Պահված է, դեռ կարդացված չէ','Сохранено, ещё не прочитано'),
 read:c('Read','Կարդացված է','Прочитано'),
 fresh:c('Fresh result, no repeat needed','Թարմ արդյունք, կրկնելու կարիք չկա','Свежий результат, повторять не нужно'),
 dateOnly:c('This is about the study date. Your doctor can discuss what the result means.','Սա վերաբերում է հետազոտության ամսաթվին։ Արդյունքի իմաստը կարող եք քննարկել ձեր բժշկի հետ։','Это относится к дате исследования. Значение результата вы можете обсудить с врачом.'),
 changed:c('Have your medicines changed since this study?','Այս հետազոտությունից հետո ձեր դեղերը փոխվե՞լ են','Менялись ли ваши лекарства после этого исследования?'),
 yes:c('Yes','Այո','Да'),no:c('No','Ոչ','Нет'),unsure:c('I don’t know','Չգիտեմ','Не знаю'),
 save:c('Save my document details','Պահել իմ փաստաթղթի տվյալները','Сохранить данные моего документа'),
 saved:c('I added my document details.','Ավելացրի իմ փաստաթղթի տվյալները։','Я добавил(а) данные моего документа.'),
 thanks:c('Your document details are saved. These details do not interpret your result.','Ձեր փաստաթղթի տվյալները պահված են։ Այս տվյալները չեն մեկնաբանում ձեր արդյունքը։','Данные вашего документа сохранены. Эти данные не интерпретируют ваш результат.'),
 empty:c('Your document is unavailable. You can attach it again.','Ձեր փաստաթուղթը հասանելի չէ։ Կարող եք նորից կցել։','Ваш документ недоступен. Вы можете прикрепить его снова.'),
};
export const DOC_TYPE={
 lab:c('Lab results','Լաբորատոր արդյունքներ','Результаты анализов'),ecg:c('ECG','ԷՍԳ','ЭКГ'),echocg:c('Echocardiogram','Էխոսրտագրություն','Эхокардиография'),
 duplex:c('Duplex scan','Դուպլեքս հետազոտություն','Дуплексное сканирование'),ct_calcium:c('Calcium scan','Կալցիումի հետազոտություն','Кальциевый индекс'),
 discharge:c('Discharge summary','Դուրսգրման ամփոփագիր','Выписка'),prescription:c('Prescription','Դեղատոմս','Рецепт'),other:c('Other document','Այլ փաստաթուղթ','Другой документ'),
};
export const UPLOADER={member:c('You','Դուք','Вы'),nurse:c('Your nurse','Ձեր բուժքույրը','Ваша медсестра'),doctor:c('Your doctor','Ձեր բժիշկը','Ваш врач'),admin:c('Your admin','Ձեր համակարգողը','Ваш администратор')};
