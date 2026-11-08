import {normaliseText} from '../normalise';

/**
 * Closed vocabulary for Zoe's intake turns (Fable follow-up B1; lead decision 18 Oct). A blocklist of
 * phrases cannot cover a language, so every content word Zoe writes must come from:
 *  - the sheet's own question texts (all three languages),
 *  - the member's own messages in the window (medicine words excepted),
 *  - a fixed acknowledgement vocabulary (below), or the function words of the language.
 * Anything else ("panadol", "fluids", "stroke", "fine", "hospital", «цитрамона», «հիվանդանոց») sends
 * the sheet's own wording instead. Natural phrasing stays possible inside that vocabulary.
 * Sheet and member words also match their inflected forms (shared start of at least 4 letters, at
 * most 2 letters apart in length from the shorter word); acknowledgement and function words match only
 * as listed. Versioned with the output guard.
 *
 * Since Zoe redesign PR2 (#296) this no longer gates member text (the reply check does); the stand-in judge
 * (lib/zoe/stand-in-judge.ts) and the care plan draft guard still use it.
 */
export const VOCABULARY_VERSION='zoe-intake-vocabulary-3';

const words=(s:string)=>s.split(/\s+/u).filter(Boolean);

// Function words. Deliberately missing: judgement words (fine, good, ok, well, better, normal, safe,
// хорошо, лучше, нормально, можно, нельзя, լավ, նորմալ), "already" (արդեն, уже) and "help".
const FUNCTION=new Set(words(`
a an the and or but if so as at by for from in into of on onto to up with about after before over under than then there here this that these those it its it's
i i'm i've i'd i'll me my mine we us our you you're you've your yours he she they them their his her
am is are was were be been being do does did done have has had having will would shall should can could may might must
not no yes also just still even only very too more most some any all each other another such what which who whom whose when where why how
let's let one two both either neither now today yet again ever own same
don doesn didn isn aren wasn weren haven hasn hadn won wouldn shouldn couldn can't don't doesn't didn't isn't aren't wasn't haven't hasn't won't
ու և եւ որ այն այս դա սա ես դուք ձեր ձեզ մեր իր նրա նրանք է են էր էին եմ եք ենք էիք մի թե կամ բայց իսկ էլ նաև նաեւ ոչ չէ այո որը
ինչ ինչն ինչպես ինչպիսի երբ երբվանից որտեղ որ որքան ով հետ համար մասին վրա մեջ տակ մոտ պես արդյոք ապա դեռ հիմա ամեն բոլոր այստեղ այնտեղ կա կան կամ
и в во не что он на я с со как а то все она так его но да ты к у же вы за бы по только ее её мне было вот от меня ещё еще нет о из ему когда даже ну ли если или ни
быть был была были него до вас там потом себя ей они тут где есть ней для мы их чем сам без чего раз тоже себе под будет ж тогда кто этот того потому этого какой
какая какие какое каком ним здесь этом один мой тем чтобы нее сейчас куда всех при два об хоть после над тот через эти нас про всего них эту моя этой перед том им
ваш ваша ваше ваши вашим вашей вашего вашу это эта сколько насколько ли
`));

// What Zoe may say beyond the sheet: thanks, understanding, sorry, the doctor looking at the answers,
// asking the next question. Exact forms only.
const ACK=new Set(words(`
thank thanks thanking understand understood noted note sorry hear hearing doctor doctor's answers answer answering look next question questions tell telling told please kindly
share sharing wrote writing written know ask asking few short let me also another see saw
notice noticed noticing feel feels feeling felt happen happens happened happening start started starting since long often describe mean sure anything else something
around about roughly exactly part where when which kind sort
pain pains ache aches discomfort symptom symptoms sensation
շնորհակալություն շնորհակալ հասկանում հասկացա հասկանալի նշեցի նշում ցավում բժիշկ բժիշկը բժշկին բժշկի պատասխան պատասխանը պատասխանները պատասխանել պատասխանեք
հաջորդ հաջորդը հարց հարցը հարցեր հարցերը ասեք ասել խնդրում կարող կարողեք պատմեք պատմել գրեցիք իմանալ կնայի նայի նայել տամ կտամ
ցավ ցավը ցավի ցավերը ախտանիշ ախտանիշը ախտանիշները զգացողություն նկատել նկատել եք նկատեցիք զգում զգացել զգացիք զգում եք սկսվել սկսվեց տևում տևել նկարագրեք ուրիշ այլ մոտավորապես մասում մասը
спасибо благодарю понимаю поняла понял понятно отметила записала жаль сожалению врач врачу врача доктор доктору ответы ответ ответить ответам посмотрит следующий
вопрос вопросы вопросов скажите подскажите пожалуйста расскажите уточните написали знать задам
боль боли болью симптом симптомы ощущение рассказали поделились заметили замечали чувствуете чувствовали ощущаете началось начались давно часто опишите примерно ещё другое что-то части месте
`));

