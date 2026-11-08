import {bpReadings} from '@/lib/zoe/bp-parse';

/**
 * A member's message that is only a blood pressure reading: the one way to enter numbers on Telegram, which has no form.
 * Strict on purpose. Exactly one reading, optionally prefixed by a logging request, and every other word must be a pressure word or "now", so a question, a symptom,
 * another day or a second reading gets no card and stays with Zoe. It decides nothing: the message has already been through
 * Zoe, and the card shows the numbers back for the member to save. Numbers only, never text from the message.
 */
const PLAIN=/^(?:my|blood|pressure|bp|is|now|mm|hg|mmhg|log|record|save|enter|add|note|please|reading|իմ|ճնշումը?ս?|զճ|է|հիմա|գրանցիր|գրանցեք|գրանցել|պահիր|պահեք|գրիր|գրեք|խնդրում|եմ|chnshum[sny]?|hima|arden|lav|e|a|grancir|grancel|grances|gri|pahi|xndrum|em|мое|моё|давление|ад|сейчас|мм|рт|ст|запиши|запишите|сохрани|сохраните|внеси|внесите|пожалуйста)$/u;
const PULSE=/(?<![\p{L}\d])(pulse|пульс|զարկ\p{L}*|zark\p{L}*)[\s:,-]*(\d{2,3})(?![\d\p{L}])/u;
const [PULSE_MIN,PULSE_MAX]=[20,250];

export type TypedReading={systolic:number;diastolic:number;pulse:number|null};
export function typedReading(raw:string):TypedReading|null{
 const t=raw.normalize('NFC').toLowerCase().replace(/\s+/gu,' ').trim();
 if(!t||t.length>80||/[?？՞]/u.test(t))return null;
 const found=bpReadings(t);
 if(found.length!==1)return null;
 const r=found[0]!;
 const p=PULSE.exec(t);
 const pulse=p?Number(p[2]):null;
 if(pulse!==null&&(pulse<PULSE_MIN||pulse>PULSE_MAX))return null;
 // What is left once the reading and the pulse are out: nothing but the plain words.
 const pair=/^\d{1,3}\s*(?:\/|\\|over|на|-?\s?ին|-?\s?ի|-i|i)\s*\d{1,3}/u.exec(t.slice(r.index))?.[0]??'';
 const rest=(t.slice(0,r.index)+' '+t.slice(r.index+pair.length)).replace(PULSE,' ')
  .replace(/^(?:please )?(?:log|record|enter|add|save)\s+(?=(?:my |blood |pressure\b|bp\b))/u,'');
 const words=rest.split(/[^\p{L}\d]+/u).filter(Boolean);
 return words.every(w=>PLAIN.test(w))?{systolic:r.systolic,diastolic:r.diastolic,pulse}:null;
}
