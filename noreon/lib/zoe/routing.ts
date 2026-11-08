import {normaliseText} from './normalise';
import type {ScopeResult} from './scope';
import {mentionsSymptomWord} from './symptom-words';

/**
 * Risk-tier routing (lead decisions 17 Oct 15:15 and 15:17). Pure and deterministic: fixed rules
 * plus the scope classifier's result pick the tier BEFORE any model is called, so the answering
 * model never decides its own route. Urgent words never get here: the pipeline stops at the urgent
 * matcher and no model is used. When unsure, the tier goes one up, never down.
 *
 *  low     logistics (booking, times, where results are), app help → cheap model; the only tier
 *          whose messages Zoe may answer directly (pipeline.ts), and only when nothing is unsure
 *  medium  general health information, summaries for the doctor   → mid model
 *  high    symptoms, medication, results, plan questions          → strongest model
 *
 * zoe-routing-3 (Armen's false 103, 20 Oct 18:49): a key symptom word with typos («Սրտխոնց») counts as a symptom, and a
 * message no rule recognises never lets the window fall to the low tier because another message in it was logistics
 * ("thanks" earlier in the window put «Սրտխոնց ունեմ» on the light model).
 *
 * The word lists are engineering patterns, not clinical content, and are versioned. Doctor
 * approval is unchanged: every AI draft is a pending draft only the assigned doctor can approve.
 */
export const ROUTING_VERSION='zoe-routing-4';
export const TIERS=['low','medium','high']as const;
export type Tier=typeof TIERS[number];
export const tierRank=(t:Tier)=>TIERS.indexOf(t)+1;
const up=(t:Tier):Tier=>TIERS[Math.min(TIERS.indexOf(t)+1,TIERS.length-1)]!;
const max=(a:Tier,b:Tier):Tier=>tierRank(a)>=tierRank(b)?a:b;

export type TierRule={id:string;tier:Tier;label:string;re:RegExp};
// Matched on normalised (lower-cased, NFC) text. EN, HY, HY-Latn and RU stems.
export const TIER_RULES:readonly TierRule[]=Object.freeze([
 {id:'medication',tier:'high',label:'Medication or doses',re:/\b(pills?|tablets?|medicines?|medications?|meds|drugs?|dose|dosage|\d+\s?mg|statins?|metformin|aspirin|insulin|blood thinner|prescri\w*)\b|դեղ|հաբ|լեկարստվ|(?<![a-z])(dex\w*|hab)(?![a-z])|лекарств|таблет|препарат|доз/u},
 {id:'symptom',tier:'high',label:'Symptoms',re:/\b(pain\w*|hurts?|hurting|aches?|aching|dizz\w*|faint\w*|breath\w*|chest|palpitat\w*|heart ?beat|swell\w*|swollen|bleed\w*|blood in|fever|nause\w*|vomit\w*|headache|migraine|numb\w*|tingl\w*|weak(ness)?|tired\w*|fatigue|sick|ill|cough\w*|symptoms?|feel (bad|unwell|weird|strange|off)|unwell)\b|ցավ|գլխապտույտ|շնչ|սիրտ|ուժասպառ|թուլ|սրտխառն|ջերմ|(?<![a-z])(cav|cavum|glux\w*|sirt\w*)(?![a-z])|боль|болит|головокруж|одышк|сердц|тошн|слабост|температур/u},
 {id:'result_reading',tier:'high',label:'Results or readings',re:/\b\d{2,3}\s?\/\s?\d{2,3}\b|\b\d+([.,]\d+)?\s?(mmol|mg\/dl|mmhg|bpm|%)|\b(cholesterol|glucose|sugar|hba1c|ldl|hdl|triglycerides?|blood pressure|bp|pulse|reading|ecg|ekg)\b|\bresults?\b.{0,30}\b(mean|high|low|normal|bad|good|worr\w*|explain|interpret|okay|ok)\b|\b(high|low|bad|abnormal)\b.{0,20}\bresults?\b|ճնշում|շաքար|խոլեստերին|արդյունքն?ե?ր?ը?.{0,20}(նշանակ|բարձր|ցածր|նորմալ)|давлен|сахар|холестерин|анализ.{0,20}(значит|высок|низк|норм)/u},
 {id:'plan_question',tier:'high',label:'Questions about the care plan',re:/\b(my plan|care plan|the plan|should i|can i (eat|drink|stop|start|take|skip|exercise|run)|is it (safe|ok|okay) (to|if)|allowed to)\b|պլան|կարո՞?ղ եմ|կարող եմ|можно ли|мне можно|план/u},
 {id:'health_info',tier:'medium',label:'General health information',re:/\b(healthy|health|diet|nutrition|food|eat\w*|sleep\w*|exercis\w*|walk\w*|weight|smok\w*|alcohol|stress|salt|sport|steps|lifestyle|prevent\w*|risk|summar\w*|what is|why does|explain)\b|առողջ|սնունդ|սնվ|քուն|քնել|քաշ|ծխել|ալկոհոլ|սթրես|կանխարգել|здоров|питани|сон|вес|кури|алкогол|стресс/u},
 {id:'app_help',tier:'low',label:'Using the app',re:/\b(how (do|can|should) i|where (do|can) i|in the app|the app|app|upload\w*|log ?in|sign ?in|password|telegram|notifications?|language|settings|menu|profile|questionnaire|reminders?)\b|հավելված|ինչպես|որտեղ գտնել|հարցաշար|приложени|как (мне )?(найти|загрузит|войти|записат|подключит)|где (найти|посмотреть)|анкет|уведомлен/u},
 {id:'logistics',tier:'low',label:'Logistics: booking, times, where results are',re:/\b(book\w*|appointments?|reschedul\w*|cancel\w*|slots?|visit|clinic|address|location|directions|open(ing)? hours|what time|which time|when (is|are|can|will|do)|where (is|are|can|do)|tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday|nurse (visit|come)|home visit|results? (ready|available|come|arrive|uploaded)|where.{0,20}results?|when.{0,20}results?|payment link|invoice|thank(s| you)|ok(ay)?|hello|hi)\b|ամրագր|այց|կլինիկ|հասցե|ժամը|երբ|որտեղ|վաղը|այսօր|շնորհակալ|բարև|բարեւ|записат|запис|клиник|адрес|когда|где|завтра|сегодня|спасибо|здравствуй/u},
]);

