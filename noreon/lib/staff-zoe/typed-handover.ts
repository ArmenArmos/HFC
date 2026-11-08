/** Only a whole opening command, never a read, quotation or embedded request.
 * Match the original text so the doctor's note retains its spelling and case.
 */
const fillers=/^(?:hi|hello|zoe|please|зоя|пожалуйста|здравствуйте|զոյա|խնդրում եմ|բարև)[\s,.:!։՝]+/iu;
const polite=/^(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?|(?:можешь|можете)\s+(?:пожалуйста\s+)?|կարող\s+(?:ես|եք)\s+)/iu;
const target='(?:(?:hand\\s+over|hand\\s+this|pass\\s+it|send)\\s+to\\s+the\\s+nurse|передай\\s+(?:это\\s+)?медсестре|(?:հանձնիր|փոխանցիր)\\s+բուժքրոջը)';
const bare=new RegExp(`^${target}[.։]?$`,'iu');
const separator='(?:\\s*[:,՝]\\s*|\\s+[-–—]\\s+)';
const separated=new RegExp(`^${target}${separator}([\\s\\S]+)$`,'iu');
const instruction=/^(?:ask\s+the\s+nurse\s+to\s+|пусть\s+медсестра\s+|բուժքույրին\s+հանձնիր(?:\s*[:՝,]\s*|\s+))([\s\S]+)$/iu;
export function typedHandover(text:string):{note:string|null}|null{
 let opening=text.trim(),previous:string;
 do{previous=opening;opening=opening.replace(fillers,'').trim();}while(previous!==opening);
 opening=opening.replace(polite,'').replace(fillers,'').trim();
 if(bare.test(opening))return {note:null};
 const match=opening.match(separated)??opening.match(instruction);
 const note=match?.[1].trim();
 return note&&note.length<=2000?{note}:null;
}
