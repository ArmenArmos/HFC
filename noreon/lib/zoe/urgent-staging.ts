import type {ZoeDecision} from './policy';
import {normaliseText} from './normalise';
import {bpFirstPerson,bpReadings,currentBpClauses} from './bp-parse';
import type {UrgentLexicon,UrgentMatch,UrgentMatcher} from './urgent';
import {asserted,chestNotLevel1,chestPastOrStableNotNow,urgentFaintMention,futureStrokeQuestion,discounted,gapNegated,inCrisis,infarctInPast,nocturnalOnly,syncopeIsLevel1} from './symptoms/red-flags';
import {zoeUrgentPlaceholderOn} from '../ai-posture';

/**
 * STAGING PLACEHOLDER urgent-word list (Khikar, 17 Oct 2026 22:53: real AI for testing on
 * prod-as-staging; paperwork later). It is NOT the S1 list: nobody clinical has signed it, it is
 * PENDING TATEVIK'S S1 SIGN-OFF, and it must never be read as clinical coverage. It exists so a
 * typed urgent message takes the 103 path (no model, care-team alert) while staff test real AI.
 *
 * Active when NOREON_ZOE_URGENT_PLACEHOLDER is "true", or when it is unset on prod-as-staging
 * (lib/ai-posture.ts; Khikar, 19 Oct 01:28: keep AI on without the marker). Otherwise the matcher falls back to
 * the empty S1 list, which is "skipped": Zoe drafts nothing and calls no model until a signed list
 * exists. Over-matching is the intended failure: a false alarm costs a doctor a look; a miss is the
 * harm this list must never cause. Whether real members may rely on it is Tatevik's S1 sign-off.
 *
 * Each entry fires when every word stem is present in the normalised text, negated or not.
 */
export const STAGING_LEXICON_VERSION='staging-placeholder-not-s1-12';
export const stagingPlaceholderActive=(env:Record<string,string|undefined>=process.env)=>zoeUrgentPlaceholderOn(env);

type Flag='RF-01'|'RF-02'|'RF-03'|'RF-04'|'RF-05'|null;
/** selfHarm: the crisis text, and never discounted. Other entries with no RF id (poisoning, anaphylaxis, bleeding,
 * meningism, head injury, DKA, hypoglycaemia; Zoe spec v1 §7) take the ordinary urgent text. */
type Entry={id:string;locale:'en'|'hy'|'ru';all:readonly string[];redFlag:Flag;selfHarm:boolean;
 /** All stems in one sentence, that sentence not negated, past or about someone else (the 19 Oct additions). */sentence?:boolean;
 /** Spec v1.1 Appendix A narrowing (Armen 20 Oct; ARMEN_WORDING §4): which non-Level-1 form of the trigger is not counted.
  * faint: a faint without a Level 1 feature (S036); chest: chest pain reproducible on pressing or present for days with no Level 1
  * feature (S028); infarct: a heart attack in the past (S019, S026); night: waking at night breathless (S042). */
 v11?:'faint'|'chest'|'infarct'|'night';
 /** Words that contain a stem but are not the trigger (HY «սրտխառնոց» nausea, «սրտաբան» cardiologist, «նախասիրտ» atrium). */mask?:RegExp;
 /** A combination that counts only inside one message, so the batch checks skip it. */oneMessage?:boolean;
 /** Every stem must stand as whole words ("end it tonight" is not inside "send it tonight"). */wb?:boolean};
const e=(id:string,locale:Entry['locale'],redFlag:Flag,...all:string[]):Entry=>({id,locale,all,redFlag,selfHarm:id.startsWith('S-SELF')});
/** Whole-word entry: the stems are matched on word boundaries. */
const eb=(id:string,locale:Entry['locale'],redFlag:Flag,...all:string[]):Entry=>({...e(id,locale,redFlag,...all),wb:true});
const es=(id:string,locale:Entry['locale'],redFlag:Flag,...all:string[]):Entry=>({...e(id,locale,redFlag,...all),sentence:true});
const v=(x:Entry,v11:NonNullable<Entry['v11']>,more:Partial<Entry>={}):Entry=>({...x,v11,...more});
const HEART_MASK=/նախասրտ|սրտխ|սրտաբան|սրտանոթ|srtx|srtaban/gu;
// "Blood pressure" is not chest pressure, and a BP cuff tight on the arm or chest is equipment (T1 audit).
const CUFF_MASK=/blood pressure|bp cuff|cuff[^.!?\n]{0,25}tight|tight[^.!?\n]{0,15}cuff/gu;

