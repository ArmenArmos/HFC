import {BATCH_OTHER_PERSON,bpFirstPerson,bpReadings} from './bp-parse';
import {bpVeryHigh} from '@/lib/clinical/rules/bp-check';
import {normaliseText} from './normalise';
import {assertedAlarmSymptom} from './alarm-conversation';
import {textRedFlags} from './symptoms/red-flags';

// Roo631 item 8: positively attributed readings only. Any symptom or own health information leaves today's safety route intact.
const RELATIVE=/(?:grand(?:ma|pa)(?:'s)?|մայրիկ\p{L}*|հայրիկ\p{L}*|տատիկ\p{L}*|պապիկ\p{L}*|ամուսնուս|կնոջս|ընկերոջս|հարեւան\p{L}*|у (?:друга|подруги|соседа|соседки))/u;
const PRONOUN=/(?<![\p{L}])(?:he|she|his|her|он|она|его|её|ее|у него|у неё|у нее|նրա|նա)(?![\p{L}])/u;
const OWN_VALUE=/(?<![\p{L}])(?:my (?:(?:own|blood) )*(?:bp|pressure|pulse|heart|reading)|mine|me|мой|моя|моё|мое|мо[ий] (?:давлен|пульс)|у меня|իմ ճնշ|ճնշումս|պուլսս|ինձ մոտ)(?![\p{L}])|(?:ճնշումս|պուլսս)/u;
// Conservative veto, including non-urgent symptoms: an unrecognised presentation stays with the normal check, never a lower route.
const SYMPTOM=/(?:pain|hurt|ache|dizz|lighthead|weak|faint|breath|speak|speech|numb|confus|vomit|sweat|vision|blind|bleed|seizure|swollen|head|sick|unwell|symptom|бол|слаб|голов|дыш|одыш|обмор|реч|говор|неме|зрен|рвот|судорог|кров|плохо|симптом|ցավ|գլխ|թուլ|շնչ|ուշագնաց|խոս|տեսող|փսխ|արյուն|վատ|ախտանիշ|cav|glx|glkh|tul|shnch)/u;
// Subject and reading must be in the same clause with only measurement words between them.
// Merely mentioning a relative elsewhere never establishes whose number this is.
const SUBJECT=new RegExp(`${BATCH_OTHER_PERSON.source}|${RELATIVE.source}|${PRONOUN.source}`,'gu');
const READING_LINK=/^(?:'s|-ի)?[\s:=-]*(?:(?:blood|pressure|bp|a|of|is|was|has|have|measured|measures|just|now|today|right|the|reading|давлен\p{L}*|сейчас|сегодня|измерил\p{L}*|измерени\p{L}*|у|ճնշ\p{L}*|հենց|նոր|չափեց|չափել|է|հիմա)[\s:=-]*)*$/u;
const CLAUSE=/[,;.!?\n]|(?<![\p{L}])(?:and|but|и|но|а|եւ|ու|բայց|իսկ)(?![\p{L}])/gu;
// Whole clauses only. Unknown prose cannot authorize lowering an emergency, even when no symptom stem matches it.
const CARER_ACTION=/^(?:what (?:should|can|do) i (?:do|tell (?:him|her|them))|should i worry|what do i tell (?:him|her|them)|what should (?:he|she|they) do|что делать|что (?:ему|ей|им) делать|ինչ անեմ|ինչ ասեմ նրան)$/u;
const WELL=/^(?:(?:he|she) (?:feels? (?:ok|okay|fine|well)|is (?:ok|okay|fine|well))|(?:он|она) чувствует себя (?:нормально|хорошо)|(?:նա|նրա վիճակը) (?:լավ է|իրեն լավ է զգում))$/u;
const relativeReading=(clause:string)=>{
 const readings=bpReadings(clause),reading=readings[0];
 if(readings.length!==1||!reading||!bpVeryHigh(reading))return false;
 const before=clause.slice(0,reading.index);
 // The pair was already validated by bpReadings; find its end to check all remaining words too.
 const pair=clause.slice(reading.index).match(/^\d{1,3}\D*?\d{1,3}/u)![0];
 return READING_LINK.test(clause.slice(reading.index+pair.length))&&[...before.matchAll(SUBJECT)].some(m=>
  READING_LINK.test(before.slice(0,m.index))&&READING_LINK.test(before.slice(m.index+m[0].length)));
};
/** An attributed relative's reading must not trigger the member's remeasure shortcut while other content awaits assessment. */
export const hasThirdPartyBpReading=(texts:readonly string[])=>texts.some(raw=>normaliseText(raw).replaceAll('’',"'").split(CLAUSE).some(c=>relativeReading(c.trim())));
/** A positively attributed reading plus only known carer questions or relative-well clauses. Anything else keeps normal safety. */
export function thirdPartyBpOnly(texts:readonly string[]):boolean{
 let hasReading=false;
 const onlyRelative=texts.length>0&&texts.every(raw=>{
  const t=normaliseText(raw).replaceAll('’',"'");
  // Carer action questions contain "I" without reporting an own symptom/value.
  const healthWords=t.replace(/(?:what (?:should|can|do) i (?:do|tell (?:him|her|them))|should i worry|what do i tell (?:him|her|them))/gu,'');
  if(OWN_VALUE.test(t)||bpFirstPerson(healthWords)||SYMPTOM.test(t)||assertedAlarmSymptom(t)||textRedFlags([raw],{intakeActive:false}).length)return false;
  const clauses=t.split(CLAUSE).map(c=>c.trim()).filter(Boolean);
  return clauses.length>0&&clauses.every(clause=>{
   if(relativeReading(clause)){hasReading=true;return true;}
   return CARER_ACTION.test(clause)||WELL.test(clause);
  });
 });
 return onlyRelative&&hasReading;
}
/** The model must not give the member their own medicine instructions in a carer's answer. */
export const thirdPartyOwnInstruction=(reply:string)=>/(?:your|ձեր|ваш\p{L}*)[^.!?։\n]{0,55}(?:medicin|medicat|tablet|pill|դեղ|հաբ|лекарств|таблет|препарат)|(?:don't|do not) drive yourself|call 103 now|позвоните 103 сейчас|զանգահարեք 103 հիմա/iu.test(reply);
