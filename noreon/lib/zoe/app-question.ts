import {bpReadings} from './bp-parse';
import {chatIntent,latinArmenian,WORRIED} from './conversation';
import {normaliseText} from './normalise';
import {mentionsMedicine} from './output-guard';
import type {ReplyLanguage} from './provider';
import {HEALTH_HINT,TIER_RULES} from './routing';
import {mentionsSymptomWord} from './symptom-words';

/**
 * Armen msgs 580 and 581 (2 Nov): the new chat is one screen, and a question about it is not a matter for the doctor. Two pure checks
 * for the pipeline: a reply that sends the member to a section the new chat does not have, and a message with nothing about health in it.
 * Pattern lists, not clinical content, and no safety rule reads them: every urgent, red-flag and same-day check runs before they do.
 */
export const APP_QUESTION_VERSION='zoe-app-question-2';

/** When Zoe could not answer a message with no health content: no doctor wording, no 103, no forward (Armen msg 581). STAGING wording. */
export const ASK_AGAIN_LINE:Record<ReplyLanguage,string>={
 en:"I'm sorry, I didn't manage to answer that. Could you ask it another way?",
 hy:'Ներողություն, չկարողացա պատասխանել։ Կարո՞ղ եք հարցնել մի փոքր այլ կերպ։',
 ru:'Извините, у меня не получилось ответить. Можете спросить немного иначе?',
};

// ---- The sections of the old app, as a place to go ----------------------------------------------------------------------
const OPEN_Q=`["'«“„‘]`,CLOSE_Q=`["'»”’]`;
const NAME=`(?:Home|Progress|My progress|Care plan|Profile|Me)`,NAME_ANY=`(?:Home|Progress|My progress|[Cc]are plan|[Pp]rofile|Me)`;
const NAME_HY=`(?:[Գգ]լխավոր|[Աա]ռաջընթաց|[Բբ]ուժման պլան|[Իի]մ էջ|[Պպ]րոֆիլ)\\p{L}*`;
const NAME_RU=`(?:Главн\\p{L}*|Прогресс\\p{L}*|Мой прогресс|План\\p{L}* лечения|Обо мне|Мой профиль|[Пп]рофил\\p{L}*|Я)`;
const SECTION=`(?:section|page|tab|screen)`,SECTION_HY=`(?:բաժ\\p{L}*|էջ\\p{L}*|ներդիր\\p{L}*)`,SECTION_RU=`(?:раздел\\p{L}*|вкладк\\p{L}*|страниц\\p{L}*)`;
const GO=`(?:[Oo]pen|[Gg]o to|[Hh]ead to|[Tt]ap(?: on)?|[Cc]lick(?: on)?|[Nn]avigate to|[Ss]witch to)`,LOOK=`(?:[Uu]nder|[Cc]heck|[Ll]ook (?:in|at|under)|[Vv]isit)`;
const GO_HY=`(?:[Բբ]ացեք|[Գգ]նացեք|[Աա]նցեք|[Մմ]տեք|[Ըը]նտրեք|[Սս]եղմեք)`,GO_RU=`(?:[Оо]ткройте|[Пп]ерейдите|[Зз]айдите|[Нн]ажмите|[Вв]ыберите)`;
const PLACES=[
 // Storage claims also name a destination, even without "open" or "page".
 /(?<![\p{L}])(?:in|on|under)\s+(?:your\s+|the\s+|my\s+)?(?:profile|me)(?![\p{L}])/giu,
 /(?<![\p{L}])պրոֆիլում\p{L}*|(?<![\p{L}])в\s+(?:(?:вашем|твоём|твоем|моём|моем|своём|своем)\s+)?профил\p{L}*/giu,
 // A name in quotation marks is a label, in any language.
 new RegExp(`${OPEN_Q}(?:${NAME}|${NAME_HY}|${NAME_RU})${CLOSE_Q}`,'gu'),
 new RegExp(`(?<![\\p{L}])${NAME_ANY}\\s+${SECTION}(?![\\p{L}])|(?<![\\p{L}])${SECTION}\\s+${NAME_ANY}(?![\\p{L}])`,'gu'),
 new RegExp(`(?<![\\p{L}])${GO}\\s+(?:the\\s+|your\\s+)?${NAME_ANY}(?![\\p{L}])|(?<![\\p{L}])${LOOK}\\s+(?:the\\s+)?${NAME}(?![\\p{L}])`,'gu'),
 // "Իմ էջ" (my page) is only ever the section.
 new RegExp(`(?<![\\p{L}])[Իի]մ էջ\\p{L}*|(?<![\\p{L}])${NAME_HY}\\s+${SECTION_HY}|${SECTION_HY}\\s+«?${NAME_HY}|${GO_HY}\\s+«?${NAME_HY}|${NAME_HY}»?\\s+${GO_HY}`,'gu'),
 new RegExp(`${SECTION_RU}\\s+«?${NAME_RU}|${NAME_RU}»?\\s+${SECTION_RU}|${GO_RU}\\s+(?:в\\s+|на\\s+)?«?${NAME_RU}`,'gu'),
];
// "There is no Me page" answers the member; it sends nobody anywhere. Only the clause before the name counts, so "Don't worry, open Me" is still
// a place to go. Armenian and Russian say it after the name ("Իմ էջ բաժին չկա", "Раздела «Обо мне» нет"): that word counts when it comes straight after.
const NEGATED=/(?<![\p{L}])(?:no|not|never|isn't|aren't|doesn't|don't|нет|не|չկա\p{L}*|չի|չեն)(?![\p{L}])/iu;
// Anywhere in the clause that holds the name: "The Me section does not exist here", «Раздела «Обо мне» в этом чате нет».
const denied=(s:string,m:RegExpMatchArray)=>{const at=m.index??0,end=at+m[0].length;return NEGATED.test(`${s.slice(0,at).split(/[,;:—–]\s*/u).at(-1)!} ${s.slice(end).split(/[,;:—–]\s*/u)[0]!}`);};
/** A section the new chat does not have, named as a place to go. One code: the regenerate needs no more. */
export function missingSections(reply:string):string[]{
 const hit=reply.replaceAll('’',"'").split(/(?<=[.։!?？\n])\s*/u).some(s=>PLACES.some(p=>[...s.matchAll(p)].some(m=>!denied(s,m))));
 return hit?['section.named']:[];
}

