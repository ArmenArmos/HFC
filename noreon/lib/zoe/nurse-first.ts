import {nurseChatEnabled} from '@/lib/nurse-chat/config';
import {normaliseText} from './normalise';
import {denied,textRedFlags} from './symptoms/red-flags';

/**
 * Armen 2 Nov, item 13, and Monika's message 564 (STAGING: needs Armen and Yesayi's sign-off): a Zoe forward about a mild side effect
 * goes to the assigned nurse first. The doctor keeps every view they have today; the database adds a task to the nurse's Today
 * (migration zoe_nurse_first), and with no assigned nurse or the nurse chat off nothing changes. Anything in doubt stays with the doctor.
 */
export const NURSE_FIRST_VERSION='zoe-nurse-first-1';
export const MILD_SIDE_EFFECT_REASON='mild_side_effect';

const word=(body:string)=>new RegExp(`(?<![\\p{L}])(?:${body})`,'gu');
const whole=(body:string)=>new RegExp(`(?<![\\p{L}])(?:${body})(?![\\p{L}])`,'gu');
// Astra on #527: an exclusion list cannot be complete, so this fails safe. Nausea, dizziness and headache count only with an explicit mild word;
// all six count only when nothing else in the message is a symptom, a body word or a colour. Anything else stays with the doctor.
const NEEDS_MILD_WORD=word([
 'nausea|nauseous|queasy|dizz\\p{L}*|light-?headed|headaches?',
 'тошн\\p{L}*|подташнив\\p{L}*|головокруж\\p{L}*|(?:кружится|кружилась) голова|голова (?:кружится|кружилась|болит|побаливает)|головн\\p{L}* бол\\p{L}*|болит голова',
 'սրտխառն\\p{L}*|գլխապտույտ\\p{L}*|գլուխս պտտվ\\p{L}*|գլխացավ\\p{L}*|գլուխս ցավ\\p{L}*',
 'srtkharn\\p{L}*|srtxarn\\p{L}*|glxaptuyt\\p{L}*|glkhaptuyt\\p{L}*|glxacav\\p{L}*|glkhatsav\\p{L}*',
].join('|'));
const ON_ITS_OWN=word([
 'dry cough\\p{L}*|frequent urination|(?:urinat|pee)\\p{L}* (?:\\p{L}+ )?(?:often|frequently|a lot|more)',
 'ankles? (?:\\p{L}+ )?(?:swell\\p{L}*|swollen|puffy)|(?:swollen|puffy|swelling (?:in|of) (?:my |the |both )?) ?ankles?',
 'сух\\p{L}* каш\\p{L}*|каш\\p{L}* сух\\p{L}*|часто\\p{L}* мочеиспускан\\p{L}*|часто (?:мочусь|хожу в туалет|бегаю в туалет)',
 '(?:отек\\p{L}*|отёк\\p{L}*|отекают|опух\\p{L}*) (?:\\p{L}+ )?(?:лодыж\\p{L}*|щиколот\\p{L}*)|(?:лодыж\\p{L}*|щиколот\\p{L}*) (?:\\p{L}+ )?(?:отек\\p{L}*|отёк\\p{L}*|опух\\p{L}*)',
 'չոր հազ\\p{L}*|հաճախամիզ\\p{L}*|հաճախ (?:եմ )?միզ\\p{L}*|կոճ\\p{L}* (?:\\p{L}+ )?(?:ուռ\\p{L}*|այտուց\\p{L}*)',
 'chor haz\\p{L}*|hachax (?:em )?miz\\p{L}*|hachakh (?:em )?miz\\p{L}*|koch\\p{L}* (?:\\p{L}+ )?(?:urr\\p{L}*|ur\\p{L}*|aytuc\\p{L}*)',
].join('|'));
const MILD_WORD=whole('mild|mildly|slight|slightly|a little|немного|слегка|թեթև\\p{L}*|թեթեւ\\p{L}*|tetev\\p{L}*');
const OTHER=whole([
 'pain\\p{L}*|ache\\p{L}*|aching|hurt\\p{L}*|sore|swell\\p{L}*|swollen|itch\\p{L}*|burn\\p{L}*|cough\\p{L}*|tired|fatigue|sleepy|sweat\\p{L}*|chills|diarrh\\p{L}*|constipat\\p{L}*',
 'stomach|belly|abdomen|head|eyes?|ears?|throat|mouth|lips?|tongue|face|neck|back|arms?|hands?|legs?|foot|feet|knees?|kidneys?|liver|heart|lungs?|skin|urine|pee|stools?|poop',
 'red|pink|brown|black|yellow|dark|orange|green|blue|white',
 'бол\\p{L}*|отек\\p{L}*|отёк\\p{L}*|опух\\p{L}*|зуд\\p{L}*|жжени\\p{L}*|жжет|жжёт|каш\\p{L}*|устал\\p{L}*|сонлив\\p{L}*|потею|озноб\\p{L}*|понос\\p{L}*|запор\\p{L}*',
 'живот\\p{L}*|желуд\\p{L}*|голов\\p{L}*|глаз\\p{L}*|уш\\p{L}*|горл\\p{L}*|рот|рта|губ\\p{L}*|язык\\p{L}*|лиц\\p{L}*|ше[яиюе]|спин\\p{L}*|рук\\p{L}*|ног\\p{L}*|колен\\p{L}*|почк\\p{L}*|печен\\p{L}*|легк\\p{L}*|лёгк\\p{L}*|кож\\p{L}*|моч\\p{L}*|стул\\p{L}*',
 'красн\\p{L}*|розов\\p{L}*|бур\\p{L}*|коричнев\\p{L}*|черн\\p{L}*|чёрн\\p{L}*|жёлт\\p{L}*|желт\\p{L}*|темн\\p{L}*|тёмн\\p{L}*|зелен\\p{L}*|зелён\\p{L}*|син\\p{L}*|бел\\p{L}*',
 'ցավ\\p{L}*|ուռ\\p{L}*|այտուց\\p{L}*|քոր\\p{L}*|այր\\p{L}*|հազ\\p{L}*|հոգն\\p{L}*|քրտն\\p{L}*|լուծ\\p{L}*|փոր\\p{L}*|ստամոքս\\p{L}*|գլուխ\\p{L}*|գլխ\\p{L}*|աչք\\p{L}*|ականջ\\p{L}*|կոկորդ\\p{L}*|բերան\\p{L}*|շրթ\\p{L}*|լեզու\\p{L}*|դեմք\\p{L}*|վիզ\\p{L}*|մեջք\\p{L}*|ձեռք\\p{L}*|ոտ\\p{L}*|ծունկ\\p{L}*|երիկամ\\p{L}*|լյարդ\\p{L}*|սիրտ\\p{L}*|սրտ\\p{L}*|թոք\\p{L}*|մաշկ\\p{L}*|մեզ\\p{L}*|կղանք\\p{L}*',
 'կարմիր\\p{L}*|վարդագույն\\p{L}*|շագանակագույն\\p{L}*|սև\\p{L}*|սեւ\\p{L}*|դեղին\\p{L}*|մուգ\\p{L}*|նարնջագույն\\p{L}*|կանաչ\\p{L}*|կապույտ\\p{L}*|սպիտակ\\p{L}*',
 'cav\\p{L}*|urr\\p{L}*|aytuc\\p{L}*|qor\\p{L}*|haz\\p{L}*|hognac\\p{L}*|qrtn\\p{L}*|por\\p{L}*|stamoqs\\p{L}*|glux\\p{L}*|glukh\\p{L}*|achq\\p{L}*|akanj\\p{L}*|kokord\\p{L}*|beran\\p{L}*|shrt\\p{L}*|demq\\p{L}*|viz\\p{L}*|mejq\\p{L}*|dzerq\\p{L}*|otq\\p{L}*|otk\\p{L}*|votq\\p{L}*|erikam\\p{L}*|lyard\\p{L}*|sirt\\p{L}*|srt\\p{L}*|toq\\p{L}*|mashk\\p{L}*|mez\\p{L}*',
 'karmir\\p{L}*|sev\\p{L}*|dexin\\p{L}*|deghin\\p{L}*|mug\\p{L}*|kanach\\p{L}*|kapuyt\\p{L}*|spitak\\p{L}*',
].join('|'));
// Severity, and effects that are severe, systemic or high-risk: statin muscle pain and blood in the urine by name (Armen, Monika).
const SERIOUS=word([
 'severe|bad|worse|worst|terrible|awful|unbearable|excruciating|stronger|red urine|urine (?:\\p{L}+ )?red|strong|intense|extreme|very|sudden\\p{L}*|faint\\p{L}*|pass(?:ed|ing)? out|black(?:ed)? out|collaps\\p{L}*|fell(?! asleep)|falls?(?! asleep)|fallen',
 'blood\\p{L}*|bleed\\p{L}*|hematuria|haematuria|dark urine|black stools?|jaundice|yellow (?:skin|eyes)|rash\\p{L}*|hives|swollen (?:lips?|face|tongue|throat)|lips? (?:\\p{L}+ )?swollen',
 'chest|breath\\p{L}*|short of breath|palpitation\\p{L}*|confus\\p{L}*|blurr\\p{L}*|vision|numb\\p{L}*|weak\\p{L}*|vomit\\p{L}*|threw up|throwing up|fever|muscle\\p{L}*|myalgia|cramp\\p{L}*',
 'сильн\\p{L}*|ужасн\\p{L}*|невыносим\\p{L}*|нестерпим\\p{L}*|красн\\p{L}* моч\\p{L}*|моч\\p{L}* красн\\p{L}*|сознани\\p{L}*|резк\\p{L}*|внезапн\\p{L}*|очень|хуже|обморок\\p{L}*|обмороч\\p{L}*|потерял\\p{L}* сознани\\p{L}*|упал\\p{L}*|падени\\p{L}*|падаю',
 'кров\\p{L}*|гематури\\p{L}*|темн\\p{L}* моч\\p{L}*|тёмн\\p{L}* моч\\p{L}*|желтух\\p{L}*|пожелт\\p{L}*|сып\\p{L}*|крапивниц\\p{L}*|груд\\p{L}*|одышк\\p{L}*|задыха\\p{L}*|серд\\p{L}*|спутан\\p{L}*|зрени\\p{L}*|онем\\p{L}*|слабост\\p{L}*|рвот\\p{L}*|рвет|рвёт|температур\\p{L}*|мышц\\p{L}*|мышеч\\p{L}*|судорог\\p{L}*',
 'ուժեղ\\p{L}*|սաստիկ\\p{L}*|անտանելի|ուշաթափ\\p{L}*|կարմիր մեզ\\p{L}*|մեզ\\p{L}* կարմիր\\p{L}*|շատ|հանկարծ\\p{L}*|վատացել\\p{L}*|ուշագնաց\\p{L}*|ուշքս\\p{L}*|ընկ[ա-ֆ]{1,6}|արյուն\\p{L}*|արնահոս\\p{L}*|դեղնել\\p{L}*|դեղնախտ\\p{L}*|ցան(?![\\p{L}])|ցաներ\\p{L}*|կրծք\\p{L}*|շնչ\\p{L}*|սրտխփ\\p{L}*|թմր\\p{L}*|տեսողությ\\p{L}*|թուլ\\p{L}*|փսխ\\p{L}*|ջերմ\\p{L}*|մկան\\p{L}*|մկնաց\\p{L}*|ջղաձգ\\p{L}*',
 'uzhex|ujex|sastik|shat|ancanel\\p{L}*|antanel\\p{L}*|ushatap\\p{L}*|karmir mez\\p{L}*|mez\\p{L}* karmir\\p{L}*|hankarc\\p{L}*|ushagnac\\p{L}*|ynka\\p{L}*|enka\\p{L}*|aryun\\p{L}*|arun\\p{L}*|deghn\\p{L}*|dexn\\p{L}*|krcq\\p{L}*|krtq\\p{L}*|shnch\\p{L}*|srtxp\\p{L}*|srtkhp\\p{L}*|tesoxut\\p{L}*|tul\\p{L}*|pskh\\p{L}*|psx\\p{L}*|jerm\\p{L}*|mkan\\p{L}*|mknac\\p{L}*',
].join('|'));

