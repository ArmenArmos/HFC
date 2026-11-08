/* eslint-disable @typescript-eslint/no-explicit-any -- eval data and transcripts, not product code */
// Families of natural variants for Roo's stress test (team message 631, 3 Nov): each case is at least ten phrasings in en, ru, hy and
// mixed, each tried fresh and where it matters right after an earlier 103, because Roo ran all 20 in one thread.
const plain={conditions:[],bpDiagnosed:'treated',medicines:[],openAlerts:[],nextVisitInDays:null};
const amlo={...plain,medicines:[{name:'amlodipine',dose:'5 mg',times:['08:00'],sinceDays:120}]};
const week=(s:number,d:number)=>({bpWeek:{count:5,avgSystolic:s,avgDiastolic:d,latest:{systolic:s,diastolic:d,daysAgo:0}},labs:[] as any[],plan:null});
const c=(id:string,lang:string,cat:string,rules:any,o:any,turns:any[])=>({id,lang,cat,rules,locale:lang==='en'?'en':'hy',profile:plain,health:week(126,80),...o,turns:turns.map(t=>typeof t==='string'?{text:t}:t)});
type L='en'|'ru'|'hy';
const OPEN:Record<L,string>={en:'My chest hurts badly, it is pressing, and my left arm hurts too',ru:'Сильная боль в груди, давит, и левая рука тоже болит',hy:'Կրծքավանդակիս ուժեղ ցավ ունեմ, սեղմում է, ձախ թևս էլ է ցավում'};
const CALLED:Record<L,string>={en:'I called 103',ru:'Я вызвала скорую, позвонила 103',hy:'Զանգեցի 103'};
/** The red card itself (the emergency route's own words); a conditional «if it comes back, call 103» is not it. */
export const RED_CARD=/Call 103 now|Позвоните 103 сейчас|Զանգահարեք 103 հիմա/u;
/** The doctor handoff line and the careful line: not an answer. */
export const HANDOFF=/I've also passed this|Սա փոխանցեցի նաև|Я также передала|want to be careful|ուզում եմ զգույշ լինել|хочу быть осторожной|reply within one working day|մեկ աշխատանքային օրվա|одного рабочего дня/iu;
const each=<T extends {lang:L;text:string}>(rows:T[],prefix:string,make:(r:T,id:string)=>any)=>rows.map((r,i)=>make(r,`${prefix}-${String(i+1).padStart(2,'0')}-${r.lang}`));