export const STAGING_ENTRIES:readonly Entry[]=Object.freeze([
 // Chest pain or pressure (RF-01)
 // Spec v1.1: pain that is "chest" and "pain" only may be narrowed (v11 'chest'); pressure, tightness and crushing never are.
 v(e('S-CHEST-EN-1','en','RF-01','chest','pain'),'chest'),v(e('S-CHEST-EN-2','en','RF-01','chest','hurt'),'chest'),{...e('S-CHEST-EN-3','en','RF-01','chest','pressure'),mask:CUFF_MASK},
 {...e('S-CHEST-EN-4','en','RF-01','chest','tight'),mask:CUFF_MASK},e('S-CHEST-EN-5','en','RF-01','crushing'),v(es('S-CHEST-EN-6','en','RF-01','heart attack'),'infarct'),
 v(e('S-CHEST-HY-1','hy','RF-01','կրծք','ցավ'),'chest'),{...e('S-CHEST-HY-2','hy','RF-01','կրծք','սեղմ'),mask:/սեղմելիս|սեղմում եմ|սեղմեմ|սեղմեցի/gu},v(e('S-CHEST-HY-3','hy','RF-01','սրտ','ցավ'),'chest',{mask:HEART_MASK}),v(es('S-CHEST-HY-4','hy','RF-01','ինֆարկտ'),'infarct'),
 v(e('S-CHEST-HYL-1','hy','RF-01','krtsk','cav'),'chest'),v(e('S-CHEST-HYL-2','hy','RF-01','krck','cav'),'chest'),v(e('S-CHEST-HYL-3','hy','RF-01','sirt','cav'),'chest'),
 // QA round 2 R08: Latin-letter spellings of «կրծք» (krtsq, krcq, krtsq, kurck) and «ցավ» (cav, tsav).
 v(e('S-CHEST-HYL-4','hy','RF-01','krtsq','cav'),'chest'),v(e('S-CHEST-HYL-5','hy','RF-01','krcq','cav'),'chest'),v(e('S-CHEST-HYL-6','hy','RF-01','krtsk','tsav'),'chest'),v(e('S-CHEST-HYL-7','hy','RF-01','krtsq','tsav'),'chest'),v(e('S-CHEST-HYL-8','hy','RF-01','kurck','cav'),'chest'),
 v(e('S-CHEST-RU-1','ru','RF-01','бол','груд'),'chest'),
 // T1/C1 audit: common transposition typos ("chset", "pian") and the nominative «կուրծքս» ("my chest"; «կուրծքս սեղմում ա»).
 v(e('S-CHEST-EN-14','en','RF-01','chset','pain'),'chest'),v(e('S-CHEST-EN-15','en','RF-01','chest','pian'),'chest'),v(e('S-CHEST-EN-16','en','RF-01','chset','hurt'),'chest'),
 {...e('S-CHEST-HY-7','hy','RF-01','կուրծք','սեղմ'),mask:/սեղմելիս|սեղմում եմ|սեղմեմ|սեղմեցի|կուրծքով|կրծքով|կրծքագեղձ\p{L}*/gu},v(e('S-CHEST-HY-8','hy','RF-01','կուրծք','ցավ'),'chest',{mask:/կուրծքով|կրծքով|կրծքագեղձ\p{L}*/gu}),
 // «дав» matched «давление» (Fable audit 9): «давление 140/90, грудь не болит» opened 103. Only the pressing verb forms.
 e('S-CHEST-RU-2','ru','RF-01','давит','груд'),e('S-CHEST-RU-5','ru','RF-01','давящ','груд'),e('S-CHEST-RU-6','ru','RF-01','сдавл','груд'),e('S-CHEST-RU-3','ru','RF-01','жжет','груд'),v(es('S-CHEST-RU-4','ru','RF-01','инфаркт'),'infarct'),v(es('S-CHEST-HYL-11','hy','RF-01','infarkt'),'infarct'),
 // "My heart hurts" is how many members say chest pain (Fable audit 2): HY nominative «սիրտ», HY-Latn «srt», EN, RU.
 v(e('S-CHEST-HY-5','hy','RF-01','սիրտ','ցավ'),'chest'),v(e('S-CHEST-HYL-9','hy','RF-01','srt','cav'),'chest',{mask:HEART_MASK}),v(e('S-CHEST-HYL-10','hy','RF-01','sirt','tsav'),'chest'),
 v(e('S-CHEST-EN-7','en','RF-01','heart hurt'),'chest'),v(e('S-CHEST-EN-8','en','RF-01','heart ach'),'chest'),v(e('S-CHEST-EN-9','en','RF-01','heart is hurting'),'chest'),v(e('S-CHEST-EN-10','en','RF-01','heart is aching'),'chest'),v(e('S-CHEST-EN-11','en','RF-01','pain in my heart'),'chest'),
 v(e('S-CHEST-RU-7','ru','RF-01','сердц','болит'),'chest'),e('S-CHEST-RU-8','ru','RF-01','сердц','колет'),e('S-CHEST-RU-9','ru','RF-01','сердц','схватил'),
 e('S-CHEST-RU-10','ru','RF-01','сердц','сжима'),e('S-CHEST-RU-11','ru','RF-01','сердц','давит'),
 // Breathing, palpitations with dizziness, near-fainting (RF-02)
 e('S-BREATH-EN-1','en','RF-02',"can't breathe"),e('S-BREATH-EN-2','en','RF-02','cannot breathe'),e('S-BREATH-EN-3','en','RF-02','can not breathe'),
 e('S-BREATH-EN-4','en','RF-02','struggling to breathe'),v(e('S-BREATH-EN-5','en','RF-02','short of breath'),'night'),v(e('S-BREATH-EN-6','en','RF-02','fainted'),'faint'),
 v(e('S-BREATH-EN-7','en','RF-02','passed out'),'faint'),e('S-BREATH-EN-8','en','RF-02','heart','racing','dizz'),
 e('S-BREATH-HY-1','hy','RF-02','չեմ կարողանում շնչել'),e('S-BREATH-HY-2','hy','RF-02','շնչել չեմ կարողանում'),v(e('S-BREATH-HY-3','hy','RF-02','շնչահեղձ'),'night'),
 v(e('S-BREATH-HY-4','hy','RF-02','ուշագնաց'),'faint'),v(e('S-BREATH-HY-5','hy','RF-02','ուշաթափ'),'faint'),
 e('S-BREATH-HYL-1','hy','RF-02','chem karum shnchel'),e('S-BREATH-HYL-2','hy','RF-02','chem karoxanum shnchel'),
 // Latin-letter Armenian (Fable audit 3) and someone else's emergency in RU/HY/EN (Fable audit 4).
 e('S-BREATH-HYL-3','hy','RF-02','chi karoxanum shnchel'),e('S-BREATH-HYL-4','hy','RF-02','shnchel chi karoxanum'),v(e('S-BREATH-HYL-5','hy','RF-02','xexdvum'),'night'),
 e('S-BREATH-HYL-6','hy','RF-02','shunchs ktrv'),e('S-BREATH-HYL-7','hy','RF-02','od chi herikum'),e('S-BREATH-HYL-8','hy','RF-02','od chi bavakanacnum'),
 v(e('S-BREATH-HYL-9','hy','RF-02','ushatap'),'faint'),v(e('S-BREATH-HYL-10','hy','RF-02','ushagnac'),'faint'),v(e('S-BREATH-HYL-11','hy','RF-02','ushqs gnac'),'faint'),v(e('S-BREATH-HYL-12','hy','RF-02','ushqy gnac'),'faint'),
 e('S-BREATH-HY-6','hy','RF-02','չի կարողանում շնչել'),e('S-BREATH-HY-7','hy','RF-02','շնչել չի կարողանում'),
 e('S-BREATH-RU-5','ru','RF-02','не может дышать'),e('S-BREATH-RU-6','ru','RF-02','нечем дышать'),e('S-BREATH-RU-7','ru','RF-02','теря','сознани'),
 e('S-BREATH-EN-9','en','RF-02','collapsed'),
 e('S-BREATH-RU-1','ru','RF-02','не могу дышать'),v(e('S-BREATH-RU-2','ru','RF-02','задыха'),'night'),v(e('S-BREATH-RU-3','ru','RF-02','обморок'),'faint'),e('S-BREATH-RU-4','ru','RF-02','потерял','сознани'),
 // Trouble speaking or moving (RF-04)
 e('S-STROKE-EN-1','en','RF-04','face','droop'),e('S-STROKE-EN-2','en','RF-04','slurred'),e('S-STROKE-EN-3','en','RF-04',"can't speak"),e('S-STROKE-EN-4','en','RF-04','cannot speak'),
 e('S-STROKE-EN-5','en','RF-04',"can't move my"),{...e('S-STROKE-EN-6','en','RF-04','stroke'),mask:/(?:breast|back|key|brush|master|pen)strokes?/gu},
 e('S-STROKE-HY-1','hy','RF-04','խոսել չեմ կարողանում'),e('S-STROKE-HY-2','hy','RF-04','չեմ կարողանում խոսել'),e('S-STROKE-HY-3','hy','RF-04','դեմք','ծռվ'),e('S-STROKE-HY-4','hy','RF-04','ինսուլտ'),
 e('S-STROKE-HY-5','hy','RF-04','չի կարողանում խոսել'),e('S-STROKE-HY-6','hy','RF-04','խոսել չի կարողանում'),
 e('S-STROKE-HYL-1','hy','RF-04','tmrel'),e('S-STROKE-HYL-2','hy','RF-04','tmrum'),e('S-STROKE-HYL-3','hy','RF-04','crvel'),e('S-STROKE-HYL-4','hy','RF-04','chem karoxanum xosel'),
 e('S-STROKE-HYL-5','hy','RF-04','xosel chem karoxanum'),e('S-STROKE-HYL-6','hy','RF-04','chi karoxanum xosel'),e('S-STROKE-HYL-7','hy','RF-04','lezus kapvel'),
 e('S-STROKE-HYL-8','hy','RF-04','tulacel'),e('S-STROKE-HYL-9','hy','RF-04','insult exav'),e('S-STROKE-HYL-10','hy','RF-04','insult em'),e('S-STROKE-HYL-11','hy','RF-04','insult a'),
 e('S-STROKE-RU-5','ru','RF-04','не может говорить'),e('S-STROKE-RU-6','ru','RF-04','улыбк','крив'),e('S-STROKE-HY-7','hy','RF-04','կիսադեմ','թեքվ'),
 e('S-STROKE-EN-7','en','RF-04','crooked smile'),e('S-STROKE-EN-8','en','RF-04','smile','crooked'),{...e('S-STROKE-EN-9','en','RF-04','smile','lopsided'),mask:/(?:naturally|always|a bit|slightly|a little)\s+lopsided|lopsided[^.!?\n]{0,30}(?:photos?|photographs?|pictures?|selfies?|since (?:birth|childhood)|all my life|always|naturally)/gu},e('S-STROKE-HY-12','hy','RF-04','ժպիտ','ծռվ'),
 e('S-STROKE-RU-1','ru','RF-04','не могу говорить'),e('S-STROKE-RU-2','ru','RF-04','перекосил'),e('S-STROKE-RU-3','ru','RF-04','онемел'),e('S-STROKE-RU-4','ru','RF-04','инсульт'),
 // Seizures or clouded consciousness (RF-05)
 e('S-SEIZ-EN-1','en','RF-05','seizure'),e('S-SEIZ-EN-2','en','RF-05','convuls'),e('S-SEIZ-EN-3','en','RF-05','unconscious'),
 e('S-SEIZ-HY-1','hy','RF-05','ցնցում'),e('S-SEIZ-HY-2','hy','RF-05','ցնցումներ'),
 e('S-SEIZ-HYL-1','hy','RF-05','cncum'),e('S-SEIZ-HYL-2','hy','RF-05','nopa'),e('S-SEIZ-HYL-3','hy','RF-05','angitakic'),e('S-SEIZ-HY-3','hy','RF-05','անգիտակից'),e('S-SEIZ-HY-4','hy','RF-05','նոպա'),
 e('S-SEIZ-RU-1','ru','RF-05','судорог'),e('S-SEIZ-RU-2','ru','RF-05','без сознания'),
 // Lead 19 Oct 21:50 (go-live suites, robustness and out-of-scope baselines; Zoe spec v1 §7 universal 103 list). Colloquial,
 // HY-RU mixed, typo and Latin-letter forms of the dataset's 103 cases, and the 103 triggers outside the three domains.
 // Fainting or blacking out, colloquial (RF-02; R035).
 // A faint said colloquially (v11 'faint'); a loss of consciousness keeps firing.
 v(es('S-FAINT-HY-1','hy','RF-02','անջատվեցի'),'faint'),v(es('S-FAINT-HY-2','hy','RF-02','անջատվել եմ'),'faint'),es('S-FAINT-HY-3','hy','RF-02','գիտակցությունը կորց'),es('S-FAINT-HY-4','hy','RF-02','գիտակցությունս կորց'),
 es('S-FAINT-HY-5','hy','RF-02','գիտակցությունը կորել'),v(es('S-FAINT-HYL-1','hy','RF-02','anjatvetsi'),'faint'),v(es('S-FAINT-HYL-2','hy','RF-02','anjatvel em'),'faint'),es('S-FAINT-HYL-3','hy','RF-02','gitakcutyun','korc'),
 v(es('S-FAINT-RU-1','ru','RF-02','отключился'),'faint'),v(es('S-FAINT-RU-2','ru','RF-02','отключилась'),'faint'),v(es('S-FAINT-RU-3','ru','RF-02','вырубил'),'faint'),es('S-FAINT-RU-4','ru','RF-02','потеряла сознани'),
 v(es('S-FAINT-EN-1','en','RF-02','blacked out'),'faint'),es('S-FAINT-EN-2','en','RF-02','lost consciousness'),es('S-FAINT-EN-3','en','RF-02','knocked out'),
 // Breathlessness in RU and HY-RU mix (RF-02; R046), an infant's chest pulling in (O25).
 es('S-BREATH-RU-8','ru','RF-02','не хватает воздуха'),es('S-BREATH-RU-9','ru','RF-02','воздуха не хватает'),es('S-BREATH-RU-10','ru','RF-02','дыхания не хватает'),es('S-BREATH-RU-11','ru','RF-02','не хватает дыхания'),
  es('S-BREATH-HY-11','hy','RF-02','կրծքավանդակը ներս'),es('S-BREATH-RU-12','ru','RF-02','грудь втягива'),es('S-BREATH-RU-13','ru','RF-02','втягивается'),es('S-BREATH-EN-10','en','RF-02','chest','pulling in'),es('S-BREATH-EN-11','en','RF-02','chest','sucking in'),
 // Seizure forms (RF-05; O14).
 es('S-SEIZ-HY-5','hy','RF-05','ցնցվել'),es('S-SEIZ-HY-6','hy','RF-05','ցնցվում'),es('S-SEIZ-HYL-4','hy','RF-05','cncvel'),es('S-SEIZ-HYL-5','hy','RF-05','cncvum'),es('S-SEIZ-RU-3','ru','RF-05','бьется в судорог'),es('S-SEIZ-RU-4','ru','RF-05','припад'),
 es('S-SEIZ-EN-4','en','RF-05','fit','shaking'),
 // Speech colloquial (RF-04; R006).
 es('S-STROKE-HY-8','hy','RF-04','խոսալս','դժվար'),es('S-STROKE-HY-9','hy','RF-04','խոսելս','դժվար'),es('S-STROKE-HY-10','hy','RF-04','խոսքս','դժվար'),es('S-STROKE-HY-11','hy','RF-04','լեզուս','կապ'),
 // Diabetic emergencies: combinations below (COMBOS, message-wide with per-symptom negation; Astra #355 F1-F4).
 es('S-DKA-EN-3','en',null,'ketoacid'),es('S-DKA-RU-3','ru',null,'кетоацид'),
 // Exertional "heartburn" at rest that does not pass in a person with diabetes (RF-01; S025, R025). These and the mushroom
 // entries span sentences (the diabetes or the meal is often said apart), so they are message-wide, negation still applies.
 e('S-CHEST-HY-6','hy','RF-01','ստամոքս','այր','չի անցնում','շաքար'),e('S-CHEST-RU-12','ru','RF-01','жж','не проход','диабет'),e('S-CHEST-RU-13','ru','RF-01','жж','не проход','сахар'),
 e('S-CHEST-EN-12','en','RF-01','heartburn','diabet',"won't go"),e('S-CHEST-EN-13','en','RF-01','heartburn','diabet','not going'),
 // Outside the three domains (spec §7). Meningism, head injury, poisoning and GI bleeding are COMBOS below; these are single phrases.
 es('S-MEN-HY-2','hy',null,'սեղմելիս չեն անցնում'),es('S-MEN-RU-2','ru',null,'сып','не исчеза'),es('S-MEN-EN-3','en',null,'rash','glass'),es('S-MEN-EN-4','en',null,'rash',"doesn't fade"),
 es('S-POIS-EN-3','en',null,'too many pills'),es('S-POIS-EN-7','en',null,'too many tablets'),es('S-POIS-EN-8','en',null,'handful of','pills'),es('S-POIS-EN-9','en',null,'handful of','tablets'),
 es('S-POIS-EN-6','en',null,'overdose'),es('S-POIS-RU-3','ru',null,'наглотал'),es('S-POIS-RU-6','ru',null,'передозир'),es('S-POIS-HY-7','hy',null,'շատ հաբ','խմել'),es('S-POIS-HY-8','hy',null,'գերդոզ'),
 es('S-ANA-HY-1','hy',null,'շրթունք','ուռ'),es('S-ANA-HY-2','hy',null,'լեզու','ուռ'),es('S-ANA-HY-3','hy',null,'կոկորդ','ուռ'),es('S-ANA-RU-1','ru',null,'губ','отек'),es('S-ANA-RU-2','ru',null,'язык','отек'),es('S-ANA-RU-3','ru',null,'горл','отек'),es('S-ANA-RU-4','ru',null,'квинке'),
 es('S-ANA-EN-1','en',null,'lip','swell'),es('S-ANA-EN-2','en',null,'tongue','swell'),es('S-ANA-EN-3','en',null,'throat','swell'),es('S-ANA-EN-4','en',null,'anaphyla'),
  es('S-BLEED-HY-1','hy',null,'առատ','արյունահոս'),es('S-BLEED-HY-2','hy',null,'արյունը չի կանգնում'),es('S-BLEED-RU-1','ru',null,'сильное кровотечение'),es('S-BLEED-RU-2','ru',null,'кровь не останавлива'),
 es('S-BLEED-EN-1','en',null,'heavy bleeding'),es('S-BLEED-EN-2','en',null,'bleeding',"won't stop"),es('S-BLEED-EN-3','en',null,'bleeding heavily'),es('S-BLEED-EN-4','en',null,"won't stop bleeding"),es('S-BLEED-HY-3','hy',null,'արյունահոսությունը կանգ չի առնում'),
 es('S-LIMB-HY-1','hy',null,'ոտք','սառ','թմր'),es('S-LIMB-HY-2','hy',null,'ձեռք','սառ','թմր'),es('S-LIMB-RU-1','ru',null,'ног','холодн','онем'),es('S-LIMB-EN-1','en',null,'cold','numb','leg'),es('S-LIMB-EN-2','en',null,'cold','numb','arm'),
 // Spec v1.1 Appendix A Level 1 (Armen 20 Oct): the universal and crisis triggers in EN, HY (Armenian and Latin letters) and RU.
 // Cold, pale, numb or immobile limb.
 es('S-LIMB-EN-3','en',null,'cold','pale','leg'),es('S-LIMB-EN-4','en',null,'cold','pale','arm'),es('S-LIMB-EN-5','en',null,'cold','pale','foot'),es('S-LIMB-EN-6','en',null,'cold','blue','leg'),es('S-LIMB-EN-7','en',null,'cold','blue','foot'),
 es('S-LIMB-EN-8','en',null,'leg','cold',"can't move"),es('S-LIMB-EN-9','en',null,'arm','cold',"can't move"),es('S-LIMB-EN-10','en',null,'leg','cold','cannot move'),es('S-LIMB-EN-11','en',null,'arm','cold','cannot move'),
 es('S-LIMB-RU-7','ru',null,'ног','холодн','не могу пошевел'),es('S-LIMB-HY-7','hy',null,'ոտք','սառ','չեմ կարողանում շարժ'),es('S-LIMB-HYL-4','hy',null,'otq','sar','chem karoxanum sharj'),
 es('S-LIMB-RU-2','ru',null,'рук','холодн','онем'),es('S-LIMB-RU-3','ru',null,'ног','холодн','бледн'),es('S-LIMB-RU-4','ru',null,'рук','холодн','бледн'),es('S-LIMB-RU-5','ru',null,'ног','холодн','не шевел'),es('S-LIMB-RU-6','ru',null,'ног','холодн','посинел'),
 es('S-LIMB-HY-3','hy',null,'ոտք','սառ','գունատ'),es('S-LIMB-HY-4','hy',null,'ձեռք','սառ','գունատ'),es('S-LIMB-HY-5','hy',null,'ոտք','սառ','չի շարժվում'),es('S-LIMB-HY-6','hy',null,'ոտք','սառ','կապտ'),
 es('S-LIMB-HYL-1','hy',null,'otq','sar','tmr'),es('S-LIMB-HYL-2','hy',null,'dzerq','sar','tmr'),es('S-LIMB-HYL-3','hy',null,'otq','sar','gunat'),
 // Anaphylaxis: named, or an adrenaline pen used.
 es('S-ANA-RU-5','ru',null,'анафилак'),es('S-ANA-HY-4','hy',null,'անաֆիլակ'),es('S-ANA-EN-5','en',null,'epipen'),es('S-ANA-EN-6','en',null,'epi-pen'),es('S-ANA-EN-7','en',null,'adrenaline pen'),es('S-ANA-RU-6','ru',null,'эпипен'),
 es('S-ANA-HYL-1','hy',null,'shrtunq','urr'),es('S-ANA-HYL-2','hy',null,'lezus','urr'),es('S-ANA-HYL-3','hy',null,'kokord','urr'),
 // Seizures.
 es('S-SEIZ-EN-5','en','RF-05','having a fit'),es('S-SEIZ-EN-6','en','RF-05','epileptic fit'),es('S-SEIZ-RU-5','ru','RF-05','судорожн'),es('S-SEIZ-RU-6','ru','RF-05','эпилептическ','приступ'),es('S-SEIZ-HY-7','hy','RF-05','էպիլեպտիկ','նոպա'),
 // Poisoning, overdose, toxic ingestion (food poisoning is not: COMBOS S-POIS-3 excludes it).
 es('S-POIS-EN-10','en',null,'took all my pills'),es('S-POIS-EN-11','en',null,'whole bottle of','pills'),es('S-POIS-EN-12','en',null,'whole box of','tablets'),es('S-POIS-EN-13','en',null,'carbon monoxide'),
 es('S-POIS-RU-7','ru',null,'выпил','все таблетки'),es('S-POIS-RU-8','ru',null,'целую пачку'),es('S-POIS-RU-9','ru',null,'угарн'),
 es('S-POIS-HY-9','hy',null,'բոլոր հաբերը','խմ'),es('S-POIS-HY-10','hy',null,'ամբողջ տուփ','հաբ'),es('S-POIS-HY-11','hy',null,'շմոլ'),es('S-POIS-HYL-1','hy',null,'gerdoz'),es('S-POIS-HYL-2','hy',null,'tunavorv'),
 // Severe bleeding or haemorrhage.
 es('S-BLEED-EN-5','en',null,'bleeding a lot'),es('S-BLEED-EN-6','en',null,'lots of blood'),es('S-BLEED-EN-7','en',null,'blood everywhere'),es('S-BLEED-EN-8','en',null,'blood','spurting'),es('S-BLEED-EN-9','en',null,'severe bleeding'),
 es('S-BLEED-RU-3','ru',null,'кровь хлещет'),es('S-BLEED-RU-4','ru',null,'много крови'),es('S-BLEED-RU-5','ru',null,'сильно кровоточит'),es('S-BLEED-RU-6','ru',null,'кровотечение','не останавлива'),
 es('S-BLEED-HY-4','hy',null,'շատ արյուն'),es('S-BLEED-HY-5','hy',null,'ուժեղ արյունահոս'),es('S-BLEED-HY-6','hy',null,'արյունը','չի կանգն'),
 es('S-BLEED-HYL-1','hy',null,'aryun','chi kangn'),es('S-BLEED-HYL-2','hy',null,'arat aryunahos'),es('S-BLEED-HYL-3','hy',null,'shat aryun'),
 // Self-harm (no cardiometabolic red flag applies; still the urgent route)
 e('S-SELF-EN-1','en',null,"don't want to live"),e('S-SELF-EN-2','en',null,'kill myself'),e('S-SELF-EN-3','en',null,'end my life'),e('S-SELF-EN-4','en',null,'suicid'),
 // QA round 2 R10: the common phrasings, not one exact phrase.
 e('S-SELF-EN-5','en',null,'not want to live'),e('S-SELF-EN-6','en',null,'dont want to live'),e('S-SELF-EN-7','en',null,'want to die'),e('S-SELF-EN-8','en',null,'wanna die'),
 eb('S-SELF-EN-9','en',null,'end it all'),e('S-SELF-EN-10','en',null,'no point','living'),e('S-SELF-EN-11','en',null,'better off dead'),e('S-SELF-EN-12','en',null,'hurt myself'),e('S-SELF-EN-13','en',null,'harm myself'),
 e('S-SELF-EN-14','en',null,'take my own life'),e('S-SELF-EN-15','en',null,"can't go on living"),e('S-SELF-EN-16','en',null,'not worth living'),
 e('S-SELF-HY-3','hy',null,'ուզում եմ մեռնել'),e('S-SELF-HY-4','hy',null,'մեռնել եմ ուզում'),e('S-SELF-HY-5','hy',null,'ինձ սպանել'),e('S-SELF-HY-6','hy',null,'ապրելու իմաստ'),
 e('S-SELF-HYL-1','hy',null,'chem uzum aprel'),e('S-SELF-HYL-2','hy',null,'uzum em mernel'),e('S-SELF-HYL-3','hy',null,'mernel em uzum'),e('S-SELF-HYL-4','hy',null,'chem uzum','aprem'),
 e('S-SELF-RU-4','ru',null,'хочу умереть'),e('S-SELF-RU-5','ru',null,'не хочу','жить'),e('S-SELF-RU-6','ru',null,'нет смысла жить'),e('S-SELF-RU-7','ru',null,'покончить','собой'),e('S-SELF-RU-8','ru',null,'убить себя'),
 e('S-SELF-HY-1','hy',null,'չեմ ուզում','ապրել'),e('S-SELF-HY-2','hy',null,'ինքնասպան'),
 e('S-SELF-RU-1','ru',null,'не хочу жить'),e('S-SELF-RU-2','ru',null,'покончить с собой'),e('S-SELF-RU-3','ru',null,'суицид'),
 // Fable FB-06 (#360 review): the conjugated and common Russian phrasings, as the EN/HY lists have them («Лучше покончу с собой» matched nothing).
 e('S-SELF-RU-9','ru',null,'поконч','собой'),e('S-SELF-RU-10','ru',null,'поконч','с жизнью'),e('S-SELF-RU-11','ru',null,'счеты с жизнью'),e('S-SELF-RU-12','ru',null,'счёты с жизнью'),
 e('S-SELF-RU-13','ru',null,'на себя руки'),e('S-SELF-RU-14','ru',null,'убью себя'),e('S-SELF-RU-15','ru',null,'убил бы себя'),e('S-SELF-RU-16','ru',null,'убила бы себя'),
 e('S-SELF-RU-17','ru',null,'не хочется','жить'),e('S-SELF-RU-18','ru',null,'хочется умереть'),e('S-SELF-RU-19','ru',null,'лучше умереть'),e('S-SELF-RU-20','ru',null,'лучше бы я умер'),
 e('S-SELF-RU-21','ru',null,'смысла жить'),e('S-SELF-RU-22','ru',null,'жить','нет смысла'),e('S-SELF-RU-23','ru',null,'незачем жить'),e('S-SELF-RU-24','ru',null,'жить незачем'),
 e('S-SELF-RU-25','ru',null,'самоубий'),e('S-SELF-RU-26','ru',null,'умереть хочу'),
 // Astra Z366-01: first-person intent only; «боюсь причинить себе вред дозой» and «так жить с диабетом трудно» are ordinary worries.
 // Fable #522 R1: a named method, in the first person or not.
 e('S-SELF-EN-17','en',null,'hang myself'),e('S-SELF-EN-18','en',null,'drown myself'),e('S-SELF-EN-19','en',null,'shoot myself'),e('S-SELF-EN-20','en',null,'drive into a wall'),
 e('S-SELF-RU-31','ru',null,'повеситься'),e('S-SELF-RU-32','ru',null,'повешусь'),e('S-SELF-RU-33','ru',null,'утопиться'),e('S-SELF-RU-34','ru',null,'утоплюсь'),e('S-SELF-RU-35','ru',null,'застрелиться'),e('S-SELF-RU-36','ru',null,'застрелюсь'),
 // Astra (S0-4 audit, round 1): explicit methods that were missed, so they fell to the ordinary handoff: wrists and veins, in the first person or not.
 e('S-SELF-EN-21','en',null,'slit my wrists'),e('S-SELF-EN-22','en',null,'cut my wrists'),e('S-SELF-EN-23','en',null,'slash my wrists'),e('S-SELF-EN-24','en',null,'cut my veins'),e('S-SELF-EN-25','en',null,'slit my veins'),e('S-SELF-EN-26','en',null,'cut my throat'),
 e('S-SELF-RU-37','ru',null,'вскрыть вены'),e('S-SELF-RU-38','ru',null,'вскрою вены'),e('S-SELF-RU-39','ru',null,'вскрыть себе вены'),e('S-SELF-RU-40','ru',null,'вскрою себе вены'),e('S-SELF-RU-41','ru',null,'перерезать вены'),e('S-SELF-RU-42','ru',null,'перережу вены'),e('S-SELF-RU-43','ru',null,'порезать вены'),e('S-SELF-RU-44','ru',null,'порежу вены'),
 e('S-SELF-HY-9','hy',null,'երակներս կտրել'),e('S-SELF-HY-10','hy',null,'երակներս կտրեմ'),e('S-SELF-HY-11','hy',null,'երակս կտրել'),e('S-SELF-HY-12','hy',null,'երակս կտրեմ'),e('S-SELF-HYL-7','hy',null,'erakners ktrel'),e('S-SELF-HYL-8','hy',null,'erakners ktrem'),
 // Astra round 2: explicit intent, jumping, poisoning and swallowing pills, in the three languages and Latin-letter Armenian. The staging list is a placeholder until Armen's signed list;
 // the trade-off stays false alarms over misses ("end it tonight", "jump off the roof" in the first person).
 eb('S-SELF-EN-27','en',null,'end it tonight'),eb('S-SELF-EN-28','en',null,'end it today'),eb('S-SELF-EN-29','en',null,'jump off the roof'),eb('S-SELF-EN-30','en',null,'jump off a bridge'),eb('S-SELF-EN-31','en',null,'jump off the bridge'),eb('S-SELF-EN-32','en',null,'jump off the balcony'),
 eb('S-SELF-EN-33','en',null,'jump in front of'),eb('S-SELF-EN-34','en',null,'poison myself'),eb('S-SELF-EN-35','en',null,'gas myself'),eb('S-SELF-EN-38','en',null,'take an overdose'),eb('S-SELF-EN-39','en',null,'overdose on purpose'),
 e('S-SELF-RU-45','ru',null,'прыгнуть с крыши'),e('S-SELF-RU-46','ru',null,'прыгну с крыши'),e('S-SELF-RU-47','ru',null,'спрыгну с крыши'),e('S-SELF-RU-48','ru',null,'спрыгнуть с крыши'),e('S-SELF-RU-49','ru',null,'прыгнуть с моста'),e('S-SELF-RU-50','ru',null,'прыгну с моста'),e('S-SELF-RU-51','ru',null,'с балкона','прыгн'),
 e('S-SELF-RU-52','ru',null,'отравлюсь'),e('S-SELF-RU-53','ru',null,'отравить себя'),e('S-SELF-RU-54','ru',null,'отравлю себя'),e('S-SELF-RU-55','ru',null,'выпью все таблетки'),e('S-SELF-RU-56','ru',null,'выпить все таблетки'),e('S-SELF-RU-57','ru',null,'наглотаюсь таблеток'),e('S-SELF-RU-58','ru',null,'сегодня ночью','покончу'),
 e('S-SELF-HY-13','hy',null,'տանիքից ցած'),e('S-SELF-HY-14','hy',null,'ցած նետվ','տանիք'),e('S-SELF-HY-15','hy',null,'թունավորեմ'),e('S-SELF-HY-16','hy',null,'թունավորել ինձ'),e('S-SELF-HY-17','hy',null,'բոլոր հաբերը խմ'),e('S-SELF-HY-18','hy',null,'բոլոր դեղերը խմ'),e('S-SELF-HY-19','hy',null,'ինձ գազով'),
 e('S-SELF-HYL-9','hy',null,'bolor habery xmel'),e('S-SELF-HYL-10','hy',null,'bolor dexery xmel'),e('S-SELF-HYL-11','hy',null,'tanikic ceric'),e('S-SELF-HYL-12','hy',null,'indz gazov'),e('S-SELF-HYL-13','hy',null,'indz thunavorel'),e('S-SELF-HYL-14','hy',null,'indz tunavorel'),
 // Astra round 3: ordinary possessive and infinitive variants of the same phrases ("jump off my balcony", "хочу отравиться", "собираюсь отравиться газом").
 eb('S-SELF-EN-40','en',null,'jump off','balcony'),eb('S-SELF-EN-41','en',null,'jump off','roof'),eb('S-SELF-EN-42','en',null,'jump off','bridge'),eb('S-SELF-EN-43','en',null,'jump off','building'),eb('S-SELF-EN-44','en',null,'jump from','balcony'),eb('S-SELF-EN-45','en',null,'jump from','roof'),eb('S-SELF-EN-46','en',null,'jump from','bridge'),eb('S-SELF-EN-47','en',null,'jump from','window'),eb('S-SELF-EN-48','en',null,'jump out of','window'),
 eb('S-SELF-EN-49','en',null,'throw myself'),eb('S-SELF-EN-50','en',null,'drink poison'),eb('S-SELF-EN-51','en',null,'drink bleach'),eb('S-SELF-EN-52','en',null,'poison','myself'),
 e('S-SELF-RU-59','ru',null,'отравиться'),e('S-SELF-RU-60','ru',null,'отравиться газом'),e('S-SELF-RU-61','ru',null,'выпить яд'),e('S-SELF-RU-62','ru',null,'выпью яд'),e('S-SELF-RU-63','ru',null,'выброситься из окна'),e('S-SELF-RU-64','ru',null,'выброшусь из окна'),e('S-SELF-RU-65','ru',null,'выпрыгнуть из окна'),e('S-SELF-RU-66','ru',null,'выпрыгну из окна'),e('S-SELF-RU-67','ru',null,'броситься под'),e('S-SELF-RU-68','ru',null,'прыгнуть','с балкона'),e('S-SELF-RU-69','ru',null,'прыгнуть','с крыши'),e('S-SELF-RU-70','ru',null,'прыгнуть','с моста'),e('S-SELF-RU-71','ru',null,'спрыгнуть','с балкона'),e('S-SELF-RU-72','ru',null,'спрыгнуть','с моста'),
 e('S-SELF-HY-20','hy',null,'թունավորվել'),e('S-SELF-HY-21','hy',null,'թույն խմել'),e('S-SELF-HY-22','hy',null,'ինձ թունավոր'),e('S-SELF-HY-23','hy',null,'ցած նետվել'),e('S-SELF-HY-24','hy',null,'պատշգամբից ցած'),e('S-SELF-HY-25','hy',null,'պատուհանից ցած'),
 e('S-SELF-HYL-15','hy',null,'tuyn xmel'),e('S-SELF-HYL-16','hy',null,'pashtgambic ceric'),e('S-SELF-HYL-17','hy',null,'ceric netvel'),
 e('S-SELF-HY-26','hy',null,'ինձ կսպանեմ'),e('S-SELF-HY-27','hy',null,'ինքս ինձ կսպանեմ'),e('S-SELF-HY-28','hy',null,'ինձ սպանելու'),e('S-SELF-HYL-18','hy',null,'indz kspanem'),e('S-SELF-HYL-19','hy',null,'indz spanel'),
 // Astra round 5: rooftop and other heights, Russian word order ("я себя убью"), Armenian future of hang / drown.
 eb('S-SELF-EN-54','en',null,'jump off','rooftop'),eb('S-SELF-EN-55','en',null,'jump from','rooftop'),eb('S-SELF-EN-56','en',null,'jump off','cliff'),eb('S-SELF-EN-57','en',null,'jump from','cliff'),eb('S-SELF-EN-58','en',null,'jump off','tower'),eb('S-SELF-EN-59','en',null,'jump off','roof top'),eb('S-SELF-EN-60','en',null,'jump off','window'),eb('S-SELF-EN-61','en',null,'hang myself'),eb('S-SELF-EN-62','en',null,'kill myself'),
 e('S-SELF-RU-73','ru',null,'себя убью'),e('S-SELF-RU-74','ru',null,'себя убить'),e('S-SELF-RU-75','ru',null,'убить себя'),e('S-SELF-RU-76','ru',null,'покончу с собой'),e('S-SELF-RU-77','ru',null,'повешу себя'),e('S-SELF-RU-78','ru',null,'себя повешу'),e('S-SELF-RU-79','ru',null,'зарежу себя'),e('S-SELF-RU-80','ru',null,'порежу себя'),e('S-SELF-RU-81','ru',null,'себя убила'),
 e('S-SELF-HY-29','hy',null,'ինձ կկախեմ'),e('S-SELF-HY-30','hy',null,'ինքս ինձ կկախեմ'),e('S-SELF-HY-31','hy',null,'ինձ կխեղդեմ'),e('S-SELF-HY-32','hy',null,'ինձ կթունավորեմ'),e('S-SELF-HY-33','hy',null,'ինձ կկտրեմ'),e('S-SELF-HYL-20','hy',null,'indz kkaxem'),e('S-SELF-HYL-21','hy',null,'indz kxexdem'),
 e('S-SELF-HY-7','hy',null,'ինձ կախել'),e('S-SELF-HY-8','hy',null,'ինձ խեղդել'),e('S-SELF-HYL-5','hy',null,'indz kaxel'),e('S-SELF-HYL-6','hy',null,'indz xexdel'),
 e('S-SELF-RU-27','ru',null,'хочу причинить себе вред'),e('S-SELF-RU-28','ru',null,'причиню себе вред'),e('S-SELF-RU-29','ru',null,'не могу больше так жить'),e('S-SELF-RU-30','ru',null,'больше не могу так жить'),
]);

