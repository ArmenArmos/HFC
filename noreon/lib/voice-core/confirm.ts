import type {Locale} from '@/lib/locale';

/**
 * Spoken confirmation and cancellation, framework-free. Strict on purpose: the whole utterance must be made of
 * confirmation phrases (and polite fillers) only, and any negation anywhere refuses it. «ոչ, մի պահպանիր», "no, don't
 * save", «нет, не сохраняй» and «այո, բայց ոչ» are never a yes. A match only allows the server to perform the write the
 * pending card shows, through the same command a tap uses; the transcript alone never writes anything.
 */
export const VOICE_CONFIRM_VERSION='voice-confirm-1';

export const CONFIRM_PHRASES:Readonly<Record<Locale,readonly string[]>>=Object.freeze({
 hy:['այո','հաստատում եմ','ճիշտ է','պահպանիր','պահպանեք','հա','այո ճիշտ է','համաձայն եմ'],
 ru:['да','подтверждаю','верно','сохрани','сохраните','всё верно','все верно','правильно','согласен','согласна'],
 en:['yes','confirm','correct','save','that is right','that\'s right','yes please','i confirm','save it'],
});
export const CANCEL_PHRASES:Readonly<Record<Locale,readonly string[]>>=Object.freeze({
 hy:['ոչ','չէ','չեղարկիր','չեղարկել','մի պահպանիր','մի պահպանեք','սխալ է','ոչ ճիշտ չէ','կանգնիր'],
 ru:['нет','отмена','отмени','отменить','не сохраняй','не сохраняйте','неверно','неправильно','стоп'],
 en:['no','cancel','stop','don\'t save','do not save','wrong','that is wrong','not correct','no thanks'],
});
const FILLERS:Readonly<Record<Locale,readonly string[]>>=Object.freeze({
 hy:['խնդրում եմ','խնդրեմ','լավ','դե'],
 ru:['пожалуйста','хорошо','ну'],
 en:['please','okay','ok','well'],
});
/** Any of these anywhere refuses a confirmation, in every language (a member may answer in another language). */
const NEGATION=/(?<![\p{L}])(?:ոչ|չէ|մի|չ\p{L}+|не|нет|ни|no|not|don't|dont|never|cancel|stop|wrong|отмен\p{L}*|չեղարկ\p{L}*)(?![\p{L}'])/u;

/** Lower case, NFC, Armenian marks and punctuation removed, one space between words. */
export function normaliseUtterance(text:string):string{
 return text.normalize('NFC').toLocaleLowerCase('und').replace(/[՛՜՞՟]/gu,'').replace(/[«»"“”„.,!?;:։…()\-–—]+/gu,' ').replace(/\s+/gu,' ').trim();
}

/** Consumes the utterance with the given phrases (longest first) and fillers; true when nothing else is left. */
function onlyPhrases(text:string,phrases:readonly string[],fillers:readonly string[]):boolean{
 const all=[...phrases.map(p=>({p,real:true})),...fillers.map(p=>({p,real:false}))].sort((a,b)=>b.p.length-a.p.length);
 let rest=text,real=false;
 while(rest){
  const hit=all.find(({p})=>rest===p||rest.startsWith(`${p} `));
  if(!hit)return false;
  real||=hit.real;
  rest=rest.slice(hit.p.length).trim();
 }
 return real;
}

const lexicon=(locale:Locale,which:Record<Locale,readonly string[]>)=>[...which[locale],...(['hy','ru','en']as const).filter(l=>l!==locale).flatMap(l=>which[l])];
const fillerList=(locale:Locale)=>[...FILLERS[locale],...(['hy','ru','en']as const).filter(l=>l!==locale).flatMap(l=>FILLERS[l])];

/** A whole-utterance spoken yes, with no negation anywhere. */
export function matchesConfirmation(transcript:string,locale:Locale):boolean{
 const t=normaliseUtterance(transcript);
 if(!t||t.length>80||NEGATION.test(t))return false;
 return onlyPhrases(t,lexicon(locale,CONFIRM_PHRASES),fillerList(locale));
}

/** A whole-utterance spoken no or cancel. A cancel never writes; it only closes the pending confirmation. */
export function matchesCancel(transcript:string,locale:Locale):boolean{
 const t=normaliseUtterance(transcript);
 if(!t||t.length>80)return false;
 return onlyPhrases(t,lexicon(locale,CANCEL_PHRASES),fillerList(locale));
}

/** What a reply to a pending confirmation is: yes, no, or neither (then it is an ordinary message). */
export function confirmationAnswer(transcript:string,locale:Locale):'confirm'|'cancel'|null{
 if(matchesConfirmation(transcript,locale))return 'confirm';
 if(matchesCancel(transcript,locale))return 'cancel';
 return null;
}
