import type {Locale} from '@/lib/locale';
import {alarmRuleReason} from '@/lib/zoe/alarm-reasons';
import {ruleById} from '@/lib/clinical/rules/rules';
import {TEXT_RULES} from '@/lib/zoe/symptoms/red-flags';
import {SHEETS} from '@/lib/zoe/symptoms/sheets';
import {st} from './staff-locale-copy';

export const staffReviewStep=(locale:Locale)=>st(locale,'Open the member and review','Բացեք անդամի էջը և վերանայեք','Откройте страницу участника и проверьте');
export const staffRecordedTrigger=(locale:Locale)=>st(locale,'Recorded trigger','Գրանցված պատճառ','Записанная причина');
/** Display only. Stored references, clinical decisions and audit/export source data keep their identifiers. */
// Read the existing mappings rather than transcribing clinical relationships again.
const candidates=[...TEXT_RULES,...SHEETS.flatMap(sheet=>sheet.questions.flatMap(q=>q.redFlagIfYes?[q.redFlagIfYes]:[])),{id:'bp_crisis_reading',rf:'RF-03'},{id:'bp_crisis',rf:'RF-03'}];
// Some sheet IDs (right_now) mean different things on different sheets. They need the saved hit's rf.
const ALIASES=new Map(candidates.filter(candidate=>candidate.rf&&candidates.every(other=>other.id!==candidate.id||other.rf===candidate.rf)).map(candidate=>[candidate.id,candidate.rf!]));
type Label=readonly [string,string,string];
// Display names, not clinical assertions. In particular an RF family is not evidence
// that every symptom in the questionnaire rule's explanation was reported.
const CODE_LABELS:Record<string,Label>={
 'RF-01':['chest warning sign','կրծքավանդակի վտանգի նշան','тревожный признак в груди'],
 'RF-02':['breathing or fainting warning sign','շնչառության կամ ուշագնացության վտանգի նշան','тревожный признак дыхания или обморока'],
 'RF-03':['blood pressure warning sign','արյան ճնշման վտանգի նշան','тревожный признак артериального давления'],
 'RF-04':['movement, sensation or speech warning sign','շարժման, զգացողության կամ խոսքի վտանգի նշան','тревожный признак движения, чувствительности или речи'],
 'RF-05':['consciousness or seizure warning sign','գիտակցության կամ ցնցումների վտանգի նշան','тревожный признак сознания или судорог'],
 'RF-06':['blood pressure warning sign','արյան ճնշման վտանգի նշան','тревожный признак артериального давления'],
 'RF-07':['chest warning sign','կրծքավանդակի վտանգի նշան','тревожный признак в груди'],
 'RF-08':['fainting warning sign','ուշագնացության վտանգի նշան','тревожный признак обморока'],
 'RF-09':['fainting warning sign','ուշագնացության վտանգի նշան','тревожный признак обморока'],
 'RF-10':['heart rhythm warning sign','սրտի ռիթմի վտանգի նշան','тревожный признак сердечного ритма'],
 'RF-11':['blood sugar warning sign','արյան շաքարի վտանգի նշան','тревожный признак сахара крови'],
 'RF-12':['family history warning sign','ընտանեկան պատմության վտանգի նշան','тревожный признак семейного анамнеза'],
 fainting:['Fainting','Ուշագնացություն','Обморок'],
 breathless_at_rest:['Breathlessness at rest','Հանգստի ժամանակ շնչարգելություն','Одышка в покое'],
 weakness_numbness:['Weakness or numbness','Թուլություն կամ թմրածություն','Слабость или онемение'],
 speech_trouble:['Trouble speaking','Խոսելու դժվարություն','Нарушение речи'],
 thunderclap:['Sudden or unusually severe headache','Հանկարծակի կամ անսովոր ուժեղ գլխացավ','Внезапная или необычно сильная головная боль'],
 vision_loss:['Vision loss or double vision','Տեսողության կորուստ կամ կրկնակի տեսողություն','Потеря зрения или двоение в глазах'],
 head_injury:['Head injury','Գլխի վնասվածք','Травма головы'],
 confusion:['Confusion','Շփոթվածություն','Спутанность сознания'],
 fever_stiff_neck:['Fever with a stiff neck','Ջերմություն՝ պարանոցի կարկամությամբ','Температура со скованностью шеи'],
 chest_pain:['Chest pain or pressure','Կրծքավանդակի ցավ կամ ճնշում','Боль или сдавление в груди'],
 right_now:['Current symptom check','Ընթացիկ ախտանիշի ստուգում','Проверка текущего симптома'],
 at_rest_now:['Current breathlessness check','Ընթացիկ շնչարգելության ստուգում','Проверка текущей одышки'],
 spreads:['Spread to the arm, jaw, neck or back','Տարածվել է ձեռքին, ծնոտին, պարանոցին կամ մեջքին','Распространение в руку, челюсть, шею или спину'],
 with_sweat_or_breath:['With sweating, sickness or breathlessness','Քրտնարտադրությամբ, սրտխառնոցով կամ շնչարգելությամբ','С потливостью, тошнотой или одышкой'],
 with_dizzy_breath_faint:['With dizziness, breathlessness or near-fainting','Գլխապտույտով, շնչարգելությամբ կամ ուշագնացության զգացումով','С головокружением, одышкой или предобморочным состоянием'],
 face_lips_tongue:['Swelling of the face, lips or tongue','Դեմքի, շրթունքների կամ լեզվի այտուց','Отёк лица, губ или языка'],
 one_leg_red_painful:['One leg swollen, red or painful','Մեկ ոտքն այտուցված, կարմիր կամ ցավոտ է','Отёк, покраснение или боль в одной ноге'],
 chest_pain_mixed:['Chest pain','Կրծքավանդակի ցավ','Боль в груди'],
 chest_pressure_mixed:['Chest pressure','Կրծքավանդակի ճնշում','Сдавление в груди'],
 chest_spreads:['Chest discomfort spreading to the arm, jaw, neck or back','Կրծքավանդակի անհանգստության տարածում դեպի ձեռք, ծնոտ, պարանոց կամ մեջք','Распространение дискомфорта в груди в руку, челюсть, шею или спину'],
 bp_crisis_reading:['Blood pressure warning reading','Արյան ճնշման վտանգի չափում','Тревожное измерение артериального давления'],
 bp_crisis:['Blood pressure warning sign','Արյան ճնշման վտանգի նշան','Тревожный признак артериального давления'],
 problem_worsening:['Worsening symptoms','Ախտանիշների վատացում','Ухудшение симптомов'],
 DKA:['Blood sugar warning sign','Արյան շաքարի վտանգի նշան','Тревожный признак сахара крови'],
 POIS:['Poisoning warning sign','Թունավորման վտանգի նշան','Тревожный признак отравления'],
 ANA:['Reaction warning sign','Ռեակցիայի վտանգի նշան','Тревожный признак реакции'],
 BLEED:['Bleeding warning sign','Արյունահոսության վտանգի նշան','Тревожный признак кровотечения'],
 LIMB:['Limb warning sign','Վերջույթի վտանգի նշան','Тревожный признак в конечности'],
 SELF:['Self-harm concern','Ինքնավնասման մտահոգություն','Опасение самоповреждения'],
};
/** Safe inside a sentence or source attribution: no new assertion, time or action. */
export function staffCodeLabel(code:string,locale:Locale):string{
 const label=Object.hasOwn(CODE_LABELS,code)?CODE_LABELS[code]:undefined;
 if(label)return st(locale,...label);
 return staffRecordedTrigger(locale);
}
/** Structured hits only: the recorded trigger, then existing guidance on its own line. */
export function staffRuleLabel(code:string,locale:Locale,redFlag?:string|null):string{
 const rule=ruleById(redFlag??ALIASES.get(code)??code),alarm=alarmRuleReason(code,locale);
 const trigger=Object.hasOwn(CODE_LABELS,code)?staffCodeLabel(code,locale):ruleById(code)?.reason[locale]??staffRecordedTrigger(locale);
 // Families select an existing action only. They never supply the symptom label.
 const step=rule?.nextStep?.[locale]??(alarm?ruleById('RF-01')?.nextStep?.[locale]:undefined);
 return step?`${trigger}\n${st(locale,'Suggested step','Առաջարկվող քայլ','Предлагаемый шаг')}: ${step}`:`${trigger}\n${staffReviewStep(locale)}`;
}
/** Neutral replacements only, including old saved text. Quoted prose keeps ordinary underscored words. */
export function staffDisplayText(text:string,locale:Locale,quoted=false):string{
 return text.replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|\b(?:DKA|POIS|ANA|BLEED|LIMB|SELF|RF-\d+|NRN-[\w-]+|S-[A-Z]+-[\w-]+|[a-z][a-z0-9]*(?:_[a-z0-9]+)+|zoe\.[a-z][\w.]*)\b/g,code=>{
  if(code.includes('@'))return code;
  if(quoted&&!/^(?:RF-|NRN-|S-|zoe\.)/.test(code)&&!ALIASES.has(code)&&!Object.hasOwn(CODE_LABELS,code)&&!alarmRuleReason(code,locale))return code;
  // Free text may deny a finding or describe the past. Never infer an action
  // from prose; only a structured rule/hit may use staffRuleLabel.
  return staffCodeLabel(code,locale);
 });
}