// No negation handling (Fable F3, #236): "No. Chest pain." and "no chest pain yesterday, but today
// chest pain is terrible" are urgent. A negated mention ("no chest pain today") also escalates; that
// false alarm is the intended failure until the signed S1 list decides negation clinically.
const WB_CACHE=new Map<string,RegExp>();
const wordIn=(u:string,w:string)=>{let re=WB_CACHE.get(w);if(!re){re=new RegExp(`(?<![\\p{L}\\p{N}])${w.replace(/[.*+?^${}()|[\]\\]/gu,'\\$&')}(?![\\p{L}\\p{N}])`,'u');WB_CACHE.set(w,re);}return re.test(u);};
export function stagingMatches(text:string):Entry[]{
 if(futureStrokeQuestion(text))return [];
 const t0=normaliseText(text).replaceAll('’',"'");
 const sentences0=t0.split(/(?<=[.!?։;])\s+|\n+/u);
 // Spec v1.1 narrowing, decided on the whole message (a Level 1 feature anywhere keeps the 103).
 const faintL1=syncopeIsLevel1(t0),chestBenign=chestNotLevel1(t0),chestNotNow=chestPastOrStableNotNow(t0);
 const found=STAGING_ENTRIES.filter(x=>{
  if(x.v11==='faint'&&!faintL1)return false;
  if(x.v11==='chest'&&chestBenign)return false;
  // Tightness/pressure entries retain their old behaviour except for the shared not-now pattern.
  if(x.id.startsWith('S-CHEST-')&&x.v11!=='infarct'&&chestNotNow)return false;
  const t=x.mask?t0.replace(x.mask,m=>'_'.repeat(m.length)):t0;
  const sentences=x.mask?t.split(/(?<=[.!?։;])\s+|\n+/u):sentences0;
  const ok=(u:string)=>x.all.every(w=>x.wb?wordIn(u,w):u.includes(w))&&current(u,x)&&(x.v11!=='infarct'||!infarctInPast(u));
  return x.sentence?sentences.some(ok):ok(t);
 });
 return [...found,...(asserted(t0,PASSIVE_SELF)?[PASSIVE_ENTRY]:[]),...(SELF_HARM_PATTERNS.some(re=>re.test(t0))?[PATTERN_ENTRY]:[]),...bpOrganMatches(t0),...comboMatches(t0)];
}
/**
 * Lead decision 18 Oct (QA N01-N03, E01): the placeholder list no longer fires on a mention that is negated,
 * about the past or about someone else ("no chest pain", "my mother had a stroke last year", "heart pain last
 * year, fine now"), using the symptom red flags' clause rules. A current mention anywhere still fires ("no
 * chest pain yesterday, but today chest pain is terrible"). Self-harm entries are never discounted.
 */
