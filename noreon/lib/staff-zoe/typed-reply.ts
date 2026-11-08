/** Recognise only an opening reply request containing the doctor's own words.
 * Like typedBoundary, strip known fillers and one polite prefix, never quotes or
 * earlier sentences. Match the original string so the body is never normalised.
 */
const languages=[
 {
  filler:/^(?:hi|hello|hey|good morning|zoe|please|ok|okay)[\s,.:!։՝]+/iu,
  person:/^(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?|i\s+will\s+|i'll\s+|i\s+want\s+to\s+|i\s+am\s+going\s+to\s+|i\s+)/iu,
  reply:/^(?:reply|write|message|tell|answer)(?:\s+to)?\s+(?:him|her|them|the\s+member)(?:\s*[:,]|\s+[-—]\s+)([\s\S]*)$/iu,
 },
 {
  filler:/^(?:բարև|բարի լույս|զոյա|zoe|խնդրում եմ|լավ)[\s,.:!։՝]+/iu,
  person:/^(?:(?:կարող)\s+(?:ես|եք)\s+|ես\s+(?!\S+ել\s+(?:եմ|էի)))/iu,
  reply:/^(?:պատասխանիր|գրիր|գրի|ասա)\s+(?:իրեն|նրան|անդամին)\s*[:՝\-,]([\s\S]*)$/iu,
 },
 {
  filler:/^(?:привет|здравствуйте|доброе утро|zoe|зоя|пожалуйста|ладно|хорошо)[\s,.:!]+/iu,
  person:/^(?:(?:можешь|можете|сможешь|сможете)\s+(?:пожалуйста\s+)?|я\s+(?:хочу\s+|буду\s+)?)/iu,
  reply:/^(?:ответь|напиши|скажи|сообщи)\s+(?:ему|ей|им|участнику)\s*[:\-—,]([\s\S]*)$/iu,
 },
];

export function typedReplyText(text:string):string|null{
 let opening=text.trim(),previous:string;
 do{previous=opening;for(const {filler} of languages)opening=opening.replace(filler,'').trim();}while(opening!==previous);
 for(const {person,reply} of languages){
  const match=opening.replace(person,'').match(reply);
  if(match){const body=match[1].trim();return body.length>=2&&body.length<=8000?body:null;}
 }
 return null;
}
