import {normaliseText} from './normalise';
import {asserted,denied,discounted,gapNegated} from './symptoms/red-flags';
import {FREE_MODE_CONFIG} from './free-mode-config';
import {bpReadings} from './bp-parse';
import {LDL_LIPID_MEDICINE_NAMES} from '@/lib/ldl/constants';
import type {HealthData} from './health-answer';

/**
 * Spec v1.1 Appendix A Level 2 floors (Armen's sign-off, 20 Oct 2026): deterministic same-day minimums that no model answer can
 * lower. They add to sameDayFloor (health-answer.ts: BP 180/120, triglycerides 10, glucose 13.9 with symptoms, SGLT2 sick day),
 * whose glucose floor is 13.9 mmol/L with a symptom (Armen, 2 Nov). A value with current symptoms is Level 1
 * and is the urgent lists' job, before any of this runs. Thresholds are in free-mode-config.ts.
 */
export const LEVEL_TWO_FLOORS_VERSION='zoe-level2-floors-8';
export type LevelTwoFloor='potassium'|'troponin'|'one_leg_swelling'|'hf_weight_gain'|'critical_lab'|'pregnancy_bp'|'statin_red_sign'|'slow_pulse_dizzy';

const sentencesOf=(raw:string)=>raw.split(/(?<=[.!?։՞？])\s+|\n+/u).map(s=>({raw:s,t:normaliseText(s).replaceAll('’',"'")}));
// A number about a threshold, not the member's own value ("is potassium above 6 dangerous?").
const THRESHOLD_BEFORE=/(?:(?<![\p{L}])(?:above|over|below|under|if|level|threshold|than|limit|եթե|շեմ|если|выше|ниже|порог|больше|меньше)\s*)$/u;
// In a question, only the member's own value counts ("My potassium is 6.3, is that bad?"), not a general question.
const OWN=/(?<![\p{L}])(?:my|mine|i (?:have|had|got)|today|yesterday|results?|test|analysis|իմ|ինձ մոտ|այսօր|երեկ|արդյունք\p{L}*|անալիզ\p{L}*|\p{L}+ս(?=\s)|мо[йяеи]|у меня|сегодня|вчера|анализ\p{L}*|результат\p{L}*)(?![\p{L}])/u;
const HYPOTHETICAL=/(?<![\p{L}])(?:if|would|suppose|если|бы|եթե|ենթադրենք)(?![\p{L}])/u;
const counts=(s:{raw:string;t:string},at:number)=>(!/[?՞？]/u.test(s.raw)||OWN.test(s.t))&&!HYPOTHETICAL.test(s.t.slice(0,at));