function current(t:string,x:Entry){
 if(x.selfHarm)return true;
 const first=x.all[0]!;
 for(let i=t.indexOf(first);i>=0;i=t.indexOf(first,i+1)){
  let start=i,end=i+first.length,gapNeg=false;
  // Each later stem: its nearest occurrence after the first (within 80), else before it (within 60). A negation between the two
  // ("chest is not hurting", «կրծքիս ցավ չկա» after the fix of the stem search, «շրթունքս չի ուռել») negates this occurrence.
  for(const w of x.all.slice(1)){
   const after=t.indexOf(w,i+first.length),beforeAt=t.lastIndexOf(w,i);
   const j=after>=0&&after<i+80?after:beforeAt>=0&&beforeAt>=i-60?beforeAt:-1;
   if(j<0)continue;
   const gap=j>i?t.slice(i+first.length,j):t.slice(j+w.length,i);
   if(gap.length<=30&&gapNegated(gap))gapNeg=true;
   start=Math.min(start,j);end=Math.max(end,j+w.length);
  }
  if(gapNeg)continue;
  if(x.v11==='night'&&nocturnalOnly(t,start,end))continue;
  if(x.v11==='faint'&&urgentFaintMention(t,start,end))return true;
  if(!discounted(t,start,end))return true;
 }
 return false;
}

// BP of 180/110 or more with a target-organ symptom (the one BP rule, bp-check.ts; dataset S006): 103. The reading must be the member's own
// (a statement, not a question about a threshold). Synthetic entry, RF-03.
const ORGAN=/(?:գլուխ\p{L}*\s+ցավ|գլուխս\s+(?:(?!չ|ոչ)\p{L}+\s+){1,2}ցավ|գլխացավ|մշուշ|տեսողությ|(?<![\p{L}])խոս|կրծք|թուլ|թմր|շունչ|голов\p{L}*\s+\p{L}*\s*бол|головн\p{L}* бол|зрени|глаз|в глазах|реч|говор|груд|слабост|онем|одышк|headache|vision|blurr|speech|chest|weak|numb|breath)/u;
// Negation right around the symptom word: «ո՛չ գլխացավ», «կրծքիս ցավ չկա», «գլուխս չի ցավում», «нет головной боли», "no headache".
const NEG_BEFORE=/(?:ոչ|ո՛չ|առանց|չունեմ|no|not|without|нет|без|не)[\s,]*$/u;
const NEG_AFTER=/^[\p{L}\s]{0,12}(?:չկա|չի|չեմ|չունեմ|նորմալ|нет|не\s|normal|is fine|fine)/u;
const BP_ORGAN:Entry=Object.freeze({id:'S-BP-ORGAN-1',locale:'en',all:[],redFlag:'RF-03',selfHarm:false});
function bpOrganMatches(t:string):Entry[]{
 for(const sentence of t.split(/(?<=[.!?։])\s+|\n+/u)){
  // Readings by the shared parser (bp-parse.ts): full readings, and the spoken shorthand in tens right after a pressure word.
  // History, a quotation or, when the member speaks of themself, someone else's number is not a reading now (BP-02).
  for(const r of bpReadings(currentBpClauses(sentence,bpFirstPerson(t)))){const s=r.systolic,d=r.diastolic;
   // B6 Z1 (21 Oct): the clinical algorithm's crisis cut (THRESHOLD 180/110, rules.ts), the same as the symptom red flag's bp_crisis.
   if(!inCrisis({systolic:s,diastolic:d})||/[?՞]/u.test(sentence))continue;
   // A target-organ symptom anywhere in the message that is not negated, past or someone else's ("no headache" does not count).
   for(const o of t.matchAll(new RegExp(ORGAN.source,'gu'))){
    const before=t.slice(Math.max(0,o.index-15),o.index),after=t.slice(o.index+o[0].length,o.index+o[0].length+18);
    if(NEG_BEFORE.test(before)||NEG_AFTER.test(after)||discounted(t,o.index,o.index+o[0].length))continue;
    return [BP_ORGAN];
   }
  }
 }
 return [];
}

// Combinations (Astra #355 F1-F4): every group must occur somewhere in the message (sentences apart is fine: "My sugar is 25.
// I keep vomiting."); groups marked `asserted` count only at an occurrence that is not negated, past or someone else's ("sugar
// 25, no vomiting" does not fire). Context groups (the sugar, a child, the pills) need no assertion.
type Combo={id:string;redFlag:Flag;groups:{re:RegExp;asserted:boolean}[];when?:(t:string)=>boolean;
 /** All groups in one sentence (a child's poisoning is told in one breath; "My child is asleep. I swallowed my pills" is not). */sentence?:boolean;
 /** Never matched across messages joined by the batch checks. */oneMessage?:boolean};
const g=(src:string,asserted=true)=>({re:new RegExp(src,'gu'),asserted});
const SUGAR='շաքար|сахар|sugar|glucose|глюкоз|shakar';
const VOMIT='փսխ|рвот|рвет|рвёт|рвало|стошнил|vomit|throwing up|threw up|throw up|being sick|pxs|pkhs|блюю|блев';
const CONFUSED='շփոթ|запута|спутан|confus|disorient|дезориент|drowsy|sleepy|сонлив|клонит в сон|qnkot|քնկոտ|заторможен|չի խոսում|չի կարողանում խոսել|не может говорить|не говорит|shpot|chi xosum|slurr|incoherent';
const SWALLOW="can'?t swallow|cannot swallow|unable to swallow|не может глотать|не могу глотать|глотать не мож|глотать не могу|կուլ տալ չեմ կարողանում|չեմ կարողանում կուլ տալ|չի կարողանում կուլ տալ|կուլ տալ չի կարողանում|unresponsive|не реагирует|չի արձագանքում";
const CHILD='երեխ|տղաս|աղջիկս|թոռ|ребен|ребён|сын|дочь|внук|малыш|child|kid|son|daughter|toddler|baby|grandchild|grandson|granddaughter';
const PILLS='հաբ|դեղ|таблет|лекарств|pill|tablet|medicine|meds|capsule';
// Not "took" alone (Astra #355: "my son took his prescribed medicine"): an ingestion that is not a dose.
const INGEST="կերել|կուլ տվ|կուլ է տվ|проглот|съел|наглотал|swallowed|ate |got into|took (?:a handful|too many|some of|several|lots of|a lot of|all of|many)|has taken (?:a handful|too many|some of|several|all of)";
const ABDO_PAIN="stomach (?:hurts|pain|ache)|(?:stomach|belly|abdomen|abdominal) (?:is )?(?:hurting|painful)|abdominal pain|belly (?:pain|hurts)|pain in my (?:stomach|belly|abdomen)|бол\\p{L}* живот|живот\\p{L}* (?:сильно )?бол\\p{L}*|бол\\p{L}* в живот\\p{L}*|փոր\\p{L}*[^.։]{0,15}ցավ\\p{L}*|որովայն\\p{L}*[^.։]{0,15}ցավ\\p{L}*|por\\w*[^.]{0,15}cav\\w*";
const DEEP_BREATH="breath\\w* (?:deep|deeply|fast|heavily|hard)(?: and (?:fast|deep|deeply))?|deep (?:and fast |and rapid )?breath\\w*|rapid breath\\w*|глубоко (?:и часто )?дыш\\p{L}*|дыш\\p{L}* (?:глубоко|часто|шумно)|шумно дыш\\p{L}*|շնչառություն\\p{L}* (?:խոր|արագ)\\p{L}*|խոր(?:ը)? (?:ու արագ )?շնչ\\p{L}*|shnchum em xor";
// B6 Z7 (21 Oct): a unit written after the value decides (45 mmol/L is extreme, 35 mg/dL is low); without one, the magnitude does.
const SUGAR_READING=()=>new RegExp(`(?:${SUGAR})\\p{L}*[^\\d\\n]{0,25}(\\d{1,3}(?:[.,]\\d)?)\\s*(mmol|ммоль|մմոլ|mg|мг|մգ)?`,'gu');
const sugarMmol=(m:RegExpMatchArray)=>{const v=Number(m[1]!.replace(',','.'));const u=m[2];
 return u?/mg|мг|մգ/u.test(u)?v/18:v:null;};
const lowSugar=(t:string)=>[...t.matchAll(SUGAR_READING())].some(m=>{const mmol=sugarMmol(m);if(mmol!==null)return mmol<4;const v=Number(m[1]!.replace(',','.'));return v<4||(v>=20&&v<70&&/mg|մգ|мг/u.test(t));});
const highSugar=(t:string)=>[...t.matchAll(SUGAR_READING())].some(m=>{const mmol=sugarMmol(m);if(mmol!==null)return /mg|мг|մգ/u.test(m[2]!)?Number(m[1]!.replace(',','.'))>=250:mmol>=13.9&&mmol<=100;const v=Number(m[1]!.replace(',','.'));return (v>=13.9&&v<40)||v>=250;})
 ||new RegExp(`(?:${SUGAR})\\p{L}*[^.!?։\\n]{0,20}(?:high|very high|высок|подскоч|բարձր|բարձրացել)`,'u').test(t);
// Pregnancy with pre-eclampsia signs (dataset R011, spec §8/§11): a raised BP (140/90 or more, or "high" in words) or a
// second sign, with a headache, spots or flashes in front of the eyes, or a swollen face or hands: 103.
const PREG='հղի|беремен|pregnan|weeks pregnant|շաբաթական';
const PREG_SIGN='գլուխ\\p{L}*\\s+(?:\\p{L}+\\s+)?ցավ|գլխացավ|ցավում է գլուխ|կետեր|բծեր|կայծեր|մշուշ|տեսողությ|головн\\p{L}* бол|голова\\s+(?:(?!не\\s)\\p{L}+\\s+)?бол|бол\\p{L}*\\s+голов\\p{L}*|мушк|точк\\p{L}* перед глаз|пятна перед глаз|вспышк|зрени|headache|spots|flashes|blurr|vision|gluxs cav|glux\\p{L}* cav';
// Armen, 2 Nov (Task 9): the listed symptoms also include upper abdominal pain, sudden swelling and shortness of breath.
const PREG_UPPER_ABDO='upper (?:abdominal|stomach|belly) pain|pain (?:in|under) (?:my |the )?(?:upper (?:abdomen|belly|stomach)|ribs)|upper (?:abdomen|belly|stomach) (?:hurts|aches?)|epigastric|бол\\p{L}* (?:в|под) (?:верхн\\p{L}* (?:част\\p{L}* )?живот\\p{L}*|ребр\\p{L}*)|верх\\p{L}* живот\\p{L}*[^.]{0,15}бол\\p{L}*|под ложечкой[^.]{0,15}бол\\p{L}*|бол\\p{L}*[^.]{0,15}под ложечкой|(?:վերին որովայն|որովայնի վերին)\\p{L}*[^.։]{0,15}ցավ\\p{L}*|(?:verin vorovayn|vorovayni verin)\\w*[^.]{0,15}cav\\w*';
const PREG_BREATH='short of breath|shortness of breath|breathless\\w*|trouble breathing|hard to breathe|одышк\\p{L}*|трудно дышать|тяжело дышать|не хватает воздуха|շնչահեղձ\\p{L}*|դժվար եմ շնչում|շունչ\\p{L}*\\s+(?:չի հերիքում|կտրվ\\p{L}*|պակաս\\p{L}*)|shunch\\w*\\s+(?:chi herikum|pakas|ktrv\\w*)|xexdv\\w*';
const PREG_SUDDEN_SWELL='sudden(?:ly)?[^.!?\\n]{0,15}(?:swell\\w*|swollen)|(?:swell\\w*|swollen)[^.!?\\n]{0,15}sudden(?:ly)?|(?:внезапн\\p{L}*|резко)[^.]{0,15}(?:отек|отёк|опух|отекл)\\p{L}*|հանկարծ\\p{L}*[^.։]{0,15}(?:ուռ|այտուց)\\p{L}*|hankarc\\w*[^.]{0,15}(?:urr|aytuc)\\w*';
const PREG_SWELL='(?:դեմք|ձեռք|մատ)\\p{L}*[^.։]{0,25}(?:ուռ|այտուց)|(?:ուռ|այտուց)\\p{L}*[^.։]{0,20}(?:դեմք|ձեռք)|(?:лиц|рук|пальц)\\p{L}*[^.]{0,20}(?:опух|отек|отёк|отекл)|(?:опух|отек|отёк|отекл)\\p{L}*[^.]{0,20}(?:лиц|рук)|(?:face|hands|fingers)[^.]{0,20}(?:swollen|swelling|puffy)|swollen (?:face|hands)|swelling (?:of|in) (?:the |my |her )?(?:face|hands)';
const pregBp=(t:string)=>[...t.matchAll(/(?<![\d/])(\d{2,3})\s*(?:\/|over|на|-?\s?ի)\s*(\d{2,3})(?![\d/])/gu)].some(m=>{const s_=Number(m[1]),d=Number(m[2]);return s_>d&&s_<=300&&(s_>=140||d>=90);})
 ||/(?:ճնշ\p{L}*[^.։]{0,20}(?:բարձր|բարձրացել)|давлен\p{L}*[^.]{0,20}(?:высок|поднял|подскоч)|(?:high|raised) (?:blood )?pressure|pressure (?:is )?(?:high|up))/u.test(t);
