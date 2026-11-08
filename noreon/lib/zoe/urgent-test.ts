import type {ZoeDecision} from './policy';
import {normaliseText} from './normalise';
import {AWAITING_S1_LEXICON,createUrgentMatcher,type UrgentMatcher} from './urgent';
import {stagingDecision,stagingPlaceholderActive,stagingUrgentMatcher} from './urgent-staging';

/**
 * A CONSPICUOUSLY FICTIONAL urgent-word list for plumbing tests only. It is NOT the S1 list,
 * nobody clinical has reviewed it, and it must never be read as clinical coverage. It exists so
 * the pipeline's urgent step (stop before any model call) can be exercised end to end. It never
 * raises a care-team alert: lib/care-alerts reads only a signed_off list. It is used only when
 * NOREON_ZOE_TEST_LEXICON is exactly "true".
 */
export const TEST_LEXICON_VERSION='test-fictional-not-s1-1';
type TestEntry={id:string;all:readonly string[]};
const ENTRIES:readonly TestEntry[]=Object.freeze([
 {id:'T-CHEST-EN',all:['chest','pain']},{id:'T-CHEST-EN2',all:['chest','hurts']},{id:'T-BREATH-EN',all:["can't breathe"]},{id:'T-BREATH-EN2',all:['cannot breathe']},
 {id:'T-SELF-EN',all:["don't want to live"]},{id:'T-FACE-EN',all:['face','drooping']},
 {id:'T-CHEST-HY',all:['կրծք','ցավ']},{id:'T-SELF-HY',all:['չեմ ուզում','ապրել']},{id:'T-HEART-HY',all:['սրտ','ցավ']},
 {id:'T-CHEST-HYLATN',all:['krtsk','cav']},{id:'T-CHEST-RU',all:['болит','груд']},
]);
// A negation shortly before the first matched word (EN, RU) or right after the last (HY is
// verb-final: «ցավ չունեմ») suppresses a test match (B01, B02). Uncertainty is not negation:
// "not sure if it's chest pain" still fires (B04).
const NEGATION=/(?:^|[^\p{L}])(?:no|not|never|without|нет|не)(?:[^\p{L}]|$)/u;
const HY_NEGATION_AFTER=/^[^.!?։]{0,12}(?:չունեմ|չկա|չի ցավում|չեմ զգում)/u;
const UNCERTAIN=/not sure|not certain|don't know|do not know|no idea|չգիտեմ|не знаю|не уверен/gu;

export function testLexiconDecision(text:string):ZoeDecision{
 const t=normaliseText(text).replaceAll('’',"'");
 const base={name:'zoe.urgent_match' as const,rule:'zoe.urgent_test_lexicon',ruleVersion:TEST_LEXICON_VERSION,attributes:{'noreon.zoe.lexicon.entries':ENTRIES.length,'noreon.zoe.lexicon.status':'test_fixture_not_clinical'}};
 const hits=ENTRIES.filter(e=>{
  if(!e.all.every(w=>t.includes(w)))return false;
  const at=t.indexOf(e.all[0]!),last=e.all.at(-1)!,end=t.indexOf(last,at)+last.length;
  const before=t.slice(Math.max(0,at-25),at).replace(UNCERTAIN,' ');
  return !NEGATION.test(before)&&!HY_NEGATION_AFTER.test(t.slice(end));
 });
 return hits.length?{...base,outcome:'escalate',reason:'urgent_words_matched_test_list',attributes:{...base.attributes,'noreon.zoe.urgent.test_entries':hits.map(h=>h.id).join(',')}}
  :{...base,outcome:'recorded',reason:'no_test_list_words'};
}

/**
 * The urgent step: the fictional test list when explicitly enabled; the STAGING placeholder list
 * when NOREON_ZOE_URGENT_PLACEHOLDER says so (lib/ai-posture.ts); otherwise the S1 matcher (empty, so skipped, and
 * Zoe then calls no model).
 */
export function urgentDecision(text:string,env:Record<string,string|undefined>=process.env):ZoeDecision{
 if(env.NOREON_ZOE_TEST_LEXICON==='true')return testLexiconDecision(text);
 return stagingPlaceholderActive(env)?stagingDecision(text):createUrgentMatcher(AWAITING_S1_LEXICON).decide(text);
}

/** The matcher care-team alert screening uses: the staging placeholder when switched on, else S1. */
export const configuredUrgentMatcher=(env:Record<string,string|undefined>=process.env):UrgentMatcher=>stagingPlaceholderActive(env)?stagingUrgentMatcher:createUrgentMatcher(AWAITING_S1_LEXICON);
