import type {ResultsCategoryRule,ResultsGate,ResultsRiskLevel,ResultsAssessment} from '@/lib/clinical/rules/results-assessment';

type Copy={en:string;hy:string;ru:string};
const c=(en:string,hy:string,ru:string):Copy=>({en,hy,ru});
export const categoryCopy:Record<ResultsRiskLevel,Copy>={
 very_high:c('Very high','Շատ բարձր','Очень высокий'),
 high:c('High','Բարձր','Высокий'),
 moderate:c('Moderate','Միջին','Умеренный'),
 low_moderate:c('Low to moderate','Ցածր-միջին','Низкий или умеренный'),
};
export const ruleCopy:Record<ResultsCategoryRule,Copy>={
 ascvd:c('Recorded atherosclerotic cardiovascular disease.','Փաստագրված ԱՍՍՀ։','Записано атеросклеротическое сердечно-сосудистое заболевание.'),
 egfr_under_30:c('eGFR below 30.','eGFR <30։','СКФ ниже 30.'),
 diabetes_organ_damage:c('Diabetes with albuminuria.','ՇԴ + թիրախ-օրգանի վնասում՝ ալբումինուրիա։','Диабет с альбуминурией.'),
 egfr_30_59:c('eGFR from 30 to below 60.','eGFR 30–59։','СКФ от 30 до менее 60.'),
 fh:c('Your member has familial hypercholesterolaemia.','Անդամն ունի ընտանեկան հիպերքոլեստերինեմիա։','У участника семейная гиперхолестеринемия.'),
 diabetes_short:c('Diabetes under ten years, age under 50, with no other recorded factors.','ՇԴ, <50 տ., տևողություն <10 տ., առանց այլ գործոնների։','Диабет менее десяти лет, возраст до 50 лет, без других установленных факторов.'),
 diabetes_other:c('Diabetes outside the short-duration, no-other-factors group.','ՇԴ՝ մնացած բոլոր դեպքերում, ներառյալ անհայտ տևողությունը։','Диабет вне группы с короткой длительностью без других факторов.'),
 ldl_tc_high:c('LDL-C at least 4.9 or total cholesterol above 8.0.','LDL-C ≥4,9 կամ TC >8,0։','ЛПНП не менее 4,9 или общий холестерин выше 8,0.'),
 score2_table:c('Entered SCORE2 percentage and age band.','SCORE2-ի մուտքագրված տոկոսը և տարիքային խումբը։','Введённый процент SCORE2 и возрастная группа.'),
};
export const gateCopy:Record<ResultsGate,Copy>={
 questionnaire_incomplete:c('Complete the questionnaire before assigning a category.','Լրացրեք հարցաթերթը՝ կատեգորիան որոշելու համար։','Завершите анкету для определения категории.'),
 conditions_unknown:c('Record known conditions before assigning a category.','Գրանցեք հայտնի հիվանդությունները՝ կատեգորիան որոշելու համար։','Уточните заболевания для определения категории.'),
 age_unknown:c('Record age before choosing the risk band.','Գրանցեք տարիքը՝ ռիսկի խումբն ընտրելու համար։','Укажите возраст для выбора группы риска.'),
 uacr_missing:c('uACR is missing. Albuminuria can change the category.','Միզի ACR բացակայում է։ Որոշում է բարձր / շատ բարձր սահմանը։','Нет АКС мочи. Альбуминурия может изменить категорию.'),
 diabetes_duration_unknown:c('Diabetes duration is unknown. Moderate risk cannot be asserted.','ՇԴ-ի տևողությունն անհայտ է։ «Միջին» ռիսկը պնդել հնարավոր չէ։','Длительность диабета неизвестна. Умеренный риск подтвердить нельзя.'),
 diabetes_unconfirmed:c('An elevated HbA1c needs confirmation before recording diabetes.','ՇԴ-ի ախտորոշումը հաստատված չէ։ Մեկ բարձր HbA1c-ն ախտորոշում չէ։','Повышенный HbA1c требует подтверждения диагноза диабета.'),
 lipids_incomplete:c('TC and HDL-C from the same sample day are needed for non-HDL-C.','Առանց նույն օրվա TC-ի և HDL-C-ի non-HDL-C-ն հաշվարկելի չէ։','Для расчёта не-ЛПВП нужны общий холестерин и ЛПВП за один день.'),
 score2_missing:c('Enter the ESC calculator percentage to assign a category.','SCORE2 կիրառելի է, տոկոսը չկա։ Կատեգորիա չի հաշվարկվում։','SCORE2 применим. Введите процент из калькулятора ESC для определения категории.'),
 lvh_without_echo:c('ECG shows LVH. Echo confirmation is missing.','ԷՍԳ-ով LVH, ԷխոԿԳ չկա։ Հաստատում է պետք։','На ЭКГ есть ГЛЖ. Нет подтверждения эхокардиографией.'),
 egfr_missing:c('eGFR is missing. Kidney-related risk cannot be fully assessed.','eGFR բացակայում է։ Երիկամային ռիսկը լիարժեք գնահատել հնարավոր չէ։','Нет СКФ. Риск, связанный с почками, оценён не полностью.'),
 values_awaiting_review:c('Check the AI-read lab values. They are excluded until reviewed.','Ստուգեք AI-ով կարդացված լաբորատոր արժեքները։ Մինչև ստուգումը դրանք չեն օգտագործվում։','Проверьте распознанные ИИ значения. До проверки они не используются.'),
};
export const score2ReasonCopy:Record<ResultsAssessment['score2']['reasons'][number],Copy>={
 ascvd:c('Atherosclerotic cardiovascular disease','ԱՍՍՀ','Атеросклеротическое сердечно-сосудистое заболевание'),
 heart_failure:c('Heart failure','Սրտի անբավարարություն','Сердечная недостаточность'),
 diabetes:c('Diabetes','Շաքարային դիաբետ','Сахарный диабет'),
 ckd:c('Recorded kidney disease or eGFR below 60','Փաստագրված ՔԵՀ կամ eGFR <60','Записанная болезнь почек или СКФ ниже 60'),
 fh:c('Familial hypercholesterolaemia','Ընտանեկան հիպերքոլեստերինեմիա','Семейная гиперхолестеринемия'),
 hmod:c('HMOD is present','HMOD առկա է','Есть HMOD'),
 under_40:c('SCORE2 is not validated under age 40','Մինչև 40 տարեկանը SCORE2 վավերացված չէ','SCORE2 не валидирован до 40 лет'),
};