// Tearing or ripping chest or back pain (dataset R029, aortic dissection; spec §7): 103.
const TEAR='tearing|ripping|like (?:something )?(?:is )?tearing|рв[её]тся|разрыва|раздира|разрыв|պատռ';
const CHEST_BACK='chest|back|between (?:my |the )?shoulder|груд|спин|лопат|կրծք|մեջք|թիակ';
// Spec v1.1 Appendix A (Armen 20 Oct): the universal Level 1 combinations.
// Severe allergic reaction: an allergy context with face, lip or tongue swelling, wheeze, a closing throat or trouble breathing.
const ALLERGY="allerg|anaphyla|bee sting|wasp|stung|after (?:eating )?(?:nuts|peanuts|shellfish|seafood|prawns)|new (?:medicine|tablet|antibiotic|pill)|аллерг|укус|ужалил|после (?:орех|арахис|креветок|морепродукт|нового лекарств|антибиотик)|ալերգ|խայթ|ընկույզ|նոր դեղ|alergi|allergi";
const ANA_SIGN="(?:face|lips?|tongue|eyes?)\\s+(?:is |are |has |have |got |went |started |began )?(?:very |all |really )?(?:swollen|swelling|puffy|puffing)|swollen (?:face|lips?|tongue|eyes?)|swelling (?:of|in|on) (?:my |the |her |his |their )?(?:face|lips?|tongue|throat)|wheez|throat (?:is )?(?:closing|tight\\w*|swelling|swollen)|(?:hard|difficult|trouble|struggling) (?:to )?breath|"
 +"(?:лицо|губы|губа|язык|горло|глаза)\\s+(?:(?!не)\\p{L}+\\s+)?(?:отек|отёк|опух|распух)|отек\\p{L}* (?:лица|губ|языка|горла)|отёк\\p{L}* (?:лица|губ|языка|горла)|хрип|свист\\p{L}* (?:при дыхании|в груди)|свистит|горло (?:сжима|сдавлив|перехват)|трудно дышать|тяжело дышать|"
 +"(?:դեմք|շրթունք|շուրթ|լեզու|կոկորդ|աչք)\\p{L}*\\s+(?:(?!չ)\\p{L}+\\s+)?(?:ուռ|այտուց)|սուլոց|սուլում|կոկորդս (?:սեղմվ|փակվ)|դժվար եմ շնչում|շնչելը դժվար|(?:demq|shrtunq|lezu|kokord)\\w*\\s+(?:(?!chi)\\w+\\s+)?urr|suloc";
// Head injury with loss of consciousness, vomiting, confusion, or on anticoagulants.
const HEAD_HIT="hit (?:his |her |my |their )?head|head injur|banged (?:his |her |my |their )?head|bumped (?:his |her |my |their )?head|fell on (?:his |her |my |their )?head|blow to (?:the |his |her |my )?head|ударил\\p{L}* (?:\\p{L}+ )?голов|удар\\p{L}* по голов|травм\\p{L}* голов|упал\\p{L}* (?:\\p{L}+ )?(?:на голову|головой)|գլուխ\\p{L}*[^.։]{0,15}(?:խփ|հարվածեց)|խփ\\p{L}*[^.։]{0,10}գլուխ|գլխ(?:ի|ով) (?:հարված|վնասվածք|ընկ)|glux\\w*[^.]{0,15}xp\\w*|xp\\w*[^.]{0,10}glux";
const HEAD_SIGN=`${VOMIT}|${CONFUSED}|warfarin|варфарин|վարֆարին|blood thinner|anticoag|антикоаг|разжижа|eliquis|xarelto|pradaxa|apixaban|rivaroxaban|dabigatran|ксарелто|эликвис|հակամակարդիչ|նոսրացնող|lost consciousness|knocked out|passed out|blacked out|unconscious|потерял\\p{L}* сознани|отключил|без сознания|գիտակցությունը կորց|ուշաթափ|ուշագնաց|անգիտակից|ushatap|anjatv`;
// High fever with a stiff neck, or a rash that does not fade when pressed.
const STIFF_NECK="stiff neck|neck is stiff|neck stiff|can'?t bend (?:his|her|my|their) neck|can'?t touch (?:his|her|my|their) chin to (?:his|her|my|their) chest|վիզ\\p{L}*[^.։]{0,30}(?:չի կարողանում ծռել|ծռել չի|կարծր|չի ծռվում|պինդ)|պարանոց\\p{L}*[^.։]{0,30}(?:կարկամ|չի թեքվում|պինդ)|шея[^.]{0,25}(?:не гн|не может|не наклон|скован|напряж)|не может наклонить голов|ригидн|viz\\w*[^.]{0,30}(?:chi crv|chi tsrv|kartsr|pind)";
const FEVER="fever|temperature|high temp|ջերմ|տաքություն|температур|жар|jerm|\\b3[89](?:[.,]\\d)?\\b|\\b4[01](?:[.,]\\d)?\\b";
const NB_RASH="purple (?:spots|rash|blotches)|non-?blanching|rash (?:that )?(?:doesn'?t|does not|won'?t|didn'?t) (?:go|fade|disappear)|сып\\p{L}*[^.]{0,30}не (?:исчез|проход|бледне)|пятна[^.]{0,20}не (?:исчез|бледне)|геморрагическ\\p{L}* сып|ցան\\p{L}*[^.։]{0,30}չի (?:անցնում|գունաթափվում|անհետանում)|մանուշակագույն (?:բծեր|ցան)|can\\w*[^.]{0,30}chi ancnum";
// Poisoning or toxic ingestion (not food poisoning).
const POISON="poison(?:ed|ing)?|drank (?:some )?(?:bleach|antifreeze|petrol|kerosene|vinegar essence|chemicals?|detergent|cleaning|cleaner)|swallowed (?:some |a )?(?:bleach|battery|button battery|chemicals?|detergent|cleaner|antifreeze|petrol|kerosene|magnets?)|отравил\\p{L}*|отравлени\\p{L}*|выпил\\p{L}* (?:уксус|хлорк|отбеливат|антифриз|бензин|растворител|средство|химик)|проглотил\\p{L}* (?:батарейк|магнит|хлорк|средство)|թունավորվ\\p{L}*|թունավորում|խմել է (?:քացախ|սպիտակեցնող|քիմիկատ|բենզին|լվացող)|մարտկոց\\p{L}* (?:է )?կուլ|tunavor\\w*";
const FOOD_POISON=/food poisoning|(?:пищев\p{L}*|пищ\p{L}*) отравлени\p{L}*|отравил\p{L}* (?:едой|чем-то|шаурм|в кафе)|սննդային թունավոր\p{L}*|սննդից թունավոր\p{L}*/u;
// Infant or paediatric danger signs (WHO IMCI general danger signs and red features).
const INFANT="baby|infant|newborn|new-born|\\d{1,2}[- ]?(?:months?|weeks?)[- ]old|грудничок|грудной|младен|новорожд|\\d{1,2}[- ]?(?:месяц|месяч|недел)|նորածին|կրծքով|\\d{1,2} ամսական|\\d{1,2} շաբաթական|noracin|amsakan";
const KID_DANGER="blue lips|lips (?:are |turned |went )?(?:blue|grey|gray)|turn(?:ed|ing)? blue|(?:is |went |gone |very |all |so )(?:limp|floppy)|floppy|won'?t wake|can'?t wake|hard to wake|not waking|unresponsive|not responding|stopped breathing|not breathing|pauses in (?:his |her |their )?breathing|grunting|won'?t (?:feed|drink) at all|not (?:feeding|drinking) at all|vomits everything|bulging (?:soft spot|fontanel)|"
 +"синие губы|посинел\\p{L}*|вялый|вялая|обмяк\\p{L}*|не просыпается|не реагирует|не дышит|перестал\\p{L}* дышать|кряхтит|не ест совсем|не пьет совсем|не пьёт совсем|рвет всем|рвёт всем|выбуха\\p{L}* родничок|"
 +"շուրթերը կապտ\\p{L}*|կապտել|թուլացած|ջլատված|չի արթնանում|չի արձագանքում|չի շնչում|շնչառությունը կանգ|ընդհանրապես չի ուտում|ընդհանրապես չի խմում|ամեն ինչ փսխում|գագաթ\\p{L}* ուռ\\p{L}*|chi artnanum|chi shnchum|kaptel";
const infantFever=(t:string)=>[...t.matchAll(/(?<!\d)(\d{1,2})[- ]?(months?|weeks?|месяц\p{L}*|месяч\p{L}*|недел\p{L}*|ամսական|շաբաթական)/gu)].some(m=>/week|недел|շաբաթ/u.test(m[2]!)?Number(m[1])<13:Number(m[1])<3)
 ||/newborn|new-born|новорожд|նորածին|noracin/u.test(t);
// Exertional "heartburn" (dataset S025): burning that came on with exertion and now does not pass at rest; or with diabetes (RF-01).
const GI_BURN="ստամոքս\\p{L}*[^.։]{0,20}այր\\p{L}*|այր\\p{L}*[^.։]{0,20}ստամոքս|կրծք\\p{L}*[^.։]{0,20}այր\\p{L}*|изжог\\p{L}*|жжени\\p{L}* (?:в|под) (?:желуд|груд|ложечк)|жжет (?:в )?(?:груд|желуд)|heartburn|burning (?:in|under) (?:my |the )?(?:chest|stomach|upper)|stamoqs\\w*[^.]{0,20}ayr";
const AT_REST="հանգիստ|նստած|պառկած|at rest|resting|sitting|lying|в покое|сидя|лежа|лёжа|сейчас|now|հիմա";
const NOT_PASSING="չի անցնում|չի դադարում|не проход|не прекраща|не отпуска|won'?t go|not going away|doesn'?t go away|hasn'?t gone|has not gone|won'?t stop";
const EXERTION_OR_DM="սանդուղք|քայլ|ֆիզիկական|բարձրանալիս|stairs|walking|exercis|exertion|climb|лестниц|ходьб|нагрузк|подним|շաքար|շաքարային|diabet|диабет|сахарн";

const JAW_ARM_PAIN="(?:jaw|arm|shoulder)s?[^.!?\\n]{0,20}(?:pain|hurt\\w*|ach\\w*)|(?:pain|ache)[^.!?\\n]{0,15}(?:in|to) (?:my |the |her |his )?(?:jaw|left arm|arm|shoulder)|челюст\\p{L}*[^.!?\\n]{0,20}бол\\p{L}*|бол\\p{L}*[^.!?\\n]{0,20}(?:челюст|в (?:левой )?рук|в плеч)|(?:ծնոտ|թև|ուս)\\p{L}*[^.!?\\n]{0,25}ցավ\\p{L}*|(?:dznot|tev)\\w*[^.!?\\n]{0,25}cav\\w*";
const EQ_SIGN="short of breath|breathless\\w*|can'?t catch my breath|sweat\\w*|clammy|nause\\w*|throw(?:ing)? up|vomit\\w*|very weak|so weak|одышк\\p{L}*|задыха\\p{L}*|не хватает воздуха|пот\\p{L}*|тошн\\p{L}*|рвот\\p{L}*|сильн\\p{L}* слабост\\p{L}*|շունչ\\p{L}*\\s+(?:չի հերիքում|պակաս\\p{L}*|կտրվ\\p{L}*)|շնչահեղձ\\p{L}*|քրտն\\p{L}*|սրտխառն\\p{L}*|սիրտ\\p{L}*\\s+(?:էլ\\s+)?խառն\\p{L}*|փսխ\\p{L}*|շատ թույլ|թուլություն|shunch\\w*\\s+(?:chi herikum|pakas)|qrtn\\w*";
const GAS_SMELL="smell (?:of )?gas|gas (?:smell|leak)|утечк\\p{L}* газа|запах газа|пахнет газом|գազի հոտ|գազ է գալիս|gazi hot";
const GAS_SIGN="headache|nause\\w*|drowsy|sleepy|dizz\\w*|confus\\w*|vomit\\w*|головн\\p{L}* бол\\p{L}*|голова болит|бол\\p{L}* голов\\p{L}*|тошн\\p{L}*|сонлив\\p{L}*|головокруж\\p{L}*|рвот\\p{L}*|գլխացավ\\p{L}*|գլուխ\\p{L}* ցավ\\p{L}*|սրտխառն\\p{L}*|քնկոտ\\p{L}*|գլխապտույտ\\p{L}*|փսխ\\p{L}*|glxacav\\w*";

const BACK_PAIN="back (?:pain|hurts|is hurting|ache)|(?:my |the |lower |his |her )back[^.!?\\n]{0,15}(?:hurts|pain|aches)|pain in (?:my |the )?(?:lower )?back|спин\\p{L}*[^.!?\\n]{0,15}бол\\p{L}*|бол\\p{L}*[^.!?\\n]{0,15}спин\\p{L}*|поясниц\\p{L}*|մեջք\\p{L}*[^.։]{0,15}ցավ\\p{L}*|ցավ\\p{L}*[^.։]{0,15}մեջք\\p{L}*|mejq\\w*[^.]{0,15}cav\\w*";
const SPINE_SIGN="lost control of (?:my )?(?:bladder|bowels?)|can'?t (?:pee|urinate|control (?:my )?(?:bladder|bowels?))|cannot (?:pee|urinate|control (?:my )?(?:bladder|bowels?))|incontinen\\w*|wet myself|legs? (?:are |is |feel |feels |went |have gone )?(?:weak|numb|giving way)|numb\\w* (?:in|between|around) (?:my )?(?:legs|groin|buttocks|saddle)|saddle numb\\w*|"
 +"не контролирую (?:мочеиспуск|стул|кишечник)\\p{L}*|не могу помочиться|недержан\\p{L}*|ноги (?:слабе|немеют|отнимаются|подкашиваются)\\p{L}*|онемени\\p{L}* (?:в паху|ног|промежност)\\p{L}*|"
 +"միզարձակում\\p{L}* (?:չեմ|չի) (?:վերահսկ|պահ)\\p{L}*|միզ\\p{L}* (?:չեմ|չի) կարողանում (?:պահել|զսպել)|(?:չեմ|չի) կարողանում միզել|միզել (?:չեմ|չի) կարողանում|ոտքեր\\p{L}* (?:թուլ|թմր)\\p{L}*|mez\\w* chem karoxanum pahel|mizel chem karoxanum|otqers (?:tul|tmr)\\w*";
const NOT_BREATHING="(?:isn'?t|is not|has stopped|stopped|not) breathing(?! (?:well|properly|normally|right|through|easily|deeply))|не дышит|перестал\\p{L}* дышать|չի շնչում|շնչառությունը կանգ\\p{L}*|chi shnchum";

