const t=(en:string,hy:string,ru:string)=>({en,hy,ru});
/** Draft copy, pending clinical/language approval. All medicine fields come from the publication. */
export const PLAN={
 title:t('Your approved plan','Ձեր հաստատված պլանը','Ваш утверждённый план'),
 medicines:t('Medicines','Դեղեր','Лекарства'),targets:t('Targets','Թիրախներ','Цели'),lifestyle:t('Lifestyle','Ապրելակերպ','Образ жизни'),calendar:t('Calendar','Օրացույց','Календарь'),
 seal:t('Approved by your doctor','Հաստատված է ձեր բժշկի կողմից','Утверждено вашим врачом'),
 statin:t('A statin is not a course.','Ստատինը կուրսային բուժում չէ։','Статин не принимают курсом.'),
 confirm:t("The plan is clear, let's start",'Պլանը պարզ է, սկսենք','План понятен, начнём'),
 saved:t('You confirmed that this plan is clear.','Դուք հաստատեցիք, որ այս պլանը պարզ է։','Вы подтвердили, что этот план понятен.'),
 unknown:t('Not provided yet','Դեռ տրամադրված չէ','Пока не указано'),
 empty:t('Your doctor has not published a plan yet.','Ձեր բժիշկը դեռ պլան չի հրապարակել։','Ваш врач пока не опубликовал план.'),
 unavailable:t('Your plan is unavailable right now. Try again.','Ձեր պլանն այժմ հասանելի չէ։ Կրկին փորձեք։','Ваш план сейчас недоступен. Попробуйте снова.'),
 bp:t('Blood pressure goal','Ճնշման թիրախ','Цель давления'),ldl:t('LDL goal','LDL-ի թիրախ','Цель LDL'),
 current:t('Your recorded LDL','Ձեր գրանցված LDL-ը','Ваш записанный LDL'),
 noMedicines:t('No medicines are listed in this plan.','Այս պլանում դեղեր նշված չեն։','В этом плане лекарства не указаны.'),
 noDates:t('No test dates are recorded yet.','Հետազոտության ամսաթվեր դեռ գրանցված չեն։','Даты анализов пока не записаны.'),
 recheck:t('Read your current plan','Կարդալ ձեր ընթացիկ պլանը','Прочитать текущий план'),
};
