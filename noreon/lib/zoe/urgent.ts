import type {ZoeDecision} from './policy';

/**
 * Urgent-word matcher interface (design §G1, K6). The word list is EMPTY and AWAITING S1
 * CLINICAL SIGN-OFF (Tatevik): which phrases trigger the urgent route in EN, HY (incl.
 * Latin-letter Armenian) and RU, how negation, past events and third-person mentions are
 * treated, and how each maps to RF-01..RF-05. Do not add words here without that sign-off.
 *
 * A matcher whose lexicon is not signed off never reports "not urgent": its decision is
 * "skipped", so nobody can read silence from it as reassurance. The T1 acknowledgement
 * (with Call 103) and the doctor alert run regardless of this matcher.
 */
export type UrgentLocale='en'|'hy'|'ru';
export type UrgentEntry={id:string;locale:UrgentLocale;phrase:string;redFlag:'RF-01'|'RF-02'|'RF-03'|'RF-04'|'RF-05'|null};
export type UrgentLexicon={version:string;status:'awaiting_s1_clinical_signoff'|'signed_off'|'staging_placeholder';signedBy:string|null;entries:readonly UrgentEntry[]};
export type UrgentMatch={entryId:string;redFlag:UrgentEntry['redFlag']};
export interface UrgentMatcher{readonly lexicon:UrgentLexicon;match(text:string):UrgentMatch[];decide(text:string):ZoeDecision}

/** The only lexicon in the codebase: empty until S1 is signed. */
export const AWAITING_S1_LEXICON:UrgentLexicon=Object.freeze({version:'s1-unsigned-0',status:'awaiting_s1_clinical_signoff',signedBy:null,entries:Object.freeze([])});

const normalise=(s:string)=>s.normalize('NFKC').toLocaleLowerCase();

export function createUrgentMatcher(lexicon:UrgentLexicon=AWAITING_S1_LEXICON):UrgentMatcher{
 const signed=lexicon.status==='signed_off'&&!!lexicon.signedBy;
 const match=(text:string):UrgentMatch[]=>{
   if(!signed)return [];
   const t=normalise(text);
   return lexicon.entries.filter(e=>e.phrase&&t.includes(normalise(e.phrase))).map(e=>({entryId:e.id,redFlag:e.redFlag}));
 };
 return Object.freeze({
  lexicon,
  match,
  decide(text:string):ZoeDecision{
   // Only lexicon facts are journaled: never the text, its length or which words matched.
   const base={name:'zoe.urgent_match' as const,rule:'zoe.urgent_lexicon',ruleVersion:lexicon.version,attributes:{'noreon.zoe.lexicon.entries':lexicon.entries.length,'noreon.zoe.lexicon.status':lexicon.status}};
   if(!signed)return {...base,outcome:'skipped',reason:'lexicon_awaiting_s1_signoff'};
   const found=match(text);
   return found.length?{...base,outcome:'escalate',reason:'urgent_words_matched',attributes:{...base.attributes,'noreon.zoe.urgent.red_flags':[...new Set(found.map(f=>f.redFlag).filter(f=>f!==null))].join(',')}}
    :{...base,outcome:'recorded',reason:'no_listed_urgent_words'};
  },
 });
}
