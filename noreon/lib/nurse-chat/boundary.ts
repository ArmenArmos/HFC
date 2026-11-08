/** A nurse asks the chat to do what only the doctor may: prescribe, change a dose, diagnose, or delete or hide a record.
 * Bounded phrase rules, no model. A match gets one fixed line; nothing is sent, changed or saved. Words that merely mention a
 * dose or a medicine ("what dose is she on", "she wants to stop the statin") are not a match. */
const clean=(raw:string)=>raw.normalize('NFKC').toLocaleLowerCase().replace(/[’`]/gu,"'").replace(/[՛՜՞]/gu,'').replace(/[?!.։,;:()"«»]+/gu,' ').replace(/\s+/gu,' ').trim();
const LEAD='(?:(?:please|just|now|can you|could you|zoe|пожалуйста|просто|можешь|можете|зоя)[ ,]+)*';
const DOSE_NOUN='(?:dose|dosage|pills?|tablets?|medication|medicine|meds|statin|amlodipine|ramipril|\\d+ ?mg|дозу|дозировку|таблетки|препарат|лекарство|статин)';
const RULES:RegExp[]=[
 // prescribe
 new RegExp(`^${LEAD}(?:prescribe|write (?:(?:her|him|them|a|the|some) )*(?:prescription|medicine|medication|pills?)|give (?:her|him|them) (?:a )?prescription)\\b`,'u'),
 new RegExp(`^${LEAD}(?:назначь(?:те)?|выпиши(?:те)?|пропиши(?:те)?)(?!\\p{L})`,'u'),
 /(?:դեղ|դեղամիջոց)\s+(?:գրի|նշանակի)|(?:գրի|նշանակի)\s+(?:\S+\s+)?(?:դեղ|դեղամիջոց)/u,
 // change a dose
 new RegExp(`^${LEAD}(?:double|increase|raise|up|reduce|lower|halve|cut|change|adjust|switch)\\b.{0,40}\\b${DOSE_NOUN}`,'u'),
 new RegExp(`^${LEAD}(?:удвой(?:те)?|увеличь(?:те)?|повысь(?:те)?|уменьши(?:те)?|снизь(?:те)?|поменяй(?:те)?|измени(?:те)?|отмени(?:те)?)(?!\\p{L}).{0,40}${DOSE_NOUN}`,'u'),
 /չափաբաժին\S*\s+(?:փոխ|ավելացր|նվազեցր|կրկնապատկ)|(?:փոխիր|ավելացրու|նվազեցրու|կրկնապատկիր)\s+(?:\S+\s+){0,3}(?:չափաբաժին|դեղ)/u,
 // diagnose
 /^(?:(?:please|just|can you|could you|zoe)[ ,]+)*(?:diagnose|put (?:a |the )?diagnosis|give (?:her|him|them) a diagnosis)\b/u,
 /(?:поставь|поставьте|установи|установите) диагноз/u,
 /ախտորոշ(?:իր|ում դիր)|ախտորոշում\s+(?:դիր|գրի)/u,
 // delete or hide a record
 new RegExp(`^${LEAD}(?:delete|erase|remove|hide|wipe)\\b.{0,50}\\b(?:reading|record|entry|measurement|note|result|bp|pressure|readings)\\b`,'u'),
 new RegExp(`^${LEAD}(?:удали(?:те)?|сотри(?:те)?|убери(?:те)?|скрой(?:те)?)(?!\\p{L}).{0,50}(?:давлени|запис|измерени|заметк|результат|показател)`,'u'),
 /(?:ջնջիր|հեռացրու|թաքցրու)\s+(?:\S+\s+){0,4}(?:ճնշում|գրառում|չափում|արդյունք)/u,
];

export function nurseBoundary(raw:unknown):boolean{
 if(typeof raw!=='string'||raw.length>400||/[\u0000-\u001f\u007f]/u.test(raw))return false;
 const text=clean(raw);return text.length>0&&RULES.some(rule=>rule.test(text));
}