/** Key symptom words spelt with typos or endings the symptom pattern misses (urgent-check.ts): the symptom tier. */
export const SYMPTOM_WORD_RULE:TierRule=Object.freeze({id:'symptom_word',tier:'high',label:'Symptom words with typos',re:/$^/u});

// The member saying how they are: never logistics only.
export const HEALTH_HINT=/(?<![\p{L}])(?:i have|i've got|i got|i am|i'm|i feel|i felt|feeling|my \p{L}+ (?:is|are|hurts?|feels?)|ունեմ|ունի|զգում եմ|զգում է|у меня|чувствую|я болею|unem|zgum em)(?![\p{L}])/u;

export type TierClassifierResult={tier:Tier|null;confidence:number;label:string};
/** A classifier result (deterministic today; a cheap-model classifier can be added behind this). */
export type TierClassifier=(texts:string[])=>TierClassifierResult;

export type TierDecision={tier:Tier;base:Tier;reason:string;rules:string[];unsure:string[];classifier:TierClassifierResult|null};

/**
 * Routes a message window. Every message in the window counts (the model sees them all), so an
 * earlier symptom keeps a later "when is my visit?" in the high tier. The scope classifier's
 * signals (injection, a possible third party, mixed or Latin-letter Armenian) mark the route unsure.
 */
export function routeTier(texts:string[],scope:Pick<ScopeResult,'injection'|'thirdPartyPossible'|'language'>,classifier?:TierClassifier):TierDecision{
 const matched=new Set<string>();let base:Tier|null=null;let unmatched=false;
 for(const raw of texts){
  const t=normaliseText(raw);let any=false;const matchedHere:string[]=[];
  for(const r of TIER_RULES)if(r.re.test(t)){matched.add(r.id);matchedHere.push(r.id);base=base?max(base,r.tier):r.tier;any=true;}
  if(!matched.has('symptom')&&mentionsSymptomWord(raw)){matched.add(SYMPTOM_WORD_RULE.id);base=base?max(base,SYMPTOM_WORD_RULE.tier):SYMPTOM_WORD_RULE.tier;any=true;}
  // A logistics or app message that also says how the member is ("today I have a feever"; Astra Z103-03): not logistics only.
  if(any&&!matchedHere.some(id=>TIER_RULES.find(r=>r.id===id)!.tier!=='low')&&HEALTH_HINT.test(t))unmatched=true;
  // A message of three or more words that no rule recognises (an unknown word may be a symptom): never the low tier for
  // the window. Small talk ("hey", "ok") stays out of it.
  if(!any&&(t.match(/\p{L}{2,}/gu)?.length??0)>=3)unmatched=true;
 }
 const unsure:string[]=[];
 if(!base){unsure.push('no_rule_matched');base='medium';}
 else if(unmatched&&base==='low')unsure.push('message_without_rule');
 const c=classifier?classifier(texts):null;
 if(c){
  if(c.tier)base=max(base,c.tier);
  if(!c.tier||!(c.confidence>=0.8))unsure.push('classifier_unsure');
 }
 if(scope.injection)unsure.push('injection_suspected');
 if(scope.thirdPartyPossible)unsure.push('third_party_possible');
 if(scope.language==='mixed'||scope.language==='hy-Latn')unsure.push(`language_${scope.language.replace('-','_').toLowerCase()}`);
 const tier=unsure.length?up(base):base;
 const rules=[...matched].sort();
 const reason=unsure.length?`unsure_${unsure[0]}_one_tier_up`:`rule_${[...TIER_RULES,SYMPTOM_WORD_RULE].find(r=>matched.has(r.id)&&r.tier===base)?.id??'none'}`;
 return {tier,base,reason,rules,unsure,classifier:c};
}

/** The admin page's read-only description of the rules. */
export const tierRuleSummary=TIERS.map(tier=>({tier,rules:[...TIER_RULES,SYMPTOM_WORD_RULE].filter(r=>r.tier===tier).map(r=>r.label)}));