// Medicine words never become allowed by being in the member's message ("Should I take paracetamol?").
const MEDICINE=/^(medicine|medication|meds|pills?|tablets?|drugs?|doses?|dosage|ibuprofen|nurofen|paracetamol|panadol|acetaminophen|aspirin|analgin|citramon|nitroglycerin|valerian|vitamins?|magnesium|inhaler|diuretic|лекарств|таблет|препарат|доз|парацетамол|ибупрофен|аспирин|цитрамон|анальгин|валерьян|витамин|магни|ингалятор|мочегон|դեղ|հաբ|պարացետամոլ|ասպիրին|ցիտրամոն|վիտամին|մագնեզ|ջրամուղ)/u;

export const vocabularyTokens=(text:string)=>normaliseText(text).replaceAll('’',"'").match(/[\p{L}][\p{L}']*/gu)??[];
export const nearWord=(a:string,b:string)=>{
 const min=Math.min(a.length,b.length);if(min<4)return a===b;
 let i=0;while(i<min&&a[i]===b[i])i++;
 return i>=4&&i>=min-2&&Math.abs(a.length-b.length)<=4;
};

/** The words of a reply that are outside the closed vocabulary (empty: the reply may go out). */
export function wordsOutsideVocabulary(reply:string,allowedTexts:{sheet:readonly string[];member:readonly string[]}):string[]{
 const sheetWords=new Set(allowedTexts.sheet.flatMap(vocabularyTokens));
 const memberWords=new Set(allowedTexts.member.flatMap(vocabularyTokens).filter(w=>!MEDICINE.test(w)));
 const pool=[...sheetWords,...memberWords];
 const out:string[]=[];
 for(const w of vocabularyTokens(reply)){
  if(w.length<=2||FUNCTION.has(w)||ACK.has(w)||sheetWords.has(w)||memberWords.has(w))continue;
  if(!MEDICINE.test(w)&&pool.some(p=>nearWord(w,p)))continue;
  out.push(w);
 }
 return [...new Set(out)];
}

// Conversational replies (conversation.ts; Codex review F1, 18 Oct): a blocklist cannot cover warm free
// text ("You are safe", "For now, rest", «Дышите медленно»), so Zoe's own words must come from the function
// words, Zoe's fixed conversational wording (passed in by the caller), the member's own words (medicine
// words excepted) or this short list of greeting, thanks, empathy and helping words. Exact forms only.
// Deliberately missing: safe, fine, okay, good, well, better, լավ, хорошо, rest, water,
// sleep, breathe, calm, relax, normal, worry (as a verb), soon and every time word.
const CHAT=new Set(words(`
hello hi hey welcome morning afternoon evening day night great glad nice lovely happy pleased hear hearing from again today here always whenever anytime
time ready help helping helped support anything something else more tell share let know want would like care team noreon zoe assistant message messages
pass passing write writing reply chat talk talking sorry understand thank thanks thanking bye goodbye see questions question visits visit results app around way
doing feel feeling feelings felt worrying worried anxious nervous scared stressed sad down low lonely upset overwhelmed telling wrote kind kindly ask asking please
բարեւ բարև ձեզ ողջույն բարի լույս օր երեկո գիշեր ուրախ հաճելի լսել շնորհակալություն շնորհակալ խնդրեմ ցավում օգնել օգնեմ օգնություն պատրաստ այստեղ միշտ
ցանկացած պահի պատմեք գրեք գրել ցանկանում ցանկանաք հաղորդագրություն փոխանցեմ փոխանցել բժշկին բժիշկը խնամքի թիմին զգում զգացմունք հասկանում հասկանալի
ասացիք ասել պատմել ուրիշ ավելին այդպես կփոխանցեմ փոխանցեմ ցանկանաք անհանգստանում տխուր լարված հարց հարցեր այցերը արդյունքները հավելված հավելվածում սիրով
здравствуйте привет добрый день утро вечер доброе рада рад приятно слышать спасибо пожалуйста жаль понимаю помочь помогу помощь готова здесь всегда
любое время напишите расскажите хотите хочется могу чем ещё передам передать врачу врач команде сообщение чувствуете рассказали рассказать вопрос вопросы
визиты результаты приложение поддержать ваш вашему подробнее волнуетесь переживаете беспокоитесь грустно тревожно тяжело
`));

/** The words of a conversational reply outside its closed vocabulary (empty: the reply may go out). */
export function chatWordsOutside(reply:string,allowed:{fixed:readonly string[];member:readonly string[]}):string[]{
 const fixedWords=new Set(allowed.fixed.flatMap(vocabularyTokens));
 const memberWords=new Set(allowed.member.flatMap(vocabularyTokens).filter(w=>!MEDICINE.test(w)));
 const pool=[...fixedWords,...memberWords];
 const out:string[]=[];
 for(const w of vocabularyTokens(reply)){
  if(w.length<=2||FUNCTION.has(w)||CHAT.has(w)||fixedWords.has(w)||memberWords.has(w))continue;
  if(!MEDICINE.test(w)&&pool.some(p=>nearWord(w,p)))continue;
  out.push(w);
 }
 return [...new Set(out)];
}

/** Function words and medicine stems, shared with the care plan draft guard (lib/ai-plan/compose.ts). */
export const isFunctionWord=(w:string)=>FUNCTION.has(w);
export const isMedicineWord=(w:string)=>MEDICINE.test(w);
