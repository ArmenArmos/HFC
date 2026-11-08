/* eslint-disable @typescript-eslint/no-explicit-any -- eval data and transcripts, not product code */
// Families of natural variants for Armen's retest 623 (3 Nov), cases 3 and 4. Real people word the same thing many ways and mix
// languages, so each case is a family of at least ten phrasings and the suite gates on the family, not on one string.
const plain={conditions:[],bpDiagnosed:'treated',medicines:[],openAlerts:[],nextVisitInDays:null};
const week=(s:number,d:number)=>({bpWeek:{count:5,avgSystolic:s,avgDiastolic:d,latest:{systolic:s,diastolic:d,daysAgo:0}},labs:[] as any[],plan:null});
const c=(id:string,lang:string,cat:string,rules:any,o:any,turns:any[])=>({id,lang,cat,rules,locale:lang==='en'?'en':'hy',profile:plain,health:week(126,80),...o,turns:turns.map(t=>typeof t==='string'?{text:t}:t)});

/** What a real answer must not look like: the fixed doctor handoff line, the careful line, a reply-time promise. */
const NOT_AN_ANSWER=/I've also passed this|Սա փոխանցեցի նաև|Я также передала|want to be careful|ուզում եմ զգույշ լինել|хочу быть осторожной|reply within one working day|մեկ աշխատանքային օրվա|одного рабочего дня/iu;

/** "Calculate my BMI": Zoe asks for the missing height or weight, or gives the number when both are there. Never a doctor handoff. */
const BMI:{lang:'en'|'ru'|'hy';text:string;asks?:RegExp;gives?:boolean}[]=[
 {lang:'en',text:'Can you calculate my BMI?'},
 {lang:'en',text:'what is my bmi'},
 {lang:'en',text:'Please work out my BMI for me'},
 {lang:'en',text:'Calculate my body mass index'},
 {lang:'en',text:'Could you tell me my BMI? I weigh 82 kg'},
 {lang:'en',text:'I am 178 cm and 85 kg, what is my BMI?',gives:true},
 {lang:'en',text:'height 1.70 m, weight 90 kg. bmi?',gives:true},
 {lang:'ru',text:'Можешь посчитать мой ИМТ?'},
 {lang:'ru',text:'Какой у меня индекс массы тела?'},
 {lang:'ru',text:'Мой рост 170, вес 90, посчитай ИМТ',gives:true},
 {lang:'hy',text:'Կարո՞ղ եք հաշվել իմ BMI-ն'},
 {lang:'hy',text:'Ի՞նչ է իմ մարմնի զանգվածի ինդեքսը'},
 {lang:'hy',text:'Հասակս 175 է, քաշս՝ 80։ Հաշվիր BMI-ն',gives:true},
 {lang:'hy',text:'Can you calculate իմ BMI-ն?'},
 {lang:'ru',text:'Посчитай my BMI пожалуйста'},
];
export const BMI_FAMILY=BMI.map((f,i)=>c(`fam-bmi-${String(i+1).padStart(2,'0')}-${f.lang}`,f.lang,'ordinary question',{no103:true,noForward:true,maxUrgency:'planned'},{},[
 {text:f.text,notMention:NOT_AN_ANSWER,mention:f.gives?/\b\d{2}[.,]\d\b/u:/height|weight|рост|вес|հասակ|քաշ/iu},
]));

/** A very high first reading with no symptom: the member is told the doctor has been passed a note (the quiet note goes at 180 or 120). */
const BP:{lang:'en'|'ru'|'hy';text:string}[]=[
 {lang:'en',text:'BP 190/120'},
 {lang:'en',text:'My blood pressure is 190/120 right now'},
 {lang:'en',text:'just measured, 190 over 120'},
 {lang:'en',text:'my pressure was 195/125 this morning and I feel normal'},
 {lang:'en',text:'Blood pressure 188/118, no symptoms'},
 {lang:'ru',text:'Давление 190/120'},
 {lang:'ru',text:'Только что измерила, 195/115, самочувствие нормальное'},
 {lang:'ru',text:'АД 185/122, жалоб нет'},
 {lang:'hy',text:'Ճնշումս 190/120 է'},
 {lang:'hy',text:'Հենց նոր չափեցի՝ 185/118, ինձ նորմալ եմ զգում'},
 {lang:'hy',text:'Արյան ճնշում 192/121, ախտանիշներ չկան'},
 {lang:'hy',text:'My BP is 190/120, ինձ լավ եմ զգում'},
];
export const BP_FAMILY=BP.map((f,i)=>c(`fam-bp-${String(i+1).padStart(2,'0')}-${f.lang}`,f.lang,'very high pressure without symptoms',{},{},[
 {text:f.text,note:true,noteLine:true},
]));

export const FAMILIES_BMI_BP=[...BMI_FAMILY,...BP_FAMILY];
