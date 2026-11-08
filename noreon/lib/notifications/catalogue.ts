export const eventLabels: Record<string, string> = {
 'monitoring.created':'Your doctor added a monitoring requirement', 'monitoring.cancelled':'Your doctor cancelled a monitoring requirement',
 'review.no_change': 'Review completed, approved plan unchanged', 'review.published': 'Review completed with publication',
 'case.created': 'Case created', 'assignment.changed': 'Your care team assignment changed',
 'questionnaire.completed': 'Health questions completed', 'questionnaire.updated': 'Health answers updated',
 'booking.changed': 'Test booking updated', 'results.updated': 'Result receipt updated',
 'consultation.changed': 'Consultation decision updated', 'appointment.changed': 'GP appointment updated',
 'evidence.reviewed': 'Current evidence reviewed',
 'draft.saved': 'Review draft saved', 'plan.published': 'Your approved care plan is ready', 'workflow.reset': 'Fictional workflow restarted',
};
export const eventLabelsHy: Record<string, string> = {
 'monitoring.created':'Ձեր բժիշկը ավելացրել է չափումների պահանջ', 'monitoring.cancelled':'Ձեր բժիշկը չեղարկել է չափումների պահանջը',
 'review.no_change': 'Բժիշկը վերանայել է նոր տեղեկությունը․ հաստատված պլանը չի փոխվել',
 'assignment.changed': 'Ձեր խնամքի թիմի նշանակումը փոխվել է', 'booking.changed': 'Հետազոտության այցը թարմացվել է',
 'consultation.changed': 'Խորհրդատվության որոշումը թարմացվել է', 'appointment.changed': 'Բժշկի այցը թարմացվել է',
 'plan.published': 'Ձեր հաստատված խնամքի պլանը պատրաստ է', 'workflow.reset': 'Ցուցադրական ընթացքը վերագործարկվել է',
};
export const eventLabelsRu: Record<string, string> = {
 'monitoring.created':'Ваш врач добавил требование к измерениям', 'monitoring.cancelled':'Ваш врач отменил требование к измерениям',
 'review.no_change': 'Проверка завершена, утверждённый план не изменился', 'review.published': 'Проверка завершена с публикацией',
 'case.created': 'Случай создан', 'assignment.changed': 'Состав вашей медицинской команды изменился',
 'questionnaire.completed': 'Анкета о здоровье заполнена', 'questionnaire.updated': 'Ответы о здоровье обновлены',
 'booking.changed': 'Запись на анализы обновлена', 'results.updated': 'Сведения о получении результатов обновлены',
 'consultation.changed': 'Решение о консультации обновлено', 'appointment.changed': 'Визит к врачу общей практики обновлён',
 'evidence.reviewed': 'Текущие данные проверены',
 'draft.saved': 'Черновик проверки сохранён', 'plan.published': 'Ваш утверждённый план лечения готов', 'workflow.reset': 'Демонстрационный процесс перезапущен',
};
export type NotificationChannel = 'in-app' | 'sms' | 'whatsapp';