// ---- A message that is only about the app ----------------------------------------------------------------------------
// What the message has to be about. Fable AQ-01: a list of health words can never be complete ("I fell", "можно ли мне летать"), so the route needs a
// positive match and everything else keeps the doctor. "How do I" and «ինչպես» say nothing by themselves: they come out before app_help reads the message.
const APP_HELP=TIER_RULES.find(r=>r.id==='app_help')!.re;
const ASKING=/how (?:do|can|should) i|where (?:do|can) i|ինչպես/gu;
const APP=/(?<![\p{L}])(?:pages?|sections?|tabs?|screens?|chat|language|log ?out|sign ?out|(?:ask|write)(?: you)? (?:here|in (?:the|this) chat)|lab tests?|appointments?|book(?:ing)?|care plan|էջ\p{L}*|բաժ[ին]\p{L}*|զրույց\p{L}*|չատ\p{L}*|մենյու\p{L}*|ընտրացանկ\p{L}*|լեզուն?|լեզվ\p{L}*|դուրս գալ|այստեղ հարցնել|հարցնել այստեղ|այստեղ գրել|լաբորատոր\p{L}*|այց\p{L}*|ամրագր\p{L}*|պրոֆիլ\p{L}*|բուժման պլան\p{L}*|страниц\p{L}*|раздел\p{L}*|вкладк\p{L}*|чат\p{L}*|меню|(?:смен\p{L}*|помен\p{L}*|измен\p{L}*|выбр\p{L}*) язык[аеу]?|выйти|(?:спросить|написать) (?:здесь|тут)|(?:здесь|тут) (?:спросить|написать)|анализ\p{L}*|запис\p{L}*|визит\p{L}*|профил\p{L}*|план\p{L}* лечения)(?![\p{L}])/u;
// And what still takes it away: a message with both is a health message.
const WORDS=TIER_RULES.filter(r=>['medication','symptom','result_reading','health_info'].includes(r.id)).map(r=>r.re);
const BODY=/(?<![\p{L}])(?:head|stomach|belly|tummy|legs?|arms?|hands?|foot|feet|back|neck|throat|eyes?|ears?|skin|kidneys?|liver|lungs?|heart|urine|blood|body|գլուխ\p{L}*|գլխացավ\p{L}*|փոր(?!ձ)\p{L}*|ստամոքս\p{L}*|ոտք\p{L}*|ոտն\p{L}*|ձեռք\p{L}*|ձեռն\p{L}*|մեջք\p{L}*|վիզ\p{L}*|վզ\p{L}*|կոկորդ\p{L}*|աչք\p{L}*|ականջ\p{L}*|մաշկ\p{L}*|երիկամ\p{L}*|լյարդ\p{L}*|թոք\p{L}*|սիրտ\p{L}*|սրտ\p{L}*|արյուն\p{L}*|արյան|մարմն\p{L}*|голов\p{L}*|живот\p{L}*|желуд\p{L}*|ног[аиуе]?|ногой|рук[аиуе]?|рукой|спин\p{L}*|ше[яюие]|горл\p{L}*|глаз\p{L}*|уш[иах]+|кож\p{L}*|почк\p{L}*|печен\p{L}*|л[её]гк\p{L}*|сердц\p{L}*|моч\p{L}*|кров\p{L}*|тел[оа])(?![\p{L}])/u;
// How they are, what they did, and asking whether something is allowed.
const HOW=/(?<![\p{L}])(?:blurr\p{L}*|double vision|see double|двоится|мутно|աղոտ\p{L}*|worse|better|feel\p{L}*|should i|can i (?:eat|drink|stop|start|take|skip|exercise|run|fly|travel|drive)|stop\p{L}*|take|taking|took|fell|fall\p{L}*|faint\p{L}*|serious|wrong|doctor|nurse|բժիշկ\p{L}*|բժշկ\p{L}*|հիվանդ\p{L}*|врач\p{L}*|болен|больн\p{L}*|беремен\p{L}*|упал\p{L}*|опух\p{L}*|от[её]к\p{L}*|ուռ\p{L}*|is it (?:ok|okay|safe|bad)|allowed|վատ\p{L}*|զգում\p{L}*|զգաց\p{L}*|կարելի|խմ\p{L}*|ընդուն\p{L}*|плох\p{L}*|хуже|лучше|чувств\p{L}*|можно ли|мне можно|нельзя)(?![\p{L}])/u;
// The app's own words that carry a health word: taken out before the word lists read the message.
const APP_WORDS=/(?:i have|i've got) a question|health (?:questionnaire|questions?)|հարց ունեմ|առողջության (?:հարցաշար|հարց)\p{L}*|կարելի է (?:այստեղ )?հարցնել|у меня (?:есть )?вопрос\p{L}*|вопрос\p{L}* о здоровье|можно ли (?:здесь |тут )?(?:спросить|задать)/gu;
const healthSign=(raw:string)=>{
 const t=normaliseText(raw),rest=t.replace(APP_WORDS,' ');
 return raw.length>240||/\p{N}/u.test(raw)||latinArmenian(raw)||!!bpReadings(t).length||WORDS.some(re=>re.test(rest))||BODY.test(rest)||HOW.test(rest)||HEALTH_HINT.test(rest)||WORRIED.test(t)||mentionsSymptomWord(raw)||mentionsMedicine(raw);
};
const SOCIAL:ReadonlySet<string>=new Set(['greeting','thanks','how_are_you','farewell']);
// These standalone app follow-ups have no health content of their own. Earlier health turns still keep the doctor fallback.
const STATUS_QUESTION=/^(?:what(?:'s| is) next|what happens next|where (?:is|are) my (?:data|answers) (?:stored|saved|kept)|հիմա ինչ է հաջորդ քայլը|որտեղ են պահվում իմ տվյալները|что дальше|где (?:хранятся|сохранены) мои (?:данные|ответы))[.?!\s]*$/u;
/** Plain small talk from the closed list: it says nothing about the topic. */
export const smallTalk=(raw:string)=>SOCIAL.has(chatIntent(raw,{names:[]})?.primary??'');
/** The message is about the app or logistics, and nothing in it is about health. Anything else, known or not, stays a matter for the doctor. */
export function plainAppQuestion(raw:string){
 const t=normaliseText(raw);
 return (APP.test(t)||APP_HELP.test(t.replace(ASKING,' '))||STATUS_QUESTION.test(t))&&!healthSign(raw);
}