// Armen, 2 Nov (Task 6; [needs doctor sign-off]): chest pain getting worse at rest is 103 even when it has lasted days, which
// chestNotLevel1 would otherwise let through. Pain that rest relieves is not this rule ("worse on the stairs, goes away at rest").
const CHEST_ACHE="(?:chest|heart)[^.!?\\n]{0,25}(?:pain|hurt|ach|pressure|tight|heav)|(?:pain|pressure|tightness|heaviness)[^.!?\\n]{0,25}(?:chest|heart)|(?:груд|сердц)\\p{L}*[^.!?\\n]{0,25}(?:бол|жж|давит|сдавл|сжима|тяжест)|(?:бол|жж|давит|сдавл|сжима|тяжест)\\p{L}*[^.!?\\n]{0,25}(?:груд|сердц)|(?:կրծք|կուրծք|սրտ|սիրտ)\\p{L}*[^.։!?\\n]{0,25}(?:ցավ|սեղմ|ծանր)|(?:krtsk|krck|krtsq|krcq|kurck|sirt|srt)\\w*[^.!?\\n]{0,25}(?:cav|tsav|sexm)";
const CHEST_WORSE="worse|worsen\\w*|getting stronger|stronger|increasing|intensif\\w*|хуже|усилива\\p{L}*|усилил\\p{L}*|нараста\\p{L}*|сильнее|ուժեղան\\p{L}*|ուժեղաց\\p{L}*|սաստկան\\p{L}*|վատան\\p{L}*|ավելի (?:ուժեղ|վատ)\\p{L}*|ujexan\\w*|ujexac\\w*|uzhexan\\w*|vatan\\w*|aveli (?:ujex|vat)\\w*";
const CHEST_REST="at rest|while resting|when resting|even resting|when i am resting|when i'm resting|sitting still|lying down|в покое|в состоянии покоя|лежа|лёжа|сидя|когда отдыхаю|հանգստի ժամանակ|հանգստի վիճակ\\p{L}*|հանգիստ վիճակ\\p{L}*|հանգստանալիս|նստած|պառկած|hangist\\w*|hangsti\\w*|nstac|parkac";
const REST_RELIEF=/(?:go(?:es)? away|stops?|eases?|settles?|passes|better|subsides?|relieved|disappears?|improves?)[^.!?\n]{0,15}(?:rest|sitting|lying)|(?:rest|lying down|sitting)[^.!?\n]{0,15}(?:helps?|relieves?|makes it better|eases?|goes away|it goes|it stops)|проход\p{L}*[^.!?\n]{0,15}(?:в покое|лежа|лёжа|сидя)|(?:в покое|лежа|лёжа|сидя)[^.!?\n]{0,15}(?:проход\p{L}*|отпуска\p{L}*|легче|лучше)|հանգստ\p{L}*[^.։!?\n]{0,20}(?:անցնում|լավանում|թեթևան)\p{L}*|hangst\w*[^.!?\n]{0,20}(?:ancnum|lavanum)/u;
// Armen, 2 Nov (Task 6; [needs doctor sign-off]): an irregular pulse of 140 or more with dizziness is 103. All three are needed:
// "my pulse was 140 after running" and "dizzy for a second" stay with the model. A 140/90 next to the word pulse is a pressure.
const IRREGULAR="irregular\\w*|uneven|erratic|skip(?:s|ping|ped) beats?|missing beats?|out of rhythm|afib|a-fib|atrial fibrillation|arrhythmi\\w*|неровн\\p{L}*|нерегулярн\\p{L}*|аритми\\p{L}*|перебо\\p{L}*|сбив\\p{L}* (?:ритм|пульс)\\p{L}*|(?:ритм|пульс)\\p{L}* сбива\\p{L}*|мерцательн\\p{L}*|фибрилляц\\p{L}*|անկանոն\\p{L}*|անհավասար\\p{L}*|առիթմի\\p{L}*|ռիթմ\\p{L}*\\s+(?:խանգար|անկանոն)\\p{L}*|ընդհատ\\p{L}*|ֆիբրիլյացիա\\p{L}*|ankanon\\w*|anhavasar\\w*|aritmi\\w*|ritm\\w*\\s+xangar\\w*";
const DIZZY="dizz\\w*|light-?headed\\w*|голов\\p{L}*\\s+(?:(?!не)\\p{L}+\\s+)?круж\\p{L}*|круж\\p{L}*\\s+(?:\\p{L}+\\s+)?голов\\p{L}*|головокруж\\p{L}*|գլխապտույտ\\p{L}*|գլուխ\\p{L}*\\s+(?:(?!չ)\\p{L}+\\s+)?պտտ\\p{L}*|glxaptuyt\\w*|glkhaptuyt\\w*|glux\\w*\\s+(?:(?!chi)\\w+\\s+)?pt\\w*";
const PULSE_WORD="pulse|heart ?rate|անոթազարկ\\p{L}*|anotazark\\w*|(?<![\\p{L}])hr(?![\\p{L}])|heartbeat|пульс\\p{L}*|чсс|сердцебиени\\p{L}*|զարկերակ\\p{L}*|պուլս\\p{L}*|սրտի զարկ\\p{L}*|սրտխփոց\\p{L}*|puls\\w*|zarkerak\\w*|srti zark\\w*";
const PULSE_AFTER=new RegExp("(?:"+PULSE_WORD+")([^\\d\\n]{0,30})(\\d{2,3})(?![\\d]|\\s*[/\\\\]|\\s*(?:на|over|-ի)\\s*\\d)",'gu');
const PULSE_BEFORE=new RegExp("()(?<![\\d/.,])(\\d{2,3})\\s*(?:bpm|beats|удар\\p{L}*|уд\\b|զարկ\\p{L}*|zark\\w*|pulse|пульс|պուլս|puls)",'gu');
const NOT_PULSE_GAP=/pressure|(?<![\p{L}])bp(?![\p{L}])|давлен|ճնշ|chnsh/u;
// The value said as a fact: not "if", not a general question placed before the number ("Is a pulse of 140 dangerous?"), not past.
const PULSE_HYPOTHETICAL=/(?<![\p{L}])(?:if|would|what if|is (?:a|an|it)|can (?:a|an)|does (?:a|an)|если|бы|опасен|опасно ли|եթե|yete)(?![\p{L}])/u;
// Said now: a clause about a passing moment or an earlier day does not count ("dizzy for a second", "was irregular yesterday").
const NOT_NOW=/for (?:a|one|just a) (?:second|sec|moment)|momentar\w*|yesterday|last night|на (?:секунду|миг|мгновение)|вчера|մի պահ|մի վայրկյան|(?<![\p{L}])երեկ(?![\p{L}])|mi pah/u;
// Fable #522 R7: exercise said in the same sentence ("during exercise", «на тренировке») keeps the rule quiet.
const EXERCISE=/(?<![\p{L}])(?:exercis\w*|work(?:ing)?[ -]?out|gym|(?:after|while|during|on) (?:a |my )?(?:run|running|jog|jogging|training|sport)|на тренировк\p{L}*|на пробежк\p{L}*|(?:во время|после) (?:бега|тренировк\p{L}*|нагрузк\p{L}*)|в спортзал\p{L}*|մարզ\p{L}*|վազելիս|վազելուց|marzum\w*|marzvel\w*|vazelis|vazeluc)(?![\p{L}])/u;
const saidNow=(t:string)=>t.split(/(?<=[.!?։\n])/u).filter(s=>!EXERCISE.test(s)).join('').split(/(?<=[,;.!?։\n])/u).filter(c=>!NOT_NOW.test(c)).join('');
const pulseHigh=(t:string)=>[...t.matchAll(PULSE_AFTER),...t.matchAll(PULSE_BEFORE)].some(m=>{const v=Number(m[2]),at=m.index;
 return v>=140&&v<=300&&!NOT_PULSE_GAP.test(m[1]!)&&!PULSE_HYPOTHETICAL.test(t.slice(Math.max(0,...[...t.slice(0,at).matchAll(/[.!?\n։]/gu)].map(x=>x.index+1)),at+m[1]!.length))&&!discounted(t,at,at+m[0].length);});

const COMBOS:readonly Combo[]=Object.freeze([
 {id:'S-ANA-5',redFlag:null,groups:[g(ALLERGY,false),g(ANA_SIGN)]},
 // v1.1 Level 1: new leg weakness or numbness, or bladder or bowel loss, with back pain (S094; Astra V11-05).
 {id:'S-SPINE-1',redFlag:null,groups:[g(BACK_PAIN),g(SPINE_SIGN)]},
 // Someone is not breathing (any age).
 {id:'S-BREATH-NONE-1',redFlag:'RF-02',groups:[g(NOT_BREATHING)]},
 {id:'S-HEAD-2',redFlag:null,groups:[g(HEAD_HIT),g(HEAD_SIGN)]},
 {id:'S-MEN-3',redFlag:null,groups:[g(STIFF_NECK),g(FEVER)]},
 {id:'S-MEN-4',redFlag:null,groups:[g(NB_RASH)]},
 {id:'S-POIS-3',redFlag:null,when:t=>!FOOD_POISON.test(t),groups:[g(POISON)]},
 // Fable #522 R1: twenty tablets or more taken at once, said as a number.
 {id:'S-POIS-5',redFlag:null,groups:[g('(?:took|swallowed|выпил\\p{L}*|принял\\p{L}*|проглотил\\p{L}*)\\s+(?:about |around |около )?(?:[2-9]\\d|\\d{3})\\s+(?:paracetamol|acetaminophen|pills?|tablets?|таблет\\p{L}*|парацетамол\\p{L}*)')]},
 {id:'S-KID-1',redFlag:null,groups:[g(`${INFANT}|${CHILD}`,false),g(KID_DANGER)]},
 {id:'S-KID-2',redFlag:null,when:infantFever,groups:[g(FEVER)]},
 {id:'S-BLEED-5',redFlag:null,sentence:true,groups:[g('bleed|кровотеч|кровоточ|արյունահոս|aryunahos'),g('dizz|faint|light-?headed|головокруж|обмор|слабеет|գլխապտույտ|գլուխս պտտ|ուշագն|ուշաթափ|glxaptuyt')]},
 {id:'S-CHEST-GI-1',redFlag:'RF-01',groups:[g(GI_BURN),g(AT_REST,false),g(NOT_PASSING,false),g(EXERTION_OR_DM,false)]},
 // Female and diabetic equivalents (v1.1 Level 1; S024): jaw, arm or shoulder pain with breathlessness, sweating, nausea or weakness.
 {id:'S-CHEST-EQ-1',redFlag:'RF-01',groups:[g(JAW_ARM_PAIN),g(EQ_SIGN)]},
 {id:'S-CHEST-REST-1',redFlag:'RF-01',when:t=>!REST_RELIEF.test(t),groups:[g(CHEST_ACHE),g(CHEST_WORSE),g(CHEST_REST)]},
 // Armen, 2 Nov (Task 6; Khikar accepted it over dataset scenario 032): one message only, never joined from several.
 {id:'S-PULSE-1',redFlag:'RF-02',oneMessage:true,when:t=>{const n=saidNow(t);return pulseHigh(n)&&assertedAt(n,g(IRREGULAR).re)&&assertedAt(n,g(DIZZY).re);},groups:[]},
 // Carbon monoxide: a gas smell with headache, nausea, drowsiness or dizziness (O17).
 {id:'S-POIS-4',redFlag:null,groups:[g(GAS_SMELL,false),g(GAS_SIGN)]},
 {id:'S-PREG-1',redFlag:null,groups:[g(PREG,false),g(`${PREG_SIGN}|${PREG_SWELL}|${PREG_SUDDEN_SWELL}|${PREG_UPPER_ABDO}|${PREG_BREATH}`)],when:pregBp},
 {id:'S-PREG-2',redFlag:null,groups:[g(PREG,false),g(PREG_SIGN),g(PREG_SWELL)]},
 {id:'S-AORTA-1',redFlag:null,groups:[g(TEAR),g(CHEST_BACK,false)]},
 {id:'S-GIB-2',redFlag:null,groups:[g(VOMIT),g('blood in (?:it|my vomit|the vomit)|with blood|bloody|кров\\p{L}* в рвот|с кровью|արյունով|արյուն կար|արյուն կա')]},
 // A high sugar (a reading of 13.9 mmol/L, 250 mg/dL, or more, or "high" in words) with vomiting (spec §8; S057).
 {id:'S-DKA-1',redFlag:null,groups:[g(SUGAR,false),g(VOMIT)],when:highSugar},
 // v1.1 Level 1: hyperglycaemia with abdominal pain, deep rapid breathing or somnolence (Astra V11-05), not only vomiting.
 {id:'S-DKA-2',redFlag:null,groups:[g(SUGAR,false),g(`${ABDO_PAIN}|${DEEP_BREATH}|${CONFUSED}`)],when:highSugar},
 {id:'S-HYPO-1',redFlag:null,groups:[g(CONFUSED)],when:lowSugar},
 {id:'S-HYPO-2',redFlag:null,groups:[g(SUGAR,false),g(SWALLOW)]},
 // A low sugar said in words ("my blood sugar is low and I am drowsy"; Astra #355 round 2).
 {id:'S-HYPO-3',redFlag:null,groups:[g(`(?:${SUGAR})\\p{L}*[^.!?։\\n]{0,20}(?:low|dropped|низк|упал|ցածր|իջել|ընկել)`,false),g(CONFUSED)]},
 {id:'S-POIS-1',redFlag:null,sentence:true,when:t=>!/(?<![\p{L}])(?:my|his|her) (?:usual|own|daily|prescribed|regular) (?:pills|tablets|medicine)/u.test(t),groups:[g(CHILD,false),g(PILLS,false),g(INGEST)]},
 {id:'S-POIS-2',redFlag:null,groups:[g('սունկ|гриб|mushroom',false),g('փսխ|փորլուծ|սրտխառն|рвот|рвет|рвёт|понос|тошн|vomit|diarrh|nause|throwing up')]},
 {id:'S-GIB-1',redFlag:null,when:t=>!/(?<![\p{L}])(?:without|no|not any|any|без|нет|առանց)\s+(?:\p{L}+\s+){0,2}(?:blood|кров|արյուն)|(?:blood|кров|արյուն)\p{L}*\s+(?:չկա|нет|не было)/u.test(t),groups:[g(`(?:${VOMIT})\\p{L}*[^.!?։\\n]{0,30}(?:blood|кров|արյուն|aryun|coffee|кофейн|սուրճ)|(?:blood|кров|արյուն|aryun|coffee ground|кофейн\\p{L}* гущ|սուրճի նստվածք)\\p{L}*[^.!?։\\n]{0,30}(?:${VOMIT})`)]},
 {id:'S-MEN-1',redFlag:null,groups:[g("stiff neck|neck is stiff|neck stiff|can'?t bend (?:his|her|my|their) neck|վիզ\\p{L}*[^.։]{0,30}(?:չի կարողանում ծռել|ծռել չի|կարծր|չի ծռվում)|шея[^.]{0,25}(?:не гн|не может|не наклон)|не может наклонить голов|ригидн"),g('fever|temperature|ջերմ|температур|жар|\\b3[89](?:[.,]\\d)?\\b')]},
 {id:'S-HEAD-1',redFlag:null,groups:[g('hit (?:his |her |my |their )?head|head injur|banged (?:his |her |my )?head|fell on (?:his |her |my )?head|ударил\\p{L}* (?:\\p{L}+ )?голов|удар\\p{L}* по голов|գլուխ\\p{L}*[^.։]{0,15}խփ|խփ\\p{L}*[^.։]{0,10}գլուխ'),g(`${VOMIT}|warfarin|варфарин|վարֆարին|blood thinner|anticoag|антикоаг|eliquis|xarelto|apixaban|rivaroxaban|lost consciousness|knocked out|потерял\\p{L}* сознани|գիտակցությունը կորց`)]},
]);
// The negation is a whole word (Latin-letter Armenian «noracins» "my newborn" is not "no").
const NEG_NEAR_BEFORE=/(?<![\p{L}'])(?:ոչ|ո՛չ|առանց|no|not|without|never|нет|без|не|ни)(?![\p{L}'])[\s,]*(?:\p{L}+[\s,]+){0,1}$/u;
// The second item of a negated list: "no nausea or vomiting", "do not have nausea or vomiting", «ни тошноты, ни рвоты».
const NEG_LIST_BEFORE=/(?<![\p{L}'])(?:no|not(?: have)?|without|never|нет|без|ни|ոչ|առանց)(?![\p{L}'])\s+(?:\p{L}+[\s,]+){0,2}(?:or|nor|and|или|и|ни|կամ|ու|և)[\s,]+$/u;
function assertedAt(t:string,re:RegExp){
 for(const m of t.matchAll(re)){const i=m.index,j=i+m[0].length;
  if(NEG_NEAR_BEFORE.test(t.slice(Math.max(0,i-22),i))||NEG_LIST_BEFORE.test(t.slice(Math.max(0,i-45),i))||/^[\p{L}\s]{0,12}(?:չկա|չի|չեմ|չունեմ|նորմալ է|нет|не\s|в норме|нормальная|нормальное|(?:is |was |are )normal|is fine|(?:chem|chi|chka|chunem|chen)(?![\p{L}]))/u.test(t.slice(j,j+22))||discounted(t,i,j))continue;
  return true;}
 return false;
}
function comboMatches(t:string):Entry[]{
 const all=(c:Combo,u:string)=>(!c.when||c.when(u))&&c.groups.every(x=>{x.re.lastIndex=0;const ok=x.asserted?assertedAt(u,x.re):x.re.test(u);x.re.lastIndex=0;return ok;});
 return COMBOS.filter(c=>c.sentence?t.split(/(?<=[.!?։;])\s+|\n+/u).some(sn=>all(c,sn)):all(c,t))
  .map(c=>({id:c.id,locale:'en' as const,all:[],redFlag:c.redFlag,selfHarm:false,...(c.oneMessage?{oneMessage:true}:{})}));
}

