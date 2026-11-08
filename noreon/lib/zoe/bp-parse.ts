/**
 * Blood pressure readings in a member's sentence, shared by the free-mode same-day floor (health-answer.ts) and the 103
 * list's BP-with-organ-symptom entry (urgent-staging.ts) (Astra free-floor F1, F3). A full reading («186/122», "186 over
 * 122», «186 на 122», «186-ի 122», "186\122") counts as written. The spoken shorthand in tens («ճնշումս 18-ի 12», «давление 19 на 8»,
 * "BP 18 over 12", «chnshums 18-i 12») counts only right after a pressure word and never before a date or time marker («18-ի 12-ին»,
 * «18 на 12 часов»), so appointments and dates are not readings. Numbers only, never text.
 * A pair labelled as something else is not a reading (T1 audit, 21 Oct): a lab value or ratio («LDL/HDL 190/60», "creatinine
 * 180/120 µmol/L"), a dose ("valsartan 160/80 mg"), a phone number, or a pair followed by a lab or dose unit, unless a pressure
 * word stands right before the numbers.
 */
export const BP_PARSE_VERSION='zoe-bp-parse-2';
const PAIR=/(?<![\d/:\\])(\d{1,3})\s*(\/|\\|over|на|-?\s?ին|-?\s?ի|-i(?![\p{L}])|i(?=\s))\s*(\d{1,3})(?![\d/:\\]|[.,]\d)/gu;
// A pressure word right before the numbers, with at most two filler words ("BP is", «ճնշումս այսօր», «давление с утра»).
const BP_WORD_BEFORE=/(?<![\p{L}])(?:bp|blood pressure|pressure|ճնշ\p{L}*|զճ|давлен\p{L}*|ад|chnsh\p{L}*|cnsh\p{L}*|jnsh\p{L}*)[\s:,-]*(?:(?:is|was|of|now|today|this morning|է|էր|եղել|был\p{L}*|была|сейчас|сегодня|утром|с утра|հիմա|այսօր|առավոտյան|a|e|er|hima|aysor)[\s:,-]+){0,2}$/u;
// A date or time after the second number: «12-ին», «12-ից», «12 ժամ», «12 часов», «12 числа», "12 o'clock", "12:30", «12-in».
const DATE_AFTER=/^\s*(?:-?\s?ին(?![\p{L}])|-?\s?ից(?![\p{L}])|-?\s?in(?![\p{L}])|-?\s?ic(?![\p{L}])|ժամ|час|числ|o'?clock|am(?![\p{L}])|pm(?![\p{L}])|:|-?\s?ը(?![\p{L}]))/u;
// A unit right after the pair that is not mmHg: lab and dose units (mg, mg/dL, mmol, µmol/L, ng/mL, g/L, %), in EN/RU/HY.
const OTHER_UNIT_AFTER=/^\s*(?:mg|mcg|µg|ug|ng|pg|g\/|mmol|µmol|umol|μmol|iu|units?|%|мг|мкг|ммоль|мкмоль|нг|г\/|ед|մգ|մկգ|մմոլ|միավոր)/u;
// A label before the pair that names something other than blood pressure: lipids and other labs, a reference range, a dose or
// medicine, a phone, a tablet's marking, a date.
const OTHER_LABEL_BEFORE=/(?<![\p{L}])(?:ldl|hdl|cholesterol|triglycerid\p{L}*|creatinine|ferritin|haemoglobin|hemoglobin|hba1c|glucose|sugar|reference|dose|dosage|tablet|pill|medicine|valsartan|losartan|amlodipine|phone|tel|telephone|date|холестерин\p{L}*|лпнп|лпвп|креатинин\p{L}*|ферритин\p{L}*|гемоглобин\p{L}*|глюкоз\p{L}*|сахар\p{L}*|референс\p{L}*|дозиров\p{L}*|доз\p{L}*|таблет\p{L}*|лекарств\p{L}*|телефон\p{L}*|номер\p{L}*|дата|խոլեստերին\p{L}*|կրեատինին\p{L}*|հեմոգլոբին\p{L}*|շաքար\p{L}*|դեղ\p{L}*|դոզա\p{L}*|հաբ\p{L}*|հեռախոս\p{L}*|ամսաթիվ)(?![\p{L}])(?:\s*(?:[:=-]|\/\p{L}+|\+?\d+(?=\s)|(?:is|was|are|of|ratio|level|marked|number|interval|range|reference|limit|է|ա|էր)(?![\p{L}])))*\s*$/u;
const PHONE_BEFORE=/\+\d{1,3}\s*$/u;

export type BpReading={systolic:number;diastolic:number;index:number;shorthand:boolean};
/** The pair at [i,end) is labelled as something other than blood pressure (and no pressure word stands right before it). */
export function notBloodPressure(t:string,i:number,end:number){
 const before=t.slice(Math.max(0,i-45),i);
 if(BP_WORD_BEFORE.test(before))return false;
 return OTHER_UNIT_AFTER.test(t.slice(end,end+10))||OTHER_LABEL_BEFORE.test(before)||PHONE_BEFORE.test(t.slice(Math.max(0,i-8),i));
}
export function bpReadings(t:string):BpReading[]{
 const out:BpReading[]=[];
 for(const m of t.matchAll(PAIR)){
  const s=Number(m[1]),d=Number(m[3]);
  if(notBloodPressure(t,m.index,m.index+m[0].length))continue;
  // The Latin-letter «-i»/«i» separator is the Armenian shorthand; it counts only after a pressure word.
  const latin=/^-?i$/u.test(m[2]!.trim());
  if(!latin&&s>d&&s>=70&&s<=300&&d>=30&&d<=200){out.push({systolic:s,diastolic:d,index:m.index,shorthand:false});continue;}
  const pressureWord=BP_WORD_BEFORE.test(t.slice(Math.max(0,m.index-45),m.index));
  if(latin&&pressureWord&&s>d&&s>=70&&s<=300&&d>=30&&d<=200){out.push({systolic:s,diastolic:d,index:m.index,shorthand:false});continue;}
  if(s>d&&s>=9&&s<=30&&d>=4&&d<=20&&pressureWord&&!DATE_AFTER.test(t.slice(m.index+m[0].length,m.index+m[0].length+10)))
   out.push({systolic:s*10,diastolic:d*10,index:m.index,shorthand:true});
 }
 return out;
}

// A message that corrects an earlier one, or speaks of someone else.
export const BATCH_CORRECTION=/(?<![\p{L}])(?:sorry|mistyp\p{L}*|typo|wrong (?:reading|number|value)|i meant|actually|correction|не так|ошиб\p{L}*|опечат\p{L}*|извин\p{L}*|на самом деле|точнее|սխալ\p{L}*|ներող\p{L}*|իրականում|sxal\w*|kneres)(?![\p{L}])/u;
export const BATCH_OTHER_PERSON=/(?<![\p{L}])(?:my |his |her |our )(?:mother|mom|mum|father|dad|husband|wife|son|daughter|brother|sister|grand(?:ma|pa|mother|father)|friend|neighbou?r)|(?:mother|mom|mum|father|dad)'s|у (?:мамы|папы|мужа|жены|сына|дочери|бабушки|дедушки)|(?:мама|папа|муж|жена)(?![\p{L}])|(?:մայրս|մամաս|հայրս|պապաս|ամուսինս|կինս|տղաս|աղջիկս|տատս|պապս|մորս|հորս)|(?<![\p{L}])(?:mams|paps|mors|hors)(?![\p{L}])/u;
// Not a reading now (BP-02): history, or something read somewhere, or the member taking the number back.
const PAST_READING=/(?<![\p{L}])(?:yesterday|last (?:night|week|month|year)|(?:\d+|a|an|one|two|three|four|five|six|few|couple of|several) (?:hours?|days?|weeks?|months?|years?) ago|used to|before my|вчера|позавчера|на прошлой неделе|в прошлом|назад|раньше|երեկ\p{L}*|նախորդ|անցյալ\p{L}*|առաջ|yerek\p{L}*|erek\p{L}*|ancyal\p{L}*)(?![\p{L}])/iu;
const QUOTED_READING=/(?<![\p{L}])(?:leaflet|brochure|article|textbook|website|booklet|pamphlet|for example|e\.g\.|инструкци\p{L}*|листовк\p{L}*|брошюр\p{L}*|стать[еяю]|в интернете|например|բրոշյուր\p{L}*|հոդված\p{L}*|թերթիկ\p{L}*|օրինակ\p{L}*)(?![\p{L}])/iu;
const CURRENT_READING=/(?<![\p{L}])(?:now|today|this morning|just (?:measured|checked)|сейчас|сегодня|теперь|հիմա|այսօր|hima|aysor)(?![\p{L}])/iu;
const TAKEN_BACK=/(?:was|is|were) (?:a |an )?(?:typo|wrong|mistake|error|mistyped)|опечатк\p{L}*|ошибк\p{L}*|ошибочн\p{L}*|սխալ\p{L}*|sxal\w*/iu;
const BP_CLAUSE=/[,;]|(?<![\p{L}])(?:but|но|а|բայց|իսկ)(?![\p{L}])/iu;
/** The member speaks of themself, so a relative's number in the same message is not this member's. "He has a headache" stays a carer's emergency. */
export const bpFirstPerson=(t:string)=>/(?<![\p{L}'])(?:i|i'm|i've|я|у меня|мне|ես|ունեմ|unem|ցավում է|cavum e)(?![\p{L}'])/iu.test(t);
/** The sentence without the clauses that are not a reading now, so "yesterday 150/90, today 185/115" keeps the second. others: drop someone else's too. */
export function currentBpClauses(sentence:string,others:boolean){
 let notCurrent=false;
 return sentence.split(BP_CLAUSE).filter(c=>{
  const t=c.toLowerCase();
  // History and quotations carry across commas until a later clause explicitly speaks about now.
  if(PAST_READING.test(t)||QUOTED_READING.test(t))notCurrent=true;
  else if(CURRENT_READING.test(t))notCurrent=false;
  return !(notCurrent||TAKEN_BACK.test(t)||others&&BATCH_OTHER_PERSON.test(t));
 }).join(', ');
}
