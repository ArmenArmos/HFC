// Synthetic multilingual regressions shared by the parser and real-pipeline checks.
export const inexactMeasurements=[
 'height 175 kg, weight 92 cm','height 175 kg, weight 92 kg','height 175 cm, weight 92 cm',
 'рост 175 кг, вес 92 см','հասակս 175 կգ, քաշս 92 սմ',
 '175 cm, <92 kg','175 cm, ≤92 kg','175 cm, >92 kg','175 cm, ≥92 kg',
 '175 cm, about 92 kg','175 cm, approximately 92 kg','175 cm, around 92 kg',
 '175 cm, ~92 kg','175 cm, ≈92 kg','175 cm, −92 kg','175 cm, -92 kg','175 cm, +92 kg',
 '175 cm, weight -92','175 cm, weight −92','175 cm, 92 kg?',
 '175 cm, 90-92 kg','175 cm, 90–92 kg','175 cm, 90 to 92 kg','175 cm, 92±2 kg',
 '175 cm, 92..5 kg','175 cm, 9.2e1 kg','175 cm, .92 kg','175 cm, 0,092.0 kg',
 'height 1 75 cm, weight 92 kg','height 1,750.0 m, weight 92 kg','175 cm, weight 092 kg',
 'рост 175 см, вес около 92 кг','рост 175 см, вес примерно 92 кг','рост 175 см, вес до 92 кг',
 'рост 175 см, вес −92 кг','рост 175 см, вес 90–92 кг','рост 175 см, вес 92 кг?',
 'հասակս 175 սմ, քաշս մոտ 92 կգ','հասակս 175 սմ, քաշս ≤92 կգ','հասակս 175 սմ, քաշս −92 կգ',
 'հասակս 175 սմ, քաշս 90-92 կգ','հասակս 175 սմ, քաշս 92 կգ?',
 'рост 175 cm, քաշս about 92 kg','height 175 см, вес ~92 կգ',
 'height <175 cm, weight 92 kg','height about 175 cm, weight 92 kg',
 'height −175 cm, weight 92 kg','height 170–175 cm, weight 92 kg',
 '175 cm, maybe 92 kg','175 cm, estimated 92 kg','175 cm, circa 92 kg',
 'рост 175 см, вес возможно 92 кг','հասակս 175 սմ, քաշս գուցե 92 կգ',
 'height 175 cm, weight 92 kg approximately','height 175 cm, weight 92 kg or so',
 'height 175 cm, weight 92 kg at most','175 cm, 92 kg give or take',
 '175 cm, －92 kg','175 cm, ＋92 kg','175 cm, ‐92 kg','175 cm, ⁻92 kg',
];

export const validBmiReplies=[
 'Your BMI 30','Your BMI 30.0','Your BMI 30.00','Your BMI 30,0','Your BMI 30,00',
 'Your BMI is 30.00.','Your body mass index is 30.0.', 'Your BMI: **30.00**',
 'Ваш ИМТ 30','Ваш ИМТ 30.0','Ваш ИМТ 30.00','Ваш ИМТ 30,0','Ваш ИМТ 30,00',
 'Ваш ИМТ составляет 30,00.','Ваш индекс массы тела — 30',
 'Ձեր BMI-ը 30.0 է','Ձեր BMI-ն 30 է','Ձեր BMI-ը՝ 30,00 է',
 'Ձեր մարմնի զանգվածի ինդեքսը 30 է','Ձեր BMI-ն 30.00 է',
 'Your BMI = 30,00. LDL 3.4.','Ваш ИМТ: 30,00; LDL 3.4.',
 'Ձեր BMI-ը 30,0 է, BP 135/85։','Your BMI is 30; ЛПНП 3.4.',
];
export const wrongBmiReplies=[
 'LDL 30.0','LDL 30.00; BMI 29.9','BMI 130.0','BMI 30.01','BMI 30.09','BMI 29.99',
 'BMI 30.001','BMI -30.0','BMI −30.0','BMI <30.0','BMI 30.10','BMI 30,0.0',
 'ИМТ 29,9; ЛПНП 30,0','ИМТ 130; LDL 30','индекс массы тела — 29.9',
 'BMI-ը 29.9 է, LDL 30.0','BMI-ը 30.01 է','BMI-ն 130 է',
 'BMI is discussed here. LDL 30.0','BMI: LDL 30.0','ИМТ обсуждается; вес 30.0',
 'BMI-ն քննարկենք, LDL 30,0','30.0 is the LDL value.','BMI is 3e1',
];