export const STAGING_LEXICON:UrgentLexicon=Object.freeze({version:STAGING_LEXICON_VERSION,status:'staging_placeholder',signedBy:null,
 entries:Object.freeze(STAGING_ENTRIES.map(x=>({id:x.id,locale:x.locale,phrase:x.all.join(' '),redFlag:x.redFlag})))});

/**
 * Armen, 2 Nov (Task 8; [needs doctor sign-off]; STAGING list): self-harm thoughts without a plan are "today", sent automatically, and Zoe
 * stays in the chat; a plan or an action in progress is 103. Fable #522 R1: the default is 103. 'passive' only when nothing is left after
 * removing the passive phrase, a "no plan" phrase and ordinary filler words: a verb of intent, a method, a substance, a time, a place or
 * simply a word not known here keeps the crisis text. "I don't want to live in this city" stays there too; that is the safe side.
 * Intent ("kill myself", "end it all"), "want to die" and "hurt myself" are never 'passive'.
 */
export type SelfHarmLevel='none'|'passive'|'urgent';
// New phrases must end the clause: "I don't want to wake up early" is not this.
const CLAUSE_END='(?=\\s*(?:anymore|any more|again|ever)?\\s*(?:[.,!?;։\\n]|$))';
const PASSIVE_SELF=new RegExp([
 String.raw`(?:don'?t|do not|dont|not) want to (?:live|be alive)|(?:don'?t|do not|dont) want to wake(?: up)?${CLAUSE_END}|(?:there is |there's )?no point(?: in)? living|(?:life is )?not worth living|can'?t go on living|(?:tired|sick) of living|(?:(?:everyone|everybody|they|all)(?: would be| will be| is| are)? )?better off (?:dead|without me)|wish (?:i (?:was|were) dead|i (?:could|would)(?: just)? (?:go to sleep and )?(?:not|never) wake(?: up)?|i (?:wouldn'?t|won'?t|didn'?t) wake(?: up)?|i (?:was|had) never (?:been )?born)|go to sleep and (?:not|never) wake(?: up)?|(?:it )?would be better (?:not to wake(?: up)?|if i (?:did not|didn'?t|never) wake(?: up)?)|suicidal (?:thoughts?|ideas?|ideation|feelings?)|thoughts? (?:of|about) (?:suicide|ending my life|killing myself)|thinking (?:of|about) (?:suicide|ending my life|killing myself)`,
 String.raw`не хоч(?:у|ется) (?:\p{L}+ )?жить|жить (?:\p{L}+ )?не хочется|не хочу (?:\p{L}+ )?просыпаться${CLAUSE_END}|(?:было бы )?лучше (?:бы )?не (?:просыпаться|проснуться)|(?:нет|не вижу) смысла жить|смысла жить|жить (?:\p{L}+ )?нет смысла|незачем жить|жить незачем|устал\p{L}* жить|лучше бы меня не было|(?:всем|им) будет лучше без меня|(?:заснуть|уснуть) и не проснуться|не могу больше так жить|больше не могу так жить|(?:мысли|думаю|думать) о (?:суициде|самоубийстве)|суицидальн\p{L}* мысл\p{L}*`,
 String.raw`չեմ ուզում (?:\p{L}+ )?ապրել|ապրել չեմ ուզում|ապրելու իմաստ\p{L}*(?: չկա| չեմ տեսնում)?|չեմ ուզում արթնանալ${CLAUSE_END}|(?:ավելի )?լավ կլիներ(?: որ)? (?:չարթնանալ|չարթնանայի|չարթնանամ)|ինքնասպանության (?:մտքեր\p{L}*|մասին մտածում)|մտածում եմ ինքնասպանության մասին`,
 String.raw`chem uzum (?:\w+ )?(?:aprel|aprem)|aprel chem uzum|aprelu imast\w*|chem uzum artnanal${CLAUSE_END}|(?:aveli )?lav kliner (?:chartnanal|chartnanayi)|inqnaspan\w* mtqer\w*`,
].join('|'),'gu');

/**
 * Explicit self-harm by PATTERN, not by a list of phrases (Astra rounds 2 to 6: every list of literal phrases left plain tense and word-order variants). A self-reference (myself,
 * себя, ինձ ...) and a harm verb stem in the same sentence, in either order; a jump with a height or vehicle; a "don't want to be here". Deliberately NOT here: "take all my pills"
 * with no sign of intent ("I am taking all my tablets" is adherence), "cut myself" with no intent frame is covered by the intent frame below. The staging list stays a placeholder
 * until Armen's signed list; the trade-off is false alarms over misses.
 */
