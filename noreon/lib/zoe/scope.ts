import {hasHiddenCharacters,normaliseText} from './normalise';
import type {ReplyLanguage} from './provider';

/**
 * Deterministic input guards before any provider call (ZOE_DESIGN §2: G3 language, G5
 * injection and abuse, plus the scope classifier and the long-message rule). Pure. The
 * word lists are engineering patterns, not clinical content, and are versioned.
 */
export const SCOPE_VERSION='zoe-scope-10';
export type ZoeLanguage='en'|'hy'|'hy-Latn'|'ru'|'mixed'|'other';
export type ScopeClass='in'|'out'|'abuse';
export type ScopeResult={language:ZoeLanguage;replyLanguage:ReplyLanguage|null;scope:ScopeClass;offScopeTopic:string|null;injection:boolean;readInFull:'long'|'pasted_document'|null;thirdPartyPossible:boolean};

/** Over this many characters a message is never sent to a model (O06): the doctor reads it in full. */
export const MODEL_INPUT_MAX_CHARS=4000;

// Common Latin-letter Armenian words; two or more hits mark a Latin-script message as HY-Latn. Second line (30 Oct, Khikar's chat):
// everyday words he typed that were missing, so "curt a esor londonum?" read as English.
const HY_LATN=/^(?:barev|bari|enq|eq|unem|chem|chunem|cavum|cav|glux\w*|gluxs|glukh\w*|sirt\w*|krts\w*|karox|karogh|aysor|vaxe|vaghe|hima|shat|ari|inch|incha|vonc|voch|ayo|dex(?:[aeiy]\w{0,5})?|hab|chxmem|ches|chi|xndrum|merci|shnorhakal\w*|tenc|vat|em|es|bayc|chen|chka|zangel\w*|zangec\w*|kanchel\w*|galis|ekav|ekel|lav|shtap\w*|ognutyun\w*|hivandanoc\w*|ushagnac\w*|tatik\w*|papik\w*|uzum|aveli|himan|ancnum|esor|aystor|hajox|hajogh|tesutyun|vor|kam|vaxy|vaghy|erek|curt|cuyc|ktas|tur|tes|asa|asum|nuyn|arden|chnshum\w*|chapum\w*|bjshk\w*|grancir|grancel\w*|grances|heriq|krtq\w*|shnch\w*|haskacanq|haskanum|ujegh|tuyl|mnacel|tarel|kara|karum|gnam|gnum|utum|xmum|xmel|mek|erku)$/u;