// 9. A multi-part message: the BMI is given and the readings are answered.
export const R9_MULTI_MESSAGES:{lang:L;text:string;bmi:string}[]=[
 {lang:'en',text:'My BP is 135/85, my LDL is 3.4 mmol/L, I am 175 cm and 92 kg. What do you think?',bmi:'30.0'},
 {lang:'en',text:'height 175, weight 92, BP 138/86, LDL 3.4 - how am I doing?',bmi:'30.0'},
 {lang:'en',text:'Today my pressure was 132/84. LDL 3.4. I am 175 cm tall and weigh 92 kg. Anything to note?',bmi:'30.0'},
 {lang:'ru',text:'Давление 135/85, ЛПНП 3,4, рост 175, вес 92. Что скажете?',bmi:'30,0|30.0'},
 {lang:'ru',text:'Мой рост 175 см, вес 92 кг, давление 138/86, холестерин ЛПНП 3.4. Как у меня дела?',bmi:'30,0|30.0'},
 {lang:'hy',text:'Ճնշումս 135/85 է, LDL-ը 3.4, հասակս 175 է, քաշս՝ 92։ Ինչ կասեք',bmi:'30,0|30.0'},
 {lang:'hy',text:'Հասակս 175 սմ, քաշս 92 կգ, ճնշումս 138/86, LDL 3.4։ Ինչպե՞ս եմ',bmi:'30,0|30.0'},
 {lang:'en',text:'175 cm, 92 kg, 136/84, LDL 3.4. ok?',bmi:'30.0'},
 {lang:'en',text:'I measured 134/84 this morning. Also LDL 3.4, height 175, weight 92. What does it mean?',bmi:'30.0'},
 {lang:'ru',text:'Утром 134/84, ЛПНП 3.4, рост 175 вес 92, что значит?',bmi:'30,0|30.0'},
 {lang:'en',text:'BP 135/85, LDL 3.4 mmol/L, height 1.75 m, weight 92 kg. What do these mean?',bmi:'30.0'},
 {lang:'en',text:'92 kg, 1.75 metres, LDL 3.4, BP 135/85. Can you explain each?',bmi:'30.0'},
 {lang:'en',text:'My height is 1.75, weight 92, HbA1c 5.8%, BP 135/85. What do you think?',bmi:'30.0'},
 {lang:'en',text:'Glucose 5.6 mmol/L, BP 135/85. I weigh 92 kg and am 175 cm.',bmi:'30.0'},
 {lang:'en',text:'I am 175 centimetres and 92 kilograms. BP 135/85 and HbA1c 5.8%. Explain please.',bmi:'30.0'},
 {lang:'en',text:'Weight 80 kg, LDL 3.4, height 170 cm, BP 135/85. What does it mean?',bmi:'27.7'},
 {lang:'en',text:'BP 135/85, glucose 5.6, height 1.80 m, weight 80 kg. Can you explain?',bmi:'24.7'},
 {lang:'ru',text:'Рост 1,75 м, вес 92 кг, давление 135/85, ЛПНП 3,4 ммоль/л. Что это значит?',bmi:'30,0|30.0'},
 {lang:'ru',text:'92 кг, 175 см, давление 135/85 и HbA1c 5,8%. Как это понимать?',bmi:'30,0|30.0'},
 {lang:'ru',text:'Глюкоза 5,6 ммоль/л, рост 175, вес 92, давление 135/85. Что скажете?',bmi:'30,0|30.0'},
 {lang:'ru',text:'Вес 92, рост 1.75, ЛПНП 3.4, давление 135/85. Объясните каждое значение.',bmi:'30,0|30.0'},
 {lang:'ru',text:'Давление 135/85, HbA1c 5.8, я 175 см и 92 кг. Что думаете?',bmi:'30,0|30.0'},
 {lang:'ru',text:'Рост 170 см, давление 135/85, вес 80 кг, ЛПНП 3,4. Что значит?',bmi:'27,7|27.7'},
 {lang:'hy',text:'Հասակս 1.75 մ է, քաշս՝ 92 կգ, ճնշումս 135/85, LDL 3.4։ Ինչ կասեք',bmi:'30,0|30.0'},
 {lang:'hy',text:'92 կգ, 175 սմ, HbA1c 5.8%, ճնշումս 135/85։ Ի՞նչ է նշանակում',bmi:'30,0|30.0'},
 {lang:'hy',text:'Գլյուկոզս 5.6 մմոլ/լ է, հասակս 175, քաշս 92, ճնշումս 135/85։ Ինչ կասեք',bmi:'30,0|30.0'},
 {lang:'hy',text:'Քաշս՝ 92, հասակս՝ 1,75, LDL 3,4, ճնշումս 135/85։ Բացատրեք խնդրում եմ',bmi:'30,0|30.0'},
 {lang:'hy',text:'Ճնշումս 135/85 է, հասակս՝ 175 սմ, HbA1c 5.8, քաշս՝ 92 կգ։ Ինչպե՞ս եմ',bmi:'30,0|30.0'},
 {lang:'hy',text:'Հասակս 170 սմ է, քաշս 80 կգ, ճնշումս 135/85, LDL 3.4։ Ինչ կասեք',bmi:'27,7|27.7'},
 {lang:'en',text:'BP 135/85, LDL 3.4, рост 175 см, weight 92 kg. What do you think?',bmi:'30.0'},
 {lang:'ru',text:'Давление 135/85, LDL 3.4, height 1.75 m, вес 92 кг. Что скажете?',bmi:'30,0|30.0'},
 {lang:'hy',text:'Հասակս 175 սմ, weight 92 kg, BP 135/85, HbA1c 5.8։ Ինչ կասեք',bmi:'30,0|30.0'},
 {lang:'hy',text:'Weight 92 kg, հասակս 1.75 մ, glucose 5.6, BP 135/85. Explain please.',bmi:'30.0'},
 {lang:'ru',text:'HbA1c 5,8, քաշս 92 կգ, рост 175 см, давление 135/85. Что значит?',bmi:'30,0|30.0'},
 {lang:'hy',text:'LDL 3.4, BP 135/85, height 175, քաշս՝ 92։ Ի՞նչ է նշանակում',bmi:'30,0|30.0'},
 {lang:'en',text:'BP 135/85 and LDL 3.4. Height 175 cm; weight 92 kg. Please answer both readings too.',bmi:'30.0'},
];
export const R9_MULTI_PART=R9_MULTI_MESSAGES.map((r,i)=>{
 const bp=r.text.match(/\d{3}\/\d{2}/u)![0].replace('/','\\s*/\\s*');
 const lab=r.text.match(/(?:LDL(?:-ը)?|ЛПНП|HbA1c|glucose|глюкоза|գլյուկոզս)\s+(?:is\s+)?(\d[.,]\d)/iu)!;
 const marker=/hba1c/iu.test(lab[0])?'HbA1c|гликирован|գլիկացված':/LDL|ЛПНП/iu.test(lab[0])?'LDL|ЛПНП|խոլեստերին':'glucose|sugar|глюкоз|сахар|գլյուկոզ|շաքար';
 const required=[r.bmi.replace(/\./g,'[.,]'),bp,marker,lab[1].replace(/[.,]/u,'[.,]')];
 return c(`roo-multi-${String(i+1).padStart(2,'0')}-${r.lang}`,r.lang,'several facts in one message',{no103:true},{},[{text:r.text,mention:new RegExp(required.map(p=>`(?=[\\s\\S]*(?:${p}))`).join(''),'iu'),notMention:HANDOFF}]);
});


export const FAMILIES_ROO631_MULTI=R9_MULTI_PART;