const SENT='[^.!?;։\\n]';
// Intent frame: "want to", "going to", "I am ...ing" ... Words that are ordinary accidents without one ("I cut myself while shaving").
const FRAME=String.raw`(?:want to|wants to|going to|gonna|plan to|planning to|intend to|about to|decided to|will|i am|i'm|right now i am)`;
const SELF_HARM_PATTERNS:readonly RegExp[]=[
 // en: a harm verb directly followed by myself / my own self (no other words between: "hanging my washing out myself" is laundry)
 new RegExp(String.raw`(?<![\p{L}])(?:kill\p{L}*|hang\p{L}*|drown\p{L}*|shoot\p{L}*|poison\p{L}*|gas\p{L}*|stab\p{L}*|slit\p{L}*|slash\p{L}*|suffocat\p{L}*|strangl\p{L}*|asphyxiat\p{L}*|overdos\p{L}*)\s+(?:my own |my )?(?:my ?self|self)(?![\p{L}])`,'u'),
 // en: cut / burn myself only with an intent frame
 new RegExp(String.raw`(?<![\p{L}])${FRAME}\s+(?:(?:(?!accident|careless|almost|nearly)\p{L}+ly|just|really|actually|now|finally|seriously)\s+){0,2}(?:cut\p{L}*|burn\p{L}*|harm\p{L}*|injur\p{L}*|stab\p{L}*)\s+(?:my ?self|my own self)(?![\p{L}])(?!\s+(?:on|with the edge of)\s+(?:the |a |my )?(?:razor|knife|glass|paper|oven|stove|door|can|tin|shaver|grater|slicer))(?!${SENT}{0,30}(?:while|when|as i)\s+(?:i am |i'm |was )?(?:shaving|cooking|chopping|slicing|peeling|cutting|doing|making|using|ironing|baking))`,'u'),
 // en: wrists / veins / throat
 new RegExp(String.raw`(?<![\p{L}])(?:cut\p{L}*|slit\p{L}*|slash\p{L}*|stab\p{L}*)\s+(?:my |my own )(?:wrists?|veins?|throat)(?![\p{L}])`,'u'),
 // en: end / take one's life (the life is the object; "cutting my life insurance costs" is not this)
 new RegExp(String.raw`(?<![\p{L}])(?:end\p{L}*|take|taking|took|takes) (?:my own|my) life(?![\p{L}])(?!\s+(?:insurance|policy|payout|savings|coverage|plan|story|style|coach|work|choices|assurance|cover))`,'u'),
 // en: "end it" with an intent frame, at the end of the clause
 new RegExp(String.raw`(?<![\p{L}])${FRAME}\s+end(?:ing)? it(?: all| tonight| today| now)?\s*(?:[.,!?;։\n]|$)`,'u'),
 // en: pills, with an intent verb and not "as prescribed"
 new RegExp(String.raw`(?<![\p{L}])(?:want to|plan to|planning to|intend to|decided to)\s+(?:take|swallow|drink|down)\s+(?:all|every one of|the whole bottle of)\s+(?:of\s+)?my\s+(?:pills|tablets|medicines|meds)(?!(?:\s+(?:tonight|today|now|later|this (?:morning|evening)))?\s+(?:as (?:prescribed|directed|told|instructed)|at (?:the )?(?:prescribed|right|usual|correct|scheduled) times?|on time|every (?:day|morning|evening|night)|daily|each (?:day|morning|evening)|per day))`,'u'),
 // en: any intent frame, all my pills, and a sign of harm (tonight, at once, to die): "I am going to take all my pills tonight"
 new RegExp(String.raw`(?<![\p{L}])${FRAME}\s+(?:take|swallow|drink|down)\s+(?:all|every one of|the whole bottle of)\s+(?:of\s+)?my\s+(?:pills|tablets|medicines|meds)\s+(?:tonight|at once|all at once|right now|to die|so (?:i|that i) (?:die|don'?t wake up)|and (?:die|not wake up))(?!\s+(?:as (?:prescribed|directed|told|instructed)|at (?:the )?(?:prescribed|right|usual|correct|scheduled) times?|on time|with (?:food|water|my (?:meal|dinner|breakfast))))`,'u'),
 // en: overdose with an intent frame or as an action in progress
 new RegExp(String.raw`(?<![\p{L}])${FRAME}${SENT}{0,20}overdos\p{L}*|overdos\p{L}*${SENT}{0,12}(?:myself|on purpose|tonight)`,'u'),
 // en: jumping from a height or in front of a vehicle
 new RegExp(String.raw`(?<![\p{L}])jump\p{L}*${SENT}{0,8}(?:off|from|out of|in front of|into|down)${SENT}{0,24}(?<![\p{L}])(?:roof|rooftop|roof top|building|tower|bridge|cliff|balcony|window|train|bus|car|truck|river|sea|ledge|skyscraper)`,'u'),
 // en: "I don't want to be here (anymore)": passive ideation, only at the end of the clause
 new RegExp(String.raw`(?<![\p{L}])(?:don'?t|do not|dont) want to be (?:here|alive|around)(?: anymore| any more| any longer)?\s*(?:[.,!?;։\n]|$)`,'u'),
 // ru: себя / собой (accusative or instrumental, a self-directed act) + a harm verb, either order, close together
 new RegExp(String.raw`(?<![\p{L}])(?:себя|собой|самого себя)${SENT}{0,25}(?<![\p{L}])(?:убива\p{L}*|убь\p{L}*|убить|убей\p{L}*|веша\p{L}*|повес\p{L}*|повеш\p{L}*|утоп\p{L}*|топить\p{L}*|топл\p{L}*|стрел\p{L}*|застрел\p{L}*|выстрел\p{L}*|отрав\p{L}*|реж\p{L}*|резать|порез\p{L}*|пореж\p{L}*|перереж\p{L}*|перерез\p{L}*|вскр\p{L}*|поконч\p{L}*|лиш\p{L}*|задуш\p{L}*|душить|сжеч\p{L}*|сжиг\p{L}*|поджеч\p{L}*|поджиг\p{L}*)`,'u'),
 new RegExp(String.raw`(?<![\p{L}])(?:убива\p{L}*|убь\p{L}*|убить|убей\p{L}*|веша\p{L}*|повес\p{L}*|повеш\p{L}*|утоп\p{L}*|топить\p{L}*|топл\p{L}*|стрел\p{L}*|застрел\p{L}*|выстрел\p{L}*|отрав\p{L}*|реж\p{L}*|резать|порез\p{L}*|пореж\p{L}*|перереж\p{L}*|перерез\p{L}*|вскр\p{L}*|поконч\p{L}*|лиш\p{L}*|задуш\p{L}*|душить|сжеч\p{L}*|сжиг\p{L}*|поджеч\p{L}*|поджиг\p{L}*)${SENT}{0,25}(?<![\p{L}])(?:себя|собой|самого себя)(?![\p{L}])`,'u'),
 // ru: себе (dative: "for myself", "hung a shelf for myself") only with a cutting / shooting verb and a body part
 new RegExp(String.raw`(?<![\p{L}])себе${SENT}{0,12}(?:вены|вен|горло|запястья|голову|в голову)${SENT}{0,12}(?:вскр\p{L}*|перереж\p{L}*|перерез\p{L}*|пореж\p{L}*|реж\p{L}*|выстрел\p{L}*|стрел\p{L}*)|(?:вскр\p{L}*|перереж\p{L}*|перерез\p{L}*|пореж\p{L}*|выстрел\p{L}*)${SENT}{0,12}себе${SENT}{0,12}(?:вены|вен|горло|запястья|голову)`,'u'),
 // ru: cutting veins / throat / wrists, with or without «себе», either order; reflexive cutting with a blade ("я режусь в шахматы" is not this)
 new RegExp(String.raw`(?<![\p{L}])(?:вскр\p{L}*|перереж\p{L}*|перерез\p{L}*|пореж\p{L}*|реж\p{L}*)\s+(?:себе\s+)?(?:вены|вен|горло|запястья)(?![\p{L}])|(?<![\p{L}])(?:вены|вен|горло|запястья)\s+(?:себе\s+)?(?:вскр\p{L}*|перереж\p{L}*|пореж\p{L}*|реж\p{L}*)|(?<![\p{L}])режусь\s+(?:ножом|лезвием|бритвой|осколком|стеклом)(?!\s+(?:при|когда|во время)\s+(?:брить\p{L}*|бритье|бритьё|готов\p{L}*|чистк\p{L}*|резк\p{L}*))`,'u'),
 // ru: ending one's own life: the life itself must be the object ("хочу прекратить все лекарства" is not this)
 new RegExp(String.raw`(?<![\p{L}])(?:законч\p{L}*|заверш\p{L}*|прекра\p{L}*|полож\p{L}* конец|положи\p{L}* конец|лиш\p{L}*)\s+(?:\p{L}+\s+)?(?:свою |своей |мою |моей )?жизн\p{L}*`,'u'),
 // ru: reflexive forms that already say "myself" ("я режусь в шахматы" and "убиваюсь от горя" are not this, so those are not here)
 new RegExp(String.raw`(?<![\p{L}])(?:вешаюсь|повешусь|топлюсь|утоплюсь|травлюсь|отравлюсь|стреляюсь|застрелюсь|вскроюсь|убьюсь|сожгу себя|сжигаю себя)(?![\p{L}])`,'u'),
 // ru: a jump from a height or under a vehicle (either order)
 new RegExp(String.raw`(?<![\p{L}])(?:прыг\p{L}*|спрыг\p{L}*|выпрыг\p{L}*|выброс\p{L}*|бросаюсь|брошусь|бросит\p{L}*)${SENT}{0,30}(?<![\p{L}])(?:крыш\p{L}*|скал\p{L}*|башн\p{L}*|мост\p{L}*|окн\p{L}*|балкон\p{L}*|поезд\p{L}*|машин\p{L}*|реку|воду|высотк\p{L}*)|(?<![\p{L}])(?:с|со|из)\s*(?:крыш\p{L}*|скал\p{L}*|башн\p{L}*|мост\p{L}*|окн\p{L}*|балкон\p{L}*)${SENT}{0,12}(?<![\p{L}])(?:прыгн\p{L}*|прыга\p{L}*|спрыгн\p{L}*|выпрыгн\p{L}*)`,'u'),
 // ru: a deadly dose
 new RegExp(String.raw`(?<![\p{L}])смертельн\p{L}* доз\p{L}*`,'u'),
 // ru: "не хочу быть здесь", "не желаю жить", "со всем покончить"
 new RegExp(String.raw`(?<![\p{L}])не хочу (?:\p{L}+ )?(?:быть здесь|здесь быть|существовать)(?: больше)?(?: сейчас| сегодня)?\s*(?:[.,!?;։\n]|$)`,'u'),
 new RegExp(String.raw`(?<![\p{L}])не желаю жить(?![\p{L}])|(?<![\p{L}])(?:собираюсь|хочу|намерен\p{L}*|решил\p{L}*)\s+(?:со всем )?покончить(?: со всем)?(?: сейчас| сегодня)?\s*(?:[.,!?;։\n]|$)`,'u'),
 // hy: self-reference + a harm verb stem, either order. The verb stem must start the word (optionally with the future prefix կ: «մայրս» contains «այր» but is not «այրել»), and «ինձ համար» (for myself) is not a self-directed object («ինձ համար հաց կտրել» is bread). «ինքս» alone is just "by myself".
 new RegExp(String.raw`(?:ինձ(?!\s+համար)|ինքնա\p{L}*|կյանք\p{L}*|երակ\p{L}*|կոկորդս|գլխիս)${SENT}{0,25}(?<![\p{L}])կ?(?:սպան|կախ|խեղդ|թունավոր|կտր|նետվ|զոհ|կրակ|գնդակահար|այր|վերջաց|ավարտ)\p{L}*|(?<![\p{L}])կ?(?:սպան|կախ|խեղդ|թունավոր|կտր|նետվ|կրակ|գնդակահար|այր|վերջաց|ավարտ)\p{L}*${SENT}{0,25}(?:ինձ(?!\s+համար)|ինքնա\p{L}*|կյանք\p{L}*|երակ\p{L}*|կոկորդս|գլխիս)|(?<![\p{L}])վերջ\s+(?:\p{L}+\s+)?(?:կյանք\p{L}*)|(?:կյանք\p{L}*)\s+(?:\p{L}+\s+)?վերջ(?![\p{L}])`,'u'),
 // hy: to hang oneself (reflexive); «կախված է» "depends on" is not this
 new RegExp(String.raw`(?<![\p{L}])(?:կկախվ|կախվ(?:ել|եմ|ելու))\p{L}*`,'u'),
 // hy: poison to drink, a deadly dose, to drown oneself, ending everything
 new RegExp(String.raw`թույն\p{L}*${SENT}{0,12}խմ\p{L}*|խմ\p{L}*${SENT}{0,12}թույն|մահացու\s+(?:\p{L}+\s+)?չափաբաժին|չափաբաժին${SENT}{0,20}մահացու|խեղդվելու եմ|(?:ուզում եմ|պատրաստվում եմ|որոշել եմ)\s+խեղդվ|(?:ուզում եմ|որոշել եմ|պատրաստվում եմ)\s+ամեն ինչ\s+(?:ավարտ|վերջաց)\p{L}*|ամեն ինչ կավարտեմ`,'u'),
 // hy: a jump from a height or under a vehicle
 new RegExp(String.raw`(?:նետվ\p{L}*|թռչ\p{L}*|ցած)${SENT}{0,30}(?:տանիք\p{L}*|պատշգամբ\p{L}*|պատուհան\p{L}*|կամուրջ\p{L}*|կամրջ\p{L}*|ժայռ\p{L}*|աշտարակ\p{L}*|գնացք\p{L}*|մեքենա\p{L}*|ավտոբուս\p{L}*)|(?:տանիք\p{L}*|պատշգամբ\p{L}*|պատուհան\p{L}*|կամուրջ\p{L}*|կամրջ\p{L}*|ժայռ\p{L}*|գնացք\p{L}*)${SENT}{0,20}(?:նետվ\p{L}*|թռչ\p{L}*|ցած)`,'u'),
 // hy: not wanting to be here / to live (passive ideation)
 new RegExp(String.raw`չեմ ուզում (?:այստեղ լինել|գոյություն)|ապրելու ցանկություն չունեմ|այլ(?:ե|և)ւս ապրել չեմ կարող|չեմ ցանկանում ապրել`,'u'),
 // hy-Latn
 /(?<![\p{L}])(?:indz|inqs|indz inqs)\s+(?:\p{L}+\s+)?(?:kaxem|kkaxem|kspanem|spanem|kxexdem|kthunavorem|ktrem|tunavorem)|(?<![\p{L}])(?:tanikic|pashtgambic|patuhanic)\s+ceric/u,
];
const PATTERN_ENTRY:Entry=Object.freeze({id:'S-SELF-PATTERN',locale:'en',all:[],redFlag:null,selfHarm:true});
const PASSIVE_ENTRY:Entry=Object.freeze({id:'S-SELF-PASSIVE',locale:'en',all:[],redFlag:null,selfHarm:true});
const NO_PLAN=/(?:i )?(?:have |got )?no plans?|(?:don'?t|do not) have (?:a|any) plans?|without a plan|(?:у меня )?(?:нет|без) плана|плана нет|պլան չունեմ|ծրագիր չունեմ|պլան չկա|առանց պլանի|plan chunem|plan chka/gu;
// Only words that say nothing of intent, means, time or place. Anything else is left over, and left over means 103. Normalised as the text is («և» becomes «եւ»).
const PASSIVE_FILLER=new Set(['i',"i'm",'im','am','just','only','really','so','very','sometimes','often','lately','recently','anymore','more','any','longer','think','thinking','keep','feel','feeling','have','a','the','that','and','but','or','my',
 'я','мне','меня','у','просто','только','иногда','часто','больше','очень','так','и','но','а','что','думаю','кажется','чувствую',
 'ես','ինձ','պարզապես','ուղղակի','միայն','երբեմն','հաճախ','վերջերս','այլևս','շատ','և','ու','բայց','որ','մտածում','եմ','է','ունեմ','կարծում',
 'es','indz','parzapes','uxxaki','miayn','erbemn','hachax','verjerhs','aylevs','shat','u','bayc','vor','mtacum','em','e','unem'].map(normaliseText));
// Everyday sentences alone ("I will do it tomorrow", «инсулин рядом»), so they are a plan only in the 24 hours after the today reply. An explicit
// list on purpose: leftover words are not enough here, "thanks" and "what's for dinner?" stay ordinary. Inside that context, in doubt it is listed
// (Astra #522): a plan said as such, the means themselves, or tablets with a word of preparation. "I took my tablets" alone is not.
const SELF_PLAN_PHRASE=new RegExp([
 /(?<![\p{L}])(?:i (?:have|have got) (?:the )?means (?:ready|prepared)|средства (?:готовы|приготовлены)|միջոցները պատրաստ են)(?![\p{L}])/u.source,
 /i(?:'ve| have)(?: got)? a method|(?:everything|it all)(?:'s| is) ready|i know (?:exactly )?how (?:i(?:'d| would| will)? |to )do it|looking up ways|i(?:'ll| will) do it (?:today|tonight|tomorrow|soon)|(?:bottle of \p{L}+ and )?my insulin (?:is )?here/u.source,
 /завтра вс[её] сделаю|сегодня вс[её] сделаю|инсулин рядом|знаю,? как это сделать|скоро вс[её] закончится/u.source,
 /այսօր գիշեր կանեմ|այս գիշեր կանեմ|վաղը կանեմ|ինսուլինը ձեռքիս է|դեղերը հավաքել եմ/u.source,
 /dexery havaqel em|aysor gisher kanem|ays gisher kanem|vaxy kanem/u.source,
 /(?<![\p{L}])(?:i(?:'ve| have)(?: got| made)? a plan|i(?:'ve| have) (?:made|got) (?:my )?plans?|my plan is|i(?:'m| am) planning|i plan to|the plan is ready|есть план|у меня план|мой план|план готов|планирую|պլան(?:ը)? ունեմ|պլան կա|պլանը պատրաստ\p{L}*|ծրագիր ունեմ|պլանավորում եմ|plan(?:y)? unem|plan ka|plany patrast\w*|planavorum em)(?![\p{L}])/u.source,
 /(?<![\p{L}])(?:i(?:'ll| will| am going to|'m going to|'m gonna) (?:do it|end it|finish it)|сделаю это|հրաժեշտ\p{L}*|hrajesht\w*|goodbye|farewell|прощ\p{L}*|записк\p{L}*|wrote a (?:note|letter))(?![\p{L}])/u.source,
 /(?<![\p{L}])(?:rope|noose|razor|blade|gun|knife|bridge|roof|balcony|jump\w*|верёвк\p{L}*|веревк\p{L}*|петл\p{L}*|лезви\p{L}*|пистолет\p{L}*|ружь\p{L}*|нож\p{L}*|мост\p{L}*|крыш\p{L}*|балкон\p{L}*|прыгн\p{L}*|спрыгн\p{L}*|պարան\p{L}*|դանակ\p{L}*|ածելի\p{L}*|զենք\p{L}*|կամուրջ\p{L}*|տանիք\p{L}*|պատշգամբ\p{L}*|նետվ\p{L}*|paran\w*|danak\w*|kamurj\w*|taniq\w*|netv\w*)(?![\p{L}])/u.source,
 /(?<![\p{L}])(?:bought|got|купил\p{L}*|գնել եմ|գնեցի|gnel em|gneci)[^.!?։\n]{0,25}(?:pills?|tablets?|таблет\p{L}*|лекарств\p{L}*|հաբ\p{L}*|դեղ\p{L}*|hab\w*|dexer\w*)/u.source,
 /(?:pills?|tablets?|medicines?|meds|insulin|таблет\p{L}*|лекарств\p{L}*|инсулин\p{L}*|հաբ\p{L}*|դեղ\p{L}*|ինսուլին\p{L}*|hab(?:er)?y?|dexer\w*|insulin\w*)[^.!?։\n]{0,25}(?:bought|got|գնեցի|գնել եմ|gneci|gnel em|ready|prepared|collected|gathered|saved up|stockpiled|in front of me|приготов\p{L}*|готов\p{L}*|собрал\p{L}*|накопил\p{L}*|передо мной|պատրաստ\p{L}*|հավաք\p{L}*|կուտակ\p{L}*|patrast\w*|havaq\w*)/u.source,
 /(?:ready|prepared|collected|gathered|saved up|stockpiled|приготов\p{L}*|собрал\p{L}*|накопил\p{L}*|հավաք\p{L}*|կուտակ\p{L}*|havaq\w*)[^.!?։\n]{0,25}(?:pills?|tablets?|medicines?|meds|insulin|таблет\p{L}*|лекарств\p{L}*|инсулин\p{L}*|հաբ\p{L}*|դեղ\p{L}*|ինսուլին\p{L}*)/u.source,
].join('|'),'u');
/** Fable #522 follow-up: one of those phrases, said now. The pipeline asks only after the today reply, with no doctor reply since. */
// Latin-script Armenian writes "minutes" as "rope" ("5 rope", "mi qani rope"): a duration, never the means word.
const LATIN_ARMENIAN_MINUTES=/(?<![\p{L}\p{N}])(?:\d+|mi qani|mek|erku|ereq|chors|hing|vec|yot|ut|iny|tas\p{L}*)\s+rope(?![\p{L}])/gu;
export const selfHarmPlanPhrase=(text:string)=>asserted(normaliseText(text).replaceAll('’',"'").replace(LATIN_ARMENIAN_MINUTES,' '),SELF_PLAN_PHRASE);
export function selfHarmLevel(text:string):SelfHarmLevel{
 const t=normaliseText(text).replaceAll('’',"'"),found=stagingMatches(text);
 if(!found.some(x=>x.selfHarm))return 'none';
 if(!found.includes(PASSIVE_ENTRY)||found.some(x=>!x.selfHarm))return 'urgent';
 const left=t.replace(PASSIVE_SELF,' ').replace(NO_PLAN,' ').match(/[\p{L}\p{N}']+/gu)??[];
 return left.every(w=>PASSIVE_FILLER.has(w))?'passive':'urgent';
}

const flagsOf=(found:Entry[])=>[...new Set(found.map(f=>f.redFlag).filter((f):f is NonNullable<Flag>=>f!==null))].sort();

/** The placeholder list as an UrgentMatcher (care-team alert screening reads it on staging only). */
export const stagingUrgentMatcher:UrgentMatcher=Object.freeze({
 lexicon:STAGING_LEXICON,
 match:(text:string):UrgentMatch[]=>stagingMatches(text).map(x=>({entryId:x.id,redFlag:x.redFlag})),
 decide:(text:string)=>stagingDecision(text),
});

export function stagingDecision(text:string):ZoeDecision{
 // Only list facts are journaled: never the text or the words that matched.
 const base={name:'zoe.urgent_match' as const,rule:'zoe.urgent_staging_placeholder',ruleVersion:STAGING_LEXICON_VERSION,
  attributes:{'noreon.zoe.lexicon.entries':STAGING_ENTRIES.length,'noreon.zoe.lexicon.status':'staging_placeholder_not_s1'}};
 const found=stagingMatches(text);
 return found.length?{...base,outcome:'escalate',reason:'urgent_words_matched_staging_list',attributes:{...base.attributes,'noreon.zoe.urgent.red_flags':flagsOf(found).join(','),'noreon.zoe.urgent.entries':found.length}}
  :{...base,outcome:'recorded',reason:'no_staging_list_words'};
}