const said=(t:string,re:RegExp)=>[...t.matchAll(re)].some(m=>!denied(t,m.index,m.index+m[0].length));
const named=(re:RegExp,text:string)=>said(normaliseText(text),re);
const without=(t:string,...res:RegExp[])=>res.reduce((x,re)=>x.replace(re,' '),t);
/** One of the six, said as the rule says it, and nothing else about the body in the message. */
export function namesMildSideEffect(text:string){
 const t=normaliseText(text),needs=said(t,NEEDS_MILD_WORD);
 if(!needs&&!said(t,ON_ITS_OWN))return false;
 if(needs&&!said(t,MILD_WORD))return false;
 return !said(without(t,NEEDS_MILD_WORD,ON_ITS_OWN,MILD_WORD),OTHER);
}
export const namesSeriousEffect=(text:string)=>named(SERIOUS,text);
const flagOn=(env:Readonly<Record<string,string|undefined>>)=>env.NOREON_NURSE_CHAT_V2==='true'&&nurseChatEnabled(env);

/** Below same-day, Zoe's own automatic side-effect forward, every symptom message unanswered fits the rule, and nothing keeps it with the doctor. */
export function nurseFirst(i:{forward:string;reason:string;urgency:string;declined:boolean;sameDayMatter:boolean;newTexts:readonly string[];texts:readonly string[];env:Readonly<Record<string,string|undefined>>}){
 if(!flagOn(i.env)||i.forward!=='auto'||i.reason!=='serious_side_effect'||i.declined||i.sameDayMatter)return false;
 if(!['none','self_monitoring','planned','doctor_soon'].includes(i.urgency))return false;
 if(!i.newTexts.some(namesMildSideEffect)||i.newTexts.some(x=>!namesMildSideEffect(x)&&(named(NEEDS_MILD_WORD,x)||named(ON_ITS_OWN,x)||named(OTHER,x)))||i.texts.some(namesSeriousEffect))return false;
 return textRedFlags(i.texts,{intakeActive:false,latestReading:null}).length===0;
}