export const otherSubjects=[
 'My father has a question','My mother has a question','My wife has a question','My husband has a question',
 'My son has a question','My daughter has a question','My brother has a question','My sister has a question',
 'My friend has a question','My neighbour has a question','My colleague has a question','Her measurements',
 'У папы вопрос','У мамы вопрос','У жены вопрос','У мужа вопрос',
 'Мой отец спрашивает','Моя мама спрашивает','Его показатели','Её показатели',
 'Հորս հարցն է','Մորս հարցն է','Կինս հարց ունի','Հայրս հարց ունի',
 'My aunt has a question','My uncle has a question','My cousin has a question',
 "Alex's measurements",'Моя сестра спрашивает','Брат спрашивает',
];
export const selfSwitches=['For me: 175 cm, 92 kg','My own height is 175 cm, weight 92 kg',
 'Для меня: рост 175 см, вес 92 кг','Мой рост 175 см, мой вес 92 кг',
 'Ինձ համար՝ հասակս 175 սմ, քաշս 92 կգ','Իմ հասակը 175 սմ, քաշը 92 կգ'];

export const harmlessMeasurements=[
 '175 cm, 92 kg. Please explain briefly','175 cm, 92 kg. What do you think?',
 '175 cm, 92 kg. Thanks','175 cm, 92 kg. Thank you for explaining',
 '175 cm, 92 kg. Please keep it simple','175 cm, 92 kg. Could you explain these results?',
 'My height is 175 cm and weight 92 kg. Any thoughts?','175 cm, 92 kg. Just a brief explanation please',
 'Рост 175 см, вес 92 кг. Объясните коротко','Рост 175 см, вес 92 кг. Спасибо',
 'Рост 175 см, вес 92 кг. Что думаете?','Рост 175 см, вес 92 кг. Пожалуйста, объясните',
 'Рост 175 см, вес 92 кг. Можно попроще?','Рост 175 см, вес 92 кг. Что это означает?',
 'Հասակս 175 սմ, քաշս 92 կգ։ Շնորհակալություն','Հասակս 175 սմ, քաշս 92 կգ։ Կարճ բացատրեք',
 'Հասակս 175 սմ, քաշս 92 կգ։ Ինչ եք կարծում','Հասակս 175 սմ, քաշս 92 կգ։ Խնդրում եմ բացատրել',
 'Հասակս 175 սմ, քաշս 92 կգ։ Պարզ ասեք','Հասակս 175 սմ, քաշս 92 կգ։ Ինչ է նշանակում',
 'Рост 175 cm, քաշս 92 kg. Thanks','Height 175 см, вес 92 կգ. Please explain briefly',
 'Հասակս 175 cm, weight 92 kg. Спасибо','175 սմ, 92 кг. What do you think?',
 '175 cm, 92 kg. Tell me about these readings','175 cm, 92 kg. Go over these results please',
 'My BP is under control. Height 175 cm, weight 92 kg. Thanks',
 '175 cm, 92 kg. Расскажите про эти показатели','175 cm, 92 kg. Պարզ բացատրեք այս թվերը',
];

