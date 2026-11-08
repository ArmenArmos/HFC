import {bmi} from '@/lib/clinical/rules/derived';
import {THRESHOLD} from '@/lib/clinical/rules/rules';
import type {QuestionnaireFacts} from './chat-record';
import {normaliseText} from './normalise';
import type {ReplyLanguage} from './provider';
import {BATCH_OTHER_PERSON} from './bp-parse';
import {classifyScope} from './scope';

export const BMI_REQUEST_VERSION='zoe-bmi-request-1';
const BMI=/(?<![\p{L}])(?:bmi|body mass index|имт|индекс массы тела|մարմնի զանգվածի ինդեքս\p{L}*|imt|indeks massy tela|marmni zangvatsi indeks)(?![\p{L}])/u;
const REQUEST=/(?<![\p{L}])(?:calculate|work out|compute|count|what is my|what's my|tell me my|give me my|посчита\p{L}*|рассчита\p{L}*|какой у меня|можешь посчитать|հաշվ\p{L}*|ինչ է իմ|ինչքան է իմ|hashv\p{L}*|hashw\p{L}*|rasschitai|poschitai)(?![\p{L}])/u;
// Only the words of a personal calculation and its measurements. An unknown word or a second concern
// stays with the normal health flow, rather than trying to enumerate every symptom or other person.
const BMI_WORDS=/^(?:can|could|would|you|please|i|am|i'm|is|and|my|me|for|with|using|height|tall|weight|weigh|cm|centimet(?:er|re)s?|m|met(?:er|re)s?|kg|kilograms?|можешь|пожалуйста|мой|моя|мо[её]й|меня|рост|вес|и|см|м|метр\p{L}*|кг|կարող|եք|ես|խնդրում|եմ|իմ|ինձ|հասակ\p{L}*|քաշ\p{L}*|է|եւ|սմ|մ|մետր\p{L}*|կգ|ն|im|moi)$/u;
function bmiOnly(t:string){
 const rest=t.replace(new RegExp(BMI.source,'gu'),' ').replace(new RegExp(REQUEST.source,'gu'),' ');
 return (rest.match(/[\p{L}]+(?:'[\p{L}]+)?/gu)??[]).every(w=>BMI_WORDS.test(w))&&measurementNumbersOnly(rest);
}
/** A request about your own BMI, including the family's numbers followed by "bmi?" shorthand. */
export function bmiRequest(raw:string):boolean{
 const t=normaliseText(raw).replaceAll('’',"'");
 if(!BMI.test(t)||!bmiOnly(t))return false;
 return REQUEST.test(t)||/bmi\s*\?/u.test(t)&&/\d/u.test(t)&&!!(bmiNumbers(t).height||bmiNumbers(t).weight);
}

export type BmiNumbers={height:number|null;weight:number|null};
const NUMBER='([+\\-]?\\d+(?:[.,]+\\d+)*)';
const HEIGHT='(?:height|tall|рост|հասակ\\p{L}*)',WEIGHT='(?:weight|weigh|вес|քաշ\\p{L}*)';
const HEIGHT_UNIT='(?:cm|centimet(?:er|re)s?|см|սմ|m|met(?:er|re)s?|метр\\p{L}*|մետր\\p{L}*|м|մ)';
const WEIGHT_UNIT='(?:kg|kilograms?|кг|կգ)';
const labelled=(label:string)=>new RegExp(`(?<![\\p{L}])${label}\\s*(?:is|է)?\\s*[:՝=]?\\s*${NUMBER}\\s*([\\p{L}]+)?`,'gu');
const units=(unit:string)=>new RegExp(`(?<![\\d.,+\\-])${NUMBER}\\s*(${unit})(?![\\p{L}])`,'gu');
const PLAIN_NUMBER=/^[1-9]\d*(?:[.,]\d+)?$/u;
// Uncertain measurements must never be promoted to exact facts, even when a numeric fragment parses.
const QUALIFIER='(?:about|around|approximately|approx|roughly|nearly|maybe|estimated|circa|or so|give or take|over|under|between|at least|at most|more than|less than|около|примерно|приблизительно|возможно|до|более|менее|между|մոտ|մոտավորապես|շուրջ|գուցե|մինչեւ)';
const QUALIFIED_BEFORE=new RegExp(`(?:[<>≤≥≈~±]|\\d\\s+to|(?<![\\p{L}])${QUALIFIER}(?:\\s+(?:${HEIGHT}|${WEIGHT}))?[:՝=]?)\\s*$`,'u');
const QUALIFIED_AFTER=new RegExp(`^\\s*${QUALIFIER}(?![\\p{L}])`,'u');
const numberStart=(m:RegExpMatchArray)=>m.index!+m[0].indexOf(m[1]!);
function measurements(text:string,label:string,unit:string){
 const labels=[...text.matchAll(labelled(HEIGHT)),...text.matchAll(labelled(WEIGHT))];
 // A unit on a labelled value cannot silently reassign it to the other measurement.
 return [...text.matchAll(labelled(label)),...text.matchAll(units(unit)).filter(m=>!labels.some(l=>numberStart(l)===numberStart(m)))];
}
function exactMeasurement(text:string,m:RegExpMatchArray){
 const start=numberStart(m),before=text.slice(0,start),afterNumber=text.slice(start+m[1]!.length),after=text.slice(m.index!+m[0].length);
 return PLAIN_NUMBER.test(m[1]!)
  &&!QUALIFIED_BEFORE.test(before)&&!QUALIFIED_AFTER.test(after)
  &&!/[\p{L}\p{N}.,/'’]$/u.test(before)&&!/[+\p{Dash_Punctuation}−⁻₋＋﹢⁺₊/]\s*$/u.test(before)&&!/\d\s+$/u.test(before)
  &&!/^\s*(?:[+\p{Dash_Punctuation}−⁻₋＋﹢⁺₊/?!%]|\d|[.,]\d)/u.test(afterNumber)&&!/^\s*[?？/%]/u.test(after);
}
// A labelled number and its unit identify the same span. Count it once, but reject a second
// height/weight or any unclaimed number, even when it repeats a measurement's value.
function measurementNumbersOnly(t:string):boolean{
 if(t.includes('/'))return false;
 const claimed=new Set<number>();
 for(const [label,unit]of [[HEIGHT,HEIGHT_UNIT],[WEIGHT,WEIGHT_UNIT]]as const){
  const spans=new Set([...t.matchAll(labelled(label)),...t.matchAll(units(unit))].map(m=>m.index!+m[0].indexOf(m[1]!)));
  if(spans.size>1)return false;
  for(const start of spans){if(claimed.has(start))return false;claimed.add(start);}
 }
 return !/\p{N}/u.test(t.replace(new RegExp(NUMBER,'gu'),(n:string,_number:string,index:number)=>claimed.has(index)?' ':n));
}
/** Only measurements can answer a pending BMI question; other text keeps the health flow. */
export function bmiMeasurementReply(raw:string):boolean{
 const t=normaliseText(raw).replaceAll('’',"'").replace(/^no\s*,?\s*/u,'');
 return /\d/u.test(t)&&!BMI.test(t)&&!REQUEST.test(t)&&bmiOnly(t);
}
function value(text:string,label:string,unit:string,record:unknown,height:boolean):number|null{
 const matches=measurements(text,label,unit).sort((a,b)=>a.index!-b.index!);
 for(const explicit of matches.length?matches.reverse():[undefined]){
  const raw=explicit?.[1]??record;
  if(explicit&&!exactMeasurement(text,explicit))continue;
  if(typeof raw!=='number'&&!(typeof raw==='string'&&PLAIN_NUMBER.test(raw)))continue;
  const unitWord=explicit?.[2];
  if(unitWord&&!new RegExp(`^${unit}$`,'u').test(unitWord)&&!/^(?:and|weight|height|է|եւ|и|вес|рост)$/u.test(unitWord))continue;
  let n=Number(String(raw).replace(',','.'));
  // Labelled heights may be metres without an explicit unit: "рост 1,70".
  if(height&&explicit&&(unitWord&&new RegExp(`^${unit}$`,'u').test(unitWord)?/^(?:m|met|метր|մետր|м|մ)/u.test(unitWord):Math.abs(n)<3))n*=100;
  if(Number.isFinite(n)&&n>=(height?100:25)&&n<=(height?230:300))return n;
 }
 return null;
}
/** Newest valid explicit numbers win across the exchange. Only an unmentioned kind uses the questionnaire. */
export function bmiNumbers(raw:string,record:QuestionnaireFacts|null|undefined=null):BmiNumbers{
 const t=normaliseText(raw);
 return {height:value(t,HEIGHT,HEIGHT_UNIT,record?.['q2.height'],true),weight:value(t,WEIGHT,WEIGHT_UNIT,record?.['q2.weight'],false)};
}

const OTHER_SUBJECT=/(?<![\p{L}])(?:he|she|his|her|colleague\p{L}*|aunt|uncle|cousin|someone|person|его|её|ее|он|она|сестр\p{L}*|брат\p{L}*|коллег\p{L}*|գործընկեր\p{L}*|նրա)(?![\p{L}])|\p{L}+'s\s+(?:height|weight|measurements|results|readings)/u;
const SELF_SUBJECT=/(?<![\p{L}])(?:for me|my own (?:height|weight|measurements)|my height|my weight|i am(?=\s+\d)|i weigh(?=\s+\d)|для меня|мой рост|мой вес|у меня(?=\s+(?:рост|вес|\d))|ինձ համար|իմ հասակ\p{L}*|իմ քաշ\p{L}*|հասակս|քաշս)(?![\p{L}])/u;
const NOT_FACT=/(?<![\p{L}])(?:not|no|never|don't|isn't|wasn't|if|hypothetical\p{L}*|example|не|нет|если|допустим|ոչ|չեմ|չի|եթե|լիներ)(?![\p{L}])/u;
function otherSubject(t:string){return classifyScope(t).thirdPartyPossible||BATCH_OTHER_PERSON.test(t)||OTHER_SUBJECT.test(t);}
/** The last explicit conversational subject persists until an explicit switch back to the member. */
export function bmiMessageNumbers(raw:string,earlier:readonly string[]=[]):BmiNumbers{
 const t=normaliseText(raw).replaceAll('’',"'");
 let other=false;
 for(const message of [...earlier,raw]){
  const s=normaliseText(message).replaceAll('’',"'");
  if(otherSubject(s))other=true;
  else if(SELF_SUBJECT.test(s))other=false;
 }
 if(other||NOT_FACT.test(t))return {height:null,weight:null};
 // Multiple heights or weights in one message are ambiguous; exchanges still use bmiNumbers's correction handling.
 if(measurements(t,HEIGHT,HEIGHT_UNIT).length>1||measurements(t,WEIGHT,WEIGHT_UNIT).length>1)return {height:null,weight:null};
 return bmiNumbers(raw);
}

/** Every personal BMI assertion must agree; general adult references are not member facts. */
export function bmiReplyHasValue(reply:string,expected:string):boolean{
 const label=`(?:${BMI.source}|(?<![\\p{L}])(?:քզի|մզի)(?![\\p{L}]))`;
 const suffix='(?:[- ]?(?:ն|ը))?';
 // A parenthesised translation/abbreviation names the same assertion, not a second
 // value. Only known BMI labels are removed; unfamiliar wording stays fail closed.
 const t=normaliseText(reply).replace(/[*_`]/gu,'')
  .replace(new RegExp(`(${label}${suffix})\\s*\\(\\s*${label}${suffix}\\s*\\)`,'gu'),'$1')
  .replace(new RegExp(`\\(\\s*(${label}${suffix})\\s*\\)`,'gu'),'$1');
 // Captured ambiguous labels are not approved synonyms. Another correct assertion
 // cannot license them. A short label explicitly expanded as (BMI) is unambiguous.
 if(/(?<![\p{L}])(?:զզի|կմի|մարմնի զանգվածի ցուցիչ\p{L}*)(?![\p{L}])/u.test(t))return false;
 for(const m of t.matchAll(/(?<!մարմնի )(?<![\p{L}])զանգվածի ինդեքս\p{L}*(?![\p{L}])/gu)){
  if(!new RegExp(`^\\s+${label}${suffix}`,'u').test(t.slice(m.index!+m[0].length)))return false;
 }
 const join='\\s*(?:(?:for you|у вас)\\s*)?(?:(?:is|equals|составляет|равен|է)(?![\\p{L}])\\s*)?(?:(?:yours|of)(?![\\p{L}])\\s*)?(?:[:=՝]|[.,](?=\\s))?\\s*(?:[—–-]\\s+)?';
 // The model may put the source measurements between the label and its value.
 // Parse that small grammar, never scan past arbitrary prose/numbers to a later value.
 const measurement='[1-9]\\d*(?:[.,]\\d+)?';
 const ruMeasurement=`(?:рост[аеу]?\\s+${measurement}\\s*(?:см|м)|вес[аеу]?\\s+${measurement}\\s*кг)`;
 const ruSource=`\\s*,?\\s*(?:рассчитанный\\s+)?(?:по|при)\\s+(?:вашим данным\\s*[,:(]?\\s*)?${ruMeasurement}(?:\\s*(?:,|и)\\s*${ruMeasurement})?\\s*\\)?\\s*,?`;
 const hyMeasurement=`${measurement}\\s*(?:(?:սմ|մ)\\s+հասակով|կգ\\s+քաշով)`;
 const hySource=`\\s+${hyMeasurement}(?:\\s+եւ\\s+${hyMeasurement})?`;
 // Keep the complete numeric token, including malformed decimals/signs, so another correct
 // assertion cannot hide an invalid personal value. A trailing sentence mark is not a decimal.
 const number='([+−<>≤≥~≈-]?\\s*\\d[\\d.,]*)(?![\\p{L}\\d])';
 const labelledValue=new RegExp(`${label}${suffix}(?:${ruSource}|${hySource})?${join}${number}`,'gu');
 const personalPrefix=/(?<![\p{L}])(?:your(?:\s+own)?|you have(?:\s+a)?|у вас|ваш\p{L}*(?:\s+(?:личн\p{L}*|значение))*|по вашим данным|ձեր(?:\s+անձնական)?)\s*$/u;
 const personalContext=/(?<![\p{L}])(?:for you|у вас|для вас|по вашим данным|yours|ձեր համար)(?![\p{L}])/u;
 const personal: string[]=[];
 for(const sentence of t.split(/\.(?![\d.])|[!?։;\n]/u)){
  const assertions=[...sentence.matchAll(labelledValue)];
  // Visit every label, not just recognized personal prefixes. Unknown wording must
  // fail closed; a correct assertion elsewhere cannot license it.
  for(const m of sentence.matchAll(new RegExp(label,'gu'))){
   const assertion=assertions.find(a=>a.index===m.index);
   const before=sentence.slice(0,m.index),tail=sentence.slice(m.index!+m[0].length);
   const after=assertion?sentence.slice(assertion.index!+assertion[0].length):tail;
   // Do not borrow the subject of a later BMI assertion in the same clause.
   const localAfter=after.split(new RegExp(label,'u'))[0]!;
   const explicit=personalPrefix.test(before)||personalContext.test(assertion?.[0]??'')||personalContext.test(localAfter);
   // Only positive band/boundary grammar makes a reference general. An article
   // such as "a BMI of" alone says nothing about whose value it is.
   const general=assertion
    ? /^\s*(?:(?:or more|or above|to\s+\d|и выше|и более|[-–]\s*\d|-ից)|(?:is|является|это|է)\s+(?:one of\s+(?:the\s+)?(?:usual\s+)?(?:adult\s+)?boundaries|(?:the\s+)?(?:obesity\s+)?boundary|(?:a|an)\s+(?:adult\s+)?boundary|(?:одной\s+из\s+)?(?:обычн\p{L}*\s+)?границ\p{L}*|սահման\p{L}*))/u.test(after)||/^(?:[- ]?(?:ն|ը))?\s*(?:մեծահասակների\s+)?(?:սովորական\s+)?սահման/u.test(after)
    : /^\s*от\s+\d+(?:[.,]\d+)?\s+означает(?![\p{L}])/u.test(tail)
     ||/^\s*range\s+(?:is\s+)?\d+(?:[.,]\d+)?\s*(?:to|[-–])\s*\d+(?:[.,]\d+)?/u.test(tail)
     ||/^\s*для взрослых\s+от\s+\d+(?:[.,]\d+)?\s+до\s+\d+(?:[.,]\d+)?/u.test(tail)
     ||/^[- ]?ի\s+(?:սովորական\s+)?միջակայք\p{L}*\s+\d+(?:[.,]\d+)?-ից\s+\d+(?:[.,]\d+)?/u.test(tail);
   if(!explicit&&general)continue;
   if(!assertion)return false;
   personal.push(assertion[1]!);
  }
  // "Yours is ..." can refer back to BMI without repeating its label.
  if(BMI.test(t))for(const m of sentence.matchAll(new RegExp(`(?<![\\p{L}])yours${join}${number}`,'gu')))personal.push(m[1]!);
 }
 return personal.length>0&&personal.every(raw=>{
  const n=raw.trim().replace(/[.,]$/u,'');
  return /^[1-9]\d*(?:[.,]\d+)?$/u.test(n)&&Number(n.replace(',','.'))===Number(expected.replace(',','.'));
 });
}

// STAGING wording pending Armen and Yesayi. General adult information only, never a diagnosis, target or advice.
const MISSING:Record<ReplyLanguage,{both:string;height:string;weight:string}>={
 en:{both:'What are your height (for example, 172 cm) and weight (for example, 80 kg)?',height:'What is your height (for example, 172 cm)?',weight:'What is your weight (for example, 80 kg)?'},
 hy:{both:'Որքա՞ն են ձեր հասակը (օրինակ՝ 172 սմ) և քաշը (օրինակ՝ 80 կգ)։',height:'Որքա՞ն է ձեր հասակը (օրինակ՝ 172 սմ)։',weight:'Որքա՞ն է ձեր քաշը (օրինակ՝ 80 կգ)։'},
 ru:{both:'Какой у вас рост (например, 172 см) и вес (например, 80 кг)?',height:'Какой у вас рост (например, 172 см)?',weight:'Какой у вас вес (например, 80 кг)?'},
};
export function pendingBmi(previousZoe:string|null|undefined):boolean{
 const last=previousZoe?.trim().split(/\n+/u).at(-1);
 return Object.values(MISSING).some(lines=>Object.values(lines).some(line=>line===last));
}
export function bmiReply(l:ReplyLanguage,n:BmiNumbers):string{
 if(n.height===null||n.weight===null)return MISSING[l][n.height===null?(n.weight===null?'both':'height'):'weight'];
 const result=bmi({'q2.height':{fieldId:'q2.height',value:n.height,source:'manual',answeredAt:''},'q2.weight':{fieldId:'q2.weight',value:n.weight,source:'manual',answeredAt:''}})!.toFixed(1);
 const range=`${THRESHOLD.usualAdultBmiMin}–${THRESHOLD.usualAdultBmiMax}`;
 if(l==='hy')return `Ձեր BMI-ն ${result} է՝ ${n.height} սմ հասակի և ${n.weight} կգ քաշի հիման վրա։ Որպես ընդհանուր տեղեկություն՝ մեծահասակների սովորական միջակայքը ${range} է։ Ձեր բժիշկը կարող է ձեզ հետ քննարկել, թե դա ինչ է նշանակում ձեզ համար։`;
 if(l==='ru')return `Ваш ИМТ ${result}, исходя из роста ${n.height} см и веса ${n.weight} кг. Для общей информации: обычный диапазон для взрослых ${range}. Ваш врач может обсудить с вами, что это означает для вас.`;
 return `Your BMI is ${result}, using your height of ${n.height} cm and weight of ${n.weight} kg. As general information, the usual adult range is ${range}. Your doctor can go through what this means for you.`;
}
