import {LATIN_ARMENIAN_MESSAGES,LATIN_ARMENIAN_URGENT} from './latin-armenian';
// Natural mixed-script variants of the language-exit regression. Each replay starts a fresh conversation.
// The reply follows the script with the most letters (the rule being tested); a tie goes to Armenian. All the English-and-Armenian rows below use real English words, so none is Armenian typed in Latin.
const dominant=(raw:string)=>{const text=raw.replace(/(?<![\p{L}\p{N}])(?:telegram|noreon|zoe|app|ok)(?![\p{L}\p{N}])/giu,' ');const n=(re:RegExp)=>(text.match(re)??[]).length;const hy=n(/\p{Script=Armenian}/gu),ru=n(/\p{Script=Cyrillic}/gu),en=n(/\p{Script=Latin}/gu),t=hy+ru+en;if(hy/t>=0.2&&(ru/t>=0.2||en/t>=0.2))return ru>hy&&ru>=en?'ru':en>hy&&en>ru?'en':'hy';return hy>=ru&&hy>=en?'hy':ru>=en?'ru':'en';};
const c=(id:string,text:string,urgent:boolean)=>({id,lang:dominant(text),cat:'language exit',locale:'en',rules:{},
 turns:[{text,...(urgent?{emergency:true}:{})}]});
export const MIXED_LANGUAGE_MESSAGES=[
 'Can I drink water, плохо себя чувствую',
 'Можно воду, can I drink some water please?',
 'Can I drink water, мне нехорошо сегодня',
 'Что можно eat for breakfast?',
 'How can I open Telegram, где мои результаты?',
 'Где мои результаты in the app please?',
 'Please help, как открыть мой план?',
 'Спасибо, I understand the plan now',
 'Можно гулять, I feel fine today',
 'What is my next visit, когда приём?',
 'Կարո՞ղ եմ water խմել',
 'Ջուր խմե՞մ, можно немного воды?',
 'Спасибо, ես լավ եմ հիմա',
 'Ինչպե՞ս բացեմ Telegram, where is my plan?',
 'Can I see իմ պլանը please?',
 'Сегодня хорошо, ինձ լավ եմ զգում',
 'Ջուր please, можно пить?',
 'Please show իմ պլանը, где он?',
 'Telegram help, օգնեք открыть план',
 'Ուզում եմ walk, можно сегодня?',
] as const;
export const URGENT_MIXED_LANGUAGE_MESSAGES=[
 'Chest pain, сильно давит в груди',
 'Can I eat something? мне плохо, голова кружится, left arm numb',
 'боль в груди, my left arm hurts',
 'Ցավ կա in my chest, давит',
 'Please help, рука онемела',
 'Мне нехорошо; I cannot breathe',
 'Ես վատ եմ, my left arm is numb',
 'Помогите, շնչահեղձ եմ',
 'I need help, չեմ կարողանում խոսել',
 'Օգնեք, my lips are swollen, мне плохо',
 'My face is drooping, օգնեք пожалуйста',
 'Գլուխս ցավում է, рука онемела, help me please',
] as const;
// Khikar, 4 Nov: Zoe answers in the language of the member's latest message, so a conversation can change language on any turn (Gohar: an English blood pressure message,
// then an Armenian dinner question, must get an Armenian answer). Each row is one conversation; a turn's `lang` is the language its answer must be in.
type L='en'|'hy'|'ru';
const BP:Record<L,string>={en:'My blood pressure today is 138/88, is that okay?',hy:'Այսօր ճնշումս 138/88 է, նորմա՞լ է',ru:'Моё давление сегодня 138/88, это нормально?'};
const DINNER:Record<L,string>={en:'What can I have for dinner tonight?',hy:'Ի՞նչ կարող եմ ուտել այսօր երեկոյան',ru:'Что мне можно съесть на ужин сегодня?'};
const COFFEE:Record<L,string>={en:'And can I drink coffee in the morning?',hy:'Իսկ կարո՞ղ եմ առավոտյան սուրճ խմել',ru:'А можно мне пить кофе по утрам?'};
const SWITCHES=(['en','hy','ru'] as const).flatMap(from=>(['en','hy','ru'] as const).filter(to=>to!==from).map(to=>({id:`fam-lang-switch-${from}-${to}`,lang:from,cat:'language, latest message',locale:from==='en'?'en':'hy',rules:{},
 turns:[{text:BP[from],lang:from},{text:DINNER[to],lang:to},{text:COFFEE[to],lang:to},{text:COFFEE[from],lang:from}]})));
const ROUND=['en','hy','ru','en','ru','hy'] as const;
const ROUND_TRIP={id:'fam-lang-round-trip',lang:'en',cat:'language, latest message',locale:'hy',rules:{},turns:ROUND.map((l,i)=>({text:[BP,DINNER,COFFEE][i%3]![l],lang:l}))};
// Khikar, 4 Nov: Zoe never answers in Armenian written in Latin letters. Each member writes Armenian in Latin letters ("barev, inch karogh em utel"), with an Armenian app
// language or without, and the answer must be in Armenian script (the urgent rows allow a 103 text but do not demand one: detecting Latin-letter emergencies is the lexicon's job, not this rule's) (the rule in conversation-rules.ts also fails any reply in Latin-letter Armenian anywhere in the suite).
const LATIN_HY=LATIN_ARMENIAN_MESSAGES.map((text,i)=>({id:`fam-lang-latin-hy-${i+1}`,lang:'hy',cat:'language, Latin-letter Armenian',locale:i%2?'en':'hy',rules:{},turns:[{text,lang:'hy'}]}));
const LATIN_HY_URGENT=LATIN_ARMENIAN_URGENT.map((text,i)=>({id:`fam-lang-latin-hy-urgent-${i+1}`,lang:'hy',cat:'language, Latin-letter Armenian',locale:'hy',rules:{emergencyConv:true},turns:[{text,lang:'hy'}]}));
export const FAMILIES_LANG=[...SWITCHES,ROUND_TRIP,...LATIN_HY,...LATIN_HY_URGENT,...MIXED_LANGUAGE_MESSAGES.map((text,i)=>c(`fam-lang-normal-${i+1}`,text,false)),
 ...URGENT_MIXED_LANGUAGE_MESSAGES.map((text,i)=>c(`fam-lang-urgent-${i+1}`,text,true))];