// R10-01: general BMI references cannot validate or invalidate a personal assertion.
export const personalBmiCases: {language:'en'|'ru'|'hy';reply:string;valid:boolean}[]=[];
for(const language of ['en','ru','hy']as const){
 const personal={en:(n:string)=>`Your BMI is ${n}.`,ru:(n:string)=>`Ваш ИМТ составляет ${n}.`,hy:(n:string)=>`Ձեր BMI-ն ${n} է։`}[language];
 const reference={en:'A BMI 30 is one of the usual adult boundaries.',ru:'ИМТ 30 является одной из обычных границ для взрослых.',hy:'BMI 30-ը մեծահասակների սովորական սահմաններից մեկն է։'}[language];
 const band={en:'A BMI of 25 or more is overweight. The usual adult range is 18.5 to 24.9.',ru:'ИМТ от 25 означает избыточную массу тела. Обычный диапазон для взрослых 18,5–24,9.',hy:'BMI 25-ից սկսվում է ավելորդ քաշի միջակայքը։ Սովորական միջակայքը 18,5–24,9 է։'}[language];
 for(const n of ['30','30.0','30,0','30.00','30,00']){
  personalBmiCases.push({language,reply:personal(n),valid:true},{language,reply:`${personal(n)} ${band}`,valid:true});
 }
 for(const reply of [personal('18.5'),`${personal('18.5')} ${reference}`,`${reference} ${personal('18.5')}`,reference,band,`${personal('30')} ${personal('18.5')}`,`${personal('18.5')} ${personal('30')}`]){
  personalBmiCases.push({language,reply,valid:false});
 }
}
for(const [language,valid,replies]of [
 ['en',true,['BMI 30.0.','Your BMI is 30; your BMI equals 30,0.','BMI 30 from your height of 175 cm; BMI 25 or more is overweight.','Your height is 175, BMI 30.0.','You have a BMI of 30.0.','Your body mass index equals 30,0.','BMI 30.0 from your height of 175 cm and weight of 92 kg.','At 175 cm and 92 kg, BMI 30.0.','BMI is 30,0 for you.','The BMI is yours: 30.0.','BMI 25 is a boundary; yours is 30.0.','Your BMI is 30; a BMI of 25 or more is overweight, at your height of 175 cm.']],
 ['en',false,['Your height is 175, BMI 18.5. Your BMI is 30.0.','Your BMI is 30; your BMI is 30,0.0.','You have a BMI of 18.5. A BMI of 30 is a boundary.','BMI 18.5 from your height of 175 cm. BMI 30 is the obesity boundary.','Your BMI is 30. Yours is 18.5.','Your BMI is 18.5; yours is 30.','BMI 30 is the obesity boundary at your height of 175 cm.','A BMI of 30 is a boundary at your weight of 92 kg.','Your BMI is 30; BMI 18.5 from your weight of 92 kg.']],
 ['ru',true,['Ваш ИМТ 30; ИМТ у вас 30,0.','ИМТ 30 при вашем росте 175 см; ИМТ 25 и выше означает избыточную массу тела.','Ваш рост 175, ИМТ 30.0.','Вaш ИМТ равен 30,0.','ИМТ у вас 30.0.','ИМТ у вас составляет 30,0.','Ваш индекс массы тела: 30.0.','При вашем росте 175 см и весе 92 кг ИМТ 30,0.']],
 ['ru',false,['Ваш рост 175, ИМТ 18,5. Ваш ИМТ 30.','Вaш ИМТ 18,5. ИМТ 30 является границей.','ИМТ у вас 18,5. ИМТ 30 является границей.','Ваш индекс массы тела 18,5. Ваш ИМТ 30.','При вашем росте 175 см ИМТ 18,5. ИМТ 30 является границей.']],
 ['hy',true,['Ձեր BMI-ն 30 է, ձեր մարմնի զանգվածի ինդեքսը 30,0 է։','Ձեր 175 սմ հասակի դեպքում BMI 30 է, BMI 25-ից սկսվում է ավելորդ քաշի միջակայքը։','Ձեր հասակը 175 է, BMI 30.0 է։','Ձեր մարմնի զանգվածի ինդեքսը 30,0 է։','Ձեր BMI՝ 30։','Ձեր 175 սմ հասակի և 92 կգ քաշի դեպքում BMI 30.0 է։']],
 ['hy',false,['Ձեր հասակը 175 է, BMI 18,5 է։ Ձեր BMI-ն 30 է։','Ձեր մարմնի զանգվածի ինդեքսը 18,5 է։ BMI 30-ը սահման է։','Ձեր BMI-ն 30 է։ Ձեր մարմնի զանգվածի ինդեքսը 18,5 է։','Ձեր 175 սմ հասակի դեպքում BMI 18,5 է։ BMI 30-ը սահման է։']],
]as const)for(const reply of replies)personalBmiCases.push({language,reply,valid});
