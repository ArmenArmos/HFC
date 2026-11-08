import {AWAITING_S1_LEXICON,createUrgentMatcher,type UrgentMatcher} from '@/lib/zoe/urgent';
import type {ZoeDecision} from '@/lib/zoe/policy';

/**
 * Screening adapters for care-team alerts. Pure: each turns one source event into the
 * decision the database journals (care_alert_screen). None of them decides what is urgent:
 * - messages use the urgent-word matcher, whose list is EMPTY until S1 is signed off; a match escalates with or without a red
 *   flag id, because some listed words have none (care_alert_screen allows that for messages only);
 * - Zoe passes its own zoe.urgent_match decision through;
 * - lab results go through CriticalLabRules, which has no rules until Q3 is answered.
 * A screen that cannot decide is "skipped", never "recorded", so nobody reads silence
 * from it as reassurance.
 */
export type ScreenDecision={outcome:'escalate'|'recorded'|'skipped';reason:string;rule:string;ruleVersion:string;redFlags:string[]};

export function screenMessage(text:string,matcher:UrgentMatcher=createUrgentMatcher(AWAITING_S1_LEXICON)):ScreenDecision{
 const lex=matcher.lexicon,rule=lex.status==='staging_placeholder'?'care_alert.urgent_staging_placeholder':'care_alert.urgent_lexicon',ruleVersion=lex.version;
 if(!messageScreeningReadsText(matcher))return {outcome:'skipped',reason:'lexicon_awaiting_s1_signoff',rule,ruleVersion,redFlags:[]};
 const found=matcher.match(text);
 return found.length?{outcome:'escalate',reason:'urgent_words_matched',rule,ruleVersion,redFlags:[...new Set(found.map(f=>f.redFlag).filter((f):f is NonNullable<typeof f>=>f!==null))].sort()}
  :{outcome:'recorded',reason:'no_listed_urgent_words',rule,ruleVersion,redFlags:[]};
}
/** Whether screening needs the message text at all. An unsigned list never reads it. */
export const messageScreeningReadsText=(matcher:UrgentMatcher)=>matcher.lexicon.entries.length>0&&(matcher.lexicon.status==='signed_off'&&!!matcher.lexicon.signedBy
 // The staging placeholder (lib/zoe/urgent-staging.ts) follows NOREON_ZOE_URGENT_PLACEHOLDER (lib/ai-posture.ts); it over-alerts by design.
 ||matcher.lexicon.status==='staging_placeholder');

/** Zoe's urgent-match decision, unchanged in meaning: escalate stays escalate, skipped stays skipped. */
export function screenFromZoe(d:ZoeDecision):ScreenDecision{
 const flags=String(d.attributes['noreon.zoe.urgent.red_flags']??'').split(',').filter(f=>/^RF-(0[1-9]|1[0-2])$/.test(f)).sort();
 const outcome=d.outcome==='escalate'&&flags.length?'escalate':d.outcome==='recorded'?'recorded':'skipped';
 return {outcome,reason:outcome==='skipped'&&d.outcome==='escalate'?'zoe_escalation_without_red_flag':d.reason,rule:d.rule,ruleVersion:d.ruleVersion,redFlags:outcome==='escalate'?flags:[]};
}

/**
 * Critical-lab interface (Q3). A verified lab value reaches these rules; they say whether it
 * is critical. There are no rules in the codebase: Q3 (critical-result rules, Armen) is open,
 * and thresholds must come from the clinical team, never from here.
 */
export type LabValueForScreening={resultId:string;memberId:string;analyte:string;value:number|null;unit:string|null;verified:boolean};
export interface CriticalLabRules{readonly version:string;readonly status:'awaiting_q3_clinical_signoff'|'signed_off';evaluate(v:LabValueForScreening):'critical'|'not_critical'|null}
export const AWAITING_Q3_LAB_RULES:CriticalLabRules=Object.freeze({version:'q3-unsigned-0',status:'awaiting_q3_clinical_signoff',evaluate:()=>null});

export function screenLabValue(v:LabValueForScreening,rules:CriticalLabRules=AWAITING_Q3_LAB_RULES):ScreenDecision{
 const rule='care_alert.critical_lab',ruleVersion=rules.version;
 if(rules.status!=='signed_off')return {outcome:'skipped',reason:'lab_rules_awaiting_q3',rule,ruleVersion,redFlags:[]};
 // An unverified or missing value is not a normal one: it is not screened.
 if(!v.verified||v.value===null)return {outcome:'skipped',reason:'value_not_verified',rule,ruleVersion,redFlags:[]};
 const r=rules.evaluate(v);
 if(r===null)return {outcome:'skipped',reason:'no_rule_for_analyte',rule,ruleVersion,redFlags:[]};
 return r==='critical'?{outcome:'escalate',reason:'lab_result_critical',rule,ruleVersion,redFlags:[]}:{outcome:'recorded',reason:'lab_result_not_critical',rule,ruleVersion,redFlags:[]};
}
