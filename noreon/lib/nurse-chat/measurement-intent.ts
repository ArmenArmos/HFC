/** A nurse types a reading to be recorded: "bp 148/93 pulse 72", "ճնշումը 148/93 է, զարկերակը 72", "weight 82 waist 98 for hayk".
 * Bounded rules, no model. The whole message must be the reading, an optional member name after "for", and a few filler words;
 * any other word means it is a question or a note and stays with Zoe. Reported or past readings ("yesterday at home"), corrections
 * and deletions are never taken for a reading to record now. The values still pass the visit parser and the database rules. */
export type MeasureField='bp'|'weight'|'waist';
export type MeasureEntry={field:MeasureField;text:string};
export type MeasureIntent={entries:MeasureEntry[];name:string|null};

const NOT_NOW=/(?:\u055e|yesterday|last (?:week|night|time)|earlier|at home|ago|reported|fix|correct|oops|typo|wrong|mistake|delete|erase|вчера|дома|назад|на прошлой|исправ|ошиб|удал|ошибся|երեկ|տանը|սխալ|ջնջ|\?)/u;
const FILLER=new Set(`a the is are was now please zoe record enter add log save put her his him their reading readings measurement measurements today right left arm seated sitting standing and with taken
 ей ему её ее их пожалуйста сейчас сидя стоя правая левая рука руке руку запиши внеси занеси измерение показания и
 է եմ նրա նրան հիմա նստած աջ ձախ ձեռք գրանցիր գրի`.split(/\s+/u));
const BP_WORD=/(?:\bbp\b|blood pressure|давлени\S*|\bад\b|ճնշում\S*)/u;
const PULSE=/(?:pulse|hr|heart rate|пульс\S*|զարկերակ\S*)/u;

function take(text:string,pattern:RegExp):{match:RegExpExecArray;rest:string}|null{
 const match=pattern.exec(text);if(!match)return null;
 return {match,rest:text.slice(0,match.index)+' '+text.slice(match.index+match[0].length)};
}
const decimal=(value:string)=>value.replace(',','.');

/** A question or a past-tense statement is not a reading to record: it opens with a question or auxiliary word, or says was/were/had. */
const QUESTION_OPENER=/^(?:zoe[ ,]+)?(?:is|was|were|are|did|does|do|has|have|had|what|how|why|when|where|who|which|can|could|would|should|что|как|почему|когда|где|кто|какое|какой|ли|а|что за|ինչ|ինչպես|ինչու|երբ|որտեղ|ով)\b/u;
const PAST=/\b(?:was|were|had|был|была|были|было|էր|էին)\b/u;
export function measurementIntent(raw:unknown):MeasureIntent|null{
 if(typeof raw!=='string'||raw.length>200||/[\u0000-\u001f\u007f]/u.test(raw))return null;
 const lowered=raw.toLocaleLowerCase();
 if(NOT_NOW.test(lowered)||PAST.test(lowered)||QUESTION_OPENER.test(lowered.replace(/^[^\p{L}\p{N}]+/u,'')))return null;
 let text=raw.normalize('NFKC').toLocaleLowerCase().replace(/[’`]/gu,"'").replace(/[՛՜՞]/gu,'').replace(/[.։;:()"«»!]+(?!\d)/gu,' ').replace(/,/gu,(m,offset:number,whole:string)=>/\d/u.test(whole[offset-1]??'')&&/\d/u.test(whole[offset+1]??'')?m:' ').replace(/\s+/gu,' ').trim();
 // An unknown height is not a reading; saying so is fine.
 text=text.replace(/\bheight(?: is)? unknown\b/gu,' ').replace(/\s+/gu,' ').trim();
 if(!text)return null;
 let name:string|null=null;
 const tail=/(?:^|\s)(?:for|для)\s+([\p{L}][\p{L}'-]*(?: [\p{L}][\p{L}'-]*){0,2})$/u.exec(text);
 if(tail){name=tail[1];text=text.slice(0,tail.index).trim();}
 const entries:MeasureEntry[]=[];
 // Weight and waist first, so their numbers are not read as a pressure.
 const weight=take(text,/(?:weight|wt|вес|քաշ\S*)\s*(?:is|:|=|է)?\s*(\d{2,3}(?:[.,]\d)?)\s*(?:kg|кг|կգ)?/u);
 if(weight){entries.push({field:'weight',text:decimal(weight.match[1])});text=weight.rest;}
 const waist=take(text,/(?:waist|талия|талии|окружность талии|գոտկատեղ\S*)\s*(?:is|:|=|է)?\s*(\d{2,3}(?:[.,]\d)?)\s*(?:cm|см|սմ)?/u);
 if(waist){entries.push({field:'waist',text:decimal(waist.match[1])});text=waist.rest;}
 // Pressure: systolic/diastolic with a slash, "на" or "over"; or two numbers after the word for blood pressure; then an optional pulse.
 const slash=take(text,/(?<!\d)(\d{2,3})\s*(?:\/|\\|на|over|ovr)\s*(\d{2,3})(?!\d)(?:\s*(?:,|:|-)?\s*(?:(?:pulse|hr|heart rate|пульс\S*|զարկերակ\S*)\s*(?:is|:|=|է)?\s*)?(\d{2,3})(?!\d))?(?:\s*(?:pulse|hr|bpm|пульс\S*|զարկերակ\S*))?/u);
 let bp=slash;
 if(!bp&&BP_WORD.test(text)){
  bp=take(text,/(?<!\d)(\d{2,3})\s+(\d{2,3})(?!\d)(?:\s+(?:(?:pulse|hr|heart rate|пульс\S*|զարկերակ\S*)\s*)?(\d{2,3})(?!\d))?/u);
 }
 if(bp){
  // A pulse named before or after the pressure ("pulse 72 bp 148/93") is read too.
  let pulse=bp.match[3]??null;text=bp.rest;
  if(!pulse){const named=take(text,new RegExp(`${PULSE.source}\\s*(?:is|:|=|\\u0567)?\\s*(\\d{2,3})(?!\\d)`,'u'));if(named){pulse=named.match[1];text=named.rest;}}
  entries.push({field:'bp',text:`${bp.match[1]}/${bp.match[2]}${pulse?` ${pulse}`:''}`});
 }
 if(!entries.length)return null;
 // Only filler is left. A pulse-less leftover number, an unknown word or a question stays with Zoe.
 const left=text.replace(BP_WORD,' ').replace(PULSE,' ').replace(/\b(?:height unknown|height)\b/gu,' ').split(' ').map(word=>word.trim()).filter(Boolean);
 if(left.some(word=>!FILLER.has(word)))return null;
 return {entries,name};
}