const INJECTION=[
 /\b(ignore|disregard|forget|override)\b.{0,30}\b(instructions?|rules?|prompt|guidelines|previous|above)\b/u,
 /(^|\n)\s*(system|assistant|developer)\s*:/u,
 /\b(print|reveal|show|repeat|tell me)\b.{0,20}\b(system )?(prompt|instructions)\b/u,
 /\byou are now\b|\bact as\b|\bpretend to be\b|\bwrite as (her|him|dr)/u,
 /\bsend (your|the) (answer|reply) to\b/u,
 /մոռացիր.{0,20}կանոն|անտեսիր.{0,20}(կանոն|հրահանգ)/u,
 /<\/?\s*(message|doctor_reply|member_messages|system|assistant)\b/u,
 /игнорируй|забудь.{0,20}(правил|инструкц)/u,
 /[a-z0-9+/]{48,}={0,2}/iu,
 // Warm replies (Khikar 18 Oct: "lots of guards to protect from prompt hacking"): role-play, jailbreak
 // modes, prompt extraction, new instructions, markdown links, code and HTML, in EN, HY and RU.
 /\b(jailbreak|dan mode|developer mode|god mode|admin mode|debug mode|unrestricted mode|no restrictions|without (any )?restrictions|sudo)\b/u,
 /\b(pretend|imagine|role ?-?play|let'?s play|play the role|stay in character)\b.{0,40}\b(doctor|physician|nurse|cardiologist|pharmacist|system|developer|human|grandma|grandmother|character)\b/u,
 /\byou are (a|my|the|an) (doctor|physician|nurse|cardiologist|pharmacist|human|unrestricted)\b|\byou'?re (a|my|the) (doctor|physician|nurse|pharmacist)\b/u,
 /\bsystem prompt\b|\b(your|the) (initial|hidden|original|secret) (prompt|instructions|rules)\b|\byour (instructions|prompt|rules|guidelines|programming|configuration)\b/u,
 /\b(new|updated|real|actual) (instructions|rules|system message)\b|\bfrom now on\b.{0,40}\b(you|answer|reply|respond|act|ignore)\b/u,
 /\b(repeat|print|output|echo|translate|summari[sz]e)\b.{0,30}\b(everything|all|the text|words) (above|before|you were (given|told))\b/u,
 /\b(answer|reply|respond|write) (only )?in (base64|hex|binary|rot13|morse|code|json)\b/u,
 /\[[^\]]{1,120}\]\((https?:|www\.)|```|<\s*\/?\s*[a-z][a-z0-9]*(\s[^>]*)?>/u,
 // Codex review F2: personas, voices, stories and translations used to fish for doses or advice.
 /\b(assume|take on|play|adopt) the (role|persona|identity|part)\b|\b(in|with) (the|my|a) (doctor|physician|nurse)'?s? voice\b|\b(as|like) (a|my|your) (doctor|physician|nurse|pharmacist|medical professional) would\b/u,
 /\b(pretend|imagine|role ?-?play)\b.{0,40}\b(medical|professional|specialist|expert|clinician)\b/u,
 /\btranslate\b.{0,40}\b(sentence|this|following|text|into|to (armenian|russian|english))\b/u,
 /\b(write|tell|make up|create|compose)\b.{0,15}\b(story|poem|song|script|dialogue|fairy tale)\b/u,
 /դու (?:իմ )?(?:բժիշկ|բուժքույր|դեղագործ)|(?:բժշկի|բժիշկի) դերում|պատմություն գրիր/u,
 /в роли|выступи(те)? в|роль (врача|доктора|медсестры)|сочини|напиши (рассказ|историю|стих)|переведи/u,
 /ձևացրու|ձեւացրու|ձևացիր|ձեւացիր|պատկերացրու,? որ դու|դու հիմա|հիմա դու|քո (հրահանգ|կանոն|համակարգային)|համակարգային (հուշում|հրահանգ)|առանց սահմանափակ/u,
 /притворись|представь,? что ты|ты теперь|теперь ты|сыграй роль|режим разработчика|системн\p{L}* (промпт|подсказк|инструкц|сообщени)|твои (инструкции|правила)|покажи (свои |твои )?(инструкции|промпт|правила)|без ограничений|новые инструкции/u,
];
const ABUSE=[/\b(idiot|stupid|moron|useless|incompetent|shut up|fuck\w*|bitch|bastard)\b/u,/\b(sexy|nude|naked|sex with|send (me )?(nudes|photos of you))\b/u,/(հիմար|ապուշ|դեբիլ)/u,/(идиот|дура|тупой|сука)/u];
const OFF_SCOPE:[string,RegExp][]=[
 ['weather',/\bweather\b|եղանակ|погод/u],
 ['price',/\b(price|cost|how much|fee|payment|refund)\b|արժե|գին|վճար|сколько стоит|цен[аы]/u],
 ['insurance',/\binsurance\b|ապահովագր|страхов/u],
 ['legal',/\b(lawyer|legal|lawsuit|court)\b|փաստաբան|адвокат/u],
 ['referral',/\brecommend (a|an|some)\b.{0,20}\b(doctor|cardiologist|specialist|clinic)\b/u],
 ['other_person_record',/\b(my (wife|husband|mother|father|son|daughter)'?s (results|record|file))\b/u],
];
const THIRD_PARTY=/\b(my (mother|mom|father|dad|wife|husband|son|daughter|brother|sister|friend|neighbou?r)|he has|she has)\b|մայրս|հայրս|կինս|ամուսինս|моя мама|мой отец|моя жена|мой муж/u;

// English words that a Latin-letter Armenian message would not have. "a" is not one: it is the everyday Armenian "is" ("gluxs cavum a").
const EN_STRONG=/^(?:the|an|is|are|am|i|my|me|you|your|it|to|of|and|or|in|on|at|for|with|what|when|where|how|why|who|do|does|did|can|have|has|had|not|no|yes|hi|hello|thanks|thank|please|ok|okay|bye|doctor|visit|pain|feel)$/u;
// The Armenian present ending ("sxmum", "londonum"), when it is not an English word or the name of an element or a salt (Astra ZC-02: "selenium").
const HY_LATN_UM=/^[a-z]{2,}um$/u,EN_UM=/^(?:album|museum|minimum|maximum|forum|serum|gum|sum|drum|vacuum|aluminum|plum|rum|[a-z]+ium)$/u;
const latinWords=(raw:string):string[]=>raw.toLowerCase().match(/[a-z]+/gu)??[];
const hyLatnWord=(w:string)=>HY_LATN.test(w)||HY_LATN_UM.test(w)&&!EN_UM.test(w);
/** Whether Latin text has at least one everyday Armenian word (the bare "a" is read by it). */
export const hasLatinArmenianWord=(raw:string)=>latinWords(raw).some(hyLatnWord);
/** Two list words, as before; or, with no English word in the message, a list word and one more of a list word, the -um ending or the bare "a". */
export const readsLatinArmenian=(text:string)=>{const w=latinWords(text);
 if(w.filter(x=>HY_LATN.test(x)).length>=2)return true;
 return !w.some(x=>EN_STRONG.test(x))&&w.some(x=>HY_LATN.test(x))&&w.filter(hyLatnWord).length+(w.includes('a')?1:0)>=2;};

type LanguageContext={previous?:ReplyLanguage|null;locale?:ReplyLanguage|null};
function language(raw:string,context:LanguageContext):{language:ZoeLanguage;replyLanguage:ReplyLanguage|null}{
 let hy=0,ru=0,en=0;
 // Product and service names are Latin in every language («Ինչպես միացնեմ Telegram-ը» is Armenian, not mixed;
 // 74-scenario run 19 Oct: the mixed route went a tier up and lost the direct answer).
 const stripped=raw.replace(/(?<![\p{L}\p{N}])(?:telegram|noreon|zoe|whatsapp|viber|app|sms|pdf|qr|ok)(?![\p{L}\p{N}])/giu,' ');
 // A message that is only a product name keeps its own letters ("Telegram?" is English).
 const text=/[\p{L}]/u.test(stripped)?stripped:raw;
 for(const ch of text){if(/\p{Script=Armenian}/u.test(ch))hy++;else if(/\p{Script=Cyrillic}/u.test(ch))ru++;else if(/\p{Script=Latin}/u.test(ch))en++;}
 const total=hy+ru+en;
 if(!total)return {language:'other',replyLanguage:null};
 const share=(n:number)=>n/total;
 // A mixed message is read in its main language (Khikar, 4 Nov, Astra LANG-02): the script with the most letters, except that Latin letters which read as Armenian
 // typed in Latin ("ays, Yerevanum kayne ինչ kaxm e aystor?") stay Armenian. A tie goes to Armenian.
 if(share(hy)>=0.2&&(share(ru)>=0.2||share(en)>=0.2))return {language:'mixed',replyLanguage:ru>hy&&ru>=en?'ru':en>hy&&en>ru&&!readsLatinArmenian(text)?'en':'hy'};
 if(share(hy)>=0.6)return {language:'hy',replyLanguage:'hy'};
  // Russian: Zoe replies in Russian (staging AI mode, 17 Oct); health stays a doctor draft as in every language.
 if(share(ru)>=0.6)return {language:'ru',replyLanguage:'ru'};
 // Any Armenian letter in a mostly Latin message: Armenian, typed with what was at hand ("ays, Yerevanum kayne ինչ kaxm e aystor?").
 if(share(en)>=0.6)return hy>0||readsLatinArmenian(text)?{language:'hy-Latn',replyLanguage:'hy'}:{language:'en',replyLanguage:'en'};
 const most=Math.max(hy,ru,en);
 const tied=([['hy',hy],['ru',ru],['en',en]] as const).filter(([,n])=>n===most).map(([l])=>l);
 return {language:'mixed',replyLanguage:tied.length===1?tied[0]!:context.previous??context.locale??'hy'};
}

// An explicit request for a language (Armen 539 point 6).
const ASK_LANGUAGE:[ReplyLanguage,RegExp][]=[
 ['en',/(?<![\p{L}])(?:(?:in|to) english|english please|speak english|по-английски|на английском|անգլերեն(?:ով)? (?:գրեք|խոսեք|պատասխանեք|խնդրում եմ))(?![\p{L}])/iu],
 ['ru',/(?<![\p{L}])(?:(?:in|to) russian|russian please|speak russian|по-русски|на русском|ռուսերեն(?:ով)? (?:գրեք|խոսեք|պատասխանեք|խնդրում եմ))(?![\p{L}])/iu],
 ['hy',/(?<![\p{L}])(?:(?:in|to) armenian|armenian please|speak armenian|по-армянски|на армянском|հայերեն(?:ով)? (?:գրեք|խոսեք|պատասխանեք|խնդրում եմ)|hayeren)(?![\p{L}])/iu],
];
/** The language the member explicitly asks for, or null. Asking what a word means in English is not asking for English: the verb list is in the pattern. */
export const requestedLanguage=(raw:string):ReplyLanguage|null=>{
 const t=normaliseText(raw);if(t.split(/\s+/u).length>12)return null;
 const asks=/(?<![\p{L}])(?:reply|answer|write|speak|talk|respond|switch|continue|please|can you|could you|ответ\p{L}*|пиш\p{L}*|напиш\p{L}*|говор\p{L}*|перейд\p{L}*|пожалуйста|можно|давайте|գրեք|խոսեք|պատասխանեք|խնդրում)(?![\p{L}])/iu.test(t);
 return asks?ASK_LANGUAGE.find(([,re])=>re.test(t))?.[0]??null:null;};
const words=(t:string)=>(t.match(/[\p{L}\p{N}]+/gu)??[]).length;
const letterWords=(t:string)=>t.toLowerCase().match(/\p{L}+/gu)??[];
// Words that are only an acknowledgement: they say nothing about the language the member is writing in.
const ACK_WORDS=new Set(['ok','okay','k','kk','thanks','thank','thx','ty','you','yes','yeah','yep','no','nope','hi','hello','hey','bye','sure','please','good','great','fine','cool','noted','understood','got','it','alright','spasibo']);
/** A short Latin-letter message with no language of its own: one word, an acknowledgement, or a measurement with a unit ("weight 80 kg"). "Tea please" is a request and is not one. */
const languageless=(t:string)=>{const w=letterWords(t);return w.length<=1||w.every(x=>ACK_WORDS.has(x))||/\p{N}/u.test(t)&&w.length<3;};
/**
 * Zoe answers in the language of the member's latest message (Khikar, 4 Nov: the two-message rule of Armen 539 point 6 is gone). Nothing earlier in the
 * conversation holds the language, so an English blood pressure message followed by an Armenian question gets an Armenian answer. Two things only:
 * an explicit request for a language still wins, and a Latin-letter message with no language of its own ("ok", "thanks", "tea?", "weight 80 kg") keeps
 * that of Zoe's newest answer (`previous`) when there is one. Armenian or Russian letters always count.
 * A mixed message is read by `language()` above (its main language). A 103 or crisis text follows the same policy (pipeline.ts urgentLang).
 */
export function replyLanguageOf(latest:string,detected:ReplyLanguage,previous:ReplyLanguage|null|undefined):ReplyLanguage{
 const asked=requestedLanguage(latest);if(asked)return asked;
 const latinOnly=!/[\p{Script=Armenian}\p{Script=Cyrillic}]/u.test(latest);
 return previous&&detected==='en'&&latinOnly&&languageless(latest)?previous:detected;
}

function pasted(raw:string){
 const lines=raw.split(/\r?\n/).filter(l=>l.trim());
 if(lines.length<8)return false;
 const tabular=lines.filter(l=>/\t|\s{3,}|\|/.test(l)||(l.match(/\d+(?:[.,]\d+)?/g)?.length??0)>=2).length;
 return tabular/lines.length>=0.6;
}

/** Classifies the newest member text (with earlier window messages for language when needed). */
export function classifyScope(raw:string,context:LanguageContext={}):ScopeResult{
 const t=normaliseText(raw);
 const lang=language(raw,context);
 const injection=hasHiddenCharacters(raw)||INJECTION.some(re=>re.test(t));
 const abuse=ABUSE.some(re=>re.test(t));
 const topic=OFF_SCOPE.find(([,re])=>re.test(t))?.[0]??null;
 return {...lang,scope:abuse?'abuse':topic?'out':'in',offScopeTopic:abuse?null:topic,injection,
  readInFull:raw.length>MODEL_INPUT_MAX_CHARS?'long':pasted(raw)?'pasted_document':null,thirdPartyPossible:THIRD_PARTY.test(t)};
}