// Potassium of 6.0 mmol/L or more, or 2.8 or less.
// T1 audit: «K+ is 2.8», Cyrillic «К+ 6,2»; plain «k» only right before a number.
const POTASSIUM=/(?:potassium|kalium|калий|калия|калию|կալիում\p{L}*|kalium\w*|(?<![\p{L}])[kк]\+(?![\p{L}])|(?<![\p{L}])k(?=\s*[:=-]?\s*\d))([^\d\n]{0,20})(\d{1,2}(?:[.,]\d{1,2})?)(?![\d])/gu;
// Not a serum value: a dose or tablet ("potassium tablets 6 mg"), a date or time ("on 6/10", «ամսի 6-ին», «6 октября», «6in»),
// or a denied value ("is not 6.4").
const K_NOT_VALUE_AFTER=/^\s*(?:mg|мг|մգ|mcg|%|tablet|таблет|հաբ|[/.]\d|-?\s?(?:ին|ից|in|ic)(?![\p{L}])|-?ի(?![\p{L}])|(?:st|nd|rd|th)(?![\p{L}])|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\p{L}*|январ|феврал|март|апрел|ма[йя]|июн|июл|август|сентябр|октябр|ноябр|декабр|числ|час|o'?clock|am(?![\p{L}])|pm(?![\p{L}])|ժամ)/u;
const K_NOT_VALUE_BETWEEN=/(?<![\p{L}])(?:not|no|isn'?t|не|нет|չէ|չի|chi|tablets?|pills?|supplements?|appointment|таблет\p{L}*|назнач\p{L}*|на|on|ամսի|amis|հաբ\p{L}*)(?![\p{L}])/u;
// Any value in mmol/L counts, extreme ones included (Astra V11-07: 1.0 and 10.2 are out of range, not noise); 0 and above 20 are not potassium.
const potassiumOut=(v:number)=>v>0&&v<=20&&(v>=FREE_MODE_CONFIG.potassiumHighMmol||v<=FREE_MODE_CONFIG.potassiumLowMmol);

// Troponin above the reference limit without current symptoms (with symptoms the urgent lists send 103).
const TROPONIN=/troponin|тропонин\p{L}*|տրոպոնին\p{L}*|troponin\w*/gu;
const RAISED=/(?<![\p{L}])(?:high|higher|raised|elevated|above|positive|out of range|abnormal|выше|повыш\p{L}*|высок\p{L}*|положит\p{L}*|превыш\p{L}*|բարձր\p{L}*|դրական|նորմայից|ավելի|barcr|bardzr)(?![\p{L}])/u;
// Normal or negative said of the troponin itself, not "higher than normal" or "breathing is normal" (Astra V11-06).
const NORMAL=/(?<![\p{L}])(?<!than |above |выше |over )(?:normal|negative|в норме|нормальн\p{L}*|отрицательн\p{L}*|նորմալ|բացասական)(?![\p{L}])/u;
/** The words said about the troponin: from 25 characters before it to the end of its clause. */
// Both sides stop at a clause break or a conjunction ("My breathing is normal and my troponin is high"); a label colon after the word
// keeps its value ("My troponin: elevated"; Astra V11-06).
const BREAK=/[,;]|(?<![\p{L}])(?:but|and|но|и|а|բայց|ու|իսկ|եւ)(?![\p{L}])/gu;
const aboutTroponin=(t:string,i:number,end:number)=>{const head=t.slice(Math.max(0,i-25),i);
 const from=Math.max(0,i-25)+Math.max(0,...[...head.matchAll(new RegExp(BREAK.source+'|:','gu'))].map(m=>m.index!+m[0].length));
 const to=t.slice(end).search(new RegExp(BREAK.source,'u'));return t.slice(from,to<0?t.length:end+to);};

// T1 audit: the value and the limit are compared in one unit when both carry one (0.02 ng/mL is 20 ng/L).
const TROPONIN_UNIT='(ng\\/ml|ng\\/l|pg\\/ml|µg\\/l|μg\\/l|ug\\/l|нг\\/мл|нг\\/л|пг\\/мл)?';
const TROPONIN_VALUE=new RegExp(`^\\p{L}*[^\\d\\n]{0,15}(\\d+(?:[.,]\\d+)?)\\s*${TROPONIN_UNIT}[^\\d\\n]{0,40}?(?:reference|ref\\.?|limit|cut-?off|upper|норм\\p{L}*|референс\\p{L}*|նորմա\\p{L}*|սահման\\p{L}*)[^\\d\\n]{0,15}(\\d+(?:[.,]\\d+)?)\\s*${TROPONIN_UNIT}`,'u');
const ngPerL=(v:string,u:string|undefined)=>Number(v.replace(',','.'))*(u&&/ng\/ml|нг\/мл|g\/l/u.test(u)&&!/ng\/l|нг\/л/u.test(u)?1000:1);
// "Not elevated", "no longer elevated", «не повышен», «բարձր չէ» deny the raise (T1 audit).
const RAISED_DENIED=/(?<![\p{L}])(?:not|no longer|isn'?t|wasn'?t|never|не|больше не|уже не|ոչ)\s+(?:\p{L}+\s+)?(?:high|higher|raised|elevated|above|positive|abnormal|повыш\p{L}*|высок\p{L}*|положит\p{L}*|бարձր\p{L}*|դրական)|(?:բարձր|դրական)\s+(?:չէ|չի)/gu;

// New swelling of one leg (a possible clot): one, left or right leg, calf or ankle.
const ONE_LEG=new RegExp([
 /(?:one|left|right|my left|my right|his left|her left|his right|her right) (?:leg|calf|ankle|foot)[^.!?\n]{0,25}(?:swollen|swelling|swelled|swell|puffy|bigger|thicker)|(?:swollen|swelling (?:in|of|on)|puffy) (?:my |the |one |his |her )?(?:left|right|one) (?:leg|calf|ankle|foot)/u.source,
 /(?:одна|левая|правая|одной|левой|правой|одну|левую|правую) (?:нога|ноги|ногу|голень|голени|икра|икры|лодыжк\p{L}*|стоп\p{L}*)[^.!?\n]{0,25}(?:отек\p{L}*|отёк\p{L}*|опух\p{L}*|распух\p{L}*|отекл\p{L}*|больше|толще)|(?:отек|отёк|опухол\p{L}*|опухла|отекла) (?:одной|левой|правой) (?:ноги|голени|икры|стопы)|(?:отекл\p{L}*|опухл\p{L}*|распухл\p{L}*|отек\p{L}*|отёк\p{L}*)\s+(?:\p{L}+\s+)?(?:левая|правая|одна) (?:нога|голень|икра|лодыжка|стопа)/u.source,
 /(?:մի|մեկ|ձախ|աջ) (?:ոտք|սրունք|ազդր|կոճ|ոտնաթաթ)\p{L}*[^.!?\n]{0,25}(?:ուռ\p{L}*|այտուց\p{L}*|հաստաց\p{L}*)|(?:ուռ\p{L}*|այտուց\p{L}*)[^.!?\n]{0,20}(?:մի|մեկ|ձախ|աջ) (?:ոտք|սրունք)\p{L}*/u.source,
 /(?:dzax|aj|mi|mek) (?:otq|otk|srunq)\w*[^.!?\n]{0,25}(?:urr|urel|aytuc)\w*/u.source,
].join('|'),'gu');
// Both legs are not one leg ("both ankles swollen, the left more"): left to the model.
const BOTH=/both (?:legs|ankles|feet)|обе ног|обеих ног|երկու ոտք|erku otq/u;
// "My leg is swollen, only one side" (Astra review): a leg swelling with an only-one-side phrase in the same sentence.
const LEG_SWOLLEN=/(?:leg|calf|ankle)[^.!?\n]{0,20}(?:swollen|swelling|puffy)|(?:нога|голень|икра)[^.!?\n]{0,20}(?:отек|отёк|опух|распух|отекл)\p{L}*|(?:ոտք|սրունք)\p{L}*[^.!?\n]{0,20}(?:ուռ|այտուց)\p{L}*|otq\w*[^.!?\n]{0,20}(?:urr|urel|aytuc)\w*/u;
const ONE_SIDE=/only (?:on )?one (?:side|leg)|one side only|just one (?:side|leg)|только (?:одна|с одной)|с одной стороны|միայն մի(?:ն| կողմ| ոտք)|mi koxm/u;
// Long-standing swelling is not new (Astra review: "swollen for ten years").
const CHRONIC=/for (?:\d+|many|several|ten|a few|some) years|for years|always|long-standing|годами|много лет|давно|несколько лет|տարիներ|տարի է|վաղուց|vaxuc|tariner/u;

// Heart failure with a weight gain of 2 kg or more in 3 days or fewer (dataset S041).
const HF=/heart failure|(?<![\p{L}])(?:c?hf|hfref|hfpef)(?![\p{L}])|сердечн\p{L}* недостаточн\p{L}*|(?<![\p{L}])хсн(?![\p{L}])|սրտային անբավարարություն|սրտի անբավարարություն|srtayin anbavararutyun/u;
const KG=/(\d{1,3}(?:[.,]\d{1,2})?)\s*(?:kg|kgs|kilos?|kilograms?|кг|килограмм\p{L}*|կգ|կիլոգրամ\p{L}*|kilogram)(?![\p{L}])/gu;
const DAYS=/(?<![\d])(\d{1,2}|one|two|three|a couple of|один|одна|два|две|три|пару|մեկ|մի|երկու|երեք|mek|mi|erku|ereq)\s*(?:days?|дн\p{L}*|сут\p{L}*|օր\p{L}*|orum|oric|or(?![\p{L}]))/u;
const LB=/(\d{1,3}(?:[.,]\d{1,2})?)\s*(?:lb|lbs|pounds?)(?![\p{L}])/gu;
const DAY_WORDS:Record<string,number>={one:1,two:2,three:3,'a couple of':2,'один':1,'одна':1,'два':2,'две':2,'три':3,'пару':2,'մեկ':1,'մի':1,'երկու':2,'երեք':3,mek:1,mi:1,erku:2,ereq:3};
const SHORT_SPAN=/since yesterday|overnight|in a day|за сутки|со вчера|за ночь|երեկվանից|մեկ գիշերում|mi orum/u;
const RANGE=/(?:from|с|от)?\s*(\d{2,3}(?:[.,]\d{1,2})?)\s*(?:kg|кг|կգ)?\s*(?:to|до|-ից|ից)\s*(\d{2,3}(?:[.,]\d{1,2})?)\s*(?:kg|kgs|kilos?|кг|կգ)/u;
const GAIN=/(?<![\p{L}])(?:gain\w*|put on|up by|(?:is|are|went) up|increas\w*|went up|heavier|набрал\p{L}*|прибав\p{L}*|увелич\p{L}*|поправил\p{L}*|вырос|ավելացել|ավելացավ|գիրացել|ավել\p{L}*|avelacel)(?![\p{L}])/u;
const OTHER_PERSON=/(?<![\p{L}])(?:my |his |her |our )?(?:mother|mom|mum|father|dad|husband|wife|son|daughter|brother|sister|grand(?:ma|pa|mother|father)|friend|neighbou?r)(?![\p{L}])|(?<![\p{L}])(?:у (?:мамы|папы|мужа|жены|сына|дочери|бабушки|дедушки|брата|сестры)|мама|папа|муж|жена)(?![\p{L}])|(?:մայրս|մամաս|հայրս|պապաս|ամուսինս|կինս|տղաս|աղջիկս|տատս|պապս|եղբայրս|քույրս)/u;
const FIRST_PERSON=/(?<![\p{L}'])(?:i|i've|i'm|my weight|я|мой вес|у меня|ես|քաշս)(?![\p{L}'])/u;
const sentenceAt=(t:string,at:number)=>{const from=Math.max(0,...[...t.slice(0,at).matchAll(/[.!?\n]/gu)].map(m=>m.index+1));const to=t.slice(at).search(/[.!?\n]/u);return t.slice(from,to<0?t.length:at+to);};
function hfWeightGain(s:{raw:string;t:string}):boolean{
 // Pounds as kilograms (T1 audit: "up 5 lb in 2 days").
 const kg=[...s.t.matchAll(KG)].map(m=>Number(m[1]!.replace(',','.'))).concat([...s.t.matchAll(LB)].map(m=>Number(m[1]!.replace(',','.'))/2.2046));
 if(!kg.length)return false;
 const d=DAYS.exec(s.t);
 const days=d?(Number.isFinite(Number(d[1]))?Number(d[1]):DAY_WORDS[d[1]!]??99):SHORT_SPAN.test(s.t)?1:null;
 if(days===null||days>FREE_MODE_CONFIG.hfWeightGainDays)return false;
 // "From 80 to 83 kg", «с 80 до 83 кг», «80-ից 83 կգ»: the difference; otherwise the gained amount next to a gain word.
 const range=RANGE.exec(s.t);
 const delta=range?Number(range[2]!.replace(',','.'))-Number(range[1]!.replace(',','.'))
  :kg.length>=2&&kg[0]!>20&&kg[1]!>20?kg[1]!-kg[0]!:GAIN.test(s.t)?Math.max(0,...kg.filter(x=>x<20)):0;
 const at=Math.max(0,s.t.search(KG),s.t.search(LB));
 // Not a past gain ("3 kg in 3 days last year; my weight is stable now"; T1 audit).
 return delta>=FREE_MODE_CONFIG.hfWeightGainKg-1e-9&&!gapNegated(s.t.slice(0,at).slice(-25))&&!discounted(s.t,at,at+3);
}

type Lab=HealthData['labs'][number];
const potassiumLab=(l:Lab)=>/potassium|калий|կալիում|^k\+?$/iu.test(l.marker)&&/mmol|ммоль/iu.test(l.unit)&&potassiumOut(l.value);
const troponinLab=(l:Lab)=>/troponin|тропонин|տրոպոնին/iu.test(l.marker)&&l.high!==null&&l.value>l.high;
type LabRow=typeof FREE_MODE_CONFIG.criticalLabs[number];
const rowHits=(r:LabRow,l:Lab)=>r.marker.test(l.marker)&&r.unit.test(l.unit)&&(!r.muscleSymptoms||l.muscleSymptoms===true)
 &&(l.value<=(r.atMost??-Infinity)||l.value>=(r.atLeast??Infinity)||r.overHigh!==undefined&&l.high!==null&&l.value>l.high*r.overHigh);
/**
 * A result at the spec's critical level (task 12). The model reads an unreviewed result without its number, so it can no longer place this itself:
 * the level comes from here, the same-day route sends it to the doctor, and the member still sees no number.
 */
export const criticalLab=(l:Lab)=>l.daysAgo<=14&&(potassiumLab(l)||troponinLab(l)||/triglycerid|тригл|եռգլիցերիդ|տրիգլիցերիդ/iu.test(l.marker)&&/mmol/iu.test(l.unit)&&l.value>=FREE_MODE_CONFIG.triglyceridesSameDayMmol
 ||FREE_MODE_CONFIG.criticalLabs.some(r=>!r.level&&rowHits(r,l)));
/** An unreviewed result that needs the doctor in the coming days and is not critical (ALT, Armen's answer 11). */
export const soonLab=(l:Lab)=>!l.reviewed&&l.daysAgo<=14&&!criticalLab(l)&&FREE_MODE_CONFIG.criticalLabs.some(r=>r.level==='doctor_soon'&&rowHits(r,l));
/** The coming-days floor from stored results: the smallest addition beside the same-day one. */
export const soonFloor=(data:HealthData|null|undefined)=>!!data?.labs.some(l=>soonLab(l)&&!l.alerted);
/** A critical CK result whose same-day line also says when a statin may be paused (Armen's answer 12). */
export const statinLab=(l:Lab)=>!l.reviewed&&!l.alerted&&l.daysAgo<=14&&FREE_MODE_CONFIG.criticalLabs.some(r=>r.statinLine&&rowHits(r,l));

/** A stored result that sets a same-day floor by itself: any critical one before review, and potassium, troponin and triglycerides at any time. */
export const labFloor=(l:Lab)=>soonLab(l)||criticalLab(l)&&(!l.reviewed||potassiumLab(l)||troponinLab(l)||/triglycerid|тригл|եռգլիցերիդ|տրիգլիցերիդ/iu.test(l.marker));

// Armen, 2 Nov (Task 9; [needs doctor sign-off]): over 20 weeks, a new BP of 140/90 or more with no symptoms is same-day (with a symptom the
// urgent list sends 103). The gestation must be stated: with the weeks unknown or under 20, the model decides as before.
const PREGNANT=/հղի|беремен\p{L}*|pregnan\w*|hxi(?![\p{L}])/u;
const PREG_WEEKS=/(?<![\d/.,])(\d{1,2})[\s-]*(?:weeks?|wks?|недел\p{L}*|շաբաթ\p{L}*|shabat\w*)/gu,PREG_MONTHS=/(?<![\d/.,])(\d)[\s-]*(?:months?|месяц\p{L}*|месяч\p{L}*|ամս\p{L}*|amsakan\w*)/gu;
const overTwentyWeeks=(t:string)=>[...t.matchAll(PREG_WEEKS)].some(m=>Number(m[1])>=20&&Number(m[1])<=42)||[...t.matchAll(PREG_MONTHS)].some(m=>Number(m[1])>=5);
function pregnancyBp(raw:string):boolean{
 const sn=sentencesOf(raw);
 if(!sn.some(s=>PREGNANT.test(s.t)&&overTwentyWeeks(s.t)&&!gapNegated(s.t.slice(0,Math.max(0,s.t.search(PREGNANT))).slice(-12))))return false;
 return sn.some(s=>!CHRONIC.test(s.t)&&bpReadings(s.t).some(r=>(r.systolic>=FREE_MODE_CONFIG.pregnancyBpSystolic||r.diastolic>=FREE_MODE_CONFIG.pregnancyBpDiastolic)
  &&!THRESHOLD_BEFORE.test(s.t.slice(Math.max(0,r.index-25),r.index))&&counts(s,r.index)&&!discounted(s.t,r.index,r.index+3)));
}

// Task 15 (Armen, 2 Nov; needs doctor sign-off): on a statin, dark urine, yellow skin or eyes, or marked weakness is the doctor today. Muscle pain alone is not (coming days, the model's level).
// The shared lipid names less what is not a statin. The two generic stems match anywhere; the rest from the start of a word, and «права» never («справа»): правастатин has the stem.
const NOT_STATIN=/ezetim|evolocumab|alirocumab|inclisiran|bempedo|ezetrol|repatha|praluent|leqvio|эзетим|эволокумаб|алирокумаб|инклисиран|бемпедо|эзетрол|репата|пралуэнт|էզետիմ/u;
const STATIN_STEM=/statin|статин|ստատին/u;
const STATIN_NAMES=LDL_LIPID_MEDICINE_NAMES.filter(n=>!NOT_STATIN.test(n)&&!STATIN_STEM.test(n)&&n!=='prava'&&n!=='права');
// The whole word, so a denial after it is read («ստատին չեմ խմում»).
const STATIN_WORD=new RegExp(`\\p{L}*(?:${STATIN_STEM.source})\\p{L}*|(?<![\\p{L}])(?:${STATIN_NAMES.join('|')})\\p{L}*`,'u');
/** A statin the member takes: named in a statement, not denied ("I do not take statins") and not a question ("do I need a statin?"). */
const namesStatin=(raw:string)=>raw.split(/(?<=[.!?։՞？])\s+|\n+/u).some(s=>!/[?՞？]/u.test(s)&&asserted(normaliseText(s),STATIN_WORD));
// Someone else's sign. A carer naming that person's statin in the same sentence still counts ("My mother takes atorvastatin and her urine is dark").
const OTHER_SUBJECT=/(?<![\p{L}])(?:she|he|her|his|they|their|она|он|её|ее|его|их)(?![\p{L}])/u;
const someoneElses=(t:string)=>(OTHER_PERSON.test(t)||OTHER_SUBJECT.test(t))&&(!namesStatin(t)||FIRST_PERSON.test(t));
// Clause by clause (no comma): "urine is normal, no dark urine" does not join across it. Yellow is skin or eyes only, never teeth.
const STATIN_SIGN=new RegExp([
 /dark (?:urine|pee)|(?:urine|pee)[^.!?,;\n]{0,30}(?:dark|brown|tea|cola|coffee)|cola[- ]colou?red urine|colou?r of (?:cola|tea|coffee)|yellow (?:skin|eyes)|(?:skin|eyes)[^.!?,;\n]{0,25}yellow|jaundice/u.source,
 /т[её]мн\p{L}* моч\p{L}*|моч\p{L}*[^.!?,;\n]{0,25}(?:т[её]мн\p{L}*|коричнев\p{L}*|бур\p{L}*|цвета (?:чая|колы|кофе))|(?:кож\p{L}*|глаз\p{L}*|белк\p{L}*)[^.!?,;\n]{0,20}(?:пожелтел\p{L}*|ж[её]лт\p{L}*)|(?:пожелтел\p{L}*|ж[её]лт\p{L}*) (?:кож\p{L}*|глаз\p{L}*|белк\p{L}*)|желтух\p{L}*/u.source,
 /մուգ մեզ\p{L}*|մեզ\p{L}*[^.։,;\n]{0,20}(?:մուգ|մգացել|թեյի|կոլայի|սուրճի|շագանակագույն)\p{L}*|(?:մաշկ|աչք)\p{L}*[^.։,;\n]{0,20}(?:դեղն|դեղին)\p{L}*|դեղին (?:մաշկ|աչք)\p{L}*|դեղնուկ\p{L}*/u.source,
 /mug mez\w*|mez\w* mug|(?:mashk|achq)\w*[^.,;\n]{0,20}(?:deghn|dexn|deghin|dexin)\w*|deghnuk\w*/u.source,
].join('|'),'gu');
// Marked weakness: the member's own, in the present ("I was so weak with flu" is not), and never a word about the pain in that clause ("pain is very weak", «боль очень слабая»).
const STATIN_WEAK=new RegExp([
 /(?:i am|i'm|i feel|i've been feeling|feeling|i've become|i have become|i'm getting|my (?:legs|arms|muscles) (?:are|feel)) (?:so|very|really|extremely|too) weak|(?:marked|severe|extreme|great|serious) (?:muscle )?weakness/u.source,
 /(?:очень|сильно|совсем) ослаб\p{L}*|(?:я|ноги|руки|мышцы)(?: стали)? очень слаб(?:ые|ая|ый|а)(?![\p{L}])|(?:сильн|выраженн)\p{L}* слабост\p{L}*/u.source,
 /շատ (?:թույլ|թուլացել) եմ|ուժեղ թուլություն\p{L}*|shat (?:tuyl|tulacel) em|(?:uzheg?|ujex) tulutyun\w*/u.source,
].join('|'),'gu');
const PAIN_WORD=/pain|ache|aching|hurt|sore|боль|боли|болит|болят|болью|ցավ|cav/u;
const CLAUSE=/[,;]|(?<![\p{L}])(?:but|and|но|и|а|բայց|ու|և|isk)(?![\p{L}])/gu;
const clauseAt=(t:string,at:number)=>{const from=Math.max(0,...[...t.slice(0,at).matchAll(CLAUSE)].map(m=>m.index+m[0].length));const to=t.slice(at).search(new RegExp(CLAUSE.source,'u'));return t.slice(from,to<0?t.length:at+to);};
const statinSign=(s:{raw:string;t:string},m:RegExpMatchArray)=>!gapNegated(m[0])&&!denied(s.t,m.index!,m.index!+m[0].length)&&!gapNegated(s.t.slice(0,m.index).slice(-25))&&!discounted(s.t,m.index!,m.index!+m[0].length)&&counts(s,m.index!);
const onStatinCheck=(texts:readonly string[],data:HealthData|null|undefined,known:readonly string[])=>[...texts,...known,data?.plan?.medicationName??''].some(namesStatin);

// STAGING, pending Armen sign-off. This adds only a Level 2 minimum; the urgent guards still run first.
// Read a stated value, never a comparative threshold, dose, age or a pulse borrowed from another message.
const SLOW_PULSE=/(?<![\p{L}])(?:pulse|heart ?rate|пульс\p{L}*|чсс|պուլս\p{L}*|զարկեր\p{L}*|անոթազարկ\p{L}*|սրտիս? զարկ\p{L}*|puls\w*|anotazark\w*|zarkerak\w*|srti zark\w*)([^\d\n.!?]{0,18})(\d{1,3}(?:[.,]\d+)?)(?![\d])/gu;
const PULSE_GAP_NOT_VALUE=/(?<![\p{L}])(?:not|no|isn'?t|wasn'?t|above|over|below|under|than|threshold|if|pressure|bp|не|нет|выше|ниже|меньше|больше|если|չէ|չի|ոչ|ցածր|բարձր|եթե|chi|che|chka|ete|cacr|bardzr)(?![\p{L}])|давлен|ճնշ|chnsh|[<>≤≥]/u;
const PULSE_NOT_UNIT=/^\s*(?:mg|мг|մգ|kg|кг|կգ|years?|лет|տարեկան|[/:]\d|%)/u;
const PULSE_OTHER=new RegExp(`${OTHER_PERSON.source}|${OTHER_SUBJECT.source}|${/(?<![\p{L}])(?:his|her|their|someone|него|неё|нее|мамин\p{L}*|папин\p{L}*|друга|подруги|отца|матери|сестры|брата|մոր|հոր|մորս|հորս|մայրիկիս|հայրիկիս|ընկեր\p{L}*|նրա|նա|mama\w*|mayr\w*|hayr\w*|ynker\w*|mors|hors|nra|mom|dad)(?![\p{L}])/u.source}`,'u');
const PULSE_OWN=/(?<![\p{L}])(?:my|i|i'm|i've|у меня|мой|моя|я|իմ|ինձ|ես|em|unem|im)(?![\p{L}])|(?:պուլսս|զարկերս|գլուխս|թույլ եմ|pulss|pulsis|gluxs|tuyl em)/u;
const PULSE_SYMPTOM=/(?<![\p{L}])(?:dizz\w*|light[- ]?headed\w*|weak(?:ness)?|головокруж\p{L}*|кружится голова|голова кружится|слабост\p{L}*|слабый|слабая|գլխապտույտ\p{L}*|գլուխս պտտվում\p{L}*|թուլություն\p{L}*|թույլ եմ|glxaptuyt\w*|glkhaptuyt\w*|gluxs pttvum\w*|tulutyun\w*|tuyl em)(?![\p{L}])/u;
const PULSE_SYMPTOM_QUESTION=/(?<![\p{L}])(?:can|could|would|does|cause|causes|symptoms? of|причин\p{L}*|может|может ли|вызывает|կարող|առաջացն\p{L}*|karox)(?![\p{L}])/u;
const PULSE_SYMPTOM_SELF=/(?<![\p{L}])(?:i (?:am|feel|have)|i'm|(?:we|both(?: of us)?)(?: both)? (?:are|feel|have)|у меня|у нас|мы|чувствую|уже кружится|ունեմ|եմ|ունենք|ենք|unem|em|unenq|enq)(?![\p{L}])/u;
// Keep a question word with its clause: "can I feel dizzy?" is a question, while
// "I feel dizzy, can I wait?" contains a current assertion before the question.
const PULSE_SYMPTOM_CLAUSES=new RegExp(`[,;]|(?=${PULSE_SYMPTOM_QUESTION.source})`,'u');
// Attribute each assertion locally. Unknown ownership is deliberately not an exclusion.
// The last subject wins within a clause: "my mother" is other, "my mother and I" is own.
const PULSE_GROUP=/(?<![\p{L}])(?:we|both|us|мы|нас|оба|обоих|մենք|երկուսս|ունենք|ենք|unenq|enq)(?![\p{L}])/u;
// Excluding a reading requires direct ownership, not "mother is here/says/brought the monitor".
const PULSE_OTHER_READING=new RegExp(`(?:${PULSE_OTHER.source})(?:'s)?\\s*(?:(?:has|had|with|имеет)\\s+)?(?:a\\s+)?$`,'u');
type PulseSubject='own'|'other'|'unknown';
function pulseSubject(t:string,inherited:PulseSubject):PulseSubject{
 const own=[...t.matchAll(new RegExp(`${PULSE_OWN.source}|${PULSE_GROUP.source}`,'gu'))].at(-1)?.index??-1;
 const other=[...t.matchAll(new RegExp(PULSE_OTHER.source,'gu'))].at(-1)?.index??-1;
 return own<0&&other<0?inherited:own>other?'own':'other';
}
function slowPulseDizzy(raw:string):boolean{
 const t=normaliseText(raw).replaceAll('’',"'");
 const symptoms:PulseSubject[]=[],readings:PulseSubject[]=[];
 for(const s of sentencesOf(raw)){
  let subject:PulseSubject='unknown';
  // Keep group subjects intact; an explicit subject in the next clause replaces the inherited one.
  for(const clause of s.t.split(new RegExp(`${PULSE_SYMPTOM_CLAUSES.source}|${CLAUSE.source}|(?<![\p{L}])եւ(?![\p{L}])`,'u'))){
   const current=pulseSubject(clause,subject);
   let next:PulseSubject='unknown';
   if(!PULSE_SYMPTOM_QUESTION.test(clause)&&!HYPOTHETICAL.test(clause)&&(!/[?՞？]/u.test(s.raw)||PULSE_SYMPTOM_SELF.test(clause)||subject==='own')&&asserted(clause,PULSE_SYMPTOM)){symptoms.push(current);next=current;}
   for(const m of clause.matchAll(SLOW_PULSE)){
    const value=Number(m[2]!.replace(',','.')),end=m.index+m[0].length;
    if(value>0&&value<FREE_MODE_CONFIG.slowPulseBpm&&!PULSE_GAP_NOT_VALUE.test(m[1]!)&&!HYPOTHETICAL.test(clause.slice(0,end))
     &&!PULSE_NOT_UNIT.test(clause.slice(end))&&!discounted(clause,m.index,end)){
     const before=clause.slice(0,m.index),owner=pulseSubject(before,subject);
     next=owner==='other'&&PULSE_OTHER.test(before)&&!PULSE_OTHER_READING.test(before)?'unknown':owner;
     readings.push(next);
    }
   }
   subject=next;
  }
 }
 if(!symptoms.length||!readings.length)return false;
 if(/[?՞？]/u.test(raw)&&!PULSE_OWN.test(t)&&!PULSE_GROUP.test(t))return false;
 return readings.some(s=>s!=='other')||symptoms.some(s=>s!=='other');
}

/**
 * The v1.1 Level 2 floors that the member's messages or data meet (empty when none). `statinContext`: what else may name a statin (earlier
 * messages, the LDL record, the member's medicines); false leaves the statin floor out, so a caller can ask whether another floor fired.
 */
export function levelTwoFloors(texts:readonly string[],data:HealthData|null|undefined,statinContext:readonly string[]|false=[]):LevelTwoFloor[]{
 const out=new Set<LevelTwoFloor>();
 if(texts.some(slowPulseDizzy))out.add('slow_pulse_dizzy');
 // Heart failure asserted, not denied ("I do not have heart failure"); a diagnosis since last year still counts (Astra V11-09).
 const hfMentions=texts.flatMap(x=>{const t=normaliseText(x).replaceAll('’',"'");return [...t.matchAll(new RegExp(HF.source,'gu'))].filter(m=>!denied(t,m.index,m.index+m[0].length)).map(m=>({t,at:m.index}));});
 // Whose heart failure (T1 audit: "My mother has heart failure. I gained 3 kg in 2 days" is not the member's): another person's
 // diagnosis counts only for a gain that is not said in the first person (a carer: "she gained 3 kg").
 const hfSelf=hfMentions.some(x=>!OTHER_PERSON.test(sentenceAt(x.t,x.at))),hfOther=hfMentions.length>0;
 const hfContextFor=(sentence:string)=>hfSelf||(hfOther&&!FIRST_PERSON.test(sentence));
 if(texts.some(pregnancyBp))out.add('pregnancy_bp');
 const onStatin=statinContext!==false&&onStatinCheck(texts,data,statinContext);
 for(const raw of texts)for(const s of sentencesOf(raw)){
  for(const m of s.t.matchAll(POTASSIUM)){const at=m.index+m[0].length-m[2]!.length;
   if(THRESHOLD_BEFORE.test(s.t.slice(Math.max(0,at-25),at))||!counts(s,m.index))continue;
   if(K_NOT_VALUE_BETWEEN.test(m[1]!)||K_NOT_VALUE_AFTER.test(s.t.slice(m.index+m[0].length,m.index+m[0].length+12)))continue;
   // Not a past value ("6.4 last year, now 4.1"; Astra V11-07).
   if(potassiumOut(Number(m[2]!.replace(',','.')))&&!discounted(s.t,m.index,m.index+m[0].length))out.add('potassium');}
  for(const m of s.t.matchAll(TROPONIN)){const w=aboutTroponin(s.t,m.index,m.index+m[0].length);
   if(RAISED.test(w.replace(RAISED_DENIED,' '))&&!NORMAL.test(w)&&!discounted(s.t,m.index,m.index+m[0].length)&&counts(s,m.index))out.add('troponin');
   // A value with its reference limit: "troponin 45 ng/L, upper reference 14", «тропонин 0,08, норма до 0,04».
   // Not a past value ("45 ng/L last year"; Astra V11-13).
   const num=TROPONIN_VALUE.exec(s.t.slice(m.index));if(num&&(num[2]&&num[4]?ngPerL(num[1]!,num[2])>ngPerL(num[3]!,num[4]):Number(num[1]!.replace(',','.'))>Number(num[3]!.replace(',','.')))&&!discounted(s.t,m.index,m.index+num[0].length)&&counts(s,m.index))out.add('troponin');}
  for(const m of s.t.matchAll(ONE_LEG))if(!BOTH.test(s.t)&&!CHRONIC.test(s.t)&&!gapNegated(m[0])&&!discounted(s.t,m.index,m.index+m[0].length)&&counts(s,m.index))out.add('one_leg_swelling');
  // The swelling itself asserted ("My leg is not swollen, only one side hurts"; Astra V11-12).
  {const m=LEG_SWOLLEN.exec(s.t);if(m&&!gapNegated(m[0])&&!discounted(s.t,m.index,m.index+m[0].length)&&ONE_SIDE.test(s.t)&&!BOTH.test(s.t)&&!CHRONIC.test(s.t)&&counts(s,0))out.add('one_leg_swelling');}
  if(hfContextFor(s.t)&&counts(s,0)&&hfWeightGain(s))out.add('hf_weight_gain');
  if(onStatin&&!someoneElses(s.t)){
   for(const m of s.t.matchAll(STATIN_SIGN))if(statinSign(s,m))out.add('statin_red_sign');
   for(const m of s.t.matchAll(STATIN_WEAK))if(statinSign(s,m)&&!PAIN_WORD.test(clauseAt(s.t,m.index)))out.add('statin_red_sign');
  }
 }
 for(const l of data?.labs??[]){
  if(l.daysAgo>14||l.alerted)continue;
  if(potassiumLab(l))out.add('potassium');
  if(troponinLab(l))out.add('troponin');
  if(!l.reviewed&&criticalLab(l))out.add('critical_lab');
 }
 return [...out];
}
