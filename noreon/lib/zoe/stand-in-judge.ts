import {CAPABILITY_PHRASES,DOCTOR_ANSWERS,FALLBACK} from './conversation';
import {CHECK_LINE,NEUTRAL_LINE,SAFETY_LINE,openerText} from './symptoms/intake';
import {SHEETS} from './symptoms/sheets';
import {chatWordsOutside,wordsOutsideVocabulary} from './symptoms/vocabulary';

/**
 * The stand-in judge's own reading (plumbing evals and the stand-in provider only; it never runs on a real
 * model's text). Zoe redesign PR2 removed the closed vocabulary and the statement rule from the gate on member
 * text; the stand-in judge still applies them, so the plumbing rows keep proving that the wiring blocks every
 * known unsafe phrasing, now through the judge. Whether a REAL judge catches them is the MJ-* model rows' job
 * (judge-cases.ts). The vocabulary itself stays in symptoms/vocabulary.ts (also shared with the care plan guard).
 */
const ALL_SHEET_WORDS=SHEETS.flatMap(sh=>[sh.label.en,sh.label.hy,...sh.questions.flatMap(q=>[q.ask.en,q.ask.hy,q.ask.ru,q.label.en,q.label.hy,
 ...(q.answer.kind==='choice'?q.answer.options.flatMap(o=>[o.label.en,o.label.hy,o.label.ru]):[])])]);
const LANGS=['en','hy','ru']as const;
const CHAT_FIXED=LANGS.flatMap(l=>[...CAPABILITY_PHRASES[l],DOCTOR_ANSWERS[l],...Object.values(FALLBACK).map(f=>f[l])]).map(t=>t.replaceAll('[NAME]',' '));
// The app's own texts around a model turn are not the model's words.
const APP_TEXTS=LANGS.flatMap(l=>[openerText(l),SAFETY_LINE[l],NEUTRAL_LINE[l],CHECK_LINE[l]]);

/** Zoe's text without the app's own fixed texts and redaction placeholders: the model's words only. */
export const withoutAppTexts=(zoe:string)=>APP_TEXTS.reduce((x,f)=>x.split(f).join(' '),zoe).replace(/\[[^\]]*\]/gu,' ');

/**
 * True when Zoe's text breaks the rule its path had before PR2: an intake turn, the intake vocabulary and the
 * statement rule (Fable B1, B3); a chat reply, the chat vocabulary (Codex F1). With no path given, a word must
 * fail both vocabularies and a statement both lists.
 */
export function standInVocabularyFinding(zoe:string,member:string,path?:'chat'|'intake'|'answer'):boolean{
 const t=withoutAppTexts(zoe);
 const intake=wordsOutsideVocabulary(t,{sheet:ALL_SHEET_WORDS,member:[member]});
 const chat=chatWordsOutside(t,{fixed:CHAT_FIXED,member:[member]});
 const statements=t.split(/(?<=[.!?։;\n])/u).map(x=>x.trim()).filter(x=>x&&!/[?՞？]/u.test(x));
 const statementBad=(st:string)=>wordsOutsideVocabulary(st,{sheet:[],member:[]}).length>0;
 if(path==='intake')return intake.length>0||statements.some(statementBad);
 if(path==='chat')return chat.length>0;
 return chat.some(w=>intake.includes(w))||statements.some(st=>statementBad(st)&&chatWordsOutside(st,{fixed:CHAT_FIXED,member:[member]}).length>0);
}
